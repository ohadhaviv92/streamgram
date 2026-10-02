import { Injectable, BadRequestException } from "@nestjs/common";
import {
  TelegramNestService,
  PasswordRequiredError,
} from "../telegram/telegram.service";
import { UserService } from "../user/user.service";
import { CacheService } from "../cache/cache.service";
import { TelegramClientManager } from "../telegram/telegram-client.manager";
import { logger } from "../../logger";
import * as QRCode from "qrcode";

@Injectable()
export class AuthService {
  constructor(
    private readonly telegramService: TelegramNestService,
    private readonly userService: UserService,
    private readonly cacheService: CacheService,
    private readonly clientManager: TelegramClientManager,
  ) {}

  /**
   * Normalize phone number to ensure it starts with +
   * Telegram API may return phone numbers with or without the + prefix
   */
  
  async logout(token: string): Promise<void> {
    await this.clientManager.removeClient(token);
    await this.userService.deleteUser(token);
  }

  private normalizePhoneNumber(phone: string): string {
    if (!phone) return phone;
    // Remove any whitespace
    const cleaned = phone.trim();
    // Add + prefix if not present
    return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
  }

  async sendCode(phone: string): Promise<{
    success: boolean;
    message: string;
    phoneCodeHash?: string;
    suggestQr?: boolean;
    errorCode?: string;
  }> {
    // Normalize phone number for consistency
    const normalizedPhone = this.normalizePhoneNumber(phone);

    try {
      const result = await this.telegramService.sendAuthCode(normalizedPhone);

      // Store BOTH phoneCodeHash and tempSessionString in cache for 5 minutes
      // The tempSessionString is required to verify the code later
      await this.cacheService.set(
        `auth:data:${normalizedPhone}`,
        {
          phoneCodeHash: result.phoneCodeHash,
          tempSessionString: result.tempSessionString,
        },
        300,
      );

      logger.info(
        { phone: normalizedPhone },
        "Authentication code sent successfully",
      );

      return {
        success: true,
        message: result.isCodeViaApp
          ? "Code sent to your Telegram app"
          : "Code sent via SMS",
        phoneCodeHash: result.phoneCodeHash,
      };
    } catch (error: any) {
      // Check for Telegram rate limit errors
      const errorMessage = error?.errorMessage || "";
      const isRateLimited =
        errorMessage.includes("PHONE_CODE_FLOOD") ||
        errorMessage.includes("FLOOD_WAIT") ||
        errorMessage.includes("PHONE_NUMBER_FLOOD");

      if (isRateLimited) {
        logger.warn(
          { error, phone: normalizedPhone, errorMessage },
          "Phone code rate limited - suggesting QR auth",
        );

        // Extract wait time if available (e.g., FLOOD_WAIT_60 means wait 60 seconds)
        const waitTimeMatch = errorMessage.match(/FLOOD_WAIT_(\d+)/);
        const waitTime = waitTimeMatch ? parseInt(waitTimeMatch[1]) : null;

        let message =
          "Too many code requests. Please try QR code authentication instead.";
        if (waitTime) {
          const minutes = Math.ceil(waitTime / 60);
          message = `Rate limited. Please wait ${minutes} minute(s) or try QR code authentication instead.`;
        }

        return {
          success: false,
          message,
          suggestQr: true,
          errorCode: errorMessage,
        };
      }

      logger.error(
        { error, phone: normalizedPhone },
        "Failed to send authentication code",
      );

      // For other errors, also suggest QR as alternative
      return {
        success: false,
        message:
          "Failed to send code. Please check the phone number or try QR code authentication.",
        suggestQr: true,
      };
    }
  }

