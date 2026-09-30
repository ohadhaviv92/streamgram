import { Controller, Get, Delete } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { TelegramNestService } from "../telegram/telegram.service";
import { TelegramClientManager } from "../telegram/telegram-client.manager";
import {
  HealthResponseDto,
  CacheStatsResponseDto,
} from "../../common/dto/responses.dto";

@ApiTags("Health & Cache")
@Controller()
export class HealthController {
  constructor(
    private readonly telegramService: TelegramNestService,
    private readonly clientManager: TelegramClientManager,
  ) {}

  @Get("health")
  @ApiOperation({ summary: "Check service health" })
  @ApiResponse({ status: 200, type: HealthResponseDto })
  async getHealth(): Promise<HealthResponseDto> {
    try {
      const activeClients = this.clientManager.getActiveClientCount();

      return {
        status: "healthy",
        telegram_connected: true,
        active_clients: activeClients,
      };
    } catch (error) {
      throw error;
    }
  }

  @Get("cache/stats")
  @ApiOperation({ summary: "Get cache statistics" })
  @ApiResponse({ status: 200, type: CacheStatsResponseDto })
  async getCacheStats(): Promise<CacheStatsResponseDto> {
    try {
      const stats = await this.telegramService.getCacheStats();
      return stats;
    } catch (error) {
      throw error;
    }
  }

  @Delete("cache/clear")
  @ApiOperation({ summary: "Clear all cached data" })
  @ApiResponse({ status: 200, description: "Cache cleared successfully" })
  async clearCache(): Promise<{ message: string }> {
    try {
      const success = await this.telegramService.clearCache();
      if (success) {
        return { message: "Cache cleared successfully" };
      } else {
        throw new Error("Failed to clear cache");
      }
    } catch (error) {
      throw error;
    }
  }
}
