import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { logger } from "../../logger";
import {
  EffectiveInstanceConfig,
  InstanceProfile,
  PersistedInstanceConfig,
  SupportedLanguage,
  UserEntry,
  AuthOwner,
  InvitationRecord,
} from "./instance-profile";
import { generateUserToken } from "../../common/utils/token";

export interface SetupConfigPatch {
  publicUrl?: string;
  apiId?: number;
  apiHash?: string;
  tmdbBearerToken?: string;
  preferredLanguage?: SupportedLanguage;
  phone?: string;
  adminPassword?: string;
  adminProtection?: boolean;
}

@Injectable()
export class InstanceConfigService implements OnModuleInit {
  private readonly dataDir: string;
  private readonly configPath: string;
  private persisted: PersistedInstanceConfig = {};
  securityRevision = 0;

  constructor(private readonly configService: ConfigService) {
    this.dataDir = path.resolve(
      this.configService.get<string>(
        "storage.dataDir",
        path.join(process.cwd(), "data"),
      ),
    );
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
        "StreamGram is waiting for first-run setup",
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
   * Requires an explicit token. Account-scoped operations never use a default account.
   */
  getProfile(token?: string): InstanceProfile {
    const users = this.persisted.users ?? {};
    const entry: UserEntry | undefined =
      token && Object.prototype.hasOwnProperty.call(users, token)
        ? users[token]
        : undefined;

    if (!entry) {
      throw new UnauthorizedException("Missing or invalid user token");
    }

    const config = this.getConfig();
    return {
      id: 1,
      phone: entry.phone ?? null,
      session_string: entry.sessionString,
      token: entry.token,
      language: entry.language ?? config.preferredLanguage,
      tmdb_token: config.tmdb.bearerToken || null,
      selected_folders: JSON.stringify(entry.selectedFolders ?? []),
      selected_channels: JSON.stringify(entry.selectedChannels ?? []),
    };
  }

  /**
   * Lookup a UserEntry by its token. Returns null when not found.
   */
  getUserByToken(token: string): UserEntry | null {
    const users = this.persisted.users ?? {};
    return Object.prototype.hasOwnProperty.call(users, token)
      ? users[token]
      : null;
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
      logger.info("Updated existing user");
      return existing;
    }

    // Create a new entry with a freshly generated token.
    const token = generateUserToken();
    const entry: UserEntry = { phone, sessionString, token, name };
    users[token] = entry;
    this.persisted.users = users;
    this.writePersistedConfig();
    logger.info("Created new user");
    return entry;
  }

  /**
   * Delete a user by token.
   */

  updateUserName(token: string, name: string): void {
    this.updatePersonal(token, { name });
  }

  deleteUser(token: string): void {
    if (!this.getUserByToken(token)) return;
    const users = { ...this.getUsers() };
    delete users[token];
    this.commit({ ...this.persisted, users });
  }

  isManagementInitialized(): boolean {
    return this.persisted.managementInitialized === true;
  }

  isProtected(): boolean {
    return (
      this.persisted.adminProtection ??
      Boolean(this.persisted.adminPasswordHash)
    );
  }

  hasAdminPassword(): boolean {
    return Boolean(this.persisted.adminPasswordHash);
  }

  verifyAdminPassword(password?: string): boolean {
    const stored = this.persisted.adminPasswordHash;
    if (!stored || !password || password.length > 1024) return false;
    const candidate = stored.startsWith("scrypt$")
      ? crypto.scryptSync(password, stored.split("$")[1], 64).toString("hex")
      : crypto.createHash("sha256").update(password).digest("hex");
    const expected = stored.startsWith("scrypt$")
      ? stored.split("$")[2]
      : stored;
    const valid =
      candidate.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
    if (valid && !stored.startsWith("scrypt$")) {
      this.commit({
        ...this.persisted,
        adminPasswordHash: this.hashPassword(password),
      });
    }
    return valid;
  }

