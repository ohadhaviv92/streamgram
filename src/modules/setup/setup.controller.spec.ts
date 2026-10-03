import { InstanceConfigService } from "../user/instance-config.service";
import { TelegramNestService } from "../telegram/telegram.service";
import { SetupController } from "./setup.controller";

/** Helper to build a mock InstanceConfigService with a users map. */
function makeInstanceConfig(opts: {
  sessionString?: string;
  phone?: string | null;
  isComplete?: boolean;
  missing?: string[];
}) {
  const token = "testtoken123";
  const sessionString = opts.sessionString ?? "secret-session";
  // null means "not stored in users map" → controller must call getTelegramPhone
  const phoneInEntry = opts.phone === null ? "" : (opts.phone ?? "+1 (555) 123-4567");

  return {
    getConfig: jest.fn().mockReturnValue({
      publicUrl: "https://stream.example",
      telegram: { apiId: 1234567, apiHash: "secret-hash" },
      tmdb: { bearerToken: "secret-token" },
      preferredLanguage: "he",
      phone: null,
      selectedFolders: [],
      selectedChannels: [],
    }),
    getUsers: jest.fn().mockReturnValue(
      sessionString
        ? { [token]: { token, phone: phoneInEntry, sessionString } }
        : {},
    ),
    isSetupComplete: jest.fn().mockReturnValue(opts.isComplete ?? true),
    getMissingFields: jest.fn().mockReturnValue(opts.missing ?? []),
    verifyAdminPassword: jest.fn().mockReturnValue(true),
  } as unknown as InstanceConfigService;
}

describe("SetupController", () => {
  it("returns safe effective configuration status without secrets", async () => {
    const instanceConfig = makeInstanceConfig({ phone: "+1 (555) 123-4567" });
    const telegramService = {
      getTelegramPhone: jest.fn(),
    } as unknown as TelegramNestService;

    const status = await new SetupController(instanceConfig, telegramService).getStatus();

    expect(status).toEqual({
      setupComplete: true,
      missing: [],
      passwordRequired: false,
      publicUrl: "https://stream.example",
      apiIdPrefix: "***34567",
      apiHashPrefix: "secr****",
      preferredLanguage: "he",
      telegramConfigured: true,
      telegramAuthenticated: true,
      telegramPhoneLast4: "4567",
      userName: null,
      userToken: "testtoken123",
      users: [
        {
          name: null,
          phoneLast4: "4567",
          token: "testtoken123",
        },
      ],
      tmdbTokenPrefix: "secr****",
      tmdbConfigured: true,
    });
    expect(telegramService.getTelegramPhone).not.toHaveBeenCalled();
    expect(status).not.toHaveProperty("apiId");
    expect(status).not.toHaveProperty("apiHash");
    expect(status).not.toHaveProperty("sessionString");
    expect(status).not.toHaveProperty("tmdbBearerToken");
    expect(status).not.toHaveProperty("setupUnlocked");
  });

  it("uses the active Telegram session when no phone is persisted", async () => {
    const instanceConfig = makeInstanceConfig({ phone: null });
    const telegramService = {
      getTelegramPhone: jest.fn().mockResolvedValue("+44 (7700) 900-0123"),
    } as unknown as TelegramNestService;

    const status = await new SetupController(instanceConfig, telegramService).getStatus();

    expect(status.telegramPhoneLast4).toBe("0123");
    // getTelegramPhone should have been called with the user's token and session
    expect(telegramService.getTelegramPhone).toHaveBeenCalledWith(
      "testtoken123",
      "secret-session",
    );
  });

  it("keeps status available when the Telegram phone lookup fails", async () => {
    const instanceConfig = makeInstanceConfig({ phone: null });
    const telegramService = {
      getTelegramPhone: jest.fn().mockRejectedValue(new Error("offline")),
    } as unknown as TelegramNestService;

    const status = await new SetupController(instanceConfig, telegramService).getStatus();

    expect(status.telegramAuthenticated).toBe(true);
    expect(status.telegramPhoneLast4).toBeNull();
  });

  it("does not expose a suffix for phone numbers shorter than four digits", async () => {
    const instanceConfig = makeInstanceConfig({
      sessionString: "",
      phone: "+123",
      isComplete: false,
      missing: ["telegram.sessionString (no authenticated users)"],
    });
    const telegramService = {
      getTelegramPhone: jest.fn(),
    } as unknown as TelegramNestService;

    const status = await new SetupController(instanceConfig, telegramService).getStatus();

    expect(status.telegramPhoneLast4).toBeNull();
    expect(telegramService.getTelegramPhone).not.toHaveBeenCalled();
  });
});
