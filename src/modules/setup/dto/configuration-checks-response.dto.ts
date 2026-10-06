import { ApiProperty } from "@nestjs/swagger";

export class ConfigurationCheckDto {
  @ApiProperty({ enum: ["passed", "failed", "unverified"] })
  status: "passed" | "failed" | "unverified";

  @ApiProperty()
  message: string;
}

export class ConfigurationChecksResponseDto {
  @ApiProperty()
  checkedAt: string;

  @ApiProperty({ type: ConfigurationCheckDto })
  telegram: ConfigurationCheckDto;

  @ApiProperty({ type: ConfigurationCheckDto })
  tmdb: ConfigurationCheckDto;

  @ApiProperty({ type: ConfigurationCheckDto })
  streamingHttps: ConfigurationCheckDto;
}
