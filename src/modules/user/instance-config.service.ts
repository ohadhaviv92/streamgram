import {
  BadRequestException,
  Injectable,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as path from "path";
import { logger } from "../../logger";
import {
  EffectiveInstanceConfig,
  InstanceProfile,
  PersistedInstanceConfig,
  SupportedLanguage,
} from "./instance-profile";

export interface SetupConfigPatch {
  publicUrl?: string;
  apiId?: number;
  apiHash?: string;
  tmdbBearerToken?: string;
  preferredLanguage?: SupportedLanguage;
  sessionString?: string;
  phone?: string;
}

@Injectable()
export class InstanceConfigService implements OnModuleInit {
  private readonly dataDir: string;
  private readonly configPath: string;
  private persisted: PersistedInstanceConfig = {};

  constructor(private readonly configService: ConfigService) {
    this.dataDir = path.resolve(path.join(process.cwd(), "data"));
    this.configPath = path.join(this.dataDir, "config.json");
    this.ensureDataDirectory();
    this.loadPersistedConfig();
  }

  onModuleInit(): void {
    if (!this.isSetupComplete()) {
      logger.warn(
        {
          missing: this.getMissingFields(),
        },
        "TG2Stream is waiting for first-run setup",
      );
    }
  }

  getConfig(): EffectiveInstanceConfig {
    const persisted = this.persisted;
    const telegram = persisted.telegram || {};
    const tmdb = persisted.tmdb || {};

    return {
      publicUrl: this.firstNonEmpty(
        persisted.publicUrl,
        process.env.PUBLIC_URL,
        process.env.STREAM_HOST,
        this.configService.get<string>("server.streamHost", ""),
        "",
      ),
      telegram: {
        apiId: this.numberValue(
          telegram.apiId,
          process.env.TELEGRAM_API_ID,
          this.configService.get<number>("telegram.apiId", 0),
        ),
        apiHash: this.firstNonEmpty(
          telegram.apiHash,
          process.env.TELEGRAM_API_HASH,
          this.configService.get<string>("telegram.apiHash", ""),
          "",
        ),
        sessionString: this.firstNonEmpty(
          telegram.sessionString,
          process.env.TELEGRAM_SESSION_STRING,
          this.configService.get<string>("telegram.sessionString", ""),
          "",
        ),
      },
      tmdb: {
        bearerToken: this.firstNonEmpty(
          tmdb.bearerToken,
          process.env.TMDB_BEARER_TOKEN,
          this.configService.get<string>("tmdb.bearerToken", ""),
          "",
        ),
      },
      preferredLanguage: this.getPreferredLanguage(),
      phone: this.firstNonEmpty(persisted.phone, "") || null,
      selectedFolders: Array.isArray(persisted.selectedFolders)
        ? persisted.selectedFolders
        : [],
      selectedChannels: Array.isArray(persisted.selectedChannels)
        ? persisted.selectedChannels
        : [],
    };
  }

  getProfile(): InstanceProfile {
    const config = this.getConfig();
    return {
      id: 1,
      phone: config.phone,
      session_string: config.telegram.sessionString,
      token: "instance",
      language: config.preferredLanguage,
      tmdb_token: config.tmdb.bearerToken || null,
      selected_folders: JSON.stringify(config.selectedFolders),
      selected_channels: JSON.stringify(config.selectedChannels),
    };
  }

  isSetupComplete(): boolean {
    const config = this.getConfig();
    return Boolean(
      config.publicUrl &&
        config.telegram.apiId &&
        config.telegram.apiHash &&
        config.telegram.sessionString &&
        config.tmdb.bearerToken,
    );
  }

  getMissingFields(): string[] {
    const config = this.getConfig();
    const missing: string[] = [];

    if (!config.publicUrl) missing.push("publicUrl");
    if (!config.telegram.apiId) missing.push("telegram.apiId");
    if (!config.telegram.apiHash) missing.push("telegram.apiHash");
    if (!config.tmdb.bearerToken) missing.push("tmdb.bearerToken");
    if (!config.telegram.sessionString) missing.push("telegram.sessionString");

    return missing;
  }

  async update(patch: SetupConfigPatch): Promise<void> {
    const next: PersistedInstanceConfig = {
      ...this.persisted,
      telegram: { ...(this.persisted.telegram || {}) },
      tmdb: { ...(this.persisted.tmdb || {}) },
    };

    if (patch.publicUrl !== undefined) next.publicUrl = patch.publicUrl;
    if (patch.phone !== undefined) next.phone = patch.phone;
    if (patch.apiId !== undefined) next.telegram!.apiId = patch.apiId;
    if (this.hasValue(patch.apiHash)) next.telegram!.apiHash = patch.apiHash;
    if (this.hasValue(patch.sessionString)) {
      next.telegram!.sessionString = patch.sessionString;
    }
    if (this.hasValue(patch.tmdbBearerToken)) {
      next.tmdb!.bearerToken = patch.tmdbBearerToken;
    }
    if (patch.preferredLanguage !== undefined) {
      next.preferredLanguage = patch.preferredLanguage;
    }

    this.persisted = next;
    this.writePersistedConfig();
  }

  /** Returns the raw persisted JSON string for export. */
  exportRaw(): string {
    return `${JSON.stringify(this.persisted, null, 2)}\n`;
  }

  /**
   * Fully replaces the persisted config from an uploaded payload.
   * Unknown top-level keys are rejected.
   */
  async importRaw(incoming: PersistedInstanceConfig): Promise<void> {
    const allowed = new Set([
      "publicUrl",
      "phone",
      "telegram",
      "tmdb",
      "preferredLanguage",
      "selectedFolders",
      "selectedChannels",
    ]);
    for (const key of Object.keys(incoming)) {
      if (!allowed.has(key)) {
        throw new BadRequestException(`Unexpected config key: ${key}`);
      }
    }
    this.persisted = incoming;
    this.writePersistedConfig();
    logger.info("Config imported successfully");
  }

  async updateSelections(
    selectedFolders: number[],
    selectedChannels: string[],
  ): Promise<void> {
    this.persisted = {
      ...this.persisted,
      selectedFolders: [...selectedFolders],
      selectedChannels: [...selectedChannels],
    };
    this.writePersistedConfig();
  }

  private getPreferredLanguage(): SupportedLanguage {
    const candidate = this.firstNonEmpty(
      this.persisted.preferredLanguage,
      process.env.PREFERRED_LANGUAGE,
      this.configService.get<string>("language.preferredLanguage", "he"),
      "he",
    );

    return ["en", "he", "ru", "ar"].includes(candidate)
      ? (candidate as SupportedLanguage)
      : "en";
  }

  private firstNonEmpty(...values: Array<string | number | undefined | null>): string {
    for (const value of values) {
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }
    return "";
  }

  private hasValue(value: string | undefined): value is string {
    return value !== undefined && value.trim().length > 0;
  }

  private numberValue(...values: Array<string | number | undefined | null>): number {
    for (const value of values) {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0) return parsed;
    }
    return 0;
  }

  private ensureDataDirectory(): void {
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(this.dataDir, 0o700);
    } catch {
      // Best effort on filesystems that do not support chmod.
    }
  }

  private loadPersistedConfig(): void {
    if (!fs.existsSync(this.configPath)) return;

    try {
      const raw = fs.readFileSync(this.configPath, "utf8");
      this.persisted = JSON.parse(raw) as PersistedInstanceConfig;
    } catch (error) {
      logger.error({ error }, "Failed to read persisted instance config");
      throw new BadRequestException(
        `Unable to read ${this.configPath}; fix or remove the file before starting`,
      );
    }
  }

  private writePersistedConfig(): void {
    const temporaryPath = `${this.configPath}.tmp`;
    const serialized = `${JSON.stringify(this.persisted, null, 2)}\n`;
    fs.writeFileSync(temporaryPath, serialized, { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, this.configPath);
    try {
      fs.chmodSync(this.configPath, 0o600);
    } catch {
      // Best effort only.
    }
  }
}
