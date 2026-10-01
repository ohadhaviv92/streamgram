import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { SendCodeDto } from "./dto/send-code.dto";
import { VerifyCodeDto } from "./dto/verify-code.dto";
import {
  SendCodeResponseDto,
  VerifyCodeResponseDto,
} from "./dto/auth-response.dto";
import {
  QrGeneratedResponseDto,
  QrStatusResponseDto,
  QrInstructionsResponseDto,
} from "./dto/qr-auth.dto";

@ApiTags("Authentication")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("send-code")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Send authentication code to phone number" })
  @ApiResponse({
    status: 200,
    description: "Code sent successfully",
    type: SendCodeResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "Invalid phone number or rate limited",
  })
  async sendCode(
    @Body() sendCodeDto: SendCodeDto,
  ): Promise<SendCodeResponseDto> {
    return this.authService.sendCode(sendCodeDto.phone);
  }

  @Post("verify-code")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Verify authentication code" })
  @ApiResponse({
    status: 200,
    description: "Code verified successfully",
    type: VerifyCodeResponseDto,
  })
  @ApiResponse({ status: 400, description: "Invalid code or expired" })
  async verifyCode(
    @Body() verifyCodeDto: VerifyCodeDto,
  ): Promise<VerifyCodeResponseDto> {
    return this.authService.verifyCode(
      verifyCodeDto.phone,
      verifyCodeDto.code,
      verifyCodeDto.password,
    );
  }

  @Post("qr/generate")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Generate QR code for authentication" })
  @ApiResponse({
    status: 200,
    description: "QR code generated successfully",
    type: QrGeneratedResponseDto,
  })
  @ApiResponse({ status: 400, description: "Failed to generate QR code" })
  async generateQrCode(): Promise<QrGeneratedResponseDto> {
    return this.authService.generateQrCode();
  }

  @Get("qr/status/:qrToken")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Check QR code authentication status" })
  @ApiResponse({
    status: 200,
    description: "QR code status retrieved",
    type: QrStatusResponseDto,
  })
  @ApiResponse({ status: 400, description: "Invalid or expired QR token" })
  async checkQrStatus(
    @Param("qrToken") qrToken: string,
  ): Promise<QrStatusResponseDto> {
    return this.authService.checkQrStatus(qrToken);
  }

  @Get("qr/instructions")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Get QR code scanning instructions" })
  @ApiResponse({
    status: 200,
    description: "Instructions retrieved successfully",
    type: QrInstructionsResponseDto,
  })
  async getQrInstructions(): Promise<QrInstructionsResponseDto> {
    return this.authService.getQrInstructions();
  }

  @Delete("logout/:token")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Logout user and delete session" })
  @ApiResponse({ status: 200, description: "Logged out successfully" })
  async logout(@Param("token") token: string): Promise<void> {
    return this.authService.logout(token);
  }
}
