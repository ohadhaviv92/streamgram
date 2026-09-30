import { InstanceConfigService } from "../user/instance-config.service";
import { TelegramNestService } from "../telegram/telegram.service";
import { SetupController } from "./setup.controller";

describe("SetupController", () => {
  it("returns safe effective configuration status without secrets", async () => {
    const instanceConfig = {
      getConfig: jest.fn().mockReturnValue({
        publicUrl: "https://stream.example",
        telegram: {
          apiId: 123,
          apiHash: "secret-hash",
          sessionString: "secret-session",
        },
        tmdb: { bearerToken: "secret-token" },
        preferredLanguage: "he",
        phone: "+1 (555) 123-4567",
      }),
      isSetupComplete: jest.fn().mockReturnValue(true),
      getMissingFields: jest.fn().mockReturnValue([]),
    } as unknown as InstanceConfigService;
    const telegramService = {
      getTelegramPhone: jest.fn(),
    } as unknown as TelegramNestService;

    const status = await new SetupController(instanceConfig, telegramService).getStatus();

    expect(status).toEqual({
      setupComplete: true,
      missing: [],
      publicUrl: "https://stream.example",
      apiId: 123,
      apiHashPrefix: "secr****",
      preferredLanguage: "he",
      telegramConfigured: true,
      telegramAuthenticated: true,
      telegramPhoneLast4: "4567",
      tmdbTokenPrefix: "secr****",
      tmdbConfigured: true,
    });
    expect(telegramService.getTelegramPhone).not.toHaveBeenCalled();
    expect(status).not.toHaveProperty("apiHash");
    expect(status).not.toHaveProperty("sessionString");
    expect(status).not.toHaveProperty("tmdbBearerToken");
    expect(status).not.toHaveProperty("setupUnlocked");
  });

  it("uses the active Telegram session when no phone is persisted", async () => {
    const instanceConfig = {
      getConfig: jest.fn().mockReturnValue({
        publicUrl: "https://stream.example",
        telegram: {
          apiId: 123,
          apiHash: "secret-hash",
          sessionString: "secret-session",
        },
        tmdb: { bearerToken: "secret-token" },
        preferredLanguage: "he",
        phone: null,
      }),
      isSetupComplete: jest.fn().mockReturnValue(true),
      getMissingFields: jest.fn().mockReturnValue([]),
    } as unknown as InstanceConfigService;
    const telegramService = {
      getTelegramPhone: jest.fn().mockResolvedValue("+44 (7700) 900-0123"),
    } as unknown as TelegramNestService;

    const status = await new SetupController(instanceConfig, telegramService).getStatus();

    expect(status.telegramPhoneLast4).toBe("0123");
    expect(telegramService.getTelegramPhone).toHaveBeenCalledWith(
      "instance",
      "secret-session",
    );
  });

  it("keeps status available when the Telegram phone lookup fails", async () => {
    const instanceConfig = {
      getConfig: jest.fn().mockReturnValue({
        publicUrl: "https://stream.example",
        telegram: {
          apiId: 123,
          apiHash: "secret-hash",
          sessionString: "secret-session",
        },
        tmdb: { bearerToken: "secret-token" },
        preferredLanguage: "he",
        phone: null,
      }),
      isSetupComplete: jest.fn().mockReturnValue(true),
      getMissingFields: jest.fn().mockReturnValue([]),
    } as unknown as InstanceConfigService;
    const telegramService = {
      getTelegramPhone: jest.fn().mockRejectedValue(new Error("offline")),
    } as unknown as TelegramNestService;

    const status = await new SetupController(instanceConfig, telegramService).getStatus();

    expect(status.telegramAuthenticated).toBe(true);
    expect(status.telegramPhoneLast4).toBeNull();
  });

  it("does not expose a suffix for phone numbers shorter than four digits", async () => {
    const instanceConfig = {
      getConfig: jest.fn().mockReturnValue({
        publicUrl: "https://stream.example",
        telegram: {
          apiId: 123,
          apiHash: "secret-hash",
          sessionString: "",
        },
        tmdb: { bearerToken: "secret-token" },
        preferredLanguage: "he",
        phone: "+123",
      }),
      isSetupComplete: jest.fn().mockReturnValue(false),
      getMissingFields: jest.fn().mockReturnValue(["telegram.sessionString"]),
    } as unknown as InstanceConfigService;
    const telegramService = {
      getTelegramPhone: jest.fn(),
    } as unknown as TelegramNestService;

    const status = await new SetupController(instanceConfig, telegramService).getStatus();

    expect(status.telegramPhoneLast4).toBeNull();
    expect(telegramService.getTelegramPhone).not.toHaveBeenCalled();
  });
});
