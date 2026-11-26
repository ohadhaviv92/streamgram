import { Injectable, NotFoundException, OnApplicationShutdown, ServiceUnavailableException } from "@nestjs/common";
import { Api, TelegramClient, utils } from "teleproto";
import bigInt from "big-integer";
import { randomBytes, randomInt } from "crypto";
import { setTimeout as delay } from "timers/promises";
import { TelegramClientManager } from "../telegram/telegram-client.manager";
import { InstanceConfigService } from "../user/instance-config.service";
import { InstanceProfile, SupportedLanguage } from "../user/instance-profile";
import { remuxLivePart, UnsupportedLiveMediaError } from "./live-remux";
import { logger } from "../../logger";

export type LiveState = "live" | "offline" | "scheduled" | "unsupported" | "unavailable";
export type LiveItemType = "tv" | "movie";
export interface LiveChannelStatus { channelId: string; title: string; state: LiveState; scheduledAt?: number }
interface Broadcast extends LiveChannelStatus { call?: Api.InputGroupCall; dcId?: number }
interface Segment { sequence: number; epoch: number; media: Buffer; expiresAt?: number }
interface LiveTimeline {
  token: string;
  channelId: string;
  sessionString: string;
  sequence: number;
  epoch: number;
  expiresAt: number;
}
interface LiveSession {
  id: string;
  user: InstanceProfile;
  channelId: string;
  timeline: LiveTimeline;
  abort: AbortController;
  touchedAt: number;
  segments: Segment[];
  inits: Map<number, Buffer>;
  ready: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  runner?: Promise<void>;
}

const PLAYLIST_SEGMENTS = 12;
const STARTUP_SEGMENTS = 6;
const SOURCE_BUFFER_MS = 8000;
const CHUNK_PUBLISH_MARGIN_MS = 250;
const NOT_READY_RETRY_MS = 500;
// RFC 8216 section 6.2.2: retain removed media for a full playlist plus
// its own duration, including the initialization map it still references.
const RETIRED_SEGMENT_MS = (PLAYLIST_SEGMENTS + 1) * 1000;
const MAX_BUFFERED_SEGMENTS = 48;
const MAX_BUFFERED_BYTES = 48 * 1024 * 1024;

/** A stuck media-DC read must not hold a receiver/client after viewers leave.
 * This cancels our wait, not the shared Telegram transport or other viewers.
 */
function waitForLiveRequest<T>(request: Promise<T> | undefined, signal?: AbortSignal, timeoutMs = 10_000): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, value?: T) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(new Error("Live request stopped"));
    const timer = setTimeout(() => finish(new Error("Live request timed out")), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    Promise.resolve(request).then(value => finish(undefined, value), error => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(error); });
    if (signal?.aborted) abort();
  });
}

const labels: Record<SupportedLanguage, Record<LiveState, string>> = {
  en: { live: "Live", offline: "Offline", scheduled: "Scheduled", unsupported: "Unsupported live format", unavailable: "Temporarily unavailable" },
  he: { live: "בשידור חי", offline: "לא בשידור", scheduled: "שידור מתוזמן", unsupported: "פורמט שידור לא נתמך", unavailable: "לא זמין כרגע" },
  ru: { live: "В эфире", offline: "Не в эфире", scheduled: "Запланировано", unsupported: "Формат эфира не поддерживается", unavailable: "Временно недоступно" },
  ar: { live: "مباشر", offline: "غير متصل", scheduled: "مجدول", unsupported: "تنسيق البث غير مدعوم", unavailable: "غير متاح مؤقتًا" },
  es: { live: "En directo", offline: "Sin emisión", scheduled: "Programado", unsupported: "Formato de emisión no compatible", unavailable: "No disponible temporalmente" },
};

@Injectable()
export class LiveService implements OnApplicationShutdown {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly timelines = new Map<string, LiveTimeline>();
  private readonly receivers = new Set<Promise<void>>();
  private readonly peersReady = new WeakMap<TelegramClient, Promise<unknown>>();
  private readonly channelTitles = new WeakMap<TelegramClient, Map<string, string>>();
  private readonly statuses = new Map<string, { until: number; value: Broadcast }>();
  private readonly unsupported = new Map<string, string>();
  private readonly cleanup: ReturnType<typeof setInterval>;
  private shuttingDown = false;
  private readonly securityChanged = () => { for (const session of this.sessions.values()) this.stop(session); this.statuses.clear(); this.unsupported.clear(); this.timelines.clear(); };
  private readonly accountsChanged = () => {
    this.statuses.clear();
    this.unsupported.clear();
    for (const session of this.sessions.values()) {
      const account = this.config.getUserByToken(session.user.token);
      if (!account || account.sessionString !== session.user.session_string || !account.selectedLiveChannels?.includes(session.channelId)) this.stop(session);
    }
    for (const [key, timeline] of this.timelines) {
      const account = this.config.getUserByToken(timeline.token);
      if (!account || account.sessionString !== timeline.sessionString || !account.selectedLiveChannels?.includes(timeline.channelId)) this.timelines.delete(key);
    }
  };

