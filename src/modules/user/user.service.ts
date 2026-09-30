import { Injectable } from "@nestjs/common";
import {
  InstanceConfigService,
  SetupConfigPatch,
} from "./instance-config.service";
import { InstanceProfile } from "./instance-profile";

/**
 * Local profile facade for the existing controllers. It persists only one
 * profile and does not use a database.
 */
@Injectable()
export class UserService {
  constructor(private readonly instanceConfig: InstanceConfigService) {}

  getProfile(): InstanceProfile {
    return this.instanceConfig.getProfile();
  }

  async create(phone: string, session_string: string): Promise<InstanceProfile> {
    await this.instanceConfig.update({ phone, sessionString: session_string });
    return this.getProfile();
  }

  async findByPhone(phone: string): Promise<InstanceProfile | null> {
    const profile = this.getProfile();
    return profile.phone === phone ? profile : null;
  }

  async update(
    _id: number,
    updates: Partial<Pick<InstanceProfile, "session_string">>,
  ): Promise<InstanceProfile> {
    const patch: SetupConfigPatch = {};
    if (updates.session_string !== undefined) {
      patch.sessionString = updates.session_string;
    }
    await this.instanceConfig.update(patch);
    return this.getProfile();
  }

  async updateSettings(
    _id: number,
    settings: { language?: string; tmdbToken?: string | null },
  ): Promise<InstanceProfile> {
    await this.instanceConfig.update({
      preferredLanguage: settings.language as any,
      tmdbBearerToken: settings.tmdbToken || undefined,
    });
    return this.getProfile();
  }

  async getSelectedFolders(_id: number): Promise<number[]> {
    return this.instanceConfig.getConfig().selectedFolders;
  }

  async updateSelectedFolders(
    _id: number,
    folderIds: number[],
  ): Promise<InstanceProfile> {
    const current = this.instanceConfig.getConfig();
    await this.instanceConfig.updateSelections(folderIds, current.selectedChannels);
    return this.getProfile();
  }

  async getSelectedChannels(_id: number): Promise<string[]> {
    return this.instanceConfig.getConfig().selectedChannels;
  }

  async updateSelectedChannels(
    _id: number,
    channelIds: string[],
  ): Promise<InstanceProfile> {
    const current = this.instanceConfig.getConfig();
    await this.instanceConfig.updateSelections(current.selectedFolders, channelIds);
    return this.getProfile();
  }
}
