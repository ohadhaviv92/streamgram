import { securityHeaders } from "../../common/middleware/security-headers";
import { PasswordResetService } from "./password-reset.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ConfigurationChecksService } from "../setup/configuration-checks.service";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createHash } from "crypto";
import { RequestValidationPipe } from "../../common/pipes/request-validation.pipe";
import { StreamHandlerService } from "../stream/stream-handler.service";
import { LiveService } from "../stream/live.service";
import { AppModule } from "../../app.module";
import { InstanceConfigService } from "../user/instance-config.service";
import { TelegramClientManager } from "../telegram/telegram-client.manager";
import {
  TelegramNestService,
  PasswordRequiredError,
} from "../telegram/telegram.service";
import { ManagementService } from "./management.service";
import { AuthService } from "../auth/auth.service";
import { AuthOwner, PersistedInstanceConfig } from "../user/instance-profile";

const settings = {
  publicUrl: "http://localhost",
  apiId: 12345,
  apiHash: "test-api-hash",
  tmdbBearerToken: "test-tmdb",
  preferredLanguage: "en" as const,
};
let directory: string;
function instance(raw?: PersistedInstanceConfig) {
  if (raw) writeFileSync(join(directory, "config.json"), JSON.stringify(raw));
  return new InstanceConfigService({
    get: (key: string, fallback: unknown) =>
      key === "storage.dataDir" ? directory : fallback,
  } as ConfigService);
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "streamgram-test-"));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe("Persistence, passwords and invitations", () => {
  it("persists independent live selections through reconnect and backup restore", async () => {
    const config = instance();
    const a = config.completeAuthentication({ kind: "admin", id: "admin" }, "+11111", "1", "session-a");
    const b = config.completeAuthentication({ kind: "admin", id: "admin" }, "+22222", "2", "session-b");
    expect(config.getUserByToken(a.token)?.selectedLiveChannels).toBeUndefined();
    await config.updateUserSelections(a.token, { selectedChannels: ["123"], selectedLiveChannels: ["-1001981952129"] });
    config.completeAuthentication({ kind: "user", id: a.token }, "+11111", "1", "replacement-session");
    expect(instance().getUserByToken(a.token)?.selectedLiveChannels).toEqual(["-1001981952129"]);
    expect(config.getUserByToken(b.token)?.selectedLiveChannels).toBeUndefined();
    const backup = JSON.parse(config.exportRaw());
    await config.updateUserSelections(a.token, { selectedLiveChannels: [] });
    await config.importRaw(backup);
    expect(config.getUserByToken(a.token)).toMatchObject({ selectedChannels: ["123"], selectedLiveChannels: ["-1001981952129"], sessionString: "replacement-session" });
    const bad = JSON.parse(config.exportRaw());
    bad.users[a.token].selectedLiveChannels = ["https://example.test/stream"];
    await expect(config.importRaw(bad)).rejects.toThrow();
    expect(config.getUserByToken(a.token)?.selectedLiveChannels).toEqual(["-1001981952129"]);
  });
  it("fills unnamed accounts from Telegram and preserves custom and invitation names", () => {
    const config = instance();
    const owner: AuthOwner = { kind: "admin", id: "admin" };
    const user = config.completeAuthentication(owner, "+11111", "1", "session", "  Telegram Name  ");
    expect(user.name).toBe("Telegram Name");
    expect(instance().getUserByToken(user.token)?.name).toBe("Telegram Name");
    config.updatePersonal(user.token, { name: "Custom name" });
    expect(config.completeAuthentication(owner, "+11111", "1", "new-session", "New Telegram Name").name)
      .toBe("Custom name");
    config.updatePersonal(user.token, { name: "" });
    expect(config.completeAuthentication(owner, "+11111", "1", "new-session", "New Telegram Name").name)
      .toBe("New Telegram Name");
    const invite = config.createInvitation("Invitation name");
    expect(config.completeAuthentication({ kind: "invitation", id: invite.id }, "+22222", "2", "session", "Telegram Name").name)
      .toBe("Invitation name");
    expect(config.completeAuthentication(owner, "+33333", "3", "session").name).toBeUndefined();
  });
  it("inherits the server search language until explicitly changed and preserves the choice on reconnect", async () => {
    const config = instance();
    await config.update({ ...settings, preferredLanguage: "he" }, true);
    const owner: AuthOwner = { kind: "admin", id: "admin" };
    const user = config.completeAuthentication(owner, "+11111", "1", "session");
    expect(user.language).toBeUndefined();
    expect(config.getProfile(user.token).language).toBe("he");
    await config.update({ preferredLanguage: "ru" });
    expect(config.getProfile(user.token).language).toBe("ru");
    config.updatePersonal(user.token, { language: "es" });
    const reconnected = config.completeAuthentication(
      { kind: "user", id: user.token }, "+11111", "1", "new-session",
    );
    expect(reconnected.language).toBe("es");
    expect(instance().getProfile(user.token).language).toBe("es");
    config.updatePersonal(user.token, { language: null });
    expect(config.getProfile(user.token).language).toBe("ru");
  });
  it("records creation time through both account creation paths and preserves it on reconnect and restore", async () => {
    const config = instance();
    const clock = jest.spyOn(Date, "now").mockReturnValue(1700000000000);
    try {
      const phoneUser = await config.createOrUpdateUser("+11111", "session-a");
      const authUser = config.completeAuthentication(
        { kind: "admin", id: "admin" }, "+22222", "2", "session-b",
      );
      expect(phoneUser.createdAt).toBe(1700000000000);
      expect(authUser.createdAt).toBe(1700000000000);
      clock.mockReturnValue(1800000000000);
      expect((await config.createOrUpdateUser("+11111", "updated-a")).createdAt)
        .toBe(phoneUser.createdAt);
      expect(config.completeAuthentication(
        { kind: "user", id: authUser.token }, "+22222", "2", "updated-b",
      ).createdAt).toBe(authUser.createdAt);
      config.updatePersonal(authUser.token, { name: "Updated" });
      await config.updateUserSelections(authUser.token, { selectedFolders: [1] });
      const restarted = instance();
      expect(restarted.getUserByToken(authUser.token)?.createdAt).toBe(authUser.createdAt);
      await restarted.importRaw(JSON.parse(config.exportRaw()));
      expect(instance().getUserByToken(authUser.token)?.createdAt).toBe(authUser.createdAt);
    } finally {
      clock.mockRestore();
    }
  });
  it("keeps unknown legacy creation dates unknown after reconnect and import", async () => {
    const config = instance({ users: { legacytoken1: {
      token: "legacytoken1", phone: "+11111", sessionString: "legacy",
    } } });
    expect((await config.createOrUpdateUser("+11111", "updated")).createdAt).toBeUndefined();
    expect(config.completeAuthentication(
      { kind: "admin", id: "admin" }, "+11111", "1", "updated",
    ).createdAt).toBeUndefined();
    await config.importRaw(JSON.parse(config.exportRaw()));
    expect(instance().getUserByToken("legacytoken1")?.createdAt).toBeUndefined();
  });
  it.each([-1, 1.5, "2026-01-01", 8640000000000001])(
    "rejects an invalid account creation timestamp: %j", async (createdAt) => {
      const config = instance();
      const original = config.exportRaw();
      await expect(config.importRaw({ users: { validtoken12: {
        token: "validtoken12", phone: "+11111", sessionString: "session", createdAt,
      } } } as PersistedInstanceConfig)).rejects.toThrow();
      expect(config.exportRaw()).toBe(original);
    },
  );
  it("does not reopen setup when a legacy users map is empty", () => {
    const config = instance({ users: {} });
    expect(config.isManagementInitialized()).toBe(true);
    expect(config.isProtected()).toBe(false);
  });
  it("requires a password by default and initializes once", async () => {
    const c = instance();
    await expect(c.initialize(settings)).rejects.toThrow("password");
    expect(c.isManagementInitialized()).toBe(false);
    await c.initialize({ ...settings, adminPassword: "test-password" });
    expect(c.isProtected()).toBe(true);
    expect(c.isManagementInitialized()).toBe(true);
    await expect(c.initialize(settings)).rejects.toThrow("already initialized");
  });
  it("rejects a concurrent initialization", async () => {
    const c = instance();
    const results = await Promise.allSettled([
      c.initialize({ ...settings, adminPassword: "test-password" }),
      c.initialize({ ...settings, adminProtection: false }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(c.isProtected()).toBe(true);
  });
  it("migrates legacy protection and upgrades a verified SHA256 password", () => {
    const hash = createHash("sha256").update("old-password").digest("hex");
    const c = instance({ adminPasswordHash: hash });
    expect(c.isManagementInitialized()).toBe(true);
    expect(c.isProtected()).toBe(true);
    expect(c.verifyAdminPassword("incorrect")).toBe(false);
    expect(c.verifyAdminPassword("old-password")).toBe(true);
    expect(JSON.parse(c.exportRaw()).adminPasswordHash).toMatch(/^scrypt\$/);
  });
  it("keeps legacy installations without passwords unprotected even after deleting every account", () => {
    const c = instance({
      users: {
        legacytoken1: {
          token: "legacytoken1",
          phone: "+11111",
          sessionString: "legacy",
        },
      },
    });
    expect(c.isProtected()).toBe(false);
    c.deleteUser("legacytoken1");
    expect(c.isManagementInitialized()).toBe(true);
    expect(instance().isManagementInitialized()).toBe(true);
  });
  it("preserves blank secrets and refuses protection without a password", async () => {
    const c = instance();
    await c.initialize({ ...settings, adminProtection: false });
    await c.update({ apiHash: "", tmdbBearerToken: "", adminPassword: "" });
    expect(c.getConfig().telegram.apiHash).toBe(settings.apiHash);
    expect(c.getConfig().tmdb.bearerToken).toBe(settings.tmdbBearerToken);
    await expect(c.update({ adminProtection: true })).rejects.toThrow(
      "password",
    );
  });
  it("uses salted hashes and preserves a saved password on blank input", async () => {
    const c = instance();
    await c.initialize({ ...settings, adminPassword: "test-password" });
    const first = JSON.parse(c.exportRaw()).adminPasswordHash;
    await c.update({ adminPassword: "" });
    expect(JSON.parse(c.exportRaw()).adminPasswordHash).toBe(first);
    await c.update({ adminPassword: "test-password" });
    expect(JSON.parse(c.exportRaw()).adminPasswordHash).not.toBe(first);
  });
  it.each(["he", "es"] as const)("keeps %s personal language and catalogs isolated and supports inheritance", async (language) => {
    const c = instance();
    await c.initialize({ ...settings, adminProtection: false });
    const a = c.completeAuthentication(
        { kind: "admin", id: "a" },
        "+11111",
        "1",
        "session-a",
      ),
      b = c.completeAuthentication(
        { kind: "admin", id: "a" },
        "+22222",
        "2",
        "session-b",
      );
    c.updatePersonal(a.token, { language, name: "Alice" });
    await c.updateUserSelections(a.token, {
      selectedFolders: [1],
      selectedChannels: ["2"],
    });
    expect(c.getProfile(a.token).language).toBe(language);
    expect(c.getProfile(b.token).language).toBe("en");
    expect(c.getUserByToken(b.token)?.selectedFolders).toBeUndefined();
    expect(c.getConfig().preferredLanguage).toBe("en");
    c.updatePersonal(a.token, { language: null });
    expect(c.getProfile(a.token).language).toBe("en");
    expect(() => c.getProfile()).toThrow();
    expect(() => c.getProfile("invalid")).toThrow();
    expect(c.getUserByToken("constructor")).toBeNull();
  });
  it("reconnects only the same identity, retaining token, name, language, catalogs", async () => {
    const c = instance();
    await c.initialize({ ...settings, adminProtection: false });
    const a = c.completeAuthentication(
      { kind: "admin", id: "a" },
      "+11111",
      "1",
      "old",
    );
    c.updatePersonal(a.token, { name: "Alice", language: "ru" });
    await c.updateUserSelections(a.token, { selectedChannels: ["123"] });
    expect(() =>
      c.completeAuthentication(
        { kind: "user", id: a.token },
        "+22222",
        "2",
        "bad",
      ),
    ).toThrow("same Telegram");
    const reconnected = c.completeAuthentication(
      { kind: "user", id: a.token },
      "+11111",
      "1",
      "new",
    );
    expect(reconnected).toMatchObject({
      token: a.token,
      name: "Alice",
      language: "ru",
      selectedChannels: ["123"],
      sessionString: "new",
    });
  });
  it("stores only invite hashes and survives restart", () => {
    const c = instance();
    const invite = c.createInvitation();
    expect(c.exportRaw()).not.toContain(invite.secret);
    expect(instance().validateInvitation(invite.secret).id).toBe(invite.id);
    expect(c.getInvitations()[0]).not.toHaveProperty("secretHash");
    expect(invite.expiresAt - invite.createdAt).toBe(7 * 86400000);
  });
  it("persists invitation names and deletes used records while retaining accounts", () => {
    const c = instance();
    const invite = c.createInvitation("  Alice  ");
    const active = c.createInvitation();
    expect(instance().validateInvitation(invite.secret).name).toBe("Alice");
    const user = c.completeAuthentication(
      { kind: "invitation", id: invite.id }, "+11111", "1", "s",
    );
    expect(user.name).toBe("Alice");
    const users = c.getUsers();
    expect(() => c.deleteUsedInvitation(active.id)).toThrow("Only used");
    expect(() => c.deleteUsedInvitation("missing")).toThrow("not found");
    c.deleteUsedInvitation(invite.id);
    const restarted = instance();
    expect(restarted.getInvitations().map((i) => i.id)).toEqual([active.id]);
    expect(restarted.getUsers()).toEqual(users);
    expect(() => restarted.validateInvitation(invite.secret)).toThrow("not found");
  });
  it.each(["expired", "revoked", "used"])(
    "rejects %s invitations",
    (status) => {
      const c = instance();
      const invite = c.createInvitation();
      if (status === "expired")
        jest.spyOn(Date, "now").mockReturnValue(invite.expiresAt + 1);
      if (status === "revoked") c.revokeInvitation(invite.id);
      if (status === "used")
        c.completeAuthentication(
          { kind: "invitation", id: invite.id },
          "+11111",
          "1",
          "s",
        );
      expect(() => c.validateInvitation(invite.secret)).toThrow(status);
      jest.restoreAllMocks();
    },
  );
  it("allows exactly one concurrent invite completion and deduplicates identities", async () => {
    const c = instance();
    const invite = c.createInvitation();
    const owner: AuthOwner = { kind: "invitation", id: invite.id };
    const results = await Promise.allSettled(
      [1, 2].map((i) =>
        Promise.resolve().then(() =>
          c.completeAuthentication(owner, `+1111${i}`, String(i), "s"),
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(Object.keys(c.getUsers())).toHaveLength(1);
    const existing = Object.values(c.getUsers())[0];
    const second = c.createInvitation();
    const result = c.completeAuthentication(
      { kind: "invitation", id: second.id },
      existing.phone,
      existing.telegramId ?? "",
      "new",
    );
    expect(result.token).toBe(existing.token);
    expect(Object.keys(c.getUsers())).toHaveLength(1);
    expect(() => c.validateInvitation(second.secret)).toThrow("used");
  });
  it("rolls back memory if the atomic file replacement fails", () => {
    const c = instance();
    const invite = c.createInvitation();
    const spy = jest
      .spyOn(
        c as unknown as { writePersistedConfig(): void },
        "writePersistedConfig",
      )
      .mockImplementation(() => {
        throw new Error("disk full");
      });
    expect(() =>
      c.completeAuthentication(
        { kind: "invitation", id: invite.id },
        "+11111",
        "1",
        "s",
      ),
    ).toThrow("disk full");
    spy.mockRestore();
    expect(Object.keys(c.getUsers())).toHaveLength(0);
    expect(c.validateInvitation(invite.secret).id).toBe(invite.id);
  });
  it.each(["ar", "es"] as const)("restores %s preferences but preserves admin security and invalidates invitations", async (language) => {
    const c = instance();
    await c.initialize({ ...settings, adminPassword: "current-password" });
    c.createInvitation();
    const revision = c.securityRevision;
    await c.importRaw({
      users: {
        restoretoken1: {
          token: "restoretoken1",
          phone: "+12345",
          sessionString: "restored",
          language,
          selectedFolders: [1],
          selectedChannels: ["2"],
        },
      },
      adminPasswordHash: "foreign",
      adminProtection: false,
    });
    expect(c.verifyAdminPassword("current-password")).toBe(true);
    expect(c.isProtected()).toBe(true);
    expect(c.getInvitations()).toEqual([]);
    expect(c.securityRevision).toBeGreaterThan(revision);
    expect(c.getProfile("restoretoken1").language).toBe(language);
    expect(
      JSON.parse(readFileSync(join(directory, "config.json"), "utf8")).users
        .restoretoken1.language,
    ).toBe(language);
  });
  it.each([
    { users: { bad: { token: "other", phone: "1", sessionString: "s" } } },
    {
      users: {
        validtoken12: {
          token: "validtoken12",
          phone: "1",
          sessionString: "s",
          language: "xx",
        },
      },
    },
    {
      users: {
        validtoken12: {
          token: "validtoken12",
          phone: "1",
          sessionString: "s",
          selectedFolders: ["x"],
        },
      },
    },
    { unexpected: true },
  ])(
    "rejects malformed backups without changing configuration",
    async (payload) => {
      const c = instance();
      const original = c.exportRaw();
      await expect(
        c.importRaw(payload as PersistedInstanceConfig),
      ).rejects.toThrow();
      expect(c.exportRaw()).toBe(original);
    },
  );
});

describe("HTTP management and personal access", () => {
  let app: INestApplication,
    config: InstanceConfigService,
    base: string,
    cookie: string;
  const clients = {
    removeClient: jest.fn().mockResolvedValue(undefined),
    disconnectAll: jest.fn().mockResolvedValue(undefined),
    getActiveClientCount: () => 0,
    getOrInitializeClient: jest.fn(),
  };
  const telegram = {
    checkTelegramConnection: jest.fn().mockResolvedValue(true),
    getUserFolders: jest.fn().mockResolvedValue([]),
    getUserChannels: jest.fn().mockResolvedValue([]),
    getCacheStats: () => ({}),
    clearCache: async () => true,
    sendAuthCode: jest.fn(),
    verifyAuthCode: jest.fn(),
    exportLoginToken: jest.fn(),
    checkLoginToken: jest.fn(),
    getClientForUser: async () => ({}),
    createStreamSession: () => new AbortController(),
    releaseStreamSession: async () => undefined,
    preparePlayback: async () => ({ client: {}, message: {} }),
    hasStreamableMedia: () => true,
    getFileSize: () => 10,
    getContentType: () => "video/mp4",
    streamMessageRange: async function* () {
      yield Buffer.from("2345");
    },
  };
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      redirect: "manual",
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return {
      status: response.status,
      data,
      cookie: response.headers.get("set-cookie"),
      location: response.headers.get("location"),
      retryAfter: response.headers.get("retry-after"),
    };
  }
  beforeEach(async () => {
    config = instance();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(InstanceConfigService)
      .useValue(config)
      .overrideProvider(TelegramNestService)
      .useValue(telegram)
      .overrideProvider(TelegramClientManager)
      .useValue(clients)
      .compile();
    app = module.createNestApplication({ logger: false });
    app.use(securityHeaders);
    app.useGlobalPipes(new RequestValidationPipe());
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
    const initialized = await request("/setup/initialize", "POST", {
      adminPassword: "test-password",
    });
    cookie = (initialized.cookie ?? "").split(";")[0];
    // The wizard establishes protection before reading or saving instance credentials.
    expect((await request("/setup/admin-status")).status).toBe(401);
    const configured = await request(
      "/setup/config",
      "POST",
      { ...settings, publicUrl: base },
      { cookie },
    );
    expect(configured.status).toBe(200);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });
  it("guards live selections and routes the separate Live TV catalog without video-file searches", async () => {
    const a = config.completeAuthentication({ kind: "admin", id: "admin" }, "+11111", "1", "session-a");
    const b = config.completeAuthentication({ kind: "admin", id: "admin" }, "+22222", "2", "session-b");
    const channelId = "-1001981952129";
    const headers = { authorization: `Bearer ${a.token}` };
    expect((await request("/live-channels")).status).toBe(401);
    expect((await request("/live-channels", "POST", { channelIds: [channelId] })).status).toBe(401);
    telegram.getUserChannels.mockResolvedValueOnce([{ id: channelId, title: "Live TV" }, { id: "123", title: "User" }]);
    expect((await request("/live-channels", "GET", undefined, headers)).data.channels).toEqual([{ id: channelId, title: "Live TV", isSelected: false }]);
    for (const channelIds of [["-1981952129"], [channelId, channelId], [123], ["https://example.test"]]) {
      expect((await request("/live-channels", "POST", { channelIds }, headers)).status).toBe(400);
    }
    expect((await request("/live-channels", "POST", { channelIds: [channelId], selectedChannels: [] }, headers)).status).toBe(400);
    expect((await request("/live-channels", "POST", { channelIds: [channelId] }, { ...headers, origin: "https://evil.example" })).status).toBe(403);
    telegram.getUserChannels.mockResolvedValueOnce([{ id: channelId, title: "Live TV" }]);
    expect((await request("/live-channels", "POST", { channelIds: [channelId] }, headers)).status).toBe(200);
    expect(config.getUserByToken(a.token)?.selectedLiveChannels).toEqual([channelId]);
    expect(config.getUserByToken(b.token)?.selectedLiveChannels).toBeUndefined();
    const manifest = await request(`/${a.token}/manifest.json`);
    expect(manifest.data.catalogs).toContainEqual({ id: "telegram_live", type: "tv", name: "StreamGram — Live TV" });
    expect(manifest.data.catalogs).toContainEqual({ id: "telegram_channels", type: "movie", name: "StreamGram — Channels" });
    expect(manifest.data.catalogs).toContainEqual({ id: "telegram_folders", type: "series", name: "StreamGram — Folders" });
    expect(manifest.data.types).toContain("tv");
    expect(manifest.data.idPrefixes).toContain("tg_live_");
    const catalog = await request(`/${a.token}/catalog/tv/telegram_live.json`);
    expect(catalog.data.metas).toHaveLength(1);
    expect(catalog.data.metas[0].id).toBe(`tg_live_${channelId}`);
    expect(catalog.data.metas[0].type).toBe("tv");
    expect(catalog.data.metas[0].behaviorHints.isLive).toBe(true);
    expect((await request(`/${a.token}/meta/tv/tg_live_${channelId}.json`)).data.meta.type).toBe("tv");
    const legacy = await request(`/${a.token}/catalog/movie/telegram_live.json`);
    expect(legacy.data.metas[0].type).toBe("movie");
    expect((await request(`/${a.token}/meta/movie/tg_live_${channelId}.json`)).data.meta.type).toBe("movie");
    expect((await request(`/${a.token}/catalog/series/telegram_live.json`)).status).toBe(404);
    expect((await request(`/${b.token}/catalog/movie/telegram_live.json`)).data).toEqual({ metas: [] });
    expect((await request(`/${b.token}/meta/movie/tg_live_${channelId}.json`)).data).toEqual({ meta: null });
    expect((await request(`/${a.token}/stream/movie/tg_live_${channelId}.json`)).data).toEqual({ streams: [] });
    const liveStreams = { streams: [{ name: "Live", title: "Live", url: `${base}/live.m3u8`, behaviorHints: { notWebReady: true } }] };
    const streams = jest.spyOn(app.get(LiveService), "streams").mockResolvedValueOnce(liveStreams);
    expect((await request(`/${a.token}/stream/tv/tg_live_${channelId}.json`)).data).toEqual(liveStreams);
    expect(streams).toHaveBeenCalledWith(expect.objectContaining({ token: a.token }), channelId, `${base}/${a.token}`);
    expect((await request(`/${a.token}/stream/series/tg_live_${channelId}.json`)).data).toEqual({ streams: [] });
    expect((await request(`/${b.token}/live/${channelId}/index.m3u8`)).status).toBe(404);
    expect((await request(`/unknown-account/live/${channelId}/index.m3u8`)).status).toBe(401);
    expect((await request("/live-channels", "POST", { channelIds: [] }, headers)).status).toBe(200);
  });
  it("serves private live channel thumbnails and falls back when a channel has no photo", async () => {
    const account = config.completeAuthentication({ kind: "admin", id: "admin" }, "+11111", "1", "session-a");
    const channelId = "-1001981952129";
    await config.updateUserSelections(account.token, { selectedLiveChannels: [channelId] });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    jest.spyOn(app.get(LiveService), "thumbnail").mockResolvedValueOnce(jpeg).mockResolvedValueOnce(null);
    const path = `/${account.token}/live/${channelId}/thumbnail.jpg`;
    const photo = await fetch(base + path);
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toContain("image/jpeg");
    expect(photo.headers.get("cache-control")).toBe("private, max-age=300");
    expect(Buffer.from(await photo.arrayBuffer())).toEqual(jpeg);
    const fallback = await request(path);
    expect(fallback.status).toBe(302);
    expect(fallback.location).toBe(`${base}/logo-icon-only.png`);
    expect((await request(`/unknown-account/live/${channelId}/thumbnail.jpg`)).status).toBe(401);
  });
  it.each([
    ["/admin/accounts", "GET"],
    ["/admin/notifications", "GET"],
    ["/admin/notifications", "PUT"],
    ["/admin/notifications/test", "POST"],
    ["/admin/notifications/recovery-test", "POST"],
    ["/setup/admin-status", "GET"],
    ["/setup/checks", "POST"],
    ["/setup/config", "POST"],
    ["/setup/config/export", "GET"],
    ["/setup/config/import", "POST"],
    ["/admin/invitations", "GET"],
    ["/admin/invitations", "POST"],
    ["/admin/invitations/id", "DELETE"],
    ["/admin/invitations/id/record", "DELETE"],
    ["/admin/accounts/token/name", "PUT"],
    ["/admin/accounts/token", "DELETE"],
    ["/cache/stats", "GET"],
    ["/cache/clear", "DELETE"],
    ["/auth/send-code", "POST"],
    ["/auth/qr/generate", "POST"],
  ])("guards direct %s %s calls", async (path, method) => {
    const result = await request(
      path,
      method,
      method === "POST" ? { phone: "+12345678" } : undefined,
    );
    expect([400, 401]).toContain(result.status);
    // Valid auth payloads reach the principal check; management guards run before DTO validation.
    if (!path.startsWith("/auth/qr")) expect(result.status).toBe(401);
  });
  it("prevents framing, inline dashboard scripts, and caching admin secrets", async () => {
    const page = await fetch(base);
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(page.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(page.headers.get("cache-control")).toBe("no-store");
    for (const path of ["/admin/accounts", "/admin/notifications", "/setup/config/export"]) {
      const result = await fetch(base + path, { headers: { cookie } });
      expect(result.status).toBe(200);
      expect(result.headers.get("cache-control")).toBe("no-store");
      await result.arrayBuffer();
    }
    // Unauthenticated requests must never retrieve a backup or notification credentials.
    const backup = await request("/setup/config/export");
    expect(backup.status).toBe(401);
    expect(JSON.stringify(backup.data)).not.toContain("adminPasswordHash");
  });
  it("blocks Fetch Metadata cross-site mutations even without an Origin header", async () => {
    for (const path of ["/admin/password-reset/request", "/admin/login", "/admin/notifications/test", "/setup/config/import"]) {
      expect((await request(path, "POST", {}, { cookie, "sec-fetch-site": "cross-site" })).status).toBe(403);
    }
  });
  it("protects public recovery mutations by origin and signs in after a reset", async () => {
    await config.update({ publicUrl: "https://stream.example" });
    config.updateNotificationSettings({ enabled: false, events: [], botToken: "123:secret", passwordRecoveryEnabled: true, chatId: "-10012345" });
    let resetToken = "";
    jest.spyOn(app.get(NotificationsService), "sendRecovery").mockImplementation(async (text: string) => {
      resetToken = /reset-password=([A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? "missing-token"; return true;
    });
    expect((await request("/admin/password-reset/request", "POST", undefined, { origin: "https://evil.example" })).status).toBe(403);
    const result = await request("/admin/password-reset/request", "POST");
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ success: true });
    expect(JSON.stringify(result.data)).not.toContain(resetToken);
    expect((await request("/admin/password-reset/complete", "POST", { token: resetToken, password: "new-password" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await request("/admin/password-reset/complete", "POST", { token: resetToken, password: "short" })).status).toBe(400);
    const completed = await request("/admin/password-reset/complete", "POST", { token: resetToken, password: "new-password" });
    expect(completed.status).toBe(200);
    const newCookie = (completed.cookie ?? "").split(";")[0];
    expect((await request("/admin/accounts", "GET", undefined, { cookie })).status).toBe(401);
    expect((await request("/admin/accounts", "GET", undefined, { cookie: newCookie })).status).toBe(200);
    expect((await request("/admin/password-reset/complete", "POST", { token: resetToken, password: "other-password" })).status).toBe(400);
    expect(app.get(PasswordResetService)).toBeDefined();
  });
  it("protects notification settings, validates inputs, and never returns the bot token", async () => {
    const user = await config.createOrUpdateUser("+12345678", "session");
    expect((await request("/admin/notifications", "GET", undefined, { authorization: `Bearer ${user.token}` })).status).toBe(401);
    const payload = { enabled: true, botToken: "123456:notification-secret", chatId: "-10012345", events: ["account_joined"] };
    expect((await request("/admin/notifications", "PUT", payload, { cookie, origin: "https://evil.example" })).status).toBe(403);
    expect((await request("/admin/notifications/test", "POST", undefined, { cookie, origin: "https://evil.example" })).status).toBe(403);
    expect((await request("/admin/notifications/test", "POST", undefined, { cookie })).status).toBe(400);
    expect((await request("/admin/notifications", "PUT", { ...payload, events: ["unknown"] }, { cookie })).status).toBe(400);
    const saved = await request("/admin/notifications", "PUT", payload, { cookie });
    expect(saved.status).toBe(200);
    expect(saved.data).toMatchObject({ enabled: true, botTokenConfigured: true });
    expect(JSON.stringify(saved.data)).not.toContain(payload.botToken);
    expect((await request("/admin/notifications", "PUT", { ...payload, botToken: "", enabled: false }, { cookie })).status).toBe(200);
    expect(config.getNotificationSettings().botToken).toBe(payload.botToken);
    const read = await request("/admin/notifications", "GET", undefined, { cookie });
    expect(JSON.stringify(read.data)).not.toContain(payload.botToken);
  });
  it("publishes deletion alerts for admin and personal deletion paths", async () => {
    const a = await config.createOrUpdateUser("+11111", "session");
    const b = await config.createOrUpdateUser("+22222", "session");
    const listener = jest.fn(); config.events.on("notification", listener);
    expect((await request(`/admin/accounts/${a.token}`, "DELETE", undefined, { cookie })).status).toBe(200);
    expect((await request(`/auth/logout/${b.token}`, "DELETE", undefined, { authorization: `Bearer ${b.token}` })).status).toBe(200);
    expect(listener.mock.calls.map(([event]) => event.type)).toEqual(["account_deleted", "account_deleted"]);
  });
  it("serves preview metadata before JavaScript, without exposing invitation tokens", async () => {
    const response = await fetch(`${base}/?invite=private-invitation`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain(`property="og:image" content="${base}/preview-logo-v1.png"`);
    expect(html).not.toContain("private-invitation");
    const image = await fetch(`${base}/preview-logo-v1.png`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toContain("image/png");
    const bytes = Buffer.from(await image.arrayBuffer());
    expect(bytes.readUInt32BE(16)).toBe(200);
    expect(bytes.readUInt32BE(20)).toBe(200);
  });
  it("creates named invitations and restricts account names to admins", async () => {
    const created = await request("/admin/invitations", "POST", { name: " Alice " }, { cookie });
    expect(created.status).toBe(201);
    const invite = created.data;
    const greeting = await request(`/invitations/${invite.secret}`);
    expect(greeting.data).toMatchObject({ valid: true, name: "Alice" });
    expect((await request("/admin/invitations", "POST", { name: "a".repeat(81) }, { cookie })).status).toBe(400);
    expect((await request("/admin/invitations", "POST", { name: 123 }, { cookie })).status).toBe(400);
    const user = config.completeAuthentication(
      { kind: "invitation", id: invite.id }, "+11111", "1", "session",
    );
    const personalHeaders = { authorization: `Bearer ${user.token}` };
    expect((await request("/settings", "GET", undefined, personalHeaders)).data).not.toHaveProperty("name");
    const adminSettings = await request("/settings", "GET", undefined, { ...personalHeaders, cookie });
    expect(adminSettings.data).toMatchObject({ canEditName: true, name: "Alice" });
    expect((await request("/name", "PUT", { name: "Alice updated" }, { ...personalHeaders, cookie })).status).toBe(200);
    expect(config.getUserByToken(user.token)?.name).toBe("Alice updated");
    expect((await request("/name", "PUT", { name: "Changed" }, personalHeaders)).status).toBe(401);
    expect((await request(`/admin/accounts/${user.token}/name`, "PUT", { name: "Changed" }, personalHeaders)).status).toBe(401);
    expect((await request(`/admin/accounts/${user.token}/name`, "PUT", { name: "Changed" }, { cookie, origin: "https://evil.example" })).status).toBe(403);
    expect((await request(`/admin/accounts/${user.token}/name`, "PUT", { name: "Changed" }, { cookie })).status).toBe(200);
    expect((await request("/admin/accounts", "GET", undefined, { cookie })).data[0])
      .toMatchObject({ name: "Changed", createdAt: user.createdAt });
    const path = `/admin/invitations/${invite.id}/record`;
    expect((await request(path, "DELETE", undefined, { cookie, origin: "https://evil.example" })).status).toBe(403);
    expect((await request(path, "DELETE", undefined, { cookie })).status).toBe(200);
    expect(config.getInvitations()).toEqual([]);
    expect(config.getUserByToken(user.token)?.name).toBe("Changed");
    expect((await request(`/invitations/${invite.secret}`)).status).toBe(404);
  });
  it("returns only a public process identifier from the HTTPS probe", async () => {
    const result = await request("/setup/probe");
    expect(result.status).toBe(200);
    expect(Object.keys(result.data)).toEqual(["instanceId"]);
    expect(result.data.instanceId).toBe(app.get(ConfigurationChecksService).probe().instanceId);
  });
  it("keeps saved values when advisory checks fail and separates checks from saves", async () => {
    const results = {
      checkedAt: new Date().toISOString(),
      telegram: { status: "passed" as const, message: "Telegram accepted the API ID and hash." },
      tmdb: { status: "failed" as const, message: "TMDB rejected the bearer token." },
      streamingHttps: { status: "failed" as const, message: "The public URL did not return this StreamGram instance." },
    };
    const check = jest.spyOn(app.get(ConfigurationChecksService), "check").mockResolvedValue(results);
    expect((await request("/setup/config", "POST", { publicUrl: "https://wrong.example" }, { cookie })).status).toBe(200);
    expect((await request("/setup/config", "POST", { adminPassword: "" }, { cookie })).status).toBe(200);
    expect(check).not.toHaveBeenCalled();
    const response = await request("/setup/checks", "POST", undefined, { cookie });
    expect(response.status).toBe(200);
    expect(response.data).toEqual(results);
    expect(config.getConfig().publicUrl).toBe("https://wrong.example");
    expect((await request("/setup/checks", "POST", undefined, { cookie, origin: "https://evil.example" })).status).toBe(403);
  });
  it("supports legacy password headers and session cookies", async () => {
    expect(
      (
        await request("/admin/accounts", "GET", undefined, {
          "x-admin-password": "test-password",
        })
      ).status,
    ).toBe(200);
    expect(
      (await request("/admin/accounts", "GET", undefined, { cookie })).status,
    ).toBe(200);
  });
  it("blocks both password entry points after five shared failures without blocking sessions", async () => {
    for (let i = 0; i < 4; i++) {
      const failed = i % 2 === 0
        ? await request("/admin/login", "POST", { password: "wrong" })
        : await request("/admin/accounts", "GET", undefined, { "x-admin-password": "wrong" });
      expect(failed.status).toBe(401);
    }
    const fifth = await request("/admin/login", "POST", { password: "wrong" });
    expect(fifth.status).toBe(429);
    expect(fifth.retryAfter).toBe("900");
    expect((await request("/admin/login", "POST", { password: "test-password" }, { "x-forwarded-for": "192.0.2.50" })).status).toBe(429);
    expect((await request("/setup/admin-status", "GET", undefined, { "x-admin-password": "test-password" })).status).toBe(429);
    expect((await request("/admin/accounts", "GET", undefined, { cookie })).status).toBe(200);
    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 15 * 60 * 1000 + 1);
    expect((await request("/admin/login", "POST", { password: "test-password" })).status).toBe(200);
  });
  it("accepts a text API ID and preserves saved credentials when their fields are blank", async () => {
    expect(
      (await request("/setup/config", "POST", { apiId: "123456" }, { cookie }))
        .status,
    ).toBe(200);
    expect(config.getConfig().telegram.apiId).toBe(123456);
    const saved = config.getConfig();
    expect(
      (
        await request(
          "/setup/config",
          "POST",
          { apiId: "   ", apiHash: "", tmdbBearerToken: "" },
          { cookie },
        )
      ).status,
    ).toBe(200);
    expect(config.getConfig()).toEqual(saved);
    const response = await request("/setup/admin-status", "GET", undefined, {
      cookie,
    });
    expect(response.data).toMatchObject({
      apiIdConfigured: true,
      apiIdPreview: "***456",
      apiHashPreview: "**********ash",
      tmdbTokenPreview: "******mdb",
    });
    expect(response.data).not.toHaveProperty("apiId");
  });
  it.each(["invalid", "****345", "1e3", "0", "9007199254740992"])(
    "rejects an invalid text API ID (%s) without changing the saved value",
    async (apiId) => {
      expect(
        (await request("/setup/config", "POST", { apiId }, { cookie })).status,
      ).toBe(400);
      expect(config.getConfig().telegram.apiId).toBe(settings.apiId);
    },
  );
  it("expires sessions after eight hours and invalidates logout", async () => {
    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 8 * 3600000 + 1);
    expect(
      (await request("/admin/accounts", "GET", undefined, { cookie })).status,
    ).toBe(401);
    jest.restoreAllMocks();
    const login = await request("/admin/login", "POST", {
      password: "test-password",
    });
    const next = (login.cookie ?? "").split(";")[0];
    expect(login.cookie).toMatch(/HttpOnly/);
    expect(login.cookie).toMatch(/SameSite=Strict/);
    await request("/admin/logout", "POST", {}, { cookie: next });
    expect(
      (await request("/admin/accounts", "GET", undefined, { cookie: next }))
        .status,
    ).toBe(401);
  });
  it("marks HTTPS sessions Secure", async () => {
    const result = await request(
      "/admin/login",
      "POST",
      { password: "test-password" },
      { "x-forwarded-proto": "https" },
    );
    expect(result.cookie).toContain("Secure");
  });
  it("allows unprotected management but still binds auth to a browser session", async () => {
    await config.update({ adminProtection: false });
    expect((await request("/admin/accounts")).status).toBe(200);
    expect((await request("/admin/session", "POST")).cookie).toMatch(
      /HttpOnly/,
    );
  });
  it("rejects cross-origin browser mutations including login", async () => {
    expect(
      (
        await request(
          "/setup/config",
          "POST",
          { preferredLanguage: "he" },
          { cookie, origin: "https://evil.example" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          "/admin/login",
          "POST",
          { password: "test-password" },
          { origin: "https://evil.example" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          "/setup/config",
          "POST",
          { preferredLanguage: "he" },
          { cookie, origin: base },
        )
      ).status,
    ).toBe(200);
  });
  it("exposes no private data in public status and closes bootstrap", async () => {
    const status = await request("/setup/status");
    expect(status.data).toEqual({
      managementInitialized: true,
      passwordRequired: true,
    });
    expect((await request("/setup/bootstrap")).status).toBe(403);
  });
  it("requires explicit personal tokens, scopes responses, rejects instance settings", async () => {
    const a = config.completeAuthentication(
        { kind: "admin", id: "a" },
        "+11111",
        "1",
        "session-a",
      ),
      b = config.completeAuthentication(
        { kind: "admin", id: "a" },
        "+22222",
        "2",
        "session-b",
      );
    config.updatePersonal(b.token, { name: "Other account" });
    expect(
      (await request("/settings", "GET", undefined, { cookie })).status,
    ).toBe(401);
    expect((await request("/settings?token=invalid")).status).toBe(401);
    const profile = await request("/settings", "GET", undefined, {
      authorization: `Bearer ${a.token}`,
      cookie,
    });
    expect(profile.status).toBe(200);
    expect(JSON.stringify(profile.data)).not.toMatch(/Other account|session-b/);
    expect(JSON.stringify(profile.data)).not.toContain(b.token);
    expect(
      (
        await request(
          "/settings",
          "PUT",
          { tmdbToken: "forbidden" },
          { authorization: `Bearer ${a.token}` },
        )
      ).status,
    ).toBe(400);
    expect(
      (await request("/settings?token=" + a.token, "PUT", { language: "he" }))
        .status,
    ).toBe(200);
    expect(config.getProfile(b.token).language).toBe("en");
    expect((await request("/settings?token=" + a.token, "PUT", { language: "es" })).status).toBe(200);
    expect(config.getProfile(a.token).language).toBe("es");
  });
  it("retains configure/manifest URLs and optional catalog installation", async () => {
    const a = config.completeAuthentication(
      { kind: "admin", id: "a" },
      "+11111",
      "1",
      "s",
    );
    const manifest = await request(`/${a.token}/manifest.json`);
    expect(manifest.status).toBe(200);
    expect(manifest.data.behaviorHints.configurationRequired).toBe(false);
    expect((await request(`/${a.token}/configure`)).location).toContain(
      `action=settings&token=${a.token}`,
    );
  });
  it("deletes only the selected account and never reopens setup", async () => {
    const a = config.completeAuthentication(
        { kind: "admin", id: "a" },
        "+11111",
        "1",
        "a",
      ),
      b = config.completeAuthentication(
        { kind: "admin", id: "a" },
        "+22222",
        "2",
        "b",
      );
    expect(
      (
        await request(`/auth/logout/${b.token}`, "DELETE", undefined, {
          authorization: `Bearer ${a.token}`,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(`/auth/logout/${a.token}`, "DELETE", undefined, {
          authorization: `Bearer ${a.token}`,
        })
      ).status,
    ).toBe(200);
    expect(clients.removeClient).toHaveBeenCalledWith(a.token);
    expect((await request(`/${a.token}/manifest.json`)).status).toBe(401);
    expect(config.getUserByToken(b.token)).toBeTruthy();
    await request(`/admin/accounts/${b.token}`, "DELETE", undefined, {
      cookie,
    });
    expect(config.isManagementInitialized()).toBe(true);
  });
  it("restoring a backup revokes browser sessions", async () => {
    expect(
      (await request("/setup/config/import", "POST", { users: {} }, { cookie }))
        .status,
    ).toBe(200);
    expect(
      (await request("/admin/accounts", "GET", undefined, { cookie })).status,
    ).toBe(401);
    expect(clients.disconnectAll).toHaveBeenCalled();
    expect(config.verifyAdminPassword("test-password")).toBe(true);
  });
  it.each([
    ["+1 (202) 555-0123", "+12025550123"],
    ["+44 7700 900123", "+447700900123"],
    ["0091 98765 43210", "+919876543210"],
    ["+972 50-123-4567", "+972501234567"],
    ["+55 (11) 91234-5678", "+5511912345678"],
    ["+81 90 1234 5678", "+819012345678"],
  ])(
    "accepts international phone formatting (%s)",
    async (phone, normalized) => {
      telegram.sendAuthCode.mockResolvedValue({
        phoneCodeHash: "hash",
        tempSessionString: "temp",
        isCodeViaApp: true,
      });
      const sent = await request(
        "/auth/send-code",
        "POST",
        { phone },
        { cookie },
      );
      expect(sent.status).toBe(200);
      expect(telegram.sendAuthCode).toHaveBeenLastCalledWith(normalized);
      telegram.verifyAuthCode.mockRejectedValueOnce(
        new PasswordRequiredError("password required"),
      );
      const verified = await request(
        "/auth/verify-code",
        "POST",
        { phone, code: "12345", attemptId: sent.data.attemptId },
        { cookie },
      );
      expect(verified.status).toBe(200);
      expect(verified.data.passwordRequired).toBe(true);
      expect(telegram.verifyAuthCode).toHaveBeenLastCalledWith(
        normalized,
        "12345",
        "hash",
        "temp",
        undefined,
        false,
      );
    },
  );
  it.each([
    "0501234567",
    "+1 202 CALL-NOW",
    "+44 7700 900123 ext 12",
    "+0123456",
    "+1234567890123456",
  ])(
    "rejects invalid phone numbers instead of guessing a country (%s)",
    async (phone) => {
      const before = telegram.sendAuthCode.mock.calls.length;
      expect(
        (await request("/auth/send-code", "POST", { phone }, { cookie }))
          .status,
      ).toBe(400);
      expect(telegram.sendAuthCode.mock.calls).toHaveLength(before);
    },
  );
  it.each(["phone", "qr"])("new %s accounts inherit the server language despite a different browser language", async (mode) => {
    await config.update({ preferredLanguage: "ru" });
    telegram.sendAuthCode.mockResolvedValue({ phoneCodeHash: "hash", tempSessionString: "temp" });
    telegram.verifyAuthCode.mockResolvedValue("session");
    telegram.exportLoginToken.mockResolvedValue({
      token: Buffer.from("qr"), tempSessionString: "temp",
      expires: Math.floor(Date.now() / 1000) + 60,
    });
    telegram.checkLoginToken.mockResolvedValue("session");
    clients.getOrInitializeClient.mockResolvedValue({ getMe: async () => ({ id: 1, phone: "11111" }) });
    const start = await request(
      mode === "phone" ? "/auth/send-code" : "/auth/qr/generate",
      "POST", mode === "phone" ? { phone: "+11111" } : {},
      { cookie, "accept-language": "he-IL" },
    );
    expect(start.status).toBe(200);
    const done = mode === "phone"
      ? await request("/auth/verify-code", "POST", { phone: "+11111", code: "12345", attemptId: start.data.attemptId }, { cookie })
      : await request(`/auth/qr/status/${start.data.qrToken}`, "GET", undefined, { cookie });
    expect(done.status).toBe(200);
    const token = done.data.user.token;
    expect(config.getUserByToken(token)?.language).toBeUndefined();
    expect(config.getProfile(token).language).toBe("ru");
    await config.update({ preferredLanguage: "ar" });
    expect(config.getProfile(token).language).toBe("ar");
  });
  it("binds phone attempts to owners, supports 2FA retry, preserves invite on failure", async () => {
    const auth = app.get(AuthService);
    const invite = config.createInvitation(),
      other = config.createInvitation();
    const owner: AuthOwner = { kind: "invitation", id: invite.id };
    telegram.sendAuthCode.mockResolvedValue({
      phoneCodeHash: "hash",
      tempSessionString: "temp",
      isCodeViaApp: true,
    });
    const start = await auth.sendCode("+11111", owner);
    await expect(
      auth.verifyCode(
        "+11111",
        "12345",
        { kind: "invitation", id: other.id },
        undefined,
        start.attemptId,
      ),
    ).rejects.toThrow("another session");
    telegram.verifyAuthCode.mockRejectedValueOnce(
      new PasswordRequiredError("password required", "password-session"),
    );
    expect(
      (
        await auth.verifyCode(
          "+11111",
          "12345",
          owner,
          undefined,
          start.attemptId,
        )
      ).passwordRequired,
    ).toBe(true);
    expect(config.validateInvitation(invite.secret)).toBeTruthy();
    telegram.verifyAuthCode.mockRejectedValueOnce(
      new PasswordRequiredError(
        "Incorrect Telegram password. Try again.",
        "password-session",
      ),
    );
    expect(
      (
        await auth.verifyCode(
          "+11111",
          "12345",
          owner,
          "wrong-password",
          start.attemptId,
        )
      ).passwordRequired,
    ).toBe(true);
    expect(telegram.verifyAuthCode).toHaveBeenLastCalledWith(
      "+11111",
      "12345",
      "hash",
      "password-session",
      "wrong-password",
      true,
    );
    expect(config.validateInvitation(invite.secret)).toBeTruthy();
    telegram.verifyAuthCode.mockResolvedValue("session");
    clients.getOrInitializeClient.mockResolvedValue({
      getMe: async () => ({ id: 1, phone: "11111", firstName: "Telegram", lastName: "Name" }),
    });
    const done = await auth.verifyCode(
      "+11111",
      "12345",
      owner,
      "password",
      start.attemptId,
    );
    expect(done.success).toBe(true);
    expect(config.getUserByToken(done.user?.token ?? "")?.name).toBe("Telegram Name");
    expect(() => config.validateInvitation(invite.secret)).toThrow("used");
  });
  it("rechecks a revoked invitation after Telegram authentication", async () => {
    const auth = app.get(AuthService),
      invite = config.createInvitation(),
      owner: AuthOwner = { kind: "invitation", id: invite.id };
    telegram.sendAuthCode.mockResolvedValue({
      phoneCodeHash: "hash",
      tempSessionString: "temp",
    });
    const start = await auth.sendCode("+11111", owner);
    telegram.verifyAuthCode.mockImplementation(async () => {
      config.revokeInvitation(invite.id);
      return "session";
    });
    clients.getOrInitializeClient.mockResolvedValue({
      getMe: async () => ({ id: 1, phone: "11111" }),
    });
    await expect(
      auth.verifyCode("+11111", "12345", owner, undefined, start.attemptId),
    ).rejects.toThrow("revoked");
    expect(Object.keys(config.getUsers())).toHaveLength(0);
  });
  it("binds QR attempts and handles QR password retry", async () => {
    const auth = app.get(AuthService),
      invite = config.createInvitation(),
      owner: AuthOwner = { kind: "invitation", id: invite.id };
    telegram.exportLoginToken.mockResolvedValue({
      token: Buffer.from("qr"),
      tempSessionString: "temp",
      expires: Math.floor(Date.now() / 1000) + 60,
    });
    const qr = await auth.generateQrCode(owner);
    await expect(
      auth.checkQrStatus(qr.qrToken, { kind: "invitation", id: "other" }),
    ).rejects.toThrow("another session");
    telegram.checkLoginToken.mockRejectedValueOnce(
      new PasswordRequiredError("password", "migrated-session"),
    );
    expect((await auth.checkQrStatus(qr.qrToken, owner)).passwordRequired).toBe(
      true,
    );
    telegram.checkLoginToken.mockResolvedValue("session");
    clients.getOrInitializeClient.mockResolvedValue({
      getMe: async () => ({ id: 1, phone: "11111", username: "telegram_handle" }),
    });
    expect(
      (await auth.checkQrStatus(qr.qrToken, owner, "password")).status,
    ).toBe("authorized");
    expect(Object.values(config.getUsers())[0].name).toBe("telegram_handle");
    expect(telegram.checkLoginToken).toHaveBeenLastCalledWith(
      Buffer.from("qr"),
      "migrated-session",
      "password",
    );
  });
  it("rejects an in-flight personal reconnect after account deletion", async () => {
    const auth = app.get(AuthService);
    const account = config.completeAuthentication(
      { kind: "admin", id: "a" },
      "+11111",
      "1",
      "old",
    );
    const owner: AuthOwner = { kind: "user", id: account.token };
    telegram.sendAuthCode.mockResolvedValue({
      phoneCodeHash: "hash",
      tempSessionString: "temp",
    });
    const start = await auth.sendCode("+11111", owner);
    telegram.verifyAuthCode.mockImplementation(async () => {
      await auth.logout(account.token);
      return "new";
    });
    clients.getOrInitializeClient.mockResolvedValue({
      getMe: async () => ({ id: 1, phone: "11111" }),
    });
    await expect(
      auth.verifyCode("+11111", "12345", owner, undefined, start.attemptId),
    ).rejects.toThrow();
    expect(config.getUserByToken(account.token)).toBeNull();
    expect(Object.keys(config.getUsers())).toHaveLength(0);
  });
  it("invalidates pending authentication on restore and admin logout", async () => {
    const auth = app.get(AuthService),
      management = app.get(ManagementService);
    const owner = management.authOwner({
      headers: { cookie },
      query: {},
      get: () => undefined,
    } as never);
    telegram.sendAuthCode.mockResolvedValue({
      phoneCodeHash: "hash",
      tempSessionString: "temp",
    });
    const start = await auth.sendCode("+11111", owner);
    await request("/admin/logout", "POST", {}, { cookie });
    await expect(
      auth.verifyCode("+11111", "12345", owner, undefined, start.attemptId),
    ).rejects.toThrow("expired");
    const invite = config.createInvitation();
    const invitationOwner: AuthOwner = { kind: "invitation", id: invite.id };
    const second = await auth.sendCode("+11111", invitationOwner);
    await config.importRaw({ users: {} });
    await expect(
      auth.verifyCode(
        "+11111",
        "12345",
        invitationOwner,
        undefined,
        second.attemptId,
      ),
    ).rejects.toThrow("expired");
  });
  it("preserves an invitation through an invalid code and rejects expired phone attempts", async () => {
    const auth = app.get(AuthService),
      invite = config.createInvitation(),
      owner: AuthOwner = { kind: "invitation", id: invite.id };
    telegram.sendAuthCode.mockResolvedValue({
      phoneCodeHash: "hash",
      tempSessionString: "temp",
    });
    const start = await auth.sendCode("+11111", owner);
    telegram.verifyAuthCode.mockRejectedValue(new Error("invalid code"));
    await expect(
      auth.verifyCode("+11111", "00000", owner, undefined, start.attemptId),
    ).rejects.toThrow("could not be verified");
    expect(config.validateInvitation(invite.secret)).toBeTruthy();
    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 300001);
    await expect(
      auth.verifyCode("+11111", "12345", owner, undefined, start.attemptId),
    ).rejects.toThrow("expired");
  });
  it("validates self-contained playback paths before Telegram access", async () => {
    const account = config.completeAuthentication({ kind: "admin", id: "a" }, "+11111", "1", "s");
    const prepare = jest.spyOn(telegram, "preparePlayback");
    for (const [path, peer] of [
      ["channel/123/-9223372036854775808/1", { kind: "channel", id: "123", accessHash: "-9223372036854775808" }],
      ["user/123/9223372036854775807/2147483647", { kind: "user", id: "123", accessHash: "9223372036854775807" }],
      ["chat/123/1", { kind: "chat", id: "123" }],
      ["self/123/1", { kind: "self", id: "123" }],
    ] as const) {
      const response = await fetch(`${base}/${account.token}/watch/${path}`, { method: "HEAD" });
      expect(response.status).toBe(200);
      expect(prepare).toHaveBeenLastCalledWith(account.token, "s", peer, Number(path.split("/").pop()), expect.any(AbortSignal));
    }
    prepare.mockClear();
    for (const path of [
      "channel/123/0/1", "channel/123/-0/1", "channel/123/9223372036854775808/1",
      "user/123/-9223372036854775809/1", "channel/123/1e3/1", "channel/123/1.5/1",
      "channel/123/abc/1", "channel/0/456/1", "channel/-123/456/1",
      "chat/9223372036854775808/1", "chat/123/0", "chat/123/-1", "chat/123/2147483648",
      "chat/123/1.5", "channel/123/456/01", "self/123/0", "self/-123/1",
    ]) {
      expect((await fetch(`${base}/${account.token}/watch/${path}`)).status).toBe(400);
    }
    for (const path of ["123/1", "channel/123/1", "unknown/123/456/1", "chat/123/456/1"]) {
      expect((await fetch(`${base}/${account.token}/watch/${path}`)).status).toBe(404);
    }
    expect(prepare).not.toHaveBeenCalled();
  });

  it("preserves cross-origin byte-range playback and token-prefixed episode routes", async () => {
    const account = config.completeAuthentication(
      { kind: "admin", id: "a" },
      "+11111",
      "1",
      "s",
    );
    const playback = await fetch(`${base}/${account.token}/watch/channel/123/456/1`, {
      headers: { range: "bytes=2-5", origin: "https://web.stremio.com" },
    });
    expect(playback.status).toBe(206);
    expect(playback.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(playback.headers.get("access-control-allow-origin")).toBe("*");
    expect(await playback.text()).toBe("2345");
    const handler = app.get(StreamHandlerService);
    jest.spyOn(handler, "handleEpisodeRequest").mockResolvedValue({
      imdb_id: "tt1",
      title: "Fixture",
      type: "series",
      results: [],
    });
    const episode = await request(
      `/${account.token}/search/series/tt1/season/1/episode/2`,
    );
    expect(episode.status).toBe(200);
    expect(handler.handleEpisodeRequest).toHaveBeenCalledWith(
      expect.objectContaining({ token: account.token }),
      "tt1",
      1,
      2,
    );
  });
  it("personal context takes precedence over an admin cookie", () => {
    const user = config.completeAuthentication(
      { kind: "admin", id: "a" },
      "+11111",
      "1",
      "s",
    );
    const service = app.get(ManagementService);
    const fake = {
      get: (key: string) =>
        key === "authorization" ? `Bearer ${user.token}` : undefined,
      headers: { cookie },
      query: {},
    };
    expect(service.authOwner(fake as never)).toEqual({
      kind: "user",
      id: user.token,
    });
  });
});
