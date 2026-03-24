/**
 * AsyncMutex - 进程级异步互斥锁
 * 
 * 用于防止同一进程内的并发操作冲突（如同步任务重入）。
 * 当前为单进程内存锁实现，未来可替换为 Redis 分布式锁以支持多进程/集群部署。
 * 
 * @example
 * const mutex = new AsyncMutex('sync-engine');
 * const release = await mutex.acquire(30000); // 30秒超时
 * if (!release) {
 *   console.log('获取锁失败，另一个任务正在运行');
 *   return;
 * }
 * try {
 *   // 执行互斥操作
 * } finally {
 *   release();
 * }
 */

import { createModuleLogger } from './logger';

const log = createModuleLogger('AsyncMutex');

interface LockEntry {
  holder: string;
  acquiredAt: Date;
  timeoutMs: number;
  timeoutHandle?: NodeJS.Timeout;
}

const locks = new Map<string, LockEntry>();
const waitQueues = new Map<string, Array<{
  resolve: (release: (() => void) | null) => void;
  holder: string;
  timeoutMs: number;
}>>();

/**
 * 检查锁是否已过期（防止死锁）
 */
function isLockExpired(entry: LockEntry): boolean {
  const elapsed = Date.now() - entry.acquiredAt.getTime();
  return elapsed > entry.timeoutMs;
}

/**
 * 释放锁并通知等待队列中的下一个
 */
function releaseLock(name: string): void {
  const entry = locks.get(name);
  if (entry?.timeoutHandle) {
    clearTimeout(entry.timeoutHandle);
  }
  locks.delete(name);

  // 通知等待队列中的下一个
  const queue = waitQueues.get(name);
  if (queue && queue.length > 0) {
    const next = queue.shift()!;
    grantLock(name, next.holder, next.timeoutMs, next.resolve);
  }
}

/**
 * 授予锁
 */
function grantLock(
  name: string,
  holder: string,
  timeoutMs: number,
  resolve: (release: (() => void) | null) => void
): void {
  const entry: LockEntry = {
    holder,
    acquiredAt: new Date(),
    timeoutMs,
  };

  // 设置超时自动释放（防止死锁）
  entry.timeoutHandle = setTimeout(() => {
    log.warn(`锁 "${name}" 超时自动释放 (holder: ${holder}, timeout: ${timeoutMs}ms)`);
    releaseLock(name);
  }, timeoutMs);

  locks.set(name, entry);
  resolve(() => releaseLock(name));
}

export class AsyncMutex {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * 获取互斥锁
   * @param timeoutMs 锁的最大持有时间（毫秒），超时后自动释放防止死锁
   * @param waitMs 等待获取锁的最大时间（毫秒），0表示不等待（tryLock语义）
   * @returns 释放函数，如果获取失败返回 null
   */
  async acquire(timeoutMs: number = 30000, waitMs: number = 0): Promise<(() => void) | null> {
    const existing = locks.get(this.name);

    // 如果锁已被持有
    if (existing) {
      // 检查是否过期
      if (isLockExpired(existing)) {
        log.warn(`锁 "${this.name}" 已过期，强制释放 (holder: ${existing.holder})`);
        releaseLock(this.name);
      } else if (waitMs <= 0) {
        // 不等待模式，直接返回null
        return null;
      } else {
        // 等待模式
        return new Promise<(() => void) | null>((resolve) => {
          const holder = `waiter-${Date.now()}`;

          // 加入等待队列
          if (!waitQueues.has(this.name)) {
            waitQueues.set(this.name, []);
          }
          const queue = waitQueues.get(this.name)!;
          const waiter = { resolve, holder, timeoutMs };
          queue.push(waiter);

          // 等待超时
          setTimeout(() => {
            const idx = queue.indexOf(waiter);
            if (idx !== -1) {
              queue.splice(idx, 1);
              resolve(null);
            }
          }, waitMs);
        });
      }
    }

    // 锁空闲，直接获取
    return new Promise<(() => void) | null>((resolve) => {
      grantLock(this.name, `holder-${Date.now()}`, timeoutMs, resolve);
    });
  }

  /**
   * 尝试获取锁（不等待）
   * @returns 释放函数，如果锁已被持有返回 null
   */
  async tryAcquire(timeoutMs: number = 30000): Promise<(() => void) | null> {
    return this.acquire(timeoutMs, 0);
  }

  /**
   * 检查锁是否被持有
   */
  isLocked(): boolean {
    const entry = locks.get(this.name);
    if (!entry) return false;
    if (isLockExpired(entry)) {
      releaseLock(this.name);
      return false;
    }
    return true;
  }

  /**
   * 获取锁的状态信息
   */
  getStatus(): { locked: boolean; holder?: string; acquiredAt?: Date; waitQueueSize: number } {
    const entry = locks.get(this.name);
    const queue = waitQueues.get(this.name);
    if (!entry || isLockExpired(entry)) {
      return { locked: false, waitQueueSize: queue?.length || 0 };
    }
    return {
      locked: true,
      holder: entry.holder,
      acquiredAt: entry.acquiredAt,
      waitQueueSize: queue?.length || 0,
    };
  }
}

/**
 * 使用互斥锁执行操作的便捷函数
 * @param name 锁名称
 * @param fn 要执行的异步函数
 * @param timeoutMs 锁超时时间
 * @returns 函数返回值，如果获取锁失败返回 null
 */
export async function withMutex<T>(
  name: string,
  fn: () => Promise<T>,
  timeoutMs: number = 30000
): Promise<T | null> {
  const mutex = new AsyncMutex(name);
  const release = await mutex.tryAcquire(timeoutMs);
  if (!release) {
    log.warn(`无法获取锁 "${name}"，操作被跳过`);
    return null;
  }
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * 获取所有活跃锁的状态（用于监控/调试）
 */
export function getAllLockStatus(): Record<string, { holder: string; acquiredAt: Date; elapsed: number; waitQueueSize: number }> {
  const status: Record<string, unknown> = {};
  for (const [name, entry] of locks.entries()) {
    if (!isLockExpired(entry)) {
      const queue = waitQueues.get(name);
      status[name] = {
        holder: entry.holder,
        acquiredAt: entry.acquiredAt,
        elapsed: Date.now() - entry.acquiredAt.getTime(),
        waitQueueSize: queue?.length || 0,
      };
    }
  }
  // @ts-ignore
  return status;
}
