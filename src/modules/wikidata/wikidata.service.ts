import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WikidataResponse } from "../tmdb/types";

@Injectable()
export class WikidataService {
  private readonly wikidataBaseUrl: string;
  private readonly wikidataSparqlEndpoint: string;

  constructor(private configService: ConfigService) {
    this.wikidataBaseUrl = this.configService.get<string>(
      "wikidata.baseUrl",
      "https://query.wikidata.org",
    );
    this.wikidataSparqlEndpoint = this.configService.get<string>(
      "wikidata.sparqlEndpoint",
      "/sparql",
    );
  }

  /**
   * Remove single and double quotes from text
   * @param text - Text to sanitize
   * @returns Text without quotes
   */
  private removeQuotes(text: string): string {
    return text.replace(/["]/g, "");
  }

  /**
   * Fetch media details from Wikidata SPARQL endpoint
   * @param imdbId - IMDB ID (e.g., "tt39772791")
   * @param userLanguage - User's preferred language code (e.g., "he", "ru", "ar")
   * @param defaultLanguage - Default language code (typically "en")
   * @returns Object with English and localized titles, or null if not found
   */
  async fetchTitlesByImdbId(
    imdbId: string,
    userLanguage: string,
    defaultLanguage: string = "en",
  ): Promise<{ titleEn: string; titleLocalized: string | null } | null> {
    try {
      // Build SPARQL query to fetch both English and user's preferred language
      const needsLocalizedLanguage = userLanguage !== defaultLanguage;

      // Build variable names for SPARQL query
      let sparqlQuery = `SELECT ?labelEn`;
      if (needsLocalizedLanguage) {
        sparqlQuery += ` ?labelLocalized`;
      }
      sparqlQuery += ` WHERE { ?item wdt:P345 "${imdbId}". OPTIONAL { ?item rdfs:label ?labelEn FILTER(lang(?labelEn) = "${defaultLanguage}") }`;
      if (needsLocalizedLanguage) {
        sparqlQuery += ` OPTIONAL { ?item rdfs:label ?labelLocalized FILTER(lang(?labelLocalized) = "${userLanguage}") }`;
      }
      sparqlQuery += ` }`;

      const url = new URL(this.wikidataBaseUrl + this.wikidataSparqlEndpoint);
      url.searchParams.append("query", sparqlQuery);
      url.searchParams.append("format", "json");

      console.log("[Wikidata] Query URL:", url.toString());

      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/sparql-results+json",
          "User-Agent": "Tg2Stream/1.0 (https://github.com/ohadhaviv92/tg2stream)",
        },
      });

      if (!response.ok) {
        console.error(
          "[Wikidata] HTTP error:",
          response.status,
          response.statusText,
        );
        return null;
      }

      const data = (await response.json()) as WikidataResponse;
      console.log("[Wikidata] Response:", JSON.stringify(data, null, 2));

      if (!data.results.bindings || data.results.bindings.length === 0) {
        console.warn("[Wikidata] No results found for IMDB ID:", imdbId);
        return null;
      }

      const binding = data.results.bindings[0];

      // Extract English title
      const titleEn = binding.labelEn?.value;
      if (!titleEn) {
        console.warn("[Wikidata] No English title found for IMDB ID:", imdbId);
        return null;
      }

      // Extract localized title if different language
      let titleLocalized: string | null = null;
      if (needsLocalizedLanguage) {
        titleLocalized = binding.labelLocalized?.value || null;
      }

      console.log("[Wikidata] Found titles:", { titleEn, titleLocalized });

      return {
        titleEn: this.removeQuotes(titleEn),
        titleLocalized: titleLocalized
          ? this.removeQuotes(titleLocalized)
          : null,
      };
    } catch (error) {
      // If Wikidata request fails, log and return null
      console.error("[Wikidata] Error fetching titles:", error);
      return null;
    }
  }
}
