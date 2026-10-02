import configuration from "../config/configuration";
import { MediaDetails } from "../modules/tmdb/types";
import { MediaSearchResult } from "../modules/telegram/types";
import { SearchResponsePayload } from "../modules/stream/types";

const config = configuration();

type StremioStream = {
  name: string;
  title: string;
  url: string;
  behaviorHints: {
    notWebReady: boolean;
  };
};

const QUALITY_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  { regex: /(2160p|4k|uhd)/i, label: "4K" },
  { regex: /1080p/i, label: "1080p" },
  { regex: /720p/i, label: "720p" },
  { regex: /480p/i, label: "480p" },
  { regex: /360p/i, label: "360p" },
  { regex: /dvdrip/i, label: "DVDRip" },
  { regex: /brrip/i, label: "BRRip" },
  { regex: /bluray/i, label: "BluRay" },
  { regex: /(web-dl|webdl)/i, label: "WEB-DL" },
  { regex: /webrip/i, label: "WEBRip" },
  { regex: /hdtv/i, label: "HDTV" },
  { regex: /hdrip/i, label: "HDRip" },
];

export function mapSearchPayloadToMediaDetails(
  payload: SearchResponsePayload,
): MediaDetails {
  return {
    id: 0,
    imdbId: payload.imdb_id,
    title: payload.title,
    localizedTitle: payload.localized_title ?? null,
    type: payload.type,
    overview: null,
    year: payload.year ?? null,
    seasons: payload.seasons ?? null,
    episodes: payload.episodes ?? null,
    episodeInfo:
      payload.type === "series" &&
      payload.season !== undefined &&
      payload.episode !== undefined
        ? { season: payload.season, episode: payload.episode }
        : null,
  };
}

export function getStreamBaseUrl(): string {
  const host = config.server.host;
  const port = config.server.port;
  const configured = config.server.streamHost;

  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const resolvedHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
  return `http://${resolvedHost}:${port}`;
}

export function extractQualityFromFilename(
  filename?: string | null,
): string | null {
  if (!filename) return null;

  for (const { regex, label } of QUALITY_PATTERNS) {
    if (regex.test(filename)) {
      return label;
    }
  }

  return null;
}

export function detectSubtitlesAndDubbing(text?: string | null): {
  hasSubtitles: boolean;
  isDubbed: boolean;
} {
  if (!text) {
    return { hasSubtitles: false, isDubbed: false };
  }

  const languages = config.language.languages;
  const lower = text.toLowerCase();

  let hasSubtitles = false;
  let isDubbed = false;

  for (const lang of Object.values(languages)) {
    if (!hasSubtitles) {
      hasSubtitles = (lang as any).subtitleIndicators.some(
        (indicator: string) => lower.includes(indicator.toLowerCase()),
      );
    }
    if (!isDubbed) {
      isDubbed = (lang as any).dubbedIndicators.some((indicator: string) =>
        lower.includes(indicator.toLowerCase()),
      );
    }
  }

  return { hasSubtitles, isDubbed };
}

/**
 * Check if a filename is generic/unhelpful (like "index.mp4", "video.mp4", etc.)
 */
function isGenericFilename(filename: string | null | undefined): boolean {
  if (!filename) return true;

  // Remove tag emoji if present
  const cleanName = filename.replace(/^🏷️\s*/, "");

  // Generic patterns: index, video, movie, file, vid, document, etc.
  const genericPatterns = [
    /^index\.(mp4|mkv|avi|mov|webm|flv|wmv|m4v|mpg|mpeg)/i,
    /^video\.(mp4|mkv|avi|mov|webm|flv|wmv|m4v|mpg|mpeg)/i,
    /^movie\.(mp4|mkv|avi|mov|webm|flv|wmv|m4v|mpg|mpeg)/i,
    /^file\.(mp4|mkv|avi|mov|webm|flv|wmv|m4v|mpg|mpeg)/i,
    /^vid\.(mp4|mkv|avi|mov|webm|flv|wmv|m4v|mpg|mpeg)/i,
    /^document\.(mp4|mkv|avi|mov|webm|flv|wmv|m4v|mpg|mpeg)/i,
    /^untitled\.(mp4|mkv|avi|mov|webm|flv|wmv|m4v|mpg|mpeg)/i,
    /^\d+\.(mp4|mkv|avi|mov|webm|flv|wmv|m4v|mpg|mpeg)$/i, // Just numbers like "123.mp4"
  ];

  return genericPatterns.some((pattern) => pattern.test(cleanName));
}

