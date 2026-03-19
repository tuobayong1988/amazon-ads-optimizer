/**
 * v427: 基于 Redis 的分布式锁服务
 * 
 * 使用 Redis SET NX EX 实现分布式互斥锁（Redlock 单节点简化版）。
 * 
 * 优势（相比 MySQL sync_locks 表）：
 * - 性能：Redis 操作延迟 <1ms，MySQL 需要 5-50ms
 * - 原子性：SET NX EX 是原子操作，无需额外清理过期锁
 * - 可靠性：Redis TTL 自动过期，不依赖定时清理任务
 * - 可扩展：支持未来升级到 Redlock 多节点方案
 * 
 * 降级策略：
 * - Redis 不可用时自动降级到 MySQL sync_locks 表锁
 * - MySQL 也不可用时降级到内存锁
 * 
 * 使用方式：
 * ```
 * const lock = new RedisDistributedLock('sync-engine');
 * const release = await lock.acquire(60000); // 60秒超时
 * if (!release) { return; } // 获取失败
 * try { ... } finally { await release(); }
 * ```
 */
import { createModuleLogger } from './logger';
import { ensureRedis, getRedis } from './redisClient';
import { v4 as uuidv4 } from 'uuid';

const log = createModuleLogger('RedisLock');

// 进程实例ID
const INSTANCE_ID = `inst-${process.pid}-${Date.now().toString(36)}`;

// Redis 锁的键前缀
const LOCK_PREFIX = 'lock:';

// Lua 脚本：原子性释放锁（只有持有者才能释放）
const RELEASE_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

// Lua 脚本：原子性续期锁（只有持有者才能续期）
const RENEW_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ARGV[2])
  else
    return 0
  end
