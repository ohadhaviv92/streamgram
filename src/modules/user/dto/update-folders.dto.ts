import { IsArray, IsNumber } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class UpdateFoldersDto {
  @ApiProperty({
    description: "Array of selected folder IDs",
    example: [1, 2, 3],
    type: [Number],
  })
  @IsArray()
  @IsNumber({}, { each: true })
  folderIds: number[];
}
