import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Buffer } from "buffer";
import { TelegramClient } from "telegram";
import { Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import path from "path";
import { promises as fs } from "fs";
//@ts-ignore
import { Message } from "telegram/tl/custom";
import { EntityLike } from "telegram/define";
import bigInt from "big-integer";
import { computeCheck } from "telegram/Password";
import { CacheService } from "../cache/cache.service";
import { MediaDetails } from "../tmdb/types";
import { MediaSearchResult, EpisodeInfo } from "./types";
import { logger } from "../../logger";
import { TelegramClientManager } from "./telegram-client.manager";
import { InstanceConfigService } from "../user/instance-config.service";
import { InstanceProfile } from "../user/instance-profile";

export class TelegramClientUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramClientUnavailableError";
  }
}

export class PasswordRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordRequiredError";
  }
}

const VIDEO_EXTENSIONS = [
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".wmv",
  ".flv",
  ".webm",
  ".m4v",
  ".mpg",
  ".mpeg",
  ".3gp",
  ".f4v",
  ".asf",
  ".rm",
  ".rmvb",
  ".vob",
  ".ogv",
  ".drc",
  ".gif",
  ".gifv",
  ".mng",
  ".qt",
  ".yuv",
  ".ts",
  ".mts",
  ".m2ts",
  ".mxf",
];

// Symbols used to split titles (e.g., "Avengers: Endgame" -> "Avengers")
const TITLE_SPLIT_SYMBOLS = [":", "-"];

@Injectable()
export class TelegramNestService {
  private readonly activeControllers = new Set<AbortController>();

  private TELEGRAM_CONFIG: any;
  private LANGUAGE_CONFIG: any;
  private SEARCH_RESULTS: any;
  private SEARCH_CONFIG: any;
  private STREAMING_CONFIG: any;

  constructor(
    private readonly cache: CacheService,
    private readonly configService: ConfigService,
    private readonly clientManager: TelegramClientManager,
    @Optional() private readonly instanceConfig?: InstanceConfigService,
  ) {
    this.TELEGRAM_CONFIG = {
      apiId: this.configService.get<number>("telegram.apiId", 0),
      apiHash: this.configService.get<string>("telegram.apiHash", ""),
    };
    this.LANGUAGE_CONFIG = this.configService.get("language", {});
    this.SEARCH_RESULTS = this.configService.get("searchResults", {});
    this.SEARCH_CONFIG = this.configService.get("search", {});
    this.STREAMING_CONFIG = this.configService.get("streaming", {});
  }

  /**
   * Get the Telegram client for a specific user
   * @param _instanceKey - Compatibility parameter for the local instance
   * @param sessionString - The local instance's session string
   */
  async getClientForUser(
    userToken: string,
    sessionString: string,
  ): Promise<TelegramClient> {
    return this.clientManager.getOrInitializeClient(userToken, sessionString);
  }

  /**
   * Check if the Telegram client is connected and session is valid
   * @param _instanceKey - Compatibility parameter for the local instance
   * @param sessionString - The local instance's session string
   */
  async checkTelegramConnection(
    userToken: string,
    sessionString: string,
  ): Promise<boolean> {
    try {
      const client = await this.getClientForUser(userToken, sessionString);
      if (!client.connected) return false;

      // Perform a small request to verify the session is really active
      await client.getMe();
      return true;
    } catch (error) {
      logger.error(
        { userToken, error: (error as Error).message },
        "Telegram active connection check failed",
      );
      return false;
    }
  }

  /**
   * Get the phone number associated with the authenticated Telegram session.
   * The caller is responsible for masking the value before returning it.
   */
  async getTelegramPhone(
    userToken: string,
    sessionString: string,
  ): Promise<string | null> {
    try {
      const client = await this.getClientForUser(userToken, sessionString);
      if (!client.connected) return null;

      const me = await client.getMe();
      if (!me || !("phone" in me) || !me.phone) return null;

      return String(me.phone);
    } catch (error) {
      logger.warn(
        { error: (error as Error).message },
        "Failed to retrieve Telegram account phone number",
      );
      return null;
    }
  }

  /**
   * Send authentication code to a phone number
   * Creates a temporary Telegram client to send the code
   * Returns the phoneCodeHash and temporary session string that must be used for verification
   */
  async sendAuthCode(phone: string): Promise<{
    phoneCodeHash: string;
    isCodeViaApp: boolean;
    tempSessionString: string;
  }> {
    const telegramConfig = this.getTelegramConfig();
    const tempClient = new TelegramClient(
      new StringSession(""),
      telegramConfig.apiId,
      telegramConfig.apiHash,
      {
        connectionRetries: 5,
      },
    );

    try {
      await tempClient.connect();

      const result = await tempClient.invoke(
        new Api.auth.SendCode({
          phoneNumber: phone,
          apiId: telegramConfig.apiId,
          apiHash: telegramConfig.apiHash,
          settings: new Api.CodeSettings({
            allowFlashcall: false,
            currentNumber: false,
            allowAppHash: false,
            allowMissedCall: false,
          }),
        }),
      );

      // Save the session string BEFORE disconnecting
      // This session must be used later to verify the code
      const sessionRaw = tempClient.session.save();
      const tempSessionString =
        typeof sessionRaw === "string" ? sessionRaw : "";

      // Disconnect the temporary client
      await tempClient.disconnect();
      await tempClient.destroy();

      // Handle the result properly based on its type
      let phoneCodeHash = "";
      let isCodeViaApp = false;

      if ("phoneCodeHash" in result) {
        phoneCodeHash = result.phoneCodeHash;
      }

      if ("type" in result) {
        isCodeViaApp = result.type instanceof Api.auth.SentCodeTypeApp;
      }

      if (!phoneCodeHash || !tempSessionString) {
        throw new Error("Failed to get phoneCodeHash or session string");
      }

      return {
        phoneCodeHash,
        isCodeViaApp,
        tempSessionString,
      };
    } catch (error) {
      try {
        await tempClient.disconnect();
        await tempClient.destroy();
      } catch (disconnectError) {
        logger.warn(
          { error: disconnectError },
          "Failed to disconnect temporary client",
        );
      }
      logger.error({ error, phone }, "Failed to send authentication code");
      throw error;
    }
  }

  /**
   * Verify the authentication code and return a session string
   * IMPORTANT: Must use the same tempSessionString from sendAuthCode
   * Supports optional 2FA password for accounts with two-factor authentication enabled
   */
  async verifyAuthCode(
    phone: string,
    code: string,
    phoneCodeHash: string,
    tempSessionString: string,
    password?: string,
  ): Promise<string> {
    const telegramConfig = this.getTelegramConfig();
    // Reuse the session from sendAuthCode - this is critical!
    const tempClient = new TelegramClient(
      new StringSession(tempSessionString),
      telegramConfig.apiId,
      telegramConfig.apiHash,
      {
        connectionRetries: 5,
      },
    );

    try {
      await tempClient.connect();

      // Attempt to sign in with the code
      try {
        await tempClient.invoke(
          new Api.auth.SignIn({
            phoneNumber: phone,
            phoneCodeHash: phoneCodeHash,
            phoneCode: code,
          }),
        );
      } catch (signInError: any) {
        // Check if 2FA password is required
        if (signInError.errorMessage === "SESSION_PASSWORD_NEEDED") {
          if (!password) {
            // Password is required but not provided
            await tempClient.disconnect();
            await tempClient.destroy();
            throw new PasswordRequiredError(
              "Two-factor authentication is enabled. Password required.",
            );
          }

          // Password provided, attempt 2FA authentication
          try {
            const passwordSrpResult = await tempClient.invoke(
              new Api.account.GetPassword(),
            );
            const passwordHash = await computeCheck(
              passwordSrpResult,
              password,
            );
            await tempClient.invoke(
              new Api.auth.CheckPassword({
                password: passwordHash,
              }),
            );
            logger.info({ phone }, "Successfully verified with 2FA password");
          } catch (passwordError: any) {
            await tempClient.disconnect();
            await tempClient.destroy();
            logger.error(
              { error: passwordError, phone },
              "Failed to verify 2FA password",
            );
            throw new Error("Invalid password. Please check and try again.");
          }
        } else {
          // Other sign-in error
          throw signInError;
        }
      }

      // Get the final authenticated session string
      const sessionRaw = tempClient.session.save();
      const sessionString = typeof sessionRaw === "string" ? sessionRaw : "";

      if (!sessionString) {
        throw new Error("Failed to generate session string");
      }

      // Disconnect the temporary client
      await tempClient.disconnect();
      await tempClient.destroy();

      logger.info({ phone }, "Successfully verified authentication code");
      return sessionString;
    } catch (error) {
      try {
        await tempClient.disconnect();
        await tempClient.destroy();
      } catch (disconnectError) {
        logger.warn(
          { error: disconnectError },
          "Failed to disconnect temporary client",
        );
      }

      // Re-throw PasswordRequiredError without logging as error
      if (error instanceof PasswordRequiredError) {
        logger.info({ phone }, "2FA password required for authentication");
        throw error;
      }

      logger.error({ error, phone }, "Failed to verify authentication code");
      throw error;
    }
  }

