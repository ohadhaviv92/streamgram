import {
  IsString,
  IsNotEmpty,
  Matches,
  Length,
  IsOptional,
} from "class-validator";
import { SendCodeDto } from "./send-code.dto";

export class VerifyCodeDto extends SendCodeDto {
  @IsString()
  @IsNotEmpty()
  @Length(5, 5, { message: "Code must be exactly 5 digits" })
  @Matches(/^\d{5}$/, { message: "Code must contain only digits" })
  code: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  attemptId?: string;
}
