import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InstanceConfigService } from "../user/instance-config.service";
import {
  MediaDetails,
  TMDBFindResponse,
  TMDBMovieDetailsResponse,
  TMDBSeriesDetailsResponse,
  TMDBMovieAlternativeTitlesResponse,
  TMDBSeriesAlternativeTitlesResponse,
} from "./types";

// Map language codes to ISO 3166-1 country codes for alternative titles
const LANGUAGE_TO_COUNTRY: Record<string, string> = {
  he: "IL", // Hebrew -> Israel
  en: "US", // English -> United States
  ru: "RU", // Russian -> Russia
  ar: "EG", // Arabic -> Egypt
};

// Unicode ranges for language detection
const LANGUAGE_UNICODE_RANGES: Record<string, Array<[number, number]>> = {
  he: [[0x0590, 0x05ff]], // Hebrew
  ru: [[0x0400, 0x04ff]], // Cyrillic (Russian)
  ar: [[0x0600, 0x06ff]], // Arabic
  en: [[0x0000, 0x007f]], // Basic Latin (English)
};

/**
 * Check if text is primarily in the specified language's Unicode range
 * Returns true only if the majority of alphabetic characters are in the expected range
 */
function isTextInLanguage(text: string, languageCode: string): boolean {
  if (!text) return false;

  const ranges = LANGUAGE_UNICODE_RANGES[languageCode];
  if (!ranges) return true; // If no ranges defined, assume it's correct

  let charsInRange = 0;
  let totalAlphabeticChars = 0;

  // Count characters in expected range vs total alphabetic characters
  for (const char of text) {
    const code = char.charCodeAt(0);

    // Skip spaces, numbers, and common punctuation
    if (
      code === 0x0020 || // space
      (code >= 0x0030 && code <= 0x0039) || // digits 0-9
      code === 0x002d || // hyphen
      code === 0x002e || // period
      code === 0x003a || // colon
      code === 0x0027 || // apostrophe
      code === 0x0028 || // (
      code === 0x0029 // )
    ) {
      continue;
    }

    // Count this as an alphabetic character
    totalAlphabeticChars++;

    // Check if it's in the expected range
    for (const [start, end] of ranges) {
      if (code >= start && code <= end) {
        charsInRange++;
        break;
      }
    }
  }

  // Return true only if we found alphabetic chars and at least 80% are in expected range
  return totalAlphabeticChars > 0 && charsInRange / totalAlphabeticChars >= 0.8;
}

@Injectable()
export class TmdbService {
  private readonly fallbackBearerToken: string;
  private readonly baseUrl: string;
  private readonly fallbackPreferredLanguage: string;
  private readonly fallbackDefaultLanguage: string;

  constructor(
    private configService: ConfigService,
    @Optional() private readonly instanceConfig?: InstanceConfigService,
  ) {
    this.fallbackBearerToken = this.configService.get<string>(
      "tmdb.bearerToken",
      "",
    );
    this.baseUrl = this.configService.get<string>("tmdb.baseUrl", "");
    this.fallbackPreferredLanguage = this.configService.get<string>(
      "language.preferredLanguage",
      "he",
    );
    this.fallbackDefaultLanguage = this.configService.get<string>(
      "language.defaultLanguage",
      "en",
    );
  }

  private get bearerToken(): string {
    return (
      this.instanceConfig?.getConfig().tmdb.bearerToken ||
      this.fallbackBearerToken
    );
  }

  private get preferredLanguage(): string {
    return (
      this.instanceConfig?.getConfig().preferredLanguage ||
      this.fallbackPreferredLanguage
    );
  }

  private get defaultLanguage(): string {
    return this.fallbackDefaultLanguage;
  }

  private async get<T>(
    url: string,
    params: Record<string, string>,
    customToken?: string,
  ): Promise<T> {
    const uri = new URL(url);
    Object.entries(params).forEach(([key, value]) =>
      uri.searchParams.append(key, value),
    );

    const token = customToken || this.bearerToken;
    if (!token) {
      throw new Error(
        "TMDB is not configured. Complete the setup wizard or set TMDB_BEARER_TOKEN.",
      );
    }
    const response = await fetch(uri.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`TMDB request failed with status ${response.status}`);
    }

