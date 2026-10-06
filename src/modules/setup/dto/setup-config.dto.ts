import { Transform } from "class-transformer";
import {
  IsBoolean,
  MaxLength,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  Max,
} from "class-validator";

export class SetupConfigDto {
  @IsOptional()
  @IsUrl({
    require_tld: false,
    protocols: ["http", "https"],
    require_protocol: true,
  })
  publicUrl?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== "string") return value;
    const text = value.trim();
    if (!text) return undefined;
    // Accept the text field while retaining the numeric ID required by Telegram.
    return /^\d+$/.test(text) ? Number(text) : value;
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
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

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  adminPassword?: string;

  @IsOptional()
  @IsBoolean()
  adminProtection?: boolean;
}
