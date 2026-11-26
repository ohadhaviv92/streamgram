import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { StreamController } from "./stream.controller";
import { StreamHandlerService } from "./stream-handler.service";
import { TelegramModule } from "../telegram/telegram.module";
import { TmdbModule } from "../tmdb/tmdb.module";
import { WikidataModule } from "../wikidata/wikidata.module";
import { UserModule } from "../user/user.module";
import { InstanceProfileGuard } from "../../common/guards/instance-profile.guard";

@Module({
  imports: [
    ConfigModule,
    TelegramModule,
    TmdbModule,
    WikidataModule,
    UserModule,
  ],
  controllers: [StreamController],
  providers: [
    StreamHandlerService,
    InstanceProfileGuard,
  ],
  exports: [StreamHandlerService],
})
export class StreamModule {}