    return (await response.json()) as T;
  }

  private extractYear(date?: string): number | null {
    if (!date) return null;
    const year = Number(date.split("-")[0]);
    return Number.isNaN(year) ? null : year;
  }

  /**
   * Fetch alternative title for a specific country code
   * @param type - Media type: 'movie' or 'tv'
   * @param id - TMDB ID
   * @param languageCode - Language code (e.g., 'he', 'en')
   * @param userTmdbToken - Optional user TMDB token
   * @returns Alternative title or null if not found
   */
  private async fetchAlternativeTitle(
    type: "movie" | "tv",
    id: number,
    languageCode: string,
    userTmdbToken?: string,
  ): Promise<string | null> {
    const countryCode = LANGUAGE_TO_COUNTRY[languageCode];
    if (!countryCode) return null;

    try {
      if (type === "movie") {
        const response = await this.get<TMDBMovieAlternativeTitlesResponse>(
          `${this.baseUrl}/movie/${id}/alternative_titles`,
          {},
          userTmdbToken,
        );

        const match = response.titles?.find(
          (alt) => alt.iso_3166_1 === countryCode,
        );
        return match?.title || null;
      } else {
        const response = await this.get<TMDBSeriesAlternativeTitlesResponse>(
          `${this.baseUrl}/tv/${id}/alternative_titles`,
          {},
          userTmdbToken,
        );

        const match = response.results?.find(
          (alt) => alt.iso_3166_1 === countryCode,
        );
        return match?.title || null;
      }
    } catch (error) {
      // If alternative titles API fails, return null
      return null;
    }
  }

  async getMovieDetails(
    imdbId: string,
    userLanguage?: string,
    userTmdbToken?: string,
  ): Promise<MediaDetails> {
    const preferredLang = userLanguage || this.preferredLanguage;

    const findData = await this.get<TMDBFindResponse>(
      `${this.baseUrl}/find/${imdbId}`,
      {
        external_source: "imdb_id",
      },
      userTmdbToken,
    );

    const movie = findData.movie_results && findData.movie_results[0];
    if (!movie) {
      throw new Error(`Movie not found for IMDB ID ${imdbId}`);
    }

    let preferredDetails: TMDBMovieDetailsResponse;
    let defaultDetails: TMDBMovieDetailsResponse;

    if (preferredLang === this.defaultLanguage) {
      defaultDetails = await this.get<TMDBMovieDetailsResponse>(
        `${this.baseUrl}/movie/${movie.id}`,
        { language: this.defaultLanguage },
        userTmdbToken,
      );
      preferredDetails = defaultDetails;
    } else {
      [preferredDetails, defaultDetails] = await Promise.all([
        this.get<TMDBMovieDetailsResponse>(
          `${this.baseUrl}/movie/${movie.id}`,
          { language: preferredLang },
          userTmdbToken,
        ),
        this.get<TMDBMovieDetailsResponse>(
          `${this.baseUrl}/movie/${movie.id}`,
          { language: this.defaultLanguage },
          userTmdbToken,
        ),
      ]);
    }

    // Determine localized title with language detection
    let localizedTitle: string | null = null;
    if (preferredLang !== this.defaultLanguage) {
      // Check if the preferred title is actually in the expected language
      if (isTextInLanguage(preferredDetails.title, preferredLang)) {
        localizedTitle = preferredDetails.title;
      } else {
        // Title is not in expected language, try to fetch alternative title
        const alternativeTitle = await this.fetchAlternativeTitle(
          "movie",
          movie.id,
          preferredLang,
          userTmdbToken,
        );
        localizedTitle = alternativeTitle || preferredDetails.title;
      }
    }

    return {
      id: movie.id,
      imdbId,
      title: defaultDetails.title,
      localizedTitle,
      originalTitle: defaultDetails.original_title,
      overview: defaultDetails.overview,
      type: "movie",
      year: this.extractYear(defaultDetails.release_date),
    };
  }

  async getMovieDetailsByTmdbId(
    tmdbId: number,
    userLanguage?: string,
    userTmdbToken?: string,
  ): Promise<MediaDetails> {
    const preferredLang = userLanguage || this.preferredLanguage;

    let preferredDetails: TMDBMovieDetailsResponse;
    let defaultDetails: TMDBMovieDetailsResponse;

    if (preferredLang === this.defaultLanguage) {
      defaultDetails = await this.get<TMDBMovieDetailsResponse>(
        `${this.baseUrl}/movie/${tmdbId}`,
        { language: this.defaultLanguage },
        userTmdbToken,
      );
      preferredDetails = defaultDetails;
    } else {
      [preferredDetails, defaultDetails] = await Promise.all([
        this.get<TMDBMovieDetailsResponse>(
          `${this.baseUrl}/movie/${tmdbId}`,
          {
            language: preferredLang,
          },
          userTmdbToken,
        ),
        this.get<TMDBMovieDetailsResponse>(
          `${this.baseUrl}/movie/${tmdbId}`,
          {
            language: this.defaultLanguage,
          },
          userTmdbToken,
        ),
      ]);
    }

    // Determine localized title with language detection
    let localizedTitle: string | null = null;
    if (preferredLang !== this.defaultLanguage) {
      // Check if the preferred title is actually in the expected language
      if (isTextInLanguage(preferredDetails.title, preferredLang)) {
        localizedTitle = preferredDetails.title;
      } else {
        // Title is not in expected language, try to fetch alternative title
        const alternativeTitle = await this.fetchAlternativeTitle(
          "movie",
          tmdbId,
          preferredLang,
          userTmdbToken,
        );
        localizedTitle = alternativeTitle || preferredDetails.title;
      }
    }

    return {
      id: tmdbId,
      imdbId: `tmdb:${tmdbId}`,
      title: defaultDetails.title,
      localizedTitle,
      originalTitle: defaultDetails.original_title,
      overview: defaultDetails.overview,
      type: "movie",
      year: this.extractYear(defaultDetails.release_date),
    };
  }

  async getSeriesDetails(
    imdbId: string,
    userLanguage?: string,
    userTmdbToken?: string,
  ): Promise<MediaDetails> {
    const preferredLang = userLanguage || this.preferredLanguage;

    const findData = await this.get<TMDBFindResponse>(
      `${this.baseUrl}/find/${imdbId}`,
      {
        external_source: "imdb_id",
      },
      userTmdbToken,
    );

    const series = findData.tv_results && findData.tv_results[0];
    if (!series) {
      throw new Error(`Series not found for IMDB ID ${imdbId}`);
    }

    let preferredDetails: TMDBSeriesDetailsResponse;
    let defaultDetails: TMDBSeriesDetailsResponse;

    if (preferredLang === this.defaultLanguage) {
      defaultDetails = await this.get<TMDBSeriesDetailsResponse>(
        `${this.baseUrl}/tv/${series.id}`,
        { language: this.defaultLanguage },
        userTmdbToken,
      );
      preferredDetails = defaultDetails;
    } else {
      [preferredDetails, defaultDetails] = await Promise.all([
        this.get<TMDBSeriesDetailsResponse>(
          `${this.baseUrl}/tv/${series.id}`,
          {
            language: preferredLang,
          },
          userTmdbToken,
        ),
        this.get<TMDBSeriesDetailsResponse>(
          `${this.baseUrl}/tv/${series.id}`,
          {
            language: this.defaultLanguage,
          },
          userTmdbToken,
        ),
      ]);
    }

    // Determine localized title with language detection
    let localizedTitle: string | null = null;
    if (preferredLang !== this.defaultLanguage) {
      // Check if the preferred name is actually in the expected language
      if (isTextInLanguage(preferredDetails.name, preferredLang)) {
        localizedTitle = preferredDetails.name;
      } else {
        // Name is not in expected language, try to fetch alternative title
        const alternativeTitle = await this.fetchAlternativeTitle(
          "tv",
          series.id,
          preferredLang,
          userTmdbToken,
        );
        localizedTitle = alternativeTitle || preferredDetails.name;
      }
    }

    return {
      id: series.id,
      imdbId,
      title: defaultDetails.name,
      localizedTitle,
      originalTitle: defaultDetails.original_name,
      overview: defaultDetails.overview,
      type: "series",
      year: this.extractYear(defaultDetails.first_air_date),
      seasons: defaultDetails.number_of_seasons,
      episodes: defaultDetails.number_of_episodes,
    };
  }

  async getSeriesDetailsByTmdbId(
    tmdbId: number,
    userLanguage?: string,
    userTmdbToken?: string,
  ): Promise<MediaDetails> {
    const preferredLang = userLanguage || this.preferredLanguage;

    let preferredDetails: TMDBSeriesDetailsResponse;
    let defaultDetails: TMDBSeriesDetailsResponse;

    if (preferredLang === this.defaultLanguage) {
      defaultDetails = await this.get<TMDBSeriesDetailsResponse>(
        `${this.baseUrl}/tv/${tmdbId}`,
        { language: this.defaultLanguage },
        userTmdbToken,
      );
      preferredDetails = defaultDetails;
    } else {
      [preferredDetails, defaultDetails] = await Promise.all([
        this.get<TMDBSeriesDetailsResponse>(
          `${this.baseUrl}/tv/${tmdbId}`,
          {
            language: preferredLang,
          },
          userTmdbToken,
        ),
        this.get<TMDBSeriesDetailsResponse>(
          `${this.baseUrl}/tv/${tmdbId}`,
          {
            language: this.defaultLanguage,
          },
          userTmdbToken,
        ),
      ]);
    }

    // Determine localized title with language detection
    let localizedTitle: string | null = null;
    if (preferredLang !== this.defaultLanguage) {
      // Check if the preferred name is actually in the expected language
      if (isTextInLanguage(preferredDetails.name, preferredLang)) {
        localizedTitle = preferredDetails.name;
      } else {
        // Name is not in expected language, try to fetch alternative title
        const alternativeTitle = await this.fetchAlternativeTitle(
          "tv",
          tmdbId,
          preferredLang,
          userTmdbToken,
        );
        localizedTitle = alternativeTitle || preferredDetails.name;
      }
    }

    return {
      id: tmdbId,
      imdbId: `tmdb:${tmdbId}`,
      title: defaultDetails.name,
      localizedTitle,
      originalTitle: defaultDetails.original_name,
      overview: defaultDetails.overview,
      type: "series",
      year: this.extractYear(defaultDetails.first_air_date),
      seasons: defaultDetails.number_of_seasons,
      episodes: defaultDetails.number_of_episodes,
    };
  }
}
