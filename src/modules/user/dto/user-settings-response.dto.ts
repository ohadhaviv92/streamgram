export class UserSettingsResponseDto {
  success: boolean;
  name: string;
  personalLanguage: string | null;
  language: string;
  tmdbToken: string | null;
  manifestUrl: string;
  telegramConnected: boolean;
  catalogUrl?: string;
  channelsCatalogUrl?: string;
}
