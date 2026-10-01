import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { TelegramNestService } from "./telegram.service";
import { CacheService } from "../cache/cache.service";
import { TelegramClientManager } from "./telegram-client.manager";
import { MediaSearchResult } from "./types";

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
    getMessageDetails: jest.fn(),
    setMessageDetails: jest.fn(),
    getStats: jest.fn(),
    clearAll: jest.fn(),
    cleanup: jest.fn(),
  };

  const mockClientManager = {
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
      expect(keys[1]).toBe("catalog:instance_he_tmdb:550");
      expect(keys[2]).toContain(":ru:");
      expect(keys[3]).toBe("catalog:instance_ru_tmdb:550");
    });
  });

  describe("Tag Result Scoring", () => {
    it("should give tagged results highest score (999)", () => {
      const result = {
        chatId: "-1001234567890",
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
        chatId: "-1001234567890",
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
        chatId: "-1001234567890",
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
        chatId: "-1001234567890",
        messageId: 12345,
        fileName: "Tarzan.1999.1080p.mkv",
        fileSize: 1073741824,
        mimeType: "video/mp4",
        caption: null,
        hasSubtitles: false,
        isDubbed: false,
      };

      const resultWithoutYear = {
        chatId: "-1001234567890",
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
        chatId: "-1001234567890",
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
        chatId: "-1001234567890",
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
        chatId: "-1001234567890",
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
