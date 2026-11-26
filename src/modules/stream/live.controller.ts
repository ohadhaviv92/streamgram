import { Controller, Get, Header, NotFoundException, Param, Req, Res, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiOperation, ApiProduces, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Request, Response } from "express";
import { InstanceProfileGuard } from "../../common/guards/instance-profile.guard";
import { InstanceConfigService } from "../user/instance-config.service";
import { LiveItemType, LiveService } from "./live.service";
import { LiveCatalogResponseDto, LiveMetaResponseDto } from "./dto/live-response.dto";
import { StreamsResponseDto } from "../../common/dto/responses.dto";

@ApiTags("Live TV")
@UseGuards(InstanceProfileGuard)
@Controller(":userToken")
export class LiveController {
  constructor(private readonly live: LiveService, private readonly config: InstanceConfigService, private readonly defaults: ConfigService) {}

  private base(req: Request, withToken = true) {
    const configured = this.config.getConfig().publicUrl || this.defaults.get<string>("server.publicUrl") || `http://localhost:${this.defaults.get<number>("server.port", 3000)}`;
    const base = (/^https?:\/\//.test(configured) ? configured : `https://${configured}`).replace(/\/$/, "");
    return withToken ? `${base}/${req.user.token}` : base;
  }

  private liveType(type: string): LiveItemType {
    if (type === "tv" || type === "movie") return type;
    throw new NotFoundException("Unknown live catalog type");
  }

  // Keep movie routes for clients with the previous manifest cached.
  @Get("catalog/:type/telegram_live.json")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Browse selected Telegram live channels without probing broadcast status" })
  @ApiResponse({ status: 200, type: LiveCatalogResponseDto })
  catalog(@Req() req: Request, @Param("type") type: string) { return this.live.catalog(req.user, this.base(req), this.liveType(type)); }

  @Get("meta/:type/tg_live_:channelId.json")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Get a selected live channel's name and thumbnail without probing broadcast status" })
  @ApiResponse({ status: 200, type: LiveMetaResponseDto })
  async meta(@Req() req: Request, @Param("channelId") channelId: string, @Param("type") type: string) { return { meta: await this.live.meta(req.user, channelId, this.base(req), this.liveType(type)) }; }

  @Get("stream/:type/tg_live_:channelId.json")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Get the HLS playback link for an available live broadcast" })
  @ApiResponse({ status: 200, type: StreamsResponseDto })
  streams(@Req() req: Request, @Param("channelId") channelId: string, @Param("type") type: string) {
    if (type !== "tv" && type !== "movie") return { streams: [] };
    return this.live.streams(req.user, channelId, this.base(req));
  }

  @Get("live/:channelId/thumbnail.jpg")
  @Header("Cache-Control", "private, max-age=300")
  @ApiOperation({ summary: "Get the selected live channel's Telegram profile photo" })
  @ApiProduces("image/jpeg")
  @ApiResponse({ status: 200, schema: { type: "string", format: "binary" } })
  @ApiResponse({ status: 302, description: "Channel has no profile photo; use the default logo" })
  @ApiResponse({ status: 404, description: "Channel is not selected by this account" })
  @ApiResponse({ status: 503, description: "Telegram photo temporarily unavailable" })
  async thumbnail(@Req() req: Request, @Param("channelId") channelId: string, @Res() res: Response) {
    const photo = await this.live.thumbnail(req.user, channelId);
    if (photo) res.type("image/jpeg").send(photo);
    else res.redirect(302, `${this.base(req, false)}/logo-icon-only.png`);
  }

  @Get("live/:channelId/index.m3u8")
  @Header("Cache-Control", "private, no-store")
  @Header("Content-Type", "application/vnd.apple.mpegurl")
  @Header("Access-Control-Allow-Origin", "*")
  @ApiOperation({ summary: "Join a native Telegram RTMP broadcast and serve a live HLS playlist" })
  @ApiProduces("application/vnd.apple.mpegurl")
  @ApiResponse({ status: 200, schema: { type: "string" } })
  @ApiResponse({ status: 404, description: "Channel is not selected by this account" })
  @ApiResponse({ status: 503, description: "Broadcast ended, is unavailable, or uses unsupported media" })
  playlist(@Req() req: Request, @Param("channelId") channelId: string) { return this.live.playlist(req.user, channelId); }

  @Get("live/:channelId/:sessionId/:filename")
  @Header("Cache-Control", "private, no-store")
  @Header("Access-Control-Allow-Origin", "*")
  @ApiOperation({ summary: "Read an account-scoped live HLS initialization or media segment" })
  @ApiProduces("video/mp4", "video/iso.segment")
  @ApiResponse({ status: 200, schema: { type: "string", format: "binary" } })
  @ApiResponse({ status: 404, description: "Segment expired or does not belong to this account" })
  asset(@Req() req: Request, @Param("channelId") channelId: string, @Param("sessionId") sessionId: string,
    @Param("filename") filename: string, @Res() res: Response) {
    const bytes = this.live.asset(req.user, channelId, sessionId, filename);
    res.type(filename.endsWith(".mp4") ? "video/mp4" : "video/iso.segment").send(bytes);
  }
}
