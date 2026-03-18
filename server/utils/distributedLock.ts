/**
 * v426: 基于MySQL的分布式锁服务
 * 
 * 使用 sync_locks 表实现分布式互斥锁，替代内存锁 AsyncMutex。
 * 
 * 优势：
 * - 支持多实例部署（进程重启后锁状态不丢失）
 * - 自动过期防止死锁
 * - 可通过SQL查询监控锁状态
 * - 未来可无缝切换到Redis实现
 * 
 * 使用方式：
 * ```
 * const lock = new DistributedLock('sync-engine');
 * const release = await lock.acquire(60000); // 60秒超时
 * if (!release) { return; } // 获取失败
 * try { ... } finally { release(); }
 * ```
 */
import { getDb } from '../db';
import { sql } from 'drizzle-orm';
import { createModuleLogger } from './logger';
import { v4 as uuidv4 } from 'uuid';
import { extractCount, extractRows, getAffectedRows } from '../types/utilTypes';

const log = createModuleLogger('DistributedLock');

// 进程实例ID（每次启动生成唯一ID）
const INSTANCE_ID = `inst-${process.pid}-${Date.now().toString(36)}`;

/**
 * 确保 sync_locks 表存在（自动创建）
 */
let tableEnsured = false;
async function ensureTable(): Promise<boolean> {
  if (tableEnsured) return true;
  try {
    const database = await getDb();
    await database.execute(sql`
      CREATE TABLE IF NOT EXISTS sync_locks (
        id INT AUTO_INCREMENT NOT NULL PRIMARY KEY,
        lock_key VARCHAR(128) NOT NULL,
        holder_id VARCHAR(64) NOT NULL,
        acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        UNIQUE KEY uk_lock_key (lock_key),
        INDEX idx_sync_locks_expires_at (expires_at)
      )
    `);
    tableEnsured = true;
    return true;
  } catch (e: unknown) {
    log.error(`创建sync_locks表失败: ${(e as Error).message}`);
    return false;
  }
}

/**
 * 清理所有过期锁
 */
async function cleanupExpiredLocks(): Promise<number> {
  try {
    const database = await getDb();
    const result = await database.execute(sql`
      DELETE FROM sync_locks WHERE expires_at <= NOW()
    `);
    const deleted = getAffectedRows(result);
    if (deleted > 0) {
      log.info(`清理了 ${deleted} 个过期锁`);
    }
    return deleted;
  } catch (e: unknown) {
    log.debug(`清理过期锁失败: ${(e as Error).message}`);
    return 0;
  }
}

export class DistributedLock {
  private lockKey: string;
  private holderId: string;

