export type SupportedLanguage = "en" | "he" | "ru" | "ar";

/**
 * A single user's persisted entry inside the `users` map.
 */
export interface UserEntry {
  /** Unix timestamp in milliseconds; absent for accounts created before tracking. */
  createdAt?: number;
  /** Optional display name (not used for auth). */
  name?: string;
  telegramId?: string;
  language?: SupportedLanguage;
  /** Telegram phone number (with + prefix). */
  phone: string;
  /** Authenticated Telegram session string. */
  sessionString: string;
  /** Short URL-safe token generated once and stored alongside the entry. */
  token: string;
  /** IDs of selected folders for this user. */
  selectedFolders?: number[];
  /** IDs of selected channels for this user. */
  selectedChannels?: string[];
}

/**
 * The account profile used by streaming services.
 *
 * Keeps the existing snake_case field names used by streaming code while
 * reflecting the per-user token and session from the users map.
 */
export interface InstanceProfile {
  id: 1;
  phone: string | null;
  session_string: string;
  /** The short per-user URL-safe token (used as route prefix). */
  token: string;
  language: SupportedLanguage;
  tmdb_token: string | null;
  selected_folders: string;
  selected_channels: string;
}

export interface PersistedInstanceConfig {
  adminPasswordHash?: string;
  managementInitialized?: boolean;
  adminProtection?: boolean;
  invitations?: InvitationRecord[];
  publicUrl?: string;
  telegram?: {
    apiId?: number;
    apiHash?: string;
  };
  tmdb?: {
    bearerToken?: string;
  };
  preferredLanguage?: SupportedLanguage;
  /** Map of userToken → UserEntry. */
  users?: Record<string, UserEntry>;
}

export interface EffectiveInstanceConfig {
  publicUrl: string;
  telegram: {
    apiId: number;
    apiHash: string;
  };
  tmdb: {
    bearerToken: string;
  };
  preferredLanguage: SupportedLanguage;
}

export interface InvitationRecord {
  id: string;
  name?: string;
  secretHash: string;
  createdAt: number;
  expiresAt: number;
  revokedAt?: number;
  usedAt?: number;
}

export type AuthOwner =
  | { kind: "admin"; id: string }
  | { kind: "invitation"; id: string }
  | { kind: "user"; id: string };
