import { ConfigService } from "@nestjs/config";
import { Api, TelegramClient } from "teleproto";
import { TelegramClientManager } from "./telegram-client.manager";

jest.mock("teleproto", () => ({
  ...jest.requireActual("teleproto"),
  TelegramClient: jest.fn(),
}));

describe("Temporary Telegram credential check", () => {
  let manager: TelegramClientManager;
  let client: {
    connect: jest.Mock;
    invoke: jest.Mock;
    destroy: jest.Mock;
  };
  beforeEach(() => {
    client = {
      connect: jest.fn().mockResolvedValue(true),
      invoke: jest.fn().mockResolvedValue(new Api.auth.LoginToken({
        token: Buffer.from("private-login-token"), expires: 123456,
      })),
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    (TelegramClient as unknown as jest.Mock).mockReset().mockImplementation(() => client);
    manager = new TelegramClientManager({ get: () => undefined } as unknown as ConfigService);
  });
  afterEach(async () => {
    await manager.onApplicationShutdown();
    jest.useRealTimers();
  });

  it("uses the submitted credentials, discards the token, and destroys the temporary client", async () => {
    const result = await manager.checkApiCredentials(12345, "a".repeat(32));
    expect(result).toBeUndefined();
    const args = (TelegramClient as unknown as jest.Mock).mock.calls[0];
    expect(args[0].save()).toBe("");
    expect(args[1]).toBe(12345);
    expect(args[2]).toBe("a".repeat(32));
    expect(args[3]).toMatchObject({ requestRetries: 1, connectionRetries: 1, floodSleepThreshold: 0, autoReconnect: false });
    const request = client.invoke.mock.calls[0][0];
    expect(request).toBeInstanceOf(Api.auth.ExportLoginToken);
    expect(request.apiId).toBe(12345);
    expect(request.apiHash).toBe("a".repeat(32));
    expect(request.exceptIds).toEqual([]);
    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(manager.getActiveClientCount()).toBe(0);
  });
  it("cleans up rejected credentials without masking the RPC error", async () => {
    const error = { errorMessage: "API_ID_INVALID" };
    client.invoke.mockRejectedValue(error);
    await expect(manager.checkApiCredentials(12345, "a".repeat(32))).rejects.toBe(error);
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });
  it("cleans up when connecting fails", async () => {
    client.connect.mockRejectedValue(new Error("Connection failed"));
    await expect(manager.checkApiCredentials(12345, "a".repeat(32))).rejects.toThrow("Connection failed");
    expect(client.invoke).not.toHaveBeenCalled();
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });
  it("rejects unexpected responses and still cleans up", async () => {
    client.invoke.mockResolvedValue({ token: "not-a-login-token" });
    await expect(manager.checkApiCredentials(12345, "a".repeat(32))).rejects.toThrow("Unexpected");
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });
  it.each(["connect", "invoke"])("times out a hanging %s and destroys the client", async (stage) => {
    jest.useFakeTimers();
    let complete: (value: unknown) => void = () => undefined;
    client[stage as "connect" | "invoke"].mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    const pending = manager.checkApiCredentials(12345, "a".repeat(32));
    const rejected = expect(pending).rejects.toThrow("timed out");
    await jest.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(client.destroy).toHaveBeenCalledTimes(1);
    complete(true);
    await Promise.resolve();
    if (stage === "connect") expect(client.invoke).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0); // manager's interval predates fake timers
  });
  it("destroys a pending check on shutdown and prevents late authentication requests", async () => {
    let complete: (value: boolean) => void = () => undefined;
    client.connect.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    const pending = manager.checkApiCredentials(12345, "a".repeat(32));
    const rejected = expect(pending).rejects.toThrow("cancelled");
    await manager.onApplicationShutdown();
    expect(client.destroy).toHaveBeenCalled();
    complete(true);
    await rejected;
    expect(client.invoke).not.toHaveBeenCalled();
    await expect(manager.checkApiCredentials(12345, "a".repeat(32))).rejects.toThrow("shutting down");
  });
});
