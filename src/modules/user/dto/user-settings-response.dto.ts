export class UserSettingsResponseDto {
  success: boolean;
  canEditName: boolean;
  name?: string;
  personalLanguage: string | null;
  language: string;
  instanceLanguage: string;
  tmdbToken: string | null;
  manifestUrl: string;
  telegramConnected: boolean;
  catalogUrl?: string;
  channelsCatalogUrl?: string;
}
