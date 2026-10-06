import { Controller, Get, Delete, UseGuards } from "@nestjs/common";
import { AdminGuard } from "../management/management.guards";
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
    const activeClients = this.clientManager.getActiveClientCount();

    return {
      status: "healthy",
      telegram_connected: true,
      active_clients: activeClients,
    };
  }

  @Get("cache/stats")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Get cache statistics" })
  @ApiResponse({ status: 200, type: CacheStatsResponseDto })
  async getCacheStats(): Promise<CacheStatsResponseDto> {
    const stats = await this.telegramService.getCacheStats();
    return stats;
  }

  @Delete("cache/clear")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Clear all cached data" })
  @ApiResponse({ status: 200, description: "Cache cleared successfully" })
  async clearCache(): Promise<{ message: string }> {
    const success = await this.telegramService.clearCache();
    if (success) {
      return { message: "Cache cleared successfully" };
    } else {
      throw new Error("Failed to clear cache");
    }
  }
}
