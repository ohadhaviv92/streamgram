import { EventEmitter } from "events";
import { Api } from "teleproto";
import { SenderSlot } from "teleproto/network/SenderSlot";
import { MTProtoSender } from "teleproto/network/MTProtoSender";
import { Logger } from "teleproto/extensions/Logger";
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

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("Missing expected test value");
  return value;
}

describe("Telegram live playback", () => {
  const channelId = "-1001981952129";
  const user = { token: "account-one", session_string: "session-one", language: "en" } as InstanceProfile;
  let live: LiveService;
  let events: EventEmitter;
  let accounts: Record<string, { sessionString: string; selectedLiveChannels: string[] }>;
  let invoke: jest.Mock;
  let send: jest.Mock;
  let release: jest.Mock;
  let releaseMedia: jest.Mock;
  let leaseMedia: jest.Mock;
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
    releaseMedia = jest.fn();
    leaseMedia = jest.fn(async () => ({ sender: { send, isConnected: () => true }, release: releaseMedia }));
    const client = {
      _leaseSender: leaseMedia,
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
    expect(live.asset(user, channelId, sessionId, filename)).toHaveLength(384);
    const other = { ...user, token: "account-two", session_string: "session-two" };
    accounts[other.token] = { sessionString: other.session_string, selectedLiveChannels: [channelId] };
    expect(() => live.asset(other, channelId, sessionId, filename)).toThrow(NotFoundException);
    expect(() => live.asset(user, channelId, "old-session", filename)).toThrow(NotFoundException);
    expect(() => live.asset(user, channelId, sessionId, "../private")).toThrow(NotFoundException);
    expect(release).not.toHaveBeenCalled();
  });

  it("starts with nine seconds buffered and a conservative live playback offset", async () => {
    const playlist = await live.playlist(user, channelId);
    expect(playlist.match(/#EXTINF/g)?.length).toBeGreaterThanOrEqual(3);
    expect(playlist).toContain("#EXT-X-START:TIME-OFFSET=-9.000,PRECISE=NO");
  });

  it("paces requests to the broadcast clock instead of repeatedly asking for future chunks", async () => {
    await live.playlist(user, channelId);
    await jest.advanceTimersByTimeAsync(0);
    const before = send.mock.calls.filter(([request]) => request instanceof Api.upload.GetFile).length;
    await jest.advanceTimersByTimeAsync(10_000);
    const after = send.mock.calls.filter(([request]) => request instanceof Api.upload.GetFile).length;
    expect(after - before).toBeLessThanOrEqual(12);
    expect(after - before).toBeGreaterThanOrEqual(9);
    expect(invoke.mock.calls.filter(([request]) => request instanceof Api.channels.GetFullChannel)).toHaveLength(1);
  });

  it("backs off late publications and keeps later requests aligned with the corrected clock", async () => {
    await live.playlist(user, channelId);
    await jest.advanceTimersByTimeAsync(0);
    const original = required(send.getMockImplementation());
    let missing = 0;
    send.mockImplementation(request => {
      if (request instanceof Api.upload.GetFile && missing++ < 3) return Promise.reject({ errorMessage: "TIME_TOO_BIG" });
      return original(request);
    });
    const before = send.mock.calls.length;
    await jest.advanceTimersByTimeAsync(3000);
    const requests = send.mock.calls.slice(before).map(([request]) => request).filter(request => request instanceof Api.upload.GetFile);
    expect(requests.length).toBeLessThanOrEqual(5);
    const firstLocations = requests.slice(0, 4).map(request => {
      if (!(request.location instanceof Api.InputGroupCallStream)) throw new Error("Expected live chunk");
      return request.location.timeMs.toString();
    });
    expect(new Set(firstLocations).size).toBe(1);
    const after = send.mock.calls.length;
    await jest.advanceTimersByTimeAsync(5000);
    expect(send.mock.calls.length - after).toBeLessThanOrEqual(6);
    expect(release).not.toHaveBeenCalled();
  });

  it("keeps playing through variable download latency without creating a retry storm", async () => {
    const original = required(send.getMockImplementation());
    let downloads = 0;
    send.mockImplementation(async request => {
      if (request instanceof Api.upload.GetFile) {
        const duration = ++downloads % 7 === 0 ? 1500 : 700;
        await new Promise(resolve => setTimeout(resolve, duration));
      }
      return original(request);
    });
    const opening = live.playlist(user, channelId);
    await jest.advanceTimersByTimeAsync(9000);
    expect((await opening).match(/#EXTINF/g)?.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 24; i++) {
      await jest.advanceTimersByTimeAsync(5000);
      const playlist = await live.playlist(user, channelId);
      const [sessionId, file] = required(playlist.trim().split("\n").at(-1)).split("/");
      expect(live.asset(user, channelId, sessionId, file)).toHaveLength(384);
      expect(release).not.toHaveBeenCalled();
    }
    expect(downloads).toBeLessThanOrEqual(145);
    expect(invoke.mock.calls.filter(([request]) => request instanceof Api.phone.JoinGroupCall)).toHaveLength(1);
  });

  it("bounds the playlist and stops after thirty seconds without viewer requests", async () => {
    const first = await live.playlist(user, channelId);
    await jest.advanceTimersByTimeAsync(27_000);
    const current = await live.playlist(user, channelId);
    expect(current.match(/#EXTINF/g)?.length).toBe(4);
    const [sessionId, filename] = (first.trim().split("\n").at(-1) || "").split("/");
    expect(() => live.asset(user, channelId, sessionId, filename)).toThrow(NotFoundException);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(release).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls.some(([request]) => request instanceof Api.phone.LeaveGroupCall)).toBe(true);
  });

  it("keeps segments from an older playlist available while a viewer catches up", async () => {
    await live.playlist(user, channelId);
    await jest.advanceTimersByTimeAsync(12_000);
    const playlist = await live.playlist(user, channelId);
    const uri = required(playlist.split("\n").find(line => line.endsWith(".m4s")));
    const [sessionId, filename] = uri.split("/");
    await jest.advanceTimersByTimeAsync(10_000);
    expect(await live.playlist(user, channelId)).not.toContain(uri);
    expect(live.asset(user, channelId, sessionId, filename)).toHaveLength(384);
  });

  it("retains old initialization maps through codec changes until their segments expire", async () => {
    const first = await live.playlist(user, channelId);
    const sessionId = required(first.match(/URI="([^/]+)\//))[1];
    jest.mocked(remuxLivePart).mockReturnValue({ init: Buffer.from("new-init"), media: Buffer.alloc(128), signature: "codec-two", startsWithKeyframe: true });
    await jest.advanceTimersByTimeAsync(13_000);
    const current = await live.playlist(user, channelId);
    expect(current).not.toContain("init-0.mp4");
    expect(live.asset(user, channelId, sessionId, "init-0.mp4")).toEqual(Buffer.from("init"));
    await jest.advanceTimersByTimeAsync(18_000);
    expect(() => live.asset(user, channelId, sessionId, "init-0.mp4")).toThrow(NotFoundException);
  });

  it("stops after the last viewer leaves even when a media-DC read never finishes", async () => {
    const first = await live.playlist(user, channelId);
    await jest.advanceTimersByTimeAsync(29_000);
    let finishRead!: (value: Api.upload.File) => void;
    send.mockImplementationOnce(() => new Promise<Api.upload.File>(resolve => { finishRead = resolve; }));
    await jest.advanceTimersByTimeAsync(1000);
    expect(release).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls.filter(([request]) => request instanceof Api.phone.LeaveGroupCall)).toHaveLength(1);
    const restarted = await live.playlist(user, channelId);
    expect(restarted).not.toBe(first);
    expect(Number(required(restarted.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/))[1])).toBeGreaterThan(0);
    expect(invoke.mock.calls.filter(([request]) => request instanceof Api.phone.JoinGroupCall)).toHaveLength(2);
    finishRead(new Api.upload.File({ bytes: Buffer.alloc(16) } as never));
    await jest.advanceTimersByTimeAsync(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("keeps the shared receiver alive while another viewer still requests segments", async () => {
    await live.playlist(user, channelId);
    for (let i = 0; i < 4; i++) {
      await jest.advanceTimersByTimeAsync(20_000);
      const playlist = await live.playlist(user, channelId);
      const [sessionId, filename] = required(playlist.trim().split("\n").at(-1)).split("/");
      expect(live.asset(user, channelId, sessionId, filename)).toHaveLength(384);
      expect(release).not.toHaveBeenCalled();
    }
    await jest.advanceTimersByTimeAsync(30_000);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("serves delayed playlist segments throughout ten minutes of continuous viewing", async () => {
    await live.playlist(user, channelId);
    await jest.advanceTimersByTimeAsync(12_000);
    for (let i = 0; i < 60; i++) {
      const playlist = await live.playlist(user, channelId);
      const [sessionId, filename] = required(playlist.split("\n").find(line => line.endsWith(".m4s"))).split("/");
      await jest.advanceTimersByTimeAsync(10_000);
      expect(live.asset(user, channelId, sessionId, filename)).toHaveLength(384);
      expect(release).not.toHaveBeenCalled();
    }
    expect(invoke.mock.calls.filter(([request]) => request instanceof Api.phone.JoinGroupCall)).toHaveLength(1);
  });

  it("bounds catch-up bursts without evicting segments still promised to viewers", async () => {
    let downloads = 0;
    send.mockImplementation(async request => {
      if (request instanceof Api.phone.GetGroupCallStreamChannels) return new Api.phone.GroupCallStreamChannels({ channels: [new Api.GroupCallStreamChannel({ channel: 1, scale: 0, lastTimestampMs: bigInt(Date.now() + 300_000) })] });
      // Repeated source resynchronizations can produce bursts of already
      // available media. They must not evict promised HLS assets prematurely.
      if (++downloads % 9 === 0) throw { errorMessage: "TIME_TOO_SMALL" };
      return new Api.upload.File({ bytes: Buffer.alloc(16) } as never);
    });
    jest.mocked(remuxLivePart).mockReturnValue({ init: Buffer.from("init"), media: Buffer.alloc(1024 * 1024), signature: "codec-one", startsWithKeyframe: true });
    const playlist = await live.playlist(user, channelId);
    const [sessionId, filename] = required(playlist.split("\n").find(line => line.endsWith(".m4s"))).split("/");
    await jest.advanceTimersByTimeAsync(13_000);
    const session = (live as unknown as { sessions: Map<string, { segments: Array<{ media: Buffer }> }> }).sessions.values().next().value;
    const buffered = required(session).segments;
    expect(buffered.length).toBeLessThanOrEqual(48);
    expect(buffered.reduce((size, segment) => size + segment.media.length, 0)).toBeLessThanOrEqual(48 * 1024 * 1024);
    expect(live.asset(user, channelId, sessionId, filename)).toHaveLength(3 * 1024 * 1024);
    const calls = jest.mocked(remuxLivePart).mock.calls.length;
    await jest.advanceTimersByTimeAsync(1000);
    expect(jest.mocked(remuxLivePart).mock.calls.length - calls).toBeLessThanOrEqual(1);
    await jest.advanceTimersByTimeAsync(13_000);
    expect(jest.mocked(remuxLivePart).mock.calls.length).toBeGreaterThan(calls);
    expect(release).not.toHaveBeenCalled();
  });

  it("releases the managed client even if Telegram never acknowledges leaving", async () => {
    await live.playlist(user, channelId);
    const original = required(invoke.getMockImplementation());
    invoke.mockImplementation(request => request instanceof Api.phone.LeaveGroupCall ? new Promise(() => {}) : original(request));
    await jest.advanceTimersByTimeAsync(30_000);
    expect(release).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(5000);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("holds teleproto's media-DC lease so its sixty-second idle cleanup cannot interrupt viewing", async () => {
    const disconnectMedia = jest.fn(async () => {});
    const slot = new SenderSlot({ dcId: 4, idleTimeoutMs: 60_000, log: {} as Logger,
      connect: async () => ({ send, isConnected: () => true, disconnect: disconnectMedia, hasPendingWork: false } as unknown as MTProtoSender),
    });
    const client = await getClient();
    client.getSender = () => slot.ensureConnected();
    client._leaseSender = async () => {
      const sender = await slot.ensureConnected();
      slot.enter();
      return { sender, release: () => { releaseMedia(); slot.leave(); } };
    };
    await live.playlist(user, channelId);
    for (let i = 0; i < 5; i++) {
      await jest.advanceTimersByTimeAsync(20_000);
      await live.playlist(user, channelId);
      expect(disconnectMedia).not.toHaveBeenCalled();
    }
    expect(releaseMedia).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(releaseMedia).toHaveBeenCalledTimes(1);
    await slot.markDead("manual");
  });

  it("reacquires a disconnected media sender without replacing the HLS session", async () => {
    const first = await live.playlist(user, channelId);
    leaseMedia.mock.results[0].value.then((lease: { sender: { isConnected: () => boolean } }) => { lease.sender.isConnected = () => false; });
    send.mockRejectedValueOnce(new Error("Media sender disconnected"));
    await jest.advanceTimersByTimeAsync(1500);
    const recovered = await live.playlist(user, channelId);
    expect(required(recovered.match(/URI="([^/]+)\//))[1]).toBe(required(first.match(/URI="([^/]+)\//))[1]);
    expect(leaseMedia).toHaveBeenCalledTimes(2);
    expect(releaseMedia).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
  });

  it("releases a media lease that arrives after startup has timed out", async () => {
    let connected!: (lease: { sender: { send: jest.Mock; isConnected?: () => boolean }; release: jest.Mock }) => void;
    leaseMedia.mockImplementationOnce(() => new Promise(resolve => { connected = resolve; }));
    const opening = live.playlist(user, channelId).catch(error => error);
    await jest.advanceTimersByTimeAsync(10_001);
    expect(await opening).toBeInstanceOf(Error);
    expect(release).toHaveBeenCalledTimes(1);
    connected({ sender: { send, isConnected: () => true }, release: releaseMedia });
    await jest.advanceTimersByTimeAsync(1);
    expect(releaseMedia).toHaveBeenCalledTimes(1);
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

  it.each(["GROUPCALL_JOIN_MISSING", "GROUPCALL_FORBIDDEN"])("rejoins after %s and retries the same chunk without rewinding playback", async code => {
    const first = await live.playlist(user, channelId);
    send.mockRejectedValueOnce({ errorMessage: code });
    const before = send.mock.calls.length;
    await jest.advanceTimersByTimeAsync(1500);
    const requests = send.mock.calls.slice(before).map(([request]) => request);
    const chunks = requests.filter(request => request instanceof Api.upload.GetFile);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const times = chunks.map(request => {
      if (!(request.location instanceof Api.InputGroupCallStream)) throw new Error("Expected live media location");
      return request.location.timeMs.toString();
    });
    expect(times[1]).toBe(times[0]);
    expect(requests.some(request => request instanceof Api.phone.GetGroupCallStreamChannels)).toBe(false);
    expect(invoke.mock.calls.filter(([request]) => request instanceof Api.phone.JoinGroupCall)).toHaveLength(2);
    expect(invoke.mock.calls.filter(([request]) => request instanceof Api.channels.GetFullChannel)).toHaveLength(1);
    expect(leaseMedia).toHaveBeenCalledTimes(1);
    const current = await live.playlist(user, channelId);
    expect(required(current.match(/URI="([^/]+)\//))[1]).toBe(required(first.match(/URI="([^/]+)\//))[1]);
    expect(current).not.toContain("#EXT-X-DISCONTINUITY\n");
    expect(release).not.toHaveBeenCalled();
  });

  it("recovers from consecutive media timeouts without replacing the viewer's HLS session", async () => {
    const first = await live.playlist(user, channelId);
    const original = required(send.getMockImplementation());
    let stalled = 0;
    send.mockImplementation(request => {
      if (request instanceof Api.upload.GetFile && stalled++ < 2) return new Promise(() => {});
      return original(request);
    });
    await jest.advanceTimersByTimeAsync(23_000);
    const recovered = await live.playlist(user, channelId);
    expect(required(recovered.match(/URI="([^/]+)\//))[1]).toBe(required(first.match(/URI="([^/]+)\//))[1]);
    expect(recovered).not.toContain("#EXT-X-DISCONTINUITY\n");
    expect(release).not.toHaveBeenCalled();
  });

  it("keeps HLS sequence numbers increasing when a failed receiver is replaced", async () => {
    await live.playlist(user, channelId);
    await jest.advanceTimersByTimeAsync(5000);
    const before = await live.playlist(user, channelId);
    const last = Number(required(required(before.trim().split("\n").at(-1)).match(/segment-(\d+)/))[1]);
    callId = 11;
    send.mockRejectedValueOnce({ errorMessage: "GROUPCALL_INVALID" });
    await jest.advanceTimersByTimeAsync(1000);
    expect(release).toHaveBeenCalledTimes(1);
    jest.mocked(remuxLivePart).mockReturnValueOnce({ init: Buffer.from("init"), media: Buffer.alloc(128), signature: "codec-one", startsWithKeyframe: false });
    const reopening = live.playlist(user, channelId);
    await jest.advanceTimersByTimeAsync(2000);
    const next = await reopening;
    expect(Number(required(next.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/))[1])).toBeGreaterThan(last);
    expect(Number(required(next.match(/#EXT-X-DISCONTINUITY-SEQUENCE:(\d+)/))[1])).toBeGreaterThan(0);
    expect(required(next.match(/URI="([^/]+)\//))[1]).not.toBe(required(before.match(/URI="([^/]+)\//))[1]);
  });

  it("expires inactive HLS timelines and clears them immediately when account access changes", async () => {
    const timelines = (live as unknown as { timelines: Map<string, unknown> }).timelines;
    await live.playlist(user, channelId);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(timelines.size).toBe(1);
    await jest.advanceTimersByTimeAsync(15 * 60_000 + 1000);
    expect(timelines.size).toBe(0);
    await live.playlist(user, channelId);
    accounts[user.token].selectedLiveChannels = [];
    events.emit("accountsChanged");
    await jest.advanceTimersByTimeAsync(1);
    expect(timelines.size).toBe(0);
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
