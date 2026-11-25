import { Module } from "@nestjs/common";
import { TelegramNestService } from "./telegram.service";
import { TelegramClientManager } from "./telegram-client.manager";
import { CacheModule } from "../cache/cache.module";
import { TmdbModule } from "../tmdb/tmdb.module";

@Module({
  imports: [CacheModule, TmdbModule],
  providers: [TelegramClientManager, TelegramNestService],
  exports: [TelegramNestService, TelegramClientManager],
})
export class TelegramModule {}
