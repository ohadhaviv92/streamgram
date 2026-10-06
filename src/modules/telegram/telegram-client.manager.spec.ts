import { ConfigService } from "@nestjs/config";
import { TelegramClient } from "teleproto";
import { TelegramClientManager } from "./telegram-client.manager";
import { InstanceConfigService } from "../user/instance-config.service";

describe("Managed client lifecycle", () => {
  let manager: TelegramClientManager;
  const configuration = {
    get: (key: string) => (key === "telegram.apiId" ? 12345 : "api-hash"),
  } as ConfigService;
  const client = () =>
    ({
      connected: true,
      disconnect: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn().mockResolvedValue(undefined),
    }) as unknown as TelegramClient;
  beforeEach(() => {
    manager = new TelegramClientManager(configuration);
  });
  afterEach(async () => {
    await manager.onApplicationShutdown();
    jest.restoreAllMocks();
  });
  it("cancels an initialization that finishes after deletion", async () => {
    let resolve!: (client: TelegramClient) => void;
    jest
      .spyOn(
        manager as unknown as {
          initializeClient(session: string): Promise<TelegramClient>;
        },
        "initializeClient",
      )
      .mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
    const pending = manager.getOrInitializeClient("account", "session");
    const rejected = expect(pending).rejects.toThrow("cancelled");
    const removal = manager.removeClient("account");
    const temporary = client();
    resolve(temporary);
    await Promise.all([rejected, removal]);
    expect(manager.getActiveClientCount()).toBe(0);
    expect(temporary.disconnect).toHaveBeenCalled();
    expect(temporary.destroy).toHaveBeenCalled();
  });
  it("replaces only one account's session", async () => {
    const a = client(),
      b = client(),
      replacement = client();
    const init = jest
      .spyOn(
        manager as unknown as {
          initializeClient(session: string): Promise<TelegramClient>;
        },
        "initializeClient",
      )
      .mockResolvedValueOnce(a)
      .mockResolvedValueOnce(b)
      .mockResolvedValueOnce(replacement);
    await manager.getOrInitializeClient("a", "old");
    await manager.getOrInitializeClient("b", "other");
    expect(await manager.getOrInitializeClient("a", "new")).toBe(replacement);
    expect(a.disconnect).toHaveBeenCalled();
    expect(b.disconnect).not.toHaveBeenCalled();
    expect(manager.getClient("b")).toBe(b);
    expect(init).toHaveBeenCalledTimes(3);
  });
  it("shares initialization for concurrent requests", async () => {
    const connected = client();
    const init = jest
      .spyOn(
        manager as unknown as {
          initializeClient(session: string): Promise<TelegramClient>;
        },
        "initializeClient",
      )
      .mockResolvedValue(connected);
    const results = await Promise.all([
      manager.getOrInitializeClient("a", "session"),
      manager.getOrInitializeClient("a", "session"),
    ]);
    expect(results).toEqual([connected, connected]);
    expect(init).toHaveBeenCalledTimes(1);
  });
  it("rejects stale request profiles after deletion or reconnect", async () => {
    await manager.onApplicationShutdown();
    const config = {
      getConfig: () => ({ telegram: { apiId: 12345, apiHash: "hash" } }),
      getUserByToken: jest.fn().mockReturnValue(null),
    };
    manager = new TelegramClientManager(
      configuration,
      config as unknown as InstanceConfigService,
    );
    await expect(
      manager.getOrInitializeClient("deleted", "old"),
    ).rejects.toThrow("deleted");
    config.getUserByToken.mockReturnValue({ sessionString: "new" });
    await expect(
      manager.getOrInitializeClient("reconnected", "old"),
    ).rejects.toThrow("replaced");
  });
});
