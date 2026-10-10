import { BadRequestException } from "@nestjs/common";
import { PersistedInstanceConfig, UserEntry, InvitationRecord } from "../user/instance-profile";

export type InstanceSettings = Omit<PersistedInstanceConfig, "users" | "invitations">;

/** Storage operations are synchronous; transaction callbacks must never await. */
export interface InstanceBackup {
  extension: "json" | "sqlite";
  contentType: string;
  data: Buffer;
}

export abstract class InstanceRepository {
  readonly backupFormat: "json" | "sqlite" = "json";
  exportBackup(): InstanceBackup {
    return {
      extension: "json", contentType: "application/json",
      data: Buffer.from(`${JSON.stringify(this.snapshot(), null, 2)}\n`),
    };
  }
  readDatabaseBackup(_data: Buffer): PersistedInstanceConfig {
    throw new BadRequestException("SQLite backups require STORAGE_DRIVER=sqlite");
  }
  abstract getSettings(): InstanceSettings;
  abstract replaceSettings(settings: InstanceSettings): void;
  abstract getUser(token: string): UserEntry | null;
  abstract findUserByIdentity(telegramId: string, phone: string): UserEntry | null;
  abstract findUserByPhone(phone: string): UserEntry | null;
  abstract getUsers(): Record<string, UserEntry>;
  abstract upsertUser(user: UserEntry): void;
  abstract deleteUser(token: string): void;
  abstract getInvitations(): InvitationRecord[];
  abstract getInvitation(id: string): InvitationRecord | null;
  abstract findInvitationByHash(hash: string): InvitationRecord | null;
  abstract upsertInvitation(invitation: InvitationRecord): void;
  abstract deleteInvitation(id: string): void;
  abstract snapshot(): PersistedInstanceConfig;
  abstract replaceSnapshot(config: PersistedInstanceConfig): void;
  abstract transaction<T>(callback: () => T): T;
  abstract close(): void;
}
