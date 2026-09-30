import { ApiProperty } from "@nestjs/swagger";

export class FolderDto {
  @ApiProperty({ description: "Folder ID", example: 1 })
  id: number;

  @ApiProperty({ description: "Folder title", example: "My Movies" })
  title: string;

  @ApiProperty({ description: "Number of channels in folder", example: 5 })
  channelCount: number;

  @ApiProperty({
    description: "Whether this folder is selected",
    example: false,
  })
  isSelected: boolean;
}

export class FoldersResponseDto {
  @ApiProperty({ description: "Success status", example: true })
  success: boolean;

  @ApiProperty({ description: "Array of available folders", type: [FolderDto] })
  folders: FolderDto[];

  @ApiProperty({
    description: "Catalog URL for selected folders",
    example: "https://example.com/token/catalog/series/telegram_folders.json",
    required: false,
  })
  catalogUrl?: string;
}
