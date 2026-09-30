export type SupportedLanguage = "en" | "he" | "ru" | "ar";

/**
 * The single profile owned by one TG2Stream installation.
 *
 * This intentionally keeps the old snake_case field names used by the
 * streaming code while representing only the local installation.
 */
export interface InstanceProfile {
  id: 1;
  phone: string | null;
  session_string: string;
  token: "instance";
  language: SupportedLanguage;
  tmdb_token: string | null;
  selected_folders: string;
  selected_channels: string;
}

export interface PersistedInstanceConfig {
  publicUrl?: string;
  phone?: string;
  telegram?: {
    apiId?: number;
    apiHash?: string;
    sessionString?: string;
  };
  tmdb?: {
    bearerToken?: string;
  };
  preferredLanguage?: SupportedLanguage;
  selectedFolders?: number[];
  selectedChannels?: string[];
}

export interface EffectiveInstanceConfig {
  publicUrl: string;
  telegram: {
    apiId: number;
    apiHash: string;
    sessionString: string;
  };
  tmdb: {
    bearerToken: string;
  };
  preferredLanguage: SupportedLanguage;
  phone: string | null;
  selectedFolders: number[];
  selectedChannels: string[];
}
