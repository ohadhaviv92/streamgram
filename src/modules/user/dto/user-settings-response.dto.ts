export class UserSettingsResponseDto {
  success: boolean;
  language: string;
  tmdbToken: string | null;
  manifestUrl: string;
  telegramConnected: boolean;
  catalogUrl?: string;
  channelsCatalogUrl?: string;
}
