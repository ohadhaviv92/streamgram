import { BadRequestException } from "@nestjs/common";
import Database from "better-sqlite3";
import * as fs from "fs";
import { join } from "path";
import { PersistedInstanceConfig, UserEntry, InvitationRecord } from "../user/instance-profile";
import { InstanceRepository, InstanceSettings, InstanceBackup } from "./instance.repository";
import { normalizeConfig } from "./normalize-config";
import { readJsonConfig } from "./json-instance.repository";

export class SqliteInstanceRepository extends InstanceRepository {
  readonly backupFormat = "sqlite" as const;
  private readonly db: Database.Database;

  constructor(dataDir: string) {
    super();
    const databasePath = join(dataDir, "config.sqlite");
    // Pre-create with private permissions before SQLite opens the file.
    const descriptor = fs.openSync(databasePath, "a", 0o600);
    fs.closeSync(descriptor);
    fs.chmodSync(databasePath, 0o600);
    this.db = new Database(databasePath);
    try {
      const version = this.db.pragma("user_version", { simple: true });
      if (version !== 0 && version !== 1) throw new Error("Unsupported SQLite storage schema version");
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS users (token TEXT PRIMARY KEY, phone TEXT NOT NULL, normalized_phone TEXT NOT NULL, telegram_id TEXT, payload TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS users_phone ON users(phone);
          CREATE INDEX IF NOT EXISTS users_normalized_phone ON users(normalized_phone);
          CREATE INDEX IF NOT EXISTS users_telegram_id ON users(telegram_id);
          CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, payload TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS invitations_secret_hash ON invitations(secret_hash);
          CREATE TABLE IF NOT EXISTS storage_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        `);
        if (!this.db.prepare("SELECT value FROM storage_metadata WHERE key = 'initialized'").get()) {
          const jsonPath = join(dataDir, "config.json");
          this.replaceSnapshot(fs.existsSync(jsonPath) ? readJsonConfig(jsonPath) : {});
          this.db.prepare("INSERT INTO storage_metadata(key, value) VALUES ('initialized', 'true')").run();
        }
        this.db.pragma("user_version = 1");
      });
      // Force a read now so corrupt payloads stop startup, rather than failing a request later.
      this.snapshot();
    } catch (error) {
      this.db.close();
      if (error instanceof BadRequestException) throw error;
      throw new Error(`Unable to initialize ${databasePath}; check database integrity, schema version and filesystem access`);
    }
  }

  exportBackup(): InstanceBackup {
    // SQLite serializes a consistent standalone database, including committed data.
    return { extension: "sqlite", contentType: "application/vnd.sqlite3", data: this.db.serialize() };
  }

  readDatabaseBackup(data: Buffer): PersistedInstanceConfig {
    let source: Database.Database | undefined;
    try {
      if (data.length < 100 || data.subarray(0, 16).toString("binary") !== "SQLite format 3\0")
        throw new Error("Invalid SQLite header");
      // Isolated, read-only database: never replace the live file or execute uploaded schema.
      source = new Database(data, { readonly: true });
      if (source.pragma("user_version", { simple: true }) !== 1 ||
          source.pragma("quick_check", { simple: true }) !== "ok")
        throw new Error("Invalid SQLite schema or integrity");
      for (const name of ["settings", "users", "invitations", "storage_metadata"]) {
        const table = source.prepare("SELECT type, sql FROM sqlite_master WHERE name = ?").get(name) as
          { type: string; sql: string } | undefined;
        if (!table || table.type !== "table" || !/^CREATE TABLE\s/i.test(table.sql))
          throw new Error("Invalid backup table");
      }
      const initialized = source.prepare("SELECT value FROM storage_metadata WHERE key = 'initialized'").get() as
        { value: string } | undefined;
      if (initialized?.value !== "true") throw new Error("Uninitialized backup");
      const settings = source.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string } | undefined;
      if (!settings) throw new Error("Missing backup settings");
      const users = source.prepare("SELECT token, payload FROM users ORDER BY rowid").all() as { token: string; payload: string }[];
      const invitations = source.prepare("SELECT id, secret_hash, payload FROM invitations ORDER BY rowid").all() as
        { id: string; secret_hash: string; payload: string }[];
      return normalizeConfig({
        ...JSON.parse(settings.payload),
        users: Object.fromEntries(users.map(row => {
          const user = JSON.parse(row.payload) as UserEntry;
          if (user.token !== row.token) throw new Error("Invalid account identity");
          return [row.token, user];
        })),
        invitations: invitations.map(row => {
          const invitation = JSON.parse(row.payload) as InvitationRecord;
          if (invitation.id !== row.id || invitation.secretHash !== row.secret_hash)
            throw new Error("Invalid invitation identity");
          return invitation;
        }),
      });
    } catch {
      // SQLite/JSON parser errors can expose backup contents; return a safe message.
      throw new BadRequestException("Invalid or unsupported StreamGram SQLite backup");
    } finally { source?.close(); }
  }

  private one<T>(sql: string, ...values: string[]): T | null {
    const row = this.db.prepare(sql).get(...values) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as T : null;
  }
  getSettings(): InstanceSettings { return this.one<InstanceSettings>("SELECT payload FROM settings WHERE id = 1") ?? {}; }
  replaceSettings(settings: InstanceSettings): void {
    this.db.prepare("INSERT INTO settings(id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload").run(JSON.stringify(settings));
  }
  getUser(token: string): UserEntry | null { return this.one("SELECT payload FROM users WHERE token = ?", token); }
  findUserByIdentity(telegramId: string, phone: string): UserEntry | null {
    return this.one(`SELECT payload FROM users WHERE telegram_id = ? OR
      ((telegram_id IS NULL OR telegram_id = '') AND normalized_phone = ?) ORDER BY rowid LIMIT 1`,
      telegramId, phone.replace(/\D/g, ""));
  }
  findUserByPhone(phone: string): UserEntry | null { return this.one("SELECT payload FROM users WHERE phone = ? ORDER BY rowid LIMIT 1", phone); }
  getUsers(): Record<string, UserEntry> {
    const rows = this.db.prepare("SELECT token, payload FROM users ORDER BY rowid").all() as { token: string; payload: string }[];
    return Object.fromEntries(rows.map(row => [row.token, JSON.parse(row.payload) as UserEntry]));
  }
  upsertUser(user: UserEntry): void {
    this.db.prepare(`INSERT INTO users(token, phone, normalized_phone, telegram_id, payload) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(token) DO UPDATE SET phone = excluded.phone, normalized_phone = excluded.normalized_phone, telegram_id = excluded.telegram_id, payload = excluded.payload`)
      .run(user.token, user.phone, user.phone.replace(/\D/g, ""), user.telegramId ?? null, JSON.stringify(user));
  }
  deleteUser(token: string): void { this.db.prepare("DELETE FROM users WHERE token = ?").run(token); }
  getInvitations(): InvitationRecord[] {
    const rows = this.db.prepare("SELECT payload FROM invitations ORDER BY rowid").all() as { payload: string }[];
    return rows.map(row => JSON.parse(row.payload) as InvitationRecord);
  }
  getInvitation(id: string): InvitationRecord | null { return this.one("SELECT payload FROM invitations WHERE id = ?", id); }
  findInvitationByHash(hash: string): InvitationRecord | null { return this.one("SELECT payload FROM invitations WHERE secret_hash = ? ORDER BY rowid LIMIT 1", hash); }
  upsertInvitation(invitation: InvitationRecord): void {
    this.db.prepare(`INSERT INTO invitations(id, secret_hash, payload) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET secret_hash = excluded.secret_hash, payload = excluded.payload`)
      .run(invitation.id, invitation.secretHash, JSON.stringify(invitation));
  }
  deleteInvitation(id: string): void { this.db.prepare("DELETE FROM invitations WHERE id = ?").run(id); }
  snapshot(): PersistedInstanceConfig {
    return { ...this.getSettings(), users: this.getUsers(), invitations: this.getInvitations() };
  }
  replaceSnapshot(config: PersistedInstanceConfig): void {
    this.transaction(() => {
      const settings = { ...config };
      delete settings.users;
      delete settings.invitations;
      this.replaceSettings(settings);
      this.db.exec("DELETE FROM users; DELETE FROM invitations;");
      for (const user of Object.values(config.users ?? {})) this.upsertUser(user);
      for (const invitation of config.invitations ?? []) this.upsertInvitation(invitation);
    });
  }
  transaction<T>(callback: () => T): T {
    return this.db.transaction(() => {
      const result = callback();
      if (result instanceof Promise) throw new Error("Storage transactions must be synchronous");
      return result;
    }).immediate();
  }
  close(): void { if (this.db.open) this.db.close(); }
}
