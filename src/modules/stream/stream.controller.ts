import {
  Controller,
  Get,
  Query,
  Param,
  Res,
  Req,
  HttpStatus,
  Header,
  UseGuards,
  ServiceUnavailableException,
} from "@nestjs/common";
import { TypeNotFoundError } from "teleproto/errors";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { Request, Response } from "express";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { ConfigService } from "@nestjs/config";
import { StreamHandlerService } from "./stream-handler.service";
import { InstanceProfileGuard } from "../../common/guards/instance-profile.guard";
import { TelegramNestService } from "../telegram/telegram.service";
import {
  formatStreamForStremio,
  mapSearchPayloadToMediaDetails,
  createHowToTagStream,
} from "../../utils/stremio";
import { SearchResponsePayload } from "./types";
import { MediaSearchResult, PlaybackPeer } from "../telegram/types";
import { logger } from "../../logger";
import {
  MovieSearchDto,
  SeriesSearchDto,
  EpisodeParamsDto,
  WatchParamsDto,
  HashedWatchParamsDto,
} from "../../common/dto/search-params.dto";
import {
  ManifestResponseDto,
  SearchResponseDto,
  StreamsResponseDto,
  TelegramLibraryCatalogDto,
  TelegramLibraryMetaDto,
} from "../../common/dto/responses.dto";
import { UserService } from "../user/user.service";
import { InstanceConfigService } from "../user/instance-config.service";
import { CacheService } from "../cache/cache.service";
import { decodeTelegramFileId, encodeTelegramFileId } from "../../utils/telegram-file-id";
import { LibrarySearchParamsDto } from "../../common/dto/search-params.dto";

@ApiTags("Stream")
@UseGuards(InstanceProfileGuard)
@Controller(":userToken")
export class StreamController {
  constructor(
    private readonly streamHandler: StreamHandlerService,
    private readonly telegramService: TelegramNestService,
    private readonly configService: ConfigService,
    private readonly userService: UserService,
    private readonly cache: CacheService,
    private readonly instanceConfig: InstanceConfigService,
  ) {}

  private getBaseUrl(userToken?: string): string {
    const host =
      this.instanceConfig.getConfig().publicUrl ||
      this.configService.get<string>("server.publicUrl");
    const port = this.configService.get<number>("server.port");
    let baseUrl = host || `http://localhost:${port}`;

    if (
      baseUrl &&
      !baseUrl.startsWith("http://") &&
      !baseUrl.startsWith("https://")
    ) {
      baseUrl = `https://${baseUrl}`;
    }

    baseUrl = baseUrl.replace(/\/$/, "");
    return userToken ? `${baseUrl}/${userToken}` : baseUrl;
  }

  @Get("manifest.json")
  @ApiOperation({ summary: "Get Stremio addon manifest" })
  @ApiResponse({ status: 200, type: ManifestResponseDto })
  async getManifest(@Req() req: Request): Promise<ManifestResponseDto> {
    const nodeEnv = this.configService.get<string>("server.nodeEnv");
    const settingsUrl = `${this.getBaseUrl()}/?action=settings&token=${req.user.token}`;

    return {
      id: "community.telegram-stream-addon",
      version: "1.2.0",
      name: `StreamGram ${nodeEnv === "development" ? "(Dev)" : ""}`,
      description:
        "Search and stream movies/series directly from Telegram. Access your Telegram folders and channels in Stremio.",
      logo: "https://i.ibb.co/Hf8xxJbL/logo-icon-transparent.png",
      resources: ["catalog", "meta", "stream"],
      types: ["movie", "series"],
      catalogs: [
        {
          type: "movie",
          id: "tg_library",
          name: "StreamGram — Telegram Search",
          extra: [{ name: "search", isRequired: true }],
        },
        {
          type: "series",
          id: "telegram_folders",
          name: "My Telegram Folders",
        },
        {
          type: "movie",
          id: "telegram_channels",
          name: "My Telegram Channels",
        },
      ],
      idPrefixes: ["tg_file_", "tg_folder_", "tg_channel_", "tmdb", "tt"],
      behaviorHints: {
        adult: false,
        p2p: false,
        configurable: true,
        configurationRequired: false,
      },
      config: [
        {
          key: "settingsUrl",
          type: "text",
          title: "⚙️ Settings URL (Copy & Paste in Browser)",
          default: settingsUrl,
          required: false,
        },
      ],
    };
  }

