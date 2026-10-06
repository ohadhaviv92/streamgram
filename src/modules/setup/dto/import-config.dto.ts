import { plainToInstance, Type } from "class-transformer";
import { BadRequestException } from "@nestjs/common";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  validateSync,
} from "class-validator";
import {
  PersistedInstanceConfig,
  SupportedLanguage,
  UserEntry,
} from "../../user/instance-profile";

class ImportUserDto implements UserEntry {
  @IsString() @MaxLength(80) @IsOptional() name?: string;
  @IsString() @Matches(/^\d+$/) @IsOptional() telegramId?: string;
  @IsString() phone: string;
  @IsString() sessionString: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,128}$/) token: string;
  @IsIn(["en", "he", "ru", "ar"]) @IsOptional() language?: SupportedLanguage;
  @IsArray() @IsInt({ each: true }) @IsOptional() selectedFolders?: number[];
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  selectedChannels?: string[];
}
@ValidatorConstraint({ name: "usersMap", async: false })
class UsersMap implements ValidatorConstraintInterface {
  validate(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const identities = new Set<string>();
    return Object.entries(value).every(([token, entry]) => {
      if (
        !entry ||
        typeof entry !== "object" ||
        Array.isArray(entry) ||
        !/^[A-Za-z0-9_-]{8,128}$/.test(token) ||
        ["__proto__", "constructor", "prototype"].includes(token) ||
        entry.token !== token
      )
        return false;
      const user = plainToInstance(ImportUserDto, entry);
      if (
        validateSync(user, { whitelist: true, forbidNonWhitelisted: true })
          .length
      )
        return false;
      const identity = user.telegramId || user.phone.replace(/\D/g, "");
      if (!identity || identities.has(identity)) return false;
      identities.add(identity);
      return true;
    });
  }
  defaultMessage(_args: ValidationArguments) {
    return "users must be a valid token-keyed account map with unique Telegram identities";
  }
}
export class ImportTelegramDto {
  @IsOptional() @IsInt() @Min(1) apiId?: number;
  @IsOptional() @IsString() apiHash?: string;
}
export class ImportTmdbDto {
  @IsOptional() @IsString() bearerToken?: string;
}
export class ImportConfigDto {
  @IsOptional()
  @IsUrl({
    require_tld: false,
    protocols: ["http", "https"],
    require_protocol: true,
  })
  publicUrl?: string;
  @IsOptional()
  @IsIn(["en", "he", "ru", "ar"])
  preferredLanguage?: SupportedLanguage;
  @IsOptional()
  @ValidateNested()
  @Type(() => ImportTelegramDto)
  telegram?: ImportTelegramDto;
  @IsOptional()
  @ValidateNested()
  @Type(() => ImportTmdbDto)
  tmdb?: ImportTmdbDto;
  @IsOptional() @IsObject() @Validate(UsersMap) users?: Record<
    string,
    UserEntry
  >;
  // Backup metadata is accepted but never restores credentials, sessions, or invites for management.
  @IsOptional() @IsString() adminPasswordHash?: string;
  @IsOptional() @IsBoolean() adminProtection?: boolean;
  @IsOptional() @IsBoolean() managementInitialized?: boolean;
  @IsOptional() @IsArray() invitations?: PersistedInstanceConfig["invitations"];
}
export function validateBackup(incoming: unknown): PersistedInstanceConfig {
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming))
    throw new BadRequestException("Invalid backup");
  const parsed = plainToInstance(ImportConfigDto, incoming);
  if (
    validateSync(parsed, { whitelist: true, forbidNonWhitelisted: true }).length
  )
    throw new BadRequestException(
      "Invalid backup configuration or account preferences",
    );
  return {
    publicUrl: parsed.publicUrl,
    telegram: parsed.telegram,
    tmdb: parsed.tmdb,
    preferredLanguage: parsed.preferredLanguage,
    users: parsed.users ?? {},
  };
}
