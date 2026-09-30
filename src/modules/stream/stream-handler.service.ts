import { Injectable } from "@nestjs/common";
import { TmdbService } from "../tmdb/tmdb.service";
import { TelegramNestService } from "../telegram/telegram.service";
import { WikidataService } from "../wikidata/wikidata.service";
import { MediaDetails } from "../tmdb/types";
import { SearchResponsePayload } from "./types";
import { logger } from "../../logger";
import { InstanceProfile as User } from "../user/instance-profile";
import { CacheService } from "../cache/cache.service";
import { MediaSearchResult } from "../telegram/types";

@Injectable()
export class StreamHandlerService {
  constructor(
    private readonly tmdbService: TmdbService,
    private readonly telegramService: TelegramNestService,
    private readonly cache: CacheService,
    private readonly wikidataService: WikidataService,
  ) {}

  private async performSearch(
    user: User,
    details: MediaDetails,
    baseQuery: string,
    catalogId?: string,
  ): Promise<SearchResponsePayload> {
    // Get or initialize the user's Telegram client
    const client = await this.telegramService.getClientForUser(
      user.token,
      user.session_string,
    );

    const mediaInfo: MediaDetails = { ...details };
    const results = await this.telegramService.searchMedia(
      client,
      baseQuery,
      mediaInfo,
      user,
      catalogId,
    );

    const payload: SearchResponsePayload = {
      imdb_id: details.imdbId,
      title: details.title,
      localized_title: details.localizedTitle ?? undefined,
      type: details.type,
      year: details.year ?? undefined,
      seasons: details.seasons ?? undefined,
      episodes: details.episodes ?? undefined,
      results,
    };

    if (details.type === "series" && details.episodeInfo) {
      payload.season = details.episodeInfo.season;
      payload.episode = details.episodeInfo.episode;
    }

    return payload;
  }

  async handleMovieRequest(
    user: User,
    imdbId: string,
    catalogId?: string,
  ): Promise<SearchResponsePayload> {
    logger.info({ imdbId, userId: user.id }, "Handling movie request");
    let details: MediaDetails;

    const userLanguage = user.language || "en";
    const userTmdbToken = user.tmdb_token || undefined;

    try {
      if (imdbId.startsWith("tmdb:")) {
        const tmdbId = parseInt(imdbId.replace("tmdb:", ""), 10);
        details = await this.tmdbService.getMovieDetailsByTmdbId(
          tmdbId,
          userLanguage,
          userTmdbToken,
        );
      } else {
        details = await this.tmdbService.getMovieDetails(
          imdbId,
          userLanguage,
          userTmdbToken,
        );
      }
    } catch (error) {
      // Try Wikidata as fallback for IMDB IDs only
      if (!imdbId.startsWith("tmdb:")) {
        logger.info(
          { imdbId, userId: user.id },
          "TMDB failed, trying Wikidata fallback",
        );
        const wikidataResult = await this.wikidataService.fetchTitlesByImdbId(
          imdbId,
          userLanguage,
          "en",
        );

        if (wikidataResult) {
          logger.info(
            { imdbId, userId: user.id },
            "Wikidata fallback successful",
          );
          details = {
            id: 0, // Placeholder ID for Wikidata results
            imdbId,
            title: wikidataResult.titleEn,
            localizedTitle: wikidataResult.titleLocalized,
            originalTitle: null,
            overview: null,
            type: "movie",
            year: null,
          };
        } else {
          logger.error(
            { imdbId, userId: user.id, error: (error as Error).message },
            "Both TMDB and Wikidata failed",
          );
          throw error;
        }
      } else {
        throw error;
      }
    }

    const query = details.localizedTitle || details.title;
    return this.performSearch(user, details, query, catalogId);
  }

