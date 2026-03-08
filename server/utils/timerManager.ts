/**
 * timerManager.ts - v358.1 统一定时器生命周期管理器
 * 
 * 解决问题:
 * 1. 46个setInterval中有多个未保存引用，无法在shutdown时清理
 * 2. 108个setTimeout中仅4个有对应clearTimeout
 * 3. 进程重启时定时器残留导致内存泄漏
 * 
 * 设计:
 * - 全局单例管理所有定时器
 * - 自动追踪所有注册的interval和timeout
 * - 提供graceful shutdown接口一键清理
 * - 支持按模块分组管理
 */

import { createModuleLogger } from './logger';

const log = createModuleLogger('timerManager');

interface TimerEntry {
  id: NodeJS.Timeout;
  type: 'interval' | 'timeout';
  module: string;
  description: string;
  createdAt: Date;
  intervalMs?: number;
}

class TimerManager {
  private timers: Map<string, TimerEntry> = new Map();
  private counter = 0;

  /**
   * 注册一个setInterval，返回唯一key用于后续管理
   */
  registerInterval(
    module: string,
    description: string,
    callback: () => void | Promise<void>,
    intervalMs: number
  ): string {
    const key = `${module}:interval:${++this.counter}`;
    
    const wrappedCallback = async () => {
      try {
        await callback();
      } catch (err: unknown) {
        log.error(`[TimerManager] ${module}/${description} 执行异常: ${(err as Error).message}`);
      }
    };

    const id = setInterval(wrappedCallback, intervalMs);
    
    this.timers.set(key, {
      id,
      type: 'interval',
      module,
      description,
      createdAt: new Date(),
      intervalMs,
    });

    log.debug(`[TimerManager] 注册interval: ${key} (${description}, ${intervalMs}ms)`);
    return key;
  }

  /**
   * 注册一个setTimeout，返回唯一key用于后续管理
   */
  registerTimeout(
    module: string,
    description: string,
    callback: () => void | Promise<void>,
    delayMs: number
  ): string {
    const key = `${module}:timeout:${++this.counter}`;
    
    const wrappedCallback = async () => {
      try {
        await callback();
      } catch (err: unknown) {
        log.error(`[TimerManager] ${module}/${description} 执行异常: ${(err as Error).message}`);
      } finally {
        // timeout执行后自动从管理器中移除
        this.timers.delete(key);
      }
    };

    const id = setTimeout(wrappedCallback, delayMs);
    
    this.timers.set(key, {
      id,
      type: 'timeout',
      module,
      description,
      createdAt: new Date(),
    });

    log.debug(`[TimerManager] 注册timeout: ${key} (${description}, ${delayMs}ms)`);
    return key;
  }

  /**
   * 取消指定的定时器
   */
  cancel(key: string): boolean {
    const entry = this.timers.get(key);
    if (!entry) return false;

    if (entry.type === 'interval') {
      clearInterval(entry.id);
    } else {
      clearTimeout(entry.id);
    }

    this.timers.delete(key);
    log.debug(`[TimerManager] 取消定时器: ${key}`);
    return true;
  }

  /**
   * 取消指定模块的所有定时器
   */
  cancelModule(module: string): number {
    let cancelled = 0;
    for (const [key, entry] of this.timers.entries()) {
      if (entry.module === module) {
        if (entry.type === 'interval') {
          clearInterval(entry.id);
        } else {
          clearTimeout(entry.id);
        }
        this.timers.delete(key);
        cancelled++;
      }
    }
    if (cancelled > 0) {
      log.info(`[TimerManager] 取消模块 ${module} 的 ${cancelled} 个定时器`);
    }
    return cancelled;
  }

  /**
   * 优雅关闭 - 清理所有定时器
   */
  shutdown(): void {
    const count = this.timers.size;
    for (const [key, entry] of this.timers.entries()) {
      if (entry.type === 'interval') {
        clearInterval(entry.id);
      } else {
        clearTimeout(entry.id);
      }
    }
    this.timers.clear();
    log.info(`[TimerManager] 已清理全部 ${count} 个定时器`);
  }

  /**
   * 获取当前所有活跃定时器的状态
   */
  getStatus(): {
    total: number;
    intervals: number;
    timeouts: number;
    byModule: Record<string, number>;
  } {
    const byModule: Record<string, number> = {};
    let intervals = 0;
    let timeouts = 0;

    for (const entry of this.timers.values()) {
      if (entry.type === 'interval') intervals++;
      else timeouts++;
      byModule[entry.module] = (byModule[entry.module] || 0) + 1;
    }

    return {
      total: this.timers.size,
      intervals,
      timeouts,
      byModule,
    };
  }

  /**
   * 获取详细的定时器列表（用于调试）
   */
  getDetailedStatus(): Array<{
    key: string;
    type: string;
    module: string;
    description: string;
    createdAt: string;
    intervalMs?: number;
  }> {
    return Array.from(this.timers.entries()).map(([key, entry]) => ({
      key,
      type: entry.type,
      module: entry.module,
      description: entry.description,
      createdAt: entry.createdAt.toISOString(),
      intervalMs: entry.intervalMs,
    }));
  }
}

// 全局单例
export const timerManager = new TimerManager();

// 注册进程退出时的清理
process.on('SIGTERM', () => {
  log.info('[TimerManager] 收到SIGTERM信号，开始清理定时器...');
  timerManager.shutdown();
});

process.on('SIGINT', () => {
  log.info('[TimerManager] 收到SIGINT信号，开始清理定时器...');
  timerManager.shutdown();
});
