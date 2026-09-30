import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumberString,
} from "class-validator";

export class MovieSearchDto {
  @ApiProperty({
    description: 'IMDB ID or TMDB ID (prefixed with "tmdb:")',
    example: "tt1375666",
  })
  @IsString()
  @IsNotEmpty()
  imdb_id: string;
}

export class SeriesSearchDto {
  @ApiProperty({
    description: 'IMDB ID or TMDB ID (prefixed with "tmdb:")',
    example: "tt0944947",
  })
  @IsString()
  @IsNotEmpty()
  imdb_id: string;
}

export class EpisodeParamsDto {
  @ApiProperty({
    description: 'IMDB ID or TMDB ID (prefixed with "tmdb:")',
    example: "tt0944947",
  })
  @IsString()
  @IsNotEmpty()
  imdbId: string;

  @ApiProperty({
    description: "Season number",
    example: "1",
  })
  @IsNumberString()
  season: string;

  @ApiProperty({
    description: "Episode number",
    example: "1",
  })
  @IsNumberString()
  episode: string;
}

export class StreamParamsDto {
  @ApiProperty({
    description: "Media type",
    example: "movie",
    enum: ["movie", "series"],
  })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({
    description: "ID with optional episode info",
    example: "tt1375666",
  })
  @IsString()
  @IsNotEmpty()
  idWithEpisode: string;
}

export class WatchParamsDto {
  @ApiProperty({
    description: "Telegram chat ID",
    example: "-1001234567890",
  })
  @IsString()
  @IsNotEmpty()
  chatId: string;

  @ApiProperty({
    description: "Message ID",
    example: "12345",
  })
  @IsNumberString()
  messageId: string;
}