  async handleSeriesRequest(
    user: User,
    imdbId: string,
    catalogId?: string,
  ): Promise<SearchResponsePayload> {
    logger.info({ imdbId, userId: user.id }, "Handling series request");
    let details: MediaDetails;

    const userLanguage = user.language || "en";
    const userTmdbToken = user.tmdb_token || undefined;

    try {
      if (imdbId.startsWith("tmdb:")) {
        const tmdbId = parseInt(imdbId.replace("tmdb:", ""), 10);
        details = await this.tmdbService.getSeriesDetailsByTmdbId(
          tmdbId,
          userLanguage,
          userTmdbToken,
        );
      } else {
        details = await this.tmdbService.getSeriesDetails(
          imdbId,
          userLanguage,
          userTmdbToken,
        );
      }
    } catch (error) {
      // Try Wikidata as fallback for IMDB IDs only
      if (!imdbId.startsWith("tmdb:")) {
        logger.info(
          { imdbId, userId: user.id },
          "TMDB failed, trying Wikidata fallback",
        );
        const wikidataResult = await this.wikidataService.fetchTitlesByImdbId(
          imdbId,
          userLanguage,
          "en",
        );

        if (wikidataResult) {
          logger.info(
            { imdbId, userId: user.id },
            "Wikidata fallback successful",
          );
          details = {
            id: 0, // Placeholder ID for Wikidata results
            imdbId,
            title: wikidataResult.titleEn,
            localizedTitle: wikidataResult.titleLocalized,
            originalTitle: null,
            overview: null,
            type: "series",
            year: null,
            seasons: null,
            episodes: null,
          };
        } else {
          logger.error(
            { imdbId, userId: user.id, error: (error as Error).message },
            "Both TMDB and Wikidata failed",
          );
          throw error;
        }
      } else {
        throw error;
      }
    }

    const query = details.localizedTitle || details.title;
    return this.performSearch(user, details, query, catalogId);
  }

