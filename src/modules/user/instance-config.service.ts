import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
import { InstanceRepository, InstanceBackup } from "../storage/instance.repository";
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
  securityRevision = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly repository: InstanceRepository,
  ) {}

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
    const persisted = this.repository.getSettings();
    const telegram = persisted.telegram || {};
    const tmdb = persisted.tmdb || {};

    return {
      publicUrl: this.firstNonEmpty(
        persisted.publicUrl,
        process.env.PUBLIC_URL,
        this.configService.get<string>("server.publicUrl", ""),
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
    const entry = token ? this.repository.getUser(token) : null;

    if (!entry) {
      throw new UnauthorizedException("Missing or invalid user token");
    }

    if (entry.blocked) throw new ForbiddenException("Account is blocked");

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
    return this.repository.getUser(token);
  }

  /**
   * Returns all stored user entries (token → entry).
   */
  getUsers(): Record<string, UserEntry> {
    return this.repository.getUsers();
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
    return this.repository.transaction(() => {
      const existing = this.repository.findUserByPhone(phone);
      if (existing?.blocked) throw new ForbiddenException("Account is blocked");
      const entry: UserEntry = {
        ...existing, phone, sessionString,
        ...(!existing ? { createdAt: Date.now() } : {}),
        token: existing?.token ?? generateUserToken(),
        ...(name !== undefined ? { name } : {}),
      };
      this.repository.upsertUser(entry);
      logger.info(existing ? "Updated existing user" : "Created new user");
      return entry;
    });
  }

  /**
   * Delete a user by token.
   */

  updateUserName(token: string, name: string): void {
    this.updatePersonal(token, { name });
  }

  deleteUser(token: string): void {
    this.repository.deleteUser(token);
  }

  setUserBlocked(token: string, blocked: boolean): void {
    const entry = this.getUserByToken(token);
    if (!entry) throw new NotFoundException("User not found");
    this.repository.upsertUser({ ...entry, blocked });
  }

  isManagementInitialized(): boolean {
    return this.repository.getSettings().managementInitialized === true;
  }

  isProtected(): boolean {
    return (
      this.repository.getSettings().adminProtection ??
      Boolean(this.repository.getSettings().adminPasswordHash)
    );
  }

  hasAdminPassword(): boolean {
    return Boolean(this.repository.getSettings().adminPasswordHash);
  }

  verifyAdminPassword(password?: string): boolean {
    const stored = this.repository.getSettings().adminPasswordHash;
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
      this.repository.replaceSettings({
        ...this.repository.getSettings(),
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

  createInvitation(name?: string) {
    const secret = crypto.randomBytes(32).toString("base64url");
    const record: InvitationRecord = {
      id: crypto.randomUUID(),
      ...(name?.trim() ? { name: name.trim() } : {}),
      secretHash: this.invitationHash(secret),
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    };
    this.repository.upsertInvitation(record);
    return { ...this.invitationSummary(record), secret };
  }

  getInvitations() {
    return this.repository.getInvitations().map((i) =>
      this.invitationSummary(i),
    );
  }

  private invitationSummary(i: InvitationRecord) {
    return {
      id: i.id,
      name: i.name ?? "",
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
    const record = this.repository.findInvitationByHash(this.invitationHash(secret));
    if (!record) throw new NotFoundException("Invitation not found");
    return this.requireInvitation(record.id);
  }

  private requireInvitation(id: string): InvitationRecord {
    const record = this.repository.getInvitation(id);
    if (!record) throw new NotFoundException("Invitation not found");
    const status = this.invitationSummary(record).status;
    if (status !== "active")
      throw new ForbiddenException(`Invitation ${status}`);
    return record;
  }

  revokeInvitation(id: string) {
    const record = this.repository.getInvitation(id);
    if (!record) throw new NotFoundException("Invitation not found");
    this.repository.upsertInvitation({ ...record, revokedAt: Date.now() });
  }

  deleteUsedInvitation(id: string) {
    const record = this.repository.getInvitation(id);
    if (!record) throw new NotFoundException("Invitation not found");
    if (record.usedAt === undefined)
      throw new BadRequestException("Only used invitation records can be deleted");
    this.repository.deleteInvitation(id);
  }

  /** Invitation validation, consumption and account persistence share one transaction. */
  completeAuthentication(
    owner: AuthOwner,
    phone: string,
    telegramId: string,
    sessionString: string,
  ): UserEntry {
    return this.repository.transaction(() => {
      const invitation = owner.kind === "invitation"
        ? this.requireInvitation(owner.id)
        : undefined;
      let existing = this.repository.findUserByIdentity(telegramId, phone);
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
      if (existing?.blocked) throw new ForbiddenException("Account is blocked");
      const entry = {
        ...existing,
        ...(!existing ? { createdAt: Date.now() } : {}),
        ...(!existing && invitation?.name ? { name: invitation.name } : {}),
        token: existing?.token ?? generateUserToken(),
        phone,
        telegramId,
        sessionString,
      };
      this.repository.upsertUser(entry);
      if (invitation) this.repository.upsertInvitation({ ...invitation, usedAt: Date.now() });
      return entry;
    });
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
    this.repository.upsertUser(updated);
  }

  isSetupComplete(): boolean {
    const config = this.getConfig();
    const hasUser = Object.keys(this.getUsers()).length > 0;
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
    if (Object.keys(this.getUsers()).length === 0) {
      missing.push("telegram.sessionString (no authenticated users)");
    }

    return missing;
  }

  async update(patch: SetupConfigPatch, initialize = false): Promise<void> {
    this.repository.transaction(() => {
      if (initialize && this.isManagementInitialized())
        throw new ForbiddenException("Management is already initialized");
      const telegram = { ...this.repository.getSettings().telegram };
      const tmdb = { ...this.repository.getSettings().tmdb };
      const next: PersistedInstanceConfig = {
        ...this.repository.getSettings(),
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
      this.repository.replaceSettings(next);
    });
    if (
      this.hasValue(patch.adminPassword) ||
      patch.adminProtection !== undefined
    )
      this.securityRevision++;
  }

  getBackupFormat(): "json" | "sqlite" { return this.repository.backupFormat; }

  exportBackup(): InstanceBackup { return this.repository.exportBackup(); }

  async importBackup(incoming: unknown): Promise<void> {
    const config = Buffer.isBuffer(incoming)
      ? this.repository.readDatabaseBackup(incoming)
      : incoming;
    await this.importRaw(config as PersistedInstanceConfig);
  }

  /** Returns the raw persisted JSON string for export. */
  exportRaw(): string {
    return `${JSON.stringify(this.repository.snapshot(), null, 2)}\n`;
  }

  /**
   * Fully replaces the persisted config from an uploaded payload.
   * Unknown top-level keys are rejected.
   */
  async importRaw(incoming: PersistedInstanceConfig): Promise<void> {
    const { validateBackup } = await import("../setup/dto/import-config.dto");
    const restored = validateBackup(incoming);
    this.repository.replaceSnapshot({
      ...restored,
      managementInitialized: true,
      adminPasswordHash: this.repository.getSettings().adminPasswordHash,
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
    this.repository.upsertUser(updated);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getPreferredLanguage(): SupportedLanguage {
    const candidate = this.firstNonEmpty(
      this.repository.getSettings().preferredLanguage,
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

}
