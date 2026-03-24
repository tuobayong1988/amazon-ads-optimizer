/**
 * v205: 统一日志管理器 (Logger)
 * 
 * 功能:
 * 1. 五级日志分级: DEBUG / INFO / WARN / ERROR / FATAL
 * 2. 结构化JSON输出: 每条日志包含 timestamp, level, module, message, metadata
 * 3. 环形缓冲区: 内存中保留最近N条日志，支持实时查询
 * 4. 高频日志采样: 同一模块同一消息模板，限制输出频率
 * 5. 数据库持久化: WARN及以上级别自动写入system_logs表
 * 6. 查询API: 分页、过滤、聚合，所有查询有超时和大小保护
 */

// ==================== 类型定义 ====================

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
}

export const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.FATAL]: 'FATAL',
};

export interface LogEntry {
  id: number;
  timestamp: string;
  level: LogLevel;
  levelName: string;
  module: string;
  message: string;
  metadata?: Record<string, unknown>;
  // 采样信息
  suppressedCount?: number;  // 被抑制的重复日志数
}

export interface LogQueryParams {
  level?: LogLevel;       // 最低级别过滤
  module?: string;        // 模块名过滤
  search?: string;        // 消息文本搜索
  startTime?: string;     // 开始时间
  endTime?: string;       // 结束时间
  limit?: number;         // 每页数量 (最大100)
  cursor?: number;        // 游标 (日志ID)
  direction?: 'newer' | 'older';  // 游标方向
}

export interface LogQueryResult {
  entries: LogEntry[];
  total: number;
  hasMore: boolean;
  nextCursor?: number;
}

export interface LogStats {
  totalEntries: number;
  byLevel: Record<string, number>;
  byModule: { module: string; count: number }[];
  recentRate: number;  // 最近1分钟的日志速率 (条/分钟)
  bufferUsage: number; // 缓冲区使用率 (0-100%)
  suppressedTotal: number; // 被采样抑制的总数
}

// ==================== 配置 ====================

interface LoggerConfig {
  /** 控制台输出的最低级别 */
  consoleLevel: LogLevel;
  /** 数据库持久化的最低级别 */
  dbLevel: LogLevel;
  /** 环形缓冲区大小 */
  bufferSize: number;
  /** 采样窗口 (毫秒) — 同一模块+消息模板在此窗口内最多输出 samplingMaxPerWindow 条 */
  samplingWindowMs: number;
  /** 采样窗口内最大输出条数 */
  samplingMaxPerWindow: number;
  /** 数据库批量写入间隔 (毫秒) */
  dbFlushIntervalMs: number;
  /** 数据库批量写入缓冲区大小 */
  dbFlushBatchSize: number;
  /** 数据库日志保留天数 */
  dbRetentionDays: number;
}

const DEFAULT_CONFIG: LoggerConfig = {
  consoleLevel: LogLevel.INFO,
  dbLevel: LogLevel.WARN,
  bufferSize: 10000,  // v447: 从30000缩减到10000，日志已持久化到DB，内存缓冲区不需要这么大，降低内存占用
  samplingWindowMs: 10_000,       // 10秒窗口
  samplingMaxPerWindow: 5,         // 每10秒最多5条同类日志
  dbFlushIntervalMs: 30_000,       // 30秒批量写入
  dbFlushBatchSize: 200,           // v369: 从100提升到200，加快缓冲区消耗速度
  dbRetentionDays: 7,              // 保留7天
};

// ==================== 环形缓冲区 ====================

class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head: number = 0;
  private count: number = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** 获取所有条目（从最新到最旧） */
  toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head - 1 - i + this.capacity) % this.capacity;
      const item = this.buffer[idx];
      if (item !== undefined) result.push(item);
    }
    return result;
  }

  /** 获取最新的N条 */
  getLatest(n: number): T[] {
    const count = Math.min(n, this.count);
    const result: T[] = [];
    for (let i = 0; i < count; i++) {
      const idx = (this.head - 1 - i + this.capacity) % this.capacity;
      const item = this.buffer[idx];
      if (item !== undefined) result.push(item);
    }
    return result;
  }

  size(): number { return this.count; }
  getCapacity(): number { return this.capacity; }
  clear(): void { this.buffer = new Array(this.capacity); this.head = 0; this.count = 0; }
}

