import { InstanceConfigService } from "../user/instance-config.service";
import { ManagementService } from "../management/management.service";
import { TelegramClientManager } from "../telegram/telegram-client.manager";
import { SetupController } from "./setup.controller";

describe("Public bootstrap privacy", () => {
  const config = {
    isManagementInitialized: jest.fn().mockReturnValue(true),
    isProtected: jest.fn().mockReturnValue(true),
    getConfig: jest.fn().mockReturnValue({
      publicUrl: "https://stream.example",
      telegram: { apiId: 12345, apiHash: "secret-hash" },
      tmdb: { bearerToken: "secret-tmdb" },
      preferredLanguage: "en",
    }),
    hasAdminPassword: jest.fn().mockReturnValue(true),
    isSetupComplete: jest.fn().mockReturnValue(true),
    getMissingFields: jest.fn().mockReturnValue([]),
  } as unknown as InstanceConfigService;
  const controller = new SetupController(
    config,
    {} as ManagementService,
    {} as TelegramClientManager,
  );
  it("returns only public initialization and protection flags", () => {
    expect(controller.getStatus()).toEqual({
      managementInitialized: true,
      passwordRequired: true,
    });
    expect(config.getConfig).not.toHaveBeenCalled();
  });
  it("closes first-run configuration after initialization", () => {
    expect(() => controller.bootstrap()).toThrow("already initialized");
  });
  it("keeps environment credentials private until management is initialized", () => {
    (config.isManagementInitialized as jest.Mock).mockReturnValueOnce(false);
    expect(controller.bootstrap()).toEqual({ adminProtection: true });
  });
  it("returns only the last three credential characters in guarded admin previews", () => {
    const response = controller.configuration();
    expect(response.apiIdConfigured).toBe(true);
    expect(response.apiIdPreview).toBe("**345");
    expect(response).not.toHaveProperty("apiId");
    expect(response.apiHashPreview).toBe("********ash");
    expect(response.tmdbTokenPreview).toBe("********mdb");
    const json = JSON.stringify(response);
    expect(json).not.toMatch(
      /12345|secret-hash|secret-tmdb|sessionString|phone|userToken|users/,
    );
  });
  it.each([
    ["", ""],
    ["abc", "abc"],
    ["abcd", "*bcd"],
  ])("formats empty and short credential previews (%j)", (secret, preview) => {
    (config.getConfig as jest.Mock).mockReturnValueOnce({
      publicUrl: "https://stream.example",
      telegram: { apiId: 12345, apiHash: secret },
      tmdb: { bearerToken: secret },
      preferredLanguage: "en",
    });
    expect(controller.configuration()).toMatchObject({
      apiHashPreview: preview,
      tmdbTokenPreview: preview,
    });
  });
  it("leaves an unconfigured Telegram API ID empty", () => {
    (config.getConfig as jest.Mock).mockReturnValueOnce({
      publicUrl: "https://stream.example",
      telegram: { apiId: 0, apiHash: "" },
      tmdb: { bearerToken: "" },
      preferredLanguage: "en",
    });
    expect(controller.configuration()).toMatchObject({
      apiIdConfigured: false,
      apiIdPreview: "",
    });
  });
});
