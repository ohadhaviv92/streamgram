import { IsIn, IsInt, IsOptional, IsString, IsUrl, Min } from "class-validator";

export class SetupConfigDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  publicUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  apiId?: number;

  @IsOptional()
  @IsString()
  apiHash?: string;

  @IsOptional()
  @IsString()
  tmdbBearerToken?: string;

  @IsOptional()
  @IsIn(["en", "he", "ru", "ar"])
  preferredLanguage?: "en" | "he" | "ru" | "ar";
}
