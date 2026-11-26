import { Injectable, OnApplicationShutdown, Optional, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Api, TelegramClient } from "teleproto";
import { Logger, LogLevel } from "teleproto/extensions/Logger";
import { StringSession } from "teleproto/sessions";
import { TypeNotFoundError } from "teleproto/errors";
import { logger } from "../../logger";
import { measureOtherRpc } from "./search-measurement";
import { InstanceConfigService } from "../user/instance-config.service";

export interface ClientSession {
  client: TelegramClient;
  sessionString: string;
  lastUsed: Date;
}

/**
 * Manages Telegram client instances keyed by user token.
 * Each user gets their own lazily-initialised client that is kept alive
 * in-memory for fifteen minutes after the last active operation.
 */
@Injectable()
export class TelegramClientManager implements OnApplicationShutdown {
  /** Live clients, keyed by user token. */
  private readonly clients = new Map<string, ClientSession>();
  private readonly credentialChecks = new Set<TelegramClient>();
  private readonly failedClients = new WeakSet<TelegramClient>();
  private readonly disposal = new WeakMap<TelegramClient, Promise<void>>();
  private readonly retiring = new Map<string, Promise<void>>();
  private readonly decodeFailures = new Map<string, { at: number; count: number; blockedUntil: number }>();
  private shuttingDown = false;
  private readonly activity = new WeakMap<TelegramClient, { count: number; lastUsed: number }>();
  private readonly idleTimeoutMs: number;

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

