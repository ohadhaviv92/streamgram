import { Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { SupportedLanguage } from "../../user/instance-profile";

export class ImportTelegramDto {
  @IsOptional()
  @IsNumber()
  apiId?: number;

  @IsOptional()
  @IsString()
  apiHash?: string;

  @IsOptional()
  @IsString()
  sessionString?: string;
}

export class ImportTmdbDto {
  @IsOptional()
  @IsString()
  bearerToken?: string;
}

export class ImportConfigDto {
  @IsOptional()
  @IsString()
  publicUrl?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsIn(["en", "he", "ru", "ar"])
  preferredLanguage?: SupportedLanguage;

  @IsOptional()
  @IsArray()
  selectedFolders?: number[];

  @IsOptional()
  @IsArray()
  selectedChannels?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ImportTelegramDto)
  telegram?: ImportTelegramDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ImportTmdbDto)
  tmdb?: ImportTmdbDto;
}
