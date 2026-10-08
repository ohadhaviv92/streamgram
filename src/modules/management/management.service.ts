import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Request, Response } from "express";
import { createHash, randomBytes } from "crypto";
import { InstanceConfigService } from "../user/instance-config.service";
import { AuthOwner } from "../user/instance-profile";

const COOKIE = "streamgram_admin";
const SESSION_MS = 8 * 60 * 60 * 1000;
const PASSWORD_WINDOW_MS = 15 * 60 * 1000;
const MAX_PASSWORD_FAILURES = 5;

@Injectable()
export class ManagementService {
  private sessions = new Map<string, { expires: number; revision: number }>();
  private passwordFailures = new Map<string, { count: number; expires: number }>();
  constructor(private readonly config: InstanceConfigService) {}

  verifyAdminPassword(request: Request, password: string): boolean {
    const now = Date.now();
    for (const [ip, failure] of this.passwordFailures) {
      if (failure.expires <= now) this.passwordFailures.delete(ip);
    }
    // Express only honors forwarded addresses from explicitly trusted proxies.
    const ip = request.ip || request.socket.remoteAddress || "unknown";
    let failure = this.passwordFailures.get(ip);
    const rejectBlocked = (expires: number) => {
      const retryAfter = Math.ceil((expires - now) / 1000);
      request.res?.setHeader("Retry-After", String(retryAfter));
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: "Too many failed admin password attempts. Try again later.",
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    };
    if (failure && failure.count >= MAX_PASSWORD_FAILURES) rejectBlocked(failure.expires);
    if (this.config.verifyAdminPassword(password)) {
      this.passwordFailures.delete(ip);
      return true;
    }
    failure = {
      count: (failure?.count ?? 0) + 1,
      expires: failure?.expires ?? now + PASSWORD_WINDOW_MS,
    };
    if (failure.count >= MAX_PASSWORD_FAILURES) failure.expires = now + PASSWORD_WINDOW_MS;
    this.passwordFailures.set(ip, failure);
    if (failure.count >= MAX_PASSWORD_FAILURES) rejectBlocked(failure.expires);
    return false;
  }

  private cookie(request: Request): string | undefined {
    return request.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
  }

  private session(request: Request): string | undefined {
    const id = this.cookie(request);
    for (const [key, value] of this.sessions) {
      if (
        value.expires <= Date.now() ||
        value.revision !== this.config.securityRevision
      )
        this.sessions.delete(key);
    }
    return id && this.sessions.has(id) ? id : undefined;
  }

  issueSession(request: Request, response: Response): string {
    const old = this.cookie(request);
    if (old) this.sessions.delete(old);
    const id = randomBytes(32).toString("base64url");
    this.sessions.set(id, {
      expires: Date.now() + SESSION_MS,
      revision: this.config.securityRevision,
    });
    response.cookie(COOKIE, id, {
      httpOnly: true,
      sameSite: "strict",
      secure: this.isHttps(request),
      path: "/",
      maxAge: SESSION_MS,
    });
    return id;
  }

  logout(request: Request, response: Response) {
    const id = this.cookie(request);
    if (id) this.sessions.delete(id);
    response.clearCookie(COOKIE, {
      httpOnly: true,
      sameSite: "strict",
      secure: this.isHttps(request),
      path: "/",
    });
  }

  private isHttps(request: Request) {
    return (
      request.secure ||
      request.get("x-forwarded-proto")?.split(",")[0].trim() === "https"
    );
  }

  isAuthenticated(request: Request): boolean {
    if (!this.config.isManagementInitialized()) return false;
    if (!this.config.isProtected()) return true;
    if (this.session(request)) return true;
    const password = request.get("x-admin-password");
    return password !== undefined && this.verifyAdminPassword(request, password);
  }

  requireAdmin(request: Request) {
    if (!this.isAuthenticated(request))
      throw new UnauthorizedException("Admin login required");
  }

  personalToken(request: Request): string {
    const authorization = request.get("authorization");
    const token = authorization
      ? /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization)?.[1]
      : request.query.token;
    if (typeof token !== "string" || !this.config.getUserByToken(token))
      throw new UnauthorizedException("Missing or invalid user token");
    return token;
  }

  authOwner(request: Request): AuthOwner {
    // Explicit personal/invitation context always wins over an admin cookie.
    if (request.get("authorization") || request.query.token !== undefined)
      return { kind: "user", id: this.personalToken(request) };
    const invitation = request.get("x-invitation-token");
    if (invitation)
      return {
        kind: "invitation",
        id: this.config.validateInvitation(invitation).id,
      };
    this.requireAdmin(request);
    const session = this.session(request);
    if (session) return { kind: "admin", id: session };
    const password = request.get("x-admin-password");
    if (password && this.verifyAdminPassword(request, password))
      return {
        kind: "admin",
        id: `legacy:${this.config.securityRevision}:${createHash("sha256").update(password).digest("hex")}`,
      };
    throw new UnauthorizedException(
      "Open an admin session before connecting Telegram",
    );
  }

  validateOwner(owner: AuthOwner) {
    if (owner.kind === "user" && !this.config.getUserByToken(owner.id))
      throw new UnauthorizedException("Account was deleted");
    if (owner.kind === "admin") {
      if (owner.id.startsWith("legacy:")) {
        if (!owner.id.startsWith(`legacy:${this.config.securityRevision}:`))
          throw new UnauthorizedException("Admin session expired");
      } else {
        const session = this.sessions.get(owner.id);
        if (
          !session ||
          session.expires <= Date.now() ||
          session.revision !== this.config.securityRevision
        )
          throw new UnauthorizedException("Admin session expired");
      }
    }
  }

  assertSameOrigin(request: Request) {
    const origin = request.get("origin");
    if (request.get("sec-fetch-site") === "cross-site")
      throw new ForbiddenException("Cross-origin management request rejected");
    if (!origin) return; // CLI clients using the legacy password header have no Origin.
    const protocol =
      request.get("x-forwarded-proto")?.split(",")[0].trim() ||
      request.protocol;
    const allowed = new Set([`${protocol}://${request.get("host")}`]);
    const publicUrl = this.config.getConfig().publicUrl;
    if (publicUrl) {
      try {
        allowed.add(new URL(publicUrl).origin);
      } catch {
        /* validated on save */
      }
    }
    if (!allowed.has(origin))
      throw new ForbiddenException("Cross-origin management request rejected");
  }
}
