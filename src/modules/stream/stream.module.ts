import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { StreamController } from "./stream.controller";
import { StreamHandlerService } from "./stream-handler.service";
import { TelegramModule } from "../telegram/telegram.module";
import { TmdbModule } from "../tmdb/tmdb.module";
import { WikidataModule } from "../wikidata/wikidata.module";
import { UserModule } from "../user/user.module";
import { InstanceProfileGuard } from "../../common/guards/instance-profile.guard";
import { LiveController } from "./live.controller";
import { LiveService } from "./live.service";

@Module({
  imports: [
    ConfigModule,
    TelegramModule,
    TmdbModule,
    WikidataModule,
    UserModule,
  ],
  controllers: [LiveController, StreamController],
  providers: [
    StreamHandlerService,
    InstanceProfileGuard,
    LiveService,
  ],
  exports: [StreamHandlerService],
})
export class StreamModule {}
