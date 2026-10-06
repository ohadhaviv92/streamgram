import { IsString, IsOptional, IsIn, MaxLength } from "class-validator";
import { SupportedLanguage } from "../instance-profile";
export class UpdateSettingsDto {
  @IsOptional()
  @IsIn(["en", "he", "ru", "ar"])
  language?: SupportedLanguage | null;
}
export class UpdateNameDto {
  @IsString() @MaxLength(80) name: string;
}
