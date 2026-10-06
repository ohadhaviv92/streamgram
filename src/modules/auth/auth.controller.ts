import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  ForbiddenException,
} from "@nestjs/common";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { Request } from "express";
import { AuthService } from "./auth.service";
import { ManagementService } from "../management/management.service";
import { SendCodeDto } from "./dto/send-code.dto";
import { VerifyCodeDto } from "./dto/verify-code.dto";
class QrPasswordDto {
  @IsOptional() @IsString() @MaxLength(1024) password?: string;
}
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly management: ManagementService,
  ) {}
  @Post("send-code")
  @HttpCode(200)
  sendCode(@Body() body: SendCodeDto, @Req() request: Request) {
    return this.auth.sendCode(body.phone, this.management.authOwner(request));
  }
  @Post("verify-code")
  @HttpCode(200)
  verifyCode(@Body() body: VerifyCodeDto, @Req() request: Request) {
    return this.auth.verifyCode(
      body.phone,
      body.code,
      this.management.authOwner(request),
      body.password,
      body.attemptId,
    );
  }
  @Post("qr/generate")
  @HttpCode(200)
  generateQr(@Req() request: Request) {
    return this.auth.generateQrCode(this.management.authOwner(request));
  }
  @Get("qr/status/:qrToken")
  qrStatus(@Param("qrToken") id: string, @Req() request: Request) {
    return this.auth.checkQrStatus(id, this.management.authOwner(request));
  }
  @Post("qr/status/:qrToken")
  @HttpCode(200)
  qrPassword(
    @Param("qrToken") id: string,
    @Body() body: QrPasswordDto,
    @Req() request: Request,
  ) {
    return this.auth.checkQrStatus(
      id,
      this.management.authOwner(request),
      body.password,
    );
  }
  @Get("qr/instructions")
  instructions() {
    return this.auth.getQrInstructions();
  }
  @Delete("logout/:token")
  async logout(@Param("token") token: string, @Req() request: Request) {
    if (request.get("authorization") || request.query.token !== undefined) {
      if (this.management.personalToken(request) !== token)
        throw new ForbiddenException("Account mismatch");
    } else {
      // Legacy deletion URLs are themselves explicit private account links.
      request.query.token = token;
      this.management.personalToken(request);
    }
    await this.auth.logout(token);
    return { success: true };
  }
}
