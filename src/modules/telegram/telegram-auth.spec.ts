import { ConfigService } from "@nestjs/config";
import { Api, TelegramClient } from "teleproto";
import { computeCheck } from "teleproto/Password";
import { CacheService } from "../cache/cache.service";
import { TelegramClientManager } from "./telegram-client.manager";
import { PasswordRequiredError, TelegramNestService } from "./telegram.service";

jest.mock("teleproto", () => ({
  ...jest.requireActual("teleproto"),
  TelegramClient: jest.fn(),
}));
jest.mock("teleproto/Password", () => ({ computeCheck: jest.fn() }));

describe("Telegram phone two-step authentication", () => {
  const client = {
    connect: jest.fn(),
    disconnect: jest.fn(),
    destroy: jest.fn(),
    invoke: jest.fn(),
    session: { save: jest.fn() },
  };
  let service: TelegramNestService;

  beforeEach(() => {
    jest.resetAllMocks();
    (TelegramClient as unknown as jest.Mock).mockImplementation(() => client);
    (computeCheck as jest.Mock).mockResolvedValue(
      new Api.InputCheckPasswordEmpty(),
    );
    client.session.save.mockReturnValue("password-session");
    service = new TelegramNestService(
      {} as CacheService,
      {
        get: (key: string, fallback: unknown) =>
          key === "telegram.apiId"
            ? 12345
            : key === "telegram.apiHash"
              ? "hash"
              : fallback,
      } as ConfigService,
      {} as TelegramClientManager,
    );
  });

  it("finishes a code-only login without requesting a password", async () => {
    await expect(
      service.verifyAuthCode("+447700900123", "12345", "hash", ""),
    ).resolves.toBe("password-session");
    expect(client.invoke).toHaveBeenCalledTimes(1);
    expect(client.invoke.mock.calls[0][0]).toBeInstanceOf(Api.auth.SignIn);
    expect(computeCheck).not.toHaveBeenCalled();
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it("preserves the session when Telegram requests a password", async () => {
    client.invoke.mockRejectedValueOnce({
      errorMessage: "SESSION_PASSWORD_NEEDED",
    });
    await expect(
      service.verifyAuthCode("+447700900123", "12345", "hash", ""),
    ).rejects.toMatchObject({
      name: "PasswordRequiredError",
      sessionString: "password-session",
    });
    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it("retries a password directly without submitting the verified code again", async () => {
    client.invoke
      .mockResolvedValueOnce({ hint: "test" })
      .mockResolvedValueOnce({});
    await expect(
      service.verifyAuthCode(
        "+447700900123",
        "12345",
        "hash",
        "",
        "password",
        true,
      ),
    ).resolves.toBe("password-session");
    expect(
      client.invoke.mock.calls.map(([request]) => request.constructor),
    ).toEqual([Api.account.GetPassword, Api.auth.CheckPassword]);
    expect(computeCheck).toHaveBeenCalledWith({ hint: "test" }, "password");
  });

  it("keeps the password step retryable after a wrong password", async () => {
    client.invoke
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce({ errorMessage: "PASSWORD_HASH_INVALID" });
    const failed = service.verifyAuthCode(
      "+447700900123",
      "12345",
      "hash",
      "",
      "wrong",
      true,
    );
    await expect(failed).rejects.toBeInstanceOf(PasswordRequiredError);
    await expect(failed).rejects.toMatchObject({
      message: "Incorrect Telegram password. Try again.",
      sessionString: "password-session",
    });
    client.invoke.mockResolvedValue({});
    await expect(
      service.verifyAuthCode(
        "+447700900123",
        "12345",
        "hash",
        "",
        "correct",
        true,
      ),
    ).resolves.toBe("password-session");
    expect(
      client.invoke.mock.calls.some(
        ([request]) => request instanceof Api.auth.SignIn,
      ),
    ).toBe(false);
  });

  it("supports clients that submit code and password together", async () => {
    client.invoke
      .mockRejectedValueOnce({ errorMessage: "SESSION_PASSWORD_NEEDED" })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    await expect(
      service.verifyAuthCode("+447700900123", "12345", "hash", "", "password"),
    ).resolves.toBe("password-session");
    expect(
      client.invoke.mock.calls.map(([request]) => request.constructor),
    ).toEqual([
      Api.auth.SignIn,
      Api.account.GetPassword,
      Api.auth.CheckPassword,
    ]);
  });
});
