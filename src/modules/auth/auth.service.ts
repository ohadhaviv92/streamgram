import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes } from "crypto";
import * as QRCode from "qrcode";
import {
  TelegramNestService,
  PasswordRequiredError,
} from "../telegram/telegram.service";
import { TelegramClientManager } from "../telegram/telegram-client.manager";
import { InstanceConfigService } from "../user/instance-config.service";
import { AuthOwner } from "../user/instance-profile";
import { ManagementService } from "../management/management.service";

interface Attempt {
  owner: AuthOwner;
  revision: number;
  created: number;
  expires: number;
  session: string;
  phone?: string;
  hash?: string;
  qr?: Buffer;
  busy?: boolean;
  passwordRequired?: boolean;
}
@Injectable()
export class AuthService {
  private attempts = new Map<string, Attempt>();
  private deletedIdentities = new Map<string, number>();
  private sequence = 0;
  constructor(
    private readonly telegram: TelegramNestService,
    private readonly clients: TelegramClientManager,
    private readonly config: InstanceConfigService,
    private readonly management: ManagementService,
  ) {}

  async logout(token: string): Promise<void> {
    const user = this.config.getUserByToken(token);
    if (!user) throw new UnauthorizedException("Invalid user token");
    this.deletedIdentities.set(
      user.telegramId ?? `+${user.phone.replace(/\D/g, "")}`,
      ++this.sequence,
    );
    this.config.deleteUser(token);
    for (const [id, a] of this.attempts) {
      if (
        (a.owner.kind === "user" && a.owner.id === token) ||
        a.phone === user.phone
      )
        this.attempts.delete(id);
    }
    await this.clients.removeClient(token);
  }

  private newAttempt(owner: AuthOwner, data: Partial<Attempt>, ttl = 300_000) {
    for (const [id, a] of this.attempts)
      if (
        a.expires <= Date.now() ||
        a.revision !== this.config.securityRevision
      )
        this.attempts.delete(id);
    const id = randomBytes(24).toString("base64url");
    this.attempts.set(id, {
      owner,
      revision: this.config.securityRevision,
      created: ++this.sequence,
      expires: Date.now() + ttl,
      session: "",
      ...data,
    });
    return id;
  }

  private attempt(id: string, owner: AuthOwner): Attempt {
    const a = this.attempts.get(id);
    if (
      !a ||
      a.expires <= Date.now() ||
      a.revision !== this.config.securityRevision
    )
      throw new BadRequestException("Authentication expired. Start again.");
    if (a.owner.kind !== owner.kind || a.owner.id !== owner.id)
      throw new ForbiddenException("Authentication belongs to another session");
    this.management.validateOwner(owner);
    return a;
  }

  async sendCode(phone: string, owner: AuthOwner) {
    const normalized = `+${phone.replace(/\D/g, "")}`;
    const result = await this.telegram.sendAuthCode(normalized);
    const attemptId = this.newAttempt(owner, {
      phone: normalized,
      hash: result.phoneCodeHash,
      session: result.tempSessionString,
    });
    return {
      success: true,
      attemptId,
      message: result.isCodeViaApp
        ? "Code sent to your Telegram app"
        : "Code sent via SMS",
    };
  }

  async verifyCode(
    phone: string,
    code: string,
    owner: AuthOwner,
    password?: string,
    attemptId?: string,
  ) {
    const normalized = `+${phone.replace(/\D/g, "")}`;
    // Retain old phone+code clients, but lookup is scoped to the originating principal.
    const id =
      attemptId ??
      [...this.attempts]
        .reverse()
        .find(
          ([, a]) =>
            a.phone === normalized &&
            a.owner.kind === owner.kind &&
            a.owner.id === owner.id,
        )?.[0] ??
      "";
    const a = this.attempt(id, owner);
    if (a.phone !== normalized || !a.hash)
      throw new BadRequestException("Authentication phone mismatch");
    if (a.busy)
      throw new BadRequestException("Authentication is already in progress");
    a.busy = true;
    try {
      const session = await this.telegram.verifyAuthCode(
        normalized,
        code,
        a.hash,
        a.session,
        password,
        a.passwordRequired === true,
      );
      return {
        success: true,
        message: "Connected to Telegram",
        user: await this.complete(id, owner, session),
      };
    } catch (error) {
      if (error instanceof PasswordRequiredError) {
        if (error.sessionString) a.session = error.sessionString;
        if (!a.passwordRequired) a.expires = Date.now() + 300_000;
        a.passwordRequired = true;
        return {
          success: false,
          passwordRequired: true,
          message: error.message,
        };
      }
      throw error instanceof ForbiddenException ||
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException
        ? error
        : new BadRequestException(
            "Code or password could not be verified. Try again.",
          );
    } finally {
      a.busy = false;
    }
  }

