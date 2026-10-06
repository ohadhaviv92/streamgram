import { IsString, IsNotEmpty, Matches } from "class-validator";
import { Transform } from "class-transformer";

export class SendCodeDto {
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string"
      ? value
          .trim()
          .replace(/[\s().-]/g, "")
          .replace(/^00/, "+")
      : value,
  )
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message: "Enter your phone number with its country code, starting with +.",
  })
  phone: string;
}
