import Database from "better-sqlite3";
import { ConfigService } from "@nestjs/config";
import fs from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createHash } from "crypto";
import { InstanceRepository } from "./instance.repository";
import { createInstanceRepository } from "./storage.module";
import { InstanceConfigService } from "../user/instance-config.service";

const user = { token: "account-token", phone: "+111", sessionString: "private-session", telegramId: "42", selectedChannels: ["123"] };
const invitation = {
  id: "invitation", secretHash: createHash("sha256").update("secret").digest("hex"),
  createdAt: 1, expiresAt: Date.now() + 86400000,
};

describe.each(["json", "sqlite"])("InstanceRepository (%s)", driver => {
  let directory: string;
  const opened: InstanceRepository[] = [];
  let config: ConfigService;
  function open(): InstanceRepository {
    const repository = createInstanceRepository(config);
    opened.push(repository);
    return repository;
  }
  beforeEach(() => {
    directory = fs.mkdtempSync(join(tmpdir(), "streamgram-storage-"));
    config = new ConfigService({ storage: { driver, dataDir: directory } });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    opened.splice(0).forEach(repository => repository.close());
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("persists settings, accounts and invitations across reopening with detached reads", () => {
    const repository = open();
    repository.transaction(() => {
      repository.replaceSettings({ publicUrl: "https://example.com", adminProtection: false });
      repository.upsertUser(user);
      repository.upsertInvitation(invitation);
    });
    const read = repository.getUser(user.token);
    if (!read) throw new Error("Missing account");
    read.sessionString = "modified";
    repository.getUsers()[user.token].selectedChannels?.push("456");
    repository.getInvitations()[0].usedAt = 1;
    expect(repository.findUserByPhone(user.phone)).toEqual(user);
    expect(repository.findUserByIdentity("42", "+999")).toEqual(user);
    expect(repository.findUserByIdentity("43", user.phone)).toBeNull();
    const legacyUser = { token: "legacy-token", phone: "+1 (222)", sessionString: "legacy" };
    repository.upsertUser(legacyUser);
    expect(repository.findUserByIdentity("123", "+1222")).toEqual(legacyUser);
    repository.deleteUser(legacyUser.token);
    expect(repository.findInvitationByHash(invitation.secretHash)).toEqual(invitation);
    repository.close();
    const restarted = open();
    expect(restarted.getSettings().publicUrl).toBe("https://example.com");
    expect(restarted.getUser(user.token)).toEqual(user);
    expect(restarted.getInvitation(invitation.id)).toEqual(invitation);
    restarted.deleteUser(user.token);
    restarted.deleteInvitation(invitation.id);
    expect(restarted.getUser(user.token)).toBeNull();
    expect(restarted.getInvitation(invitation.id)).toBeNull();
  });

  it("rolls back every entity after a failed transaction", () => {
    const repository = open();
    repository.upsertInvitation(invitation);
    expect(() => repository.transaction(() => {
      repository.replaceSettings({ managementInitialized: true });
      repository.upsertUser(user);
      repository.upsertInvitation({ ...invitation, usedAt: 1 });
      throw new Error("write failed");
    })).toThrow("write failed");
    expect(repository.getSettings()).toEqual({});
    expect(repository.getUsers()).toEqual({});
    expect(repository.getInvitation(invitation.id)).toEqual(invitation);
    repository.close();
    expect(open().getUsers()).toEqual({});
  });

  it("replaces snapshots atomically and removes previous entities", () => {
    const repository = open();
    repository.upsertUser(user);
    repository.upsertInvitation(invitation);
    repository.replaceSnapshot({ users: {}, invitations: [], preferredLanguage: "ar" });
    expect(repository.snapshot()).toEqual({ users: {}, invitations: [], preferredLanguage: "ar" });
  });

  it("does not advance the security revision when persistence fails", async () => {
    const repository = open();
    const service = new InstanceConfigService(config, repository);
    jest.spyOn(repository, "replaceSettings").mockImplementation(() => { throw new Error("disk full"); });
    await expect(service.initialize({ adminPassword: "test-password" })).rejects.toThrow("disk full");
    expect(service.securityRevision).toBe(0);
    expect(service.isManagementInitialized()).toBe(false);
  });

  it("exports a standalone backup in the selected backend format", () => {
    const repository = open();
    repository.upsertUser(user);
    const backup = repository.exportBackup();
    expect(backup.extension).toBe(driver);
    repository.deleteUser(user.token);
    if (driver === "sqlite") {
      expect(backup.contentType).toBe("application/vnd.sqlite3");
      expect(backup.data.subarray(0, 16).toString()).toBe("SQLite format 3\0");
      expect(repository.readDatabaseBackup(backup.data).users?.[user.token]).toEqual(user);
    } else {
      expect(backup.contentType).toBe("application/json");
      expect(JSON.parse(backup.data.toString()).users[user.token]).toEqual(user);
      expect(() => repository.readDatabaseBackup(backup.data)).toThrow("STORAGE_DRIVER=sqlite");
    }
  });

  it("keeps storage files and directories private", () => {
    open().upsertUser(user);
    const filename = driver === "sqlite" ? "config.sqlite" : "config.json";
    expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
    expect(fs.statSync(join(directory, filename)).mode & 0o777).toBe(0o600);
  });
});

describe("SQLite database backups", () => {
  let directory: string;
  let repository: InstanceRepository;
  let service: InstanceConfigService;
  beforeEach(() => {
    directory = fs.mkdtempSync(join(tmpdir(), "streamgram-database-backup-"));
    const config = new ConfigService({ storage: { driver: "sqlite", dataDir: directory } });
    repository = createInstanceRepository(config);
    service = new InstanceConfigService(config, repository);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  it("restores database data while preserving current admin security", async () => {
    repository.replaceSettings({ adminPasswordHash: "foreign-hash", preferredLanguage: "ar" });
    repository.upsertUser(user);
    repository.upsertInvitation(invitation);
    const backup = service.exportBackup().data;
    repository.replaceSnapshot({});
    await service.initialize({ adminPassword: "current-password" });
    const hash = repository.getSettings().adminPasswordHash;
    service.createInvitation();
    const revision = service.securityRevision;
    await service.importBackup(backup);
    expect(repository.getSettings().adminPasswordHash).toBe(hash);
    expect(service.verifyAdminPassword("current-password")).toBe(true);
    expect(service.isManagementInitialized()).toBe(true);
    expect(service.getUserByToken(user.token)).toEqual(user);
    expect(service.getConfig().preferredLanguage).toBe("ar");
    expect(service.getInvitations()).toEqual([]);
    expect(service.securityRevision).toBe(revision + 1);
  });
  it("rejects corrupt or incompatible databases without changing the live store", async () => {
    repository.upsertUser(user);
    const before = service.exportRaw();
    const revision = service.securityRevision;
    await expect(service.importBackup(Buffer.from("invalid database"))).rejects.toThrow("SQLite backup");
    const incompatible = new Database(service.exportBackup().data);
    incompatible.pragma("user_version = 99");
    await expect(service.importBackup(incompatible.serialize())).rejects.toThrow("SQLite backup");
    incompatible.close();
    const unrelated = new Database(":memory:");
    unrelated.exec("CREATE TABLE unrelated (id INTEGER)");
    await expect(service.importBackup(unrelated.serialize())).rejects.toThrow("SQLite backup");
    unrelated.close();
    expect(service.exportRaw()).toBe(before);
    expect(service.securityRevision).toBe(revision);
  });
  it("rejects invalid account data even inside a valid database", async () => {
    repository.upsertUser(user);
    const invalid = new Database(service.exportBackup().data);
    invalid.prepare("UPDATE users SET payload = ?").run(JSON.stringify({ ...user, token: "different-token" }));
    await expect(service.importBackup(invalid.serialize())).rejects.toThrow("SQLite backup");
    invalid.close();
    expect(service.getUserByToken(user.token)).toEqual(user);
  });
});

describe("SQLite account column migration", () => {
  let directory: string;
  let repository: InstanceRepository | undefined;
  beforeEach(() => { directory = fs.mkdtempSync(join(tmpdir(), "streamgram-user-schema-")); });
  afterEach(() => {
    repository?.close();
    repository = undefined;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  function legacyDatabase(account: unknown = user) {
    const db = new Database(join(directory, "config.sqlite"));
    db.exec(`
      CREATE TABLE settings (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE users (token TEXT PRIMARY KEY, phone TEXT NOT NULL, normalized_phone TEXT NOT NULL, telegram_id TEXT, payload TEXT NOT NULL);
      CREATE TABLE invitations (id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE storage_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO settings VALUES (1, '{}');
      INSERT INTO storage_metadata VALUES ('initialized', 'true');
      PRAGMA user_version = 1;
    `);
    db.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?)").run(user.token, user.phone, "111", user.telegramId, JSON.stringify(account));
    db.prepare("INSERT INTO invitations VALUES (?, ?, ?)").run(invitation.id, invitation.secretHash, JSON.stringify(invitation));
    return db;
  }
  it("backfills queryable columns and preserves unknown creation dates on a version 1 database", () => {
    const account = { ...user, blocked: true, selectedFolders: [1, 2], selectedChannels: ["-100123"] };
    const db = legacyDatabase(account);
    const v1Backup = db.serialize();
    db.close();
    repository = createInstanceRepository(new ConfigService({ storage: { driver: "sqlite", dataDir: directory } }));
    expect(repository.getUser(user.token)).toEqual(account);
    const inspection = new Database(join(directory, "config.sqlite"), { readonly: true });
    expect(inspection.pragma("user_version", { simple: true })).toBe(2);
    expect(inspection.prepare("SELECT created_at, blocked, selected_folders, selected_channels FROM users").get()).toEqual({
      created_at: null, blocked: 1, selected_folders: "[1,2]", selected_channels: '["-100123"]',
    });
    expect(inspection.prepare("SELECT created_at FROM invitations").get()).toEqual({ created_at: invitation.createdAt });
    inspection.close();
    expect(repository.readDatabaseBackup(v1Backup).users?.[user.token]).toEqual(account);
  });
  it("writes and reads creation dates, block state and catalogs through their SQL columns", () => {
    repository = createInstanceRepository(new ConfigService({ storage: { driver: "sqlite", dataDir: directory } }));
    repository.upsertUser({ ...user, createdAt: 1234, blocked: true, selectedFolders: [1] });
    const db = new Database(join(directory, "config.sqlite"));
    expect(db.prepare("SELECT created_at FROM users").get()).toEqual({ created_at: 1234 });
    db.prepare("UPDATE users SET blocked = 0, selected_channels = ?, selected_folders = ?").run('["-100999"]', '[2]');
    db.close();
    expect(repository.getUser(user.token)).toMatchObject({ createdAt: 1234, blocked: false, selectedFolders: [2], selectedChannels: ["-100999"] });
    expect(repository.readDatabaseBackup(repository.exportBackup().data).users?.[user.token]).toMatchObject({ createdAt: 1234, blocked: false, selectedFolders: [2], selectedChannels: ["-100999"] });
  });
  it("rolls back schema changes if legacy payload migration fails", () => {
    const db = legacyDatabase();
    db.prepare("UPDATE users SET payload = 'invalid JSON'").run();
    db.close();
    expect(() => createInstanceRepository(new ConfigService({ storage: { driver: "sqlite", dataDir: directory } }))).toThrow("Unable to initialize");
    const inspection = new Database(join(directory, "config.sqlite"));
    expect(inspection.pragma("user_version", { simple: true })).toBe(1);
    const columns = inspection.pragma("table_info(users)") as { name: string }[];
    expect(columns.map(column => column.name)).not.toContain("blocked");
    inspection.close();
  });
});

describe("Storage selection and SQLite migration", () => {
  let directory: string;
  const opened: InstanceRepository[] = [];
  function open(driver?: string) {
    const config = new ConfigService({ storage: { ...(driver ? { driver } : {}), dataDir: directory } });
    const repository = createInstanceRepository(config);
    opened.push(repository);
    return repository;
  }
  beforeEach(() => { directory = fs.mkdtempSync(join(tmpdir(), "streamgram-migration-")); });
  afterEach(() => {
    jest.restoreAllMocks();
    opened.splice(0).forEach(repository => repository.close());
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("defaults to JSON and rejects unknown drivers", () => {
    open().upsertUser(user);
    expect(fs.existsSync(join(directory, "config.json"))).toBe(true);
    expect(fs.existsSync(join(directory, "config.sqlite"))).toBe(false);
    expect(() => open("invalid")).toThrow("STORAGE_DRIVER");
  });

  it("imports once, preserving credentials and invitation states without changing JSON", () => {
    const source = {
      adminPasswordHash: "legacy-hash", users: { [user.token]: user },
      invitations: { legacy: { ...invitation, createdAt: new Date(1).toISOString(), usedAt: new Date(0).toISOString() } },
    };
    const original = JSON.stringify(source);
    fs.writeFileSync(join(directory, "config.json"), original);
    const repository = open("sqlite");
    expect(repository.getSettings()).toEqual({ adminPasswordHash: "legacy-hash", managementInitialized: true, adminProtection: true });
    expect(repository.getUser(user.token)).toEqual(user);
    expect(repository.getInvitation(invitation.id)?.usedAt).toBe(0);
    expect(fs.readFileSync(join(directory, "config.json"), "utf8")).toBe(original);
    repository.deleteUser(user.token);
    repository.close();
    expect(open("sqlite").getUsers()).toEqual({});
  });

  it("rejects duplicate invitation IDs without dropping source records", () => {
    const source = JSON.stringify({ invitations: [invitation, { ...invitation, usedAt: 1 }] });
    fs.writeFileSync(join(directory, "config.json"), source);
    expect(() => open("sqlite")).toThrow("Unable to read");
    expect(fs.readFileSync(join(directory, "config.json"), "utf8")).toBe(source);
  });

  it("does not import JSON added after the SQLite store was initialized empty", () => {
    open("sqlite").close();
    fs.writeFileSync(join(directory, "config.json"), JSON.stringify({ users: { [user.token]: user } }));
    expect(open("sqlite").getUsers()).toEqual({});
  });

  it("retries a failed migration after fixing the source without partial data", () => {
    fs.writeFileSync(join(directory, "config.json"), JSON.stringify({ users: { [user.token]: user, bad: { token: "bad" } } }));
    expect(() => open("sqlite")).toThrow();
    fs.writeFileSync(join(directory, "config.json"), JSON.stringify({ publicUrl: "https://fixed.example", users: {} }));
    const repository = open("sqlite");
    expect(repository.getUsers()).toEqual({});
    expect(repository.getSettings().publicUrl).toBe("https://fixed.example");
  });

  it("rolls back JSON state if atomic replacement fails", () => {
    const repository = open("json");
    repository.upsertInvitation(invitation);
    const before = fs.readFileSync(join(directory, "config.json"), "utf8");
    jest.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("disk full"); });
    expect(() => repository.transaction(() => {
      repository.upsertUser(user);
      repository.upsertInvitation({ ...invitation, usedAt: 1 });
    })).toThrow("disk full");
    expect(repository.getUsers()).toEqual({});
    expect(repository.getInvitation(invitation.id)?.usedAt).toBeUndefined();
    expect(fs.readFileSync(join(directory, "config.json"), "utf8")).toBe(before);
  });
});
