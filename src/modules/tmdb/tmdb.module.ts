import { Module } from "@nestjs/common";
import { TmdbService } from "./tmdb.service";
import { InstanceConfigModule } from "../user/instance-config.module";

@Module({
  imports: [InstanceConfigModule],
  providers: [TmdbService],
  exports: [TmdbService],
})
export class TmdbModule {}