  constructor(private readonly manager: TelegramClientManager, private readonly config: InstanceConfigService) {
    this.config.events.on("accountsChanged", this.accountsChanged);
    this.config.events.on("securityChanged", this.securityChanged);
    this.cleanup = setInterval(() => {
      for (const session of this.sessions.values()) {
        if (Date.now() - session.touchedAt >= 30_000) this.stop(session);
        else this.pruneSegments(session);
      }
      for (const [key, timeline] of this.timelines) {
        if (!this.sessions.has(key) && timeline.expiresAt <= Date.now()) this.timelines.delete(key);
      }
    }, 1000);
    this.cleanup.unref();
  }

  private key(user: InstanceProfile, channelId: string) { return `${user.token}:${channelId}`; }

  private assertSelected(user: InstanceProfile, channelId: string) {
    const account = this.config.getUserByToken(user.token);
    if (!/^-100[1-9]\d{0,16}$/.test(channelId) || !account || account.sessionString !== user.session_string
      || !account.selectedLiveChannels?.includes(channelId)) throw new NotFoundException("Live channel not selected");
  }

  private async preparePeers(client: TelegramClient): Promise<void> {
    // StringSession does not persist peer access hashes across restarts.
    // Warm the managed client's entities once, sharing concurrent discovery.
    let peers = this.peersReady.get(client);
    if (!peers) {
      peers = client.getDialogs({ limit: 500 }).then(dialogs => {
        const titles = new Map<string, string>();
        for (const dialog of dialogs) {
          if (dialog.entity instanceof Api.Channel) titles.set(utils.getPeerId(dialog.entity), dialog.entity.title);
        }
        this.channelTitles.set(client, titles);
      });
      this.peersReady.set(client, peers);
      void peers.catch(() => this.peersReady.delete(client));
    }
    await peers;
  }

  private async inspect(client: TelegramClient, channelId: string): Promise<Broadcast> {
    await this.preparePeers(client);
    const entity = await client.getEntity(channelId);
    if (!(entity instanceof Api.Channel) || utils.getPeerId(entity) !== channelId) throw new Error("Channel unavailable");
    const full = await client.invoke(new Api.channels.GetFullChannel({ channel: await client.getInputEntity(entity) }));
    const base = { channelId, title: entity.title };
    const call = full.fullChat instanceof Api.ChannelFull ? full.fullChat.call : undefined;
    if (!call) return { ...base, state: "offline" };
    if (!(call instanceof Api.InputGroupCall)) return { ...base, state: "unsupported" };
    const details = await client.invoke(new Api.phone.GetGroupCall({ call, limit: 1 }));
    if (details.call instanceof Api.GroupCallDiscarded) return { ...base, state: "offline" };
    if (details.call.scheduleDate) return { ...base, state: "scheduled", scheduledAt: details.call.scheduleDate };
    if (!details.call.rtmpStream || !details.call.streamDcId) return { ...base, state: "unsupported" };
    return { ...base, state: "live", call, dcId: details.call.streamDcId };
  }

  async status(user: InstanceProfile, channelId: string, fresh = false): Promise<LiveChannelStatus> {
    this.assertSelected(user, channelId);
    const key = this.key(user, channelId);
    const cached = this.statuses.get(key);
    if (!fresh && cached && cached.until > Date.now()) return this.publicStatus(cached.value);
    let value: Broadcast;
    let release: (() => void) | undefined;
    try {
      const client = await this.manager.getOrInitializeClient(user.token, user.session_string);
      release = this.manager.retainClient(client);
      value = await this.inspect(client, channelId);
      if (value.call && this.unsupported.get(key) === value.call.id.toString()) value.state = "unsupported";
    } catch {
      value = { channelId, title: cached?.value.title || `Channel ${channelId}`, state: "unavailable" };
    } finally { release?.(); }
    this.statuses.set(key, { until: Date.now() + 15_000, value });
    return this.publicStatus(value);
  }