  async generateQrCode(owner: AuthOwner) {
    const result = await this.telegram.exportLoginToken();
    const expiresIn = Math.max(
      1,
      Math.min(60, result.expires - Math.floor(Date.now() / 1000)),
    );
    const qrToken = this.newAttempt(
      owner,
      { session: result.tempSessionString, qr: result.token },
      expiresIn * 1000,
    );
    const qrCodeData = `tg://login?token=${result.token.toString("base64url")}`;
    return {
      success: true,
      message: "Scan with Telegram",
      qrToken,
      qrCodeData,
      expiresIn,
      qrCodeImage: await QRCode.toDataURL(qrCodeData, {
        width: 300,
        margin: 2,
      }),
    };
  }

  async checkQrStatus(id: string, owner: AuthOwner, password?: string) {
    const a = this.attempt(id, owner);
    if (!a.qr) throw new BadRequestException("Invalid QR attempt");
    if (a.busy)
      return { status: "pending" as const, message: "Checking Telegram" };
    a.busy = true;
    try {
      const session = await this.telegram.checkLoginToken(
        a.qr,
        a.session,
        password,
      );
      if (!session)
        return { status: "pending" as const, message: "Waiting for Telegram" };
      return {
        status: "authorized" as const,
        message: "Connected to Telegram",
        user: await this.complete(id, owner, session),
      };
    } catch (error) {
      if (error instanceof PasswordRequiredError) {
        if (error.sessionString) a.session = error.sessionString;
        a.expires = Date.now() + 300_000;
        return {
          status: "scanned" as const,
          passwordRequired: true,
          message: error.message,
        };
      }
      throw error instanceof ForbiddenException ||
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException
        ? error
        : new BadRequestException(
            "QR authentication failed. Retry or use a phone code.",
          );
    } finally {
      a.busy = false;
    }
  }

  private async complete(id: string, owner: AuthOwner, session: string) {
    const temporaryKey = `auth:${id}`;
    try {
      const client = await this.clients.getOrInitializeClient(
        temporaryKey,
        session,
      );
      const me = await client.getMe();
      if (!me || !("phone" in me) || !me.phone)
        throw new BadRequestException("Telegram identity unavailable");
      const phone = `+${me.phone.replace(/\D/g, "")}`;
      const telegramId = me.id.toString();
      const a = this.attempt(id, owner); // Recheck expiry, deletion, restore, logout after Telegram I/O.
      if (
        (this.deletedIdentities.get(telegramId) ??
          this.deletedIdentities.get(phone) ??
          0) >= a.created
      )
        throw new ForbiddenException(
          "Account was deleted during authentication. Start again.",
        );
      const entry = this.config.completeAuthentication(
        owner,
        phone,
        telegramId,
        session,
        [me.firstName, me.lastName].filter(Boolean).join(" ").trim() ||
          me.username,
      );
      this.attempts.delete(id);
      await this.clients.removeClient(entry.token);
      return { id: 1, phone: null, token: entry.token };
    } finally {
      await this.clients.removeClient(temporaryKey);
    }
  }

  getQrInstructions() {
    return {
      title: "Connect Telegram",
      steps: [
        "Open Telegram → Settings → Devices → Link Desktop Device",
        "Scan this QR code",
      ],
      notes: ["Use your own Telegram account"],
      troubleshooting: ["Try phone code if the QR code expires"],
    };
  }
}