  async handleEpisodeRequest(
    user: User,
    imdbId: string,
    season: number,
    episode: number,
    catalogId?: string,
  ): Promise<SearchResponsePayload> {
    logger.info(
      { imdbId, season, episode, userId: user.id },
      "Handling episode request",
    );
    let details: MediaDetails;

    const userLanguage = user.language || "en";
    const userTmdbToken = user.tmdb_token || undefined;

    try {
      if (imdbId.startsWith("tmdb:")) {
        const tmdbId = parseInt(imdbId.replace("tmdb:", ""), 10);
        details = await this.tmdbService.getSeriesDetailsByTmdbId(
          tmdbId,
          userLanguage,
          userTmdbToken,
        );
      } else {
        details = await this.tmdbService.getSeriesDetails(
          imdbId,
          userLanguage,
          userTmdbToken,
        );
      }
    } catch (error) {
      // Try Wikidata as fallback for IMDB IDs only
      if (!imdbId.startsWith("tmdb:")) {
        logger.info(
          { imdbId, userId: user.id },
          "TMDB failed, trying Wikidata fallback",
        );
        const wikidataResult = await this.wikidataService.fetchTitlesByImdbId(
          imdbId,
          userLanguage,
          "en",
        );

        if (wikidataResult) {
          logger.info(
            { imdbId, userId: user.id },
            "Wikidata fallback successful",
          );
          details = {
            id: 0, // Placeholder ID for Wikidata results
            imdbId,
            title: wikidataResult.titleEn,
            localizedTitle: wikidataResult.titleLocalized,
            originalTitle: null,
            overview: null,
            type: "series",
            year: null,
            seasons: null,
            episodes: null,
          };
        } else {
          logger.error(
            { imdbId, userId: user.id, error: (error as Error).message },
            "Both TMDB and Wikidata failed",
          );
          throw error;
        }
      } else {
        throw error;
      }
    }

    const enrichedDetails: MediaDetails = {
      ...details,
      episodeInfo: { season, episode },
    };

    const query = enrichedDetails.localizedTitle || enrichedDetails.title;
    return this.performSearch(user, enrichedDetails, query, catalogId);
  }
  /**
   * Get videos from a specific channel in a Telegram folder
   * @param user - The user making the request
   * @param folderId - The folder ID
   * @param episodeNum - The episode number (channel index in folder, 1-based)
   * @returns Array of MediaSearchResult objects
   */
  async getFolderChannelVideos(
    user: User,
    folderId: number,
    episodeNum: number,
  ): Promise<MediaSearchResult[]> {
    logger.info(
      { userId: user.id, folderId, episodeNum },
      "Handling folder channel videos request",
    );

    try {
      // Check cache first
      const cacheKey = `folder_${user.id}_${folderId}_ep_${episodeNum}`;
      const cached = await this.cache.getChannelVideos<MediaSearchResult[]>(
        cacheKey,
        0,
      );
      if (cached) {
        logger.info(
          { userId: user.id, folderId, episodeNum },
          "Using cached folder channel videos",
        );
        return cached;
      }

      // Get user's folders
      const folders = await this.telegramService.getUserFolders(
        user.token,
        user.session_string,
      );

      // Find the specific folder
      const folder = folders.find((f) => f.id === folderId);
      if (!folder) {
        logger.warn({ userId: user.id, folderId }, "Folder not found");
        return [];
      }

      // Get the channel at the episode index (episodeNum is 1-based)
      const channelIndex = episodeNum - 1;
      if (channelIndex < 0 || channelIndex >= folder.channelIds.length) {
        logger.warn(
          {
            userId: user.id,
            folderId,
            episodeNum,
            channelCount: folder.channelIds.length,
          },
          "Invalid episode number for folder",
        );
        return [];
      }

      const channelId = folder.channelIds[channelIndex];

      // Get messages from the channel
      const messages = await this.telegramService.getChannelMessages(
        user.token,
        user.session_string,
        channelId,
        200, // Limit to 50 videos
        0, // No offset for now
      );

      // Cache the results
      await this.cache.setChannelVideos(cacheKey, 0, messages);

      logger.info(
        {
          userId: user.id,
          folderId,
          episodeNum,
          channelId,
          videoCount: messages.length,
        },
        "Retrieved folder channel videos",
      );

      return messages;
    } catch (error) {
      logger.error(
        {
          userId: user.id,
          folderId,
          episodeNum,
          error: (error as Error).message,
        },
        "Failed to get folder channel videos",
      );
      return [];
    }
  }

  /**
   * Get videos from a specific Telegram channel
   * @param user - The user making the request
   * @param channelId - The Telegram channel ID
   * @returns Array of MediaSearchResult objects
   */
  async getChannelVideos(
    user: User,
    channelId: string,
  ): Promise<MediaSearchResult[]> {
    logger.info(
      { userId: user.id, channelId },
      "Handling channel videos request",
    );

    try {
      // Check cache first
      const cacheKey = `channel_vids_${user.id}_${channelId}`;
      const cached = await this.cache.getChannelVideos<MediaSearchResult[]>(
        cacheKey,
        0,
      );
      if (cached) {
        logger.info(
          { userId: user.id, channelId },
          "Using cached channel videos",
        );
        return cached;
      }

      // Get messages from the channel
      const messages = await this.telegramService.getChannelMessages(
        user.token,
        user.session_string,
        channelId,
        50, // Limit to 50 videos
        0, // No offset
      );

      // Cache the results
      await this.cache.setChannelVideos(cacheKey, 0, messages);

      logger.info(
        {
          userId: user.id,
          channelId,
          videoCount: messages.length,
        },
        "Retrieved channel videos",
      );

      return messages;
    } catch (error) {
      logger.error(
        {
          userId: user.id,
          channelId,
          error: (error as Error).message,
        },
        "Failed to get channel videos",
      );
      return [];
    }
  }

  async cleanup(): Promise<void> {
    await this.telegramService.cleanup();
  }
}
