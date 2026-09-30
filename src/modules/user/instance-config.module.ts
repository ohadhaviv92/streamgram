import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { InstanceConfigService } from "./instance-config.service";

@Global()
@Module({
  imports: [ConfigModule],
  providers: [InstanceConfigService],
  exports: [InstanceConfigService],
})
export class InstanceConfigModule {}
