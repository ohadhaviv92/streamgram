import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join } from "path";
import { StreamModule } from "./modules/stream/stream.module";
import { HealthModule } from "./modules/health/health.module";
import { CacheModule } from "./modules/cache/cache.module";
import { TmdbModule } from "./modules/tmdb/tmdb.module";
import { UserModule } from "./modules/user/user.module";
import { AuthModule } from "./modules/auth/auth.module";
import configuration from "./config/configuration";
import { InstanceConfigModule } from "./modules/user/instance-config.module";
import { SetupModule } from "./modules/setup/setup.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, "..", "public"),
      renderPath: "/",
    }),
    InstanceConfigModule,
    CacheModule,
    TmdbModule,
    StreamModule,
    HealthModule,
    UserModule,
    AuthModule,
    SetupModule,
  ],
})
export class AppModule {}
