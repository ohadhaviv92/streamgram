import { IsArray, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class UpdateChannelsDto {
  @ApiProperty({
    description: "Array of selected channel IDs",
    example: ["-100123456789", "-100987654321"],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  channelIds: string[];
}
