import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { IsString, MaxLength, MinLength } from "class-validator";
import { Request, Response } from "express";
import { InstanceConfigService } from "../user/instance-config.service";
import { ManagementService } from "./management.service";
import { AdminGuard } from "./management.guards";
import { AuthService } from "../auth/auth.service";

class LoginDto {
  @IsString() @MinLength(1) @MaxLength(1024) password: string;
}

@Controller("admin")
export class ManagementController {
  constructor(
    private readonly config: InstanceConfigService,
    private readonly management: ManagementService,
    private readonly auth: AuthService,
  ) {}

  @Get("session")
  session(@Req() request: Request) {
    return {
      authenticated: this.management.isAuthenticated(request),
      protection: this.config.isProtected(),
    };
  }

  @Post("session")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  openSession(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.management.issueSession(request, response);
    return { success: true };
  }

  @Post("login")
  @HttpCode(200)
  login(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (
      !this.config.isManagementInitialized() ||
      !this.config.verifyAdminPassword(body.password)
    )
      throw new UnauthorizedException("Invalid admin password");
    this.management.issueSession(request, response);
    return { success: true };
  }

  @Post("logout")
  @HttpCode(200)
  logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.management.logout(request, response);
    return { success: true };
  }

  @Get("accounts")
  @UseGuards(AdminGuard)
  accounts() {
    return Object.values(this.config.getUsers()).map((u) => ({
      token: u.token,
      name: u.name ?? "",
      phoneLast4: u.phone.replace(/\D/g, "").slice(-4),
      connected: Boolean(u.sessionString),
      language: u.language ?? null,
    }));
  }

  @Delete("accounts/:token")
  @UseGuards(AdminGuard)
  async deleteAccount(@Param("token") token: string) {
    await this.auth.logout(token);
    return { success: true };
  }

  @Get("invitations")
  @UseGuards(AdminGuard)
  invitations() {
    return this.config.getInvitations();
  }

  @Post("invitations")
  @UseGuards(AdminGuard)
  createInvitation() {
    return this.config.createInvitation();
  }

  @Delete("invitations/:id")
  @UseGuards(AdminGuard)
  revokeInvitation(@Param("id") id: string) {
    this.config.revokeInvitation(id);
    return { success: true };
  }
}

@Controller("invitations")
export class InvitationController {
  constructor(private readonly config: InstanceConfigService) {}
  @Get(":secret")
  validate(@Param("secret") secret: string) {
    const record = this.config.validateInvitation(secret);
    return { valid: true, expiresAt: record.expiresAt };
  }
}
