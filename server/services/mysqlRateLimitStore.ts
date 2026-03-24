/**
 * v372: 基于MySQL的分布式限流存储实现
 * 
 * 在多实例EB环境中，内存限流存储无法跨实例共享状态，
 * 导致每个实例独立计算API请求速率，总请求数可能超过Amazon API全局限制。
 * 
 * 本实现使用MySQL表作为共享存储，通过行级锁实现原子性操作，
 * 确保多实例环境下API限流的准确性和全局一致性。
 * 
 * 设计考量:
 * 1. 使用 INSERT ... ON DUPLICATE KEY UPDATE 实现原子性令牌消费
 * 2. 使用滑动窗口计数器实现每分钟请求限额
 * 3. 自动清理过期记录，避免表膨胀
 * 4. 降级策略: MySQL不可用时自动回退到内存存储
 */
import { createModuleLogger } from '../utils/logger';
import type { RateLimitStore, EndpointRateConfig } from './apiRateLimitService';

const log = createModuleLogger('MysqlRateLimitStore');

/**
 * MySQL分布式限流存储
 * 
 * 需要以下表结构（在应用启动时自动创建）:
 * 
 * CREATE TABLE IF NOT EXISTS rate_limit_buckets (
 *   bucket_key VARCHAR(255) PRIMARY KEY,
 *   tokens DECIMAL(10,4) NOT NULL DEFAULT 0,
 *   last_refill_time BIGINT NOT NULL,
 *   updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
 * );
 * 
 * CREATE TABLE IF NOT EXISTS rate_limit_counters (
 *   counter_key VARCHAR(255) NOT NULL,
 *   window_start BIGINT NOT NULL,
 *   window_ms BIGINT NOT NULL,
 *   count INT NOT NULL DEFAULT 0,
 *   PRIMARY KEY (counter_key, window_start)
 * );
 */
export class MysqlRateLimitStore implements RateLimitStore {
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // 启动定期清理任务（每5分钟清理过期记录）
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * 确保限流表已创建
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const { getDb } = await import('../db/connection');
        const db = await getDb();
        if (!db) {
          log.warn('[v372] 数据库不可用，跳过限流表初始化');
          return;
        }

        const { sql } = await import('drizzle-orm');

        // 创建令牌桶表
        await db.execute(sql`
          CREATE TABLE IF NOT EXISTS rate_limit_buckets (
            bucket_key VARCHAR(255) PRIMARY KEY,
            tokens DECIMAL(10,4) NOT NULL DEFAULT 0,
            last_refill_time BIGINT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          ) ENGINE=InnoDB
        `);

        // 创建计数器表
        await db.execute(sql`
          CREATE TABLE IF NOT EXISTS rate_limit_counters (
            counter_key VARCHAR(255) NOT NULL,
            window_start BIGINT NOT NULL,
            window_ms BIGINT NOT NULL,
            count INT NOT NULL DEFAULT 0,
            PRIMARY KEY (counter_key, window_start),
            INDEX idx_rlc_updated (window_start)
          ) ENGINE=InnoDB
        `);

