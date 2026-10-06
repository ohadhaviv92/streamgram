import { Injectable } from "@nestjs/common";
import { InstanceConfigService } from "./instance-config.service";
import {
  InstanceProfile,
  UserEntry,
  SupportedLanguage,
} from "./instance-profile";

/**
 * Account-scoped profile facade backed by the local configuration file.
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
    this.instanceConfig.updatePersonal(token, { name });
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
    settings: { language?: SupportedLanguage | null },
  ): Promise<InstanceProfile> {
    this.instanceConfig.updatePersonal(token, settings);
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
