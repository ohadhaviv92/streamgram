import { Api } from "teleproto";
import bigInt from "big-integer";
import { TelegramNestService } from "./telegram.service";
import { CacheService } from "../cache/cache.service";
import { InstanceProfile } from "../user/instance-profile";

function fixture<T extends object>(prototype: T, fields: Partial<T>): T {
  return Reflect.construct(prototype.constructor, [fields]) as T;
}
const user = { token: "account-a", session_string: "session" } as InstanceProfile;
const peer = { kind: "channel" as const, id: "12", accessHash: "34" };
const channel = fixture(Api.Channel.prototype, { id: bigInt(12), accessHash: bigInt(34), title: "Channel" });
function video(id: number, mimeType = "video/mp4", filename = "file.mp4", thumbs: Api.TypePhotoSize[] = []) {
  return fixture(Api.Message.prototype, {
    id, date: 1700000000 - id, message: `Caption ${id}`,
    peerId: new Api.PeerChannel({ channelId: bigInt(12) }),
    media: new Api.MessageMediaDocument({ document: fixture(Api.Document.prototype, {
      id: bigInt(id), accessHash: bigInt(55), fileReference: Buffer.from("ref"), dcId: 2,
      mimeType, size: bigInt(1000000000), thumbs, date: 1600000000,
      attributes: [new Api.DocumentAttributeFilename({ fileName: filename })],
    }) }),
  });
}
function page(messages: Api.Message[], slice = false, nextRate = 44) {
  return slice
    ? new Api.messages.MessagesSlice({ messages, topics: [], chats: [channel], users: [], count: 500, nextRate })
    : new Api.messages.Messages({ messages, topics: [], chats: [channel], users: [] });
}
function setup() {
  const entries = new Map<string, unknown>();
  const store = {
    get: jest.fn(async (key: string) => entries.get(key)),
    set: jest.fn(async (key: string, value: unknown, _ttl: number) => { entries.set(key, value); }),
    del: jest.fn(async (key: string) => { entries.delete(key); }),
    clear: jest.fn(async () => { entries.clear(); }),
  };
  const config = { get: (_key: string, defaultValue?: unknown) => defaultValue };
  const cache: CacheService = Reflect.construct(CacheService, [store, config]);
  const client = {
    invoke: jest.fn(), getMessages: jest.fn(), getInputEntity: jest.fn(),
    iterDownload: jest.fn(), downloadMedia: jest.fn(),
  };
  const release = jest.fn();
  const manager = { getOrInitializeClient: jest.fn(async () => client), retainClient: jest.fn(() => release) };
  const service: TelegramNestService = Reflect.construct(TelegramNestService, [cache, config, manager]);
  return { service, client, release, store, cache, manager };
}

describe("Raw Telegram library search", () => {
  it("preserves exact queries, order, video detection, and never downloads thumbnails", async () => {
    const { service, client, release } = setup();
    client.invoke.mockResolvedValue(page([video(1), video(2, "application/octet-stream", "episode.mkv"), video(3, "application/pdf", "file.pdf")]));
    const results = await service.searchLibrary(user, "  מסי: 100% + Messi  ");
    expect(client.invoke.mock.calls[0][0].q).toBe("  מסי: 100% + Messi  ");
    expect(results.map(r => r.messageId)).toEqual([1, 2]);
    expect(results[0].peer).toEqual(peer);
    expect(results[0].channelTitle).toBe("Channel");
    expect(results.map(r => r.uploadedAt)).toEqual([1600000000, 1600000000]);
    expect(client.iterDownload).not.toHaveBeenCalled();
    expect(client.downloadMedia).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("uses all cursor fields, removes repeated messages, and caps results at 100", async () => {
    const { service, client } = setup();
    const first = Array.from({ length: 100 }, (_, i) => video(i + 1, i < 70 ? "video/mp4" : "application/pdf", i < 70 ? "x.mp4" : "x.pdf"));
    client.invoke.mockResolvedValueOnce(page(first, true, 987));
    client.invoke.mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, i) => video(i + 50)), true));
    const results = await service.searchLibrary(user, "query");
    expect(results).toHaveLength(100);
    expect(new Set(results.map(r => r.messageId)).size).toBe(100);
    expect(client.invoke.mock.calls[1][0]).toMatchObject({ offsetId: 100, offsetRate: 987 });
    expect(client.invoke.mock.calls[1][0].offsetPeer).toBeInstanceOf(Api.InputPeerChannel);
  });

  it("stops after five pages even when all results are non-video", async () => {
    const { service, client } = setup();
    for (let n = 0; n < 5; n++) client.invoke.mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, i) => video(n * 100 + i + 1, "text/plain", "x.txt")), true, n));
    expect(await service.searchLibrary(user, "query")).toEqual([]);
    expect(client.invoke).toHaveBeenCalledTimes(5);
  });

  it("coalesces queries, caches for 60 seconds, and separates accounts and query text", async () => {
    const { service, client, store } = setup();
    client.invoke.mockResolvedValue(page([video(1)]));
    await Promise.all([service.searchLibrary(user, "Messi"), service.searchLibrary(user, "Messi")]);
    await service.searchLibrary(user, "Messi");
    expect(client.invoke).toHaveBeenCalledTimes(1);
    expect(store.set.mock.calls[0][2]).toBe(60000);
    await service.searchLibrary({ ...user, token: "account-b" }, "Messi");
    await service.searchLibrary(user, "messi");
    expect(client.invoke).toHaveBeenCalledTimes(3);
  });

  it("does not contact Telegram on empty searches or cache failed searches", async () => {
    const { service, client, release } = setup();
    expect(await service.searchLibrary(user, " \n ")).toEqual([]);
    expect(client.invoke).not.toHaveBeenCalled();
    client.invoke.mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce(page([]));
    await expect(service.searchLibrary(user, "query")).rejects.toThrow("unavailable");
    expect(await service.searchLibrary(user, "query")).toEqual([]);
    expect(client.invoke).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("returns collected results if a continuation fails", async () => {
    const { service, client } = setup();
    const messages = Array.from({ length: 100 }, (_, i) => video(i + 1, i ? "text/plain" : "video/mp4", i ? "a.txt" : "a.mp4"));
    client.invoke.mockResolvedValueOnce(page(messages, true)).mockRejectedValueOnce(new Error("FLOOD_WAIT"));
    expect(await service.searchLibrary(user, "query")).toHaveLength(1);
  });
});

