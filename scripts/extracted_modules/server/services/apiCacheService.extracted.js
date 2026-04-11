// Extracted from production dist/index.js
// Original module: server/services/apiCacheService.ts
// Lines: 183

var log151, ApiCacheService, apiCache;
var init_apiCacheService = __esm({
  "server/services/apiCacheService.ts"() {
    "use strict";
    init_logger();
    log151 = createModuleLogger("ApiCache");
    ApiCacheService = class {
      static {
        __name(this, "ApiCacheService");
      }
      cache = /* @__PURE__ */ new Map();
      maxSize;
      stats = { hits: 0, misses: 0, sets: 0, evictions: 0, size: 0 };
      // 预定义的TTL配置（毫秒）
      static TTL = {
        SHORT: 30 * 1e3,
        // 30秒 - 频繁变化的数据
        MEDIUM: 2 * 60 * 1e3,
        // 2分钟 - 一般数据
        LONG: 5 * 60 * 1e3,
        // 5分钟 - 变化较慢的数据
        VERY_LONG: 15 * 60 * 1e3
        // 15分钟 - 几乎不变的数据
      };
      constructor(maxSize = 500) {
        this.maxSize = maxSize;
        setInterval(() => this.cleanup(), 5 * 60 * 1e3);
      }
      /**
       * 生成缓存键
       * @param prefix 查询名称前缀，如 'adAccount.listWithPerformance'
       * @param userId 用户ID，确保数据隔离
       * @param params 查询参数
       */
      generateKey(prefix, userId, params) {
        const paramStr = params ? JSON.stringify(params) : "";
        return `${prefix}:${userId}:${paramStr}`;
      }
      /**
       * 获取缓存数据
       */
      get(key) {
        const entry = this.cache.get(key);
        if (!entry) {
          this.stats.misses++;
          return null;
        }
        if (Date.now() > entry.expireAt) {
          this.cache.delete(key);
          this.stats.misses++;
          this.stats.size = this.cache.size;
          return null;
        }
        this.stats.hits++;
        return entry.data;
      }
      /**
       * 设置缓存数据
       */
      set(key, data, ttl) {
        if (this.cache.size >= this.maxSize) {
          this.evictOldest();
        }
        this.cache.set(key, {
          data,
          expireAt: Date.now() + ttl,
          createdAt: Date.now()
        });
        this.stats.sets++;
        this.stats.size = this.cache.size;
      }
      /**
       * 使用缓存包装异步函数
       * 如果缓存命中则直接返回，否则执行函数并缓存结果
       */
      async wrap(key, ttl, fn) {
        const cached2 = this.get(key);
        if (cached2 !== null) {
          return cached2;
        }
        const result = await fn();
        this.set(key, result, ttl);
        return result;
      }
      /**
       * 删除特定缓存
       */
      delete(key) {
        const result = this.cache.delete(key);
        this.stats.size = this.cache.size;
        return result;
      }
      /**
       * 按前缀批量清除缓存
       * 用于账号切换、数据更新等场景
       */
      invalidateByPrefix(prefix) {
        let count11 = 0;
        for (const key of this.cache.keys()) {
          if (key.startsWith(prefix)) {
            this.cache.delete(key);
            count11++;
          }
        }
        this.stats.evictions += count11;
        this.stats.size = this.cache.size;
        return count11;
      }
      /**
       * 清除指定用户的所有缓存
       */
      invalidateByUser(userId) {
        let count11 = 0;
        for (const key of this.cache.keys()) {
          if (key.includes(`:${userId}:`)) {
            this.cache.delete(key);
            count11++;
          }
        }
        this.stats.evictions += count11;
        this.stats.size = this.cache.size;
        return count11;
      }
      /**
       * 清空所有缓存
       */
      clear() {
        const size = this.cache.size;
        this.cache.clear();
        this.stats.evictions += size;
        this.stats.size = 0;
      }
      /**
       * 获取缓存统计信息
       */
      getStats() {
        const total = this.stats.hits + this.stats.misses;
        const hitRate = total > 0 ? (this.stats.hits / total * 100).toFixed(1) : "0.0";
        return {
          ...this.stats,
          hitRate: `${hitRate}%`
        };
      }
      /**
       * 淘汰最旧的缓存条目
       */
      evictOldest() {
        let oldestKey = null;
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
      cleanup() {
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
          log151.info(`[ApiCache] Cleaned ${cleaned} expired entries, ${this.cache.size} remaining`);
        }
      }
    };
    apiCache = new ApiCacheService(500);
  }
});