  /**
   * Export a login token for QR code authentication
   * Creates a temporary Telegram client and generates a QR code token
   * Returns the token data and temporary session string for status checking
   */
  async exportLoginToken(): Promise<{
    token: Buffer;
    expires: number;
    tempSessionString: string;
  }> {
    const telegramConfig = this.getTelegramConfig();
    const tempClient = new TelegramClient(
      new StringSession(""),
      telegramConfig.apiId,
      telegramConfig.apiHash,
      {
        connectionRetries: 5,
      },
    );

    try {
      await tempClient.connect();

      const result = await tempClient.invoke(
        new Api.auth.ExportLoginToken({
          apiId: telegramConfig.apiId,
          apiHash: telegramConfig.apiHash,
          exceptIds: [], // No DC exceptions
        }),
      );

      // Save the session string BEFORE disconnecting
      // This session must be used later to check login token status
      const sessionRaw = tempClient.session.save();
      const tempSessionString =
        typeof sessionRaw === "string" ? sessionRaw : "";

      // Disconnect the temporary client
      await tempClient.disconnect();
      await tempClient.destroy();

      // Check result type
      if (result instanceof Api.auth.LoginToken) {
        // QR code token generated successfully
        if (!tempSessionString) {
          throw new Error("Failed to get session string");
        }

        return {
          token: Buffer.from(result.token),
          expires: result.expires,
          tempSessionString,
        };
      } else if (result instanceof Api.auth.LoginTokenMigrateTo) {
        // Need to migrate to another DC - not implemented yet
        throw new Error(
          "Login token migration required. Please contact support.",
        );
      } else if (result instanceof Api.auth.LoginTokenSuccess) {
        // Already authorized (shouldn't happen on export)
        throw new Error("Unexpected authorization state during QR generation");
      }

      throw new Error("Unknown login token response type");
    } catch (error) {
      try {
        await tempClient.disconnect();
        await tempClient.destroy();
      } catch (disconnectError) {
        logger.warn(
          { error: disconnectError },
          "Failed to disconnect temporary client during QR export",
        );
      }
      logger.error({ error }, "Failed to export login token for QR code");
      throw error;
    }
  }

  /**
   * Check the status of a QR code login token
   * Uses the temporary session from exportLoginToken to check if user has scanned/authorized
   * Returns null if still pending, or sessionString if authorized
   */
  async checkLoginToken(
    token: Buffer,
    tempSessionString: string,
  ): Promise<string | null> {
    const telegramConfig = this.getTelegramConfig();
    // Reuse the session from exportLoginToken - this is critical!
    const tempClient = new TelegramClient(
      new StringSession(tempSessionString),
      telegramConfig.apiId,
      telegramConfig.apiHash,
      {
        connectionRetries: 5,
      },
    );

    try {
      await tempClient.connect();

      const result = await tempClient.invoke(
        new Api.auth.ImportLoginToken({
          token: token,
        }),
      );

      // Check result type
      if (result instanceof Api.auth.LoginToken) {
        // Still pending - user hasn't scanned yet
        await tempClient.disconnect();
        await tempClient.destroy();
        return null;
      } else if (result instanceof Api.auth.LoginTokenSuccess) {
        // Successfully authorized!
        // Get the final authenticated session string
        const sessionRaw = tempClient.session.save();
        const sessionString = typeof sessionRaw === "string" ? sessionRaw : "";

        if (!sessionString) {
          throw new Error("Failed to generate session string after QR auth");
        }

        await tempClient.disconnect();
        await tempClient.destroy();

        logger.info("Successfully authorized via QR code");
        return sessionString;
      } else if (result instanceof Api.auth.LoginTokenMigrateTo) {
        // Need to migrate to another DC - not implemented yet
        await tempClient.disconnect();
        await tempClient.destroy();
        throw new Error(
          "Login token migration required. Please contact support.",
        );
      }

      await tempClient.disconnect();
      await tempClient.destroy();
      return null;
    } catch (error: any) {
      try {
        await tempClient.disconnect();
        await tempClient.destroy();
      } catch (disconnectError) {
        logger.warn(
          { error: disconnectError },
          "Failed to disconnect temporary client during QR check",
        );
      }

      // Check if token expired
      if (
        error.errorMessage === "SESSION_PASSWORD_NEEDED" ||
        error.errorMessage === "AUTH_TOKEN_EXPIRED"
      ) {
        logger.info("QR code token expired or invalid");
        return null;
      }

      logger.error({ error }, "Failed to check login token status");
      throw error;
    }
  }

  private normalizeChatId(chatId: string | number | bigint): string {
    if (typeof chatId === "bigint") {
      return chatId.toString();
    }
    return String(chatId);
  }

  private isVideoMessage(message: Message): boolean {
    const context = this.getDownloadContext(message);
    if (!context) {
      return false;
    }

    const { document } = context;
    if (this.isVideoDocument(document)) {
      return true;
    }

    const fileName = message.file?.name?.toLowerCase();
    if (!fileName) {
      return false;
    }

    return VIDEO_EXTENSIONS.some((ext) => fileName.endsWith(ext));
  }

  private isVideoFromSearchResult(rawMessage: Api.Message): boolean {
    // Check if message has media document
    if (
      rawMessage.media instanceof Api.MessageMediaDocument &&
      rawMessage.media.document instanceof Api.Document
    ) {
      const document = rawMessage.media.document;

      // Check MIME type
      if (document.mimeType && document.mimeType.startsWith("video/")) {
        return true;
      }

      // Check document attributes for video
      const attributes = document.attributes || [];
      if (
        attributes.some((attr) => attr instanceof Api.DocumentAttributeVideo)
      ) {
        return true;
      }

      // Check filename extension
      const fileName = this.extractFileNameFromSearchResult(rawMessage);
      if (fileName) {
        const lowerName = fileName.toLowerCase();
        return VIDEO_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
      }
    }

    return false;
  }

  private extractFileNameFromSearchResult(
    rawMessage: Api.Message,
  ): string | null {
    if (
      rawMessage.media instanceof Api.MessageMediaDocument &&
      rawMessage.media.document instanceof Api.Document
    ) {
      const document = rawMessage.media.document;
      const attributes = document.attributes || [];

      // Look for filename in document attributes
      for (const attr of attributes) {
        if (attr instanceof Api.DocumentAttributeFilename) {
          return attr.fileName;
        }
      }
    }

    return null;
  }

  private extractFileSizeFromSearchResult(rawMessage: Api.Message): number {
    if (
      rawMessage.media instanceof Api.MessageMediaDocument &&
      rawMessage.media.document instanceof Api.Document
    ) {
      const size = rawMessage.media.document.size;
      return typeof size === "number" ? size : Number(size) || 0;
    }

    return 0;
  }

  private extractMimeTypeFromSearchResult(
    rawMessage: Api.Message,
  ): string | null {
    if (
      rawMessage.media instanceof Api.MessageMediaDocument &&
      rawMessage.media.document instanceof Api.Document
    ) {
      return rawMessage.media.document.mimeType || null;
    }

    return null;
  }

  private getContentTypeFromMessage(message: Message): string {
    const context = this.getDownloadContext(message);
    const mimeType = context?.document.mimeType || message.video?.mimeType;
    if (mimeType) {
      return mimeType;
    }

    const fileName = message.file?.name?.toLowerCase();
    if (!fileName) return "video/mp4";

    if (fileName.endsWith(".mkv")) return "video/x-matroska";
    if (fileName.endsWith(".webm")) return "video/webm";
    if (fileName.endsWith(".mov")) return "video/quicktime";
    if (fileName.endsWith(".avi")) return "video/x-msvideo";
    return "video/mp4";
  }

  private buildMovieCacheKey(
    imdbId: string,
    queries: string[],
    userId: number,
    language: string,
  ): string {
    const normalized = queries.join("|").toLowerCase();
    const hash = Buffer.from(normalized).toString("base64").slice(0, 12);
    return `${imdbId}_${language}_${hash}_${userId}`;
  }