describe("Library reads and on-demand thumbnails", () => {
  const signal = () => new AbortController().signal;
  const thumb = (size = 100) => new Api.PhotoSize({ type: "m", w: 320, h: 180, size });

  it("reads video metadata without cache or downloading media", async () => {
    const { service, client, release } = setup();
    client.getMessages.mockResolvedValue([video(9)]);
    expect(await service.getLibraryFile(user, peer, 9)).toMatchObject({ messageId: 9, caption: "Caption 9", uploadedAt: 1600000000 });
    expect(client.getMessages.mock.calls[0][0]).toBeInstanceOf(Api.InputPeerChannel);
    expect(client.iterDownload).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    client.getMessages.mockResolvedValue([]);
    expect(await service.getLibraryFile(user, peer, 9)).toBeNull();
    client.getMessages.mockRejectedValue({ errorMessage: "CHANNEL_PRIVATE" });
    expect(await service.getLibraryFile(user, peer, 9)).toBeNull();
    client.getMessages.mockRejectedValue(new Error("TIMEOUT"));
    await expect(service.getLibraryFile(user, peer, 9)).rejects.toThrow("TIMEOUT");
  });

  it("preserves the source name for fresh metadata and tolerates unavailable source details", async () => {
    const { service, client } = setup();
    const message = video(9);
    const getChat = jest.fn().mockResolvedValue(channel);
    Object.assign(message, { getChat });
    client.getMessages.mockResolvedValue([message]);
    expect(await service.getLibraryFile(user, peer, 9)).toMatchObject({ channelTitle: "Channel" });
    getChat.mockRejectedValue(new Error("Source unavailable"));
    expect(await service.getLibraryFile(user, peer, 9)).toMatchObject({ messageId: 9 });
  });

  it("downloads only an explicit thumbnail location, without writing a cache entry", async () => {
    const { service, client, store, release } = setup();
    client.getMessages.mockResolvedValue([video(9, "video/mp4", "a.mp4", [thumb()])]);
    client.iterDownload.mockImplementation(async function* () { yield Buffer.from("image"); });
    expect(await service.getLibraryThumbnail(user, peer, 9, signal())).toEqual(Buffer.from("image"));
    expect(client.iterDownload.mock.calls[0][0]).toBeInstanceOf(Api.InputDocumentFileLocation);
    expect(client.iterDownload.mock.calls[0][0].thumbSize).toBe("m");
    expect(store.set).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("falls back for missing, oversized, or failed thumbnails, without downloading the video", async () => {
    const { service, client } = setup();
    for (const thumbs of [[], [thumb(2097153)]]) {
      client.getMessages.mockResolvedValue([video(9, "video/mp4", "a.mp4", thumbs)]);
      expect(await service.getLibraryThumbnail(user, peer, 9, signal())).toBeNull();
    }
    expect(client.iterDownload).not.toHaveBeenCalled();
    client.getMessages.mockResolvedValue([video(9, "video/mp4", "a.mp4", [thumb()])]);
    client.iterDownload.mockImplementation(async function* () { yield Buffer.alloc(2097153); });
    expect(await service.getLibraryThumbnail(user, peer, 9, signal())).toBeNull();
    client.iterDownload.mockImplementation(async function* () { yield* []; throw new Error("download failed"); });
    expect(await service.getLibraryThumbnail(user, peer, 9, signal())).toBeNull();
  });

  it("allows at most four active thumbnail requests and releases slots afterward", async () => {
    const { service, client, release } = setup();
    let finish!: (messages: Api.Message[]) => void;
    const pending = new Promise<Api.Message[]>(resolve => { finish = resolve; });
    client.getMessages.mockReturnValue(pending);
    const active = Array.from({ length: 4 }, () => service.getLibraryThumbnail(user, peer, 9, signal()));
    expect(await service.getLibraryThumbnail(user, peer, 9, signal())).toBeNull();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(client.getMessages).toHaveBeenCalledTimes(4);
    finish([]);
    await Promise.all(active);
    await service.getLibraryThumbnail(user, peer, 9, signal());
    expect(release).toHaveBeenCalledTimes(5);
  });
});