  private libraryMeta(result: MediaSearchResult, userToken: string) {
    const id = encodeTelegramFileId(userToken, result.peer, result.messageId);
    const name = result.caption?.split(/\r?\n/).map(line => line.trim()).find(Boolean)
      || result.fileName || `Video ${result.messageId}`;
    const channelTitle = result.channelTitle?.replace(/\s+/g, " ").trim();
    const description = result.caption || result.fileName || name;
    return {
      id, type: "movie", name,
      description: channelTitle ? `${description}\n\n📣 ${channelTitle}` : description,
      poster: `${this.getBaseUrl(userToken)}/file/${id}/poster.jpg`,
      posterShape: "landscape",
    };
  }

  @Get("catalog/movie/tg_library/search=:search.json")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Search the account's Telegram videos using the exact query" })
  @ApiParam({ name: "search", type: String })
  @ApiResponse({ status: 200, type: TelegramLibraryCatalogDto })
  @ApiResponse({ status: 503, description: "Telegram search temporarily unavailable" })
  async searchLibrary(@Req() req: Request, @Param() params: LibrarySearchParamsDto) {
    // Express has already decoded the path parameter. Do not decode it again.
    if (!params.search.trim()) return { metas: [] };
    try {
      const results = await this.telegramService.searchLibrary(req.user, params.search);
      return { metas: results.map(result => this.libraryMeta(result, req.user.token)) };
    } catch {
      throw new ServiceUnavailableException("Telegram search is temporarily unavailable");
    }
  }

  @Get("meta/movie/tg_file_:fileId.json")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Get a single Telegram video item" })
  @ApiResponse({ status: 200, type: TelegramLibraryMetaDto })
  @ApiResponse({ status: 503, description: "Telegram video temporarily unavailable" })
  async getLibraryMeta(@Req() req: Request, @Param("fileId") fileId: string) {
    const reference = decodeTelegramFileId(req.user.token, `tg_file_${fileId}`);
    if (!reference) return { meta: null };
    try {
      const result = await this.telegramService.getLibraryFile(req.user, reference.peer, reference.messageId);
      return { meta: result ? this.libraryMeta(result, req.user.token) : null };
    } catch {
      throw new ServiceUnavailableException("Telegram video is temporarily unavailable");
    }
  }

  @Get("file/:id/poster.jpg")
  @Header("Cache-Control", "private, max-age=3600")
  @ApiOperation({ summary: "Fetch a Telegram video thumbnail on demand" })
  async getLibraryPoster(@Req() req: Request, @Param("id") id: string, @Res() res: Response): Promise<void> {
    const reference = decodeTelegramFileId(req.user.token, id);
    const controller = new AbortController();
    const abort = () => controller.abort();
    res.once("close", abort);
    try {
      const image = reference ? await this.telegramService.getLibraryThumbnail(
        req.user, reference.peer, reference.messageId, controller.signal,
      ) : null;
      if (res.destroyed) return;
      if (image) {
        res.type("image/jpeg").send(image);
      } else {
        res.redirect(302, `${this.getBaseUrl()}/logo-icon-only.png`);
      }
    } finally {
      res.off("close", abort);
    }
  }

  @Get("configure")
  @ApiOperation({ summary: "Redirect to the setup page" })
  configure(@Req() req: Request, @Res() res: Response): void {
    const userToken = req.user.token;
    const baseUrl = this.getBaseUrl();
    res.redirect(`${baseUrl}/?action=settings&token=${userToken}`);
  }

