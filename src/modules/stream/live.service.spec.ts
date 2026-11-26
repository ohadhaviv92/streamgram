import { EventEmitter } from "events";
import { Api } from "teleproto";
import bigInt from "big-integer";
import { NotFoundException } from "@nestjs/common";
import { LiveService } from "./live.service";
import { remuxLivePart, UnsupportedLiveMediaError } from "./live-remux";
import { InstanceProfile } from "../user/instance-profile";
import { InstanceConfigService } from "../user/instance-config.service";
import { TelegramClientManager } from "../telegram/telegram-client.manager";

jest.mock("./live-remux", () => {
  const actual = jest.requireActual("./live-remux");
  return { ...actual, remuxLivePart: jest.fn() };
});

// timers/promises uses Node's internal scheduler; adapt it to Jest's clock.
jest.mock("timers/promises", () => ({
  setTimeout: (ms: number, _value: unknown, { signal }: { signal: AbortSignal }) => new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new Error("Aborted")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  }),
}));

describe("Telegram live playback", () => {
  const channelId = "-1001981952129";
  const user = { token: "account-one", session_string: "session-one", language: "en" } as InstanceProfile;
  let live: LiveService;
  let events: EventEmitter;
  let accounts: Record<string, { sessionString: string; selectedLiveChannels: string[] }>;
  let invoke: jest.Mock;
  let send: jest.Mock;
  let release: jest.Mock;
  let getClient: jest.Mock;
  let downloadPhoto: jest.Mock;
  let getDialogs: jest.Mock;
  let disconnect: () => void;
  let state: "live" | "offline" | "scheduled" | "unsupported";
  let callId: number;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_700_000_000_000);
    state = "live";
    callId = 10;
    events = new EventEmitter();
    accounts = { [user.token]: { sessionString: user.session_string, selectedLiveChannels: [channelId] } };
    jest.mocked(remuxLivePart).mockReset().mockReturnValue({ init: Buffer.from("init"), media: Buffer.alloc(128), signature: "codec-one", startsWithKeyframe: true });
    invoke = jest.fn(async request => {
      if (request instanceof Api.channels.GetFullChannel) return { fullChat: new Api.ChannelFull({ call: state === "offline" ? undefined : new Api.InputGroupCall({ id: bigInt(callId), accessHash: bigInt(20) }) } as never) };
      if (request instanceof Api.phone.GetGroupCall) return { call: new Api.GroupCall({ id: bigInt(callId), rtmpStream: state !== "unsupported", streamDcId: 4, scheduleDate: state === "scheduled" ? 1_800_000_000 : undefined } as never) };
      if (request instanceof Api.phone.JoinGroupCall) return new Api.Updates({ updates: [new Api.UpdateGroupCallConnection({ params: new Api.DataJSON({ data: '{"stream":true,"rtmp":true}' }) })] } as never);
      return {};
    });
    send = jest.fn(async request => {
      if (request instanceof Api.phone.GetGroupCallStreamChannels) return new Api.phone.GroupCallStreamChannels({ channels: [new Api.GroupCallStreamChannel({ channel: 1, scale: 0, lastTimestampMs: bigInt(Date.now()) })] });
      if (Number(request.location.timeMs.toString()) > Date.now()) throw { errorMessage: "TIME_TOO_BIG" };
      return new Api.upload.File({ bytes: Buffer.alloc(16) } as never);
    });
    downloadPhoto = jest.fn(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    getDialogs = jest.fn(async () => [{ entity: new Api.Channel({ id: bigInt("1981952129"), title: "Test TV" } as never) }]);
    const client = {
      downloadProfilePhoto: downloadPhoto,
      getDialogs,
      getEntity: jest.fn(async () => new Api.Channel({ id: bigInt("1981952129"), title: "Test TV" } as never)),
      getInputEntity: jest.fn(async () => new Api.InputPeerChannel({ channelId: bigInt("1981952129"), accessHash: bigInt(20) })),
      invoke, getSender: jest.fn(async () => ({ send })), connected: true,
      onDisconnect: (handler: () => void) => { disconnect = handler; return jest.fn(); },
    };
    release = jest.fn();
    getClient = jest.fn(async () => client);
    live = new LiveService({ getOrInitializeClient: getClient, retainClient: () => release } as unknown as TelegramClientManager,
      { events, getUserByToken: (token: string) => accounts[token] } as unknown as InstanceConfigService);
  });

  afterEach(async () => { await live.onApplicationShutdown(); jest.useRealTimers(); });

  it.each(["live", "offline", "scheduled", "unsupported"] as const)("shows %s channels without joining during browsing", async value => {
    state = value;
    const { metas } = await live.catalog(user, "https://example.test/account-one");
    expect(metas).toHaveLength(1);
    expect(metas[0]?.id).toBe(`tg_live_${channelId}`);
    expect(metas[0]?.name).toBe("Test TV");
    expect(invoke).not.toHaveBeenCalled();
    expect(await live.status(user, channelId)).toMatchObject({ state: value });
    expect(invoke.mock.calls.some(([request]) => request instanceof Api.phone.JoinGroupCall)).toBe(false);
    expect(JSON.stringify(metas)).not.toMatch(/session-one|accessHash/);
  });

  it("keeps unavailable channels visible and rejects channels outside the account's selection", async () => {
    getClient.mockRejectedValue(new Error("Telegram unavailable"));
    expect((await live.catalog(user, "https://example.test")).metas[0]?.name).toBe(`Channel ${channelId}`);
    expect(await live.streams(user, channelId, "https://example.test")).toEqual({ streams: [] });
    expect(await live.meta(user, "-100999", "https://example.test")).toBeNull();
    await expect(live.playlist(user, "-100999")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("shares dialog discovery and never probes active calls while catalogs or metadata are browsed", async () => {
    const secondId = "-1002230051689";
    accounts[user.token].selectedLiveChannels.push(secondId);
    getDialogs.mockResolvedValue([
      { entity: new Api.Channel({ id: bigInt("1981952129"), title: "Test TV" } as never) },
      { entity: new Api.Channel({ id: bigInt("2230051689"), title: "Another TV" } as never) },
    ]);
    const [first, second, meta] = await Promise.all([
      live.catalog(user, "https://example.test"), live.catalog(user, "https://example.test"),
      live.meta(user, secondId, "https://example.test"),
    ]);
    expect(first.metas.map(item => item?.name)).toEqual(["Test TV", "Another TV"]);
    expect(second).toEqual(first);
    expect(meta?.name).toBe("Another TV");
    await jest.advanceTimersByTimeAsync(60_000);
    await live.catalog(user, "https://example.test");
    expect(getDialogs).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("rechecks live status before returning a single HLS stream, without joining", async () => {
    await live.status(user, channelId);
    state = "offline";
    expect(await live.streams(user, channelId, "https://example.test")).toEqual({ streams: [] });
    state = "live";
    const result = await live.streams(user, channelId, "https://example.test");
    expect(result.streams).toHaveLength(1);
    expect(result.streams[0].url).toBe(`https://example.test/live/${channelId}/index.m3u8`);
    expect(invoke.mock.calls.some(([request]) => request instanceof Api.phone.JoinGroupCall)).toBe(false);
  });

  it("uses the channel's own square thumbnail and fetches its full-size Telegram photo on demand", async () => {
    const meta = await live.meta(user, channelId, "https://example.test/account-one");
    expect(meta).toMatchObject({ type: "tv", poster: `https://example.test/account-one/live/${channelId}/thumbnail.jpg`, posterShape: "square", behaviorHints: { isLive: true } });
    expect(downloadPhoto).not.toHaveBeenCalled();
    expect(await live.thumbnail(user, channelId)).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    expect(downloadPhoto).toHaveBeenCalledWith(expect.any(Api.Channel), { isBig: true });
    expect(invoke.mock.calls.some(([request]) => request instanceof Api.phone.JoinGroupCall)).toBe(false);
    await expect(live.thumbnail(user, "-100999")).rejects.toBeInstanceOf(NotFoundException);
    expect(downloadPhoto).toHaveBeenCalledTimes(1);
  });

  it("allows a missing channel photo to use the fallback and releases failed thumbnail requests", async () => {
    downloadPhoto.mockResolvedValueOnce(undefined);
    expect(await live.thumbnail(user, channelId)).toBeNull();
    downloadPhoto.mockRejectedValueOnce(new Error("Telegram unavailable"));
    await expect(live.thumbnail(user, channelId)).rejects.toThrow("thumbnail is temporarily unavailable");
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("shares a receiver across viewers and isolates segment URLs by account and session", async () => {
    const [first, second] = await Promise.all([live.playlist(user, channelId), live.playlist(user, channelId)]);
    expect(first).toBe(second);
    expect(first).toContain("#EXT-X-MEDIA-SEQUENCE:0");
    expect(invoke.mock.calls.filter(([request]) => request instanceof Api.phone.JoinGroupCall)).toHaveLength(1);
    const [sessionId, filename] = (first.trim().split("\n").at(-1) || "").split("/");
    expect(live.asset(user, channelId, sessionId, filename)).toHaveLength(128);
    const other = { ...user, token: "account-two", session_string: "session-two" };
    accounts[other.token] = { sessionString: other.session_string, selectedLiveChannels: [channelId] };
    expect(() => live.asset(other, channelId, sessionId, filename)).toThrow(NotFoundException);
    expect(() => live.asset(user, channelId, "old-session", filename)).toThrow(NotFoundException);
    expect(() => live.asset(user, channelId, sessionId, "../private")).toThrow(NotFoundException);
    expect(release).not.toHaveBeenCalled();
  });

  it("bounds the playlist and stops after thirty seconds without viewer requests", async () => {
    const first = await live.playlist(user, channelId);
    await jest.advanceTimersByTimeAsync(20_000);
    const current = await live.playlist(user, channelId);
    expect(current.match(/#EXTINF/g)?.length).toBe(12);
    const [sessionId, filename] = (first.trim().split("\n").at(-1) || "").split("/");
    expect(() => live.asset(user, channelId, sessionId, filename)).toThrow(NotFoundException);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(release).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls.some(([request]) => request instanceof Api.phone.LeaveGroupCall)).toBe(true);
  });

  it.each(["deleted", "replaced", "deselected", "restore", "disconnect"])("releases the receiver when %s", async cause => {
    await live.playlist(user, channelId);
    if (cause === "deleted") delete accounts[user.token];
    if (cause === "replaced") accounts[user.token].sessionString = "new-session";
    if (cause === "deselected") accounts[user.token].selectedLiveChannels = [];
    if (cause === "restore") events.emit("securityChanged");
    else if (cause === "disconnect") disconnect();
    else events.emit("accountsChanged");
    await jest.advanceTimersByTimeAsync(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("marks unsupported codecs without offering a broken playback stream", async () => {
    jest.mocked(remuxLivePart).mockImplementation(() => { throw new UnsupportedLiveMediaError("codec"); });
    await expect(live.playlist(user, channelId)).rejects.toThrow("Live playback ended");
    expect(release).toHaveBeenCalledTimes(1);
    expect(await live.status(user, channelId, true)).toMatchObject({ state: "unsupported" });
    expect(await live.streams(user, channelId, "https://example.test")).toEqual({ streams: [] });
    expect(release).toHaveBeenCalledTimes(3);
  });

  it("rejoins on lost membership and resynchronizes the HLS timeline", async () => {
    await live.playlist(user, channelId);
    send.mockRejectedValueOnce({ errorMessage: "GROUPCALL_JOIN_MISSING" });
    await jest.advanceTimersByTimeAsync(1500);
    expect(invoke.mock.calls.filter(([request]) => request instanceof Api.phone.JoinGroupCall)).toHaveLength(2);
    expect(await live.playlist(user, channelId)).toContain("#EXT-X-DISCONTINUITY");
  });

  it("does not poll full channel details during healthy playback and detects a replaced call on an RPC error", async () => {
    await live.playlist(user, channelId);
    await jest.advanceTimersByTimeAsync(11_000);
    expect(invoke.mock.calls.filter(([request]) => request instanceof Api.channels.GetFullChannel)).toHaveLength(1);
    expect(release).not.toHaveBeenCalled();
    callId = 11;
    send.mockRejectedValueOnce({ errorMessage: "GROUPCALL_INVALID" });
    await jest.advanceTimersByTimeAsync(1000);
    expect(invoke.mock.calls.filter(([request]) => request instanceof Api.channels.GetFullChannel)).toHaveLength(2);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