  private publicStatus(value: Broadcast): LiveChannelStatus {
    return { channelId: value.channelId, title: value.title, state: value.state, ...(value.scheduledAt ? { scheduledAt: value.scheduledAt } : {}) };
  }

  async catalog(user: InstanceProfile, base: string, type: LiveItemType = "tv") {
    const ids = this.config.getUserByToken(user.token)?.selectedLiveChannels ?? [];
    const metas = [];
    // Limit Telegram RPC concurrency for large selections.
    for (let offset = 0; offset < ids.length; offset += 4) {
      metas.push(...await Promise.all(ids.slice(offset, offset + 4).map(id => this.meta(user, id, base, type))));
    }
    return { metas: metas.filter(Boolean) };
  }

  async meta(user: InstanceProfile, channelId: string, base: string, type: LiveItemType = "tv") {
    try { this.assertSelected(user, channelId); } catch { return null; }
    // Browsing must not probe every channel's active call. One shared dialog
    // list supplies names; only a stream request checks broadcast availability.
    let title = `Channel ${channelId}`;
    let release: (() => void) | undefined;
    try {
      const client = await this.manager.getOrInitializeClient(user.token, user.session_string);
      release = this.manager.retainClient(client);
      await this.preparePeers(client);
      title = this.channelTitles.get(client)?.get(channelId) || title;
    } catch {
      // Keep inaccessible selections visible without reporting a live status.
    } finally { release?.(); }
    const thumbnail = `${base}/live/${channelId}/thumbnail.jpg`;
    return {
      id: `tg_live_${channelId}`, type, name: title,
      poster: thumbnail, posterShape: "square", background: thumbnail, logo: thumbnail,
      description: title,
      behaviorHints: { defaultVideoId: `tg_live_${channelId}`, isLive: true },
    };
  }

  async thumbnail(user: InstanceProfile, channelId: string): Promise<Buffer | null> {
    this.assertSelected(user, channelId);
    let release: (() => void) | undefined;
    try {
      const client = await this.manager.getOrInitializeClient(user.token, user.session_string);
      release = this.manager.retainClient(client);
      await this.preparePeers(client);
      const entity = await client.getEntity(channelId);
      if (!(entity instanceof Api.Channel) || utils.getPeerId(entity) !== channelId) return null;
      const photo = await client.downloadProfilePhoto(entity, { isBig: true });
      this.assertSelected(user, channelId);
      return Buffer.isBuffer(photo) && photo.length ? photo : null;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new ServiceUnavailableException("Channel thumbnail is temporarily unavailable");
    } finally { release?.(); }
  }

  async streams(user: InstanceProfile, channelId: string, base: string) {
    try { this.assertSelected(user, channelId); } catch { return { streams: [] }; }
    const status = await this.status(user, channelId, true);
    if (status.state !== "live") return { streams: [] };
    return { streams: [{ name: "StreamGram Live TV", title: `${status.title} · ${labels[user.language]?.live || labels.en.live}`,
      url: `${base}/live/${channelId}/index.m3u8`, behaviorHints: { notWebReady: true } }] };
  }

