import { containsTitle, MediaIndicators, normalizeSearchText } from "../../utils/search-text";
import { EpisodeInfo, MediaSearchResult } from "./types";
import { videoExtension } from "./video-filename";

type Terms = { long: string[]; short: string[] };
type EpisodeLanguage = MediaIndicators & { seasonTerms: Terms; episodeTerms: Terms };
export type TitleMatch = "clear" | "ambiguous" | "none";

function episodePattern(languages: EpisodeLanguage[], episode?: EpisodeInfo): RegExp {
  const seasonNumber = episode ? "0*" + episode.season : "[0-9]+";
  const episodeNumber = episode ? "0*" + episode.episode : "[0-9]+";
  const terms = (words: string[]) => "(?:" + words.map(normalizeSearchText).join("|") + ")";
  const patterns = languages.flatMap(({ seasonTerms, episodeTerms }) => [
    terms(seasonTerms.long) + " " + seasonNumber + " " + terms(episodeTerms.long) + " " + episodeNumber,
    terms(seasonTerms.short) + seasonNumber + " ?" + terms(episodeTerms.short) + episodeNumber,
  ]);
  return new RegExp("(?:^| )(?:" + patterns.join("|") + ")(?= |$)", "u");
}

const releaseSuffix = /(?: (?:[0-9]{3,4}p|4k|uhd|hd|web dl|webdl|bluray|x26[45]|19[0-9]{2}|20[0-9]{2}))+$/u;

/** One matcher per episode request. Title lookups are shared by every query and fallback channel. */
export class EpisodeMatcher {
  readonly titles: string[];
  private readonly fullTitles: Set<string>;
  private readonly requestedEpisode: RegExp;
  private readonly anyEpisode: RegExp;
  private readonly editionIndicators: string[];
  private competitors?: Promise<string[]>;

  constructor(
    fullTitles: string[],
    shortTitles: string[],
    readonly episode: EpisodeInfo,
    languages: EpisodeLanguage[],
    private readonly loadCompetingTitles: () => Promise<string[]>,
  ) {
    this.fullTitles = new Set(fullTitles.map(normalizeSearchText).filter(Boolean));
    this.titles = [...new Set([...this.fullTitles, ...shortTitles.map(normalizeSearchText).filter(Boolean)])];
    this.requestedEpisode = episodePattern(languages, episode);
    this.anyEpisode = episodePattern(languages);
    this.editionIndicators = languages.flatMap((lang) => [...lang.subtitleIndicators, ...lang.dubbedIndicators])
      .map(normalizeSearchText).filter(Boolean).sort((a, b) => b.length - a.length);
  }

  matchesEpisode(text: string): boolean {
    return this.requestedEpisode.test(normalizeSearchText(text));
  }

  private stripReleaseMetadata(name: string): string {
    while (name && !this.fullTitles.has(name)) {
      const withoutQuality = name.replace(releaseSuffix, "");
      const indicator = this.editionIndicators.find((phrase) => withoutQuality.endsWith(" " + phrase));
      const stripped = indicator ? withoutQuality.slice(0, -indicator.length - 1) : withoutQuality;
      if (stripped === name) break;
      name = stripped;
    }
    return name;
  }

  isSeriesChannel(title: string): boolean {
    return this.fullTitles.has(this.stripReleaseMetadata(normalizeSearchText(title)));
  }

  private evaluate(parts: string[]): TitleMatch {
    let match: TitleMatch = "none";
    for (const part of parts) {
      const name = this.stripReleaseMetadata(part);
      for (const title of this.titles) {
        if (!containsTitle(part, title)) continue;
        if (this.fullTitles.has(title) && (name === title || name.endsWith(" " + title) || part.endsWith(" " + title))) {
          return "clear";
        }
        match = "ambiguous";
      }
    }
    return match;
  }

  /** A validated dedicated channel can supply the title for an episode-only upload. */
  async match(result: Pick<MediaSearchResult, "fileName" | "caption">, channelTitle?: string): Promise<TitleMatch> {
    const fileName = result.fileName || "";
    const lines = [normalizeSearchText(fileName.slice(0, fileName.length - videoExtension(fileName).length))];
    const caption = (result.caption || "").split(/\r?\n/u).map(normalizeSearchText).filter(Boolean);
    // Ignore plot summaries and promotional lines following the episode heading.
    const headingEnd = caption.findIndex((line) => this.anyEpisode.test(line));
    if (caption.length) lines.push(caption[0]);
    if (headingEnd > 1) lines.push(caption[headingEnd - 1]);
    if (headingEnd > 0) lines.push(caption[headingEnd]);

    let foundEpisode = false;
    const parts: string[] = [];
    for (const line of lines) {
      const marker = this.anyEpisode.exec(line);
      if (marker && !this.requestedEpisode.test(marker[0])) return "none";
      if (marker) foundEpisode = true;
      let title = line;
      if (marker) {
        // Most releases put the title first, but some start with S01E05.
        title = marker.index ? line.slice(0, marker.index) : line.slice(marker[0].length).trim();
      }
      parts.push(title);
    }
    if (!channelTitle && !foundEpisode) return "none";
    const messageMatch = this.evaluate(parts);
    const channel = normalizeSearchText(channelTitle || "");
    const match = messageMatch === "none" ? this.evaluate([channel]) : messageMatch;
    if (match === "none") return match;

    if (channel) parts.push(channel);
    const possiblyLonger = parts.filter((part) => !this.fullTitles.has(part) &&
      this.titles.some((title) => containsTitle(part, title)));
    if (possiblyLonger.length) {
      this.competitors ??= this.loadCompetingTitles().then((names) =>
        [...new Set(names.map(normalizeSearchText))].filter((name) =>
          !this.fullTitles.has(name) && this.titles.some((title) => containsTitle(name, title))),
      );
      const otherTitles = await this.competitors;
      for (const part of possiblyLonger) {
        if (otherTitles.some((other) => containsTitle(part, other) &&
          ![...this.fullTitles].some((full) => containsTitle(full, other) && containsTitle(part, full)))) {
          return "none";
        }
      }
    }
    return match;
  }
}
