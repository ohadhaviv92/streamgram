import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class MediaSearchResultDto {
  @ApiProperty()
  chatId: string;

  @ApiProperty()
  messageId: number;

  @ApiPropertyOptional()
  fileName: string | null;

  @ApiProperty()
  fileSize: number;

  @ApiPropertyOptional()
  mimeType: string | null;

  @ApiPropertyOptional()
  caption?: string | null;

  @ApiPropertyOptional()
  hasSubtitles?: boolean;

  @ApiPropertyOptional()
  isDubbed?: boolean;

  @ApiPropertyOptional()
  season?: number;

  @ApiPropertyOptional()
  episode?: number;

  @ApiPropertyOptional()
  score?: number;
}

export class SearchResponseDto {
  @ApiProperty()
  imdb_id: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional({ nullable: true })
  localized_title?: string | null;

  @ApiProperty({ enum: ["movie", "series"] })
  type: "movie" | "series";

  @ApiPropertyOptional({ nullable: true })
  year?: number | null;

  @ApiPropertyOptional({ nullable: true })
  seasons?: number | null;

  @ApiPropertyOptional({ nullable: true })
  episodes?: number | null;

  @ApiPropertyOptional()
  season?: number;

  @ApiPropertyOptional()
  episode?: number;

  @ApiProperty({ type: [MediaSearchResultDto] })
  results: MediaSearchResultDto[];

  @ApiPropertyOptional()
  error?: string;
}

export class StreamDto {
  @ApiPropertyOptional()
  name?: string;

  @ApiProperty()
  url: string;

  @ApiPropertyOptional()
  title?: string;

  @ApiPropertyOptional()
  behaviorHints?: {
    bingeGroup?: string;
    notWebReady?: boolean;
  };
}

export class StreamsResponseDto {
  @ApiProperty({ type: [StreamDto] })
  streams: StreamDto[];
}

export class ManifestResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  version: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  logo: string;

  @ApiProperty({ type: [String] })
  resources: string[];

  @ApiProperty({ type: [String] })
  types: string[];

  @ApiProperty({ type: [String] })
  catalogs: any[];

  @ApiProperty({ type: [String] })
  idPrefixes: string[];

  @ApiProperty()
  behaviorHints: {
    adult: boolean;
    p2p: boolean;
    configurable: boolean;
    configurationRequired: boolean;
  };

  @ApiProperty({ required: false })
  config?: Array<{
    key: string;
    type: string;
    title?: string;
    default?: string;
    required?: boolean;
  }>;
}

export class HealthResponseDto {
  @ApiProperty()
  status: string;

  @ApiProperty()
  telegram_connected: boolean;

  @ApiPropertyOptional()
  active_clients?: number;
}

export class CacheStatsResponseDto {
  @ApiProperty()
  keys: number;

  @ApiProperty()
  hits: number;

  @ApiProperty()
  misses: number;

  @ApiProperty()
  ksize: number;

  @ApiProperty()
  vsize: number;
}