  async verifyCode(
    phone: string,
    code: string,
    password?: string,
  ): Promise<{
    success: boolean;
    message: string;
    passwordRequired?: boolean;
    user?: {
      id: number;
      phone: string | null;
      token: string;
    };
  }> {
    // Normalize phone number for consistency
    const normalizedPhone = this.normalizePhoneNumber(phone);

    try {
      // Get both phoneCodeHash and tempSessionString from cache
      const authData = await this.cacheService.get<{
        phoneCodeHash: string;
        tempSessionString: string;
      }>(`auth:data:${normalizedPhone}`);

      if (!authData || !authData.phoneCodeHash || !authData.tempSessionString) {
        throw new BadRequestException(
          "Code expired or not found. Please request a new code.",
        );
      }

      // Verify the code with Telegram using the saved session (and optional password)
      const sessionString = await this.telegramService.verifyAuthCode(
        normalizedPhone,
        code,
        authData.phoneCodeHash,
        authData.tempSessionString,
        password,
      );

      // Check if user already exists
      let userProfile = await this.userService.findByPhone(normalizedPhone);

      let userToken: string;
      if (userProfile) {
        // Update existing user's session
        userProfile = await this.userService.update(userProfile.token, {
          session_string: sessionString,
        });
        userToken = userProfile.token;
        logger.info(
          { phone: normalizedPhone, token: userToken },
          "Updated existing user",
        );
      } else {
        // Create new user – returns the full UserEntry with token
        const entry = await this.userService.create(normalizedPhone, sessionString);
        userToken = entry.token;
        userProfile = await this.userService.findByPhone(normalizedPhone) as NonNullable<typeof userProfile>;
        logger.info(
          { phone: normalizedPhone, token: userToken },
          "Created new user",
        );
      }

      // Clear the auth data from cache
      await this.cacheService.del(`auth:data:${normalizedPhone}`);

      return {
        success: true,
        message: "Authentication successful",
        user: {
          id: userProfile.id,
          phone: userProfile.phone,
          token: userToken,
        },
      };
    } catch (error) {
      // Handle 2FA password required
      if (error instanceof PasswordRequiredError) {
        logger.info(
          { phone: normalizedPhone },
          "Two-factor authentication password required",
        );
        // Don't clear cache - allow retry with password
        return {
          success: false,
          message: error.message,
          passwordRequired: true,
        };
      }

      logger.error(
        { error, phone: normalizedPhone },
        "Failed to verify authentication code",
      );

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        "Invalid code. Please check and try again.",
      );
    }
  }

  /**
   * Generate QR code for authentication
   * Creates a login token and caches the temporary session for status checking
   */
  async generateQrCode(): Promise<{
    success: boolean;
    message: string;
    qrToken: string;
    qrCodeData: string;
    qrCodeImage: string;
    expiresIn: number;
  }> {
    try {
      const result = await this.telegramService.exportLoginToken();

      // Generate a unique token to track this QR code session
      const { v4: uuidv4 } = await import("uuid");
      const qrToken = uuidv4();

      // Convert token buffer to base64 for the QR code URL
      const tokenBase64 = result.token.toString("base64url");
      const qrCodeData = `tg://login?token=${tokenBase64}`;

      // Generate QR code image as base64 data URL
      const qrCodeImage = await QRCode.toDataURL(qrCodeData, {
        width: 300,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#FFFFFF",
        },
      });

      // Calculate expiration time in seconds
      // Always set QR code to expire in exactly 60 seconds from now
      const now = Math.floor(Date.now() / 1000);
      const expiresIn = 60;
      const actualExpires = now + expiresIn;

      // Store the temporary session and token in cache
      // Cache TTL set to 5 minutes (300 seconds), but QR expires in 60 seconds
      await this.cacheService.set(
        `qr:session:${qrToken}`,
        {
          token: result.token.toString("base64"),
          tempSessionString: result.tempSessionString,
          expires: actualExpires,
        },
        300,
      );

      logger.info({ qrToken, expiresIn }, "QR code generated successfully");

      return {
        success: true,
        message: "QR code generated successfully. Scan with your Telegram app.",
        qrToken,
        qrCodeData,
        qrCodeImage,
        expiresIn,
      };
    } catch (error) {
      logger.error({ error }, "Failed to generate QR code");
      throw new BadRequestException(
        "Failed to generate QR code. Please try again.",
      );
    }
  }

  /**
   * Check QR code authentication status
   * Polls the login token to see if user has scanned and authorized
   */
  async checkQrStatus(qrToken: string): Promise<{
    status: "pending" | "scanned" | "authorized" | "expired";
    message: string;
    user?: {
      id: number;
      phone: string | null;
      token: string;
    };
  }> {
    try {
      // Retrieve cached session data
      const qrData = await this.cacheService.get<{
        token: string;
        tempSessionString: string;
        expires: number;
      }>(`qr:session:${qrToken}`);

      if (!qrData) {
        return {
          status: "expired",
          message: "QR code expired. Please generate a new one.",
        };
      }

      // Check if QR code has expired based on Telegram's expiry time
      const now = Math.floor(Date.now() / 1000);
      if (now >= qrData.expires) {
        await this.cacheService.del(`qr:session:${qrToken}`);
        return {
          status: "expired",
          message: "QR code expired. Please generate a new one.",
        };
      }

      // Convert token back to Buffer
      const tokenBuffer = Buffer.from(qrData.token, "base64");

      // Check login token status
      const sessionString = await this.telegramService.checkLoginToken(
        tokenBuffer,
        qrData.tempSessionString,
      );

      if (!sessionString) {
        // Still pending - user hasn't scanned/authorized yet
        return {
          status: "pending",
          message: "Waiting for QR code to be scanned...",
        };
      }

      // Initialize a client with the new session to get user info
      const tempClient = await this.telegramService.getClientForUser(
        "instance",
        sessionString,
      );
      const me = await tempClient.getMe();

      if (!me || !("phone" in me) || !me.phone) {
        throw new Error("Failed to get user phone number from session");
      }

      // Normalize phone number to ensure it has + prefix
      const phone = this.normalizePhoneNumber(me.phone);

      // Check if user already exists
      let qrUserProfile = await this.userService.findByPhone(phone);

      let qrUserToken: string;
      if (qrUserProfile) {
        // Update existing user's session
        qrUserProfile = await this.userService.update(qrUserProfile.token, {
          session_string: sessionString,
        });
        qrUserToken = qrUserProfile.token;
        logger.info(
          { phone, token: qrUserToken },
          "Updated existing user via QR auth",
        );
      } else {
        // Create new user
        const entry = await this.userService.create(phone, sessionString);
        qrUserToken = entry.token;
        qrUserProfile = await this.userService.findByPhone(phone) as NonNullable<typeof qrUserProfile>;
        logger.info({ phone, token: qrUserToken }, "Created new user via QR auth");
      }

      // Clear the QR session from cache
      await this.cacheService.del(`qr:session:${qrToken}`);

      return {
        status: "authorized",
        message: "Authentication successful",
        user: {
          id: qrUserProfile.id,
          phone: qrUserProfile.phone,
          token: qrUserToken,
        },
      };
    } catch (error) {
      logger.error({ error, qrToken }, "Failed to check QR code status");

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        "Failed to check QR code status. Please try again.",
      );
    }
  }

  /**
   * Get QR code scanning instructions
   */
  getQrInstructions(): {
    title: string;
    steps: string[];
    notes: string[];
    troubleshooting: string[];
  } {
    return {
      title: "How to Scan QR Code for Telegram Authentication",
      steps: [
        "Open the Telegram app on your phone",
        "Go to Settings → Devices → Link Desktop Device",
        "Point your phone camera at the QR code displayed on screen",
        "Wait for the authentication to complete (usually takes a few seconds)",
      ],
      notes: [
        "Make sure you're logged into Telegram on your phone",
        "QR code expires after 60 seconds for security",
        "You can generate a new QR code if the current one expires",
        "The QR code links your Tg2Stream session to your Telegram account",
      ],
      troubleshooting: [
        "If the QR code doesn't scan, try increasing your screen brightness",
        "Make sure your Telegram app is up to date",
        "If QR code authentication doesn't work, try the phone code authentication method instead",
        "Clear your browser cache and try generating a new QR code",
      ],
    };
  }
}