  private buildEpisodeCacheKey(
    imdbId: string,
    episodeInfo: EpisodeInfo,
    userId: number,
    language: string,
  ): string {
    return `${imdbId}:${language}:${episodeInfo.season}:${episodeInfo.episode}:${userId}`;
  }

  private parseComplexTitlePattern(title: string): string[] | null {
    const pattern = /^(?<base>.+?)\s+(?<number>\d+):\s*(?<suffix>.+)$/;
    const match = title.match(pattern);
    if (!match || !match.groups) {
      return null;
    }

    const base = match.groups.base.trim();
    const number = match.groups.number.trim();
    const suffix = match.groups.suffix.trim();

    return [base, `${base} ${number}`, `${base} ${number} ${suffix}`].filter(
      Boolean,
    );
  }

  /**
   * Extract the first part of a title if it contains any split symbols
   * e.g., "Avengers: Endgame" -> "Avengers", "Spider-Man - No Way Home" -> "Spider-Man"
   * Returns null if no split symbol is found or if the first part is empty
   */
  private extractTitleFirstPart(title: string): string | null {
    for (const symbol of TITLE_SPLIT_SYMBOLS) {
      if (title.includes(symbol)) {
        const firstPart = title.split(symbol)[0].trim();
        if (firstPart && firstPart !== title) {
          return firstPart;
        }
      }
    }
    return null;
  }

  /**
   * Parse a tag command from a message text
   * @param messageText - The message text to parse
   * @returns The tag name if message starts with /tag, null otherwise
   * @example parseTagCommand("/tag Tarzan") => "Tarzan"
   * @example parseTagCommand("/TAG Friends S01E01") => "Friends S01E01"
   */
  private parseTagCommand(
    messageText: string | undefined | null,
  ): string | null {
    if (!messageText) return null;

    const trimmed = messageText.trim();
    const tagPattern = /^\/tag\s+(.+)$/i; // Case-insensitive /tag followed by space and tag name
    const match = trimmed.match(tagPattern);

    return match ? match[1].trim() : null;
  }

  /**
   * Fetch the original message that was replied to
   * @param client - Telegram client
   * @param rawMessage - The reply message
   * @returns The original message or null if not found/not a reply
   */
  private async fetchRepliedMessage(
    client: TelegramClient,
    rawMessage: Api.Message,
  ): Promise<Api.Message | null> {
    try {
      // Check if this message is a reply
      if (!rawMessage.replyTo?.replyToMsgId || !rawMessage.peerId) {
        return null;
      }

      const replyToMsgId = rawMessage.replyTo.replyToMsgId;

      // Get the entity (chat/channel) where the original message is
      const entity = await client.getInputEntity(rawMessage.peerId);

      // Fetch the original message
      const result = await client.getMessages(entity as EntityLike, {
        ids: replyToMsgId,
      });

      const originalMessage = Array.isArray(result) ? result[0] : result;

      return originalMessage instanceof Api.Message ? originalMessage : null;
    } catch (error) {
      logger.debug(
        { messageId: rawMessage.id, error },
        "Failed to fetch replied message",
      );
      return null;
    }
  }

  private generateEpisodeSearchQueries(
    baseTitle: string,
    media: MediaDetails,
    episodeInfo: EpisodeInfo,
    catalogId?: string,
  ): string[] {
    const queries = new Set<string>();
    const languageKey = this.LANGUAGE_CONFIG
      .preferredLanguage as keyof typeof this.LANGUAGE_CONFIG.languages;
    const langConfig = this.LANGUAGE_CONFIG.languages[languageKey];
    const season = episodeInfo.season;
    const episode = episodeInfo.episode;
    const seasonPadded = season.toString().padStart(2, "0");
    const episodePadded = episode.toString().padStart(2, "0");

    const add = (value?: string | null) => {
      if (value) {
        queries.add(value.trim());
      }
    };

    // Use catalog ID tag only if provided (no title-based tags)
    if (catalogId) {
      add(`/tag ${catalogId}`);
    }

    const seasonLong = langConfig?.seasonTerms.long[0];
    const episodeLong = langConfig?.episodeTerms.long[0];
    const seasonShort = langConfig?.seasonTerms.short[0];
    const episodeShort = langConfig?.episodeTerms.short[0];

    add(baseTitle);

    // Check if title contains any split symbols and add the first part as a search query
    const firstPart = this.extractTitleFirstPart(baseTitle);
    if (firstPart) {
      add(firstPart);
      if (seasonLong && episodeLong) {
        const longFormat = `${firstPart} ${seasonLong} ${season} ${episodeLong} ${episode}`;
        add(longFormat);
      }
      if (seasonShort && episodeShort) {
        const shortFormat = `${firstPart} ${seasonShort}${season} ${episodeShort}${episode}`;
        add(shortFormat);
        const paddedFormat = `${firstPart} ${seasonShort}${seasonPadded} ${episodeShort}${episodePadded}`;
        add(paddedFormat);
      }
    }

    if (seasonLong && episodeLong) {
      const longFormat = `${baseTitle} ${seasonLong} ${season} ${episodeLong} ${episode}`;
      add(longFormat);
    }

    if (seasonShort && episodeShort) {
      const shortFormat = `${baseTitle} ${seasonShort}${season} ${episodeShort}${episode}`;
      add(shortFormat);
      const paddedFormat = `${baseTitle} ${seasonShort}${seasonPadded} ${episodeShort}${episodePadded}`;
      add(paddedFormat);
    }

    if (languageKey !== "en") {
      const englishFormat = `${media.title} s${seasonPadded}e${episodePadded}`;
      add(englishFormat);
    }

    // Only add title-based tag query if no catalog ID was provided
    if (!catalogId) {
      if (baseTitle === media.title) {
        // English title - use English format (s/e)
        add(`/tag ${baseTitle} s${seasonPadded}e${episodePadded}`);
      } else if (seasonShort && episodeShort) {
        // Localized title - use localized format
        add(
          `/tag ${baseTitle} ${seasonShort}${seasonPadded}${episodeShort}${episodePadded}`,
        );
      }
    }

    return Array.from(queries);
  }

  private generateSearchQueries(
    localizedTitle: string | null | undefined,
    media: MediaDetails,
    catalogId?: string,
  ): string[] {
    const queries: string[] = [];
    const addUnique = (value?: string | null) => {
      if (value && !queries.includes(value)) {
        queries.push(value);
      }
    };

    if (media.type === "series" && media.episodeInfo) {
      const base = localizedTitle || media.title;
      if (base) {
        return this.generateEpisodeSearchQueries(
          base,
          media,
          media.episodeInfo,
          catalogId,
        );
      }
    }

    // Use catalog ID tag only if provided (no title-based tags)
    if (catalogId) {
      addUnique(`/tag ${catalogId}`);
    }

    const processTitle = (title?: string | null) => {
      if (!title) return;
      const parsed = this.parseComplexTitlePattern(title);
      if (parsed) {
        parsed.forEach(addUnique);
      } else {
        addUnique(title);
      }

      if (media.year) {
        const titleWithYear = `${title} ${media.year}`;
        addUnique(titleWithYear);
      }
    };

    // Process first part of localized title if it contains split symbols
    if (localizedTitle) {
      const firstPart = this.extractTitleFirstPart(localizedTitle);
      if (firstPart) {
        processTitle(firstPart);
      }
    }

    // Process localized title first
    processTitle(localizedTitle || undefined);

    // Always include English title searches
    processTitle(media.title);

    // Include original title if different
    processTitle(media.originalTitle || undefined);

    // For non-English languages, ensure we have both localized and English versions
    const languageKey = this.LANGUAGE_CONFIG
      .preferredLanguage as keyof typeof this.LANGUAGE_CONFIG.languages;
    if (languageKey !== "en") {
      // Make sure we have English versions of all titles
      if (localizedTitle && localizedTitle !== media.title) {
        processTitle(media.title);
      }
    }

    // Only add title-based tag query if no catalog ID was provided
    if (!catalogId) {
      const mainTitle = localizedTitle || media.title;
      if (mainTitle && media.year) {
        addUnique(`/tag ${mainTitle} ${media.year}`);
      } else if (mainTitle) {
        addUnique(`/tag ${mainTitle}`);
      }
    }

    return queries.slice(0, 8); // Increased limit to accommodate more language variants
  }