export function formatStreamForStremio(
  _instanceKey: string,
  result: MediaSearchResult,
  media?: {
    title: string;
    episodeInfo?: { season: number; episode: number } | null;
  },
  baseUrlOverride?: string,
): StremioStream | null {
  if (!result.chatId || !result.messageId) {
    return null;
  }

  const baseUrl = (baseUrlOverride || getStreamBaseUrl()).replace(/\/$/, "");
  const streamUrl = `${baseUrl}/watch/${result.chatId}/${result.messageId}`;

  // Check if this is a tagged result (has tag emoji)
  const isTagged = result.fileName?.startsWith("🏷️");

  // Get episode info from result or media
  const season = result.season || media?.episodeInfo?.season;
  const episode = result.episode || media?.episodeInfo?.episode;

  // Format season/episode string if available
  let episodeString = "";
  if (season !== undefined && episode !== undefined) {
    const seasonPadded = season.toString().padStart(2, "0");
    const episodePadded = episode.toString().padStart(2, "0");
    episodeString = ` S${seasonPadded}E${episodePadded}`;
  }

  // Determine display name: prefer media title if filename is generic
  let displayName: string;
  if (isGenericFilename(result.fileName) && media?.title) {
    // Use media title for generic filenames, preserve tag emoji, add episode info
    displayName = isTagged
      ? `🏷️ ${media.title}${episodeString}`
      : `${media.title}${episodeString}`;
  } else {
    // Use original filename or fallback
    displayName = result.fileName || media?.title || "Video";
  }

  const quality = extractQualityFromFilename(result.fileName || undefined);
  const metadata = detectSubtitlesAndDubbing(
    `${result.fileName ?? ""} ${result.caption ?? ""}`,
  );

  const preferredLangKey = config.language
    .preferredLanguage as keyof typeof config.language.languages;
  const langConfig = config.language.languages[preferredLangKey];

  const metadataParts = ["Tg2Stream"];
  if (quality) metadataParts.push(quality);
  if (metadata.hasSubtitles)
    metadataParts.push((langConfig as any).subtitleLabel);
  if (metadata.isDubbed) metadataParts.push((langConfig as any).dubbedLabel);

  const titleLines: string[] = [];
  if (displayName) {
    titleLines.push(displayName);
  }

  if (result.fileSize) {
    const sizeMb = result.fileSize / (1024 * 1024);
    if (sizeMb >= 1024) {
      const sizeGb = Math.round((sizeMb / 1024) * 100) / 100;
      titleLines.push(`💾 ${sizeGb}GB`);
    } else {
      titleLines.push(`💾 ${Math.round(sizeMb)}MB`);
    }
  }

  return {
    name: metadataParts.join("\n"),
    title: titleLines.join("\n"),
    url: streamUrl,
    behaviorHints: { notWebReady: false },
  };
}

/**
 * Creates a synthetic "How to Tag" instructional stream result
 * that shows users how to tag media using the /tag command in Telegram.
 *
 * @param userLanguage - ISO 639-1 language code (e.g., "en", "he", "ru", "ar")
 * @param mediaDetails - Media metadata including title, localized title, type, and episode info
 * @param catalogId - Stremio catalog ID (e.g., "tt0108778:1:1" or "tmdb:550")
 * @param _instanceKey - Kept for compatibility with the existing call sites; the URL is tokenless
 * @returns A StremioStream object with tag instructions in the user's language
 *
 * @example
 * // For a movie:
 * createHowToTagStream("en", { title: "Tarzan", year: 2002, type: "movie" }, "tt0285252", "instance")
 * // Returns: { name: "How to Tag", title: "/tag tt0285252", url: "https://api.com/tag/tt0285252", ... }
 *
 * @example
 * // For a series episode:
 * createHowToTagStream("he", {
 *   title: "Friends",
 *   localizedTitle: "החברים",
 *   type: "series",
 *   episodeInfo: { season: 1, episode: 1 }
 * }, "tt0108778:1:1", "instance")
 * // Returns: { name: "איך לתייג", title: "/tag tt0108778:1:1", url: "https://api.com/tag/tt0108778%3A1%3A1", ... }
 */
