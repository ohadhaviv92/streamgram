import { MediaSearchResult } from "../telegram/types";

export interface SearchResponsePayload {
  imdb_id: string;
  title: string;
  localized_title?: string | null;
  type: "movie" | "series";
  year?: number | null;
  seasons?: number | null;
  episodes?: number | null;
  season?: number;
  episode?: number;
  results: MediaSearchResult[];
  error?: string;
}
