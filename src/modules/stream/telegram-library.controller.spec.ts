import { Test } from "@nestjs/testing";
import { INestApplication, ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { StreamController } from "./stream.controller";
import { StreamHandlerService } from "./stream-handler.service";
import { TelegramNestService } from "../telegram/telegram.service";
import { UserService } from "../user/user.service";
import { InstanceConfigService } from "../user/instance-config.service";
import { CacheService } from "../cache/cache.service";
import { InstanceProfileGuard } from "../../common/guards/instance-profile.guard";
import { RequestValidationPipe } from "../../common/pipes/request-validation.pipe";
import { encodeTelegramFileId } from "../../utils/telegram-file-id";
import { ManifestResponseDto, StreamsResponseDto } from "../../common/dto/responses.dto";
import { MediaSearchResult, PlaybackPeer } from "../telegram/types";

describe("Telegram library Stremio HTTP contract", () => {
  let app: INestApplication;
  let origin: string;
  const user = { token: "account-one", session_string: "private-session", language: "en" };
  const peers: PlaybackPeer[] = [
    { kind: "channel", id: "123", accessHash: "-456" },
    { kind: "user", id: "234", accessHash: "567" },
    { kind: "chat", id: "345" }, { kind: "self", id: "456" },
  ];
  function file(peer = peers[0]): MediaSearchResult {
    return { peer, chatId: peer.id, messageId: 98, fileName: "match.mp4", fileSize: 100, mimeType: "video/mp4", caption: "\n  כותרת הסרטון\nFull caption" };
  }
  const telegram = { searchLibrary: jest.fn(), getLibraryFile: jest.fn(), getLibraryThumbnail: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [StreamController],
      providers: [
        { provide: StreamHandlerService, useValue: {} },
        { provide: TelegramNestService, useValue: telegram },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: UserService, useValue: {} },
        { provide: CacheService, useValue: {} },
        { provide: InstanceConfigService, useValue: { getConfig: () => ({ publicUrl: "https://example.com/base" }) } },
      ],
    }).overrideGuard(InstanceProfileGuard).useValue({
      canActivate: (context: ExecutionContext) => {
        const req = context.switchToHttp().getRequest();
        req.user = { ...user, token: req.params.userToken };
        return true;
      },
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new RequestValidationPipe());
    await app.listen(0, "127.0.0.1");
    origin = await app.getUrl();
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => {
    jest.resetAllMocks();
    telegram.searchLibrary.mockResolvedValue([file()]);
    telegram.getLibraryFile.mockResolvedValue(file());
    telegram.getLibraryThumbnail.mockResolvedValue(null);
  });
  const get = (path: string, token = user.token) => fetch(`${origin}/${token}/${path}`, { redirect: "manual" });

  it("advertises the search-only catalog and file prefix", async () => {
    const manifest = await (await get("manifest.json")).json() as ManifestResponseDto;
    expect(manifest.catalogs).toContainEqual({ type: "movie", id: "tg_library", name: "StreamGram — Telegram Search", extra: [{ name: "search", isRequired: true }] });
    expect(manifest.idPrefixes).toContain("tg_file_");
  });

  it.each(["מסי", "  Messi + 100% / : & = ? #  ", "%2F", "a+b"])("decodes %s once and returns caption titles with lazy images", async query => {
    const response = await get(`catalog/movie/tg_library/search=${encodeURIComponent(query)}.json`);
    expect(response.status).toBe(200);
    const { metas } = await response.json() as { metas: Array<Record<string, string>> };
    expect(telegram.searchLibrary).toHaveBeenCalledWith(user, query);
    expect(metas[0]).toMatchObject({ name: "כותרת הסרטון", description: file().caption, type: "movie", posterShape: "landscape" });
    expect(metas[0].poster).toContain(`https://example.com/base/${user.token}/file/tg_file_`);
    expect(telegram.getLibraryThumbnail).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("uses the filename and then Video ID when captions are missing", async () => {
    telegram.searchLibrary.mockResolvedValue([{ ...file(), caption: "\n " }, { ...file(), messageId: 99, caption: null, fileName: null }]);
    const { metas } = await (await get("catalog/movie/tg_library/search=messi.json")).json() as { metas: Array<{ name: string }> };
    expect(metas.map((m: { name: string }) => m.name)).toEqual(["match.mp4", "Video 99"]);
  });

  it("shows the source in search details, fresh metadata, and the single playback stream", async () => {
    const result = { ...file(), channelTitle: "  My\nTelegram Channel  ", uploadedAt: Date.parse("2026-02-09T23:59:59Z") / 1000 };
    telegram.searchLibrary.mockResolvedValue([result]);
    telegram.getLibraryFile.mockResolvedValue(result);
    const { metas } = await (await get("catalog/movie/tg_library/search=messi.json")).json() as { metas: Array<{ id: string; description: string }> };
    expect(metas[0].description).toBe(`${result.caption}\n\n📣 My Telegram Channel`);
    const { meta } = await (await get(`meta/movie/${metas[0].id}.json`)).json() as { meta: { description: string } };
    expect(meta.description).toBe(metas[0].description);
    const { streams } = await (await get(`stream/movie/${metas[0].id}.json`)).json() as StreamsResponseDto;
    expect(streams).toHaveLength(1);
    expect(streams[0].title).toBe("match.mp4\n📣 My Telegram Channel\n💾 0MB · 09/02/2026");
  });

  it("returns 404 for missing or empty queries and empty results for whitespace", async () => {
    for (const path of ["catalog/movie/tg_library.json", "catalog/movie/tg_library/search=.json"]) {
      expect((await get(path)).status).toBe(404);
    }
    expect(await (await get("catalog/movie/tg_library/search=%20%20.json")).json()).toEqual({ metas: [] });
    expect(telegram.searchLibrary).not.toHaveBeenCalled();
  });

  it.each(peers)("resolves $kind metadata and exactly one existing watch URL without cached search", async peer => {
    const result = file(peer);
    telegram.getLibraryFile.mockResolvedValue(result);
    const id = encodeTelegramFileId(user.token, peer, result.messageId);
    const { meta } = await (await get(`meta/movie/${id}.json`)).json() as { meta: { id: string } };
    expect(meta.id).toBe(id);
    const { streams } = await (await get(`stream/movie/${id}.json`)).json() as StreamsResponseDto;
    const peerPath = peer.kind === "channel" || peer.kind === "user" ? `${peer.kind}/${peer.id}/${peer.accessHash}` : `${peer.kind}/${peer.id}`;
    expect(streams).toHaveLength(1);
    expect(streams[0].url).toBe(`https://example.com/base/${user.token}/watch/${peerPath}/98`);
    expect(telegram.searchLibrary).not.toHaveBeenCalled();
  });

  it("rejects tampered and cross-account IDs and handles deleted messages", async () => {
    const id = encodeTelegramFileId(user.token, peers[0], 98);
    for (const [value, token] of [[id, "other-account"], ["tg_file_bad", user.token]]) {
      expect(await (await get(`meta/movie/${value}.json`, token)).json()).toEqual({ meta: null });
      expect(await (await get(`stream/movie/${value}.json`, token)).json()).toEqual({ streams: [] });
    }
    expect(telegram.getLibraryFile).not.toHaveBeenCalled();
    telegram.getLibraryFile.mockResolvedValue(null);
    expect(await (await get(`meta/movie/${id}.json`)).json()).toEqual({ meta: null });
    expect(await (await get(`stream/movie/${id}.json`)).json()).toEqual({ streams: [] });
    expect(await (await get(`stream/series/${id}.json`)).json()).toEqual({ streams: [] });
  });

  it("returns a thumbnail only on demand with private browser caching or redirects to the local logo", async () => {
    const id = encodeTelegramFileId(user.token, peers[0], 98);
    telegram.getLibraryThumbnail.mockResolvedValue(Buffer.from([255, 216, 255, 217]));
    const image = await get(`file/${id}/poster.jpg`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toContain("image/jpeg");
    expect(image.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(Buffer.from(await image.arrayBuffer())).toEqual(Buffer.from([255, 216, 255, 217]));
    telegram.getLibraryThumbnail.mockResolvedValue(null);
    const fallback = await get(`file/${id}/poster.jpg`);
    expect(fallback.status).toBe(302);
    expect(fallback.headers.get("location")).toBe("https://example.com/base/logo-icon-only.png");
  });

  it("surfaces temporary Telegram failures as 503", async () => {
    const id = encodeTelegramFileId(user.token, peers[0], 98);
    telegram.searchLibrary.mockRejectedValue(new Error("TIMEOUT"));
    telegram.getLibraryFile.mockRejectedValue(new Error("TIMEOUT"));
    for (const path of ["catalog/movie/tg_library/search=messi.json", `meta/movie/${id}.json`, `stream/movie/${id}.json`]) {
      expect((await get(path)).status).toBe(503);
    }
  });
});
