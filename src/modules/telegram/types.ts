export type PlaybackPeer = { id: string } & (
  { kind: "chat" } | { kind: "self" } | { kind: "channel" | "user"; accessHash: string }
);

export interface MediaSearchResult {
  peer: PlaybackPeer;
  chatId: string;
  channelTitle?: string;
  messageId: number;
  fileName: string | null;
  fileSize: number;
  /** Telegram document creation date as a Unix timestamp in seconds. */
  uploadedAt?: number;
  mimeType: string | null;
  caption?: string | null;
  hasSubtitles?: boolean;
  isDubbed?: boolean;
  season?: number;
  episode?: number;
  score?: number;
  customName?: string; // Tag name when result comes from /tag command
}

export interface EpisodeInfo {
  season: number;
  episode: number;
}

export interface TelegramFolder {
  id: number;
  title: string;
  channelIds: string[];
}

export interface ChannelInfo {
  id: string;
  title: string;
  username?: string;
  memberCount?: number;
}
