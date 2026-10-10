import { BadRequestException } from "@nestjs/common";
import * as fs from "fs";
import { PersistedInstanceConfig, UserEntry, InvitationRecord } from "../user/instance-profile";
import { InstanceRepository, InstanceSettings } from "./instance.repository";
import { normalizeConfig } from "./normalize-config";

export function readJsonConfig(configPath: string): PersistedInstanceConfig {
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
  } catch {
    // Parsing errors may contain secrets from the source; do not log their contents.
    throw new BadRequestException(`Unable to read ${configPath}; fix or remove the file before starting`);
  }
}

function clone<T>(value: T): T { return structuredClone(value); }

export class JsonInstanceRepository extends InstanceRepository {
  private config: PersistedInstanceConfig = {};
  private depth = 0;

  constructor(private readonly configPath: string) {
    super();
    if (fs.existsSync(configPath)) {
      this.config = readJsonConfig(configPath);
      const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (JSON.stringify(raw) !== JSON.stringify(this.config)) this.write(this.config);
    }
  }

  getSettings(): InstanceSettings {
    const settings = this.snapshot();
    delete settings.users;
    delete settings.invitations;
    return settings;
  }
  replaceSettings(settings: InstanceSettings): void {
    this.change(() => { this.config = { ...clone(settings),
      ...(this.config.users !== undefined ? { users: this.config.users } : {}),
      ...(this.config.invitations !== undefined ? { invitations: this.config.invitations } : {}),
    }; });
  }
  getUser(token: string): UserEntry | null {
    return this.config.users && Object.prototype.hasOwnProperty.call(this.config.users, token) ? clone(this.config.users[token]) : null;
  }
  findUserByIdentity(telegramId: string, phone: string): UserEntry | null {
    return Object.values(this.getUsers()).find(user => user.telegramId === telegramId ||
      (!user.telegramId && user.phone.replace(/\D/g, "") === phone.replace(/\D/g, ""))) ?? null;
  }
  findUserByPhone(phone: string): UserEntry | null {
    return Object.values(this.getUsers()).find(user => user.phone === phone) ?? null;
  }
  getUsers(): Record<string, UserEntry> { return clone(this.config.users ?? {}); }
  upsertUser(user: UserEntry): void {
    this.change(() => { this.config.users = { ...this.config.users, [user.token]: clone(user) }; });
  }
  deleteUser(token: string): void { this.change(() => { delete this.config.users?.[token]; }); }
  getInvitations(): InvitationRecord[] { return clone(this.config.invitations ?? []); }
  getInvitation(id: string): InvitationRecord | null { return this.getInvitations().find(i => i.id === id) ?? null; }
  findInvitationByHash(hash: string): InvitationRecord | null { return this.getInvitations().find(i => i.secretHash === hash) ?? null; }
  upsertInvitation(invitation: InvitationRecord): void {
    this.change(() => {
      const records = this.config.invitations ?? [];
      const index = records.findIndex(i => i.id === invitation.id);
      if (index < 0) records.push(clone(invitation)); else records[index] = clone(invitation);
      this.config.invitations = records;
    });
  }
  deleteInvitation(id: string): void {
    this.change(() => { this.config.invitations = (this.config.invitations ?? []).filter(i => i.id !== id); });
  }
  snapshot(): PersistedInstanceConfig { return clone(this.config); }
  replaceSnapshot(config: PersistedInstanceConfig): void { this.change(() => { this.config = clone(config); }); }
  transaction<T>(callback: () => T): T {
    const previous = clone(this.config);
    this.depth++;
    try {
      const result = callback();
      if (result instanceof Promise) throw new Error("Storage transactions must be synchronous");
      if (this.depth === 1) this.write(this.config);
      return result;
    } catch (error) {
      this.config = previous;
      throw error;
    } finally { this.depth--; }
  }
  close(): void {}
  private change(callback: () => void): void {
    if (this.depth) callback(); else this.transaction(callback);
  }
  private write(config: PersistedInstanceConfig): void {
    const temporaryPath = `${this.configPath}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      fs.chmodSync(temporaryPath, 0o600);
      fs.renameSync(temporaryPath, this.configPath);
    } finally {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    }
  }
}
