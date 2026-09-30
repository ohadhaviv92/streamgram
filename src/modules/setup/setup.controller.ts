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
    const telegramAuthenticated = Boolean(config.telegram.sessionString);
    let telegramPhoneLast4 = this.phoneLast4(config.phone);

    if (!telegramPhoneLast4 && telegramAuthenticated) {
      try {
        telegramPhoneLast4 = this.phoneLast4(
          await this.telegramService.getTelegramPhone(
            "instance",
            config.telegram.sessionString,
          ),
        );
      } catch {
        // Status should remain available even if Telegram is temporarily unreachable.
        telegramPhoneLast4 = null;
      }
    }

    return {
      setupComplete: this.instanceConfig.isSetupComplete(),
      missing: this.instanceConfig.getMissingFields(),
      publicUrl: config.publicUrl || null,
      apiId: config.telegram.apiId || null,
      apiHashPrefix: this.maskSecret(config.telegram.apiHash),
      preferredLanguage: config.preferredLanguage,
      telegramConfigured: Boolean(config.telegram.apiId && config.telegram.apiHash),
      telegramAuthenticated,
      telegramPhoneLast4,
      tmdbTokenPrefix: this.maskSecret(config.tmdb.bearerToken),
      tmdbConfigured: Boolean(config.tmdb.bearerToken),
    };
  }

  @Post("config")
  @HttpCode(HttpStatus.OK)
  async saveConfig(
    @Body() body: SetupConfigDto,
    @Req() request: Request,
  ) {
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
  async exportConfig(@Res() res: Response): Promise<void> {
    const raw = this.instanceConfig.exportRaw();
    const filename = `tg2stream-config-${Date.now()}.json`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/json");
    res.send(raw);
  }

  @Post("config/import")
  @HttpCode(HttpStatus.OK)
  async importConfig(
    @Body() body: ImportConfigDto,
  ): Promise<{ success: boolean; message: string }> {
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

  private phoneLast4(phone: string | null | undefined): string | null {
    const digits = String(phone || "").replace(/\D/g, "");
    return digits.length >= 4 ? digits.slice(-4) : null;
  }

}
