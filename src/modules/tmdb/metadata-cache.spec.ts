import { ConfigService } from "@nestjs/config";
import { createCache } from "cache-manager";
import { CacheService } from "../cache/cache.service";
import { TmdbService } from "./tmdb.service";
import { WikidataService } from "../wikidata/wikidata.service";

describe("External metadata caching", () => {
  const config = new ConfigService({
    tmdb: { baseUrl: "https://tmdb.test/3", bearerToken: "token-a" },
    language: { defaultLanguage: "en", preferredLanguage: "en" },
    wikidata: { baseUrl: "https://wikidata.test", sparqlEndpoint: "/sparql" },
  });
  afterEach(() => jest.restoreAllMocks());

  it("coalesces TMDB reads for 24 hours, separating language and credential scope", async () => {
    let now = Date.now();
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const fetcher = jest.spyOn(global, "fetch").mockImplementation(async () => new Response(JSON.stringify({
      id: 1, title: "סרט", original_title: "Movie", release_date: "2025-01-01",
    })));
    const service = new TmdbService(config, new CacheService(createCache(), config));
    await Promise.all(Array.from({ length: 10 }, () => service.getMovieDetailsByTmdbId(1, "en")));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await service.getMovieDetailsByTmdbId(1, "he");
    expect(fetcher).toHaveBeenCalledTimes(2);
    await service.getMovieDetailsByTmdbId(1, "en", "token-b");
    expect(fetcher).toHaveBeenCalledTimes(3);
    now += 86400001;
    await service.getMovieDetailsByTmdbId(1, "en");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("does not cache TMDB HTTP failures", async () => {
    const fetcher = jest.spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 1, title: "Movie" })));
    const service = new TmdbService(config, new CacheService(createCache(), config));
    await expect(service.getMovieDetailsByTmdbId(1, "en")).rejects.toThrow("503");
    await expect(service.getMovieDetailsByTmdbId(1, "en")).resolves.toMatchObject({ title: "Movie" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reuses competing titles across episodes and keeps localized matches when English search fails", async () => {
    const fetcher = jest.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/3/search/tv");
      if (url.searchParams.get("language") === "en") return new Response("", { status: 503 });
      expect(url.searchParams.get("query")).toBe("דוגמה");
      return new Response(JSON.stringify({ results: [
        { id: 1, name: "דוגמה", original_name: "Example" },
        { id: 2, name: "דוגמה נוספת", original_name: "Another Example" },
      ] }));
    });
    const service = new TmdbService(config, new CacheService(createCache(), config));
    const media = { id: 1, imdbId: "tt1234567", type: "series" as const, title: "Example", localizedTitle: "דוגמה" };
    for (const episode of [5, 6]) {
      expect(await service.getCompetingSeriesTitles({ ...media, episodeInfo: { season: 1, episode } }, "he"))
        .toEqual(["דוגמה נוספת", "Another Example"]);
    }
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(await service.getCompetingSeriesTitles({ ...media, id: 0 }, "he")).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("caches Wikidata titles for seven days with language-specific keys", async () => {
    let now = Date.now();
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const fetcher = jest.spyOn(global, "fetch").mockImplementation(async () => new Response(JSON.stringify({
      results: { bindings: [{ labelEn: { value: "Movie" }, labelLocalized: { value: "סרט" } }] },
    })));
    const service = new WikidataService(config, new CacheService(createCache(), config));
    await Promise.all(Array.from({ length: 10 }, () => service.fetchTitlesByImdbId("tt1", "he")));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await service.fetchTitlesByImdbId("tt1", "ru");
    await service.fetchTitlesByImdbId("tt1", "he", "fr");
    expect(fetcher).toHaveBeenCalledTimes(3);
    now += 6 * 86400000;
    await service.fetchTitlesByImdbId("tt1", "he");
    expect(fetcher).toHaveBeenCalledTimes(3);
    now += 86400001;
    await service.fetchTitlesByImdbId("tt1", "he");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("retries missing Wikidata results and upstream failures", async () => {
    const fetcher = jest.spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: { bindings: [] } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: { bindings: [{ labelEn: { value: "Movie" } }] } })));
    const service = new WikidataService(config, new CacheService(createCache(), config));
    expect(await service.fetchTitlesByImdbId("tt1", "en")).toBeNull();
    expect(await service.fetchTitlesByImdbId("tt1", "en")).toBeNull();
    expect(await service.fetchTitlesByImdbId("tt1", "en")).toEqual({ titleEn: "Movie", titleLocalized: null });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
