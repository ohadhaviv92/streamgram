import { ArrayMaxSize, ArrayUnique, IsArray, IsString, Matches } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class UpdateLiveChannelsDto {
  @ApiProperty({ description: "Canonical Telegram channel IDs selected for Live TV", type: [String], example: ["-1001981952129"] })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^-100[1-9]\d{0,16}$/, { each: true })
  channelIds: string[];
}