    this.idleTimeoutMs = this.configService.get<number>("telegram.idleTimeoutMs", 15 * 60 * 1000);
    // Active operations are excluded from idle cleanup.
    this.cleanupTimer = setInterval(
      () => void this.cleanupIdleClients(),
      this.configService.get<number>("telegram.cleanupIntervalMs", 60 * 1000),
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
    if (this.shuttingDown) throw new Error("Telegram client manager is shutting down");
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

    const retiring = this.retiring.get(userToken);
    if (retiring) {
      await retiring;
      return this.getOrInitializeClient(userToken, session);
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
          if (!this.failedClients.has(existing.client) && existing.client.connected) return existing.client;
        } catch (error) {
          logger.warn(
            { userToken, error },
            "Existing Telegram client is unavailable – replacing",
          );
        }
        // A disconnected client can still own background update work. Dispose of
        // it before replacing it, including when the connected getter throws.
        await this.removeClient(userToken, true);
      }
    }

    if ((this.decodeFailures.get(userToken)?.blockedUntil ?? 0) > Date.now()) {
      throw new ServiceUnavailableException("Telegram decoding recovery is cooling down; retry shortly");
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
      .catch((error) => {
        if (error instanceof TypeNotFoundError && (this.generations.get(userToken) ?? 0) === generation) {
          this.recordDecodeFailure(userToken);
        }
        throw error;
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
    if (session && !this.failedClients.has(session.client)) {
      session.lastUsed = new Date();
      return session.client;
    }
    return null;
  }

  /** Disconnects and removes the client for `userToken`. */
  async removeClient(userToken: string, preserveFailures = false): Promise<void> {
    if (!preserveFailures) this.decodeFailures.delete(userToken);
    this.generations.set(userToken, (this.generations.get(userToken) ?? 0) + 1);
    const retiring = this.retiring.get(userToken);
    if (retiring) return retiring;
    const pending = this.initializing.get(userToken);
    if (pending) await pending.catch(() => undefined);
    const session = this.clients.get(userToken);
    if (!session) return;

    this.clients.delete(userToken);
    const disposal = this.disposeClient(session.client);
    this.retiring.set(userToken, disposal.catch(() => undefined));
    try {
      await disposal;
    } catch (error) {
      logger.warn({ error, userToken }, "Failed to disconnect Telegram client");
    } finally {
      this.retiring.delete(userToken);
    }
    logger.info({ userToken }, "Removed Telegram client");
  }

  /** Keep this exact client alive until an operation ends, including backpressure/waits. */
  retainClient(client: TelegramClient): () => void {
    this.assertClientUsable(client);
    let activity = this.activity.get(client);
    if (!activity) {
      activity = { count: 0, lastUsed: Date.now() };
      this.activity.set(client, activity);
    }
    activity.count++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activity.count--;
      activity.lastUsed = Date.now();
    };
  }

  /** Observe RPC failures as well as background errors; never retry mutations here. */
  private observeRpcFailures(client: TelegramClient): void {
    const invoke = client.invoke.bind(client);
    client.invoke = (async (...args: Parameters<TelegramClient["invoke"]>) => {
      const release = this.retainClient(client);
      try {
        return await (args[0] instanceof Api.messages.SearchGlobal
          ? invoke(...args)
          : measureOtherRpc(args[0].className, () => invoke(...args)));
      } catch (error) {
        if (error instanceof TypeNotFoundError) this.failClient(client, error);
        throw error;
      } finally {
        release();
      }
    }) as TelegramClient["invoke"];
  }

  assertClientUsable(client: TelegramClient): void {
    if (this.failedClients.has(client)) {
      throw new ServiceUnavailableException("Telegram client failed; acquire a new managed client");
    }
  }

  private recordDecodeFailure(token: string): void {
    const now = Date.now();
    const previous = this.decodeFailures.get(token);
    const count = previous && now - previous.at < 60_000 ? previous.count + 1 : 1;
    this.decodeFailures.set(token, { at: now, count, blockedUntil: count >= 2 ? now + 30_000 : 0 });
  }

  private disposeClient(client: TelegramClient): Promise<void> {
    let pending = this.disposal.get(client);
    if (!pending) {
      pending = (async () => {
        try { await client.disconnect(); }
        finally { await client.destroy(); }
      })();
      this.disposal.set(client, pending);
    }
    return pending;
  }

  private failClient(client: TelegramClient, error: Error): void {
    if (this.failedClients.has(client)) return;
    this.failedClients.add(client);
    if (error instanceof TypeNotFoundError) {
      for (const [token, entry] of this.clients) {
        if (entry.client === client) this.recordDecodeFailure(token);
      }
    }
    logger.error({
      errorName: error.constructor.name,
      ...(error instanceof TypeNotFoundError ? { constructorId: error.invalidConstructorId } : {}),
    }, "Telegram client failed; disposing before managed recovery");
    // Never wait for read/update loops from inside their own error callbacks.
    void this.disposeClient(client).catch(() => {
      logger.warn("Failed to dispose Telegram client during recovery");
    });
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
      Array.from(new Set([...this.clients.keys(), ...this.initializing.keys(), ...this.retiring.keys()])).map((token) => this.removeClient(token)),
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

  /** Recheck each client immediately before removal; earlier disposal can await I/O. */
  private async cleanupIdleClients(): Promise<void> {
    for (const [token, session] of this.clients) {
      const activity = this.activity.get(session.client);
      const lastUsed = Math.max(session.lastUsed.getTime(), activity?.lastUsed ?? 0);
      if (!activity?.count && lastUsed <= Date.now() - this.idleTimeoutMs) {
        await this.removeClient(token);
      }
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

    this.observeRpcFailures(client);
    let lastErrorTime = 0;
    let errorCount = 0;
    const errorLogThrottleMs = 10_000;
    const maxErrorsBeforeDisconnect = 5;

    // Internal failures are delivered through onError, not update events.
    client.onError = async (error: Error) => {
      if (this.failedClients.has(client)) return;
      // Do not log the Error object: schema errors contain raw Telegram bytes.
      const errorDetails = {
        errorName: error.constructor.name,
        ...(error instanceof TypeNotFoundError
          ? { constructorId: error.invalidConstructorId }
          : {}),
      };

      const now = Date.now();
      if (now - lastErrorTime > errorLogThrottleMs) {
        lastErrorTime = now;
        errorCount = 0;
      }
      errorCount++;

      if (errorCount === 1) {
        logger.warn(
          { ...errorDetails, errorCount },
          "Telegram client encountered an error",
        );
      }

      if (error instanceof TypeNotFoundError || errorCount >= maxErrorsBeforeDisconnect) {
        this.failClient(client, error);
      }
    };

    try {
      await client.connect();
      await client.getMe();
      if (this.failedClients.has(client)) {
        throw new Error("Telegram client failed during initialization");
      }
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
