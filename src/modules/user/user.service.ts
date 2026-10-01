import { Injectable } from "@nestjs/common";
import {
  InstanceConfigService,
  SetupConfigPatch,
} from "./instance-config.service";
import { InstanceProfile, UserEntry } from "./instance-profile";

/**
 * Local profile facade for the existing controllers. It persists only one
 * profile and does not use a database.
 */
@Injectable()
export class UserService {
  constructor(private readonly instanceConfig: InstanceConfigService) {}

  getProfile(token?: string): InstanceProfile {
    return this.instanceConfig.getProfile(token);
  }

  /**
   * Creates or updates the user with the given phone + session.
   * Returns the full UserEntry (including the generated/existing token).
   */
  async create(phone: string, session_string: string): Promise<UserEntry> {
    return this.instanceConfig.createOrUpdateUser(phone, session_string);
  }

  
  
  async updateName(token: string, name: string): Promise<void> {
    this.instanceConfig.updateUserName(token, name);
  }

  async deleteUser(token: string): Promise<void> {
    this.instanceConfig.deleteUser(token);
  }

  async findByPhone(phone: string): Promise<InstanceProfile | null> {
    const users = this.instanceConfig.getUsers();
    const entry = Object.values(users).find((u) => u.phone === phone);
    return entry ? this.instanceConfig.getProfile(entry.token) : null;
  }

  async update(
    token: string,
    updates: Partial<Pick<InstanceProfile, "session_string">>,
  ): Promise<InstanceProfile> {
    const entry = this.instanceConfig.getUserByToken(token);
    if (!entry) throw new Error(`User not found for token: ${token}`);

    if (updates.session_string !== undefined) {
      await this.instanceConfig.createOrUpdateUser(
        entry.phone,
        updates.session_string,
      );
    }
    return this.instanceConfig.getProfile(token);
  }

  async updateSettings(
    token: string,
    settings: { language?: string; tmdbToken?: string | null },
  ): Promise<InstanceProfile> {
    const patch: SetupConfigPatch = {};
    if (settings.language) patch.preferredLanguage = settings.language as any;
    if (settings.tmdbToken !== undefined)
      patch.tmdbBearerToken = settings.tmdbToken || undefined;
    await this.instanceConfig.update(patch);
    return this.instanceConfig.getProfile(token);
  }

  async getSelectedFolders(token: string): Promise<number[]> {
    const entry = this.instanceConfig.getUserByToken(token);
    return entry?.selectedFolders ?? [];
  }

  async updateSelectedFolders(
    token: string,
    folderIds: number[],
  ): Promise<InstanceProfile> {
    await this.instanceConfig.updateUserSelections(token, {
      selectedFolders: folderIds,
    });
    return this.instanceConfig.getProfile(token);
  }

  async getSelectedChannels(token: string): Promise<string[]> {
    const entry = this.instanceConfig.getUserByToken(token);
    return entry?.selectedChannels ?? [];
  }

  async updateSelectedChannels(
    token: string,
    channelIds: string[],
  ): Promise<InstanceProfile> {
    await this.instanceConfig.updateUserSelections(token, {
      selectedChannels: channelIds,
    });
    return this.instanceConfig.getProfile(token);
  }
}