`;

export class RedisDistributedLock {
  private lockKey: string;
  private holderId: string;
  private renewTimer: ReturnType<typeof setInterval> | null = null;

  constructor(name: string) {
    this.lockKey = `${LOCK_PREFIX}${name}`;
    this.holderId = `${INSTANCE_ID}-${uuidv4().substring(0, 8)}`;
  }

  /**
   * 获取分布式锁
   * @param timeoutMs 锁的最大持有时间（毫秒），超时后自动过期
   * @param waitMs 等待获取锁的最大时间（毫秒），0表示不等待
   * @param retryIntervalMs 重试间隔（毫秒）
   * @returns 释放函数，如果获取失败返回 null
   */
  async acquire(
    timeoutMs: number = 30000,
    waitMs: number = 0,
    retryIntervalMs: number = 200
  ): Promise<(() => Promise<void>) | null> {
    // 确保 Redis 已初始化
    await ensureRedis();
    const redis = getRedis();

    if (!redis) {
      // Redis 不可用，降级到 MySQL 分布式锁
      return this.fallbackToMySQL(timeoutMs, waitMs);
    }

    const startTime = Date.now();

    while (true) {
      try {
        // SET key value NX PX timeoutMs（原子操作）
        const result = await redis.set(
          this.lockKey,
          this.holderId,
          'PX', timeoutMs,
          'NX'
        );

        if (result === 'OK') {
          // 锁获取成功
          log.info(`Redis锁 "${this.lockKey}" 已获取 (holder: ${this.holderId}, timeout: ${timeoutMs}ms)`);

          // 启动自动续期（在锁过期前 1/3 时间续期）
          const renewInterval = Math.max(timeoutMs / 3, 5000);
          this.startAutoRenew(timeoutMs, renewInterval);

          // 返回释放函数
          const lockKey = this.lockKey;
          const holderId = this.holderId;
          const self = this;
          return async () => {
            self.stopAutoRenew();
            try {
              const released = await redis.eval(
                RELEASE_SCRIPT,
                1,
                lockKey,
                holderId
              );
              if (released === 1) {
                log.info(`Redis锁 "${lockKey}" 已释放 (holder: ${holderId})`);
              } else {
                log.warn(`Redis锁 "${lockKey}" 释放失败（可能已过期或被其他持有者释放）`);
              }
            } catch (e: unknown) {
              log.warn(`释放Redis锁 "${lockKey}" 异常: ${(e as Error).message}`);
            }
          };
        }

        // 锁已被占用
        const elapsed = Date.now() - startTime;
        if (waitMs <= 0 || elapsed >= waitMs) {
          log.debug(`Redis锁 "${this.lockKey}" 已被占用，获取失败`);
          return null;
        }

        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, retryIntervalMs));
      } catch (e: unknown) {
        log.warn(`获取Redis锁 "${this.lockKey}" 异常: ${(e as Error).message}`);
        // Redis 操作异常，降级到 MySQL
        return this.fallbackToMySQL(timeoutMs, waitMs);
      }
    }
  }

  /**
   * 尝试获取锁（不等待）
   */
  async tryAcquire(timeoutMs: number = 30000): Promise<(() => Promise<void>) | null> {
    return this.acquire(timeoutMs, 0);
  }

  /**
   * 续期锁（延长过期时间）
   */
  async renew(additionalMs: number = 30000): Promise<boolean> {
    const redis = getRedis();
    if (!redis) return false;

    try {
      const result = await redis.eval(
        RENEW_SCRIPT,
        1,
        this.lockKey,
        this.holderId,
        String(additionalMs)
      );
      if (result === 1) {
        log.debug(`Redis锁 "${this.lockKey}" 已续期 ${additionalMs}ms`);
        return true;
      }
      log.warn(`Redis锁 "${this.lockKey}" 续期失败（可能已过期或被释放）`);
      return false;
    } catch (e: unknown) {
      log.warn(`Redis锁 "${this.lockKey}" 续期异常: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * 检查锁是否被持有
   */
  async isLocked(): Promise<boolean> {
    const redis = getRedis();
    if (!redis) return false;

    try {
      const value = await redis.get(this.lockKey);
      return value !== null;
    } catch {
      return false;
    }
  }

  /**
   * 强制释放锁（管理员操作）
   */
  async forceRelease(): Promise<boolean> {
    const redis = getRedis();
    if (!redis) return false;

    try {
      await redis.del(this.lockKey);
      log.warn(`Redis锁 "${this.lockKey}" 被强制释放`);
      return true;
    } catch (e: unknown) {
      log.warn(`强制释放Redis锁 "${this.lockKey}" 失败: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * 启动自动续期定时器
   */
  private startAutoRenew(timeoutMs: number, intervalMs: number): void {
    this.stopAutoRenew();
    this.renewTimer = setInterval(async () => {
      const success = await this.renew(timeoutMs);
      if (!success) {
        log.warn(`Redis锁 "${this.lockKey}" 自动续期失败，停止续期`);
        this.stopAutoRenew();
      }
    }, intervalMs);
    // 确保定时器不阻止进程退出
    if (this.renewTimer && typeof this.renewTimer === 'object' && 'unref' in this.renewTimer) {
      (this.renewTimer as NodeJS.Timeout).unref();
    }
  }

  /**
   * 停止自动续期
   */
  private stopAutoRenew(): void {
    if (this.renewTimer) {
      clearInterval(this.renewTimer);
      this.renewTimer = null;
    }
  }

  /**
   * 降级到 MySQL 分布式锁
   */
  private async fallbackToMySQL(
    timeoutMs: number,
    waitMs: number
  ): Promise<(() => Promise<void>) | null> {
    log.info(`Redis锁 "${this.lockKey}" 降级到 MySQL 锁`);
    try {
      const { DistributedLock } = await import('./distributedLock');
      const mysqlLock = new DistributedLock(this.lockKey.replace(LOCK_PREFIX, ''));
      return mysqlLock.acquire(timeoutMs, waitMs);
    } catch (e: unknown) {
      log.warn(`MySQL 锁也不可用: ${(e as Error).message}`);
      // 最终降级：返回空释放函数（无锁模式）
      return async () => {};
    }
  }
}

/**
 * 使用 Redis 分布式锁执行操作的便捷函数
 */
export async function withRedisLock<T>(
  name: string,
  fn: () => Promise<T>,
  timeoutMs: number = 30000
): Promise<T | null> {
  const lock = new RedisDistributedLock(name);
  const release = await lock.tryAcquire(timeoutMs);
  if (!release) {
    log.warn(`无法获取Redis锁 "${name}"，操作被跳过`);
    return null;
  }
  try {
    return await fn();
  } finally {
    await release();
  }
}

/**
 * 获取所有活跃 Redis 锁的状态（用于监控）
 */
export async function getAllRedisLockStatus(): Promise<Array<{
  lockKey: string;
  holderId: string;
  ttlMs: number;
}>> {
  const redis = getRedis();
  if (!redis) return [];

  try {
    // 扫描所有锁键
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, foundKeys] = await redis.scan(
        cursor,
        'MATCH', `${LOCK_PREFIX}*`,
        'COUNT', '100'
      );
      cursor = nextCursor;
      keys.push(...foundKeys);
    } while (cursor !== '0');

    if (keys.length === 0) return [];

    // 批量获取锁信息
    const pipeline = redis.pipeline();
    for (const key of keys) {
      pipeline.get(key);
      pipeline.pttl(key);
    }
    const results = await pipeline.exec();
    if (!results) return [];

    const locks: Array<{ lockKey: string; holderId: string; ttlMs: number }> = [];
    for (let i = 0; i < keys.length; i++) {
      const holderId = results[i * 2]?.[1] as string | null;
      const ttlMs = results[i * 2 + 1]?.[1] as number;
      if (holderId) {
        locks.push({
          lockKey: keys[i].replace(LOCK_PREFIX, ''),
          holderId,
          ttlMs: ttlMs > 0 ? ttlMs : 0,
        });
      }
    }
    return locks;
  } catch (e: unknown) {
    log.warn(`获取Redis锁状态失败: ${(e as Error).message}`);
    return [];
  }
}
