import { Injectable, OnApplicationShutdown, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Api, TelegramClient } from "teleproto";
import { Logger, LogLevel } from "teleproto/extensions/Logger";
import { StringSession } from "teleproto/sessions";
import { logger } from "../../logger";
import { InstanceConfigService } from "../user/instance-config.service";

export interface ClientSession {
  client: TelegramClient;
  sessionString: string;
  lastUsed: Date;
}

/**
 * Manages Telegram client instances keyed by user token.
 * Each user gets their own lazily-initialised client that is kept alive
 * in-memory for up to one hour of idle time.
 */
@Injectable()
export class TelegramClientManager implements OnApplicationShutdown {
  /** Live clients, keyed by user token. */
  private readonly clients = new Map<string, ClientSession>();
  private readonly credentialChecks = new Set<TelegramClient>();
  private shuttingDown = false;

  /**
   * Serialises concurrent initialisation attempts for the same token so that
   * exactly one `initializeClient` call is in flight at a time.
   */
  private readonly initializing = new Map<string, Promise<TelegramClient>>();
  private readonly generations = new Map<string, number>();

  /** Idle-cleanup timer handle (kept so tests can clear it if needed). */
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly instanceConfig?: InstanceConfigService,
  ) {
    if (!this.getApiId() || !this.getApiHash()) {
      logger.warn(
        "Telegram API credentials are not configured; setup mode is active",
      );
    }

    // Clean up clients idle for more than one hour, every 30 minutes.
    this.cleanupTimer = setInterval(
      () => void this.cleanupIdleClients(),
      30 * 60 * 1000,
    );
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Checks application credentials without authorizing an account or retaining a login token. */
  async checkApiCredentials(apiId: number, apiHash: string): Promise<void> {
    if (this.shuttingDown) throw new Error("Telegram client manager is shutting down");
    const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
      connectionRetries: 1,
      requestRetries: 1,
      floodSleepThreshold: 0,
      timeout: 10,
      autoReconnect: false,
      baseLogger: new Logger(LogLevel.NONE),
    });
    this.credentialChecks.add(client);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          await client.connect();
          if (cancelled || this.shuttingDown) throw new Error("Telegram credential check cancelled");
          const result = await client.invoke(new Api.auth.ExportLoginToken({
            apiId,
            apiHash,
            exceptIds: [],
          }));
          if (!(result instanceof Api.auth.LoginToken))
            throw new Error("Unexpected Telegram credential check response");
          // Do not export the session, publish the token, or accept a login.
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Telegram credential check timed out")), 10_000);
        }),
      ]);
    } finally {
      cancelled = true;
      if (timer) clearTimeout(timer);
      try {
        // destroy marks the client unusable immediately and also disconnects it.
        await client.destroy();
      } finally {
        this.credentialChecks.delete(client);
      }
    }
  }

  /**
   * Returns the live client for `userToken`, initialising one if necessary.
   * If `sessionString` has changed since the last init the old client is
   * disconnected first.
   */
  async getOrInitializeClient(
    userToken: string,
    sessionString?: string,
  ): Promise<TelegramClient> {
    const session = sessionString || "";
    if (this.instanceConfig && !userToken.startsWith("auth:")) {
      const account = this.instanceConfig.getUserByToken(userToken);
      if (!account || account.sessionString !== session) {
        throw new Error("Telegram account was deleted or its session was replaced");
      }
    }

    if (!this.getApiId() || !this.getApiHash()) {
      throw new Error("Telegram API credentials are not configured");
    }
    if (!session) {
      throw new Error("Telegram session is not configured");
    }

    const existing = this.clients.get(userToken);

    if (existing) {
      // Re-authenticate: session has been renewed.
      if (existing.sessionString !== session) {
        logger.info(
          { userToken },
          "Session string changed – replacing Telegram client",
        );
        await this.removeClient(userToken);
      } else {
        existing.lastUsed = new Date();
        try {
          if (existing.client.connected) return existing.client;
        } catch (error) {
          logger.warn(
            { userToken, error },
            "Existing Telegram client is unavailable – replacing",
          );
          await this.removeClient(userToken);
        }
      }
    }

    // If an initialisation is already in progress for this token, reuse it.
    const inFlight = this.initializing.get(userToken);
    if (inFlight) {
      await inFlight;
      return this.getOrInitializeClient(userToken, session);
    }
    const generation = this.generations.get(userToken) ?? 0;

    const init = this.initializeClient(session)
      .then(async (client) => {
        if ((this.generations.get(userToken) ?? 0) !== generation) {
          await client.disconnect();
          await client.destroy();
          throw new Error("Telegram client initialization was cancelled");
        }
        this.clients.set(userToken, { client, sessionString: session, lastUsed: new Date() });
        logger.info(
          { userToken, totalClients: this.clients.size },
          "Initialized new Telegram client for user",
        );
        return client;
      })
      .finally(() => {
        this.initializing.delete(userToken);
      });

    this.initializing.set(userToken, init);
    return init;
  }

  /**
   * Returns an existing client without triggering initialisation.
   * Updates `lastUsed` on hit.
   */
  getClient(userToken: string): TelegramClient | null {
    const session = this.clients.get(userToken);
    if (session) {
      session.lastUsed = new Date();
      return session.client;
    }
    return null;
  }

  /** Disconnects and removes the client for `userToken`. */
  async removeClient(userToken: string): Promise<void> {
    this.generations.set(userToken, (this.generations.get(userToken) ?? 0) + 1);
    await this.initializing.get(userToken)?.catch(() => undefined);
    const session = this.clients.get(userToken);
    if (!session) return;

    this.clients.delete(userToken);
    try {
      await session.client.disconnect();
      await session.client.destroy();
    } catch (error) {
      logger.warn({ error, userToken }, "Failed to disconnect Telegram client");
    }
    logger.info({ userToken }, "Removed Telegram client");
  }

  /** Total number of live clients. */
  getActiveClientCount(): number {
    return this.clients.size;
  }

  /** Disconnect every live client (graceful shutdown). */
  async disconnectAll(): Promise<void> {
    logger.info(
      { count: this.clients.size },
      "Disconnecting all Telegram clients",
    );
    await Promise.all(
      Array.from(new Set([...this.clients.keys(), ...this.initializing.keys()])).map((token) => this.removeClient(token)),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    clearInterval(this.cleanupTimer);
    await Promise.allSettled(Array.from(this.credentialChecks, (client) => client.destroy()));
    await this.disconnectAll();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Disconnects clients that have been idle for more than one hour. */
  private async cleanupIdleClients(): Promise<void> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const toRemove: string[] = [];

    for (const [token, session] of this.clients.entries()) {
      if (session.lastUsed < oneHourAgo) {
        toRemove.push(token);
      }
    }

    for (const token of toRemove) {
      await this.removeClient(token);
    }

    if (toRemove.length > 0) {
      logger.info(
        { count: toRemove.length, remaining: this.clients.size },
        "Cleaned up idle Telegram clients",
      );
    }
  }

  private getApiId(): number {
    return (
      this.instanceConfig?.getConfig().telegram.apiId ||
      this.configService.get<number>("telegram.apiId", 0)
    );
  }

  private getApiHash(): string {
    return (
      this.instanceConfig?.getConfig().telegram.apiHash ||
      this.configService.get<string>("telegram.apiHash", "")
    );
  }

  private async initializeClient(sessionString: string): Promise<TelegramClient> {
    const client = new TelegramClient(
      new StringSession(sessionString),
      this.getApiId(),
      this.getApiHash(),
      {
        connectionRetries: 3,
        downloadRetries: 2,
        maxConcurrentDownloads: 5,
        floodSleepThreshold: 60,
        requestRetries: 2,
        timeout: 30,
        autoReconnect: false,
      },
    );

    let lastErrorTime = 0;
    let errorCount = 0;
    const errorLogThrottleMs = 10_000;
    const maxErrorsBeforeDisconnect = 5;

    client.addEventHandler((event: any) => {
      if (!(event instanceof Error) && !(event?.error instanceof Error)) return;

      const now = Date.now();
      if (now - lastErrorTime > errorLogThrottleMs) {
        lastErrorTime = now;
        errorCount = 0;
      }
      errorCount++;

      if (errorCount === 1) {
        logger.warn(
          { error: event?.error || event, errorCount },
          "Telegram client encountered an error",
        );
      }

      if (errorCount >= maxErrorsBeforeDisconnect) {
        logger.error(
          { errorCount },
          "Telegram client exceeded error threshold, disconnecting",
        );
        client
          .disconnect()
          .catch((err) => logger.debug({ err }, "Error during forced disconnect"));
      }
    });

    try {
      await client.connect();
      await client.getMe();
      return client;
    } catch (error) {
      logger.error({ error }, "Failed to initialize Telegram client");
      try {
        await client.disconnect();
        await client.destroy();
      } catch (disconnectError) {
        logger.warn(
          { error: disconnectError },
          "Failed to clean up Telegram client after init error",
        );
      }
      throw error;
    }
  }
}
