import { IsArray, IsInt } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class UpdateFoldersDto {
  @ApiProperty({
    description: "Array of selected folder IDs",
    example: [1, 2, 3],
    type: [Number],
  })
  @IsArray()
  @IsInt({ each: true })
  folderIds: number[];
}
