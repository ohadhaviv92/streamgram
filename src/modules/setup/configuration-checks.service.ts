import { TelegramClientManager } from "../telegram/telegram-client.manager";
import { Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import * as https from "https";
import { InstanceConfigService } from "../user/instance-config.service";
import { EffectiveInstanceConfig } from "../user/instance-profile";
import { ConfigurationCheckDto, ConfigurationChecksResponseDto } from "./dto/configuration-checks-response.dto";

@Injectable()
export class ConfigurationChecksService {
  private readonly instanceId = randomUUID();
  private readonly inFlight = new Map<string, Promise<ConfigurationChecksResponseDto>>();

  constructor(
    private readonly config: InstanceConfigService,
    private readonly clients: TelegramClientManager,
  ) {}

  probe(): { instanceId: string } {
    return { instanceId: this.instanceId };
  }

  check(): Promise<ConfigurationChecksResponseDto> {
    const config = this.config.getConfig();
    // Hash the snapshot so secrets are not kept in map keys.
    const key = createHash("sha256").update(JSON.stringify(config)).digest("hex");
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const pending = this.run(config).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, pending);
    return pending;
  }

  private async run(config: EffectiveInstanceConfig): Promise<ConfigurationChecksResponseDto> {
    const [telegram, tmdb, streamingHttps] = await Promise.all([
      this.checkTelegram(config.telegram.apiId, config.telegram.apiHash),
      this.checkTmdb(config.tmdb.bearerToken),
      this.checkHttps(config.publicUrl),
    ]);
    return {
      checkedAt: new Date().toISOString(),
      telegram,
      tmdb,
      streamingHttps,
    };
  }

  private async checkTelegram(apiId: number, apiHash: string): Promise<ConfigurationCheckDto> {
    if (!Number.isSafeInteger(apiId) || apiId <= 0 || !/^[a-f0-9]{32}$/i.test(apiHash))
      return { status: "failed", message: "Enter a positive Telegram API ID and a 32-character hexadecimal API hash." };
    try {
      await this.clients.checkApiCredentials(apiId, apiHash);
      return { status: "passed", message: "Telegram accepted the API ID and hash." };
    } catch (error: unknown) {
      const code = error && typeof error === "object" && "errorMessage" in error ? error.errorMessage : "";
      if (code === "API_ID_INVALID" || code === "API_HASH_INVALID" || code === "CONNECTION_API_ID_INVALID")
        return { status: "failed", message: "Telegram rejected the API ID or hash." };
      if (code === "API_ID_PUBLISHED_FLOOD")
        return { status: "failed", message: "Telegram has restricted this API ID. Use different Telegram API credentials." };
      if (typeof code === "string" && code.startsWith("FLOOD_"))
        return { status: "unverified", message: "Telegram rate-limited the check. Try again later." };
      return { status: "unverified", message: "Could not verify Telegram credentials within 10 seconds. Try again later." };
    }
  }

  private async checkTmdb(token: string): Promise<ConfigurationCheckDto> {
    if (!token) return { status: "failed", message: "TMDB bearer token is missing." };
    try {
      const result = await this.requestJson(new URL("https://api.themoviedb.org/3/movie/11"), {
        Authorization: `Bearer ${token}`,
      });
      if (result.status === 401 || result.status === 403)
        return { status: "failed", message: "TMDB rejected the bearer token." };
      if (result.status === 200 && result.body?.id === 11)
        return { status: "passed", message: "TMDB API is working." };
      return { status: "unverified", message: "TMDB returned an unexpected response. Try again later." };
    } catch {
      return { status: "unverified", message: "Could not reach TMDB within 10 seconds or verify its response." };
    }
  }

  private async checkHttps(publicUrl: string): Promise<ConfigurationCheckDto> {
    let url: URL;
    try {
      url = new URL(publicUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
        throw new Error("Invalid streaming URL");
    } catch {
      return { status: "failed", message: "Use an HTTPS public URL without credentials, query parameters, or fragments." };
    }
    // Append instead of resolving from / so reverse-proxy path prefixes survive.
    url.pathname = `${url.pathname.replace(/\/$/, "")}/setup/probe`;
    try {
      const result = await this.requestJson(url);
      if (result.status >= 300 && result.status < 400)
        return { status: "failed", message: "Streaming URL redirects. Use the final HTTPS URL." };
      if (result.status === 200 && result.body?.instanceId === this.instanceId)
        return { status: "passed", message: "HTTPS reaches this StreamGram instance with a valid certificate." };
      return { status: "failed", message: "The public URL did not return this StreamGram instance." };
    } catch {
      return { status: "unverified", message: "Could not reach the streaming URL within 10 seconds or verify its TLS certificate and response." };
    }
  }

  private requestJson(url: URL, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown> | null }> {
    return new Promise((resolve, reject) => {
      const request = https.get(url, { headers: { Accept: "application/json", ...headers }, rejectUnauthorized: true }, (response) => {
        const status = response.statusCode || 0;
        if (status !== 200) {
          response.destroy();
          resolve({ status, body: null });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 64 * 1024) {
            request.destroy(new Error("Check response too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("aborted", () => reject(new Error("Check response aborted")));
        response.on("end", () => {
          try {
            const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid check response");
            resolve({ status, body: body as Record<string, unknown> });
          } catch { reject(new Error("Invalid check response")); }
        });
      });
      const timer = setTimeout(() => request.destroy(new Error("Check timed out")), 10_000);
      request.on("error", reject);
      request.on("close", () => clearTimeout(timer));
    });
  }
}
