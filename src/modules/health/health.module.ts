import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { TelegramModule } from "../telegram/telegram.module";

@Module({
  imports: [TelegramModule],
  controllers: [HealthController],
})
export class HealthModule {}
