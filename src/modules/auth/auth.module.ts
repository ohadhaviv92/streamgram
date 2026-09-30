import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { TelegramModule } from "../telegram/telegram.module";
import { UserModule } from "../user/user.module";
import { CacheModule } from "../cache/cache.module";

@Module({
  imports: [TelegramModule, UserModule, CacheModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
