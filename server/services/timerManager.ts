/**
 * v361: 中央定时器管理服务
 * 
 * 解决系统中setInterval(190次)远超clearInterval(44次)的定时器泄漏问题。
 * 所有模块的定时任务应通过此服务注册和注销，确保在服务重启时正确清理。
 */

import { createModuleLogger } from "../utils/logger";
const log = createModuleLogger("TimerManager");

interface TimerEntry {
  id: NodeJS.Timeout;
  name: string;
  module: string;
  intervalMs: number;
  createdAt: Date;
  lastExecutedAt?: Date;
  executionCount: number;
}

class TimerManager {
  private timers: Map<string, TimerEntry> = new Map();
  private static instance: TimerManager;

  static getInstance(): TimerManager {
    if (!TimerManager.instance) {
      TimerManager.instance = new TimerManager();
    }
    return TimerManager.instance;
  }

  /**
   * 注册一个定时器，返回唯一标识符
   * @param name 定时器名称
   * @param module 所属模块名
   * @param callback 回调函数
   * @param intervalMs 间隔毫秒数
   * @param immediate 是否立即执行一次
   */
  registerInterval(
    name: string,
    module: string,
    callback: () => void | Promise<void>,
    intervalMs: number,
    immediate = false
  ): string {
    const key = `${module}:${name}`;
    
    // 如果已存在同名定时器，先清理
    if (this.timers.has(key)) {
      log.warn(`[TimerManager] 定时器 "${key}" 已存在，先清理旧实例`);
      this.unregister(key);
    }

    const wrappedCallback = async () => {
      const entry = this.timers.get(key);
      if (entry) {
        entry.lastExecutedAt = new Date();
        entry.executionCount++;
      }
      try {
        await callback();
      } catch (err: any) {
        log.error(`[TimerManager] 定时器 "${key}" 执行异常: ${err?.message || err}`);
      }
    };

    if (immediate) {
      wrappedCallback();
    }

    const timerId = setInterval(wrappedCallback, intervalMs);

    this.timers.set(key, {
      id: timerId,
      name,
      module,
      intervalMs,
      createdAt: new Date(),
      executionCount: 0,
    });

    log.debug(`[TimerManager] 注册定时器 "${key}"，间隔: ${Math.round(intervalMs / 1000)}s`);
    return key;
  }

  /**
   * 注销指定定时器
   */
  unregister(key: string): boolean {
    const entry = this.timers.get(key);
    if (entry) {
      clearInterval(entry.id);
      this.timers.delete(key);
      log.debug(`[TimerManager] 注销定时器 "${key}"，已执行 ${entry.executionCount} 次`);
      return true;
    }
    return false;
  }

  /**
   * 注销指定模块的所有定时器
   */
  unregisterModule(module: string): number {
    let count = 0;
    for (const [key, entry] of this.timers.entries()) {
      if (entry.module === module) {
        clearInterval(entry.id);
        this.timers.delete(key);
        count++;
      }
    }
    if (count > 0) {
      log.info(`[TimerManager] 注销模块 "${module}" 的 ${count} 个定时器`);
    }
    return count;
  }

  /**
   * 注销所有定时器（用于优雅关闭）
   */
  shutdown(): void {
    const count = this.timers.size;
    for (const [key, entry] of this.timers.entries()) {
      clearInterval(entry.id);
    }
    this.timers.clear();
    log.info(`[TimerManager] 已关闭所有 ${count} 个定时器`);
  }

  /**
   * 获取所有活跃定时器的状态快照
   */
  getStatus(): Array<{
    key: string;
    name: string;
    module: string;
    intervalMs: number;
    executionCount: number;
    lastExecutedAt?: Date;
    uptime: number;
  }> {
    const now = Date.now();
    return Array.from(this.timers.entries()).map(([key, entry]) => ({
      key,
      name: entry.name,
      module: entry.module,
      intervalMs: entry.intervalMs,
      executionCount: entry.executionCount,
      lastExecutedAt: entry.lastExecutedAt,
      uptime: Math.round((now - entry.createdAt.getTime()) / 1000),
    }));
  }

  /**
   * 获取活跃定时器数量
   */
  get activeCount(): number {
    return this.timers.size;
  }
}

// 导出单例
export const timerManager = TimerManager.getInstance();

// 注册进程退出时的清理
process.on('SIGTERM', () => {
  log.info('[TimerManager] 收到SIGTERM信号，清理所有定时器...');
  timerManager.shutdown();
});

process.on('SIGINT', () => {
  log.info('[TimerManager] 收到SIGINT信号，清理所有定时器...');
  timerManager.shutdown();
});
