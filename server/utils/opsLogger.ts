/**
 * v210: 运维诊断日志分类索引 (Operations Logger)
 * 
 * 在现有 logger.ts（v205）基础上，提供按业务分类的日志索引。
 * logger.ts 负责底层日志收集、环形缓冲区、数据库持久化；
 * 本模块负责按运维场景分类，供诊断API快速查询。
 * 
 * 设计原则：
 * - 不重复造轮子 — 所有日志最终通过 logger 写入（控制台+DB持久化）
 * - 分类索引 — 按业务场景（迁移/守卫/优化/同步/错误/系统）建立独立缓冲区
 * - 结构化数据 — 每条日志携带结构化 data 字段，便于API返回JSON
 * - 零侵入 — 各模块通过便捷函数写入，无需修改现有logger调用
 */

import { logger } from './logger';

// ============================================================
// 类型定义
// ============================================================

export type OpsCategory = 'migration' | 'id-guard' | 'optimization' | 'sync' | 'error' | 'system';
export type OpsLevel = 'info' | 'warn' | 'error';

export interface OpsEntry {
  /** 自增序号 */
  seq: number;
  /** ISO 8601 时间戳 */
  timestamp: string;
  /** 业务分类 */
  category: OpsCategory;
  /** 日志级别 */
  level: OpsLevel;
  /** 来源模块 */
  module: string;
  /** 日志消息 */
  message: string;
  /** 结构化附加数据 */
  data?: Record<string, any>;
}

export interface OpsQuery {
  category?: OpsCategory;
  level?: OpsLevel;
  module?: string;
  keyword?: string;
  since?: string;
  until?: string;
  limit?: number;
  afterSeq?: number;
}

export interface OpsSummary {
  categoryCounts: Record<OpsCategory, number>;
  levelCounts: Record<OpsLevel, number>;
  bufferCapacity: number;
  bufferUsed: number;
  totalLogged: number;
  startedAt: string;
  latestByCategory: Record<OpsCategory, OpsEntry | null>;
}

// ============================================================
// 轻量环形缓冲区
// ============================================================

class RingBuf<T> {
  private buf: (T | undefined)[];
  private head = 0;
  private count = 0;
  constructor(private cap: number) { this.buf = new Array(cap); }
  
  push(item: T): void {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
  }
  
  toArray(): T[] {
    if (this.count === 0) return [];
    const result: T[] = [];
    const start = this.count < this.cap ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const item = this.buf[(start + i) % this.cap];
      if (item !== undefined) result.push(item);
    }
    return result;
  }
  
  latest(): T | null {
    if (this.count === 0) return null;
    return this.buf[(this.head - 1 + this.cap) % this.cap] ?? null;
  }
  
  size(): number { return this.count; }
  capacity(): number { return this.cap; }
}

// ============================================================
// 分类索引收集器
// ============================================================

const CAT_BUF = 300;
// v250: 扩容日志缓冲区从1500到5000，避免长时间运行后缓冲区溢出丢失日志
const GLOBAL_BUF = 5000;
const ALL_CATS: OpsCategory[] = ['migration', 'id-guard', 'optimization', 'sync', 'error', 'system'];

class OpsCollector {
  private catBufs = new Map<OpsCategory, RingBuf<OpsEntry>>();
  private globalBuf = new RingBuf<OpsEntry>(GLOBAL_BUF);
  private seq = 0;
  private startedAt = new Date().toISOString();
  private totalCounts: Record<OpsCategory, number> = {
    migration: 0, 'id-guard': 0, optimization: 0, sync: 0, error: 0, system: 0
  };
  private levelCounts: Record<OpsLevel, number> = { info: 0, warn: 0, error: 0 };
  
  constructor() {
    for (const cat of ALL_CATS) {
      this.catBufs.set(cat, new RingBuf<OpsEntry>(CAT_BUF));
    }
  }
  
  log(category: OpsCategory, level: OpsLevel, module: string, message: string, data?: Record<string, any>): void {
    const entry: OpsEntry = {
      seq: ++this.seq,
      timestamp: new Date().toISOString(),
      category, level, module, message, data,
    };
    
    this.catBufs.get(category)?.push(entry);
    this.globalBuf.push(entry);
    this.totalCounts[category]++;
    this.levelCounts[level]++;
    
    // 同步写入logger系统（控制台+DB持久化）
    const prefix = `[OPS:${category}]`;
    switch (level) {
      case 'error': logger.error(module, `${prefix} ${message}`, data); break;
      case 'warn':  logger.warn(module, `${prefix} ${message}`, data); break;
      default:      logger.info(module, `${prefix} ${message}`, data); break;
    }
  }
  
