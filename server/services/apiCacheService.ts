/**
 * v268 性能优化: API响应内存缓存服务
 * 
 * 功能：
 * 1. 为高频读取的tRPC查询提供内存级缓存
 * 2. 支持按用户ID+查询参数生成缓存键
 * 3. 支持TTL自动过期和手动失效
 * 4. 支持按前缀批量清除（账号切换时使用）
 * 5. 内置缓存命中率统计
 * 
 * 设计原则：
 * - 只缓存读取频率高、数据变化慢的查询
 * - 写操作（mutation）自动触发相关缓存失效
 * - 缓存键包含用户ID，确保数据隔离
 */
import { createModuleLogger } from '../utils/logger';
const log = createModuleLogger('ApiCache');

interface CacheEntry<T = unknown> {
  data: T;
  expireAt: number;
  createdAt: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
  size: number;
}

class ApiCacheService {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private stats: CacheStats = { hits: 0, misses: 0, sets: 0, evictions: 0, size: 0 };
  
  // 预定义的TTL配置（毫秒）
  static readonly TTL = {
    SHORT: 30 * 1000,         // 30秒 - 频繁变化的数据
    MEDIUM: 2 * 60 * 1000,    // 2分钟 - 一般数据
    LONG: 5 * 60 * 1000,      // 5分钟 - 变化较慢的数据
    VERY_LONG: 15 * 60 * 1000, // 15分钟 - 几乎不变的数据
  } as const;
  
  constructor(maxSize = 500) {
    this.maxSize = maxSize;
    
    // 每5分钟清理过期缓存
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }
  
  /**
   * 生成缓存键
   * @param prefix 查询名称前缀，如 'adAccount.listWithPerformance'
   * @param userId 用户ID，确保数据隔离
   * @param params 查询参数
   */
  generateKey(prefix: string, userId: number, params?: unknown): string {
    const paramStr = params ? JSON.stringify(params) : '';
    return `${prefix}:${userId}:${paramStr}`;
  }
  
  /**
   * 获取缓存数据
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    
    // 检查是否过期
    if (Date.now() > entry.expireAt) {
      this.cache.delete(key);
      this.stats.misses++;
      this.stats.size = this.cache.size;
      return null;
    }
    
    this.stats.hits++;
    return entry.data as T;
  }
  
  /**
   * 设置缓存数据
   */
  set<T>(key: string, data: T, ttl: number): void {
    // 如果缓存已满，执行LRU淘汰
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }
    
    this.cache.set(key, {
      data,
      expireAt: Date.now() + ttl,
      createdAt: Date.now(),
    });
    
    this.stats.sets++;
    this.stats.size = this.cache.size;
  }
  
  /**
   * 使用缓存包装异步函数
   * 如果缓存命中则直接返回，否则执行函数并缓存结果
   */
  async wrap<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }
    
    const result = await fn();
    this.set(key, result, ttl);
    return result;
  }
  
  /**
   * 删除特定缓存
   */
  delete(key: string): boolean {
    const result = this.cache.delete(key);
    this.stats.size = this.cache.size;
    return result;
  }
  
  /**
   * 按前缀批量清除缓存
   * 用于账号切换、数据更新等场景
   */
  invalidateByPrefix(prefix: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    this.stats.evictions += count;
    this.stats.size = this.cache.size;
    return count;
  }
  
  /**
   * 清除指定用户的所有缓存
   */
  invalidateByUser(userId: number): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.includes(`:${userId}:`)) {
        this.cache.delete(key);
        count++;
      }
    }
    this.stats.evictions += count;
    this.stats.size = this.cache.size;
    return count;
  }
  
  /**
   * 清空所有缓存
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.stats.evictions += size;
    this.stats.size = 0;
  }
  
  /**
   * 获取缓存统计信息
   */
  getStats(): CacheStats & { hitRate: string } {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) : '0.0';
    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
    };
  }
  
  /**
   * 淘汰最旧的缓存条目
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }
  }
  
  /**
   * 清理所有过期缓存
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expireAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.stats.evictions += cleaned;
      this.stats.size = this.cache.size;
      log.info(`[ApiCache] Cleaned ${cleaned} expired entries, ${this.cache.size} remaining`);
    }
  }
}

// 全局单例
export const apiCache = new ApiCacheService(500);

export default ApiCacheService;