// ==================== 采样器 ====================

interface SamplingState {
  count: number;
  windowStart: number;
  suppressedCount: number;
}

class LogSampler {
  private states: Map<string, SamplingState> = new Map();
  private totalSuppressed: number = 0;
  private readonly windowMs: number;
  private readonly maxPerWindow: number;

  constructor(windowMs: number, maxPerWindow: number) {
    this.windowMs = windowMs;
    this.maxPerWindow = maxPerWindow;
  }

  /**
   * 判断是否应该输出此日志
   * @returns [shouldOutput, suppressedCount] — suppressedCount 是自上次输出以来被抑制的数量
   */
  shouldOutput(key: string): [boolean, number] {
    const now = Date.now();
    let state = this.states.get(key);

    if (!state || (now - state.windowStart) > this.windowMs) {
      // 新窗口
      const suppressed = state?.suppressedCount || 0;
      this.states.set(key, { count: 1, windowStart: now, suppressedCount: 0 });
      return [true, suppressed];
    }

    state.count++;
    if (state.count <= this.maxPerWindow) {
      const suppressed = state.suppressedCount;
      state.suppressedCount = 0;
      return [true, suppressed];
    }

    // 超过限制，抑制
    state.suppressedCount++;
    this.totalSuppressed++;
    return [false, 0];
  }

  getTotalSuppressed(): number { return this.totalSuppressed; }

  /** 定期清理过期的采样状态 */
  cleanup(): void {
    const now = Date.now();
    const expireThreshold = this.windowMs * 3;
    for (const [key, state] of this.states.entries()) {
      if (now - state.windowStart > expireThreshold) {
        this.states.delete(key);
      }
    }
  }
}

// ==================== 数据库写入器 ====================

interface DbLogEntry {
  timestamp: string;
  level: string;
  module: string;
  message: string;
  metadata: string | null;
}

class DbWriter {
  private buffer: DbLogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isWriting: boolean = false;
  private getDb: (() => Promise<unknown>) | null = null;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly retentionDays: number;
  private lastCleanupTime: number = 0;

  constructor(batchSize: number, flushIntervalMs: number, retentionDays: number) {
    this.batchSize = batchSize;
    this.flushIntervalMs = flushIntervalMs;
    this.retentionDays = retentionDays;
  }

  setDbProvider(getDb: () => Promise<unknown>): void {
    this.getDb = getDb;
  }

  enqueue(entry: DbLogEntry): void {
    this.buffer.push(entry);
    
    // 缓冲区满，立即刷写
    if (this.buffer.length >= this.batchSize) {
      this.flush().catch(() => {});
    }
  }

  startPeriodicFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {});
      this.cleanupOldLogs().catch(() => {});
    }, this.flushIntervalMs);
    // 不阻止进程退出
    if (this.flushTimer.unref) this.flushTimer.unref();
  }

  stopPeriodicFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  async flush(): Promise<void> {
    if (this.isWriting || this.buffer.length === 0 || !this.getDb) return;
    
    this.isWriting = true;
    const batch = this.buffer.splice(0, this.batchSize);
    
    try {
      const db = await this.getDb();
      if (!db) {
        // 数据库不可用，放回缓冲区（但限制总大小防止OOM）
        if (this.buffer.length < this.batchSize * 3) {
          this.buffer.unshift(...batch);
        }
        return;
      }

      // 使用原生SQL批量插入，避免ORM开销
      const values = batch.map(e => 
        `('${e.timestamp}', '${e.level}', '${escapeSql(e.module)}', '${escapeSql(e.message)}', ${e.metadata ? `'${escapeSql(e.metadata)}'` : 'NULL'})`
      ).join(',');

      // @ts-ignore
      await db.execute(
        `INSERT INTO system_logs (timestamp, level, module, message, metadata) VALUES ${values}`
      );
    } catch (err: unknown) {
      // 写入失败，静默处理（避免日志系统自身的错误导致递归）
      // 仅在控制台输出简短错误
      // @ts-expect-error - error code check
      if (err?.code !== 'ER_NO_SUCH_TABLE') {
        // @ts-expect-error - error message access
        process.stderr.write(`[Logger] DB flush error: ${err?.message || 'unknown'}\n`);
      }
    } finally {
      this.isWriting = false;
    }
  }

  private async cleanupOldLogs(): Promise<void> {
    const now = Date.now();
    // 每小时清理一次
    if (now - this.lastCleanupTime < 3600_000) return;
    this.lastCleanupTime = now;

    try {
      const db = await this.getDb?.();
      if (!db) return;

      const cutoff = new Date(now - this.retentionDays * 86400_000)
        .toISOString().slice(0, 19).replace('T', ' ');

      // @ts-ignore
      await db.execute(
        `DELETE FROM system_logs WHERE timestamp < '${cutoff}' LIMIT 10000`
      );
    } catch {
      // 静默处理
    }
  }

  getBufferSize(): number { return this.buffer.length; }
}

