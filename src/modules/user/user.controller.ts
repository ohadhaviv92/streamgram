import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { CacheService } from "../cache/cache.service";
import { TelegramNestService } from "../telegram/telegram.service";
import { InstanceConfigService } from "./instance-config.service";
import { UserService } from "./user.service";
import { UpdateChannelsDto } from "./dto/update-channels.dto";
import { UpdateFoldersDto } from "./dto/update-folders.dto";
import { UpdateSettingsDto } from "./dto/update-settings.dto";
import { ChannelsResponseDto } from "./dto/channels-response.dto";
import { FoldersResponseDto } from "./dto/folders-response.dto";
import { SettingsResponseDto } from "./dto/settings-response.dto";
import { UserSettingsResponseDto } from "./dto/user-settings-response.dto";
import { AdminGuard, PersonalGuard } from "../management/management.guards";
import { ManagementService } from "../management/management.service";
import { UpdateNameDto } from "./dto/update-settings.dto";
import { logger } from "../../logger";

@UseGuards(PersonalGuard)
@Controller()
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly configService: ConfigService,
    private readonly telegramService: TelegramNestService,
    private readonly cache: CacheService,
    private readonly instanceConfig: InstanceConfigService,
    private readonly management: ManagementService,
  ) {}

  @Get("settings")
  @HttpCode(HttpStatus.OK)
  async getSettings(@Req() request: Request): Promise<UserSettingsResponseDto> {
    const profile = request.user;
    const baseUrl = this.getBaseUrl(request);
    const telegramConnected =
      await this.telegramService.checkTelegramConnection(
        profile.token,
        profile.session_string,
      );

    return {
      success: true,
      canEditName: this.management.isAuthenticated(request),
      ...(this.management.isAuthenticated(request)
        ? { name: this.instanceConfig.getUserByToken(profile.token)?.name ?? "" }
        : {}),
      language: profile.language,
      instanceLanguage: this.instanceConfig.getConfig().preferredLanguage,
      personalLanguage:
        this.instanceConfig.getUserByToken(profile.token)?.language ?? null,
      tmdbToken: null,
      manifestUrl: `${baseUrl}/${profile.token}/manifest.json`,
      telegramConnected,
      catalogUrl: `${baseUrl}/${profile.token}/catalog/series/telegram_folders.json`,
      channelsCatalogUrl: `${baseUrl}/${profile.token}/catalog/movie/telegram_channels.json`,
    };
  }

  @Get("telegram-status")
  @HttpCode(HttpStatus.OK)
  async checkTelegramStatus(
    @Req() request: Request,
  ): Promise<{ success: boolean; isConnected: boolean }> {
    const profile = request.user;
    const isConnected = await this.telegramService.checkTelegramConnection(
      profile.token,
      profile.session_string,
    );
    return { success: true, isConnected };
  }

  @Put("settings")
  @HttpCode(HttpStatus.OK)
  async updateSettings(
    @Body() body: UpdateSettingsDto,
    @Req() request: Request,
  ): Promise<SettingsResponseDto> {
    const profile = request.user;
    await this.userService.updateSettings(profile.token, body);
    const baseUrl = this.getBaseUrl(request);

    return {
      success: true,
      message: "Settings updated successfully",
      manifestUrl: `${baseUrl}/${profile.token}/manifest.json`,
      catalogUrl: `${baseUrl}/${profile.token}/catalog/series/telegram_folders.json`,
      channelsCatalogUrl: `${baseUrl}/${profile.token}/catalog/movie/telegram_channels.json`,
    };
  }

  @Put("name")
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async updateName(
    @Body() body: UpdateNameDto,
    @Req() request: Request,
  ): Promise<{ success: boolean }> {
    const profile = request.user;
    if (profile) {
      await this.userService.updateName(profile.token, body.name);
    }
    return { success: true };
  }

  @Get("folders")
  @HttpCode(HttpStatus.OK)
  async getFolders(@Req() request: Request): Promise<FoldersResponseDto> {
    const profile = request.user;
    try {
      const allFolders = await this.telegramService.getUserFolders(
        profile.token,
        profile.session_string,
      );
      const selectedIds = await this.userService.getSelectedFolders(
        profile.token,
      );
      const baseUrl = this.getBaseUrl(request);

      return {
        success: true,
        folders: allFolders.map((folder) => ({
          id: folder.id,
          title: folder.title,
          channelCount: folder.channelIds.length,
          isSelected: selectedIds.includes(folder.id),
        })),
        catalogUrl: `${baseUrl}/${profile.token}/catalog/series/telegram_folders.json`,
      };
    } catch (error) {
      logger.error(
        { error: (error as Error).message },
        "Failed to get folders",
      );
      return { success: false, folders: [] };
    }
  }

  @Post("folders")
  @HttpCode(HttpStatus.OK)
  async updateFolders(
    @Body() body: UpdateFoldersDto,
    @Req() request: Request,
  ): Promise<SettingsResponseDto> {
    const profile = request.user;
    try {
      await this.userService.updateSelectedFolders(
        profile.token,
        body.folderIds,
      );
      await this.cache.invalidateUserFolders(profile.token);
      return {
        success: true,
        message: "Folders updated successfully",
        catalogUrl: `${this.getBaseUrl(request)}/${profile.token}/catalog/series/telegram_folders.json`,
      };
    } catch (error) {
      logger.error(
        { error: (error as Error).message },
        "Failed to update folders",
      );
      return { success: false, message: "Failed to update folders" };
    }
  }

  @Get("channels")
  @HttpCode(HttpStatus.OK)
  async getChannels(@Req() request: Request): Promise<ChannelsResponseDto> {
    const profile = request.user;
    try {
      const allChannels = await this.telegramService.getUserChannels(
        profile.token,
        profile.session_string,
      );
      const selectedIds = await this.userService.getSelectedChannels(
        profile.token,
      );
      const baseUrl = this.getBaseUrl(request);

      return {
        success: true,
        channels: allChannels.map((channel) => ({
          id: channel.id,
          title: channel.title,
          username: channel.username,
          memberCount: channel.memberCount,
          isSelected: selectedIds.includes(channel.id),
        })),
        catalogUrl: `${baseUrl}/${profile.token}/catalog/movie/telegram_channels.json`,
      };
    } catch (error) {
      logger.error(
        { error: (error as Error).message },
        "Failed to get channels",
      );
      return { success: false, channels: [] };
    }
  }

  @Post("channels")
  @HttpCode(HttpStatus.OK)
  async updateChannels(
    @Body() body: UpdateChannelsDto,
    @Req() request: Request,
  ): Promise<SettingsResponseDto> {
    const profile = request.user;
    try {
      await this.userService.updateSelectedChannels(
        profile.token,
        body.channelIds,
      );
      await this.cache.invalidateUserFolders(profile.token);
      return {
        success: true,
        message: "Channels updated successfully",
        channelsCatalogUrl: `${this.getBaseUrl(request)}/${profile.token}/catalog/movie/telegram_channels.json`,
      };
    } catch (error) {
      logger.error(
        { error: (error as Error).message },
        "Failed to update channels",
      );
      return { success: false, message: "Failed to update channels" };
    }
  }

  private getBaseUrl(request: Request): string {
    const configured =
      this.instanceConfig.getConfig().publicUrl ||
      this.configService.get<string>("server.publicUrl", "");
    const host = configured || `${request.protocol}://${request.get("host")}`;
    return host.replace(/\/$/, "");
  }
}
