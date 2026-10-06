import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Request, Response } from "express";
import { createHash, randomBytes } from "crypto";
import { InstanceConfigService } from "../user/instance-config.service";
import { AuthOwner } from "../user/instance-profile";

const COOKIE = "streamgram_admin";
const SESSION_MS = 8 * 60 * 60 * 1000;

@Injectable()
export class ManagementService {
  private sessions = new Map<string, { expires: number; revision: number }>();
  constructor(private readonly config: InstanceConfigService) {}

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
    return (
      Boolean(this.session(request)) ||
      this.config.verifyAdminPassword(request.get("x-admin-password"))
    );
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
    if (password && this.config.verifyAdminPassword(password))
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