  private evaluateResultScore(
    result: MediaSearchResult,
    media: MediaDetails,
  ): number {
    let score = 0;

    // Tagged results get highest priority
    if (result.customName) {
      return 999; // Ensure tagged results appear first, no additional bonuses
    }

    const targetYear = media.year;

    // Year matching for movies - check if 4-digit year appears in filename
    if (media.type === "movie" && targetYear && result.fileName) {
      // Match 4-digit year surrounded by non-digits (or at start/end of string)
      const yearPattern = /(?:^|[^\d])(\d{4})(?:[^\d]|$)/g;
      let yearMatch;
      while ((yearMatch = yearPattern.exec(result.fileName)) !== null) {
        if (yearMatch[1] === String(targetYear)) {
          score += 400; // High priority for exact year match in filename
          break;
        }
      }
    }

    // Quality indicators
    if (result.hasSubtitles) score += 100;
    if (result.isDubbed) score += 170;
    if (result.fileSize > 1.5 * 1024 * 1024 * 1024) score += 50; // Even better for large files

    return score;
  }

  private removeDuplicates(
    results: MediaSearchResult[],
    media: MediaDetails,
  ): MediaSearchResult[] {
    const deduped = new Map<string, MediaSearchResult>();
    const fileSignatures = new Map<string, MediaSearchResult>();

    for (const result of results) {
      const updated = {
        ...result,
        score: this.evaluateResultScore(result, media),
      };

      // First level: deduplicate by chatId:messageId
      const messageKey = `${result.chatId}:${result.messageId}`;
      const existingMessage = deduped.get(messageKey);

      if (
        existingMessage &&
        (existingMessage.score ?? 0) >= (updated.score ?? 0)
      ) {
        continue; // Skip if we already have this message with a better or equal score
      }

      // Second level: deduplicate by fileName:fileSize signature
      const fileSignature = `${result.fileName || "unknown"}:${
        result.fileSize || 0
      }`;
      const existingFile = fileSignatures.get(fileSignature);

      if (existingFile) {
        // Keep the one with higher score
        if ((updated.score ?? 0) > (existingFile.score ?? 0)) {
          // Remove the old entry from deduped map
          const oldMessageKey = `${existingFile.chatId}:${existingFile.messageId}`;
          deduped.delete(oldMessageKey);
          // Update with new entry
          deduped.set(messageKey, updated);
          fileSignatures.set(fileSignature, updated);
        }
        // Otherwise skip this duplicate file
        continue;
      }

      // This is a unique result, add it
      deduped.set(messageKey, updated);
      fileSignatures.set(fileSignature, updated);
    }

    return Array.from(deduped.values()).sort(
      (a, b) => (b.score ?? 0) - (a.score ?? 0),
    );
  }

  private prioritizeMovieResults(
    results: MediaSearchResult[],
    media: MediaDetails,
  ): MediaSearchResult[] {
    const targetYear = media.year;
    if (!targetYear) return results;

    return [...results].sort((a, b) => {
      const aHasYear = Number(
        Boolean(
          a.fileName?.includes(String(targetYear)) ||
          a.caption?.includes(String(targetYear)),
        ),
      );
      const bHasYear = Number(
        Boolean(
          b.fileName?.includes(String(targetYear)) ||
          b.caption?.includes(String(targetYear)),
        ),
      );

      if (aHasYear !== bHasYear) {
        return bHasYear - aHasYear;
      }

      return (b.score ?? 0) - (a.score ?? 0);
    });
  }

  private parseMediaIndicators(text: string | undefined | null): {
    hasSubtitles: boolean;
    isDubbed: boolean;
  } {
    if (!text) {
      return { hasSubtitles: false, isDubbed: false };
    }

    const langKey = this.LANGUAGE_CONFIG
      .preferredLanguage as keyof typeof this.LANGUAGE_CONFIG.languages;
    const langConfig = this.LANGUAGE_CONFIG.languages[langKey];

    const lower = text.toLowerCase();

    const hasSubtitles = langConfig.subtitleIndicators.some(
      (indicator: string) => lower.includes(indicator.toLowerCase()),
    );
    const isDubbed = langConfig.dubbedIndicators.some((indicator: string) =>
      lower.includes(indicator.toLowerCase()),
    );

    return { hasSubtitles, isDubbed };
  }

