import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { InstanceConfigService } from "../../modules/user/instance-config.service";
import { InstanceProfile } from "../../modules/user/instance-profile";

declare global {
  // Express request augmentation requires a namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user: InstanceProfile;
    }
  }
}

/**
 * Validates the `:userToken` route parameter against the persisted users map
 * and attaches the matching InstanceProfile to `req.user`.
 *
 * Returns 401 when the token is missing or unknown.
 */
@Injectable()
export class InstanceProfileGuard implements CanActivate {
  constructor(private readonly instanceConfig: InstanceConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const userToken = request.params?.userToken as string | undefined;

    if (!userToken) {
      throw new UnauthorizedException("Missing user token");
    }

    const entry = this.instanceConfig.getUserByToken(userToken);
    if (!entry) {
      throw new UnauthorizedException("Invalid user token");
    }

    request.user = this.instanceConfig.getProfile(userToken);
    return true;
  }
}