  @Get("catalog/series/telegram_folders.json")
  @ApiOperation({ summary: "Get Telegram folders catalog" })
  @ApiResponse({ status: 200 })
  async getCatalog(@Req() req: Request): Promise<{ metas: any[] }> {
    const user = req.user;

    try {
      // Check cache first
      const cached = await this.cache.getUserFolders<any[]>(user.token);

      let folders: any[];
      if (cached) {
        folders = cached;
        logger.info({ userId: user.id }, "Using cached folders for catalog");
      } else {
        // Fetch folders from Telegram
        folders = await this.telegramService.getUserFolders(
          user.token,
          user.session_string,
        );

        // Cache the folders
        await this.cache.setUserFolders(user.token, folders);
      }

      // Get user's selected folder IDs
      const selectedIds = await this.userService.getSelectedFolders(user.token);

      // Show only selected folders (empty if none selected)
      const filteredFolders = folders.filter((folder: any) =>
        selectedIds.includes(folder.id),
      );

      // Transform folders to Stremio metas with videos
      const metas = await Promise.all(
        filteredFolders.map(async (folder: any) => {
          // Create videos list from channels
          const videos = await Promise.all(
            folder.channelIds.map(async (channelId: string, index: number) => {
              const episodeNum = index + 1;
              let channelTitle = `Channel ${episodeNum}`;

              // Try to get channel info
              try {
                const channelInfo = await this.telegramService.getChannelById(
                  user.token,
                  user.session_string,
                  channelId,
                );

                if (channelInfo?.title) {
                  channelTitle = channelInfo.title;
                }
              } catch (error) {
                logger.warn(
                  {
                    userId: user.id,
                    folderId: folder.id,
                    channelId,
                    error: (error as Error).message,
                  },
                  "Failed to get channel info for catalog, using fallback title",
                );
              }

              return {
                id: `tg_folder_${folder.id}:1:${episodeNum}`,
                title: channelTitle,
                season: 1,
                episode: episodeNum,
                released: new Date().toISOString(),
              };
            }),
          );

          return {
            id: `tg_folder_${folder.id}`,
            type: "series",
            name: folder.title,
            poster: null,
            description: `Telegram folder with ${folder.channelIds.length} channels`,
            videos,
          };
        }),
      );

      logger.info(
        { userId: user.id, folderCount: metas.length },
        "Retrieved folders catalog with videos",
      );

      return { metas };
    } catch (error) {
      logger.error(
        { userId: user.id, error: (error as Error).message },
        "Failed to get folders catalog",
      );
      return { metas: [] };
    }
  }

  @Get("catalog/movie/telegram_channels.json")
  @ApiOperation({ summary: "Get Telegram channels catalog" })
  @ApiResponse({ status: 200 })
  async getChannelsCatalog(@Req() req: Request): Promise<{ metas: any[] }> {
    const user = req.user;
    const baseUrl = this.getBaseUrl(user.token);

    try {
      // Get user's selected channel IDs
      const selectedIds = await this.userService.getSelectedChannels(
        user.token,
      );

      // Transform channel IDs to Stremio metas
      const metas = await Promise.all(
        selectedIds.map(async (channelId: string) => {
          let channelTitle = `Channel ${channelId}`;

          // Try to get channel info
          try {
            const channelInfo = await this.telegramService.getChannelById(
              user.token,
              user.session_string,
              channelId,
            );

            if (channelInfo?.title) {
              channelTitle = channelInfo.title;
            }
          } catch (error) {
            logger.warn(
              {
                userId: user.id,
                channelId,
                error: (error as Error).message,
              },
              "Failed to get channel info for catalog",
            );
          }

          return {
            id: `tg_channel_${channelId}`,
            type: "movie",
            name: channelTitle,
            poster: `${baseUrl}/channel/${channelId}/poster.jpg`,
            description: `Telegram channel with direct video streams`,
          };
        }),
      );

      logger.info(
        { userId: user.id, channelCount: metas.length },
        "Retrieved channels catalog",
      );

      return { metas };
    } catch (error) {
      logger.error(
        { userId: user.id, error: (error as Error).message },
        "Failed to get channels catalog",
      );
      return { metas: [] };
    }
  }

