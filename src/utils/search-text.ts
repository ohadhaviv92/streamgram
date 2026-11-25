/** Normalize release separators and optional vowel marks without changing title word order. */
export function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLowerCase()
    .replace(/[\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u064b-\u065f\ufe0f\u20e3]/g, "")
    .replace(/['’׳]/gu, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
}

/** Both arguments are already normalized. */
export function containsTitle(text: string, title: string): boolean {
  return Boolean(title) && (" " + text + " ").includes(" " + title + " ");
}

export interface MediaIndicators {
  subtitleIndicators: string[];
  dubbedIndicators: string[];
}

export function matchMediaIndicators(text: string, languages: MediaIndicators[]) {
  const normalized = normalizeSearchText(text);
  const matches = (indicator: string) => containsTitle(normalized, normalizeSearchText(indicator));
  return {
    hasSubtitles: languages.some((lang) => lang.subtitleIndicators.some(matches)),
    isDubbed: languages.some((lang) => lang.dubbedIndicators.some(matches)),
  };
}