export function createHowToTagStream(
  userLanguage: string,
  mediaDetails: MediaDetails,
  catalogId: string,
  _instanceKey: string,
  baseUrlOverride?: string,
): StremioStream {
  const langKey = userLanguage as keyof typeof config.language.languages;
  const langConfig =
    config.language.languages[langKey] || config.language.languages.en;

  const baseUrl = (baseUrlOverride || getStreamBaseUrl()).replace(/\/$/, "");
  const tagUrl = `${baseUrl}/tag/${encodeURIComponent(catalogId)}`;

  // Determine if we should show human-readable format or catalog ID
  // Use human-readable format for:
  // 1. Movies where localizedTitle equals title (avoid duplication)
  // 2. Series episodes without localized title (show "no localized title" message)
  // 3. Series episodes for Russian/Arabic with localized title (show localized examples)
  // 4. Unknown/unsupported languages (fallback to readable format)

  const isKnownLanguage = langKey in config.language.languages;
  const isNonEnglish = userLanguage !== "en";
  const hasLocalizedTitle =
    mediaDetails.localizedTitle &&
    mediaDetails.localizedTitle !== mediaDetails.title;

  // For movies: use human-readable only when localizedTitle equals title OR unknown language
  const useReadableForMovie =
    (mediaDetails.localizedTitle &&
      mediaDetails.localizedTitle === mediaDetails.title) ||
    !isKnownLanguage;

  // For series: use human-readable format EXCEPT for Hebrew with localized title AND English without localized title
  // This allows showing examples for most cases, but uses catalog ID for primary backend cases
  const useReadableForSeries =
    (isNonEnglish && !hasLocalizedTitle) || // Non-English without localized → show example with message
    (userLanguage !== "en" && userLanguage !== "he" && hasLocalizedTitle) || // Russian, Arabic with localized → show examples
    !isKnownLanguage; // Unknown language → show English example

  let tagTitle: string;

  if (mediaDetails.type === "movie" && useReadableForMovie) {
    // Human-readable format for movies: /tag Title Year
    const year = mediaDetails.year ? ` ${mediaDetails.year}` : "";
    tagTitle = `/tag ${mediaDetails.title}${year}`;
  } else if (
    mediaDetails.type === "series" &&
    mediaDetails.episodeInfo &&
    useReadableForSeries
  ) {
    // Human-readable format for series: /tag Title sXXeYY (with optional localized version)
    const { season, episode } = mediaDetails.episodeInfo;
    const seasonPadded = season.toString().padStart(2, "0");
    const episodePadded = episode.toString().padStart(2, "0");

    // Get season/episode markers for the language
    const seasonMarker = (langConfig as any).seasonTerms.short[0];
    const episodeMarker = (langConfig as any).episodeTerms.short[0];

    const englishFormat = `/tag ${mediaDetails.title} s${seasonPadded}e${episodePadded}`;

    // Check if we need to show localized version
    if (hasLocalizedTitle && isNonEnglish && userLanguage !== "he") {
      // Show both English and localized formats (for Russian, Arabic, etc.)
      const localizedFormat = `/tag ${mediaDetails.localizedTitle} ${seasonMarker}${seasonPadded}${episodeMarker}${episodePadded}`;
      tagTitle = `${englishFormat}\n${localizedFormat}`;
    } else if (isNonEnglish && !hasLocalizedTitle) {
      // Non-English user without localized title: show "no localized title" message
      const noLocalizedMsg = (langConfig as any).noLocalizedTitleMessage;
      tagTitle = `${englishFormat}\n${noLocalizedMsg}`;
    } else {
      // English user or no localized title needed
      tagTitle = englishFormat;
    }
  } else {
    // Default: Use catalog ID format
    tagTitle = `/tag ${catalogId}`;
  }

  return {
    name: `Tg2Stream\n🏷️ ${(langConfig as any).howToTagLabel}`,
    title: tagTitle,
    url: tagUrl,
    behaviorHints: { notWebReady: false },
  };
}