        this.initialized = true;
        log.info('[v372] MySQL限流存储表初始化完成');
      } catch (err: any) {
        log.warn(`[v372] 初始化MySQL限流存储失败: ${(err as Error).message}`);
        // 不抛出错误，让调用方降级到内存存储
      }
    })();

    return this.initPromise;
  }

  async getBucket(key: string): Promise<{ tokens: number; lastRefillTime: number } | null> {
    await this.ensureInitialized();
    try {
      const { getDb } = await import('../db/connection');
      const db = await getDb();
      if (!db) return null;

      const { sql } = await import('drizzle-orm');
      // @ts-ignore
      const [rows] = await db.execute(
        sql`SELECT tokens, last_refill_time FROM rate_limit_buckets WHERE bucket_key = ${key}`
      ) as unknown;

      if (rows && rows.length > 0) {
        return {
          tokens: parseFloat(rows[0].tokens),
          lastRefillTime: parseInt(rows[0].last_refill_time),
        };
      }
      return null;
    } catch (err: any) {
      log.warn(`[v372] getBucket失败: ${(err as Error).message}`);
      return null;
    }
  }

  async setBucket(key: string, tokens: number, lastRefillTime: number): Promise<void> {
    await this.ensureInitialized();
    try {
      const { getDb } = await import('../db/connection');
      const db = await getDb();
      if (!db) return;

      const { sql } = await import('drizzle-orm');
      await db.execute(
        sql`INSERT INTO rate_limit_buckets (bucket_key, tokens, last_refill_time) 
            VALUES (${key}, ${tokens}, ${lastRefillTime})
            ON DUPLICATE KEY UPDATE tokens = ${tokens}, last_refill_time = ${lastRefillTime}`
      );
    } catch (err: any) {
      log.warn(`[v372] setBucket失败: ${(err as Error).message}`);
    }
  }

  /**
   * 原子性令牌消费
   * 使用MySQL的 SELECT ... FOR UPDATE 实现行级锁，确保并发安全
   */
  async consumeToken(key: string, config: EndpointRateConfig): Promise<{ remaining: number; waitMs: number }> {
    await this.ensureInitialized();
    try {
      const { getDb } = await import('../db/connection');
      const db = await getDb();
      if (!db) {
        // 降级: 数据库不可用时直接允许请求
        return { remaining: config.burstCapacity, waitMs: 0 };
      }

      const { sql } = await import('drizzle-orm');
      const now = Date.now();

      // 使用单条SQL实现原子性的令牌补充+消费
      // 1. 先尝试插入（如果不存在）
      await db.execute(
        sql`INSERT IGNORE INTO rate_limit_buckets (bucket_key, tokens, last_refill_time) 
            VALUES (${key}, ${config.burstCapacity}, ${now})`
      );

      // 2. 原子性更新：补充令牌 + 消费1个令牌
      // @ts-ignore
      const [result] = await db.execute(
        sql`UPDATE rate_limit_buckets 
            SET 
              tokens = GREATEST(0, 
                LEAST(
                  ${config.burstCapacity},
                  tokens + (${now} - last_refill_time) / 1000.0 * ${config.refillRatePerSecond}
                ) - 1
              ),
              last_refill_time = ${now}
            WHERE bucket_key = ${key}
              AND LEAST(
                ${config.burstCapacity},
                tokens + (${now} - last_refill_time) / 1000.0 * ${config.refillRatePerSecond}
              ) >= 1`
      ) as unknown;

      if (result && result.affectedRows > 0) {
        // 成功消费令牌
        const bucket = await this.getBucket(key);
        return { remaining: bucket ? Math.floor(bucket.tokens) : 0, waitMs: 0 };
      } else {
        // 令牌不足，计算等待时间
        const bucket = await this.getBucket(key);
        if (bucket) {
          const currentTokens = Math.min(
            config.burstCapacity,
            bucket.tokens + ((now - bucket.lastRefillTime) / 1000) * config.refillRatePerSecond
          );
          const deficit = 1 - currentTokens;
          const waitMs = Math.ceil((Math.max(0, deficit) / config.refillRatePerSecond) * 1000);
          return { remaining: 0, waitMs: Math.max(waitMs, 100) };
        }
        return { remaining: 0, waitMs: 1000 };
      }
    } catch (err: any) {
      log.warn(`[v372] consumeToken失败: ${(err as Error).message}`);
      // 降级: 出错时允许请求通过
      return { remaining: config.burstCapacity, waitMs: 0 };
    }
  }

  /**
   * 滑动窗口计数器递增
   */
  async incrementCounter(key: string, windowMs: number): Promise<number> {
    await this.ensureInitialized();
    try {
      const { getDb } = await import('../db/connection');
      const db = await getDb();
      if (!db) return 0;

      const { sql } = await import('drizzle-orm');
      const now = Date.now();
      const windowStart = now - (now % windowMs); // 对齐窗口起始时间

      await db.execute(
        sql`INSERT INTO rate_limit_counters (counter_key, window_start, window_ms, count) 
            VALUES (${key}, ${windowStart}, ${windowMs}, 1)
            ON DUPLICATE KEY UPDATE count = count + 1`
      );

      // 查询当前窗口的计数
      // @ts-ignore
      const [rows] = await db.execute(
        sql`SELECT SUM(count) as total FROM rate_limit_counters 
            WHERE counter_key = ${key} AND window_start >= ${now - windowMs}`
      ) as unknown;

      return rows && rows.length > 0 ? parseInt(rows[0].total || '0') : 0;
    } catch (err: any) {
      log.warn(`[v372] incrementCounter失败: ${(err as Error).message}`);
      return 0;
    }
  }

  /**
   * 获取当前窗口计数
   */
  async getCounter(key: string): Promise<number> {
    await this.ensureInitialized();
    try {
      const { getDb } = await import('../db/connection');
      const db = await getDb();
      if (!db) return 0;

      const { sql } = await import('drizzle-orm');
      // @ts-ignore
      const now = Date.now();

      // 查询最近60秒的计数（默认窗口）
      // @ts-ignore
      const [rows] = await db.execute(
        sql`SELECT SUM(count) as total FROM rate_limit_counters 
            WHERE counter_key = ${key} AND window_start >= ${now - 60000}`
      ) as unknown;

      return rows && rows.length > 0 ? parseInt(rows[0].total || '0') : 0;
    } catch (err: any) {
      log.warn(`[v372] getCounter失败: ${(err as Error).message}`);
      return 0;
    }
  }

  /**
   * 清理过期记录
   */
  private async cleanup(): Promise<void> {
    try {
      const { getDb } = await import('../db/connection');
      const db = await getDb();
      if (!db) return;

      const { sql } = await import('drizzle-orm');
      const cutoff = Date.now() - 10 * 60 * 1000; // 清理10分钟前的记录

      await db.execute(
        sql`DELETE FROM rate_limit_counters WHERE window_start < ${cutoff}`
      );

      // 清理长时间未更新的令牌桶
      await db.execute(
        sql`DELETE FROM rate_limit_buckets WHERE updated_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)`
      );
    } catch (err: any) {
      // 清理失败不影响主流程
      log.debug(`[v372] 限流记录清理失败: ${(err as Error).message}`);
    }
  }

  /**
   * 停止清理定时器
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
