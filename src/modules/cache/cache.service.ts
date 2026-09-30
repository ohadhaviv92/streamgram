import { Injectable, Inject } from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { ConfigService } from "@nestjs/config";

type CacheValue =
  | Record<string, unknown>
  | Array<unknown>
  | string
  | number
  | boolean
  | null;

@Injectable()
export class CacheService {
  private readonly defaultTtl: number;
  private readonly searchTtl: number;
  private readonly messageTtl: number;
  private readonly folderTtl: number;
  private readonly channelVideosTtl: number;

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private configService: ConfigService,
  ) {
    this.defaultTtl = this.configService.get<number>("cache.defaultTtl", 3600);
    this.searchTtl = this.configService.get<number>("cache.searchTtl", 1800);
    this.messageTtl = this.configService.get<number>("cache.messageTtl", 7200);
    this.folderTtl = this.configService.get<number>("cache.folderTtl", 3600);
    this.channelVideosTtl = this.configService.get<number>(
      "cache.channelVideosTtl",
      1800,
    );
  }

  private searchKey(key: string): string {
    return `search:${key}`;
  }

  private messageKey(chatId: string, messageId: number): string {
    return `stream:${chatId}+${messageId}`;
  }

  private folderKey(userToken: string): string {
    return `folders:${userToken}`;
  }

  private channelVideosKey(channelId: string, offsetId: number): string {
    return `channel_videos:${channelId}:${offsetId}`;
  }

  async get<T>(key: string): Promise<T | undefined> {
    return await this.cacheManager.get<T>(key);
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const ttlMs = ttl ? ttl * 1000 : this.defaultTtl * 1000;
    await this.cacheManager.set(key, value, ttlMs);
  }

  async del(key: string | string[]): Promise<void> {
    if (Array.isArray(key)) {
      await Promise.all(key.map((k) => this.cacheManager.del(k)));
    } else {
      await this.cacheManager.del(key);
    }
  }

  async flushAll(): Promise<void> {
    // Cache-manager v7 doesn't have a direct reset method
    // This is a limitation we'll need to document
  }

  async getStats() {
    // The process-local cache does not expose hit/miss counters.
    return {
      keys: 0,
      hits: 0,
      misses: 0,
      ksize: 0,
      vsize: 0,
    };
  }

  async getSearchResults<T>(cacheKey: string): Promise<T | null> {
    const value = await this.cacheManager.get<T>(this.searchKey(cacheKey));
    return value !== undefined ? value : null;
  }

  async setSearchResults(
    cacheKey: string,
    value: CacheValue,
  ): Promise<boolean> {
    try {
      await this.cacheManager.set(
        this.searchKey(cacheKey),
        value,
        this.searchTtl * 1000,
      );
      return true;
    } catch {
      return false;
    }
  }

  async deleteSearchResults(cacheKey: string): Promise<void> {
    await this.cacheManager.del(this.searchKey(cacheKey));
  }

  async getMessageDetails<T>(
    chatId: string,
    messageId: number,
  ): Promise<T | null> {
    const value = await this.cacheManager.get<T>(
      this.messageKey(chatId, messageId),
    );
    return value !== undefined ? value : null;
  }

  async setMessageDetails(
    chatId: string,
    messageId: number,
    value: CacheValue,
  ): Promise<boolean> {
    try {
      await this.cacheManager.set(
        this.messageKey(chatId, messageId),
        value,
        this.messageTtl * 1000,
      );
      return true;
    } catch {
      return false;
    }
  }

  async cleanup(): Promise<void> {
    // Cache-manager expires entries automatically.
  }

  async clearAll(): Promise<boolean> {
    // Cache-manager v7 doesn't have a direct reset method
    // Return true as individual deletes would need to be done
    return true;
  }

  /**
   * Get cached user folders
   */
  async getUserFolders<T>(userToken: string): Promise<T | null> {
    const value = await this.cacheManager.get<T>(this.folderKey(userToken));
    return value !== undefined ? value : null;
  }

  /**
   * Set cached user folders
   */
  async setUserFolders(userToken: string, value: CacheValue): Promise<boolean> {
    try {
      await this.cacheManager.set(
        this.folderKey(userToken),
        value,
        this.folderTtl * 1000,
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Invalidate cached user folders
   */
  async invalidateUserFolders(userToken: string): Promise<void> {
    await this.cacheManager.del(this.folderKey(userToken));
  }

  /**
   * Get cached channel videos
   */
  async getChannelVideos<T>(
    channelId: string,
    offsetId: number = 0,
  ): Promise<T | null> {
    const value = await this.cacheManager.get<T>(
      this.channelVideosKey(channelId, offsetId),
    );
    return value !== undefined ? value : null;
  }

  /**
   * Set cached channel videos
   */
  async setChannelVideos(
    channelId: string,
    offsetId: number = 0,
    value: CacheValue,
  ): Promise<boolean> {
    try {
      await this.cacheManager.set(
        this.channelVideosKey(channelId, offsetId),
        value,
        this.channelVideosTtl * 1000,
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Invalidate cached channel videos
   */
  async invalidateChannelVideos(channelId: string): Promise<void> {
    // Clear all offset variations - in production might need pattern matching
    const offsets = [0, 50, 100, 150]; // Common offsets
    await Promise.all(
      offsets.map((offset) =>
        this.cacheManager.del(this.channelVideosKey(channelId, offset)),
      ),
    );
  }
}
