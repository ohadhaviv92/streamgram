import { ConfigurationChecksService } from "./configuration-checks.service";
import { Module } from "@nestjs/common";
import { SetupController } from "./setup.controller";
import { InstanceConfigModule } from "../user/instance-config.module";
import { TelegramModule } from "../telegram/telegram.module";

@Module({
  imports: [InstanceConfigModule, TelegramModule],
  controllers: [SetupController],
  providers: [ConfigurationChecksService],
})
export class SetupModule {}
