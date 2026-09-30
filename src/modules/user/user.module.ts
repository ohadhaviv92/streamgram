import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TelegramModule } from "../telegram/telegram.module";
import { CacheModule } from "../cache/cache.module";
import { UserService } from "./user.service";
import { UserController } from "./user.controller";

@Module({
  imports: [ConfigModule, TelegramModule, CacheModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
