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

  it("keeps storage files and directories private", () => {
    open().upsertUser(user);
    const filename = driver === "sqlite" ? "config.sqlite" : "config.json";
    expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
    expect(fs.statSync(join(directory, filename)).mode & 0o777).toBe(0o600);
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