  @Get("meta/series/tg_folder_:folderId.json")
  @ApiOperation({ summary: "Get folder meta with channels as episodes" })
  @ApiParam({
    name: "folderId",
    required: true,
    description: "Telegram folder ID",
  })
  @ApiResponse({ status: 200 })
  async getMeta(
    @Req() req: Request,
    @Param("folderId") folderIdStr: string,
  ): Promise<{ meta: any }> {
    const user = req.user;
    const folderId = parseInt(folderIdStr, 10);

    try {
      // Fetch folders from Telegram
      const folders = await this.telegramService.getUserFolders(
        user.token,
        user.session_string,
      );

      // Find the specific folder
      const folder = folders.find((f) => f.id === folderId);

      if (!folder) {
        logger.warn({ userId: user.id, folderId }, "Folder not found for meta");
        return {
          meta: {
            id: `tg_folder_${folderId}`,
            type: "series",
            name: "Folder Not Found",
            videos: [],
          },
        };
      }

      // Create episodes from channels
      const videos = await Promise.all(
        folder.channelIds.map(async (channelId, index) => {
          const episodeNum = index + 1;

          let channelTitle = `Channel ${episodeNum}`;

          // Try to get channel info (non-blocking, use fallback on error)
          try {
            const channelInfo = await this.telegramService.getChannelById(
              user.token,
              user.session_string,
              channelId,
            );

            if (channelInfo?.title) {
              channelTitle = channelInfo.title;
            }
          } catch (error) {
            logger.warn(
              {
                userId: user.id,
                folderId,
                channelId,
                error: (error as Error).message,
              },
              "Failed to get channel info for meta, using fallback title",
            );
          }

          return {
            id: `tg_folder_${folderId}:1:${episodeNum}`,
            title: channelTitle,
            season: 1,
            episode: episodeNum,
            released: new Date().toISOString(),
          };
        }),
      );

      logger.info(
        {
          userId: user.id,
          folderId,
          episodeCount: videos.length,
          channelIds: folder.channelIds,
        },
        "Retrieved folder meta",
      );

      return {
        meta: {
          id: `tg_folder_${folderId}`,
          type: "series",
          name: folder.title,
          videos,
        },
      };
    } catch (error) {
      logger.error(
        { userId: user.id, folderId, error: (error as Error).message },
        "Failed to get folder meta",
      );
      return {
        meta: {
          id: `tg_folder_${folderId}`,
          type: "series",
          name: "Error",
          videos: [],
        },
      };
    }
  }

  @Get("meta/movie/tg_channel_:channelId.json")
  @ApiOperation({ summary: "Get channel meta" })
  @ApiParam({
    name: "channelId",
    required: true,
    description: "Telegram channel ID",
  })
  @ApiResponse({ status: 200 })
  async getChannelMeta(
    @Req() req: Request,
    @Param("channelId") channelId: string,
  ): Promise<{ meta: any }> {
    const user = req.user;
    const baseUrl = this.getBaseUrl(user.token);

    try {
      // Try to get channel info
      const channelInfo = await this.telegramService.getChannelById(
        user.token,
        user.session_string,
        channelId,
      );

      return {
        meta: {
          id: `tg_channel_${channelId}`,
          type: "movie",
          name: channelInfo?.title || `Channel ${channelId}`,
          poster: `${baseUrl}/channel/${channelId}/poster.jpg`,
          description: `Telegram channel with direct video streams.`,
        },
      };
    } catch (error) {
      logger.error(
        { userId: user.id, channelId, error: (error as Error).message },
        "Failed to get channel meta",
      );
      return {
        meta: {
          id: `tg_channel_${channelId}`,
          type: "movie",
          name: "Error",
          description: "Failed to load channel info",
        },
      };
    }
  }

