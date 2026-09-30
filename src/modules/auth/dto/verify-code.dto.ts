import {
  IsString,
  IsNotEmpty,
  Matches,
  Length,
  IsOptional,
} from "class-validator";

export class VerifyCodeDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message: "Phone number must be in E.164 format (e.g., +1234567890)",
  })
  phone: string;

  @IsString()
  @IsNotEmpty()
  @Length(5, 5, { message: "Code must be exactly 5 digits" })
  @Matches(/^\d{5}$/, { message: "Code must contain only digits" })
  code: string;

  @IsOptional()
  @IsString()
  password?: string;
}
