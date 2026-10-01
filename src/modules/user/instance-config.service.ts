import {
  BadRequestException,
  Injectable,
  NotFoundException,
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
  UserEntry,
} from "./instance-profile";
import { generateUserToken } from "../../common/utils/token";

export interface SetupConfigPatch {
  publicUrl?: string;
  apiId?: number;
  apiHash?: string;
  tmdbBearerToken?: string;
  preferredLanguage?: SupportedLanguage;
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

  // ---------------------------------------------------------------------------
  // Public config / profile API
  // ---------------------------------------------------------------------------

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
    };
  }

  /**
   * Build an InstanceProfile for the given token.
   * Falls back to the first user in the map when no token is provided
   * (backward-compat for code that doesn't yet know the token).
   */
  getProfile(token?: string): InstanceProfile {
    const users = this.persisted.users ?? {};
    const entry: UserEntry | undefined = token
      ? users[token]
      : Object.values(users)[0];

    if (!entry) {
      throw new NotFoundException("User not found");
    }

    const config = this.getConfig();
    return {
      id: 1,
      phone: entry.phone ?? null,
      session_string: entry.sessionString,
      token: entry.token,
      language: config.preferredLanguage,
      tmdb_token: config.tmdb.bearerToken || null,
      selected_folders: JSON.stringify(entry.selectedFolders ?? []),
      selected_channels: JSON.stringify(entry.selectedChannels ?? []),
    };
  }

  /**
   * Lookup a UserEntry by its token. Returns null when not found.
   */
  getUserByToken(token: string): UserEntry | null {
    return this.persisted.users?.[token] ?? null;
  }

  /**
   * Returns all stored user entries (token → entry).
   */
  getUsers(): Record<string, UserEntry> {
    return this.persisted.users ?? {};
  }

  /**
   * Upsert a user by phone. When the phone already exists the session string
   * (and optional name) are updated; otherwise a fresh token is generated and
   * the entry is created.
   *
   * @returns The created-or-updated UserEntry (includes the token).
   */
  async createOrUpdateUser(
    phone: string,
    sessionString: string,
    name?: string,
  ): Promise<UserEntry> {
    const users: Record<string, UserEntry> = {
      ...(this.persisted.users ?? {}),
    };

    // Find an existing entry by phone number.
    const existing = Object.values(users).find((u) => u.phone === phone);
    if (existing) {
      existing.sessionString = sessionString;
      if (name !== undefined) existing.name = name;
      this.persisted.users = users;
      this.writePersistedConfig();
      logger.info({ phone, token: existing.token }, "Updated existing user");
      return existing;
    }

    // Create a new entry with a freshly generated token.
    const token = generateUserToken();
    const entry: UserEntry = { phone, sessionString, token, name };
    users[token] = entry;
    this.persisted.users = users;
    this.writePersistedConfig();
    logger.info({ phone, token }, "Created new user");
    return entry;
  }

  
  /**
   * Delete a user by token.
   */
  
  updateUserName(token: string, name: string): void {
    if (this.persisted.users && this.persisted.users[token]) {
      this.persisted.users[token].name = name;
      this.writePersistedConfig();
    }
  }

  deleteUser(token: string): void {
    if (this.persisted.users && this.persisted.users[token]) {
      delete this.persisted.users[token];
      this.writePersistedConfig();
    }
  }

  isSetupComplete(): boolean {
    const config = this.getConfig();
    const hasUser = Object.keys(this.persisted.users ?? {}).length > 0;
    return Boolean(
      config.publicUrl &&
        config.telegram.apiId &&
        config.telegram.apiHash &&
        hasUser &&
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
    if (Object.keys(this.persisted.users ?? {}).length === 0) {
      missing.push("telegram.sessionString (no authenticated users)");
    }

    return missing;
  }

  async update(patch: SetupConfigPatch): Promise<void> {
    const next: PersistedInstanceConfig = {
      ...this.persisted,
      telegram: { ...(this.persisted.telegram || {}) },
      tmdb: { ...(this.persisted.tmdb || {}) },
    };

    if (patch.publicUrl !== undefined) next.publicUrl = patch.publicUrl;
    if (patch.apiId !== undefined) next.telegram!.apiId = patch.apiId;
    if (this.hasValue(patch.apiHash)) next.telegram!.apiHash = patch.apiHash;
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
      "telegram",
      "tmdb",
      "preferredLanguage",
      "selectedFolders",
      "selectedChannels",
      "users",
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

  async updateUserSelections(
    token: string,
    selections: { selectedFolders?: number[]; selectedChannels?: string[] },
  ): Promise<void> {
    const entry = this.getUserByToken(token);
    if (!entry) throw new NotFoundException("User not found");

    if (selections.selectedFolders !== undefined) {
      entry.selectedFolders = [...selections.selectedFolders];
    }
    if (selections.selectedChannels !== undefined) {
      entry.selectedChannels = [...selections.selectedChannels];
    }
    this.writePersistedConfig();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

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
