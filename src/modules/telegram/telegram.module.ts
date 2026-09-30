import { Module } from "@nestjs/common";
import { TelegramNestService } from "./telegram.service";
import { TelegramClientManager } from "./telegram-client.manager";
import { CacheModule } from "../cache/cache.module";

@Module({
  imports: [CacheModule],
  providers: [TelegramClientManager, TelegramNestService],
  exports: [TelegramNestService, TelegramClientManager],
})
export class TelegramModule {}