  private hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString("hex");
    return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString("hex")}`;
  }

  async initialize(patch: SetupConfigPatch): Promise<void> {
    if (this.isManagementInitialized())
      throw new ForbiddenException("Management is already initialized");
    await this.update(
      { ...patch, adminProtection: patch.adminProtection ?? true },
      true,
    );
  }

  createInvitation() {
    const secret = crypto.randomBytes(32).toString("base64url");
    const record: InvitationRecord = {
      id: crypto.randomUUID(),
      secretHash: this.invitationHash(secret),
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    };
    this.commit({
      ...this.persisted,
      invitations: [...(this.persisted.invitations ?? []), record],
    });
    return { ...this.invitationSummary(record), secret };
  }

  getInvitations() {
    return (this.persisted.invitations ?? []).map((i) =>
      this.invitationSummary(i),
    );
  }

  private invitationSummary(i: InvitationRecord) {
    return {
      id: i.id,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
      status:
        i.revokedAt !== undefined
          ? "revoked"
          : i.usedAt !== undefined
            ? "used"
            : i.expiresAt <= Date.now()
              ? "expired"
              : "active",
    };
  }

  private invitationHash(secret: string) {
    return crypto.createHash("sha256").update(secret).digest("hex");
  }

  validateInvitation(secret: string): InvitationRecord {
    const record = this.persisted.invitations?.find(
      (i) => i.secretHash === this.invitationHash(secret),
    );
    if (!record) throw new NotFoundException("Invitation not found");
    return this.requireInvitation(record.id);
  }

  private requireInvitation(id: string): InvitationRecord {
    const record = this.persisted.invitations?.find((i) => i.id === id);
    if (!record) throw new NotFoundException("Invitation not found");
    const status = this.invitationSummary(record).status;
    if (status !== "active")
      throw new ForbiddenException(`Invitation ${status}`);
    return record;
  }

  revokeInvitation(id: string) {
    if (!this.persisted.invitations?.some((i) => i.id === id))
      throw new NotFoundException("Invitation not found");
    this.commit({
      ...this.persisted,
      invitations: this.persisted.invitations.map((i) =>
        i.id === id ? { ...i, revokedAt: Date.now() } : i,
      ),
    });
  }

  /** No await between validation and atomic file replacement: invite use and user creation are one transaction. */
  completeAuthentication(
    owner: AuthOwner,
    phone: string,
    telegramId: string,
    sessionString: string,
  ): UserEntry {
    if (owner.kind === "invitation") this.requireInvitation(owner.id);
    const users = { ...this.getUsers() };
    let existing = Object.values(users).find(
      (u) =>
        u.telegramId === telegramId ||
        (!u.telegramId &&
          u.phone.replace(/\D/g, "") === phone.replace(/\D/g, "")),
    );
    if (owner.kind === "user") {
      const target = this.getUserByToken(owner.id);
      if (!target) throw new UnauthorizedException("Account was deleted");
      if (
        target.telegramId
          ? target.telegramId !== telegramId
          : target.phone.replace(/\D/g, "") !== phone.replace(/\D/g, "")
      ) {
        throw new ForbiddenException(
          "Reconnect with the same Telegram account",
        );
      }
      existing = target;
    }
    const entry = {
      ...existing,
      token: existing?.token ?? generateUserToken(),
      phone,
      telegramId,
      sessionString,
    };
    users[entry.token] = entry;
    this.commit({
      ...this.persisted,
      users,
      invitations: (this.persisted.invitations ?? []).map((i) =>
        owner.kind === "invitation" && i.id === owner.id
          ? { ...i, usedAt: Date.now() }
          : i,
      ),
    });
    return entry;
  }

  updatePersonal(
    token: string,
    patch: { name?: string; language?: SupportedLanguage | null },
  ): void {
    const entry = this.getUserByToken(token);
    if (!entry) throw new UnauthorizedException("Invalid user token");
    const updated = { ...entry };
    if (patch.name !== undefined) updated.name = patch.name.trim();
    if (patch.language !== undefined)
      updated.language = patch.language ?? undefined;
    this.commit({
      ...this.persisted,
      users: { ...this.getUsers(), [token]: updated },
    });
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

  async update(patch: SetupConfigPatch, initialize = false): Promise<void> {
    const telegram = { ...this.persisted.telegram };
    const tmdb = { ...this.persisted.tmdb };
    const next: PersistedInstanceConfig = {
      ...this.persisted,
      ...(initialize ? { managementInitialized: true } : {}),
      telegram,
      tmdb,
    };

    if (patch.publicUrl !== undefined) next.publicUrl = patch.publicUrl;
    if (patch.apiId !== undefined) telegram.apiId = patch.apiId;
    if (this.hasValue(patch.apiHash)) telegram.apiHash = patch.apiHash;
    if (this.hasValue(patch.tmdbBearerToken)) {
      tmdb.bearerToken = patch.tmdbBearerToken;
    }
    if (patch.preferredLanguage !== undefined) {
      next.preferredLanguage = patch.preferredLanguage;
    }
    if (this.hasValue(patch.adminPassword)) {
      if (patch.adminPassword.length < 8 || patch.adminPassword.length > 1024)
        throw new BadRequestException(
          "Use an admin password of 8–1024 characters",
        );
      next.adminPasswordHash = this.hashPassword(patch.adminPassword);
    }
    if (patch.adminProtection !== undefined)
      next.adminProtection = patch.adminProtection;
    if (next.adminProtection && !next.adminPasswordHash)
      throw new BadRequestException(
        "A password is required to enable admin protection",
      );
    this.commit(next);
    if (
      this.hasValue(patch.adminPassword) ||
      patch.adminProtection !== undefined
    )
      this.securityRevision++;
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
    const { validateBackup } = await import("../setup/dto/import-config.dto");
    const restored = validateBackup(incoming);
    this.commit({
      ...restored,
      managementInitialized: true,
      adminPasswordHash: this.persisted.adminPasswordHash,
      adminProtection: this.isProtected(),
      invitations: [],
    });
    this.securityRevision++;
    logger.info("Config imported successfully");
  }

  async updateUserSelections(
    token: string,
    selections: { selectedFolders?: number[]; selectedChannels?: string[] },
  ): Promise<void> {
    const entry = this.getUserByToken(token);
    if (!entry) throw new NotFoundException("User not found");

    const updated = { ...entry };
    if (selections.selectedFolders !== undefined) {
      updated.selectedFolders = [...selections.selectedFolders];
    }
    if (selections.selectedChannels !== undefined) {
      updated.selectedChannels = [...selections.selectedChannels];
    }
    this.commit({
      ...this.persisted,
      users: { ...this.getUsers(), [token]: updated },
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getPreferredLanguage(): SupportedLanguage {
    const candidate = this.firstNonEmpty(
      this.persisted.preferredLanguage,
      process.env.PREFERRED_LANGUAGE,
      this.configService.get<string>("language.preferredLanguage", "en"),
      "en",
    );

    return ["en", "he", "ru", "ar"].includes(candidate)
      ? (candidate as SupportedLanguage)
      : "en";
  }

  private firstNonEmpty(
    ...values: Array<string | number | undefined | null>
  ): string {
    for (const value of values) {
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }
    return "";
  }

  private hasValue(value: string | undefined): value is string {
    return typeof value === "string" && value.trim().length > 0;
  }

  private numberValue(
    ...values: Array<string | number | undefined | null>
  ): number {
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
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Invalid persisted instance config");
      }
      this.persisted = parsed as PersistedInstanceConfig;
      const next = { ...this.persisted };
      if (next.invitations !== undefined) {
        next.invitations = this.normalizeInvitations(next.invitations);
      }
      if (
        next.managementInitialized === undefined &&
        (next.users !== undefined || next.adminPasswordHash)
      ) {
        next.managementInitialized = true;
        next.adminProtection = Boolean(next.adminPasswordHash);
      }
      if (JSON.stringify(next) !== JSON.stringify(this.persisted)) {
        this.commit(next);
      }
    } catch (error) {
      logger.error({ error }, "Failed to read persisted instance config");
      throw new BadRequestException(
        `Unable to read ${this.configPath}; fix or remove the file before starting`,
      );
    }
  }

  /** Older installations stored invitations by ID, with ISO date strings. */
  private normalizeInvitations(value: unknown): InvitationRecord[] {
    if (value === null) return [];
    if (typeof value !== "object") {
      throw new Error("Invalid persisted invitation collection");
    }
    const records: unknown[] = Array.isArray(value)
      ? value
      : Object.values(value);
    return records.map((record) => {
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw new Error("Invalid persisted invitation record");
      }
      const invitation = record as Record<string, unknown>;
      if (
        typeof invitation.id !== "string" ||
        !invitation.id ||
        typeof invitation.secretHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(invitation.secretHash)
      ) {
        throw new Error("Invalid persisted invitation identity");
      }
      return {
        ...invitation,
        id: invitation.id,
        secretHash: invitation.secretHash,
        createdAt: this.invitationTimestamp(invitation.createdAt),
        expiresAt: this.invitationTimestamp(invitation.expiresAt),
        ...(invitation.usedAt !== undefined
          ? { usedAt: this.invitationTimestamp(invitation.usedAt) }
          : {}),
        ...(invitation.revokedAt !== undefined
          ? { revokedAt: this.invitationTimestamp(invitation.revokedAt) }
          : {}),
      };
    });
  }

  private invitationTimestamp(value: unknown): number {
    const timestamp = typeof value === "string" ? Date.parse(value) : value;
    if (
      typeof timestamp !== "number" ||
      !Number.isSafeInteger(timestamp) ||
      timestamp < 0
    ) {
      // Never drop an invalid used/revoked timestamp and accidentally reactivate a link.
      throw new Error("Invalid persisted invitation timestamp");
    }
    return timestamp;
  }

  private commit(next: PersistedInstanceConfig): void {
    const previous = this.persisted;
    this.persisted = next;
    try {
      this.writePersistedConfig();
    } catch (error) {
      this.persisted = previous;
      throw error;
    }
  }

  private writePersistedConfig(): void {
    const temporaryPath = `${this.configPath}.tmp`;
    const serialized = `${JSON.stringify(this.persisted, null, 2)}\n`;
    fs.writeFileSync(temporaryPath, serialized, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, this.configPath);
    try {
      fs.chmodSync(this.configPath, 0o600);
    } catch {
      // Best effort only.
    }
  }
}
