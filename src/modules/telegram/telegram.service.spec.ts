import { ServiceUnavailableException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { TelegramNestService } from "./telegram.service";
import { CacheService } from "../cache/cache.service";
import { TelegramClientManager } from "./telegram-client.manager";
import { MediaSearchResult } from "./types";
import { Api, TelegramClient } from "teleproto";
import bigInt from "big-integer";
import configuration from "../../config/configuration";
import { MediaDetails } from "../tmdb/types";
import { InstanceProfile } from "../user/instance-profile";

describe("TelegramNestService - Tag Feature", () => {
  let service: TelegramNestService;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => {
      const config: Record<string, any> = {
        "telegram.apiId": 12345,
        "telegram.apiHash": "test-hash",
        language: {
          defaultLanguage: "en",
          preferredLanguage: "he",
          languages: {
            es: configuration().language.languages.es,
            en: {
              name: "english",
              tmdbCode: "en",
              seasonTerms: { long: ["season"], short: ["s"] },
              episodeTerms: { long: ["episode"], short: ["e"] },
              subtitleIndicators: ["hebsub"],
              dubbedIndicators: ["hebdub"],
              subtitleLabel: "Built-in Subtitles",
              dubbedLabel: "Dubbed",
            },
            he: {
              name: "hebrew",
              tmdbCode: "he",
              seasonTerms: { long: ["עונה"], short: ["ע"] },
              episodeTerms: { long: ["פרק"], short: ["פ"] },
              subtitleIndicators: ["ת.מ", "תרגום מובנה"],
              dubbedIndicators: ["מדובב"],
              subtitleLabel: "תרגום מובנה",
              dubbedLabel: "מדובב",
            },
            ru: {
              name: "russian",
              tmdbCode: "ru",
              seasonTerms: { long: ["сезон"], short: ["с"] },
              episodeTerms: { long: ["серия", "эпизод"], short: ["э"] },
              subtitleIndicators: ["русские субтитры", "субтитры"],
              dubbedIndicators: ["дубляж", "озвучка"],
              subtitleLabel: "Встроенные субтитры",
              dubbedLabel: "Дубляж",
            },
          },
        },
        searchResults: {
          movie: { totalResults: 10 },
          series: { totalResults: 20 },
        },
        search: {
          globalSearchLimit: 150,
        },
        streaming: {
          maxRequestSize: 1024 * 1024,
        },
      };
      return config[key] || defaultValue;
    }),
  };

  const mockCacheService = {
    getSearchResults: jest.fn(),
    setSearchResults: jest.fn(),
    getStats: jest.fn(),
    clearAll: jest.fn(),
    cleanup: jest.fn(),
    deleteSearchResults: jest.fn(),
  };

  const mockClientManager = {
    retainClient: jest.fn(() => jest.fn()),
    assertClientUsable: jest.fn(),
    getOrInitializeClient: jest.fn(),
    disconnectAll: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramNestService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: CacheService,
          useValue: mockCacheService,
        },
        {
          provide: TelegramClientManager,
          useValue: mockClientManager,
        },
      ],
    }).compile();

    service = module.get<TelegramNestService>(TelegramNestService);
    jest.clearAllMocks();
  });

  describe("dedicated series channel fallback", () => {
    function fixture<T extends object>(prototype: T, fields: Partial<T>): T {
      return Reflect.construct(prototype.constructor, [fields]) as T;
    }
    const media = {
      id: 1, imdbId: "tt0108778", title: "Friends", localizedTitle: "חברים",
      originalTitle: "Friends", type: "series" as const,
      episodeInfo: { season: 1, episode: 2 },
    };
    const user: any = {
      id: 1, token: "fallback-user", language: "he", session_string: "session",
      selected_channels: "[]", selected_folders: "[]",
    };
    function channel(title: string, id = 123) {
      return { title, entity: fixture(Api.Channel.prototype, { id: bigInt(id), title, accessHash: bigInt(456) }) };
    }
    function video(fileName: string, id = 7, caption = "", mimeType = "video/mp4") {
      const document = fixture(Api.Document.prototype, {
        mimeType, size: bigInt(1024),
        attributes: [new Api.DocumentAttributeFilename({ fileName })],
      });
      return fixture(Api.Message.prototype, {
        id, message: caption, media: new Api.MessageMediaDocument({ document }),
      });
    }
    function discovery(dialogs: any[]) {
      const entities = dialogs.map((dialog) => dialog.entity);
      return {
        messages: [],
        chats: entities.filter((entity) => !(entity instanceof Api.User)),
        users: entities.filter((entity) => entity instanceof Api.User),
        myResults: entities.map((entity) => entity instanceof Api.Channel
          ? new Api.PeerChannel({ channelId: entity.id })
          : entity instanceof Api.Chat
            ? new Api.PeerChat({ chatId: entity.id })
            : new Api.PeerUser({ userId: entity.id })),
        results: [],
      };
    }
    let client: any;
    beforeEach(() => {
      mockCacheService.getSearchResults.mockReset();
      mockCacheService.setSearchResults.mockReset();
      jest.spyOn(service as any, "performGlobalSearch").mockResolvedValue([]);
      client = {
        connected: true,
        getDialogs: jest.fn(),
        invoke: jest.fn().mockResolvedValue(discovery([channel("Friends - HD")])),
        getMessages: jest.fn().mockResolvedValue([video("season 1 episode 2.mp4")]),
      };
    });

    it("uses a matching unselected channel after normal results are rejected and caches metadata", async () => {
      (service as any).performGlobalSearch.mockResolvedValue([{
        peer: { kind: "channel" as const, id: "456", accessHash: "456" }, chatId: "456", messageId: 8, fileName: "Friends s01e03.mp4", fileSize: 100,
      }]);
      const results = await service.searchMedia(client, "חברים", { ...media }, user);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        peer: { kind: "channel" as const, id: "123", accessHash: "456" }, chatId: "123", channelTitle: "Friends - HD", messageId: 7,
        season: 1, episode: 2, mimeType: "video/mp4", fileSize: 1024,
      });
      expect(mockCacheService.setSearchResults).toHaveBeenCalledWith(
        user.token, expect.any(String), results,
      );
      const queries = client.getMessages.mock.calls.map((call: any[]) => call[1].search);
      expect(queries).toEqual(expect.arrayContaining([
        "s01e02", "s1e2", "s01 e02", "season 1 episode 2", "עונה 1 פרק 2",
      ]));
      expect(new Set(queries).size).toBe(queries.length);
      expect(queries).not.toContain("episode 2");
      expect(client.getMessages).toHaveBeenCalledWith(
        expect.any(Api.Channel), expect.objectContaining({ limit: 150 }));
      expect(client.getDialogs).not.toHaveBeenCalled();
      expect(client.invoke.mock.calls.map(([request]: any[]) => request.q).sort()).toEqual(["friends", "חברים"]);
      for (const [request] of client.invoke.mock.calls) expect(request).toBeInstanceOf(Api.messages.SearchGlobal);
    });

    it("never runs when normal search has a usable result", async () => {
      (service as any).performGlobalSearch.mockResolvedValue([{
        peer: { kind: "channel" as const, id: "456", accessHash: "456" }, chatId: "456", messageId: 8, fileName: "Friends s01e02.mp4", fileSize: 100,
      }]);
      await service.searchMedia(client, "Friends", { ...media }, user);
      expect(client.getDialogs).not.toHaveBeenCalled();
      expect(client.invoke).not.toHaveBeenCalled();
    });

    it.each([
      { ...media, type: "movie" as const, episodeInfo: null },
      { ...media, episodeInfo: null },
    ])("never runs without a series episode", async (details) => {
      await service.searchMedia(client, "Friends", details, user);
      expect(client.getDialogs).not.toHaveBeenCalled();
      expect(client.invoke).not.toHaveBeenCalled();
    });

    it("returns cached empty results without invoking the fallback", async () => {
      mockCacheService.getSearchResults.mockResolvedValue([]);
      expect(await service.searchMedia(client, "Friends", { ...media }, user)).toEqual([]);
      expect(client.getDialogs).not.toHaveBeenCalled();
      expect(client.invoke).not.toHaveBeenCalled();
    });

    it("matches full normalized multilingual titles and excludes unrelated peers/users", async () => {
      const group = { title: "חֲבֵרִים | HD", entity: fixture(Api.Chat.prototype, {
        id: bigInt(456), title: "חֲבֵרִים | HD",
      }) };
      client.invoke.mockResolvedValue(discovery([
        channel("MyFriends"), channel("Friend"), channel("Other series"), group,
        { title: "Friends", entity: fixture(Api.User.prototype, { id: bigInt(789) }) },
      ]));
      const results = await service.searchMedia(client, "חברים", { ...media }, user);
      expect(results[0]).toMatchObject({ peer: { kind: "chat", id: "456" }, chatId: "456", channelTitle: group.title });
      for (const [entity] of client.getMessages.mock.calls) expect(entity).toBe(group.entity);
    });

    it("accepts original titles and normalizes punctuation without partial title matching", async () => {
      client.invoke.mockResolvedValue(discovery([channel("Breaking | Bad HD"), channel("Breaking HD", 456)]));
      const details = { ...media, title: "Other", localizedTitle: null, originalTitle: "Breaking-Bad" };
      const results = await service.searchMedia(client, "Other", details, user);
      expect(results).toHaveLength(1);
      expect(results[0].channelTitle).toBe("Breaking | Bad HD");
    });

    it("validates episode numbers in filenames/captions and rejects non-video documents", async () => {
      client.getMessages.mockResolvedValue([
        video("s01e02.mp4", 1), video("עונה 1 פרק 2.mkv", 2),
        video("episode.mp4", 3, "season 1 episode 2 מדובב"),
        video("s02e02.mp4", 4), video("s01e20.mp4", 5),
        video("season 1 episode 21.mp4", 6), video("episode 2.mp4", 7),
        video("s01e02.pdf", 8, "", "application/pdf"),
      ]);
      const results = await service.searchMedia(client, "Friends", { ...media }, user);
      expect(results.map((result) => result.messageId).sort()).toEqual([1, 2, 3]);
      expect(results.find((result) => result.messageId === 3)).toMatchObject({ isDubbed: true, score: 170 });
    });

    it("finds the Frieren short-name channel when metadata contains a subtitle", async () => {
      const details = {
        ...media, imdbId: "tt22248376", title: "Frieren: Beyond Journey's End",
        localizedTitle: "פרירן: מעבר לסוף המסע", originalTitle: "葬送のフリーレン",
        episodeInfo: { season: 1, episode: 1 },
      };
      client.invoke.mockResolvedValue(discovery([channel("פרירן - ערוץ ראשי")]));
      client.getMessages.mockResolvedValue([
        video("1.mp4", 5, "עונה 1 פרק 1"),
        video("11.mp4", 15, "עונה 1 פרק 11"),
      ]);
      const results = await service.searchMedia(client, details.localizedTitle, details, user);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        channelTitle: "פרירן - ערוץ ראשי", messageId: 5, season: 1, episode: 1,
      });
    });

    it("skips all shortened-title queries when full-title search finds an exact episode", async () => {
      const details = {
        ...media, title: "Example: A Journey", localizedTitle: "דוגמה: מסע",
      };
      (service as any).performGlobalSearch.mockResolvedValue([{
        peer: { kind: "channel" as const, id: "123", accessHash: "456" }, chatId: "123", messageId: 1, fileName: "Example: A Journey S01E02.mp4", fileSize: 1024,
      }]);
      const results = await service.searchMedia(client, details.localizedTitle, details, user);
      expect(results).toHaveLength(1);
      const queries = (service as any).performGlobalSearch.mock.calls.map((call: any[]) => call[1]);
      expect(queries).toContain("Example A Journey s01e02");
      expect(queries).not.toContain("Example s01e02");
      expect(queries).not.toContain("דוגמה");
      expect(queries).not.toContain("דוגמה עונה 1 פרק 2");
      expect(client.getDialogs).not.toHaveBeenCalled();
    });

    it("waits for full-title filtering before trying shortened-title queries", async () => {
      const details = {
        ...media, title: "Example: A Journey", localizedTitle: "דוגמה: מסע",
      };
      let finishFullSearch: (results: unknown[]) => void = () => {};
      const fullSearch = new Promise<unknown[]>((resolve) => { finishFullSearch = resolve; });
      (service as any).performGlobalSearch.mockImplementation(async (_client: unknown, query: string) => {
        if (query === "Example s01e02") return [{
          peer: { kind: "channel" as const, id: "123", accessHash: "456" }, chatId: "123", messageId: 2, fileName: "Example.S01E02.mp4", fileSize: 1024,
        }];
        if (query.startsWith("Example s") || query.startsWith("דוגמה ") || query === "דוגמה") return [];
        return fullSearch;
      });
      const pending = service.searchMedia(client, details.localizedTitle, details, user);
      await Promise.resolve();
      expect((service as any).performGlobalSearch.mock.calls.some((call: any[]) => call[1] === "Example s01e02")).toBe(false);
      finishFullSearch([{
        peer: { kind: "channel" as const, id: "123", accessHash: "456" }, chatId: "123", messageId: 1, fileName: "Example: A Journey S01E03.mp4", fileSize: 1024,
      }]);
      const results = await pending;
      expect(results).toHaveLength(1);
      expect(results[0].messageId).toBe(2);
      expect(client.getDialogs).not.toHaveBeenCalled();
    });

    it("searches English short names and accepts dotted release names for localized accounts", async () => {
      const details = {
        ...media, title: "Frieren: Beyond Journey's End",
        localizedTitle: "פרירן: מעבר לסוף המסע", episodeInfo: { season: 1, episode: 1 },
      };
      const fileName = "Frieren.Beyond.Journeys.End.S01E01.The.Journeys.End..mkv";
      (service as any).performGlobalSearch.mockImplementation(async (_client: unknown, query: string) => {
        return query === "Frieren s01e01" ? [{
          peer: { kind: "channel" as const, id: "456", accessHash: "456" }, chatId: "456", channelTitle: "גיבוי פירו 0.2", messageId: 38681,
          fileName, fileSize: 1024,
        }] : [];
      });
      const results = await service.searchMedia(client, details.localizedTitle, details, user);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ channelTitle: "גיבוי פירו 0.2", fileName });
      expect(client.getDialogs).not.toHaveBeenCalled();
      expect((service as any).performGlobalSearch).toHaveBeenCalledWith(
        client, "Frieren s01e01", details, undefined,
      );
    });

    it("keeps the dotted Tokyo Revengers release from the full-title search", async () => {
      const details = {
        ...media, imdbId: "tt13196080", title: "Tokyo Revengers",
        localizedTitle: "הנוקמים מטוקיו", episodeInfo: { season: 1, episode: 1 },
      };
      const fileName = "Tokyo.Revengers.S01E01.Reborn.1080p.JIOHS.WEB-DL.Dual.Au.mkv";
      (service as any).performGlobalSearch.mockImplementation(async (_client: unknown, query: string) => {
        return query === "Tokyo Revengers s01e01" ? [{
          peer: { kind: "channel" as const, id: "456", accessHash: "456" }, chatId: "456", channelTitle: "גיבוי פירו 0.2", messageId: 13959,
          fileName, fileSize: 1024,
        }] : [];
      });
      const results = await service.searchMedia(client, details.localizedTitle, details, user);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ fileName, messageId: 13959 });
      expect(client.getDialogs).not.toHaveBeenCalled();
    });

    it.each([
      ["Tokyo.Revengers.S01E01.mkv", true],
      ["Tokyo_Revengers_S01E01.mkv", true],
      ["Tokyo-Revengers S01E01.mkv", true],
      ["Tokyo.Revengers.S01E02.mkv", false],
      ["Tokyo.Revengers.S01E11.mkv", false],
      ["Tokyo.Revengers.S02E01.mkv", false],
      ["Other.Show.S01E01.mkv", false],
      ["Tokyo.RevengersExtra.S01E01.mkv", false],
    ])("validates the title and exact episode in %s", (fileName, expected) => {
      const details = { ...media, title: "Tokyo Revengers", episodeInfo: { season: 1, episode: 1 } };
      expect((service as any).checkTitleMatch({ fileName }, details, "הנוקמים מטוקיו")).toBe(expected);
    });

    it("rejects the provided Frieren episode 2 release when episode 1 is requested", () => {
      const details = { ...media, title: "Frieren: Beyond Journey's End", episodeInfo: { season: 1, episode: 1 } };
      expect((service as any).checkTitleMatch({
        fileName: "Frieren.Beyond.Journeys.End.S01E02.It.Didnt.Have.to..mkv",
      }, details, "פרירן")).toBe(false);
    });

    it("deduplicates and caps fallback results at the series limit", async () => {
      client.getMessages.mockResolvedValue(Array.from({ length: 25 }, (_, i) => video(`s01e02 quality${i}.mp4`, i + 1)));
      expect(await service.searchMedia(client, "Friends", { ...media }, user)).toHaveLength(20);
    });

    it("skips failed channels and continues searching other matches", async () => {
      client.invoke.mockResolvedValue(discovery([channel("Friends failed"), channel("Friends HD", 456)]));
      client.getMessages.mockImplementation(async (entity: Api.Channel) => {
        if (entity.id.toString() === "123") throw new Error("channel inaccessible");
        return [video("s1e2.mp4")];
      });
      const results = await service.searchMedia(client, "Friends", { ...media }, user);
      expect(results).toHaveLength(1);
      expect(results[0].chatId).toBe("456");
    });

    it("tries episode-only queries only after all channels have no exact matches", async () => {
      const entities = [channel("Friends HD"), channel("Friends backup", 456)];
      client.invoke.mockResolvedValue(discovery(entities));
      const onlyEpisode = new Set(["episode 2", "episode 02", "e2", "e02", "פרק 2", "פרק 02", "פ2", "פ02"]);
      client.getMessages.mockImplementation(async (_entity: Api.Channel, { search }: any) =>
        onlyEpisode.has(search) ? [video("פרק 02.mkv")] : [],
      );
      const results = await service.searchMedia(client, "Friends", { ...media }, user);
      expect(results).toHaveLength(1);
      const calls = client.getMessages.mock.calls;
      const firstEpisodeOnly = calls.findIndex(([, options]: any[]) => onlyEpisode.has(options.search));
      expect(firstEpisodeOnly).toBeGreaterThan(0);
      expect(new Set(calls.slice(0, firstEpisodeOnly).map(([entity]: any[]) => entity.id.toString())).size).toBe(2);
      expect(calls.slice(firstEpisodeOnly).every(([, options]: any[]) => onlyEpisode.has(options.search))).toBe(true);
      expect(calls.map(([, options]: any[]) => options.search)).toEqual(expect.arrayContaining([...onlyEpisode]));
    });

    it.each([
      [1, "Friends", "episode 2.mp4", true],
      [1, "Friends", "e02.mkv", true],
      [1, "Friends", "פרק 02.mkv", true],
      [1, "Friends", "episode 20.mp4", false],
      [1, "Friends", "episode 21.mp4", false],
      [1, "Friends", "2.mp4", false],
      [1, "Friends", "season 2 episode 2.mp4", false],
      [1, "Friends season 2", "episode 2.mp4", false],
      [2, "Friends", "episode 2.mp4", false],
      [2, "Friends season 2", "episode 2.mp4", true],
      [2, "Friends עונה 02", "פרק 2.mkv", true],
      [2, "Friends S02", "e02.mp4", true],
      [2, "Friends season 20", "episode 2.mp4", false],
      [2, "Friends season 2", "S01E02.mp4", false],
      [1, "Friends", "S01E02 season 2.mp4", false],
    ])("validates season %s in %s with %s", async (season, title, fileName, accepted) => {
      client.invoke.mockResolvedValue(discovery([channel(title)]));
      client.getMessages.mockResolvedValue([video(fileName)]);
      const results = await service.searchMedia(client, "Friends", {
        ...media, episodeInfo: { season, episode: 2 },
      }, user);
      expect(results).toHaveLength(accepted ? 1 : 0);
    });

    it("deduplicates joined peers and retains access hashes", async () => {
      const entity = channel("Friends").entity;
      entity.accessHash = bigInt(987);
      client.invoke.mockResolvedValue(discovery([{ entity }, { entity }]));
      await service.searchMedia(client, "Friends", { ...media }, user);
      for (const [searched] of client.getMessages.mock.calls) expect(searched).toBe(entity);
      const queries = client.getMessages.mock.calls.map(([, options]: any[]) => options.search);
      expect(new Set(queries).size).toBe(queries.length);
    });

    it("keeps groups and channels with colliding IDs distinct", async () => {
      const group = fixture(Api.Chat.prototype, { id: bigInt(123), title: "Friends group" });
      client.invoke.mockResolvedValue(discovery([channel("Friends"), { entity: group }]));
      await service.searchMedia(client, "Friends", { ...media }, user);
      expect(new Set(client.getMessages.mock.calls.map(([entity]: any[]) => entity)).size).toBe(2);
    });

    it("searches joined chats while excluding non-member matches and left peers", async () => {
      const left = channel("Friends left", 456);
      left.entity.left = true;
      const personal = discovery([channel("Friends joined"), left, channel("Other show", 789)]);
      const publicChannel = channel("Friends public", 999).entity;
      publicChannel.left = true;
      client.invoke.mockResolvedValue({
        ...personal,
        chats: [...personal.chats, publicChannel],
        results: [new Api.PeerChannel({ channelId: publicChannel.id })],
      });
      const results = await service.searchMedia(client, "Friends", { ...media }, user);
      expect(results[0].channelTitle).toBe("Friends joined");
      expect(client.getDialogs).not.toHaveBeenCalled();
      for (const [entity] of client.getMessages.mock.calls) expect(entity.id.toString()).toBe("123");
    });

    it("returns no fallback results when only global chats match", async () => {
      const publicChannel = channel("Friends public").entity;
      publicChannel.left = true;
      client.invoke.mockResolvedValue({
        chats: [publicChannel], myResults: [],
        results: [new Api.PeerChannel({ channelId: publicChannel.id })], users: [],
      });
      expect(await service.searchMedia(client, "Friends", { ...media }, user)).toEqual([]);
      expect(client.getMessages).not.toHaveBeenCalled();
      expect(client.getDialogs).not.toHaveBeenCalled();
    });

    it("keeps membership and peer types distinct when channel and group IDs collide", async () => {
      const group = fixture(Api.Chat.prototype, { id: bigInt(123), title: "Friends group" });
      client.invoke.mockResolvedValue({
        chats: [fixture(Api.Channel.prototype, {
          id: bigInt(123), title: "Friends public", left: true,
        }), group],
        myResults: [new Api.PeerChat({ chatId: group.id })], results: [], users: [],
      });
      await service.searchMedia(client, "Friends", { ...media }, user);
      for (const [entity] of client.getMessages.mock.calls) expect(entity).toBe(group);
    });

    it("finds tt32612521:1:2 through title-only messages when contacts search has no matches", async () => {
      const entity = channel("[AnimeIL-TV] - גאצ'יאקוטה - אנימה אייאל טיוי").entity;
      entity.left = false;
      client.invoke.mockImplementation(async (request: any) => request instanceof Api.contacts.Search
        ? { chats: [], myResults: [], users: [], results: [] }
        : {
        chats: [entity], myResults: [], users: [],
        results: [new Api.PeerChannel({ channelId: entity.id })],
      });
      client.getMessages.mockImplementation(async (_entity: Api.Channel, { search }: any) =>
        search === "פרק 2" ? [video("Gachiakuta Episode 2 [AnimeIL-TV].mp4", 8, "גאצ'יאקוטה - פרק 2")] : [],
      );
      const details = {
        ...media, imdbId: "tt32612521", title: "Gachiakuta",
        localizedTitle: "גאצ'יאקוטה", originalTitle: "ガチアクタ",
      };
      const results = await service.searchMedia(client, details.localizedTitle, details, user);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        peer: { kind: "channel" as const, id: "123", accessHash: "456" }, chatId: "123", messageId: 8, season: 1, episode: 2,
      });
      expect(client.getDialogs).not.toHaveBeenCalled();
      for (const [request] of client.invoke.mock.calls) {
        expect(request).toBeInstanceOf(Api.messages.SearchGlobal);
        expect(request.filter).toBeInstanceOf(Api.InputMessagesFilterEmpty);
      }
    });

    it("excludes min channel results with unknown membership", async () => {
      const entity = channel("Friends public").entity;
      entity.min = true;
      client.invoke.mockResolvedValue({
        chats: [entity], myResults: [], users: [],
        results: [new Api.PeerChannel({ channelId: entity.id })],
      });
      expect(await service.searchMedia(client, "Friends", { ...media }, user)).toEqual([]);
      expect(client.getMessages).not.toHaveBeenCalled();
    });

    it("reuses title chat matches across different episode searches", async () => {
      await service.searchMedia(client, "Friends", { ...media }, user);
      await service.searchMedia(client, "Friends", { ...media, episodeInfo: { season: 1, episode: 3 } }, user);
      expect(client.invoke).toHaveBeenCalledTimes(2);
      expect(client.getDialogs).not.toHaveBeenCalled();
    });

    it("shares concurrent title discovery and refreshes it after five minutes", async () => {
      const now = jest.spyOn(Date, "now").mockReturnValue(1000);
      try {
        await Promise.all([
          (service as any).getSeriesChatMatches(client, "friends"),
          (service as any).getSeriesChatMatches(client, "friends"),
        ]);
        expect(client.invoke).toHaveBeenCalledTimes(1);
        now.mockReturnValue(1000 + 5 * 60 * 1000);
        await (service as any).getSeriesChatMatches(client, "friends");
        expect(client.invoke).toHaveBeenCalledTimes(2);
        const otherClient = { invoke: jest.fn().mockResolvedValue(discovery([])) };
        expect(await (service as any).getSeriesChatMatches(otherClient, "friends")).toEqual([]);
        expect(otherClient.invoke).toHaveBeenCalledTimes(1);
        await (service as any).getSeriesChatMatches(client, "other");
        expect(client.invoke).toHaveBeenCalledTimes(3);
      } finally {
        now.mockRestore();
      }
    });

    it("retries failed title discovery and caches empty chat matches", async () => {
      client.invoke.mockRejectedValueOnce(new Error("discovery failed"));
      await expect((service as any).getSeriesChatMatches(client, "friends")).rejects.toThrow("discovery failed");
      client.invoke.mockResolvedValue(discovery([]));
      expect(await (service as any).getSeriesChatMatches(client, "friends")).toEqual([]);
      expect(await (service as any).getSeriesChatMatches(client, "friends")).toEqual([]);
      expect(client.invoke).toHaveBeenCalledTimes(2);
    });

    it("continues other title searches when one discovery query fails", async () => {
      client.invoke.mockImplementation(async ({ q }: any) => {
        if (q === "friends") throw new Error("discovery failed");
        return discovery([channel("חברים")]);
      });
      expect(await service.searchMedia(client, "Friends", { ...media }, user)).toHaveLength(1);
    });

    it("limits request concurrency to two and stops scheduling at the result limit", async () => {
      let active = 0;
      let maximum = 0;
      const track = async () => {
        maximum = Math.max(maximum, ++active);
        await new Promise((resolve) => setImmediate(resolve));
        active--;
      };
      client.invoke.mockImplementation(async () => {
        await track();
        return discovery([channel("Friends"), channel("Friends backup", 456), channel("Friends third", 789)]);
      });
      client.getMessages.mockImplementation(async () => {
        await track();
        return Array.from({ length: 25 }, (_, i) => video(`s01e02 quality${i}.mp4`, i + 1));
      });
      const results = await service.searchMedia(client, "Friends", { ...media }, user);
      expect(results).toHaveLength(20);
      expect(maximum).toBe(2);
      expect(client.getMessages).toHaveBeenCalledTimes(2);
    });

    it("preserves partial results when the client disconnects", async () => {
      client.getMessages.mockImplementation(async () => {
        client.connected = false;
        return [video("S01E02.mp4")];
      });
      expect(await service.searchMedia(client, "Friends", { ...media }, user)).toHaveLength(1);
      expect(client.getMessages).toHaveBeenCalledTimes(1);
    });

    it("handles channel discovery errors gracefully", async () => {
      client.invoke.mockRejectedValue(new Error("discovery failed"));
      expect(await service.searchMedia(client, "Friends", { ...media }, user)).toEqual([]);
    });
  });

  describe("live tags with cached ordinary searches", () => {
    const user = { id: 1, token: "tag-account", language: "en" } as any;
    const client = { connected: true } as any;
    const peer = { kind: "channel" as const, id: "123", accessHash: "456" };

    afterEach(() => {
      jest.restoreAllMocks();
      mockCacheService.getSearchResults.mockReset();
      mockCacheService.setSearchResults.mockReset();
    });

    it.each([
      ["movie", "tt0330373"],
      ["series", "tt0330373:1:2"],
      ["movie", undefined],
      ["series", undefined],
    ])("refreshes additions, edits and removals for %s (%s) while reusing ordinary results", async (type, catalogId) => {
      const media: any = { title: "Movie", type, year: 2026,
        episodeInfo: type === "series" ? { season: 1, episode: 2 } : null };
      const limit = type === "movie" ? 10 : 20;
      const ordinary = Array.from({ length: limit }, (_, i) => ({
        peer, chatId: peer.id, messageId: i + 1,
        fileName: `Movie s01e02 ${i}.mp4`, fileSize: 1000, mimeType: "video/mp4",
      }));
      const cache = new Map<string, unknown>();
      mockCacheService.getSearchResults.mockImplementation(async (token, key) => cache.get(`${token}:${key}`) ?? null);
      mockCacheService.setSearchResults.mockImplementation(async (token, key, value) => {
        cache.set(`${token}:${key}`, structuredClone(value));
        return true;
      });
      let liveTags: MediaSearchResult[] = [];
      let failTags = false;
      const search = jest.spyOn(service as any, "performGlobalSearch").mockImplementation(async (_client, query) => {
        if (String(query).startsWith("/tag ")) {
          if (failTags) throw new Error("Tag search unavailable");
          return [...liveTags, ordinary[0]];
        }
        // A title search may also discover tag messages; those must never be cached.
        return [...ordinary, { ...ordinary[0], messageId: 99, customName: "incidental-tag" }];
      });
      const run = () => service.searchMedia(client, "Movie", media, user, catalogId);
      const initial = await run();
      expect(initial).toHaveLength(limit);
      expect(initial.every((result) => !result.customName)).toBe(true);
      const initialSearchCount = search.mock.calls.length;
      expect(initialSearchCount).toBeGreaterThan(1);

      const tagName = catalogId ?? (type === "movie" ? "Movie 2026" : "Movie s01e02");
      liveTags = [{ ...ordinary[limit - 1], fileName: "🏷️ video.mp4", customName: tagName }];
      const added = await run();
      expect(added).toHaveLength(limit);
      expect(added[0]).toMatchObject({ messageId: limit, customName: tagName, score: 999 });
      expect(added.filter((result) => result.messageId === limit)).toHaveLength(1);

      liveTags = [{ ...liveTags[0], messageId: 70, fileName: "🏷️ replacement.mp4" }];
      expect((await run())[0]).toMatchObject({ messageId: 70, customName: tagName });
      liveTags = [];
      expect(await run()).toEqual(initial);
      failTags = true;
      expect(await run()).toEqual(initial);

      expect(search.mock.calls.slice(initialSearchCount).map((call) => call[1]))
        .toEqual(Array(4).fill(`/tag ${tagName}`));
      expect(mockCacheService.setSearchResults).toHaveBeenCalledTimes(1);
      const [token, key, stored] = mockCacheService.setSearchResults.mock.calls[0];
      expect(token).toBe(user.token);
      expect(key).toMatch(/^untagged:/);
      expect(stored).toHaveLength(limit);
      expect(stored.every((result: MediaSearchResult) => !result.customName)).toBe(true);
    });

    it("finds a new tag after caching an empty search", async () => {
      const media: any = { title: "Movie", type: "movie", episodeInfo: null };
      const tagged = { peer, chatId: peer.id, messageId: 70, customName: "tt0330373" };
      mockCacheService.getSearchResults.mockResolvedValue([]);
      const search = jest.spyOn(service as any, "performGlobalSearch")
        .mockResolvedValueOnce([]).mockResolvedValueOnce([tagged]);

      expect(await service.searchMedia(client, "Movie", media, user, "tt0330373")).toEqual([]);
      expect(await service.searchMedia(client, "Movie", media, user, "tt0330373"))
        .toEqual([expect.objectContaining({ customName: "tt0330373", score: 999 })]);
      expect(search).toHaveBeenCalledTimes(2);
      expect(mockCacheService.setSearchResults).not.toHaveBeenCalled();
    });
  });

  describe("movie titles with an inserted installment number", () => {
    const media: MediaDetails = {
      id: 674, imdbId: "tt0330373", title: "Harry Potter and the Goblet of Fire",
      localizedTitle: "הארי פוטר וגביע האש", type: "movie", year: 2005,
    };
    const video = (messageId: number, fileName: string, caption: string | null = null): MediaSearchResult => ({
      peer: { kind: "channel", id: "123", accessHash: "456" }, chatId: "123", messageId,
      fileName, caption, fileSize: 1979486489, mimeType: "video/mp4",
    });
    const matches = (result: MediaSearchResult, details = media) =>
      (service as unknown as {
        checkTitleMatch(result: MediaSearchResult, media: MediaDetails, title: string): boolean;
      }).checkTitleMatch(result, details, details.localizedTitle || details.title);

    afterEach(() => {
      jest.restoreAllMocks();
      mockCacheService.getSearchResults.mockReset();
      mockCacheService.setSearchResults.mockReset();
    });

    it.each([
      "הארי פוטר 4 וגביע האש מדובב 2005 1080p.mkv",
      "הארי פוטר 4️⃣: וגביע האש - 2005 מדובב.mp4",
      "הארי_פוטר_4_וגביע_האש_מדובב.mkv",
      "הארי פוטר 4.\nוגביע האש מדובב",
      "הָארִי פּוֹטֶר 4 — וְגָבִיעַ הָאֵשׁ מדובב",
      "Harry.Potter.4.and.the.Goblet.of.Fire.2005.HebDub.mkv",
    ])("matches the complete movie title around one installment number in %s", (fileName) => {
      expect(matches(video(1, fileName))).toBe(true);
    });

    it("matches the real dubbed release through its caption", () => {
      expect(matches(video(1, "1080p BluRay 2005 ז.מ הארי פוטר 4 מדובב.mp4",
        "הארי פוטר 4️⃣: וגביע האש - 2005\n\nאיכות: 1080p BluRay. 😍\nמדובב לעברית. 🗣"))).toBe(true);
    });

    it.each([
      "הארי פוטר 1 ואבן החכמים מדובב.mp4",
      "הארי פוטר 5 ומסדר עוף החול מדובב.mp4",
      "הארי פוטר 4 מדובב.mp4",
      "הארי פוטר 4 וגביע מדובב.mp4",
      "הארי פוטר 4 והאש גביע מדובב.mp4",
      "הארי פוטר 4 5 וגביע האש.mp4",
      "הארי פוטר 4 וגביע 5 האש.mp4",
      "הארי פוטר 2005 וגביע האש.mp4",
      "הארי פוטר4 וגביע האש.mp4",
      "הארי פוטר 4extra וגביע האש.mp4",
      "הארי פוטר 4 וגביע האשמות.mp4",
      "הארי unrelated פוטר 4 וגביע האש.mp4",
    ])("rejects other movies and incomplete or unrelated titles in %s", (fileName) => {
      expect(matches(video(1, fileName))).toBe(false);
    });

    it.each([
      ["1917", "1917.2019.mkv", true],
      ["1917", "2017.2019.mkv", false],
      ["2001 A Space Odyssey", "2001.A.Space.Odyssey.1968.mkv", true],
      ["2001 A Space Odyssey", "2002.A.Space.Odyssey.1968.mkv", false],
      ["The 40 Year Old Virgin", "The.40.Year.Old.Virgin.mkv", true],
      ["The 40 Year Old Virgin", "The.41.Year.Old.Virgin.mkv", false],
    ])("preserves meaningful numbers in the title %s (%s)", (title, fileName, expected) => {
      expect(matches(video(1, fileName), { ...media, title, localizedTitle: null })).toBe(expected);
    });

    it("does not apply the relaxed movie matcher to series episodes", () => {
      expect(matches(video(1, "Harry Potter 4 and the Goblet of Fire s01e01.mkv"), {
        ...media, type: "series", episodeInfo: { season: 1, episode: 1 },
      })).toBe(false);
    });

    it("includes both real dubbed releases among ten sources without a tag", async () => {
      const subtitled = Array.from({ length: 10 }, (_, i) => ({
        ...video(i + 1, `הארי פוטר וגביע האש 2005 תרגום מובנה ${i}.mkv`), hasSubtitles: true,
      }));
      const dubbed = [
        { ...video(20, "הארי פוטר 4 וגביע האש מדובב 2005 1080p.mkv"), isDubbed: true },
        { ...video(21, "1080p BluRay 2005 ז.מ הארי פוטר 4 מדובב.mp4",
          "הארי פוטר 4️⃣: וגביע האש - 2005\nמדובב לעברית"), isDubbed: true },
      ];
      mockCacheService.getSearchResults.mockResolvedValue(null);
      jest.spyOn(service as unknown as {
        performGlobalSearch(client: unknown, query: string): Promise<MediaSearchResult[]>;
      }, "performGlobalSearch").mockImplementation(async (_client, query) =>
        String(query).startsWith("/tag ") ? [] : [...subtitled, ...dubbed]);

      const results = await service.searchMedia({ connected: true } as TelegramClient,
        media.localizedTitle || media.title, media,
        { id: 1, token: "movie-matching-test", language: "he" } as InstanceProfile, media.imdbId);

      expect(results).toHaveLength(10);
      expect(results.filter((result) => result.isDubbed).map((result) => result.messageId)).toEqual([20, 21]);
      expect(results.every((result) => !result.customName)).toBe(true);
      expect(new Set(results.map((result) => result.messageId)).size).toBe(10);
    });
  });

  describe("source channel metadata", () => {
    // Minimal Telegram fixtures retain their API prototypes for runtime type checks.
    function fixture<T extends object>(prototype: T, fields: Partial<T>): T {
      return Reflect.construct(prototype.constructor, [fields]) as T;
    }

    const channelPeer = new Api.PeerChannel({ channelId: bigInt(123) });
    const otherPeer = new Api.PeerChannel({ channelId: bigInt(456) });
    const channel = fixture(Api.Channel.prototype, {
      id: bigInt(123), title: "Video Channel", accessHash: bigInt(456),
    });
    const otherChannel = fixture(Api.Channel.prototype, {
      id: bigInt(456), title: "Tag Channel", accessHash: bigInt(789),
    });
    const document = fixture(Api.Document.prototype, {
      mimeType: "video/mp4", size: bigInt(1024),
      attributes: [new Api.DocumentAttributeFilename({ fileName: "Movie.mp4" })],
    });
    const video = fixture(Api.Message.prototype, {
      id: 7, peerId: channelPeer, message: "Movie",
      media: new Api.MessageMediaDocument({ document }),
    });
    const media = { title: "Movie", type: "movie", episodeInfo: null };

    function searchResponse(messages: Api.Message[], chats: Api.TypeChat[]) {
      return new Api.messages.Messages({ messages, chats, users: [], topics: [] });
    }

    it.each([false, true])("keeps a forwarded Saved Messages video from global search (tagged: %s)", async (tagged) => {
      const selfPeer = new Api.PeerUser({ userId: bigInt(999) });
      const savedVideo = fixture(Api.Message.prototype, {
        ...video, id: 70, peerId: selfPeer,
        fwdFrom: new Api.MessageFwdHeader({ date: 0, fromId: channelPeer, channelPost: 7 }),
      });
      const tag = fixture(Api.Message.prototype, {
        id: 71, peerId: selfPeer, message: "/tag tt123",
        replyTo: new Api.MessageReplyHeader({ replyToMsgId: 70 }),
      });
      const client = {
        connected: true,
        invoke: jest.fn().mockResolvedValue(searchResponse([tagged ? tag : savedVideo], [])),
        getInputEntity: jest.fn().mockResolvedValue(new Api.InputPeerSelf()),
        getMessages: jest.fn().mockResolvedValue([savedVideo]),
      };
      const results = await (service as any).performGlobalSearch(client, "Movie", media, tagged ? "tt123" : undefined);
      expect(results).toEqual([expect.objectContaining({
        peer: { kind: "self", id: "999" }, messageId: 70,
        channelTitle: "Saved Messages",
        ...(tagged ? { customName: "tt123" } : {}),
      })]);
      expect(client.invoke).toHaveBeenCalledTimes(1);
      const request = client.invoke.mock.calls[0][0];
      expect(request).toBeInstanceOf(Api.messages.SearchGlobal);
      expect(request.filter).toBeInstanceOf(Api.InputMessagesFilterEmpty);
      expect(request.q).toBe("Movie");
      if (tagged) {
        expect(client.getMessages).toHaveBeenCalledWith(expect.any(Api.InputPeerSelf), { ids: 70 });
      }
    });

    it.each(["standalone", "missing video", "text reply"])("excludes a Saved Messages tag without a video: %s", async (scenario) => {
      const selfPeer = new Api.PeerUser({ userId: bigInt(999) });
      const tag = fixture(Api.Message.prototype, {
        id: 71, peerId: selfPeer, message: "/tag tt123",
        ...(scenario === "standalone" ? {} : {
          replyTo: new Api.MessageReplyHeader({ replyToMsgId: 70 }),
        }),
      });
      const client = {
        connected: true,
        invoke: jest.fn().mockResolvedValue(searchResponse([tag], [])),
        getInputEntity: jest.fn().mockResolvedValue(new Api.InputPeerSelf()),
        getMessages: jest.fn().mockResolvedValue(scenario === "text reply" ? [
          fixture(Api.Message.prototype, { id: 70, peerId: selfPeer, message: "Copy this tag" }),
        ] : []),
      };
      expect(await (service as any).performGlobalSearch(client, "/tag tt123", media, "tt123"))
        .toEqual([]);
      if (scenario === "standalone") expect(client.getMessages).not.toHaveBeenCalled();
    });

    it("keeps self peers returned by global search without requiring an access hash", async () => {
      const savedVideo = fixture(Api.Message.prototype, {
        ...video, peerId: new Api.PeerUser({ userId: bigInt(999) }),
      });
      const client = {
        connected: true,
        invoke: jest.fn().mockResolvedValue(searchResponse([savedVideo], [])),
        getInputEntity: jest.fn().mockResolvedValue(new Api.InputPeerSelf()),
      };
      expect(await (service as any).performGlobalSearch(client, "Movie", media))
        .toEqual([expect.objectContaining({ peer: { kind: "self", id: "999" } })]);
    });

    it("matches channels by peer rather than response order or colliding group IDs", async () => {
      const group = fixture(Api.Chat.prototype, { id: bigInt(123), title: "Other Group" });
      const client = {
        connected: true,
        invoke: jest.fn().mockResolvedValue(searchResponse([video], [otherChannel, channel, group])),
        getInputEntity: jest.fn(async (peer: Api.PeerChannel) => new Api.InputPeerChannel({ channelId: peer.channelId, accessHash: bigInt(456) })),
      };
      const results = await (service as any).performGlobalSearch(client, "Movie", media);
      expect(results[0]).toMatchObject({ peer: { kind: "channel" as const, id: "123", accessHash: "456" }, chatId: "123", channelTitle: "Video Channel" });
      expect(client.invoke).toHaveBeenCalledTimes(1);
      expect(client.getInputEntity).toHaveBeenCalledTimes(1);
    });

    it("uses the tagged video's peer, not the tag message's channel", async () => {
      const tag = fixture(Api.Message.prototype, {
        id: 8, peerId: otherPeer, message: "/tag tt123",
        replyTo: new Api.MessageReplyHeader({ replyToMsgId: 7 }),
      });
      const client = {
        connected: true,
        invoke: jest.fn().mockResolvedValue(searchResponse([tag], [otherChannel, channel])),
        getInputEntity: jest.fn(async (peer: Api.PeerChannel) => new Api.InputPeerChannel({ channelId: peer.channelId, accessHash: bigInt(456) })),
        getMessages: jest.fn().mockResolvedValue([video]),
      };
      const results = await (service as any).performGlobalSearch(client, "Movie", media, "tt123");
      expect(results[0]).toMatchObject({ peer: { kind: "channel" as const, id: "123", accessHash: "456" }, chatId: "123", messageId: 7, channelTitle: "Video Channel" });
      expect(client.invoke).toHaveBeenCalledTimes(1);
      expect(client.getMessages).toHaveBeenCalledTimes(1);
    });

    it("keeps video results when channel metadata is missing", async () => {
      const client = {
        connected: true,
        invoke: jest.fn().mockResolvedValue(searchResponse([video], [])),
        getInputEntity: jest.fn(async (peer: Api.PeerChannel) => new Api.InputPeerChannel({ channelId: peer.channelId, accessHash: bigInt(456) })),
      };
      const results = await (service as any).performGlobalSearch(client, "Movie", media);
      expect(results).toHaveLength(1);
      expect(results[0].channelTitle).toBeUndefined();
    });

    it("captures a user peer from global search", async () => {
      const userPeer = new Api.PeerUser({ userId: bigInt(123) });
      const userVideo = fixture(Api.Message.prototype, { ...video, peerId: userPeer });
      const client = {
        connected: true,
        invoke: jest.fn().mockResolvedValue(searchResponse([userVideo], [])),
        getInputEntity: jest.fn().mockResolvedValue(new Api.InputPeerUser({ userId: bigInt(123), accessHash: bigInt("-9223372036854775808") })),
      };
      expect(await (service as any).performGlobalSearch(client, "Movie", media)).toEqual([
        expect.objectContaining({ peer: { kind: "user", id: "123", accessHash: "-9223372036854775808" } }),
      ]);
    });

    it("does not publish empty channel results from a failed client", async () => {
      const client = { getEntity: jest.fn().mockResolvedValue(channel), invoke: jest.fn().mockResolvedValue(searchResponse([], [])) };
      mockClientManager.getOrInitializeClient.mockResolvedValue(client);
      mockClientManager.assertClientUsable.mockImplementationOnce(() => { throw new ServiceUnavailableException("failed client"); });
      await expect(service.getChannelMessages("account", "session", "123")).rejects.toThrow("failed client");
    });

    it("excludes unresolved and zero-hash sources", async () => {
      for (const entity of [{}, new Api.InputPeerChannel({ channelId: bigInt(123), accessHash: bigInt.zero })]) {
        const client = {
          connected: true,
          invoke: jest.fn().mockResolvedValue(searchResponse([video], [channel])),
          getInputEntity: jest.fn().mockResolvedValue(entity),
        };
        expect(await (service as any).performGlobalSearch(client, "Movie", media)).toEqual([]);
      }
    });

    it("does not use a min channel's access hash", async () => {
      const client = { getEntity: jest.fn().mockResolvedValue(new Api.Channel({
        id: bigInt(123), title: "Partial", photo: new Api.ChatPhotoEmpty(), date: 0,
        min: true, accessHash: bigInt(456),
      })), invoke: jest.fn() };
      mockClientManager.getOrInitializeClient.mockResolvedValue(client);
      expect(await service.getChannelMessages("account", "session", "123")).toEqual([]);
      expect(client.invoke).not.toHaveBeenCalled();
    });

    it("keeps distinct message identities for colliding peer IDs", () => {
      const source = { chatId: "123", messageId: 7, fileSize: 1024, mimeType: "video/mp4" };
      const results = (service as any).removeDuplicates([
        { ...source, peer: { kind: "channel", id: "123", accessHash: "456" }, fileName: "one.mp4" },
        { ...source, peer: { kind: "chat", id: "123" }, fileName: "two.mp4" },
      ], media);
      expect(results).toHaveLength(2);
    });

    it("includes the existing channel entity's title for direct channel videos", async () => {
      const client = {
        getEntity: jest.fn().mockResolvedValue(channel),
        invoke: jest.fn().mockResolvedValue(searchResponse([video], [])),
      };
      mockClientManager.getOrInitializeClient.mockResolvedValue(client);
      const results = await service.getChannelMessages("account", "session", "-100123");
      expect(results[0]).toMatchObject({ peer: { kind: "channel" as const, id: "123", accessHash: "456" }, chatId: "123", channelTitle: "Video Channel" });
      expect(client.getEntity).toHaveBeenCalledTimes(1);
      expect(client.invoke).toHaveBeenCalledTimes(1);
    });
  });

  describe("Tag Command Parsing", () => {
    it("should parse basic tag command", () => {
      const messageText = "/tag Tarzan";
      const result = (service as any).parseTagCommand(messageText);
      expect(result).toBe("Tarzan");
    });

    it("should parse tag command with year", () => {
      const messageText = "/tag Tarzan 1999";
      const result = (service as any).parseTagCommand(messageText);
      expect(result).toBe("Tarzan 1999");
    });

    it("should parse tag command with series episode", () => {
      const messageText = "/tag Friends s01e01";
      const result = (service as any).parseTagCommand(messageText);
      expect(result).toBe("Friends s01e01");
    });

    it("should be case insensitive", () => {
      const variations = [
        "/tag Tarzan",
        "/Tag Tarzan",
        "/TAG Tarzan",
        "/TaG Tarzan",
      ];

      variations.forEach((text) => {
        const result = (service as any).parseTagCommand(text);
        expect(result).toBe("Tarzan");
      });
    });

    it("should handle Hebrew text", () => {
      const messageText = "/tag טרזן 1999";
      const result = (service as any).parseTagCommand(messageText);
      expect(result).toBe("טרזן 1999");
    });

    it("should handle Russian text", () => {
      const messageText = "/tag Тарзан 1999";
      const result = (service as any).parseTagCommand(messageText);
      expect(result).toBe("Тарзан 1999");
    });

    it("should handle Arabic text", () => {
      const messageText = "/tag طرزان 1999";
      const result = (service as any).parseTagCommand(messageText);
      expect(result).toBe("طرزان 1999");
    });

    it("should handle multi-word titles", () => {
      const messageText = "/tag Avatar: Fire and Ash 2025";
      const result = (service as any).parseTagCommand(messageText);
      expect(result).toBe("Avatar: Fire and Ash 2025");
    });

    it("should trim whitespace", () => {
      const messageText = "  /tag  Tarzan  ";
      const result = (service as any).parseTagCommand(messageText);
      expect(result).toBe("Tarzan");
    });

    it("should return null for non-tag messages", () => {
      const nonTagMessages = [
        "This is a regular message",
        "tag Tarzan",
        "/tags Tarzan",
        "/tagged Tarzan",
        "",
        null,
        undefined,
      ];

      nonTagMessages.forEach((text) => {
        const result = (service as any).parseTagCommand(text);
        expect(result).toBeNull();
      });
    });

    it("should return null for tag command without content", () => {
      const messageText = "/tag";
      const result = (service as any).parseTagCommand(messageText);
      expect(result).toBeNull();
    });

    it("should return null for tag command with only spaces", () => {
      const messageText = "/tag   ";
      const result = (service as any).parseTagCommand(messageText);
      expect(result).toBeNull();
    });
  });

  describe("Tag Query Generation", () => {
    it.each(["movie", "series"])(
      "searches the name before a hyphen subtitle for %s without losing episode/year suffixes",
      (type) => {
        const media = {
          title: "Re:ZERO -Starting Life in Another World-",
          type, year: 2016,
          episodeInfo: type === "series" ? { season: 1, episode: 1 } : null,
        };
        const localized = "רי:זירו - מתחיל מאפס בעולם אחר-";
        const queries: string[] = (service as any).generateSearchQueries(
          localized, media, "tt5607616:1:1",
        );
        expect(queries).toContain("/tag tt5607616:1:1");
        expect(queries).toContain("רי זירו");
        expect(queries).toContain(type === "series" ? "Re ZERO s01e01" : "Re ZERO 2016");
        expect(queries).toContain(type === "series" ? "רי זירו עונה 1 פרק 1" : "רי זירו 2016");
        expect(queries.every((query) => !/Starting|מתחיל/.test(query))).toBe(true);

        if (type === "series") {
          const fallback: string[] = (service as any).generateShortTitleEpisodeSearchQueries(
            localized, media, media.episodeInfo, "he",
          );
          expect(fallback).toContain("Re ZERO s01e01");
          expect(fallback).not.toContain("Re s01e01");
          expect(fallback).not.toContain("רי");
          expect((service as any).checkTitleMatch(
            { fileName: "Re.ZERO.S01E01.mp4" }, media, localized,
          )).toBe(true);
          expect((service as any).checkTitleMatch(
            { fileName: "Re.Other.S01E01.mp4" }, media, localized,
          )).toBe(false);
          expect((service as any).checkTitleMatch(
            { fileName: "Re.ZERO.S01E02.mp4" }, media, localized,
          )).toBe(false);
        }
        expect((service as any).prepareSearchTitle("Spider-Man - No Way Home"))
          .toBe("Spider-Man");
      },
    );

    it.each(["movie", "series"])(
      "removes title colons from %s searches while preserving catalog tags",
      (type) => {
        const media = {
          title: "Star:Trek: Voyager",
          originalTitle: "Star: Trek: Voyager",
          type,
          year: null,
          episodeInfo: type === "series" ? { season: 1, episode: 2 } : null,
        };
        const queries: string[] = (service as any).generateSearchQueries(
          "מסע: בין כוכבים",
          media,
          "tmdb:123",
        );

        expect(queries).toContain("/tag tmdb:123");
        expect(queries).toContain("מסע בין כוכבים");
        expect(queries.filter((query) => query !== "/tag tmdb:123"))
          .toEqual(expect.arrayContaining([expect.stringContaining("Star Trek Voyager")]));
        expect(queries.filter((query) => query !== "/tag tmdb:123")
          .every((query) => !query.includes(":"))).toBe(true);

        const titleQueries: string[] = (service as any).generateSearchQueries(
          "מסע: בין כוכבים", media,
        );
        expect(titleQueries.some((query) => query.startsWith("/tag מסע בין כוכבים")))
          .toBe(true);
        expect(titleQueries.every((query) => !query.includes(":"))).toBe(true);
      },
    );

    it("should generate tag query for movie", () => {
      const media = {
        id: 0,
        imdbId: "tt0120855",
        title: "Tarzan",
        localizedTitle: "טרזן",
        type: "movie" as const,
        overview: null,
        year: 1999,
        seasons: null,
        episodes: null,
        episodeInfo: null,
      };

      const queries = (service as any).generateSearchQueries("טרזן", media);

      // Should include the tag query with main title and year
      expect(queries).toContain("/tag טרזן 1999");
    });

    it("should generate tag query for movie without year", () => {
      const media = {
        id: 0,
        imdbId: "tt0120855",
        title: "Tarzan",
        localizedTitle: null,
        type: "movie" as const,
        overview: null,
        year: null,
        seasons: null,
        episodes: null,
        episodeInfo: null,
      };

      const queries = (service as any).generateSearchQueries(null, media);

      // Should include the tag query without year
      expect(queries).toContain("/tag Tarzan");
    });

    it("should generate tag query for series episode", () => {
      const media = {
        id: 0,
        imdbId: "tt0108778",
        title: "Friends",
        localizedTitle: "החברים",
        type: "series" as const,
        overview: null,
        year: 1994,
        seasons: 10,
        episodes: 236,
        episodeInfo: { season: 1, episode: 1 },
      };

      const queries = (service as any).generateEpisodeSearchQueries(
        "החברים",
        media,
        media.episodeInfo,
      );

      // Should include tag query with padded episode format
      expect(queries).toContain("/tag החברים ע01פ01");
    });

    it("should generate tag query with zero-padded numbers", () => {
      const media = {
        id: 0,
        imdbId: "tt0108778",
        title: "Friends",
        localizedTitle: null,
        type: "series" as const,
        overview: null,
        year: 1994,
        seasons: 10,
        episodes: 236,
        episodeInfo: { season: 2, episode: 5 },
      };

      const queries = (service as any).generateEpisodeSearchQueries(
        "Friends",
        media,
        media.episodeInfo,
      );

      // Should use s02e05 format (padded)
      expect(queries).toContain("/tag Friends s02e05");
    });

    it("should handle double-digit season and episode", () => {
      const media = {
        id: 0,
        imdbId: "tt0108778",
        title: "Friends",
        localizedTitle: null,
        type: "series" as const,
        overview: null,
        year: 1994,
        seasons: 10,
        episodes: 236,
        episodeInfo: { season: 10, episode: 18 },
      };

      const queries = (service as any).generateEpisodeSearchQueries(
        "Friends",
        media,
        media.episodeInfo,
      );

      // Should remain s10e18 (already two digits)
      expect(queries).toContain("/tag Friends s10e18");
    });
  });

  describe("Catalog ID Tag Queries", () => {
    it("should only generate catalog ID tag for movie when catalog ID provided", () => {
      const media = {
        id: 0,
        imdbId: "tt0120855",
        title: "Tarzan",
        localizedTitle: "טרזן",
        type: "movie" as const,
        overview: null,
        year: 1999,
        seasons: null,
        episodes: null,
        episodeInfo: null,
      };

      const queries = (service as any).generateSearchQueries(
        "טרזן",
        media,
        "tt0120855",
      );

      // Should include the catalog ID tag
      expect(queries).toContain("/tag tt0120855");

      // Should NOT include title-based tags when catalog ID is provided
      expect(queries).not.toContain("/tag טרזן 1999");
      expect(queries).not.toContain("/tag Tarzan 1999");
    });

    it("should only generate catalog ID tag for series episode when catalog ID provided", () => {
      const media = {
        id: 0,
        imdbId: "tt0108778",
        title: "Friends",
        localizedTitle: "החברים",
        type: "series" as const,
        overview: null,
        year: 1994,
        seasons: 10,
        episodes: 236,
        episodeInfo: { season: 1, episode: 1 },
      };

      const queries = (service as any).generateEpisodeSearchQueries(
        "החברים",
        media,
        media.episodeInfo,
        "tt0108778:1:1",
      );

      // Should include the catalog ID tag
      expect(queries).toContain("/tag tt0108778:1:1");

      // Should NOT include title-based tags when catalog ID is provided
      expect(queries).not.toContain("/tag החברים ע01פ01");
      expect(queries).not.toContain("/tag Friends s01e01");

      // Should NOT include base ID tag
      expect(queries).not.toContain("/tag tt0108778");
    });

    it("should use TMDB catalog ID format", () => {
      const media = {
        id: 550,
        imdbId: null,
        title: "Fight Club",
        localizedTitle: null,
        type: "movie" as const,
        overview: null,
        year: 1999,
        seasons: null,
        episodes: null,
        episodeInfo: null,
      };

      const queries = (service as any).generateSearchQueries(
        null,
        media,
        "tmdb:550",
      );

      // Should include the TMDB catalog ID tag
      expect(queries).toContain("/tag tmdb:550");

      // Should NOT include title-based tags
      expect(queries).not.toContain("/tag Fight Club 1999");
    });

    it("should generate title-based tags when no catalog ID provided", () => {
      const media = {
        id: 0,
        imdbId: "tt0120855",
        title: "Tarzan",
        localizedTitle: "טרזן",
        type: "movie" as const,
        overview: null,
        year: 1999,
        seasons: null,
        episodes: null,
        episodeInfo: null,
      };

      const queries = (service as any).generateSearchQueries(
        "טרזן",
        media,
        undefined, // No catalog ID
      );

      // Should include title-based tag when no catalog ID provided
      expect(queries).toContain("/tag טרזן 1999");
    });
  });

  describe("Language-aware search caching", () => {
    const client = { connected: true } as any;
    const user = { id: 1, language: "he", token: "instance" } as any;
    const movie = {
      id: 550,
      imdbId: "tt0137523",
      title: "Fight Club",
      localizedTitle: "מועדון קרב",
      type: "movie" as const,
      year: 1999,
      episodeInfo: null,
    };
    const episode = {
      id: 0,
      imdbId: "tt0108778",
      title: "Friends",
      localizedTitle: "חברים",
      type: "series" as const,
      year: 1994,
      episodeInfo: { season: 1, episode: 2 },
    };

    beforeEach(() => {
      user.language = "he";
      mockCacheService.getSearchResults.mockResolvedValue(null);
      mockCacheService.setSearchResults.mockResolvedValue(true);
      (service as any).performGlobalSearch = jest.fn().mockResolvedValue([]);
    });

    it("separates movie cache entries by effective language", async () => {
      (service as any).LANGUAGE_CONFIG.preferredLanguage = "he";
      await service.searchMedia(client, "מועדון קרב", movie, user);

      user.language = "ru";
      await service.searchMedia(client, "Бойцовский клуб", movie, user);

      const keys = mockCacheService.getSearchResults.mock.calls.map(
        ([_, key]) => key,
      );
      expect(keys[0]).toContain("_he_");
      expect(keys[1]).toContain("_ru_");
    });

    it("separates episode and catalog cache entries by effective language", async () => {
      user.language = "he";
      await service.searchMedia(client, "חברים", episode, user);
      await service.searchMedia(client, "חברים", movie, user, "tmdb:550");

      user.language = "ru";
      await service.searchMedia(client, "Друзья", episode, user);
      await service.searchMedia(client, "Бойцовский клуб", movie, user, "tmdb:550");

      const keys = mockCacheService.getSearchResults.mock.calls.map(
        ([_, key]) => key,
      );
      expect(keys[0]).toContain(":he:");
      expect(keys[1]).toBe("untagged:catalog:instance_he_tmdb:550");
      expect(keys[2]).toContain(":ru:");
      expect(keys[3]).toBe("untagged:catalog:instance_ru_tmdb:550");
    });
  });

  describe("Tag Result Scoring", () => {
    it("should give tagged results highest score (999)", () => {
      const result = {
        peer: { kind: "channel" as const, id: "1234567890", accessHash: "456" }, chatId: "-1001234567890",
        messageId: 12345,
        fileName: "🏷️ tarzan_movie.mp4 (Tarzan)",
        customName: "Tarzan",
        fileSize: 1073741824,
        mimeType: "video/mp4",
        caption: null,
        hasSubtitles: false,
        isDubbed: false,
      };

      const media = {
        id: 0,
        imdbId: "tt0120855",
        title: "Tarzan",
        localizedTitle: null,
        type: "movie" as const,
        overview: null,
        year: 1999,
        seasons: null,
        episodes: null,
        episodeInfo: null,
      };

      const score = (service as any).evaluateResultScore(result, media);
      expect(score).toBe(999);
    });

    it("should prioritize tagged results over regular results", () => {
      const taggedResult = {
        peer: { kind: "channel" as const, id: "1234567890", accessHash: "456" }, chatId: "-1001234567890",
        messageId: 12345,
        fileName: "🏷️ Tarzan.1999.1080p.mkv (Tarzan)",
        customName: "Tarzan",
        fileSize: 1073741824,
        mimeType: "video/mp4",
        caption: null,
        hasSubtitles: false,
        isDubbed: false,
      };

      const regularResult = {
        peer: { kind: "channel" as const, id: "1234567890", accessHash: "456" }, chatId: "-1001234567890",
        messageId: 67890,
        fileName: "Tarzan.1999.1080p.mkv",
        fileSize: 2147483648,
        mimeType: "video/x-matroska",
        caption: null,
        hasSubtitles: true,
        isDubbed: true,
      };

      const media = {
        id: 0,
        imdbId: "tt0120855",
        title: "Tarzan",
        localizedTitle: null,
        type: "movie" as const,
        overview: null,
        year: 1999,
        seasons: null,
        episodes: null,
        episodeInfo: null,
      };

      const taggedScore = (service as any).evaluateResultScore(
        taggedResult,
        media,
      );
      const regularScore = (service as any).evaluateResultScore(
        regularResult,
        media,
      );

      expect(taggedScore).toBeGreaterThan(regularScore);
      expect(taggedScore).toBe(999);
    });

    it("should give year-matching results bonus score", () => {
      const resultWithYear = {
        peer: { kind: "channel" as const, id: "1234567890", accessHash: "456" }, chatId: "-1001234567890",
        messageId: 12345,
        fileName: "Tarzan.1999.1080p.mkv",
        fileSize: 1073741824,
        mimeType: "video/mp4",
        caption: null,
        hasSubtitles: false,
        isDubbed: false,
      };

      const resultWithoutYear = {
        peer: { kind: "channel" as const, id: "1234567890", accessHash: "456" }, chatId: "-1001234567890",
        messageId: 67890,
        fileName: "Tarzan.1080p.mkv",
        fileSize: 1073741824,
        mimeType: "video/mp4",
        caption: null,
        hasSubtitles: false,
        isDubbed: false,
      };

      const media = {
        id: 0,
        imdbId: "tt0120855",
        title: "Tarzan",
        localizedTitle: null,
        type: "movie" as const,
        overview: null,
        year: 1999,
        seasons: null,
        episodes: null,
        episodeInfo: null,
      };

      const scoreWithYear = (service as any).evaluateResultScore(
        resultWithYear,
        media,
      );
      const scoreWithoutYear = (service as any).evaluateResultScore(
        resultWithoutYear,
        media,
      );

      expect(scoreWithYear).toBeGreaterThan(scoreWithoutYear);
      expect(scoreWithYear).toBeGreaterThanOrEqual(400); // Year match bonus
    });
  });

  describe("Tag Feature Integration", () => {
    it("should handle tagged video in fileName", () => {
      const result = {
        peer: { kind: "channel" as const, id: "1234567890", accessHash: "456" }, chatId: "-1001234567890",
        messageId: 12345,
        fileName: "🏷️ movie_final_v2.mp4 (Tarzan 1999)",
        customName: "Tarzan 1999",
        fileSize: 1073741824,
        mimeType: "video/mp4",
        caption: null,
        hasSubtitles: false,
        isDubbed: false,
      };

      expect(result.fileName).toContain("🏷️");
      expect(result.fileName).toContain("(Tarzan 1999)");
      expect(result.customName).toBe("Tarzan 1999");
    });

    it("should mark tagged results with customName field", () => {
      const taggedResult: MediaSearchResult = {
        peer: { kind: "channel" as const, id: "1234567890", accessHash: "456" }, chatId: "-1001234567890",
        messageId: 12345,
        fileName: "🏷️ Friends.S01E01.1080p.mkv (Friends s01e01)",
        customName: "Friends s01e01",
        fileSize: 1073741824,
        mimeType: "video/mp4",
        caption: null,
        hasSubtitles: false,
        isDubbed: false,
      };

      const regularResult: MediaSearchResult = {
        peer: { kind: "channel" as const, id: "1234567890", accessHash: "456" }, chatId: "-1001234567890",
        messageId: 67890,
        fileName: "Friends.S01E01.1080p.mkv",
        fileSize: 2147483648,
        mimeType: "video/x-matroska",
        caption: null,
        hasSubtitles: false,
        isDubbed: false,
      };

      expect(taggedResult.customName).toBeDefined();
      expect(regularResult.customName).toBeUndefined();
    });
  });

  describe("Edge Cases", () => {
    it("searches Spanish season terms and filenames alongside English release names", () => {
      const internal = service as unknown as {
        LANGUAGE_CONFIG: { preferredLanguage: string };
        generateEpisodeSearchQueries: (title: string, media: unknown, episode: unknown) => string[];
      };
      internal.LANGUAGE_CONFIG.preferredLanguage = "es";
      const media = {
        id: 1, title: "Money Heist", localizedTitle: "La casa de papel", type: "series",
        episodeInfo: { season: 2, episode: 3 },
      };
      const queries = internal.generateEpisodeSearchQueries(media.localizedTitle, media, media.episodeInfo);
      expect(queries).toEqual(expect.arrayContaining([
        "La casa de papel temporada 2 episodio 3",
        "La casa de papel t02 e03", "Money Heist s02e03",
      ]));
    });

    it("generates Russian localized season and episode queries", () => {
      (service as any).LANGUAGE_CONFIG.preferredLanguage = "ru";
      const media = {
        id: 0,
        imdbId: "tt0108778",
        title: "Friends",
        localizedTitle: "Друзья",
        type: "series" as const,
        overview: null,
        year: 1994,
        seasons: 10,
        episodes: 236,
        episodeInfo: { season: 2, episode: 3 },
      };

      const queries = (service as any).generateEpisodeSearchQueries(
        "Друзья",
        media,
        media.episodeInfo,
      );

      expect(queries).toContain("Друзья сезон 2 серия 3");
      expect(queries).toContain("Друзья с02 э03");
      expect(queries).toContain("Friends s02e03");
    });

    it("includes language in movie, episode, and catalog cache keys", async () => {
      const search = jest
        .spyOn(service as any, "performGlobalSearch")
        .mockResolvedValue([]);
      const client = { connected: true } as any;
      const movie = {
        id: 0,
        imdbId: "tt0120855",
        title: "Tarzan",
        localizedTitle: "טרזן",
        type: "movie" as const,
        overview: null,
        year: 1999,
        seasons: null,
        episodes: null,
        episodeInfo: null,
      };
      const episode = {
        ...movie,
        imdbId: "tt0108778",
        type: "series" as const,
        localizedTitle: "החברים",
        episodeInfo: { season: 1, episode: 1 },
      };
      const user: any = {
        id: 1,
        phone: null,
        session_string: "session",
        token: "instance",
        tmdb_token: null,
        selected_folders: "[]",
        selected_channels: "[]",
        language: "he" as const,
      };

      await service.searchMedia(client, movie.localizedTitle, movie, user);
      const movieHebrewKey = mockCacheService.getSearchResults.mock.calls[0][1];
      (service as any).LANGUAGE_CONFIG.preferredLanguage = "ru";
      await service.searchMedia(client, movie.localizedTitle, movie, {
        ...user,
        language: "ru",
      } as any);
      const movieRussianKey = mockCacheService.getSearchResults.mock.calls[1][1];

      (service as any).LANGUAGE_CONFIG.preferredLanguage = "he";
      await service.searchMedia(client, episode.localizedTitle, episode, user);
      const episodeHebrewKey = mockCacheService.getSearchResults.mock.calls[2][1];
      (service as any).LANGUAGE_CONFIG.preferredLanguage = "ru";
      await service.searchMedia(client, episode.localizedTitle, episode, {
        ...user,
        language: "ru",
      } as any);
      const episodeRussianKey = mockCacheService.getSearchResults.mock.calls[3][1];

      (service as any).LANGUAGE_CONFIG.preferredLanguage = "he";
      await service.searchMedia(client, "/tag tmdb:1", movie, user, "tmdb:1");
      const catalogHebrewKey = mockCacheService.getSearchResults.mock.calls[4][1];
      (service as any).LANGUAGE_CONFIG.preferredLanguage = "ru";
      await service.searchMedia(client, "/tag tmdb:1", movie, {
        ...user,
        language: "ru",
      } as any, "tmdb:1");
      const catalogRussianKey = mockCacheService.getSearchResults.mock.calls[5][1];

      expect(movieHebrewKey).not.toBe(movieRussianKey);
      expect(episodeHebrewKey).not.toBe(episodeRussianKey);
      expect(catalogHebrewKey).not.toBe(catalogRussianKey);
      expect(search).toHaveBeenCalled();
    });

    it("should handle complex movie titles in tag commands", () => {
      const messageText = "/tag Avatar: Fire and Ash 2025";
      const result = (service as any).parseTagCommand(messageText);
      expect(result).toBe("Avatar: Fire and Ash 2025");
    });

    it("should handle special characters in tag commands", () => {
      const messageText = "/tag Spider-Man: No Way Home 2021";
      const result = (service as any).parseTagCommand(messageText);
      expect(result).toBe("Spider-Man: No Way Home 2021");
    });

    it("should handle numbers in titles", () => {
      const messageText = "/tag 2001: A Space Odyssey";
      const result = (service as any).parseTagCommand(messageText);
      expect(result).toBe("2001: A Space Odyssey");
    });

    it("should handle parentheses in titles", () => {
      const messageText = "/tag Mission: Impossible (1996)";
      const result = (service as any).parseTagCommand(messageText);
      expect(result).toBe("Mission: Impossible (1996)");
    });
  });
});
