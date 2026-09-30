import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { TmdbService } from "./tmdb.service";
import {
  TMDBFindResponse,
  TMDBMovieDetailsResponse,
  TMDBSeriesDetailsResponse,
  TMDBMovieAlternativeTitlesResponse,
  TMDBSeriesAlternativeTitlesResponse,
} from "./types";

describe("TmdbService", () => {
  let service: TmdbService;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      const config: Record<string, string> = {
        "tmdb.bearerToken": "test-bearer-token",
        "tmdb.baseUrl": "https://api.themoviedb.org/3",
        "language.preferredLanguage": "he",
        "language.defaultLanguage": "en",
      };
      return config[key] || defaultValue;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TmdbService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<TmdbService>(TmdbService);
    configService = module.get<ConfigService>(ConfigService);

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Service Initialization", () => {
    it("should be defined", () => {
      expect(service).toBeDefined();
    });

    it("should allow startup when TMDB_BEARER_TOKEN is missing", () => {
      const badConfigService = {
        get: jest.fn((key: string) => {
          if (key === "tmdb.bearerToken") return "";
          return "test-value";
        }),
      };

      expect(new TmdbService(badConfigService as any)).toBeDefined();
    });
  });

  describe("getMovieDetails", () => {
    const mockImdbId = "tt1234567";
    const mockMovieId = 12345;

    const mockFindResponse: TMDBFindResponse = {
      movie_results: [{ id: mockMovieId, title: "Test Movie" }],
    };

    const mockEnglishDetails: TMDBMovieDetailsResponse = {
      id: mockMovieId,
      title: "The Test Movie",
      original_title: "The Original Title",
      overview: "This is a test movie",
      release_date: "2024-01-15",
    };

    const mockHebrewDetails: TMDBMovieDetailsResponse = {
      id: mockMovieId,
      title: "סרט הבדיקה",
      original_title: "The Original Title",
      overview: "זהו סרט בדיקה",
      release_date: "2024-01-15",
    };

    const mockLatinHebrewDetails: TMDBMovieDetailsResponse = {
      id: mockMovieId,
      title: "Test Movie Latin", // Not actually Hebrew
      original_title: "The Original Title",
      overview: "זהו סרט בדיקה",
      release_date: "2024-01-15",
    };

    const mockAlternativeTitles: TMDBMovieAlternativeTitlesResponse = {
      id: mockMovieId,
      titles: [
        { iso_3166_1: "IL", title: "הכותרת החלופית בעברית" },
        { iso_3166_1: "US", title: "US Alternative Title" },
      ],
    };

    beforeEach(() => {
      // Mock global fetch
      global.fetch = jest.fn();
    });

    it("should fetch movie details successfully with Hebrew localized title", async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockFindResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockHebrewDetails,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockEnglishDetails,
        });

      const result = await service.getMovieDetails(mockImdbId, "he");

      expect(result).toEqual({
        id: mockMovieId,
        imdbId: mockImdbId,
        title: "The Test Movie",
        localizedTitle: "סרט הבדיקה",
        originalTitle: "The Original Title",
        overview: "This is a test movie",
        type: "movie",
        year: 2024,
      });
    });

    it("should use alternative title when Hebrew title contains only Latin characters", async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockFindResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockLatinHebrewDetails,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockEnglishDetails,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockAlternativeTitles,
        });

      const result = await service.getMovieDetails(mockImdbId, "he");

      expect(result.localizedTitle).toBe("הכותרת החלופית בעברית");
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    it("should fallback to Latin title if no alternative title found", async () => {
      const emptyAlternativeTitles: TMDBMovieAlternativeTitlesResponse = {
        id: mockMovieId,
        titles: [{ iso_3166_1: "US", title: "US Title" }],
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockFindResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockLatinHebrewDetails,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockEnglishDetails,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => emptyAlternativeTitles,
        });

      const result = await service.getMovieDetails(mockImdbId, "he");

      expect(result.localizedTitle).toBe("Test Movie Latin");
    });

    it("should return null localizedTitle when preferredLang equals defaultLang", async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockFindResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockEnglishDetails,
        });

      const result = await service.getMovieDetails(mockImdbId, "en");

      expect(result.localizedTitle).toBeNull();
      expect(global.fetch).toHaveBeenCalledTimes(2); // Only find and default details
    });

    it("should throw error when movie not found", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ movie_results: [] }),
      });

      await expect(service.getMovieDetails(mockImdbId)).rejects.toThrow(
        `Movie not found for IMDB ID ${mockImdbId}`,
      );
    });

    it("should handle API errors gracefully", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(service.getMovieDetails(mockImdbId)).rejects.toThrow(
        "TMDB request failed with status 404",
      );
    });

    it("should use user TMDB token when provided", async () => {
      const userToken = "user-custom-token";

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockFindResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockEnglishDetails,
        });

      await service.getMovieDetails(mockImdbId, "en", userToken);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${userToken}`,
          }),
        }),
      );
    });
  });

  describe("getSeriesDetails", () => {
    const mockImdbId = "tt7654321";
    const mockSeriesId = 54321;

    const mockFindResponse: TMDBFindResponse = {
      tv_results: [{ id: mockSeriesId, name: "Test Series" }],
    };

    const mockEnglishDetails: TMDBSeriesDetailsResponse = {
      id: mockSeriesId,
      name: "The Test Series",
      original_name: "The Original Series",
      overview: "This is a test series",
      first_air_date: "2023-05-20",
      number_of_seasons: 3,
      number_of_episodes: 30,
    };

    const mockHebrewDetails: TMDBSeriesDetailsResponse = {
      id: mockSeriesId,
      name: "סדרת הבדיקה",
      original_name: "The Original Series",
      overview: "זוהי סדרת בדיקה",
      first_air_date: "2023-05-20",
      number_of_seasons: 3,
      number_of_episodes: 30,
    };

    const mockLatinHebrewDetails: TMDBSeriesDetailsResponse = {
      id: mockSeriesId,
      name: "Test Series Latin",
      original_name: "The Original Series",
      overview: "זוהי סדרת בדיקה",
      first_air_date: "2023-05-20",
      number_of_seasons: 3,
      number_of_episodes: 30,
    };

    const mockAlternativeTitles: TMDBSeriesAlternativeTitlesResponse = {
      id: mockSeriesId,
      results: [
        { iso_3166_1: "IL", title: "הכותרת החלופית בעברית" },
        { iso_3166_1: "US", title: "US Alternative Title" },
      ],
    };

    beforeEach(() => {
      global.fetch = jest.fn();
    });

    it("should fetch series details successfully with Hebrew localized name", async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockFindResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockHebrewDetails,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockEnglishDetails,
        });

      const result = await service.getSeriesDetails(mockImdbId, "he");

      expect(result).toEqual({
        id: mockSeriesId,
        imdbId: mockImdbId,
        title: "The Test Series",
        localizedTitle: "סדרת הבדיקה",
        originalTitle: "The Original Series",
        overview: "This is a test series",
        type: "series",
        year: 2023,
        seasons: 3,
        episodes: 30,
      });
    });

    it("should use alternative title when Hebrew name contains only Latin characters", async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockFindResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockLatinHebrewDetails,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockEnglishDetails,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockAlternativeTitles,
        });

      const result = await service.getSeriesDetails(mockImdbId, "he");

      expect(result.localizedTitle).toBe("הכותרת החלופית בעברית");
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    it("should return null localizedTitle when preferredLang equals defaultLang", async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockFindResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockEnglishDetails,
        });

      const result = await service.getSeriesDetails(mockImdbId, "en");

      expect(result.localizedTitle).toBeNull();
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("should throw error when series not found", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tv_results: [] }),
      });

      await expect(service.getSeriesDetails(mockImdbId)).rejects.toThrow(
        `Series not found for IMDB ID ${mockImdbId}`,
      );
    });

    it("should handle missing number_of_seasons and number_of_episodes", async () => {
      const incompleteDetails: TMDBSeriesDetailsResponse = {
        id: mockSeriesId,
        name: "Test Series",
        original_name: "Original",
        overview: "Overview",
        first_air_date: "2023-01-01",
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockFindResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => incompleteDetails,
        });

      const result = await service.getSeriesDetails(mockImdbId, "en");

      expect(result.seasons).toBeUndefined();
      expect(result.episodes).toBeUndefined();
    });
  });

  describe("getMovieDetailsByTmdbId", () => {
    const mockTmdbId = 12345;

    const mockEnglishDetails: TMDBMovieDetailsResponse = {
      id: mockTmdbId,
      title: "Movie by TMDB ID",
      original_title: "Original Movie",
      overview: "Test overview",
      release_date: "2024-06-15",
    };

    const mockHebrewDetails: TMDBMovieDetailsResponse = {
      id: mockTmdbId,
      title: "סרט לפי מזהה",
      original_title: "Original Movie",
      overview: "סקירה בעברית",
      release_date: "2024-06-15",
    };

    beforeEach(() => {
      global.fetch = jest.fn();
    });

    it("should fetch movie by TMDB ID with localized title", async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockHebrewDetails,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockEnglishDetails,
        });

      const result = await service.getMovieDetailsByTmdbId(mockTmdbId, "he");

      expect(result.imdbId).toBe(`tmdb:${mockTmdbId}`);
      expect(result.localizedTitle).toBe("סרט לפי מזהה");
    });
  });

  describe("getSeriesDetailsByTmdbId", () => {
    const mockTmdbId = 54321;

    const mockEnglishDetails: TMDBSeriesDetailsResponse = {
      id: mockTmdbId,
      name: "Series by TMDB ID",
      original_name: "Original Series",
      overview: "Test overview",
      first_air_date: "2023-03-10",
      number_of_seasons: 2,
      number_of_episodes: 20,
    };

    const mockHebrewDetails: TMDBSeriesDetailsResponse = {
      id: mockTmdbId,
      name: "סדרה לפי מזהה",
      original_name: "Original Series",
      overview: "סקירה בעברית",
      first_air_date: "2023-03-10",
      number_of_seasons: 2,
      number_of_episodes: 20,
    };

    beforeEach(() => {
      global.fetch = jest.fn();
    });

    it("should fetch series by TMDB ID with localized title", async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockHebrewDetails,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockEnglishDetails,
        });

      const result = await service.getSeriesDetailsByTmdbId(mockTmdbId, "he");

      expect(result.imdbId).toBe(`tmdb:${mockTmdbId}`);
      expect(result.localizedTitle).toBe("סדרה לפי מזהה");
    });
  });

  describe("Language Detection and Alternative Titles", () => {
    it("should detect Hebrew characters correctly", async () => {
      const mockImdbId = "tt1111111";
      const mockMovieId = 11111;

      const mockFindResponse: TMDBFindResponse = {
        movie_results: [{ id: mockMovieId, title: "Test" }],
      };

      const mockHebrewDetails: TMDBMovieDetailsResponse = {
        id: mockMovieId,
        title: "כותרת עברית טהורה",
        original_title: "Original",
        overview: "Overview",
        release_date: "2024-01-01",
      };

      const mockEnglishDetails: TMDBMovieDetailsResponse = {
        id: mockMovieId,
        title: "Pure English Title",
        original_title: "Original",
        overview: "Overview",
        release_date: "2024-01-01",
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockFindResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockHebrewDetails,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockEnglishDetails,
        });

      const result = await service.getMovieDetails(mockImdbId, "he");

      // Should use Hebrew title directly without fetching alternative titles
      expect(result.localizedTitle).toBe("כותרת עברית טהורה");
      expect(global.fetch).toHaveBeenCalledTimes(3); // No alternative titles call
    });

    it("should detect Russian characters correctly", async () => {
      const mockImdbId = "tt2222222";
      const mockMovieId = 22222;

      const mockFindResponse: TMDBFindResponse = {
        movie_results: [{ id: mockMovieId, title: "Test" }],
      };

      const mockRussianDetails: TMDBMovieDetailsResponse = {
        id: mockMovieId,
        title: "Русское Название",
        original_title: "Original",
        overview: "Overview",
        release_date: "2024-01-01",
      };

      const mockEnglishDetails: TMDBMovieDetailsResponse = {
        id: mockMovieId,
        title: "English Title",
        original_title: "Original",
        overview: "Overview",
        release_date: "2024-01-01",
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockFindResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockRussianDetails,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockEnglishDetails,
        });

      const result = await service.getMovieDetails(mockImdbId, "ru");

      expect(result.localizedTitle).toBe("Русское Название");
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it("should handle alternative titles API failure gracefully", async () => {
      const mockImdbId = "tt3333333";
      const mockMovieId = 33333;

      const mockFindResponse: TMDBFindResponse = {
        movie_results: [{ id: mockMovieId, title: "Test" }],
      };

      const mockLatinDetails: TMDBMovieDetailsResponse = {
        id: mockMovieId,
        title: "Latin Title",
        original_title: "Original",
        overview: "Overview",
        release_date: "2024-01-01",
      };

      const mockEnglishDetails: TMDBMovieDetailsResponse = {
        id: mockMovieId,
        title: "English Title",
        original_title: "Original",
        overview: "Overview",
        release_date: "2024-01-01",
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockFindResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockLatinDetails,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockEnglishDetails,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
        });

      const result = await service.getMovieDetails(mockImdbId, "he");

      // Should fallback to Latin title when alternative titles fails
      expect(result.localizedTitle).toBe("Latin Title");
    });
  });
});
