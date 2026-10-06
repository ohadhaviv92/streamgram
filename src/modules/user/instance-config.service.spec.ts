import { ConfigService } from "@nestjs/config";
import { createHash } from "crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { InstanceConfigService } from "./instance-config.service";

describe("Persisted invitation migration", () => {
  let directory: string;
  let configPath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "streamgram-invitations-"));
    configPath = join(directory, "config.json");
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function load() {
    return new InstanceConfigService({
      get: (key: string, fallback: unknown) =>
        key === "storage.dataDir" ? directory : fallback,
    } as ConfigService);
  }

  function save(invitations: unknown) {
    const config = {
      managementInitialized: true,
      adminProtection: true,
      adminPasswordHash: createHash("sha256").update("password").digest("hex"),
      users: {
        existingtoken: {
          token: "existingtoken",
          phone: "+11111",
          sessionString: "existing-session",
          selectedFolders: [1],
          language: "he",
        },
      },
      invitations,
    };
    writeFileSync(configPath, JSON.stringify(config));
    return config;
  }

  function legacyInvitation(status = "active") {
    const now = Date.now();
    return {
      id: status,
      secretHash: createHash("sha256").update(status).digest("hex"),
      createdAt: new Date(now - 86400000).toISOString(),
      expiresAt: new Date(
        status === "expired" ? now - 1000 : now + 86400000,
      ).toISOString(),
      createdBy: "admin",
      ...(status === "used"
        ? {
            usedAt: new Date(now - 1000).toISOString(),
            usedByToken: "existingtoken",
          }
        : {}),
      ...(status === "revoked"
        ? { revokedAt: new Date(now - 1000).toISOString() }
        : {}),
    };
  }

  it.each(["map", "array"])(
    "migrates a legacy %s without reviving unavailable invitations or changing accounts/security",
    (format) => {
      const records = ["active", "expired", "used", "revoked"].map(
        legacyInvitation,
      );
      const original = save(
        format === "map"
          ? Object.fromEntries(records.map((record) => [record.id, record]))
          : records,
      );
      const config = load();

      expect(config.getInvitations().map((record) => record.status)).toEqual([
        "active",
        "expired",
        "used",
        "revoked",
      ]);
      expect(config.validateInvitation("active").id).toBe("active");
      for (const status of ["expired", "used", "revoked"]) {
        expect(() => config.validateInvitation(status)).toThrow(status);
      }
      const persisted = JSON.parse(readFileSync(configPath, "utf8"));
      expect(persisted).toEqual({
        ...original,
        invitations: records.map((record) => ({
          ...record,
          createdAt: Date.parse(record.createdAt),
          expiresAt: Date.parse(record.expiresAt),
          ...(record.usedAt ? { usedAt: Date.parse(record.usedAt) } : {}),
          ...(record.revokedAt
            ? { revokedAt: Date.parse(record.revokedAt) }
            : {}),
        })),
      });
      expect(config.getInvitations()[0]).not.toHaveProperty("secretHash");
      expect(load().getInvitations()).toEqual(config.getInvitations());
    },
  );

  it("supports creation, revocation and single-use completion after migrating a map", () => {
    save({ active: legacyInvitation() });
    const config = load();
    const created = config.createInvitation();
    config.revokeInvitation(created.id);
    expect(() => config.validateInvitation(created.secret)).toThrow("revoked");
    const user = config.completeAuthentication(
      { kind: "invitation", id: "active" },
      "+22222",
      "2",
      "new-session",
    );
    const restarted = load();
    expect(restarted.getUserByToken(user.token)).toEqual(user);
    expect(() => restarted.validateInvitation("active")).toThrow("used");
    expect(() =>
      restarted.completeAuthentication(
        { kind: "invitation", id: "active" },
        "+33333",
        "3",
        "another-session",
      ),
    ).toThrow("used");
  });

  it.each([{}, null])(
    "accepts an empty legacy invitation collection: %j",
    (invitations) => {
      save(invitations);
      const config = load();
      expect(config.getInvitations()).toEqual([]);
      expect(
        config.validateInvitation(config.createInvitation().secret),
      ).toBeDefined();
    },
  );

  it("keeps the current array format unchanged on disk", () => {
    save([
      {
        id: "current",
        secretHash: createHash("sha256").update("current").digest("hex"),
        createdAt: Date.now(),
        expiresAt: Date.now() + 86400000,
      },
    ]);
    const before = readFileSync(configPath, "utf8");
    expect(load().validateInvitation("current").id).toBe("current");
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });

  it.each(["usedAt", "revokedAt"])(
    "preserves a %s timestamp at the Unix epoch",
    (field) => {
      save({
        active: { ...legacyInvitation(), [field]: new Date(0).toISOString() },
      });
      expect(() => load().validateInvitation("active")).toThrow(
        field === "usedAt" ? "used" : "revoked",
      );
    },
  );

  it.each([null, [], "invalid"].map((value) => ({ value })))(
    "rejects an invalid root config without replacing it: %j",
    ({ value }) => {
      writeFileSync(configPath, JSON.stringify(value));
      const before = readFileSync(configPath, "utf8");
      expect(load).toThrow("Unable to read");
      expect(readFileSync(configPath, "utf8")).toBe(before);
    },
  );

  it.each(
    [
      "invalid collection",
      [null],
      [{ ...legacyInvitation(), expiresAt: "invalid" }],
      [{ ...legacyInvitation(), usedAt: "invalid" }],
      [{ ...legacyInvitation(), revokedAt: "invalid" }],
    ].map((invitations) => ({ invitations })),
  )(
    "rejects corrupt invitation data without overwriting the source: %j",
    ({ invitations }) => {
      save(invitations);
      const before = readFileSync(configPath, "utf8");
      expect(load).toThrow("Unable to read");
      expect(readFileSync(configPath, "utf8")).toBe(before);
    },
  );
});
