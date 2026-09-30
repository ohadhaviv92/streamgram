export interface MediaDetails {
  id: number;
  imdbId: string;
  title: string;
  localizedTitle?: string | null;
  originalTitle?: string | null;
  overview?: string | null;
  type: "movie" | "series";
  year?: number | null;
  seasons?: number | null;
  episodes?: number | null;
  episodeInfo?: {
    season: number;
    episode: number;
  } | null;
}

export interface TMDBFindResponse {
  movie_results?: Array<{ id: number; title: string }>;
  tv_results?: Array<{ id: number; name: string }>;
}

export interface TMDBMovieDetailsResponse {
  id: number;
  title: string;
  original_title: string;
  overview: string | null;
  release_date?: string;
}

export interface TMDBSeriesDetailsResponse {
  id: number;
  name: string;
  original_name: string;
  overview: string | null;
  first_air_date?: string;
  number_of_seasons?: number;
  number_of_episodes?: number;
}

export interface TMDBAlternativeTitle {
  iso_3166_1: string;
  title: string;
  type?: string;
}

export interface TMDBMovieAlternativeTitlesResponse {
  id: number;
  titles: TMDBAlternativeTitle[];
}

export interface TMDBSeriesAlternativeTitlesResponse {
  id: number;
  results: TMDBAlternativeTitle[];
}

export interface WikidataBinding {
  type: string;
  value: string;
  "xml:lang"?: string;
}

export interface WikidataResult {
  [key: string]: WikidataBinding | undefined;
}

export interface WikidataResponse {
  head: {
    vars: string[];
  };
  results: {
    bindings: WikidataResult[];
  };
}
