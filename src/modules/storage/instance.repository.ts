import { PersistedInstanceConfig, UserEntry, InvitationRecord } from "../user/instance-profile";

export type InstanceSettings = Omit<PersistedInstanceConfig, "users" | "invitations">;

/** Storage operations are synchronous; transaction callbacks must never await. */
export abstract class InstanceRepository {
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
