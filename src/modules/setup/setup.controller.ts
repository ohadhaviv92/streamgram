import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  BadRequestException,
  Headers,
  UnauthorizedException,
} from "@nestjs/common";
import { Request, Response } from "express";
import { InstanceConfigService } from "../user/instance-config.service";
import { TelegramNestService } from "../telegram/telegram.service";
import { SetupConfigDto } from "./dto/setup-config.dto";
import { ImportConfigDto } from "./dto/import-config.dto";

@Controller("setup")
export class SetupController {
  constructor(
    private readonly instanceConfig: InstanceConfigService,
    private readonly telegramService: TelegramNestService,
  ) {}

  @Get("status")
  async getStatus() {
    const config = this.instanceConfig.getConfig();
    const users = Object.values(this.instanceConfig.getUsers());
    const telegramAuthenticated = users.some((u) => Boolean(u.sessionString));

    let telegramPhoneLast4: string | null = null;
    if (!telegramPhoneLast4 && telegramAuthenticated && users[0]) {
      telegramPhoneLast4 = this.phoneLast4(users[0].phone);
      if (!telegramPhoneLast4) {
        try {
          telegramPhoneLast4 = this.phoneLast4(
            await this.telegramService.getTelegramPhone(
              users[0].token,
              users[0].sessionString,
            ),
          );
        } catch {
          // Status should remain available even if Telegram is temporarily unreachable.
          telegramPhoneLast4 = null;
        }
      }
    }

    return {
      setupComplete: this.instanceConfig.isSetupComplete(),
      missing: this.instanceConfig.getMissingFields(),
      passwordRequired: !this.instanceConfig.verifyAdminPassword(""), // True if a password is set
      publicUrl: config.publicUrl || null,
      apiIdPrefix: this.maskApiId(config.telegram.apiId),
      apiHashPrefix: this.maskSecret(config.telegram.apiHash),
      preferredLanguage: config.preferredLanguage,
      telegramConfigured: Boolean(config.telegram.apiId && config.telegram.apiHash),
      telegramAuthenticated,
      telegramPhoneLast4,
      userToken: users[0]?.token || null,
      userName: users[0]?.name || null,
      users: users.map((u) => ({
        token: u.token,
        name: u.name || null,
        phoneLast4: this.phoneLast4(u.phone),
      })),
      tmdbTokenPrefix: this.maskSecret(config.tmdb.bearerToken),
      tmdbConfigured: Boolean(config.tmdb.bearerToken),
    };
  }

  @Post("verify-password")
  @HttpCode(HttpStatus.OK)
  async verifyPassword(@Headers("x-admin-password") adminPassword?: string) {
    if (!this.instanceConfig.verifyAdminPassword(adminPassword)) {
      throw new UnauthorizedException("Invalid or missing admin password");
    }
    return { success: true };
  }

  @Post("config")
  @HttpCode(HttpStatus.OK)
  async saveConfig(
    @Body() body: SetupConfigDto,
    @Req() request: Request,
    @Headers("x-admin-password") adminPassword?: string,
  ) {
    if (!this.instanceConfig.verifyAdminPassword(adminPassword)) {
      throw new UnauthorizedException("Invalid or missing admin password");
    }

    const publicUrl = body.publicUrl || this.detectPublicUrl(request);
    if (publicUrl) {
      let parsed: URL;
      try {
        parsed = new URL(publicUrl);
      } catch {
        throw new BadRequestException("Public URL must be a valid URL");
      }
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new BadRequestException("Public URL must use HTTP or HTTPS");
      }
      body.publicUrl = parsed.toString().replace(/\/$/, "");
    }

    await this.instanceConfig.update(body);
    return {
      success: true,
      setupComplete: this.instanceConfig.isSetupComplete(),
      missing: this.instanceConfig.getMissingFields(),
      message: "Configuration saved successfully",
    };
  }


  @Get("config/export")
  async exportConfig(
    @Res() res: Response,
    @Headers("x-admin-password") adminPassword?: string,
  ): Promise<void> {
    if (!this.instanceConfig.verifyAdminPassword(adminPassword)) {
      throw new UnauthorizedException("Invalid or missing admin password");
    }
    const raw = this.instanceConfig.exportRaw();
    const filename = `streamgram-config-${Date.now()}.json`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/json");
    res.send(raw);
  }

  @Post("config/import")
  @HttpCode(HttpStatus.OK)
  async importConfig(
    @Body() body: ImportConfigDto,
    @Headers("x-admin-password") adminPassword?: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!this.instanceConfig.verifyAdminPassword(adminPassword)) {
      throw new UnauthorizedException("Invalid or missing admin password");
    }
    await this.instanceConfig.importRaw(body);
    return {
      success: true,
      message: "Configuration imported successfully.",
    };
  }

  private detectPublicUrl(request: Request): string | undefined {
    const host = request.headers.host;
    if (!host || host.startsWith("0.0.0.0") || host.startsWith("localhost")) {
      return undefined;
    }

    const forwardedProto = request.headers["x-forwarded-proto"];
    const protocol =
      typeof forwardedProto === "string"
        ? forwardedProto.split(",")[0]
        : request.protocol;
    return `${protocol}://${host}`;
  }

  private maskSecret(secret: string): string | null {
    const value = secret.trim();
    return value ? `${value.slice(0, 4)}****` : null;
  }

  private maskApiId(apiId: number | null | undefined): string | null {
    if (!apiId) return null;
    const str = String(apiId);
    return str.length > 3 ? `***${str.slice(-5)}` : `***`;
  }

  private phoneLast4(phone: string | null | undefined): string | null {
    const digits = String(phone || "").replace(/\D/g, "");
    return digits.length >= 4 ? digits.slice(-4) : null;
  }

}
