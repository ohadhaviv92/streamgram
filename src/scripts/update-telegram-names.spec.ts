import { updateTelegramNames } from "./update-telegram-names";
import { UserEntry } from "../modules/user/instance-profile";

function harness(entries: UserEntry[]) {
  const users = Object.fromEntries(entries.map(user => [user.token, { ...user }]));
  const config = {
    getUsers: () => Object.fromEntries(Object.entries(users).map(([key, user]) => [key, { ...user }])),
    getUserByToken: (token: string) => users[token] ?? null,
    updateUserName: jest.fn((token: string, name: string) => { users[token].name = name; }),
  };
  const getMe = jest.fn().mockResolvedValue({ id: "1", phone: "111", firstName: "Alice", lastName: "Smith" });
  const clients = {
    getOrInitializeClient: jest.fn().mockResolvedValue({ getMe }),
    removeClient: jest.fn().mockResolvedValue(undefined),
  };
  const report = jest.fn();
  return { users, config, clients, getMe, report };
}

const account: UserEntry = {
  token: "private-token", phone: "+111", telegramId: "1", sessionString: "private-session",
  createdAt: 1234, selectedFolders: [1], selectedChannels: ["2"],
};

describe("Telegram name update script", () => {
  it("fills missing names and preserves the rest of the account", async () => {
    const h = harness([account]);
    expect(await updateTelegramNames(h.config, h.clients, { overwrite: false, dryRun: false }, h.report))
      .toEqual({ updated: 1, skipped: 0, failed: 0 });
    expect(h.users[account.token]).toEqual({ ...account, name: "Alice Smith" });
    expect(h.clients.getOrInitializeClient).toHaveBeenCalledWith(account.token, account.sessionString);
    expect(h.clients.removeClient).toHaveBeenCalledWith(account.token);
  });

  it("skips custom names, blocked accounts, and missing sessions by default", async () => {
    const h = harness([
      { ...account, name: "Custom" },
      { ...account, token: "blocked", blocked: true },
      { ...account, token: "no-session", sessionString: "" },
    ]);
    expect(await updateTelegramNames(h.config, h.clients, { overwrite: false, dryRun: false }, h.report))
      .toEqual({ updated: 0, skipped: 3, failed: 0 });
    expect(h.clients.getOrInitializeClient).not.toHaveBeenCalled();
  });

  it("previews overwrites without persisting and falls back to the username", async () => {
    const h = harness([{ ...account, name: "Custom" }]);
    h.getMe.mockResolvedValue({ id: "1", phone: "111", username: "alice" });
    expect(await updateTelegramNames(h.config, h.clients, { overwrite: true, dryRun: true }, h.report))
      .toEqual({ updated: 1, skipped: 0, failed: 0 });
    expect(h.config.updateUserName).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenCalledWith(expect.stringContaining('would update name to "alice"'));
  });

  it("overwrites only when requested and caps the name at 80 characters", async () => {
    const h = harness([{ ...account, name: "Custom" }]);
    h.getMe.mockResolvedValue({ id: "1", phone: "111", firstName: "A".repeat(100) });
    await updateTelegramNames(h.config, h.clients, { overwrite: true, dryRun: false }, h.report);
    expect(h.config.updateUserName).toHaveBeenCalledWith(account.token, "A".repeat(80));
  });

  it("continues after failed lookups and never reports private credentials or error contents", async () => {
    const h = harness([account, { ...account, token: "second" }]);
    h.getMe.mockRejectedValueOnce(new Error("private-session private-token"));
    expect(await updateTelegramNames(h.config, h.clients, { overwrite: false, dryRun: false }, h.report))
      .toEqual({ updated: 1, skipped: 0, failed: 1 });
    expect(h.clients.removeClient).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(h.report.mock.calls)).not.toMatch(/private-session|private-token/);
  });

  it("refuses a mismatched Telegram identity", async () => {
    const h = harness([account]);
    h.getMe.mockResolvedValue({ id: "2", phone: "111", firstName: "Wrong" });
    expect((await updateTelegramNames(h.config, h.clients, { overwrite: true, dryRun: false }, h.report)).failed).toBe(1);
    expect(h.config.updateUserName).not.toHaveBeenCalled();
  });

  it("matches legacy accounts by normalized phone and skips edits made during lookup", async () => {
    const h = harness([{ ...account, telegramId: undefined, phone: "+1 (11)" }]);
    h.getMe.mockImplementation(async () => {
      h.users[account.token].name = "Edited during lookup";
      return { id: "1", phone: "111", firstName: "Alice" };
    });
    expect((await updateTelegramNames(h.config, h.clients, { overwrite: true, dryRun: false }, h.report)).skipped).toBe(1);
    expect(h.config.updateUserName).not.toHaveBeenCalled();
  });
});
