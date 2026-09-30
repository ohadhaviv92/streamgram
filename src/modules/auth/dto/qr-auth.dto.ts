import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

/**
 * Response DTO for QR code generation
 */
export class QrGeneratedResponseDto {
  @ApiProperty({
    example: true,
    description: "Whether QR code was generated successfully",
  })
  success: boolean;

  @ApiProperty({
    example: "QR code generated successfully",
    description: "Response message",
  })
  message: string;

  @ApiProperty({
    example: "550e8400-e29b-41d4-a716-446655440000",
    description: "Unique token to track QR code status",
  })
  qrToken: string;

  @ApiProperty({
    example: "tg://login?token=base64encodedtoken...",
    description: "QR code data URL for scanning with Telegram app",
  })
  qrCodeData: string;

  @ApiProperty({
    example: "data:image/png;base64,iVBORw0KGgoAAAANS...",
    description: "Base64-encoded QR code image (data URL)",
  })
  qrCodeImage: string;

  @ApiProperty({
    example: 90,
    description: "Time in seconds until QR code expires",
  })
  expiresIn: number;
}

/**
 * Response DTO for QR code status check
 */
export class QrStatusResponseDto {
  @ApiProperty({
    enum: ["pending", "scanned", "authorized", "expired"],
    description: "Current status of the QR code",
  })
  status: "pending" | "scanned" | "authorized" | "expired";

  @ApiProperty({
    example: "QR code is waiting to be scanned",
    description: "Status message",
  })
  message: string;

  @ApiProperty({
    description: "User information (only present when status is 'authorized')",
    required: false,
  })
  user?: {
    id: number;
    phone: string | null;
  };
}

/**
 * Response DTO for QR code instructions
 */
export class QrInstructionsResponseDto {
  @ApiProperty({
    example: "How to Scan QR Code for Telegram Authentication",
    description: "Instruction title",
  })
  title: string;

  @ApiProperty({
    example: [
      "Open Telegram app on your phone",
      "Go to Settings > Devices > Link Desktop Device",
      "Scan the QR code",
    ],
    description: "Step-by-step instructions",
    type: [String],
  })
  steps: string[];

  @ApiProperty({
    example: [
      "Make sure you're logged into Telegram on your phone",
      "QR code expires after 90 seconds",
      "If code expires, request a new one",
    ],
    description: "Important notes",
    type: [String],
  })
  notes: string[];

  @ApiProperty({
    example: [
      "If QR code doesn't work, try the phone code authentication method",
      "Ensure your Telegram app is up to date",
    ],
    description: "Troubleshooting tips",
    type: [String],
  })
  troubleshooting: string[];
}
