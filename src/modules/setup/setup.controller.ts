import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import { ConfigurationChecksService } from "./configuration-checks.service";
import { ConfigurationChecksResponseDto } from "./dto/configuration-checks-response.dto";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  ForbiddenException,
  UseGuards,
} from "@nestjs/common";
import { Request, Response } from "express";
import { InstanceConfigService } from "../user/instance-config.service";
import { SetupConfigDto } from "./dto/setup-config.dto";
import { ImportConfigDto } from "./dto/import-config.dto";
import { AdminGuard } from "../management/management.guards";
import { ManagementService } from "../management/management.service";
import { TelegramClientManager } from "../telegram/telegram-client.manager";

@Controller("setup")
export class SetupController {
  constructor(
    private readonly instanceConfig: InstanceConfigService,
    private readonly management: ManagementService,
    private readonly clients: TelegramClientManager,
    private readonly checks: ConfigurationChecksService,
  ) {}

  @Post("checks")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Check saved instance credentials and streaming HTTPS" })
  @ApiResponse({ status: 200, type: ConfigurationChecksResponseDto })
  checkConfiguration() {
    return this.checks.check();
  }

  @Get("probe")
  @ApiOperation({ summary: "Identify this process for the streaming HTTPS check" })
  probe(@Res({ passthrough: true }) response: Response) {
    response.setHeader("Cache-Control", "no-store");
    return this.checks.probe();
  }

  @Get("status")
  getStatus() {
    return {
      managementInitialized: this.instanceConfig.isManagementInitialized(),
      passwordRequired: this.instanceConfig.isProtected(),
    };
  }

  @Get("bootstrap")
  bootstrap() {
    if (this.instanceConfig.isManagementInitialized())
      throw new ForbiddenException("Management is already initialized");
    return { adminProtection: true };
  }

  @Post("initialize")
  @HttpCode(200)
  async initialize(
    @Body() body: SetupConfigDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.instanceConfig.initialize(body);
    this.management.issueSession(request, response);
    return { success: true };
  }

  @Get("admin-status")
  @UseGuards(AdminGuard)
  configuration() {
    const config = this.instanceConfig.getConfig();
    return {
      publicUrl: config.publicUrl,
      apiIdConfigured: Boolean(config.telegram.apiId),
      apiIdPreview: this.credentialPreview(
        config.telegram.apiId ? String(config.telegram.apiId) : "",
      ),
      apiHashConfigured: Boolean(config.telegram.apiHash),
      apiHashPreview: this.credentialPreview(config.telegram.apiHash),
      tmdbConfigured: Boolean(config.tmdb.bearerToken),
      tmdbTokenPreview: this.credentialPreview(config.tmdb.bearerToken, 70),
      preferredLanguage: config.preferredLanguage,
      adminProtection: this.instanceConfig.isProtected(),
      adminPasswordConfigured: this.instanceConfig.hasAdminPassword(),
      setupComplete: this.instanceConfig.isSetupComplete(),
      missing: this.instanceConfig.getMissingFields(),
    };
  }

  private credentialPreview(secret: string, maxMaskLength = Infinity): string {
    if (!secret) return "";
    const maskLength = Math.min(maxMaskLength, Math.max(0, secret.length - 3));
    return `${"*".repeat(maskLength)}${secret.slice(-3)}`;
  }

  @Post("verify-password")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  verifyPassword() {
    return { success: true };
  }

  @Post("config")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  async saveConfig(
    @Body() body: SetupConfigDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.instanceConfig.update(body);
    // Password/protection changes revoke other sessions; keep the initiating admin signed in.
    if (body.adminPassword?.trim() || body.adminProtection !== undefined)
      this.management.issueSession(request, response);
    return { success: true };
  }

  @Get("config/export")
  @UseGuards(AdminGuard)
  exportConfig(@Res() response: Response) {
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="streamgram-config-${Date.now()}.json"`,
    );
    response.type("application/json").send(this.instanceConfig.exportRaw());
  }

  @Post("config/import")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  async importConfig(
    @Body() body: ImportConfigDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.instanceConfig.importRaw(body);
    await this.clients.disconnectAll();
    this.management.logout(request, response);
    return { success: true, message: "Backup restored. Sign in again." };
  }
}
