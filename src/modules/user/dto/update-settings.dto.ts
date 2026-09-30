import { IsString, IsOptional, IsIn } from "class-validator";

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  @IsIn(["en", "he", "ru", "ar"])
  language?: string;

  @IsOptional()
  @IsString()
  tmdbToken?: string;
}
