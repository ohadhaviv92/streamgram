import { ApiProperty } from "@nestjs/swagger";

export class ChannelDto {
  @ApiProperty({ description: "Channel ID", example: "-100123456789" })
  id: string;

  @ApiProperty({ description: "Channel title", example: "Movie Updates" })
  title: string;

  @ApiProperty({ description: "Telegram username", example: "movies_channel", required: false })
  username?: string;

  @ApiProperty({ description: "Number of members", example: 1000, required: false })
  memberCount?: number;

  @ApiProperty({
    description: "Whether this channel is selected",
    example: false,
  })
  isSelected: boolean;
}

export class ChannelsResponseDto {
  @ApiProperty({ description: "Success status", example: true })
  success: boolean;

  @ApiProperty({ description: "Array of available channels", type: [ChannelDto] })
  channels: ChannelDto[];

  @ApiProperty({
    description: "Catalog URL for selected channels",
    example: "https://example.com/token/catalog/movie/telegram_channels.json",
    required: false,
  })
  catalogUrl?: string;
}
