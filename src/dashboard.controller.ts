import { Controller, Get, Header, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request, Response } from "express";
import { readFileSync } from "fs";
import { join } from "path";
import { InstanceConfigService } from "./modules/user/instance-config.service";

const escapeAttribute = (value: string) => value.replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character,
);

export function addPreviewMetadata(html: string, baseUrl: string): string {
  const imageUrl = escapeAttribute(`${baseUrl.replace(/\/+$/, "")}/preview-logo-v1.png`);
  return html.replace("</title>", `</title>
    <meta name="description" content="Connect your Telegram library to Stremio or Nuvio." />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="StreamGram" />
    <meta property="og:title" content="StreamGram" />
    <meta property="og:description" content="Connect your Telegram library to Stremio or Nuvio." />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="200" />
    <meta property="og:image:height" content="200" />
    <meta property="og:image:alt" content="StreamGram logo" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="StreamGram" />
    <meta name="twitter:image" content="${imageUrl}" />`);
}

@Controller()
export class DashboardController {
  private readonly html = readFileSync(join(__dirname, "..", "public", "index.html"), "utf8");

  constructor(
    private readonly instanceConfig: InstanceConfigService,
    private readonly config: ConfigService,
  ) {}

  @Get("preview-logo-v1.png")
  previewLogo(@Res() response: Response): void {
    response.sendFile(join(__dirname, "..", "public", "preview-logo-v1.png"));
  }

  @Get()
  @Header("Content-Type", "text/html; charset=utf-8")
  dashboard(@Req() request: Request): string {
    const baseUrl = this.instanceConfig.getConfig().publicUrl ||
      this.config.get<string>("server.publicUrl", "") ||
      `${request.protocol}://${request.get("host")}`;
    return addPreviewMetadata(this.html, baseUrl);
  }
}
