import { Module, OnApplicationShutdown, Inject } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as path from "path";
import { InstanceRepository } from "./instance.repository";
import { JsonInstanceRepository } from "./json-instance.repository";
import { SqliteInstanceRepository } from "./sqlite-instance.repository";

export function createInstanceRepository(config: ConfigService): InstanceRepository {
  const driver = config.get<string>("storage.driver", "json");
  if (driver !== "json" && driver !== "sqlite") throw new Error("STORAGE_DRIVER must be json or sqlite");
  const dataDir = path.resolve(config.get<string>("storage.dataDir", path.join(process.cwd(), "data")));
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dataDir, 0o700); } catch { /* Filesystem may not support chmod. */ }
  return driver === "sqlite" ? new SqliteInstanceRepository(dataDir) : new JsonInstanceRepository(path.join(dataDir, "config.json"));
}

@Module({
  imports: [ConfigModule],
  providers: [{ provide: InstanceRepository, inject: [ConfigService], useFactory: createInstanceRepository }],
  exports: [InstanceRepository],
})
export class StorageModule implements OnApplicationShutdown {
  constructor(@Inject(InstanceRepository) private readonly repository: InstanceRepository) {}
  onApplicationShutdown(): void { this.repository.close(); }
}
