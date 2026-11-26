import { ApiProperty } from "@nestjs/swagger";

export class LiveChannelMetaDto {
  @ApiProperty({ example: "tg_live_-1001981952129" })
  id: string;
  @ApiProperty({ enum: ["tv", "movie"], description: "Live channels use tv; movie is retained for older addon installations" })
  type: string;
  @ApiProperty({ description: "Telegram channel name; broadcast status is checked only when resolving playback" })
  name: string;
  @ApiProperty()
  description: string;
  @ApiProperty({ description: "Account-scoped Telegram channel profile photo URL" })
  poster: string;
  @ApiProperty({ enum: ["square"] })
  posterShape: string;
  @ApiProperty()
  background: string;
  @ApiProperty()
  logo: string;
  @ApiProperty({ type: "object", properties: { defaultVideoId: { type: "string" }, isLive: { type: "boolean" } } })
  behaviorHints: { defaultVideoId: string; isLive: boolean };
}

export class LiveCatalogResponseDto {
  @ApiProperty({ type: [LiveChannelMetaDto] })
  metas: LiveChannelMetaDto[];
}

export class LiveMetaResponseDto {
  @ApiProperty({ type: LiveChannelMetaDto, nullable: true })
  meta: LiveChannelMetaDto | null;
}
