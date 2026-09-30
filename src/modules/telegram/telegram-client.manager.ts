import { Injectable, OnApplicationShutdown, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { logger } from "../../logger";
import { InstanceConfigService } from "../user/instance-config.service";

export interface ClientSession {
  client: TelegramClient;
  sessionString: string;
}

/** Manages the single Telegram client owned by this TG2Stream installation. */
@Injectable()
export class TelegramClientManager implements OnApplicationShutdown {
  private session: ClientSession | null = null;
  private initialization: Promise<TelegramClient> | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly instanceConfig?: InstanceConfigService,
  ) {
    if (!this.getApiId() || !this.getApiHash()) {
      logger.warn("Telegram API credentials are not configured; setup mode is active");
    }
  }

  async getOrInitializeClient(
    _instanceKey = "instance",
    suppliedSessionString?: string,
  ): Promise<TelegramClient> {
    const sessionString =
      suppliedSessionString || this.instanceConfig?.getConfig().telegram.sessionString || "";

    if (!this.getApiId() || !this.getApiHash()) {
      throw new Error("Telegram API credentials are not configured");
    }
    if (!sessionString) {
      throw new Error("Telegram session is not configured");
    }

    if (this.session && this.session.sessionString !== sessionString) {
      await this.removeClient();
    }

    if (this.session) {
      try {
        if (this.session.client.connected) return this.session.client;
      } catch (error) {
        logger.warn({ error }, "Existing Telegram client is unavailable");
        await this.removeClient();
      }
    }

    if (this.initialization) return this.initialization;

    this.initialization = this.initializeClient(sessionString)
      .then((client) => {
        this.session = { client, sessionString };
        return client;
      })
      .finally(() => {
        this.initialization = null;
      });

    return this.initialization;
  }

  getClient(): TelegramClient | null {
    return this.session?.client || null;
  }

  async removeClient(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (!session) return;

    try {
      await session.client.disconnect();
      await session.client.destroy();
    } catch (error) {
      logger.warn({ error }, "Failed to disconnect Telegram client");
    }
  }

  getActiveClientCount(): number {
    return this.session ? 1 : 0;
  }

  async disconnectAll(): Promise<void> {
    await this.removeClient();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.disconnectAll();
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
        useWSS: true,
        floodSleepThreshold: 60,
        requestRetries: 2,
        timeout: 30,
        autoReconnect: false,
      },
    );

    let lastErrorTime = 0;
    let errorCount = 0;
    const errorLogThrottleMs = 10000;
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
        logger.error({ errorCount }, "Telegram client exceeded error threshold");
        client.disconnect().catch((error) =>
          logger.debug({ error }, "Error during forced Telegram disconnect"),
        );
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
        logger.warn({ error: disconnectError }, "Failed to clean up Telegram client");
      }
      throw error;
    }
  }
}
