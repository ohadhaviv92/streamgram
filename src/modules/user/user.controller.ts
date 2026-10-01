import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  Query,
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
import { logger } from "../../logger";

@Controller()
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly configService: ConfigService,
    private readonly telegramService: TelegramNestService,
    private readonly cache: CacheService,
    private readonly instanceConfig: InstanceConfigService,
  ) {}

  @Get("settings")
  @HttpCode(HttpStatus.OK)
  async getSettings(@Req() request: Request, @Query('token') token?: string): Promise<UserSettingsResponseDto> {
    const profile = this.userService.getProfile(token);
    const baseUrl = this.getBaseUrl(request);
    const telegramConnected = await this.telegramService.checkTelegramConnection(
      profile.token,
      profile.session_string,
    );

    return {
      success: true,
      language: profile.language,
      tmdbToken: null,
      manifestUrl: `${baseUrl}/${profile.token}/manifest.json`,
      telegramConnected,
      catalogUrl: `${baseUrl}/${profile.token}/catalog/series/telegram_folders.json`,
      channelsCatalogUrl: `${baseUrl}/${profile.token}/catalog/movie/telegram_channels.json`,
    };
  }

  @Get("telegram-status")
  @HttpCode(HttpStatus.OK)
  async checkTelegramStatus(@Query('token') token?: string): Promise<{ success: boolean; isConnected: boolean }> {
    const profile = this.userService.getProfile(token);
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
    @Query('token') token?: string,
  ): Promise<SettingsResponseDto> {
    const profile = this.userService.getProfile(token);
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
  @HttpCode(HttpStatus.OK)
  async updateName(
    @Body() body: { name: string },
    @Query('token') token?: string,
  ): Promise<{ success: boolean }> {
    const profile = this.userService.getProfile(token);
    if (profile) {
      await this.userService.updateName(profile.token, body.name);
    }
    return { success: true };
  }

  @Get("folders")
  @HttpCode(HttpStatus.OK)
  async getFolders(@Req() request: Request, @Query('token') token?: string): Promise<FoldersResponseDto> {
    const profile = this.userService.getProfile(token);
    try {
      const allFolders = await this.telegramService.getUserFolders(
        profile.token,
        profile.session_string,
      );
      const selectedIds = await this.userService.getSelectedFolders(profile.token);
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
      logger.error({ error: (error as Error).message }, "Failed to get folders");
      return { success: false, folders: [] };
    }
  }

  @Post("folders")
  @HttpCode(HttpStatus.OK)
  async updateFolders(
    @Body() body: UpdateFoldersDto,
    @Req() request: Request,
    @Query('token') token?: string,
  ): Promise<SettingsResponseDto> {
    const profile = this.userService.getProfile(token);
    try {
      await this.userService.updateSelectedFolders(profile.token, body.folderIds);
      await this.cache.invalidateUserFolders(profile.token);
      return {
        success: true,
        message: "Folders updated successfully",
        catalogUrl: `${this.getBaseUrl(request)}/${profile.token}/catalog/series/telegram_folders.json`,
      };
    } catch (error) {
      logger.error({ error: (error as Error).message }, "Failed to update folders");
      return { success: false, message: "Failed to update folders" };
    }
  }

  @Get("channels")
  @HttpCode(HttpStatus.OK)
  async getChannels(@Req() request: Request, @Query('token') token?: string): Promise<ChannelsResponseDto> {
    const profile = this.userService.getProfile(token);
    try {
      const allChannels = await this.telegramService.getUserChannels(
        profile.token,
        profile.session_string,
      );
      const selectedIds = await this.userService.getSelectedChannels(profile.token);
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
      logger.error({ error: (error as Error).message }, "Failed to get channels");
      return { success: false, channels: [] };
    }
  }

  @Post("channels")
  @HttpCode(HttpStatus.OK)
  async updateChannels(
    @Body() body: UpdateChannelsDto,
    @Req() request: Request,
    @Query('token') token?: string,
  ): Promise<SettingsResponseDto> {
    const profile = this.userService.getProfile(token);
    try {
      await this.userService.updateSelectedChannels(profile.token, body.channelIds);
      await this.cache.invalidateUserFolders(profile.token);
      return {
        success: true,
        message: "Channels updated successfully",
        channelsCatalogUrl: `${this.getBaseUrl(request)}/${profile.token}/catalog/movie/telegram_channels.json`,
      };
    } catch (error) {
      logger.error({ error: (error as Error).message }, "Failed to update channels");
      return { success: false, message: "Failed to update channels" };
    }
  }

  private getBaseUrl(request: Request): string {
    const configured =
      this.instanceConfig.getConfig().publicUrl ||
      this.configService.get<string>("server.streamHost", "");
    const host = configured || `${request.protocol}://${request.get("host")}`;
    return host.replace(/\/$/, "");
  }
}
