import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { StorageModule } from "../storage/storage.module";
import { InstanceConfigService } from "./instance-config.service";

@Global()
@Module({
  imports: [ConfigModule, StorageModule],
  providers: [InstanceConfigService],
  exports: [InstanceConfigService],
})
export class InstanceConfigModule {}