  private async performGlobalSearch(
    client: TelegramClient,
    query: string,
    media: MediaDetails,
    catalogId?: string,
  ): Promise<MediaSearchResult[]> {
    const filters: Api.TypeMessagesFilter[] = [];

    // Always use InputMessagesFilterEmpty for all searches
    filters.push(new Api.InputMessagesFilterEmpty());

    const results: MediaSearchResult[] = [];
    const entityCache = new Map<string, EntityLike>();
    let filterIndex = 0;

    for (const filter of filters) {
      filterIndex++;
      // Check if client is still alive before each filter attempt
      if (!client.connected) {
        logger.warn(
          { query, filterIndex, totalFilters: filters.length },
          "Client disconnected during search, stopping",
        );
        break;
      }

      let searchResult: Api.messages.TypeMessages;
      try {
        searchResult = await client.invoke(
          new Api.messages.SearchGlobal({
            q: query,
            filter,
            minDate: 0,
            maxDate: 0,
            offsetRate: 0,
            offsetPeer: new Api.InputPeerEmpty(),
            limit: this.SEARCH_CONFIG.globalSearchLimit,
          }),
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // Check for timeout/connection errors
        if (
          errorMsg.includes("TIMEOUT") ||
          errorMsg.includes("Connection") ||
          errorMsg.includes("ERR_")
        ) {
          logger.warn(
            { query, filterIndex, error: errorMsg },
            "Search encountered timeout/connection error, skipping this filter",
          );
          // Continue to next filter instead of failing completely
          continue;
        }
        logger.warn({ query, error }, "Global search failed");
        continue;
      }

      if (
        !(searchResult instanceof Api.messages.Messages) &&
        !(searchResult instanceof Api.messages.MessagesSlice)
      ) {
        continue;
      }

      const rawMessages = (searchResult.messages as Api.TypeMessage[]).filter(
        (msg): msg is Api.Message => msg instanceof Api.Message,
      );
      // Debug: log filter class name, query, and number of raw messages
      // eslint-disable-next-line no-console
      console.log(
        "Filter:",
        filter?.className,
        "Query:",
        query,
        "RawMessages:",
        rawMessages.length,
      );

      // Group messages by peer for batch processing
      const messagesByPeer = new Map<string, Api.Message[]>();
      for (const rawMessage of rawMessages) {
        if (!rawMessage.peerId) continue;
        const peerKey = this.peerKey(rawMessage.peerId);

        if (!messagesByPeer.has(peerKey)) {
          messagesByPeer.set(peerKey, []);
        }
        messagesByPeer.get(peerKey)!.push(rawMessage);
      }

      // Batch resolve entities first
      const peerToEntity = new Map<string, EntityLike>();
      const entityPromises: Promise<void>[] = [];

      for (const [peerKey, messages] of messagesByPeer.entries()) {
        const rawMessage = messages[0];
        if (!entityCache.has(peerKey)) {
          entityPromises.push(
            client
              .getInputEntity(rawMessage.peerId!)
              .then((entity) => {
                entityCache.set(peerKey, entity);
                peerToEntity.set(peerKey, entity);
              })
              .catch((error) => {
                logger.debug(
                  { peerKey, error },
                  "Failed to resolve entity for messages batch",
                );
              }),
          );
        } else {
          peerToEntity.set(peerKey, entityCache.get(peerKey)!);
        }
      }

      // Wait for all entity resolutions to complete
      await Promise.allSettled(entityPromises);

      // Process raw messages directly without fetching full message objects
      for (const [peerKey, rawMessages] of messagesByPeer.entries()) {
        const entity = peerToEntity.get(peerKey) || entityCache.get(peerKey);
        if (!entity) continue;

        for (const rawMessage of rawMessages) {
          // Check if this is a tag command (e.g., "/tag Tarzan")
          const tagName = this.parseTagCommand(rawMessage.message);

          if (tagName) {
            // Check if this tag matches the catalogId we're searching for
            // Only include tags that match the exact catalogId
            if (catalogId && tagName !== catalogId) {
              continue; // Skip tags that don't match our search
            }

            // This is a tag message - fetch the original video message it replies to
            const originalMessage = await this.fetchRepliedMessage(
              client,
              rawMessage,
            );

            if (
              originalMessage &&
              this.isVideoFromSearchResult(originalMessage)
            ) {
              // Found a tagged video! Process the original video message
              const fileName =
                this.extractFileNameFromSearchResult(originalMessage);
              const fileSize =
                this.extractFileSizeFromSearchResult(originalMessage);
              const caption = originalMessage.message || null;
              const mimeType =
                this.extractMimeTypeFromSearchResult(originalMessage);

              const indicators = this.parseMediaIndicators(
                `${fileName ?? ""} ${caption ?? ""}`,
              );

              // Extract chat ID from the original message's peerId
              let chatId: bigint | bigInt.BigInteger | number | string = 0n;
              if (originalMessage.peerId) {
                chatId = this.extractChatIdFromPeer(originalMessage.peerId);
              } else if (originalMessage.chatId) {
                chatId = originalMessage.chatId;
              }

              const normalizedChatId =
                typeof chatId === "bigint" ||
                typeof chatId === "number" ||
                typeof chatId === "string"
                  ? this.normalizeChatId(chatId)
                  : this.normalizeChatId(chatId.toString());

              // For tagged results, show the actual file name or caption with tag emoji
              // Don't show catalog ID (e.g., tt5574490:3:7) as it's not user-friendly
              let displayName: string;
              if (fileName) {
                displayName = `🏷️ ${fileName}`;
              } else if (caption) {
                displayName = `🏷️ ${caption}`;
              } else {
                displayName = "🏷️ Tagged Video";
              }

              results.push({
                chatId: normalizedChatId,
                messageId: originalMessage.id,
                fileName: displayName,
                fileSize,
                mimeType,
                caption,
                hasSubtitles: indicators.hasSubtitles,
                isDubbed: indicators.isDubbed,
                season: media.episodeInfo?.season,
                episode: media.episodeInfo?.episode,
                customName: tagName, // Mark this as a tagged result
              });

              logger.info(
                {
                  tagName,
                  originalMessageId: originalMessage.id,
                  chatId: normalizedChatId,
                },
                "Found tagged video via /tag command",
              );

              continue; // Skip normal processing for this tag message
            }
          }

          // Normal video message processing (not a tag)
          if (!this.isVideoFromSearchResult(rawMessage)) continue;

          const fileName = this.extractFileNameFromSearchResult(rawMessage);
          const fileSize = this.extractFileSizeFromSearchResult(rawMessage);
          const caption = rawMessage.message || null;
          const mimeType = this.extractMimeTypeFromSearchResult(rawMessage);

          const indicators = this.parseMediaIndicators(
            `${fileName ?? ""} ${caption ?? ""}`,
          );

          // Extract chat ID from the raw message's peerId
          let chatId: bigint | bigInt.BigInteger | number | string = 0n;
          if (rawMessage.peerId) {
            chatId = this.extractChatIdFromPeer(rawMessage.peerId);
          } else if (rawMessage.chatId) {
            chatId = rawMessage.chatId;
          }

          const normalizedChatId =
            typeof chatId === "bigint" ||
            typeof chatId === "number" ||
            typeof chatId === "string"
              ? this.normalizeChatId(chatId)
              : this.normalizeChatId(chatId.toString());

          results.push({
            chatId: normalizedChatId,
            messageId: rawMessage.id,
            fileName,
            fileSize,
            mimeType,
            caption,
            hasSubtitles: indicators.hasSubtitles,
            isDubbed: indicators.isDubbed,
            season: media.episodeInfo?.season,
            episode: media.episodeInfo?.episode,
          });
        }
      }
    }

    return results;
  }

  private peerKey(peer: Api.TypePeer): string {
    if (peer instanceof Api.PeerChannel) {
      return `channel:${peer.channelId}`;
    }
    if (peer instanceof Api.PeerChat) {
      return `chat:${peer.chatId}`;
    }
    if (peer instanceof Api.PeerUser) {
      return `user:${peer.userId}`;
    }
    return `unknown:${JSON.stringify(peer)}`;
  }

  private extractChatIdFromPeer(
    peer: Api.TypePeer,
  ): bigint | bigInt.BigInteger {
    if (peer instanceof Api.PeerChannel) {
      return peer.channelId;
    }
    if (peer instanceof Api.PeerChat) {
      return peer.chatId;
    }
    if (peer instanceof Api.PeerUser) {
      return peer.userId;
    }
    return 0n;
  }

  private limitResults(
    results: MediaSearchResult[],
    media: MediaDetails,
  ): MediaSearchResult[] {
    const config =
      media.type === "movie"
        ? this.SEARCH_RESULTS.movie
        : this.SEARCH_RESULTS.series;
    const total = config.totalResults;

    if (media.type === "movie") {
      return this.prioritizeMovieResults(results, media).slice(0, total);
    }

    return results.slice(0, total);
  }

  private checkTitleMatch(
    result: MediaSearchResult,
    media: MediaDetails,
    baseTitle: string,
  ): boolean {
    // Tagged results (from /tag command) always match - user explicitly tagged them
    if (result.customName) {
      return true;
    }

    //for hebrew and similar languages, ignore nikud and other diacritics for matching purposes
    baseTitle = baseTitle.replace(/[\u0591-\u05C7]/g, "").toLowerCase();
    media.title = media.title.replace(/[\u0591-\u05C7]/g, "").toLowerCase();
    if (!media.episodeInfo) {
      // For movies, just check if title is mentioned
      const fullText = `${result.fileName || ""} ${result.caption || ""}`
        .toLowerCase()
        .replace(/_/g, " ");

      // Check full titles
      if (fullText.includes(baseTitle) || fullText.includes(media.title)) {
        return true;
      }

      // Check first part of titles if they contain split symbols
      const baseTitleFirstPart = this.extractTitleFirstPart(baseTitle);
      if (baseTitleFirstPart && fullText.includes(baseTitleFirstPart)) {
        return true;
      }

      const mediaTitleFirstPart = this.extractTitleFirstPart(media.title);
      if (mediaTitleFirstPart && fullText.includes(mediaTitleFirstPart)) {
        return true;
      }

      return false;
    }

    const { season, episode } = media.episodeInfo;

    const fullText = `${result.fileName || ""} ${result.caption || ""}`
      .toLowerCase()
      .replace(/_/g, " ");
    const baseTitleLower = baseTitle.toLowerCase();
    const originalTitleLower = media.title.toLowerCase();

    // Check if the text contains the title (full or first part)
    let hasTitle =
      fullText.includes(baseTitleLower) ||
      fullText.includes(originalTitleLower);

    // Also check first part of titles if they contain split symbols
    if (!hasTitle) {
      const baseTitleFirstPart = this.extractTitleFirstPart(baseTitle);
      if (baseTitleFirstPart && fullText.includes(baseTitleFirstPart)) {
        hasTitle = true;
      }
    }

    if (!hasTitle) {
      const mediaTitleFirstPart = this.extractTitleFirstPart(media.title);
      if (mediaTitleFirstPart && fullText.includes(mediaTitleFirstPart)) {
        hasTitle = true;
      }
    }

    if (!hasTitle) {
      return false;
    }

    // Get only English and preferred language configs for pattern matching
    const languageKey = this.LANGUAGE_CONFIG
      .preferredLanguage as keyof typeof this.LANGUAGE_CONFIG.languages;
    const preferredLangConfig = this.LANGUAGE_CONFIG.languages[languageKey];
    const englishConfig = this.LANGUAGE_CONFIG.languages.en;

    const languageConfigs =
      languageKey === "en"
        ? [englishConfig]
        : [preferredLangConfig, englishConfig];

    // Build regex patterns for precise season/episode matching
    const seasonEpisodeRegexes: RegExp[] = [];

    for (const langConfig of languageConfigs) {
      // Long format patterns - use whitespace boundaries for non-Latin scripts
      for (const seasonLong of langConfig.seasonTerms.long) {
        for (const episodeLong of langConfig.episodeTerms.long) {
          // Match "עונה 1 פרק 1" or "season 1 episode 1" but not "season 1 episode 11"
          // Use (?:^|\\s) for start boundary and (?!\\d) to prevent matching longer episode numbers
          seasonEpisodeRegexes.push(
            new RegExp(
              `(?:^|\\s)${this.escapeRegex(
                seasonLong,
              )}\\s+0*${season}\\s+${this.escapeRegex(
                episodeLong,
              )}\\s+0*${episode}(?!\\d)`,
              "i",
            ),
          );
        }
      }

      // Short format patterns
      for (const seasonShort of langConfig.seasonTerms.short) {
        for (const episodeShort of langConfig.episodeTerms.short) {
          // Match "s1e1" or "s01e01" but not "s1e11"
          // For Latin characters, use word boundary; for non-Latin, use whitespace
          const isLatin = /^[a-z]+$/i.test(seasonShort);
          const startBoundary = isLatin ? "\\b" : "(?:^|\\s)";

          // Pattern: s<season>e<episode> followed by non-digit or end of string
          seasonEpisodeRegexes.push(
            new RegExp(
              `${startBoundary}${this.escapeRegex(
                seasonShort,
              )}0*${season}${this.escapeRegex(
                episodeShort,
              )}0*${episode}(?!\\d)`,
              "i",
            ),
          );
          // Pattern with space: "s1 e1" or "s01 e01"
          seasonEpisodeRegexes.push(
            new RegExp(
              `${startBoundary}${this.escapeRegex(
                seasonShort,
              )}0*${season}\\s+${this.escapeRegex(
                episodeShort,
              )}0*${episode}(?!\\d)`,
              "i",
            ),
          );
        }
      }
    }

    // Check if any season/episode pattern matches using regex
    return seasonEpisodeRegexes.some((regex) => regex.test(fullText));
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  async searchMedia(
    client: TelegramClient,
    query: string,
    media: MediaDetails,
    user: InstanceProfile,
    catalogId?: string,
  ): Promise<MediaSearchResult[]> {
    const language = this.refreshRuntimeConfig(user);
    const episodeInfo = media.episodeInfo || null;
    const queries = this.generateSearchQueries(query, media, catalogId);

    // Use simplified cache key with catalog ID when available
    let cacheKey: string;
    if (catalogId) {
      cacheKey = `catalog:${user.id}_${language}_${catalogId}`;
    } else if (episodeInfo) {
      cacheKey = this.buildEpisodeCacheKey(
        media.imdbId,
        episodeInfo,
        user.id,
        language,
      );
    } else {
      cacheKey = this.buildMovieCacheKey(
        media.imdbId,
        queries,
        user.id,
        language,
      );
    }

    const cached =
      await this.cache.getSearchResults<MediaSearchResult[]>(cacheKey);
    if (cached) {
      logger.info(
        { cacheKey, count: cached.length },
        "Search results cache hit",
      );
      return cached;
    }

    // Check if client is connected before searching
    if (!client.connected) {
      logger.error({ cacheKey }, "Client disconnected, cannot perform search");
      throw new TelegramClientUnavailableError(
        "Telegram client is not connected",
      );
    }

    logger.info({ query, queries }, "Cache miss, performing Telegram searches");

    const aggregateResults: MediaSearchResult[] = [];
    const targetResultCount =
      media.type === "movie"
        ? this.SEARCH_RESULTS.movie.totalResults
        : this.SEARCH_RESULTS.series.totalResults;

    // Execute all search queries in parallel for better performance
    const searchPromises = queries.map((searchQuery) =>
      this.performGlobalSearch(client, searchQuery, media, catalogId).catch(
        (error) => {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          // Log only non-connection errors; connection errors are already handled
          if (
            !errorMsg.includes("TIMEOUT") &&
            !errorMsg.includes("Connection") &&
            !errorMsg.includes("ERR_")
          ) {
            logger.warn({ query: searchQuery, error }, "Search query failed");
          }
          return [];
        },
      ),
    );

    const allQueryResults = await Promise.all(searchPromises);

    // Flatten all results
    for (const queryResults of allQueryResults) {
      aggregateResults.push(...queryResults);
    }

    // Remove duplicates first
    const uniqueResults = this.removeDuplicates(aggregateResults, media);

    // Smart filtering: prioritize results that match title + season/episode
    const exactMatches: MediaSearchResult[] = [];
    const partialMatches: MediaSearchResult[] = [];
    const baseTitle = query || media.title;

    for (const result of uniqueResults) {
      if (this.checkTitleMatch(result, media, baseTitle)) {
        exactMatches.push(result);
      } else {
        // For TV show episodes, completely exclude results without season/episode numbers
        // to prevent them from appearing as movies
        if (!media.episodeInfo) {
          partialMatches.push(result);
        }
      }
    }

    // Sort exact matches by score
    exactMatches.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    // Separate dubbed and non-dubbed results to ensure diversity
    const dubbedExactMatches = exactMatches.filter((r) => r.isDubbed);
    const nonDubbedExactMatches = exactMatches.filter((r) => !r.isDubbed);

    // Interleave dubbed and non-dubbed results to ensure variety
    let finalResults: MediaSearchResult[] = [];
    const dubbedRatio = 0.6; // 60% dubbed, 40% non-dubbed
    const dubbedCount = Math.ceil(targetResultCount * dubbedRatio);
    const nonDubbedCount = targetResultCount - dubbedCount;

    // Take top dubbed results
    finalResults.push(...dubbedExactMatches.slice(0, dubbedCount));

    // Take top non-dubbed results
    finalResults.push(...nonDubbedExactMatches.slice(0, nonDubbedCount));

    // If we don't have enough, fill remaining slots with best available
    if (finalResults.length < targetResultCount) {
      const remaining = exactMatches.filter((r) => !finalResults.includes(r));
      const remainingSlots = targetResultCount - finalResults.length;
      finalResults.push(...remaining.slice(0, remainingSlots));
    }

    // If still not enough, add partial matches
    if (finalResults.length < targetResultCount) {
      partialMatches.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      const remainingSlots = targetResultCount - finalResults.length;
      finalResults = finalResults.concat(
        partialMatches.slice(0, remainingSlots),
      );
    }

    // Final sort by score
    finalResults.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    const limited = finalResults;

    await this.cache.setSearchResults(cacheKey, limited);
    logger.info(
      {
        cacheKey,
        totalFound: uniqueResults.length,
        exactMatches: exactMatches.length,
        partialMatches: partialMatches.length,
        finalCount: limited.length,
      },
      "Cached search results with smart filtering",
    );

    return limited;
  }

  private getTelegramConfig(): { apiId: number; apiHash: string } {
    this.refreshRuntimeConfig();
    if (this.instanceConfig) {
      const telegram = this.instanceConfig.getConfig().telegram;
      return { apiId: telegram.apiId, apiHash: telegram.apiHash };
    }

    return this.TELEGRAM_CONFIG;
  }

  private refreshRuntimeConfig(user?: InstanceProfile): string {
    let language = this.LANGUAGE_CONFIG.preferredLanguage || user?.language || "en";

    if (this.instanceConfig) {
      const config = this.instanceConfig.getConfig();
      this.TELEGRAM_CONFIG = {
        apiId: config.telegram.apiId,
        apiHash: config.telegram.apiHash,
      };
      language = config.preferredLanguage;
    }

    if (user?.language) language = user.language;
    this.LANGUAGE_CONFIG.preferredLanguage = language;
    return language;
  }
  /**
   * Clear cache for a specific catalog ID after tagging
   * This ensures tagged results appear immediately on next search
   */
  async clearCacheByCatalogId(
    catalogId: string,
    userId: number,
  ): Promise<void> {
    try {
      const languages = ["en", "he", "ru", "ar"];
      const cacheKeys = languages.map(
        (language) => `catalog:${userId}_${language}_${catalogId}`,
      );

      await Promise.all(
        cacheKeys.map((cacheKey) =>
          this.cache.deleteSearchResults(cacheKey),
        ),
      );

      logger.info(
        { catalogId, userId, cacheKeys },
        "Cleared language-specific catalog caches",
      );
    } catch (error) {
      logger.error(
        { catalogId, error: (error as Error).message },
        "Failed to clear cache for catalog ID",
      );
    }
  }

  async getMessageWithCache(
    client: TelegramClient,
    chatId: string,
    messageId: number,
  ): Promise<Message> {
    const cached = await this.cache.getMessageDetails<{
      fileSize: number;
      mimeType: string | null;
    }>(chatId, messageId);

    if (cached) {
      logger.debug({ chatId, messageId }, "Message metadata cache hit");
    } else {
      logger.debug({ chatId, messageId }, "Message metadata cache miss");
    }

    let message: Message | undefined;
    try {
      const entityId = this.normalizeChatId(chatId) as EntityLike;
      const entity = await client.getInputEntity(entityId);
      const result = await client.getMessages(entity as EntityLike, {
        ids: messageId,
      });
      message = Array.isArray(result) ? result[0] : result;
    } catch (error) {
      logger.error(
        { chatId, messageId, error },
        "Failed to fetch message from Telegram",
      );
      throw new Error(
        `Failed to fetch message ${messageId} from chat ${chatId} error: ${error}`,
      );
    }

    if (!message) {
      throw new Error(`Message ${messageId} not found in chat ${chatId}`);
    }

    if (!cached) {
      const context = this.getDownloadContext(message);
      await this.cache.setMessageDetails(chatId, messageId, {
        fileSize: this.getFileSize(message),
        mimeType: context?.document.mimeType ?? null,
        fileName: message.file?.name || null,
      });
    }

    return message;
  }

  createStreamSession(): AbortController {
    const controller = new AbortController();
    this.activeControllers.add(controller);
    return controller;
  }

  hasStreamableMedia(message: Message): boolean {
    return this.isVideoMessage(message);
  }

  async getCacheStats() {
    return this.cache.getStats();
  }

  async clearCache(): Promise<boolean> {
    return this.cache.clearAll();
  }

  async releaseStreamSession(controller: AbortController): Promise<void> {
    if (this.activeControllers.has(controller)) {
      controller.abort();
      this.activeControllers.delete(controller);
    }
  }

  async *streamMessageRange(
    client: TelegramClient,
    message: Message,
    start: number,
    end: number,
    controller: AbortController,
  ): AsyncGenerator<Buffer> {
    const context = this.getDownloadContext(message);

    if (!context) {
      throw new Error("Message has no downloadable media");
    }

    // Telegram API requires offsets to be strictly aligned to 4KB boundaries
    const TELEGRAM_OFFSET_ALIGNMENT = 4096;
    const totalBytesToSend = end - start + 1;
    const fileSize = this.getFileSize(message);

    // Calculate the nearest aligned offset below the requested start point
    const alignedOffset =
      Math.floor(start / TELEGRAM_OFFSET_ALIGNMENT) * TELEGRAM_OFFSET_ALIGNMENT;

    // Calculate the extra bytes we fetched due to alignment (to be discarded later)
    const alignmentPadding = start - alignedOffset;

    // Calculate the total size we actually need to request from Telegram (including padding)
    const downloadSize = totalBytesToSend + alignmentPadding;

    const requestSize = this.STREAMING_CONFIG.maxRequestSize; // Typically 1MB

    // Calculate exactly how many chunks of 'requestSize' we need to pull
    const chunkLimit = Math.max(1, Math.ceil(downloadSize / requestSize));

    // Define the exact file location payload
    const fileLocation = new Api.InputDocumentFileLocation({
      id: context.document.id,
      accessHash: context.document.accessHash,
      fileReference: context.document.fileReference,
      thumbSize: "",
    });

    // Initialize a single iterator to handle the entire range request.
    // This prevents the CPU-intensive process of opening a new connection for every chunk.
    const iterator = client.iterDownload({
      file: fileLocation,
      offset: bigInt(alignedOffset),
      limit: chunkLimit,
      requestSize: requestSize,
      fileSize: bigInt(fileSize),
      dcId: context.document.dcId,
    });

    let bytesSent = 0;
    let isFirstChunk = true;

    for await (const chunk of iterator as AsyncIterable<Buffer | Uint8Array>) {
      // Stop processing if the user disconnected or skipped forward/backward in the video
      if (controller.signal.aborted) {
        logger.info({ messageId: message.id }, "Stream aborted by client");
        break;
      }

      if (!chunk || ("length" in chunk && chunk.length === 0)) continue;

      let buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

      // Slice off the alignment padding ONLY from the very first chunk received
      if (isFirstChunk && alignmentPadding > 0) {
        buffer = buffer.subarray(alignmentPadding);
        isFirstChunk = false;
      }

      // Calculate how many bytes we still need to send to satisfy the requested range
      const remainingBytesNeeded = totalBytesToSend - bytesSent;
      const bytesToTake = Math.min(buffer.length, remainingBytesNeeded);

      if (bytesToTake > 0) {
        // Slice the buffer if we received more bytes than needed (usually happens on the final chunk)
        const finalBuffer =
          bytesToTake < buffer.length
            ? buffer.subarray(0, bytesToTake)
            : buffer;

        yield finalBuffer; // Stream directly to the client without retaining in memory
        bytesSent += finalBuffer.length;
      }

      // Break the loop once we've fulfilled the user's exact byte range request
      if (bytesSent >= totalBytesToSend) {
        break;
      }
    }
  }

  getContentType(message: Message): string {
    return this.getContentTypeFromMessage(message);
  }

  getFileSize(message: Message): number {
    const context = this.getDownloadContext(message);
    if (context?.document?.size) {
      const size = Number(context.document.size);
      if (Number.isFinite(size) && size > 0) {
        return size;
      }
    }

    const fallback = Number(message.file?.size || 0);
    return Number.isFinite(fallback) ? fallback : 0;
  }

  async cleanup(): Promise<void> {
    try {
      for (const controller of this.activeControllers) {
        controller.abort();
      }
      this.activeControllers.clear();

      await this.cache.cleanup();
      await this.clientManager.disconnectAll();
    } catch (error) {
      logger.error({ err: error }, "Error during TelegramService cleanup");
    }
  }

  private getDownloadContext(message: Message): {
    media: Api.MessageMediaDocument;
    document: Api.Document;
  } | null {
    if (
      message.media instanceof Api.MessageMediaDocument &&
      message.media.document instanceof Api.Document
    ) {
      return {
        media: message.media,
        document: message.media.document,
      };
    }

    return null;
  }

  private isVideoDocument(document: Api.Document): boolean {
    const mimeType = document.mimeType;
    if (mimeType && mimeType.startsWith("video/")) {
      return true;
    }

    const attributes = document.attributes || [];
    return attributes.some(
      (attr) => attr instanceof Api.DocumentAttributeVideo,
    );
  }

  /**
   * Get user's Telegram folders (DialogFilters) with their included channels
   * @param _instanceKey - Compatibility parameter for the local instance
   * @param sessionString - The local instance's session string
   * @returns Array of TelegramFolder objects with channel IDs
   */
  async getUserFolders(
    userToken: string,
    sessionString: string,
  ): Promise<import("./types").TelegramFolder[]> {
    try {
      const client = await this.getClientForUser(userToken, sessionString);

      // Fetch the current user once to handle "Saved Messages" (self user) in folders
      let me: Api.User | null = null;
      try {
        const self = await client.getMe();
        if (self instanceof Api.User) {
          me = self;
        }
      } catch (e) {
        logger.warn(
          { userToken },
          "Failed to fetch self user entity for folders",
        );
      }

      // Fetch dialog filters from Telegram API
      const result = await client.invoke(new Api.messages.GetDialogFilters());

      const folders: import("./types").TelegramFolder[] = [];

      if (!result || !Array.isArray(result.filters)) {
        logger.info({ userToken }, "No dialog filters found for user");
        return folders;
      }

      // Process each filter
      for (const filter of result.filters) {
        // Only process DialogFilter (not DialogFilterDefault or DialogFilterChatlist)
        if (filter instanceof Api.DialogFilter) {
          const channelIds: string[] = [];

          logger.info(
            {
              userToken,
              filterId: filter.id,
              filterTitle: filter.title,
              includePeersCount: filter.includePeers?.length || 0,
            },
            "Processing dialog filter",
          );

          // Extract channel/supergroup IDs from includePeers
          if (filter.includePeers && Array.isArray(filter.includePeers)) {
            for (const peer of filter.includePeers) {
              let peerId: string | null = null;

              if (
                peer instanceof Api.InputPeerChannel ||
                peer instanceof Api.InputPeerChannelFromMessage
              ) {
                peerId = `-100${(peer as any).channelId.toString()}`;
              } else if (peer instanceof Api.InputPeerChat) {
                peerId = `-${peer.chatId.toString()}`;
              } else if (peer instanceof Api.InputPeerSelf && me) {
                peerId = me.id.toString();
              } else if (
                (peer instanceof Api.InputPeerUser ||
                  peer instanceof Api.InputPeerUserFromMessage) &&
                me
              ) {
                if (me.id.toString() === (peer as any).userId.toString()) {
                  peerId = me.id.toString();
                }
              }

              if (peerId) {
                logger.debug(
                  {
                    userToken,
                    filterId: filter.id,
                    peerId,
                    peerType: peer.constructor.name,
                  },
                  "Found target peer in folder",
                );
                channelIds.push(peerId);
              } else {
                logger.debug(
                  {
                    userToken,
                    filterId: filter.id,
                    peerType: peer.constructor.name,
                  },
                  "Skipping non-target peer",
                );
              }
            }
          }

          // Only include folders that have channels
          if (channelIds.length > 0) {
            logger.info(
              {
                userToken,
                filterId: filter.id,
                channelCount: channelIds.length,
              },
              "Adding folder with channels",
            );
            folders.push({
              id: filter.id,
              title:
                typeof filter.title === "string"
                  ? filter.title
                  : filter.title.text,
              channelIds,
            });
          } else {
            logger.info(
              { userToken, filterId: filter.id, filterTitle: filter.title },
              "Skipping folder with no channels",
            );
          }
        }
      }

      logger.info(
        { userToken, folderCount: folders.length },
        "Retrieved user folders",
      );

      return folders;
    } catch (error) {
      logger.error(
        { userToken, error: (error as Error).message },
        "Failed to retrieve user folders",
      );
      throw error;
    }
  }

  /**
   * Get user's joined channels and supergroups
   * @param _instanceKey - Compatibility parameter for the local instance
   * @param sessionString - The local instance's session string
   * @returns Array of ChannelInfo objects
   */
  async getUserChannels(
    userToken: string,
    sessionString: string,
  ): Promise<import("./types").ChannelInfo[]> {
    try {
      const client = await this.getClientForUser(userToken, sessionString);

      // Fetch dialogs from Telegram API
      // We limit to 500 dialogs which should cover most users' channels
      const dialogs = await client.getDialogs({ limit: 500 });

      const channels: import("./types").ChannelInfo[] = [];

      for (const dialog of dialogs) {
        if (dialog.id === undefined) continue;

        const entity = dialog.entity;
        let isTargetDialog = false;
        let channelId = dialog.id.toString();
        let title = dialog.title || "Unknown Chat";
        let username = undefined;
        let memberCount = undefined;

        if (dialog.isChannel && entity instanceof Api.Channel) {
          isTargetDialog = true;
          username = (entity as any).username;
          memberCount = (entity as any).participantsCount;
          // Ensure ID starts with -100 if it's a channel (should already be true for Grammjs)
          if (!channelId.startsWith("-100")) {
            channelId = `-100${channelId}`;
          }
        } else if (dialog.isGroup && entity instanceof Api.Chat) {
          isTargetDialog = true;
          memberCount = (entity as any).participantsCount;
          // Regular groups start with -
          if (!channelId.startsWith("-")) {
            channelId = `-${channelId}`;
          }
        } else if (
          dialog.isUser &&
          entity instanceof Api.User &&
          (entity as any).self
        ) {
          isTargetDialog = true;
          title = "Saved Messages";
        }

        if (isTargetDialog) {
          channels.push({
            id: channelId,
            title: title,
            username: username,
            memberCount: memberCount,
          });
        }
      }

      logger.info(
        { userToken, channelCount: channels.length },
        "Retrieved user channels",
      );

      return channels;
    } catch (error) {
      logger.error(
        { userToken, error: (error as Error).message },
        "Failed to retrieve user channels",
      );
      throw error;
    }
  }

  /**
   * Get channel information by ID
   * @param _instanceKey - Compatibility parameter for the local instance
   * @param sessionString - The local instance's session string
   * @param channelId - The channel ID (format: "-100123456789")
   * @returns ChannelInfo object or null if not found
   */
  async getChannelById(
    userToken: string,
    sessionString: string,
    channelId: string,
  ): Promise<import("./types").ChannelInfo | null> {
    try {
      const client = await this.getClientForUser(userToken, sessionString);

      // Get channel entity
      const channel = await client.getEntity(channelId);

      if (!channel) {
        logger.warn({ userToken, channelId }, "Channel not found");
        return null;
      }

      // Extract channel info
      let title = "Unknown Chat";
      if (channel instanceof Api.User) {
        title = (channel as any).self
          ? "Saved Messages"
          : `${(channel as any).firstName || ""} ${(channel as any).lastName || ""}`.trim() ||
            "Unknown User";
      } else {
        title = (channel as any).title || "Unknown Channel";
      }

      const channelInfo: import("./types").ChannelInfo = {
        id: channelId,
        title,
      };

      // Add username if available
      if ((channel as any).username) {
        channelInfo.username = (channel as any).username;
      }

      // Add member count if available
      if ((channel as any).participantsCount) {
        channelInfo.memberCount = (channel as any).participantsCount;
      }

      return channelInfo;
    } catch (error) {
      logger.error(
        { userToken, channelId, error: (error as Error).message },
        "Failed to get channel by ID",
      );
      return null;
    }
  }

  /**
   * Get channel profile photo as a buffer
   * @param userToken - The user's authentication token
   * @param sessionString - The user's session string from database
   * @param channelId - The channel ID (format: "-100123456789")
   * @returns Buffer containing the photo or null if not found
   */
  async getChannelPhoto(
    userToken: string,
    sessionString: string,
    channelId: string,
  ): Promise<Buffer | null> {
    try {
      const client = await this.getClientForUser(userToken, sessionString);

      // Get channel entity
      const channel = await client.getEntity(channelId);

      if (!channel) {
        logger.warn({ userToken, channelId }, "Channel not found for photo");
        return null;
      }

      // Download profile photo
      const buffer = await client.downloadProfilePhoto(channel);

      if (!buffer) {
        return null;
      }

      return buffer as Buffer;
    } catch (error) {
      logger.error(
        { userToken, channelId, error: (error as Error).message },
        "Failed to download channel photo",
      );
      return null;
    }
  }

  /**
   * Get video messages from a specific channel
   * @param userToken - The user's authentication token
   * @param sessionString - The user's session string from database
   * @param channelId - The channel ID (format: "-100123456789")
   * @param limit - Maximum number of messages to fetch (default: 50)
   * @param offsetId - Message ID to start from for pagination
   * @returns Array of MediaSearchResult objects
   */
  async getChannelMessages(
    userToken: string,
    sessionString: string,
    channelId: string,
    limit: number = 50,
    offsetId: number = 0,
  ): Promise<import("./types").MediaSearchResult[]> {
    try {
      const client = await this.getClientForUser(userToken, sessionString);

      // Get channel entity
      const channel = await client.getEntity(channelId);

      if (!channel) {
        logger.warn(
          { userToken, channelId },
          "Channel not found for message retrieval",
        );
        return [];
      }

      // Fetch messages from channel
      const messages = await client.invoke(
        new Api.messages.GetHistory({
          peer: channel,
          limit,
          offsetId,
          addOffset: 0,
          maxId: 0,
          minId: 0,
          hash: bigInt.zero,
        }),
      );

      const results: import("./types").MediaSearchResult[] = [];

      if (
        !messages ||
        !(
          messages instanceof Api.messages.Messages ||
          messages instanceof Api.messages.MessagesSlice ||
          messages instanceof Api.messages.ChannelMessages
        )
      ) {
        return results;
      }

      // Process each message
      for (const message of messages.messages) {
        if (!(message instanceof Api.Message)) continue;

        // Check if message has video media
        if (
          message.media &&
          message.media instanceof Api.MessageMediaDocument &&
          message.media.document instanceof Api.Document
        ) {
          const document = message.media.document;

          // Check if it's a video document
          if (this.isVideoDocument(document)) {
            const fileName = this.extractFileNameFromSearchResult(message);
            const fileSize = document.size.toJSNumber();
            const mimeType = document.mimeType;

            // Extract subtitle and dubbing info from filename and caption
            let hasSubtitles = false;
            let isDubbed = false;

            const textToCheck =
              `${fileName || ""} ${message.message || ""}`.toLowerCase();

            // Check for subtitles
            const subtitleIndicators = ["sub", "תרגום", "ترجمة", "subtitle"];
            hasSubtitles = subtitleIndicators.some((indicator) =>
              textToCheck.includes(indicator.toLowerCase()),
            );

            // Check for dubbing
            const dubbedIndicators = ["dub", "dubbed", "מדובב", "مدبلج"];
            isDubbed = dubbedIndicators.some((indicator) =>
              textToCheck.includes(indicator.toLowerCase()),
            );

            results.push({
              chatId: channelId,
              messageId: message.id,
              fileName: fileName || null,
              fileSize,
              mimeType: mimeType || null,
              caption: message.message || null,
              hasSubtitles,
              isDubbed,
            });
          }
        }
      }

      logger.info(
        { userToken, channelId, videoCount: results.length, limit },
        "Retrieved channel video messages",
      );

      return results;
    } catch (error) {
      logger.error(
        { userToken, channelId, error: (error as Error).message },
        "Failed to retrieve channel messages",
      );
      return [];
    }
  }

  /**
   * Send a message to a Telegram chat (defaults to Saved Messages if no channelId provided)
   * @param client - Telegram client
   * @param message - Message text to send
   * @param channelId - Optional channel ID (defaults to Saved Messages)
   * @returns Promise<boolean> - True if message was sent successfully
   */
  async sendMessage(
    client: TelegramClient,
    message: string,
    channelId?: string,
  ): Promise<boolean> {
    try {
      let entity: EntityLike;

      if (channelId) {
        // Send to specific channel
        entity = await client.getEntity(channelId);
      } else {
        // Send to Saved Messages (user's own chat)
        entity = await client.getMe();
      }

      await client.sendMessage(entity, { message });

      logger.info(
        {
          channelId: channelId || "Saved Messages",
          messagePreview: message.substring(0, 50),
        },
        "Successfully sent message to Telegram",
      );

      return true;
    } catch (error) {
      logger.error(
        { channelId, message, error: (error as Error).message },
        "Failed to send message to Telegram",
      );
      throw new Error(`Failed to send message: ${(error as Error).message}`);
    }
  }
}
