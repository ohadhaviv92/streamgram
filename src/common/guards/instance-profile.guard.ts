import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Request } from "express";
import { UserService } from "../../modules/user/user.service";
import { InstanceProfile } from "../../modules/user/instance-profile";

declare global {
  namespace Express {
    interface Request {
      user: InstanceProfile;
    }
  }
}

/** Attaches the one local instance profile to a Stremio request. */
@Injectable()
export class InstanceProfileGuard implements CanActivate {
  constructor(private readonly userService: UserService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    request.user = this.userService.getProfile();
    return true;
  }
}
