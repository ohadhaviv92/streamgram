import {
  createHowToTagStream,
  extractQualityFromFilename,
  detectSubtitlesAndDubbing,
} from "./stremio";
import { MediaDetails } from "../modules/tmdb/types";

// Mock configuration module
jest.mock("../config/configuration", () => ({
  __esModule: true,
  default: () => ({
    server: {
      host: "localhost",
      port: 3000,
      streamHost: "https://test.example.com",
    },
    language: {
      preferredLanguage: "en",
      languages: {
        en: {
          name: "english",
          seasonTerms: { long: ["season"], short: ["s"] },
          episodeTerms: { long: ["episode"], short: ["e"] },
          subtitleIndicators: ["hebsub"],
          dubbedIndicators: ["hebdub"],
          subtitleLabel: "Built-in Subtitles",
          dubbedLabel: "Dubbed",
          howToTagLabel: "How to Tag",
          noLocalizedTitleMessage: "No localized title available",
        },
        he: {
          name: "hebrew",
          seasonTerms: { long: ["עונה"], short: ["ע"] },
          episodeTerms: { long: ["פרק"], short: ["פ"] },
          subtitleIndicators: ["ת.מ", "תרגום מובנה"],
          dubbedIndicators: ["מדובב"],
          subtitleLabel: "תרגום מובנה",
          dubbedLabel: "מדובב",
          howToTagLabel: "איך לתייג",
          noLocalizedTitleMessage: "אין כותרת בעברית",
        },
        ru: {
          name: "russian",
          seasonTerms: { long: ["сезон"], short: ["с"] },
          episodeTerms: { long: ["серия", "эпизод"], short: ["э"] },
          subtitleIndicators: ["русские субтитры", "субтитры"],
          dubbedIndicators: ["дубляж", "озвучка"],
          subtitleLabel: "Встроенные субтитры",
          dubbedLabel: "Дубляж",
          howToTagLabel: "Как отметить",
          noLocalizedTitleMessage: "Нет локализованного названия",
        },
        ar: {
          name: "arabic",
          seasonTerms: { long: ["الموسم"], short: ["م"] },
          episodeTerms: { long: ["الحلقة"], short: ["ح"] },
          subtitleIndicators: ["ترجمة", "ترجمة مدمجة"],
          dubbedIndicators: ["مدبلج"],
          subtitleLabel: "ترجمة مدمجة",
          dubbedLabel: "مدبلج",
          howToTagLabel: "كيفية الوسم",
          noLocalizedTitleMessage: "لا يوجد عنوان محلي",
        },
      },
    },
  }),
}));

