import { ApiProperty } from "@nestjs/swagger";

export class SendCodeResponseDto {
  @ApiProperty({
    example: true,
    description: "Whether code was sent successfully",
  })
  success: boolean;

  @ApiProperty({
    example: "Code sent to your Telegram app",
    description: "Response message",
  })
  message: string;

  @ApiProperty({
    example: "abc123...",
    description: "Phone code hash for verification (only present on success)",
    required: false,
  })
  phoneCodeHash?: string;

  @ApiProperty({
    example: true,
    description:
      "Whether to suggest QR code authentication as alternative (present when phone code fails)",
    required: false,
  })
  suggestQr?: boolean;

  @ApiProperty({
    example: "PHONE_CODE_FLOOD",
    description: "Telegram error code (only present on error)",
    required: false,
  })
  errorCode?: string;
}

export class VerifyCodeResponseDto {
  @ApiProperty({
    example: true,
    description: "Whether verification was successful",
  })
  success: boolean;

  @ApiProperty({
    example: "Authentication successful",
    description: "Response message",
  })
  message: string;

  @ApiProperty({
    example: false,
    description: "Whether 2FA password is required",
    required: false,
  })
  passwordRequired?: boolean;

  @ApiProperty({
    description: "User information (only present on success)",
    required: false,
  })
  user?: {
    id: number;
    phone: string | null;
  };
}