  constructor(name: string) {
    this.lockKey = name;
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
    retryIntervalMs: number = 1000
  ): Promise<(() => Promise<void>) | null> {
    const tableReady = await ensureTable();
    if (!tableReady) {
      // 表创建失败，回退到尝试直接操作
      log.warn(`sync_locks表不可用，锁 "${this.lockKey}" 回退到无锁模式`);
      return async () => {};
    }

    const startTime = Date.now();
    
    while (true) {
      try {
        // 先清理过期锁
        await cleanupExpiredLocks();

        // 尝试插入锁记录（利用UNIQUE约束实现互斥）
        const expiresAtMs = Date.now() + timeoutMs;
        const expiresAt = new Date(expiresAtMs).toISOString().slice(0, 19).replace('T', ' ');
        
        const db = await getDb();
        await db.execute(sql`
          INSERT INTO sync_locks (lock_key, holder_id, acquired_at, expires_at)
          VALUES (${this.lockKey}, ${this.holderId}, NOW(), ${expiresAt})
        `);

        log.info(`锁 "${this.lockKey}" 已获取 (holder: ${this.holderId}, timeout: ${timeoutMs}ms)`);

        // 设置本地超时提醒
        const localTimeout = setTimeout(() => {
          log.warn(`锁 "${this.lockKey}" 即将过期 (holder: ${this.holderId})`);
        }, timeoutMs - 5000);

        // 返回释放函数
        const lockKey = this.lockKey;
        const holderId = this.holderId;
        return async () => {
          clearTimeout(localTimeout);
          try {
            const db = await getDb();
            await db.execute(sql`
              DELETE FROM sync_locks 
              WHERE lock_key = ${lockKey} AND holder_id = ${holderId}
            `);
            log.info(`锁 "${lockKey}" 已释放 (holder: ${holderId})`);
          } catch (e: unknown) {
            log.error(`释放锁 "${lockKey}" 失败: ${(e as Error).message}`);
          }
        };
      } catch (e: unknown) {
        const errorMsg = (e as Error).message || '';
        
        // 如果是UNIQUE约束冲突（锁已被持有）
        if (errorMsg.includes('Duplicate') || errorMsg.includes('ER_DUP_ENTRY')) {
          const elapsed = Date.now() - startTime;
          
          if (waitMs <= 0 || elapsed >= waitMs) {
            // 不等待或等待超时
            log.debug(`锁 "${this.lockKey}" 已被占用，获取失败`);
            return null;
          }
          
          // 等待后重试
          await new Promise(resolve => setTimeout(resolve, retryIntervalMs));
          continue;
        }
        
        // 其他错误
        log.error(`获取锁 "${this.lockKey}" 异常: ${errorMsg}`);
        // 回退到无锁模式，避免阻塞业务
        return async () => {};
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
    try {
      const db = await getDb();
      const result = await db.execute(sql`
        UPDATE sync_locks 
        SET expires_at = DATE_ADD(NOW(), INTERVAL ${Math.ceil(additionalMs / 1000)} SECOND)
        WHERE lock_key = ${this.lockKey} AND holder_id = ${this.holderId}
      `);
      const affected = getAffectedRows(result);
      if (affected > 0) {
        log.debug(`锁 "${this.lockKey}" 已续期 ${additionalMs}ms`);
        return true;
      }
      log.warn(`锁 "${this.lockKey}" 续期失败（可能已过期或被释放）`);
      return false;
    } catch (e: unknown) {
      log.error(`锁 "${this.lockKey}" 续期异常: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * 检查锁是否被持有
   */
  async isLocked(): Promise<boolean> {
    try {
      const db = await getDb();
      const result = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM sync_locks 
        WHERE lock_key = ${this.lockKey} AND expires_at > NOW()
      `);
      const count = extractCount(result);
      return count > 0;
    } catch {
      return false;
    }
  }

  /**
   * 强制释放锁（管理员操作）
   */
  async forceRelease(): Promise<boolean> {
    try {
      const db = await getDb();
      await db.execute(sql`
        DELETE FROM sync_locks WHERE lock_key = ${this.lockKey}
      `);
      log.warn(`锁 "${this.lockKey}" 被强制释放`);
      return true;
    } catch (e: unknown) {
      log.error(`强制释放锁 "${this.lockKey}" 失败: ${(e as Error).message}`);
      return false;
    }
  }
}

/**
 * 使用分布式锁执行操作的便捷函数
 */
export async function withDistributedLock<T>(
  name: string,
  fn: () => Promise<T>,
  timeoutMs: number = 30000
): Promise<T | null> {
  const lock = new DistributedLock(name);
  const release = await lock.tryAcquire(timeoutMs);
  if (!release) {
    log.warn(`无法获取分布式锁 "${name}"，操作被跳过`);
    return null;
  }
  try {
    return await fn();
  } finally {
    await release();
  }
}

/**
 * 获取所有活跃锁的状态（用于监控）
 */
export async function getAllDistributedLockStatus(): Promise<Array<{
  lockKey: string;
  holderId: string;
  acquiredAt: string;
  expiresAt: string;
  remainingMs: number;
}>> {
  try {
    await ensureTable();
    const database = await getDb();
    const result = await database.execute(sql`
      SELECT lock_key, holder_id, acquired_at, expires_at,
        TIMESTAMPDIFF(SECOND, NOW(), expires_at) * 1000 as remaining_ms
      FROM sync_locks
      WHERE expires_at > NOW()
      ORDER BY acquired_at DESC
    `);
    const rows = extractRows(result);
    return (rows as any[]).map(row => ({
      lockKey: row.lock_key,
      holderId: row.holder_id,
      acquiredAt: row.acquired_at,
      expiresAt: row.expires_at,
      remainingMs: Number(row.remaining_ms) || 0,
    }));
  } catch {
    return [];
  }
}

// 启动时定期清理过期锁（每5分钟）
setInterval(async () => {
  try {
    await cleanupExpiredLocks();
  } catch {
    // 静默处理
  }
}, 5 * 60 * 1000);