  query(params: OpsQuery = {}): OpsEntry[] {
    const { category, level, module, keyword, since, until, limit = 50, afterSeq } = params;
    const maxLimit = Math.min(Math.max(limit || 50, 1), 500);
    
    let entries: OpsEntry[];
    if (category) {
      entries = this.catBufs.get(category)?.toArray() || [];
    } else {
      entries = this.globalBuf.toArray();
    }
    
    if (level)   entries = entries.filter(e => e.level === level);
    if (module)  entries = entries.filter(e => e.module.toLowerCase().includes(module.toLowerCase()));
    if (keyword) {
      const kw = keyword.toLowerCase();
      entries = entries.filter(e => 
        // @ts-expect-error - error message access
        (e as Error).message.toLowerCase().includes(kw) || 
        (e.data && JSON.stringify(e.data).toLowerCase().includes(kw))
      );
    }
    if (since)    entries = entries.filter(e => e.timestamp >= since);
    if (until)    entries = entries.filter(e => e.timestamp <= until);
    if (afterSeq !== undefined) entries = entries.filter(e => e.seq > afterSeq);
    
    return entries.slice(-maxLimit).reverse();
  }
  
  getSummary(): OpsSummary {
    const latestByCategory: Record<string, OpsEntry | null> = {};
    for (const cat of ALL_CATS) {
      latestByCategory[cat] = this.catBufs.get(cat)?.latest() ?? null;
    }
    return {
      categoryCounts: { ...this.totalCounts },
      levelCounts: { ...this.levelCounts },
      bufferCapacity: GLOBAL_BUF,
      bufferUsed: this.globalBuf.size(),
      totalLogged: this.seq,
      startedAt: this.startedAt,
      latestByCategory: latestByCategory as Record<OpsCategory, OpsEntry | null>,
    };
  }
}

// ============================================================
// 单例导出
// ============================================================

export const opsCollector = new OpsCollector();

// ============================================================
// 便捷方法 — 各模块直接调用
// ============================================================

/** 记录数据迁移事件 */
export function logMigration(module: string, message: string, data?: Record<string, any>): void {
  opsCollector.log('migration', 'info', module, message, data);
}
export function logMigrationWarn(module: string, message: string, data?: Record<string, any>): void {
  opsCollector.log('migration', 'warn', module, message, data);
}
export function logMigrationError(module: string, message: string, data?: Record<string, any>): void {
  opsCollector.log('migration', 'error', module, message, data);
}

/** 记录ID守卫拦截 */
export function logIdGuard(module: string, message: string, data?: Record<string, any>): void {
  opsCollector.log('id-guard', 'warn', module, message, data);
}
export function logIdGuardError(module: string, message: string, data?: Record<string, any>): void {
  opsCollector.log('id-guard', 'error', module, message, data);
}

/** 记录优化执行 */
export function logOptimization(module: string, message: string, data?: Record<string, any>): void {
  opsCollector.log('optimization', 'info', module, message, data);
}
export function logOptimizationWarn(module: string, message: string, data?: Record<string, any>): void {
  opsCollector.log('optimization', 'warn', module, message, data);
}
export function logOptimizationError(module: string, message: string, data?: Record<string, any>): void {
  opsCollector.log('optimization', 'error', module, message, data);
}

/** 记录数据同步 */
export function logSync(module: string, message: string, data?: Record<string, any>): void {
  opsCollector.log('sync', 'info', module, message, data);
}
export function logSyncWarn(module: string, message: string, data?: Record<string, any>): void {
  opsCollector.log('sync', 'warn', module, message, data);
}
export function logSyncError(module: string, message: string, data?: Record<string, any>): void {
  opsCollector.log('sync', 'error', module, message, data);
}

/** 记录系统错误 */
export function logOpsError(module: string, message: string, data?: Record<string, any>): void {
  opsCollector.log('error', 'error', module, message, data);
}

/** 记录系统事件 */
export function logSystem(module: string, message: string, data?: Record<string, any>): void {
  opsCollector.log('system', 'info', module, message, data);
}
export function logSystemWarn(module: string, message: string, data?: Record<string, any>): void {
  opsCollector.log('system', 'warn', module, message, data);
}