  async playlist(user: InstanceProfile, channelId: string): Promise<string> {
    this.assertSelected(user, channelId);
    if (this.shuttingDown) throw new ServiceUnavailableException("Live playback is shutting down");
    const key = this.key(user, channelId);
    let session = this.sessions.get(key);
    if (!session || session.abort.signal.aborted) {
      // The playlist URL is stable across receivers. Resetting its sequence to
      // zero after a failure makes existing HLS players ignore all new media.
      let timeline = this.timelines.get(key);
      if (!timeline || timeline.sessionString !== user.session_string) {
        timeline = { token: user.token, channelId, sessionString: user.session_string, sequence: 0, epoch: 0, expiresAt: 0 };
        this.timelines.set(key, timeline);
      } else timeline.epoch++;
      timeline.expiresAt = Date.now() + 15 * 60_000;
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const ready = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      // The owner may disconnect before its first playlist finishes preparing.
      void ready.catch(() => undefined);
      session = { id: randomBytes(12).toString("hex"), user: { ...user }, channelId, timeline, abort: new AbortController(), touchedAt: Date.now(),
        segments: [], inits: new Map(), ready, resolve, reject };
      this.sessions.set(key, session);
      session.runner = this.receive(session);
      this.receivers.add(session.runner);
      void session.runner.finally(() => { if (session?.runner) this.receivers.delete(session.runner); });
    }
    session.touchedAt = Date.now();
    await session.ready;
    this.assertSelected(user, channelId);
    if (session.abort.signal.aborted) throw new ServiceUnavailableException("Live playback has ended");
    this.pruneSegments(session);
    const segments = session.segments.filter(segment => segment.expiresAt === undefined);
    const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-TARGETDURATION:1", `#EXT-X-START:TIME-OFFSET=-${STARTUP_SEGMENTS}.000,PRECISE=NO`, `#EXT-X-MEDIA-SEQUENCE:${segments[0].sequence}`,
      `#EXT-X-DISCONTINUITY-SEQUENCE:${segments[0].epoch}`];
    let epoch: number | undefined;
    for (const segment of segments) {
      if (epoch !== segment.epoch) {
        if (epoch !== undefined) lines.push("#EXT-X-DISCONTINUITY");
        lines.push(`#EXT-X-MAP:URI="${session.id}/init-${segment.epoch}.mp4"`);
        epoch = segment.epoch;
      }
      lines.push("#EXTINF:1.000,", `${session.id}/segment-${segment.sequence}.m4s`);
    }
    return `${lines.join("\n")}\n`;
  }

  asset(user: InstanceProfile, channelId: string, sessionId: string, filename: string): Buffer {
    this.assertSelected(user, channelId);
    const session = this.sessions.get(this.key(user, channelId));
    if (!session || session.id !== sessionId || session.abort.signal.aborted) throw new NotFoundException("Live segment expired");
    this.pruneSegments(session);
    let data: Buffer | undefined;
    const init = /^init-(\d+)\.mp4$/.exec(filename);
    const segment = /^segment-(\d+)\.m4s$/.exec(filename);
    if (init) data = session.inits.get(Number(init[1]));
    if (segment) data = session.segments.find(part => part.sequence === Number(segment[1]))?.media;
    if (!data) throw new NotFoundException("Live segment expired");
    session.touchedAt = Date.now();
    return data;
  }

  private pruneSegments(session: LiveSession) {
    const now = Date.now();
    session.segments = session.segments.filter(segment => segment.expiresAt === undefined || segment.expiresAt > now);
    for (const id of session.inits.keys()) {
      if (!session.segments.some(segment => segment.epoch === id)) session.inits.delete(id);
    }
  }

  private stop(session: LiveSession) {
    session.timeline.expiresAt = Date.now() + 15 * 60_000;
    session.abort.abort();
    session.reject(new ServiceUnavailableException("Live playback ended or is unavailable"));
    if (this.sessions.get(this.key(session.user, session.channelId)) === session) this.sessions.delete(this.key(session.user, session.channelId));
    session.segments.length = 0;
    session.inits.clear();
  }

  private async receive(session: LiveSession): Promise<void> {
    const { user, channelId, abort } = session;
    let release: (() => void) | undefined;
    let releaseMedia: (() => void) | undefined;
    let detach: (() => void) | undefined;
    let client: TelegramClient | undefined;
    let call: Api.InputGroupCall | undefined;
    let source: number | undefined;
    let joined = false;
    const key = this.key(user, channelId);
    const check = () => { if (abort.signal.aborted) throw new Error("Playback stopped"); this.assertSelected(user, channelId); };
    try {
      client = await this.manager.getOrInitializeClient(user.token, user.session_string);
      check();
      release = this.manager.retainClient(client);
      detach = client.onDisconnect(() => this.stop(session));
      const broadcast = await waitForLiveRequest(this.inspect(client, channelId), abort.signal);
      check();
      if (!broadcast || broadcast.state !== "live" || !broadcast.call || !broadcast.dcId) throw new Error("Broadcast not live");
      call = broadcast.call;
      const activeClient = client;
      const activeCall = call;
      const mediaDcId = broadcast.dcId;
      if (this.unsupported.get(key) === call.id.toString()) throw new UnsupportedLiveMediaError();
      // getSender alone leaves teleproto's media slot "idle"; its 60-second
      // timer can disconnect it between chunk requests despite retainClient.
      // Hold a separate lease on this managed client's media DC for playback.
      const acquireSender = async () => {
        releaseMedia?.();
        releaseMedia = undefined;
        const pending = activeClient._leaseSender(mediaDcId).then(lease => {
          if (abort.signal.aborted) { lease.release(); throw new Error("Playback stopped"); }
          releaseMedia = lease.release;
          return lease.sender;
        });
        const sender = await waitForLiveRequest(pending, abort.signal);
        check();
        if (!sender) throw new Error("Live media DC unavailable");
        return sender;
      };
      let sender = await acquireSender();
      const join = async () => {
        check();
        const joiningSource = randomInt(1, 0x7fffffff);
        // RTMP stream-only receive payload, verified against the target live
        // broadcast. No WebRTC transport or published media is negotiated.
        const updates = await activeClient.invoke(new Api.phone.JoinGroupCall({ call: activeCall, joinAs: new Api.InputPeerSelf(), muted: true, videoStopped: true,
          params: new Api.DataJSON({ data: JSON.stringify({ ssrc: joiningSource, ufrag: randomBytes(8).toString("hex"), pwd: randomBytes(16).toString("hex"), fingerprints: [] }) }) }));
        source = joiningSource;
        joined = true;
        check();
        const connection = "updates" in updates ? updates.updates.find(update => update instanceof Api.UpdateGroupCallConnection) : undefined;
        const params = connection instanceof Api.UpdateGroupCallConnection ? JSON.parse(connection.params.data) : {};
        if (!params.stream || !params.rtmp) throw new UnsupportedLiveMediaError("Broadcast requires a media engine");
      };
      await join();
      let timeMs = 0;
      let nextChunkAt = 0;
      let sequence = session.timeline.sequence;
      let epoch = session.timeline.epoch;
      let signature = "";
      let needsKeyframe = true;
      let lastProgress = Date.now();
      let resyncs = 0;
      while (!abort.signal.aborted) {
        check();
        this.pruneSegments(session);
        // Pause a burst of catch-up downloads rather than evicting media that
        // was already promised to a viewer. Reserve room for the next 1 MiB part.
        if (session.segments.length >= MAX_BUFFERED_SEGMENTS ||
            session.segments.reduce((size, segment) => size + segment.media.length, 0) >= MAX_BUFFERED_BYTES - 2 * 1024 * 1024) {
          await delay(100, undefined, { signal: abort.signal });
          lastProgress = Date.now();
          continue;
        }
        try {
          if (Date.now() - lastProgress > 15_000) throw new Error("Live publisher stalled");
          if (!timeMs) {
            const channels = await waitForLiveRequest(sender.send(new Api.phone.GetGroupCallStreamChannels({ call })), abort.signal);
            check();
            if (!(channels instanceof Api.phone.GroupCallStreamChannels)) throw new Error("Invalid stream channels");
            // RTMP uses one-second unified parts even when the deprecated
            // advertised scale differs. Bootstrap further behind the edge so
            // startup has a useful buffer instead of racing the publisher.
            const video = channels.channels.find(channel => channel.channel === 1);
            timeMs = video ? Math.floor(Number(video.lastTimestampMs.toString()) / 1000) * 1000 - SOURCE_BUFFER_MS : 0;
            if (timeMs <= 0) { timeMs = 0; await delay(1000, undefined, { signal: abort.signal }); continue; }
            // Use the observed source/local-clock offset, not the machine's
            // absolute clock. Once caught up, wait for each part to complete.
            nextChunkAt = Date.now() - SOURCE_BUFFER_MS + 1000 + CHUNK_PUBLISH_MARGIN_MS;
          }
          const waitMs = nextChunkAt - Date.now();
          if (waitMs > 0) await delay(waitMs, undefined, { signal: abort.signal });
          check();
          const part = await waitForLiveRequest(sender.send(new Api.upload.GetFile({ location: new Api.InputGroupCallStream({ call, timeMs: bigInt(timeMs), scale: 0, videoChannel: 1, videoQuality: 2 }), offset: bigInt(0), limit: 1024 * 1024 })), abort.signal);
          check();
          if (!(part instanceof Api.upload.File)) throw new Error("Live resynchronization required");
          const remuxed = remuxLivePart(Buffer.from(part.bytes), sequence);
          if (signature && remuxed.signature !== signature) { epoch++; needsKeyframe = true; }
          signature = remuxed.signature;
          timeMs += 1000;
          nextChunkAt += 1000;
          if (needsKeyframe && !remuxed.startsWithKeyframe) continue;
          needsKeyframe = false;
          session.inits.set(epoch, remuxed.init);
          session.segments.push({ sequence: sequence++, epoch, media: remuxed.media });
          session.timeline.sequence = sequence;
          session.timeline.epoch = epoch;
          const active = session.segments.filter(segment => segment.expiresAt === undefined);
          let activeBytes = active.reduce((size, segment) => size + segment.media.length, 0);
          while (active.length > PLAYLIST_SEGMENTS || activeBytes > 12 * 1024 * 1024) {
            const retired = active.shift();
            if (!retired) break;
            retired.expiresAt = Date.now() + RETIRED_SEGMENT_MS;
            activeBytes -= retired.media.length;
          }
          this.pruneSegments(session);
          if (active.length >= STARTUP_SEGMENTS) session.resolve();
          lastProgress = Date.now();
          resyncs = 0;
        } catch (error) {
          if (abort.signal.aborted || error instanceof UnsupportedLiveMediaError) throw error;
          const code = (error as { errorMessage?: string }).errorMessage || "";
          if (code === "TIME_TOO_BIG" || /^FLOOD_WAIT(?:_\d+)?$/.test(code)) {
            // A late publication adjusts the clock for subsequent parts too;
            // do not poll the same future timestamp ten times per second.
            nextChunkAt = Date.now() + NOT_READY_RETRY_MS;
            continue;
          }
          const reason = /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : error instanceof Error ? error.constructor.name : "Error";
          const rejoin = code === "GROUPCALL_JOIN_MISSING" || code === "GROUPCALL_FORBIDDEN";
          const reconnect = !code && error instanceof Error &&
            (error.message === "Live request timed out" || error.name === "SlotRemovedError" || sender.isConnected?.() === false);
          logger.warn({ reason, attempt: resyncs + 1 }, rejoin ? "Telegram live playback rejoining"
            : reconnect ? "Telegram live media connection reconnecting" : "Telegram live playback resynchronizing");
          if (++resyncs > 3) throw new Error("Live resynchronization failed");
          // Membership/transport loss does not change the publisher's media.
          // Recreate only that connection, then retry the exact same part.
          // Rewinding to the live edge here discards reference frames and can
          // leave a player stuck after an otherwise recoverable interruption.
          if (rejoin || reconnect) {
            if (rejoin) await join();
            else sender = await acquireSender();
            lastProgress = Date.now();
            continue;
          }
          // Recheck full channel details only when Telegram reports a call
          // error, rather than interrupting healthy playback with polling.
          if (code.startsWith("GROUPCALL_")) {
            const current = await waitForLiveRequest(this.inspect(client, channelId), abort.signal);
            check();
            if (!current || current.state !== "live" || current.call?.id.toString() !== call.id.toString() || current.dcId !== broadcast.dcId) throw new Error("Broadcast changed");
          }
          sender = await acquireSender();
          timeMs = 0;
          epoch++;
          needsKeyframe = true;
          // Give each bounded recovery attempt its own progress window. A
          // previous timeout must not immediately kill the next attempt.
          lastProgress = Date.now();
          await delay(1000, undefined, { signal: abort.signal });
        }
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        if (error instanceof UnsupportedLiveMediaError && call) this.unsupported.set(key, call.id.toString());
        // Do not log raw RPC errors, call hashes, tokens or media bytes.
        const rpcCode = (error as { errorMessage?: string }).errorMessage || "";
        const message = error instanceof Error ? error.message : "";
        const reason = error instanceof UnsupportedLiveMediaError ? "unsupported_media"
          : /^[A-Z][A-Z0-9_]{0,63}$/.test(rpcCode) ? rpcCode
            : ["Broadcast not live", "Broadcast changed", "Live publisher stalled", "Live resynchronization failed", "Live request timed out"].includes(message) ? message : "unavailable";
        logger.warn({ errorName: error instanceof Error ? error.constructor.name : "Error", reason }, "Telegram live playback stopped");
      }
    } finally {
      this.stop(session);
      this.statuses.delete(key);
      detach?.();
      if (joined && client?.connected && call && source !== undefined) {
        try { await waitForLiveRequest(client.invoke(new Api.phone.LeaveGroupCall({ call, source })), undefined, 5000); } catch { /* The call or client may already be gone. */ }
      }
      releaseMedia?.();
      release?.();
    }
  }

  async onApplicationShutdown() {
    this.shuttingDown = true;
    clearInterval(this.cleanup);
    this.config.events.off("accountsChanged", this.accountsChanged);
    this.config.events.off("securityChanged", this.securityChanged);
    const sessions = [...this.sessions.values()];
    sessions.forEach(session => this.stop(session));
    await Promise.allSettled([...this.receivers]);
    this.statuses.clear();
    this.unsupported.clear();
    this.timelines.clear();
  }
}