describe("Stremio Utilities", () => {
  describe("createHowToTagStream - Tag Assistant Feature", () => {
    describe("Movie Instructions", () => {
      it("should create English instruction for movie with year", () => {
        const mediaDetails: MediaDetails = {
          id: 0,
          imdbId: "tt0120855",
          title: "Tarzan",
          localizedTitle: null,
          type: "movie",
          overview: null,
          year: 1999,
          seasons: null,
          episodes: null,
          episodeInfo: null,
        };

        const result = createHowToTagStream(
          "en",
          mediaDetails,
          "tt0120855",
          "test-token-123",
        );

        expect(result.name).toBe("StreamGram\n🏷️ How to Tag");
        expect(result.title).toBe("/tag tt0120855");
        expect(result.url).toBe(
          "https://test.example.com/tag/tt0120855",
        );
        expect(result.behaviorHints.notWebReady).toBe(false);
      });

      it("should create English instruction for movie without year", () => {
        const mediaDetails: MediaDetails = {
          id: 0,
          imdbId: "tt0120855",
          title: "Tarzan",
          localizedTitle: null,
          type: "movie",
          overview: null,
          year: null,
          seasons: null,
          episodes: null,
          episodeInfo: null,
        };

        const result = createHowToTagStream(
          "en",
          mediaDetails,
          "tt0120855",
          "test-token-123",
        );

        expect(result.name).toBe("StreamGram\n🏷️ How to Tag");
        expect(result.title).toBe("/tag tt0120855");
        expect(result.url).toBe(
          "https://test.example.com/tag/tt0120855",
        );
        expect(result.behaviorHints.notWebReady).toBe(false);
      });

      it("should create Hebrew instruction with localized title", () => {
        const mediaDetails: MediaDetails = {
          id: 0,
          imdbId: "tt0120855",
          title: "Tarzan",
          localizedTitle: "טרזן",
          type: "movie",
          overview: null,
          year: 1999,
          seasons: null,
          episodes: null,
          episodeInfo: null,
        };

        const result = createHowToTagStream(
          "he",
          mediaDetails,
          "tt0120855",
          "test-token-123",
        );

        expect(result.name).toBe("StreamGram\n🏷️ איך לתייג");
        expect(result.title).toBe("/tag tt0120855");
        expect(result.url).toBe(
          "https://test.example.com/tag/tt0120855",
        );
        expect(result.behaviorHints.notWebReady).toBe(false);
      });

      it("should show 'no localized title' message for Hebrew without localization", () => {
        const mediaDetails: MediaDetails = {
          id: 0,
          imdbId: "tt0120855",
          title: "Tarzan",
          localizedTitle: null,
          type: "movie",
          overview: null,
          year: 1999,
          seasons: null,
          episodes: null,
          episodeInfo: null,
        };

        const result = createHowToTagStream(
          "he",
          mediaDetails,
          "tt0120855",
          "test-token-123",
        );

        expect(result.name).toBe("StreamGram\n🏷️ איך לתייג");
        expect(result.title).toBe("/tag tt0120855");
        expect(result.url).toBe(
          "https://test.example.com/tag/tt0120855",
        );
      });

      it("should not duplicate English title if localizedTitle is same", () => {
        const mediaDetails: MediaDetails = {
          id: 0,
          imdbId: "tt0120855",
          title: "Tarzan",
          localizedTitle: "Tarzan",
          type: "movie",
          overview: null,
          year: 1999,
          seasons: null,
          episodes: null,
          episodeInfo: null,
        };

        const result = createHowToTagStream(
          "he",
          mediaDetails,
          "tt0120855",
          "test-token-123",
        );

        expect(result.title).toBe("/tag Tarzan 1999");
        expect(result.title).not.toContain("\n");
      });
    });

    describe("Series Episode Instructions", () => {
      it("should create English instruction for series episode with padding", () => {
        const mediaDetails: MediaDetails = {
          id: 0,
          imdbId: "tt0108778",
          title: "Friends",
          localizedTitle: null,
          type: "series",
          overview: null,
          year: 1994,
          seasons: 10,
          episodes: 236,
          episodeInfo: { season: 1, episode: 1 },
        };

        const result = createHowToTagStream(
          "en",
          mediaDetails,
          "tt0108778:1:1",
          "test-token-123",
        );

        expect(result.name).toBe("StreamGram\n🏷️ How to Tag");
        expect(result.title).toBe("/tag tt0108778:1:1");
        expect(result.url).toBe(
          "https://test.example.com/tag/tt0108778%3A1%3A1",
        );
        expect(result.behaviorHints.notWebReady).toBe(false);
      });

      it("should create Hebrew instruction with localized episode format", () => {
        const mediaDetails: MediaDetails = {
          id: 0,
          imdbId: "tt0108778",
          title: "Friends",
          localizedTitle: "החברים",
          type: "series",
          overview: null,
          year: 1994,
          seasons: 10,
          episodes: 236,
          episodeInfo: { season: 1, episode: 1 },
        };

        const result = createHowToTagStream(
          "he",
          mediaDetails,
          "tt0108778:1:1",
          "test-token-123",
        );

        expect(result.name).toBe("StreamGram\n🏷️ איך לתייג");
        expect(result.title).toBe("/tag tt0108778:1:1");
        expect(result.url).toBe(
          "https://test.example.com/tag/tt0108778%3A1%3A1",
        );
      });

      it("should create Russian instruction with Cyrillic format", () => {
        const mediaDetails: MediaDetails = {
          id: 0,
          imdbId: "tt0108778",
          title: "Friends",
          localizedTitle: "Друзья",
          type: "series",
          overview: null,
          year: 1994,
          seasons: 10,
          episodes: 236,
          episodeInfo: { season: 2, episode: 15 },
        };

        const result = createHowToTagStream(
          "ru",
          mediaDetails,
          "tt0108778:2:15",
          "test-token-123",
        );

        expect(result.name).toBe("StreamGram\n🏷️ Как отметить");
        expect(result.title).toBe("/tag Friends s02e15\n/tag Друзья с02э15");
      });

      it("should create Arabic instruction with Arabic format", () => {
        const mediaDetails: MediaDetails = {
          id: 0,
          imdbId: "tt0108778",
          title: "Friends",
          localizedTitle: "الأصدقاء",
          type: "series",
          overview: null,
          year: 1994,
          seasons: 10,
          episodes: 236,
          episodeInfo: { season: 3, episode: 5 },
        };

        const result = createHowToTagStream(
          "ar",
          mediaDetails,
          "tt0108778:3:5",
          "test-token-123",
        );

        expect(result.name).toBe("StreamGram\n🏷️ كيفية الوسم");
        expect(result.title).toBe("/tag Friends s03e05\n/tag الأصدقاء م03ح05");
      });

      it("should handle double-digit season and episode numbers", () => {
        const mediaDetails: MediaDetails = {
          id: 0,
          imdbId: "tt0108778",
          title: "Friends",
          localizedTitle: null,
          type: "series",
          overview: null,
          year: 1994,
          seasons: 10,
          episodes: 236,
          episodeInfo: { season: 10, episode: 18 },
        };

        const result = createHowToTagStream(
          "en",
          mediaDetails,
          "tt0108778:10:18",
          "test-token-123",
        );

        expect(result.title).toBe("/tag tt0108778:10:18");
      });

      it("should show 'no localized title' for Hebrew episode without localization", () => {
        const mediaDetails: MediaDetails = {
          id: 0,
          imdbId: "tt0108778",
          title: "Friends",
          localizedTitle: null,
          type: "series",
          overview: null,
          year: 1994,
          seasons: 10,
          episodes: 236,
          episodeInfo: { season: 1, episode: 1 },
        };

        const result = createHowToTagStream(
          "he",
          mediaDetails,
          "tt0108778:1:1",
          "test-token-123",
        );

        expect(result.name).toBe("StreamGram\n🏷️ איך לתייג");
        expect(result.title).toBe("/tag Friends s01e01\nאין כותרת בעברית");
      });
    });

    describe("Edge Cases", () => {
      it("should fallback to English config for unknown language", () => {
        const mediaDetails: MediaDetails = {
          id: 0,
          imdbId: "tt0120855",
          title: "Tarzan",
          localizedTitle: null,
          type: "movie",
          overview: null,
          year: 1999,
          seasons: null,
          episodes: null,
          episodeInfo: null,
        };

        const result = createHowToTagStream(
          "fr",
          mediaDetails,
          "tt0120855",
          "test-token-123",
        );

        expect(result.name).toBe("StreamGram\n🏷️ How to Tag");
        expect(result.title).toBe("/tag Tarzan 1999");
      });

      it("should not show 'no localized title' message for English users", () => {
        const mediaDetails: MediaDetails = {
          id: 0,
          imdbId: "tt0120855",
          title: "Tarzan",
          localizedTitle: null,
          type: "movie",
          overview: null,
          year: 1999,
          seasons: null,
          episodes: null,
          episodeInfo: null,
        };

        const result = createHowToTagStream(
          "en",
          mediaDetails,
          "tt0120855",
          "test-token-123",
        );

        expect(result.title).toBe("/tag tt0120855");
        expect(result.title).not.toContain("No localized title");
      });

      it("should handle movie with very long title", () => {
        const mediaDetails: MediaDetails = {
          id: 0,
          imdbId: "tt1234567",
          title:
            "The Incredibly Long Movie Title: A Story of Adventure, Mystery, and Romance",
          localizedTitle: null,
          type: "movie",
          overview: null,
          year: 2025,
          seasons: null,
          episodes: null,
          episodeInfo: null,
        };

        const result = createHowToTagStream(
          "en",
          mediaDetails,
          "tt1234567",
          "test-token-123",
        );

        expect(result.title).toBe("/tag tt1234567");
      });
    });

    describe("Stream Properties", () => {
      it("should always include 🏷️ emoji in name", () => {
        const mediaDetails: MediaDetails = {
          id: 0,
          imdbId: "tt0120855",
          title: "Tarzan",
          localizedTitle: null,
          type: "movie",
          overview: null,
          year: 1999,
          seasons: null,
          episodes: null,
          episodeInfo: null,
        };

        const languages = ["en", "he", "ru", "ar"];
        languages.forEach((lang) => {
          const result = createHowToTagStream(
            lang,
            mediaDetails,
            "tt0120855",
            "test-token-123",
          );
          expect(result.name).toMatch(/^StreamGram\n🏷️ /);
        });
      });

      it("should always set notWebReady to true", () => {
        const mediaDetails: MediaDetails = {
          id: 0,
          imdbId: "tt0120855",
          title: "Tarzan",
          localizedTitle: null,
          type: "movie",
          overview: null,
          year: 1999,
          seasons: null,
          episodes: null,
          episodeInfo: null,
        };

        const result = createHowToTagStream(
          "en",
          mediaDetails,
          "tt1234567",
          "test-token-123",
        );
        expect(result.behaviorHints.notWebReady).toBe(false);
      });

      it("should point to TAG_FEATURE.md documentation", () => {
        const mediaDetails: MediaDetails = {
          id: 0,
          imdbId: "tt0120855",
          title: "Tarzan",
          localizedTitle: null,
          type: "movie",
          overview: null,
          year: 1999,
          seasons: null,
          episodes: null,
          episodeInfo: null,
        };

        const result = createHowToTagStream(
          "en",
          mediaDetails,
          "tt1234567",
          "test-token-123",
        );
        expect(result.url).toContain("/tag/tt1234567");
      });
    });
  });

  describe("Other Utility Functions", () => {
    describe("extractQualityFromFilename", () => {
      it("should extract 4K quality", () => {
        expect(extractQualityFromFilename("Movie.2160p.mkv")).toBe("4K");
        expect(extractQualityFromFilename("Movie.4K.mkv")).toBe("4K");
        expect(extractQualityFromFilename("Movie.UHD.mkv")).toBe("4K");
      });

      it("should extract 1080p quality", () => {
        expect(extractQualityFromFilename("Movie.1080p.mkv")).toBe("1080p");
      });

      it("should return null for unknown quality", () => {
        expect(extractQualityFromFilename("Movie.mkv")).toBeNull();
      });
    });

    describe("detectSubtitlesAndDubbing", () => {
      it("should detect subtitles", () => {
        const result = detectSubtitlesAndDubbing("Movie.hebsub.mkv");
        expect(result.hasSubtitles).toBe(true);
      });

      it("should detect dubbing", () => {
        const result = detectSubtitlesAndDubbing("Movie.hebdub.mkv");
        expect(result.isDubbed).toBe(true);
      });

      it("should detect both", () => {
        const result = detectSubtitlesAndDubbing("Movie.hebsub.hebdub.mkv");
        expect(result.hasSubtitles).toBe(true);
        expect(result.isDubbed).toBe(true);
      });
    });
  });
});