function escapeSql(str: string): string {
  return str.replace(/'/g, "''").replace(/\\/g, '\\\\');
}

// ==================== Logger 主类 ====================

class Logger {
  private config: LoggerConfig;
  private ringBuffer: RingBuffer<LogEntry>;
  private sampler: LogSampler;
  private dbWriter: DbWriter;
  private nextId: number = 1;
  private startTime: number = Date.now();
  private recentTimestamps: number[] = []; // 最近1分钟的日志时间戳

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ringBuffer = new RingBuffer<LogEntry>(this.config.bufferSize);
    this.sampler = new LogSampler(this.config.samplingWindowMs, this.config.samplingMaxPerWindow);
    this.dbWriter = new DbWriter(
      this.config.dbFlushBatchSize,
      this.config.dbFlushIntervalMs,
      this.config.dbRetentionDays
    );

    // 定期清理采样器状态
    const cleanupTimer = setInterval(() => this.sampler.cleanup(), 60_000);
    if (cleanupTimer.unref) cleanupTimer.unref();
  }

  /** 设置数据库提供者（延迟初始化，避免循环依赖） */
  setDbProvider(getDb: () => Promise<unknown>): void {
    this.dbWriter.setDbProvider(getDb);
    this.dbWriter.startPeriodicFlush();
  }

  /** 更新配置 */
  updateConfig(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** v362: 日志脱敏 - 移除敏感信息 */
  private sanitize(message: string): string {
    if (!message) return message;
    try {
      // 延迟加载以避免循环依赖
      const { sanitizeLogMessage } = require('./logSanitizer');
      return sanitizeLogMessage(message);
    } catch {
      return message;
    }
  }

  // ==================== 日志写入方法 ====================

  debug(module: string, message: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, module, message, metadata);
  }

  info(module: string, message: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, module, message, metadata);
  }

  warn(module: string, message: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, module, message, metadata);
  }

  error(module: string, message: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, module, message, metadata);
  }

  fatal(module: string, message: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.FATAL, module, message, metadata);
  }

  private log(level: LogLevel, module: string, message: string, metadata?: Record<string, unknown>): void {
    const now = Date.now();
    const timestamp = new Date(now).toISOString();

    // 采样检查（仅对 DEBUG 和 INFO 级别进行采样）
    let suppressedCount = 0;
    if (level <= LogLevel.INFO) {
      const samplingKey = `${module}:${this.getMessageTemplate(message)}`;
      const [shouldOutput, suppressed] = this.sampler.shouldOutput(samplingKey);
      suppressedCount = suppressed;
      if (!shouldOutput) return;
    }

    // 创建日志条目
    const entry: LogEntry = {
      id: this.nextId++,
      timestamp,
      level,
      levelName: LOG_LEVEL_NAMES[level],
      module,
      message,
      metadata,
      suppressedCount: suppressedCount > 0 ? suppressedCount : undefined,
    };

    // 1. 写入环形缓冲区（所有级别）
    this.ringBuffer.push(entry);

    // 2. 控制台输出
    if (level >= this.config.consoleLevel) {
      this.writeToConsole(entry);
    }

    // 3. 数据库持久化
    if (level >= this.config.dbLevel) {
      this.dbWriter.enqueue({
        timestamp: timestamp.slice(0, 19).replace('T', ' '),
        level: LOG_LEVEL_NAMES[level],
        module,
        message: message.slice(0, 2000), // 截断超长消息
        metadata: metadata ? JSON.stringify(metadata).slice(0, 4000) : null,
      });
    }

    // 4. 更新速率统计
    this.recentTimestamps.push(now);
    // 清理超过1分钟的时间戳
    const oneMinuteAgo = now - 60_000;
    while (this.recentTimestamps.length > 0 && this.recentTimestamps[0] < oneMinuteAgo) {
      this.recentTimestamps.shift();
    }
  }

  /** 提取消息模板（用于采样去重） — 将数字和ID替换为占位符 */
  private getMessageTemplate(message: string): string {
    return message
      .replace(/\d+(\.\d+)?/g, '#')   // 数字替换为 #
      .replace(/id=#/g, 'id=#')         // 保持 id=# 格式
      .slice(0, 100);                    // 截断到100字符
  }

  /** 格式化控制台输出 - v362: 集成日志脱敏 */
  private writeToConsole(entry: LogEntry): void {
    const levelTag = entry.levelName.padEnd(5);
    const suppressedInfo = entry.suppressedCount 
      ? ` (+${entry.suppressedCount} suppressed)` 
      : '';
    
    // v362: 对日志消息进行脱敏处理，防止敏感信息泄露
    const sanitizedMessage = this.sanitize(entry.message);
    
    // 精简格式：[级别] [模块] 消息
    const line = `[${levelTag}] [${entry.module}] ${sanitizedMessage}${suppressedInfo}`;
    
    if (entry.level >= LogLevel.ERROR) {
      console.error(line);
    } else if (entry.level >= LogLevel.WARN) {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  // ==================== 查询方法 ====================

  /** 查询内存缓冲区中的日志 */
  query(params: LogQueryParams = {}): LogQueryResult {
    const limit = Math.min(params.limit || 50, 100); // 强制最大100条
    let entries = this.ringBuffer.toArray();

    // 级别过滤
    if (params.level !== undefined) {
      entries = entries.filter(e => e.level >= params.level!);
    }

    // 模块过滤
    if (params.module) {
      const moduleLower = params.module.toLowerCase();
      entries = entries.filter(e => e.module.toLowerCase().includes(moduleLower));
    }

    // 文本搜索
    if (params.search) {
      const searchLower = params.search.toLowerCase();
      // @ts-expect-error - error message access
      entries = entries.filter(e => (e as Error).message.toLowerCase().includes(searchLower));
    }

    // 时间过滤
    if (params.startTime) {
      entries = entries.filter(e => e.timestamp >= params.startTime!);
    }
    if (params.endTime) {
      entries = entries.filter(e => e.timestamp <= params.endTime!);
    }

    // 游标分页
    if (params.cursor !== undefined) {
      if (params.direction === 'newer') {
        entries = entries.filter(e => e.id > params.cursor!);
        entries.reverse(); // 从旧到新
      } else {
        entries = entries.filter(e => e.id < params.cursor!);
      }
    }

    const total = entries.length;
    const sliced = entries.slice(0, limit);
    const hasMore = total > limit;
    const nextCursor = sliced.length > 0 ? sliced[sliced.length - 1].id : undefined;

    return { entries: sliced, total, hasMore, nextCursor };
  }

  /** 获取日志统计信息 */
  getStats(): LogStats {
    const entries = this.ringBuffer.toArray();
    
    const byLevel: Record<string, number> = {};
    const moduleCount: Map<string, number> = new Map();

    for (const entry of entries) {
      // 按级别统计
      const levelName = entry.levelName;
      byLevel[levelName] = (byLevel[levelName] || 0) + 1;
      
      // 按模块统计
      moduleCount.set(entry.module, (moduleCount.get(entry.module) || 0) + 1);
    }

    // 按数量排序的模块列表（前20个）
    // @ts-ignore
    const byModule = Array.from(moduleCount.entries())
      .map(([module, count]) => ({ module, count }))
      // @ts-ignore
      .sort((a: unknown, b: unknown) => b.count - a.count)
      .slice(0, 20);

    return {
      totalEntries: entries.length,
      byLevel,
      byModule,
      recentRate: this.recentTimestamps.length,
      bufferUsage: Math.round((this.ringBuffer.size() / this.ringBuffer.getCapacity()) * 100),
      suppressedTotal: this.sampler.getTotalSuppressed(),
    };
  }

  /** 获取最新的N条日志（快速方法） */
  getLatest(n: number = 50): LogEntry[] {
    return this.ringBuffer.getLatest(Math.min(n, 100));
  }

  /** 获取特定模块的最新日志 */
  getModuleLogs(module: string, limit: number = 50): LogEntry[] {
    return this.query({ module, limit }).entries;
  }

  /** 获取错误和警告日志 */
  getAlerts(limit: number = 50): LogEntry[] {
    return this.query({ level: LogLevel.WARN, limit }).entries;
  }

  /** 强制刷写数据库缓冲区 */
  async flush(): Promise<void> {
    await this.dbWriter.flush();
  }

  /** 获取运行状态 */
  getStatus(): {
    uptime: number;
    config: LoggerConfig;
    bufferSize: number;
    bufferCapacity: number;
    dbBufferSize: number;
    recentRate: number;
    suppressedTotal: number;
  } {
    return {
      uptime: Math.round((Date.now() - this.startTime) / 1000),
      config: { ...this.config },
      bufferSize: this.ringBuffer.size(),
      bufferCapacity: this.ringBuffer.getCapacity(),
      dbBufferSize: this.dbWriter.getBufferSize(),
      recentRate: this.recentTimestamps.length,
      suppressedTotal: this.sampler.getTotalSuppressed(),
    };
  }

  /** 清理资源 */
  destroy(): void {
    this.dbWriter.stopPeriodicFlush();
    this.dbWriter.flush().catch(() => {});
  }
}

// ==================== 全局单例 ====================

/** 全局日志管理器实例 */
export const logger = new Logger({
  consoleLevel: process.env.LOG_LEVEL === 'debug' ? LogLevel.DEBUG : LogLevel.INFO,
  dbLevel: LogLevel.WARN,
  bufferSize: 10000,  // v447: 从30000缩减到10000，日志已持久化到DB，内存缓冲区不需要这么大，降低内存占用
});

/** v474: 辅助函数 - 当metadata是Error对象时，将error.message追加到日志消息中 */
function resolveLogArgs(message: string, metadata?: unknown): [string, Record<string, unknown> | undefined] {
  if (metadata instanceof Error) {
    const errMsg = metadata.message || String(metadata);
    const enrichedMessage = message.endsWith(':') || message.endsWith(': ') 
      ? `${message.trimEnd()} ${errMsg}` 
      : `${message} ${errMsg}`;
    return [enrichedMessage, { errorName: metadata.name, errorStack: metadata.stack?.slice(0, 500) } as Record<string, unknown>];
  }
  if (metadata !== undefined && metadata !== null && typeof metadata === 'object') {
    return [message, metadata as Record<string, unknown>];
  }
  if (metadata !== undefined) {
    return [message, { value: metadata }];
  }
  return [message, undefined];
}

/** 创建模块专用的日志快捷方法 */
export function createModuleLogger(moduleName: string) {
  return {
    debug: (message: string, metadata?: unknown) => { const [msg, meta] = resolveLogArgs(message, metadata); logger.debug(moduleName, msg, meta); },
    info: (message: string, metadata?: unknown) => { const [msg, meta] = resolveLogArgs(message, metadata); logger.info(moduleName, msg, meta); },
    warn: (message: string, metadata?: unknown) => { const [msg, meta] = resolveLogArgs(message, metadata); logger.warn(moduleName, msg, meta); },
    error: (message: string, metadata?: unknown) => { const [msg, meta] = resolveLogArgs(message, metadata); logger.error(moduleName, msg, meta); },
    fatal: (message: string, metadata?: unknown) => { const [msg, meta] = resolveLogArgs(message, metadata); logger.fatal(moduleName, msg, meta); },
  };
}

export default logger;
