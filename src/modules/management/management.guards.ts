import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Request } from "express";
import { ManagementService } from "./management.service";
import { InstanceConfigService } from "../user/instance-config.service";

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly management: ManagementService) {}
  canActivate(context: ExecutionContext) {
    this.management.requireAdmin(context.switchToHttp().getRequest());
    return true;
  }
}

@Injectable()
export class PersonalGuard implements CanActivate {
  constructor(
    private readonly management: ManagementService,
    private readonly config: InstanceConfigService,
  ) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    request.user = this.config.getProfile(
      this.management.personalToken(request),
    );
    return true;
  }
}

@Injectable()
export class ManagementOriginGuard implements CanActivate {
  constructor(private readonly management: ManagementService) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    // Stremio's token-prefixed GET/HEAD/OPTIONS streaming remains cross-origin.
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) ||
      request.path.startsWith("/auth/qr/status/")
    )
      this.management.assertSameOrigin(request);
    return true;
  }
}