  @Get("channel/:channelId/poster.jpg")
  @ApiOperation({ summary: "Get channel profile photo as poster" })
  @ApiParam({
    name: "channelId",
    required: true,
    description: "Telegram channel ID",
  })
  @Header("Content-Type", "image/jpeg")
  @Header("Cache-Control", "public, max-age=86400") // Cache for 24 hours
  async getChannelPoster(
    @Req() req: Request,
    @Param("channelId") channelId: string,
    @Res() res: Response,
  ): Promise<void> {
    const user = req.user;

    try {
      const photoBuffer = await this.telegramService.getChannelPhoto(
        user.token,
        user.session_string,
        channelId,
      );

      if (!photoBuffer) {
        // Return a transparent 1x1 pixel or a fallback image if photo not found
        // For now, redirect to a default logo or return 404
        res.status(HttpStatus.NOT_FOUND).send("Photo not found");
        return;
      }

      res.end(photoBuffer);
    } catch (error) {
      logger.error(
        { userId: user.id, channelId, error: (error as Error).message },
        "Failed to serve channel poster",
      );
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).send("Error serving photo");
    }
  }

  @Get("search/movie")
  @ApiOperation({ summary: "Search for a movie" })
  @ApiQuery({ name: "imdb_id", required: true, type: String })
  @ApiResponse({ status: 200, type: SearchResponseDto })
  async searchMovie(
    @Req() req: Request,
    @Query() query: MovieSearchDto,
  ): Promise<SearchResponseDto> {
    const imdbId = String(query.imdb_id || "");

    if (!imdbId) {
      throw new Error("Missing imdb_id query parameter");
    }

    try {
      const result = await this.streamHandler.handleMovieRequest(
        req.user,
        imdbId,
      );
      if (result.error) {
        logger.warn(
          { imdbId, reason: result.error },
          "Telegram search disabled",
        );
      }
      return result;
    } catch (error) {
      logger.error({ err: error, imdbId }, "Failed to handle movie search");
      throw error;
    }
  }

  @Get("search/series")
  @ApiOperation({ summary: "Search for a series" })
  @ApiQuery({ name: "imdb_id", required: true, type: String })
  @ApiResponse({ status: 200, type: SearchResponseDto })
  async searchSeries(
    @Req() req: Request,
    @Query() query: SeriesSearchDto,
  ): Promise<SearchResponseDto> {
    const imdbId = String(query.imdb_id || "");

    if (!imdbId) {
      throw new Error("Missing imdb_id query parameter");
    }

    try {
      const result = await this.streamHandler.handleSeriesRequest(
        req.user,
        imdbId,
      );
      if (result.error) {
        logger.warn(
          { imdbId, reason: result.error },
          "Telegram search disabled",
        );
      }
      return result;
    } catch (error) {
      logger.error({ err: error, imdbId }, "Failed to handle series search");
      throw error;
    }
  }

  @Get("search/series/:imdbId/season/:season/episode/:episode")
  @ApiOperation({ summary: "Search for a specific episode" })
  @ApiParam({ name: "imdbId", required: true })
  @ApiParam({ name: "season", required: true })
  @ApiParam({ name: "episode", required: true })
  @ApiResponse({ status: 200, type: SearchResponseDto })
  async searchEpisode(
    @Req() req: Request,
    @Param() params: EpisodeParamsDto,
  ): Promise<SearchResponseDto> {
    const { imdbId, season, episode } = params;

    try {
      const result = await this.streamHandler.handleEpisodeRequest(
        req.user,
        imdbId,
        Number(season),
        Number(episode),
      );
      if (result.error) {
        logger.warn(
          { imdbId, season, episode, reason: result.error },
          "Telegram search disabled",
        );
      }
      return result;
    } catch (error) {
      logger.error(
        { error, imdbId, season, episode },
        "Failed to handle episode search",
      );
      throw error;
    }
  }

  @Get("stream/:type/:idWithEpisode.json")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Get stream links for Stremio" })
  @ApiParam({ name: "type", required: true, enum: ["movie", "series"] })
  @ApiParam({ name: "idWithEpisode", required: true })
  @ApiResponse({ status: 200, type: StreamsResponseDto })
  async getStream(
    @Req() req: Request,
    @Param("type") type: string,
    @Param("idWithEpisode") idWithEpisode: string,
  ): Promise<StreamsResponseDto> {
    const user = req.user;

    if (idWithEpisode.startsWith("tg_file_")) {
      const reference = decodeTelegramFileId(user.token, idWithEpisode);
      if (type !== "movie" || !reference) return { streams: [] };
      try {
        const file = await this.telegramService.getLibraryFile(user, reference.peer, reference.messageId);
        if (!file) return { streams: [] };
        const stream = formatStreamForStremio(user.token, file, undefined, this.getBaseUrl(user.token), user.language);
        return { streams: stream ? [stream] : [] };
      } catch {
        throw new ServiceUnavailableException("Telegram video is temporarily unavailable");
      }
    }

    try {
      const decoded = decodeURIComponent(idWithEpisode);
      let result: SearchResponsePayload | null = null;

      if (decoded.includes(":")) {
        const parts = decoded.split(":");

        // Handle tg_folder_{id}:season:episode format for Telegram folders
        if (parts.length === 3 && parts[0].startsWith("tg_folder_")) {
          const folderIdStr = parts[0].replace("tg_folder_", "");
          const folderId = parseInt(folderIdStr, 10);
          const episodeNum = parseInt(parts[2], 10);

          // Get videos from the channel in the folder
          const messages = await this.streamHandler.getFolderChannelVideos(
            user,
            folderId,
            episodeNum,
          );

          return { streams: this.mapMessagesToStreams(messages, user.token, user.language) };
        }

        // Handle tmdb:id:season:episode format (4 parts)
        if (parts.length === 4 && parts[0] === "tmdb") {
          const [, tmdbId, seasonStr, episodeStr] = parts;
          if (type !== "series") {
            return { streams: [] };
          }
          result = await this.streamHandler.handleEpisodeRequest(
            user,
            `tmdb:${tmdbId}`,
            Number(seasonStr),
            Number(episodeStr),
            decoded,
          );
        }
        // Handle imdbId:season:episode format (3 parts)
        else if (parts.length === 3) {
          const [imdbId, seasonStr, episodeStr] = parts;
          if (type !== "series") {
            return { streams: [] };
          }
          result = await this.streamHandler.handleEpisodeRequest(
            user,
            imdbId,
            Number(seasonStr),
            Number(episodeStr),
            decoded,
          );
        }
        // Handle tmdb:id format for movies or series (2 parts)
        else if (parts.length === 2 && parts[0] === "tmdb") {
          if (type === "movie") {
            result = await this.streamHandler.handleMovieRequest(
              user,
              decoded,
              decoded,
            );
          } else if (type === "series") {
            result = await this.streamHandler.handleSeriesRequest(
              user,
              decoded,
              decoded,
            );
          } else {
            return { streams: [] };
          }
        }
        // Invalid format
        else {
          return { streams: [] };
        }
      } else {
        // Handle tg_channel_{id} format for Telegram channels (direct movie type)
        if (decoded.startsWith("tg_channel_")) {
          const channelId = decoded.replace("tg_channel_", "");

          // Get videos from the channel
          const messages = await this.streamHandler.getChannelVideos(
            user,
            channelId,
          );

          return { streams: this.mapMessagesToStreams(messages, user.token, user.language) };
        }

        if (type === "movie") {
          result = await this.streamHandler.handleMovieRequest(
            user,
            decoded,
            decoded,
          );
        } else if (type === "series") {
          result = await this.streamHandler.handleSeriesRequest(
            user,
            decoded,
            decoded,
          );
        } else {
          return { streams: [] };
        }
      }

      if (!result || !Array.isArray(result.results)) {
        return { streams: [] };
      }

      if (result.error) {
        logger.warn(
          { type, idWithEpisode: decoded, reason: result.error },
          "Telegram search disabled",
        );
        return { streams: [] };
      }

      const mediaDetails = mapSearchPayloadToMediaDetails(result);
      const streams = result.results
        .slice(0, 10)
        .map((item) =>
          formatStreamForStremio(
            req.user.token,
            item,
            mediaDetails,
            this.getBaseUrl(user.token),
            user.language,
          ),
        )
        .filter((stream): stream is NonNullable<typeof stream> =>
          Boolean(stream),
        );

      // Add "How to Tag" instructional stream at the end
      const howToTagStream = createHowToTagStream(
        user.language,
        mediaDetails,
        idWithEpisode,
        user.token,
        this.getBaseUrl(user.token),
      );
      return { streams: [...streams, howToTagStream] };
    } catch (error) {
      logger.error(
        { error, type, idWithEpisode },
        "Failed to build stream response",
      );
      return { streams: [] };
    }
  }

  @Get("watch/channel/:chatId/:accessHash/:messageId")
  @ApiOperation({ summary: "Stream a Telegram channel or supergroup video" })
  @ApiParam({ name: "chatId", description: "Positive channel ID" })
  @ApiParam({ name: "accessHash", description: "Signed 64-bit peer access hash", type: String })
  @ApiParam({ name: "messageId" })
  @Header("Accept-Ranges", "bytes")
  @Header("Access-Control-Allow-Origin", "*")
  @Header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
  @Header("Access-Control-Allow-Headers", "Range, Content-Type")
  async watchChannel(
    @Param() params: HashedWatchParamsDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return this.streamVideo({ kind: "channel", id: params.chatId, accessHash: params.accessHash }, params.messageId, req, res);
  }

  @Get("watch/user/:chatId/:accessHash/:messageId")
  @ApiOperation({ summary: "Stream a Telegram user video" })
  @ApiParam({ name: "chatId", description: "Positive user ID" })
  @ApiParam({ name: "accessHash", description: "Signed 64-bit peer access hash", type: String })
  @ApiParam({ name: "messageId" })
  @Header("Accept-Ranges", "bytes")
  @Header("Access-Control-Allow-Origin", "*")
  @Header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
  @Header("Access-Control-Allow-Headers", "Range, Content-Type")
  async watchUser(
    @Param() params: HashedWatchParamsDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return this.streamVideo({ kind: "user", id: params.chatId, accessHash: params.accessHash }, params.messageId, req, res);
  }

  @Get("watch/self/:chatId/:messageId")
  @ApiOperation({ summary: "Stream a video from the account's Saved Messages" })
  @ApiParam({ name: "chatId", description: "Positive account user ID" })
  @ApiParam({ name: "messageId" })
  @Header("Accept-Ranges", "bytes")
  @Header("Access-Control-Allow-Origin", "*")
  @Header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
  @Header("Access-Control-Allow-Headers", "Range, Content-Type")
  async watchSelf(
    @Param() params: WatchParamsDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return this.streamVideo({ kind: "self", id: params.chatId }, params.messageId, req, res);
  }

  @Get("watch/chat/:chatId/:messageId")
  @ApiOperation({ summary: "Stream video file from Telegram" })
  @ApiParam({ name: "chatId", required: true })
  @ApiParam({ name: "messageId", required: true })
  @Header("Accept-Ranges", "bytes")
  @Header("Access-Control-Allow-Origin", "*")
  @Header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
  @Header("Access-Control-Allow-Headers", "Range, Content-Type")
  async watchVideo(
    @Param() params: WatchParamsDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return this.streamVideo({ kind: "chat", id: params.chatId }, params.messageId, req, res);
  }

  private async streamVideo(peer: PlaybackPeer, messageId: string, req: Request, res: Response): Promise<void> {
    const chatId = peer.id;
    const user = req.user;

    const controller = this.telegramService.createStreamSession();
    let stream: Readable | undefined;
    let releaseClient: (() => void) | undefined;
    // IncomingMessage.close also fires when the GET request finishes reading.
    // Only the response connection tells us whether playback disconnected.
    const onClose = () => {
      // Pipeline also closes the response on upstream errors; keep those visible
      // to the catch block instead of classifying them as player disconnects.
      if (!res.writableFinished && !stream?.errored) controller.abort();
      stream?.destroy();
    };
    res.once("close", onClose);
    // Disable socket inactivity timeouts only for this long-lived response.
    res.setTimeout(0);

    try {
      const { client, message, release } = await this.telegramService.preparePlayback(
        user.token,
        user.session_string,
        peer,
        Number(messageId),
        controller.signal,
      );
      releaseClient = release;
      if (controller.signal.aborted || res.destroyed) return;

      if (!this.telegramService.hasStreamableMedia(message)) {
        res.status(400).json({ error: "Message does not contain a video" });
        return;
      }
      const fileSize = this.telegramService.getFileSize(message);
      if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
        res.status(404).json({ error: "Unable to determine file size" });
        return;
      }

      let start = 0;
      let end = fileSize - 1;
      let status = 200;
      // HEAD describes the full representation; Range applies to GET only.
      // Ignore If-Range without a validator, returning the full representation.
      if (
        req.method === "GET" &&
        req.headers.range?.startsWith("bytes=") &&
        !req.headers["if-range"]
      ) {
        const ranges = req.range(fileSize, { combine: true });
        if (ranges === -1) {
          res.status(416).set({
            "Content-Range": `bytes */${fileSize}`,
            "Content-Length": "0",
          }).end();
          return;
        }
        // Ignore malformed/unknown units and multiple ranges (no multipart support).
        if (
          ranges && ranges !== -2 &&
          ranges.type === "bytes" && ranges.length === 1
        ) {
          ({ start, end } = ranges[0]);
          status = 206;
        }
      }

      res.status(status).set({
        "Content-Type": this.telegramService.getContentType(message),
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range, Content-Type",
        "Access-Control-Expose-Headers":
          "Content-Length, Content-Range, Accept-Ranges",
      });
      if (status === 206) {
        res.set("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      }
      if (req.method === "HEAD") {
        res.end();
        return;
      }

      // One HTTP body for the entire requested range, independent of Telegram
      // RPC chunk size. Pipeline provides backpressure and propagates failures.
      stream = Readable.from(
        this.telegramService.streamMessageRange(
          client, message, start, end, controller,
        ),
        { objectMode: false },
      );
      await pipeline(stream, res);
    } catch (error) {
      if (!controller.signal.aborted) {
        logger.error({
          ...(error instanceof TypeNotFoundError
            ? { errorName: "TypeNotFoundError", constructorId: error.invalidConstructorId }
            : { err: error }), chatId, messageId,
        }, "Failed to stream video");
      }
      if (!res.destroyed) {
        if (!res.headersSent) {
          res.removeHeader("Content-Length");
          res.removeHeader("Content-Range");
          const temporary = error instanceof TypeNotFoundError || error instanceof ServiceUnavailableException;
          if (temporary) res.setHeader("Retry-After", "30");
          res.status(temporary ? 503 : 500).json({ error: "Unable to stream video" });
        } else {
          // A truncated body must fail, rather than look like a successful EOF.
          res.destroy();
        }
      }
    } finally {
      releaseClient?.();
      res.removeListener("close", onClose);
      await this.telegramService.releaseStreamSession(controller);
    }
  }

  /**
   * Send a tag to Saved Messages and show the long-running instruction screen.
   */
  @Get("tag/:catalogId")
  @ApiOperation({
    summary: "Send tag command to Telegram Saved Messages and show tutorial",
  })
  @ApiParam({
    name: "catalogId",
    required: true,
    description: "Catalog ID (e.g., tt0108778:1:1 or tmdb:550)",
  })
  async sendTag(
    @Param("catalogId") catalogId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const user = req.user;
    // This action sends a private message; never cache its redirect in clients/proxies.
    res.setHeader("Cache-Control", "no-store");
    const decoded = decodeURIComponent(catalogId);
    const cacheKey = `tag-sent:${user.token}:${decoded}`;

    try {
      // Check if we've already sent this tag recently (within last 5 minutes)
      const alreadySent = await this.cache.get(cacheKey);

      if (!alreadySent) {
        // Get user's Telegram client
        const client = await this.telegramService.getClientForUser(
          user.token,
          user.session_string,
        );

        // Format the tag message
        const tagMessage = `/tag ${decoded}`;

        // Send to Saved Messages (channelId defaults to undefined)
        await this.telegramService.sendMessage(client, tagMessage);

        logger.info(
          { userId: user.id, catalogId: decoded },
          "Successfully sent tag to Saved Messages",
        );

        // Mark as sent in cache (5 minutes TTL to prevent duplicate sends)
        await this.cache.set(cacheKey, "sent", 300);
      } else {
        logger.debug(
          { userId: user.id, catalogId: decoded },
          "Tag already sent recently, skipping duplicate send",
        );
      }

      // Use the authenticated account's addon language; keep asset paths allowlisted.
      const language = ["en", "he", "ru", "ar", "es"].includes(user.language)
        ? user.language
        : "en";
      res.redirect(302, `${this.getBaseUrl()}/assets/tag-assistant/instructions-${language}.mp4`);
    } catch (error) {
      logger.error(
        {
          userId: user.id,
          catalogId: decoded,
          error: (error as Error).message,
        },
        "Failed to send tag to Telegram",
      );

      // The instruction screen says the tag was sent, so only show it on success.
      throw new ServiceUnavailableException(
        "Could not send the tag to Telegram. Please try again.",
      );
    }
  }

  /**
   * Helper to map Telegram messages to Stremio streams
   */
  private mapMessagesToStreams(
    messages: MediaSearchResult[],
    userToken: string,
    userLanguage: string,
  ): any[] {
    return messages
      .slice(0, 50)
      .map((item) =>
        formatStreamForStremio(
          userToken,
          item,
          undefined,
          this.getBaseUrl(userToken),
          userLanguage,
        ),
      )
      .filter((stream) => Boolean(stream));
  }
}
