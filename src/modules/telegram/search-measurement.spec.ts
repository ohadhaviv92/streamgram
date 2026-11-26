import { Api } from "teleproto";
import bigInt from "big-integer";
import { ConfigService } from "@nestjs/config";
import { TelegramClientManager } from "./telegram-client.manager";
import { logger } from "../../logger";
import { inSearchPhase, measureGlobalSearch, measureSearch, recordSearchCacheHit } from "./search-measurement";

jest.mock("../../logger", () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));

const request = (query: string) => new Api.messages.SearchGlobal({
  q: query, filter: new Api.InputMessagesFilterVideo(), minDate: 0, maxDate: 0,
  offsetRate: 0, offsetPeer: new Api.InputPeerEmpty(), limit: 150,
});
const empty = () => new Api.messages.Messages({ messages: [], chats: [], users: [], topics: [] });
type Summary = {
  searchId: string;
  ordinaryCacheHit: boolean;
  calls: Array<{ query: string; phase: string }>;
  globalSearch: object;
  otherRpc: object;
  finalUniqueResultCount?: number;
};
const summaries = () => jest.mocked(logger.info).mock.calls
  .filter(([, message]) => message === "Telegram media search completed")
  .map(([fields]) => fields as Summary);

beforeEach(() => jest.clearAllMocks());

describe("search measurement", () => {
  it("records short pages, reported totals, accepted candidates, and failures without extra invocations", async () => {
    const video = new Api.Message({ id: 1, message: "" });
    const response = new Api.messages.MessagesSlice({ messages: [video], chats: [], users: [], topics: [], count: 271 });
    const invoke = jest.fn().mockResolvedValueOnce(response).mockRejectedValueOnce(new Error("private-session"));
    await measureSearch(async () => {
      const measured = await inSearchPhase("primary", () => measureGlobalSearch(request("title"), invoke, () => true));
      measured.call.acceptedVideoCount = 1;
      await expect(inSearchPhase("short-title", () => measureGlobalSearch(request("short title"), invoke, () => false)))
        .rejects.toThrow("private-session");
      return [video];
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    const [summary] = summaries();
    expect(summary).toMatchObject({
      globalSearch: { attempts: 2, successes: 1, failures: 1 },
      finalUniqueResultCount: 1, ordinaryCacheHit: false, completed: true,
      calls: [
        { phase: "primary", query: "title", filter: "InputMessagesFilterVideo", requestedLimit: 150,
          returnedMessageCount: 1, reportedTotal: 271, videoCandidateCount: 1, acceptedVideoCount: 1 },
        { phase: "short-title", failures: 1 },
      ],
    });
    expect(JSON.stringify(summary)).not.toContain("private-session");
  });

  it("keeps overlapping searches and their phases isolated", async () => {
    let resolveFirst!: (value: Api.messages.Messages) => void;
    const pending = new Promise<Api.messages.Messages>((resolve) => { resolveFirst = resolve; });
    const first = measureSearch(async () => {
      await inSearchPhase("channel-fallback", () => measureGlobalSearch(request("first"), () => pending, () => false));
      return [1];
    });
    await measureSearch(async () => {
      recordSearchCacheHit();
      await inSearchPhase("tags", () => measureGlobalSearch(request("second"), async () => empty(), () => false));
      return [];
    });
    resolveFirst(empty());
    await first;
    const [secondSummary, firstSummary] = summaries();
    expect(secondSummary).toMatchObject({ ordinaryCacheHit: true, calls: [{ query: "second", phase: "tags" }] });
    expect(firstSummary).toMatchObject({ ordinaryCacheHit: false, calls: [{ query: "first", phase: "channel-fallback" }] });
    expect(firstSummary.calls).toHaveLength(1);
    expect(secondSummary.calls).toHaveLength(1);
    expect(firstSummary.searchId).not.toBe(secondSummary.searchId);
  });

  it("counts actual managed-client RPCs separately and leaves their results/errors intact", async () => {
    const manager = new TelegramClientManager(new ConfigService());
    const error = new Error("private-credential");
    const client = { invoke: jest.fn().mockResolvedValueOnce(empty()).mockResolvedValueOnce("entity").mockRejectedValueOnce(error) };
    try {
      (manager as unknown as { observeRpcFailures(client: unknown): void }).observeRpcFailures(client);
      await measureSearch(async () => {
        await measureGlobalSearch(request("title"), () => client.invoke(request("title")), () => false);
        await expect(client.invoke(new Api.contacts.GetContacts({ hash: bigInt(0) }))).resolves.toBe("entity");
        await expect(client.invoke(new Api.contacts.GetContacts({ hash: bigInt(0) }))).rejects.toBe(error);
        return [];
      });
      const [summary] = summaries();
      expect(summary.globalSearch).toEqual({ attempts: 1, successes: 1, failures: 0 });
      expect(summary.otherRpc).toEqual({ "contacts.GetContacts": { attempts: 2, successes: 1, failures: 1 } });
      expect(JSON.stringify(summary)).not.toContain("private-credential");
    } finally {
      await manager.onApplicationShutdown();
    }
  });

  it("emits an incomplete summary without swallowing a search failure", async () => {
    const error = new Error("failed search");
    await expect(measureSearch(async () => { throw error; })).rejects.toBe(error);
    expect(summaries()[0]).toMatchObject({ completed: false, globalSearch: { attempts: 0, successes: 0, failures: 0 } });
    expect(summaries()[0].finalUniqueResultCount).toBeUndefined();
  });
});
