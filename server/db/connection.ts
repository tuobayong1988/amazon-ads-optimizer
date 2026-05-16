/**
 * v394: 数据库连接管理
 * 从db.ts拆分的子模块
 * v394: 添加连接泄露自动检测和超时回收机制
 * v686: 连接池优化 — 应对全量同步期间瞬时高负载
 *   - connectTimeout 15s→30s，避免高负载时连接建立超时
 *   - 健康检查 getConnection 超时 5s→10s，避免高负载时误判不健康
 *   - 连接最大持有时间 120s→180s，适配长耗时同步步骤
 *   - 新增连接池压力自适应：高利用率时自动延长获取超时
 *   - 新增获取连接重试机制：首次超时后自动重试一次
 * v755: 数据库连接韧性增强
 *   - ECONNREFUSED指数退避自动重连（5s/15s/30s/60s/120s）
 *   - 全局数据库可用性状态管理，上层模块可查询优雅降级
 *   - 数据库恢复后自动通知日志
 *   - 健康检查失败错误分类（ECONNREFUSED vs ETIMEDOUT vs 其他）
 */

import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { createModuleLogger } from '../utils/logger';
import { registerDbQueryProviders } from '../utils/dbQueryProvider';
import { getProductTargetById } from './productTargets';
import { getKeywordById } from './keywords';
import { getAdGroupById } from './adGroups';

const log = createModuleLogger('DB:connection');

/** v360: 统一的数据库实例类型别名，用于替代各处的 ReturnType<typeof getDb> */
export type DbInstance = Awaited<ReturnType<typeof getDb>>;

/** v360: 非空数据库实例类型 */
export type DbInstanceNonNull = NonNullable<DbInstance>;

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: mysql.Pool | null = null;
let _lastHealthCheck = 0;
let _poolStats = { created: 0, healthChecksFailed: 0, rebuilds: 0, directConnBorrowed: 0, directConnReturned: 0, autoReclaimed: 0 };
const HEALTH_CHECK_INTERVAL = 30_000; // v350: 30秒检查一次连接健康（从60秒缩短）
const POOL_REBUILD_COOLDOWN = 5_000; // v350: 连接池重建冷却期5秒，防止频繁重建
let _lastPoolRebuild = 0;

/**
 * v755: 数据库连接韧性增强
 * 
 * 设计原则:
 * - ECONNREFUSED时启动指数退避自动重连，而非让上层模块崩溃
 * - 全局状态标记让上层模块可以查询数据库可用性，优雅降级
 * - 数据库恢复后输出明确的恢复日志，便于运维监控
 */
interface DbAvailabilityState {
  available: boolean;
  lastError: string | null;
  lastErrorTime: number;
  lastRecoveryTime: number;
  consecutiveFailures: number;
  reconnectAttempts: number;
  totalDowntimeMs: number;
  downtimeStartedAt: number | null;
}

const _dbAvailability: DbAvailabilityState = {
  available: true,
  lastError: null,
  lastErrorTime: 0,
  lastRecoveryTime: 0,
  consecutiveFailures: 0,
  reconnectAttempts: 0,
  totalDowntimeMs: 0,
  downtimeStartedAt: null,
};

// v755: 指数退避重连配置
const RECONNECT_BACKOFF_SCHEDULE = [5_000, 15_000, 30_000, 60_000, 120_000]; // 5s, 15s, 30s, 60s, 120s
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _isReconnecting = false;

/**
 * v755: 获取数据库可用性状态（供上层模块查询，优雅降级）
 */
export function getDbAvailability(): Readonly<DbAvailabilityState> {
  return { ..._dbAvailability };
}

/**
 * v755: 检查数据库是否可用
 */
export function isDbAvailable(): boolean {
  return _dbAvailability.available;
}

/**
 * v755: 错误分类 — 区分ECONNREFUSED、ETIMEDOUT和其他错误
 */
function classifyDbError(error: Error): 'ECONNREFUSED' | 'ETIMEDOUT' | 'PROTOCOL' | 'UNKNOWN' {
  const msg = error.message || '';
  const code = (error as any).code || '';
  if (code === 'ECONNREFUSED' || msg.includes('ECONNREFUSED')) return 'ECONNREFUSED';
  if (code === 'ETIMEDOUT' || msg.includes('ETIMEDOUT') || msg.includes('timeout')) return 'ETIMEDOUT';
  if (code === 'PROTOCOL_CONNECTION_LOST' || msg.includes('PROTOCOL')) return 'PROTOCOL';
  return 'UNKNOWN';
}

/**
 * v755: 标记数据库不可用并启动自动重连
 */
function markDbUnavailable(error: Error): void {
  const errorType = classifyDbError(error);
  const wasAvailable = _dbAvailability.available;
  
  _dbAvailability.available = false;
  _dbAvailability.lastError = `[${errorType}] ${error.message}`;
  _dbAvailability.lastErrorTime = Date.now();
  _dbAvailability.consecutiveFailures++;
  
  if (wasAvailable) {
    _dbAvailability.downtimeStartedAt = Date.now();
    log.warn(`[Database] v755: 数据库不可用 [${errorType}]，连续失败${_dbAvailability.consecutiveFailures}次，启动自动重连`);
  }
  
  // 启动指数退避重连
  if (!_isReconnecting) {
    scheduleReconnect();
  }
}

/**
 * v755: 标记数据库已恢复
 */
function markDbRecovered(): void {
  if (!_dbAvailability.available) {
    const downtimeDuration = _dbAvailability.downtimeStartedAt 
      ? Date.now() - _dbAvailability.downtimeStartedAt 
      : 0;
    _dbAvailability.totalDowntimeMs += downtimeDuration;
    
    log.info(`[Database] v755: ★ 数据库已恢复 ★ 中断时长=${Math.round(downtimeDuration / 1000)}秒，重连尝试=${_dbAvailability.reconnectAttempts}次，累计中断=${Math.round(_dbAvailability.totalDowntimeMs / 1000)}秒`);
  }
  
  _dbAvailability.available = true;
  _dbAvailability.lastError = null;
  _dbAvailability.consecutiveFailures = 0;
  _dbAvailability.lastRecoveryTime = Date.now();
  _dbAvailability.downtimeStartedAt = null;
  _isReconnecting = false;
  
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
}

/**
 * v755: 指数退避自动重连调度
 */
function scheduleReconnect(): void {
  if (_isReconnecting) return;
  _isReconnecting = true;
  
  const attemptReconnect = async (attempt: number) => {
    if (_dbAvailability.available) {
      _isReconnecting = false;
      return; // 已恢复，停止重连
    }
    
    _dbAvailability.reconnectAttempts++;
    const backoffIndex = Math.min(attempt, RECONNECT_BACKOFF_SCHEDULE.length - 1);
    const delay = RECONNECT_BACKOFF_SCHEDULE[backoffIndex];
    
    log.info(`[Database] v755: 自动重连尝试 #${_dbAvailability.reconnectAttempts}，${delay / 1000}秒后执行...`);
    
    _reconnectTimer = setTimeout(async () => {
      try {
        // 销毁旧连接池
        if (_pool) {
          try { await _pool.end(); } catch (e) { /* ignore */ }
          _pool = null;
          _db = null;
        }
        
        // 尝试重建连接
        const db = await getDb();
        if (db) {
          markDbRecovered();
          return;
        }
      } catch (err) {
        const errorType = classifyDbError(err as Error);
        log.warn(`[Database] v755: 重连尝试 #${_dbAvailability.reconnectAttempts} 失败 [${errorType}]: ${(err as Error).message}`);
      }
      
      // 继续下一次重连尝试
      if (!_dbAvailability.available) {
        attemptReconnect(attempt + 1);
      }
    }, delay);
    
    if (_reconnectTimer && (_reconnectTimer as any).unref) {
      (_reconnectTimer as any).unref();
    }
  };
  
  attemptReconnect(0);
}

/**
 * v394: 连接泄露追踪器
 * 追踪每个借出连接的获取时间和调用栈，超时后自动回收
 */
const CONNECTION_MAX_HOLD_TIME = 180_000; // v686: 连接最大持有时间180秒（从120秒延长，适配95天绩效回溯等长耗时步骤）
const LEAK_CHECK_INTERVAL = 30_000; // 每30秒检查一次泄露
interface TrackedConnection {
  conn: mysql.PoolConnection;
  borrowedAt: number;
  releaseFunc: () => void;
  released: boolean;
  caller: string;
}
const _activeConnections: Map<number, TrackedConnection> = new Map();
let _connIdCounter = 0;
let _leakCheckTimer: ReturnType<typeof setInterval> | null = null;

function startLeakChecker() {
  if (_leakCheckTimer) return;
  _leakCheckTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, tracked] of _activeConnections.entries()) {
      if (!tracked.released && (now - tracked.borrowedAt > CONNECTION_MAX_HOLD_TIME)) {
        log.warn(`[Database] v394: 检测到连接泄露 #${id}，已持有${Math.round((now - tracked.borrowedAt) / 1000)}秒，来源: ${tracked.caller}，自动回收`);
        try {
          tracked.releaseFunc();
          _poolStats.autoReclaimed++;
        } catch (e) {
          log.warn(`[Database] v394: 自动回收连接 #${id} 失败: ${(e as Error).message}`);
        }
        _activeConnections.delete(id);
      }
    }
    // 清理已释放的连接记录（保留最近5分钟的记录用于诊断）
    for (const [id, tracked] of _activeConnections.entries()) {
      if (tracked.released && (now - tracked.borrowedAt > 300_000)) {
        _activeConnections.delete(id);
      }
    }
  }, LEAK_CHECK_INTERVAL);
  // 不阻止进程退出
  if (_leakCheckTimer.unref) _leakCheckTimer.unref();
}

/**
 * v350: 彻底重写数据库连接管理 — 一次性解决ETIMEDOUT
 * 
 * 设计原则:
 * - 所有数据库操作必须通过连接池，禁止独立createConnection
 * - 需要直接SQL的场景使用getDirectConnection()从池中借用
 * - 连接池自动处理断线重连、超时、keepalive
 * - 添加连接池监控指标，便于诊断
 * - v394: 添加连接泄露自动检测和超时回收
 */
export async function getDb() {
  if (!process.env.DATABASE_URL) return null;
  
  // v350: 定期健康检查 + 冷却期保护
  const now = Date.now();
  if (_db && _pool && (now - _lastHealthCheck > HEALTH_CHECK_INTERVAL)) {
    try {
      const conn = await Promise.race([
        _pool.getConnection(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Health check getConnection timeout')), 10_000)) // v686: 10s（从5s延长，高负载时5s太短易误判）
      ]);
      await Promise.race([
        conn.ping(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Health check ping timeout')), 3000))
      ]);
      conn.release();
      _lastHealthCheck = now;
    } catch (error: unknown) {
      _poolStats.healthChecksFailed++;
      const errorType = classifyDbError(error as Error);
      log.warn(`[Database] v755: 连接健康检查失败(#${_poolStats.healthChecksFailed}) [类型:${errorType}]:`, (error as Error).message);
      
      // v755: 标记数据库不可用，启动自动重连
      markDbUnavailable(error as Error);
      
      // 冷却期保护：防止频繁重建连接池
      if (now - _lastPoolRebuild > POOL_REBUILD_COOLDOWN) {
        try { await _pool.end(); } catch (e) { /* ignore */ }
        _db = null;
        _pool = null;
        _lastPoolRebuild = now;
        _poolStats.rebuilds++;
        log.info(`[Database] v755: 连接池已销毁，将在下次getDb()时重建 (重建次数: ${_poolStats.rebuilds}, 错误类型: ${errorType})`);
      } else {
        log.info(`[Database] v350: 跳过连接池重建（冷却期内，距上次重建${now - _lastPoolRebuild}ms）`);
      }
    }
  }
  
  if (!_db) {
    try {
      // v686: 连接池优化 — 应对全量同步期间瞬时高负载
      // connectTimeout: 15s→30s，高负载时连接建立需要更多时间
      // maxIdle: 40%→50%，保留更多空闲连接应对突发请求
      // queueLimit: 4x→6x，允许更多请求排队等待而非直接拒绝
      const poolSize = parseInt(process.env.DB_POOL_SIZE || '50', 10);
      const poolIdleTimeout = parseInt(process.env.DB_IDLE_TIMEOUT || '300000', 10);
      _pool = mysql.createPool({
        uri: process.env.DATABASE_URL,
        waitForConnections: true,
        connectionLimit: poolSize,
        maxIdle: Math.floor(poolSize * 0.6), // v751: 60%空闲连接（从50%提升，减少高负载时的连接创建开销）
        idleTimeout: poolIdleTimeout,
        connectTimeout: 30_000, // v686: 30s（从15s延长，避免高负载时ETIMEDOUT）
        enableKeepAlive: true,
        keepAliveInitialDelay: 10_000,
        queueLimit: poolSize * 6, // v686: 6x（从4x提升，允许更多请求排队等待）
      });
      
      // v350: 注册连接池事件监听，用于诊断
      _pool.on('connection', () => {
        _poolStats.created++;
      });
      
      // @ts-expect-error - type assertion
      _db = drizzle(_pool as unknown, { casing: 'camelCase' });
      _lastHealthCheck = Date.now();
      _lastPoolRebuild = Date.now();
      
      // v394: 启动连接泄露检查器
      startLeakChecker();
      
      log.info(`[Database] v755: 连接池已建立 (limit=${poolSize}, idle=${Math.floor(poolSize*0.6)}, connectTimeout=30s, keepAlive=10s, queueLimit=${poolSize*6}, leakCheck=30s, maxHold=180s)`);
      
      // v755: 连接池成功创建，标记数据库已恢复
      markDbRecovered();
      
      // v752: 连接池预热 — 预创建最小连接数，避免冷启动延迟
      const warmupSize = Math.min(Math.floor(poolSize * 0.3), 15); // 预热30%连接，最多15个
      const warmupStart = Date.now();
      try {
        const warmupConns: mysql.PoolConnection[] = [];
        for (let i = 0; i < warmupSize; i++) {
          warmupConns.push(await _pool.getConnection());
        }
        for (const conn of warmupConns) {
          conn.release();
        }
        log.info(`[Database] v752: 连接池预热完成，预创建 ${warmupSize} 个连接，耗时 ${Date.now() - warmupStart}ms`);
      } catch (warmupErr) {
        log.warn(`[Database] v752: 连接池预热部分失败（不影响正常使用）: ${(warmupErr as Error).message}`);
      }
    } catch (error) {
      log.warn("[Database] v755: 连接池创建失败:", error);
      _db = null;
      _pool = null;
      // v755: 标记不可用并启动自动重连
      markDbUnavailable(error as Error);
    }
  }
  return _db;
}

/**
 * v394: 从连接池获取一个直接的mysql2连接（带泄露追踪）
 * 
 * 用途: 替代所有独立createConnection调用，统一通过连接池管理
 * 重要: 调用者必须在finally块中调用conn.release()归还连接
 * v394: 自动追踪连接持有时间，超过120秒未释放的连接将被自动回收
 * 
 * @param timeoutMs 查询超时时间（毫秒），默认30秒
 * @returns mysql2 PoolConnection，使用完毕后必须release()
 */

/**
 * v752: 读写分离 — 读库连接池
 * 
 * 设计原则:
 * - 所有纯读操作（SELECT）应优先使用读库，减轻主库压力
 * - 读库连接池独立于主库连接池，互不影响
 * - 当读库不可用时，自动回退到主库（getDb）
 * - 读库连接池大小通过 DB_READ_POOL_SIZE 环境变量配置
 */
let _readDb: ReturnType<typeof drizzle> | null = null;
let _readPool: mysql.Pool | null = null;
let _readLastHealthCheck = 0;
let _readPoolStats = { created: 0, healthChecksFailed: 0, rebuilds: 0, fallbackToWrite: 0 };
let _readLastPoolRebuild = 0;

export async function getReadDb(): Promise<ReturnType<typeof drizzle> | null> {
  const readUrl = process.env.DATABASE_READ_URL;
  
  // 如果没有配置读库URL，回退到主库
  if (!readUrl) {
    _readPoolStats.fallbackToWrite++;
    return getDb();
  }
  
  // 定期健康检查
  const now = Date.now();
  if (_readDb && _readPool && (now - _readLastHealthCheck > HEALTH_CHECK_INTERVAL)) {
    try {
      const conn = await Promise.race([
        _readPool.getConnection(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Read pool health check timeout')), 10_000))
      ]);
      await Promise.race([
        conn.ping(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Read pool ping timeout')), 3000))
      ]);
      conn.release();
      _readLastHealthCheck = now;
    } catch (error: unknown) {
      _readPoolStats.healthChecksFailed++;
      log.warn(`[Database] v752: 读库健康检查失败(#${_readPoolStats.healthChecksFailed}):`, (error as Error).message);
      
      if (now - _readLastPoolRebuild > POOL_REBUILD_COOLDOWN) {
        try { await _readPool.end(); } catch (e) { /* ignore */ }
        _readDb = null;
        _readPool = null;
        _readLastPoolRebuild = now;
        _readPoolStats.rebuilds++;
        log.info(`[Database] v752: 读库连接池已销毁，将在下次getReadDb()时重建`);
      }
    }
  }
  
  if (!_readDb) {
    try {
      const readPoolSize = parseInt(process.env.DB_READ_POOL_SIZE || '50', 10);
      const poolIdleTimeout = parseInt(process.env.DB_IDLE_TIMEOUT || '300000', 10);
      
      _readPool = mysql.createPool({
        uri: readUrl,
        waitForConnections: true,
        connectionLimit: readPoolSize,
        maxIdle: Math.floor(readPoolSize * 0.6),
        idleTimeout: poolIdleTimeout,
        connectTimeout: 30_000,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10_000,
        queueLimit: readPoolSize * 6,
      });
      
      _readPool.on('connection', () => {
        _readPoolStats.created++;
      });
      
      // @ts-expect-error - type assertion
      _readDb = drizzle(_readPool as unknown, { casing: 'camelCase' });
      _readLastHealthCheck = Date.now();
      _readLastPoolRebuild = Date.now();
      
      log.info(`[Database] v752: 读库连接池已建立 (limit=${readPoolSize}, idle=${Math.floor(readPoolSize*0.6)}, url=${readUrl.replace(/:[^:@]+@/, ':***@')})`);
    } catch (error) {
      log.warn("[Database] v752: 读库连接池创建失败，回退到主库:", (error as Error).message);
      _readDb = null;
      _readPool = null;
      _readPoolStats.fallbackToWrite++;
      return getDb();
    }
  }
  return _readDb;
}

/**
 * v752: 获取读库连接池统计信息
 */
export function getReadPoolStats() {
  if (!_readPool) return null;
  const pool = _readPool as unknown as { pool: { _allConnections: { length: number }, _freeConnections: { length: number }, _connectionQueue: { length: number } } };
  try {
    return {
      total: pool.pool._allConnections?.length ?? 0,
      free: pool.pool._freeConnections?.length ?? 0,
      queued: pool.pool._connectionQueue?.length ?? 0,
      ...(_readPoolStats),
    };
  } catch {
    return { ..._readPoolStats };
  }
}

export async function getDirectConnection(timeoutMs: number = 30_000): Promise<mysql.PoolConnection> {
  // 确保连接池已初始化
  await getDb();
  if (!_pool) {
    throw new Error('[Database] v350: 连接池不可用，无法获取直接连接');
  }
  
  _poolStats.directConnBorrowed++;
  const connId = ++_connIdCounter;
  
  // v394: 获取调用栈信息用于泄露诊断
  const callerStack = new Error().stack?.split('\n')[2]?.trim() || 'unknown';
  
  // v686: 连接池压力自适应 — 高利用率时自动延长获取超时
  let effectiveTimeout = timeoutMs;
  try {
    const pool = _pool as any;
    const allConns = pool.pool?._allConnections?.length ?? 0;
    const freeConns = pool.pool?._freeConnections?.length ?? 0;
    const connLimit = pool.pool?.config?.connectionLimit ?? 100;
    const utilization = connLimit > 0 ? (allConns - freeConns) / connLimit : 0;
    if (utilization > 0.8) {
      // 利用率>80%时，超时时间延长50%，给排队请求更多等待机会
      effectiveTimeout = Math.round(timeoutMs * 1.5);
      log.debug(`[Database] v686: 连接池高压(${Math.round(utilization*100)}%)，获取超时延长至${effectiveTimeout}ms`);
    }
  } catch { /* 获取利用率失败不影响正常流程 */ }
  
  // v686: 获取连接重试机制 — 首次超时后自动重试一次
  const attemptGetConnection = async (attempt: number): Promise<mysql.PoolConnection> => {
    try {
      return await Promise.race([
        _pool!.getConnection(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error(`v686: 获取连接超时(${effectiveTimeout}ms, attempt=${attempt})，连接池可能已满`)), effectiveTimeout)
        )
      ]);
    } catch (err) {
      if (attempt < 2) {
        // 首次失败，等待500ms后重试
        log.warn(`[Database] v686: 获取连接第${attempt}次超时，500ms后重试...`);
        await new Promise(r => setTimeout(r, 500));
        return attemptGetConnection(attempt + 1);
      }
      throw err;
    }
  };
  
  try {
    const conn = await attemptGetConnection(1);
    
    // v350: 设置会话级查询超时，防止单个慢查询无限期占用连接
    const queryTimeoutSec = Math.ceil(timeoutMs / 1000);
    const timeoutValue = Math.max(1000, Math.min(queryTimeoutSec * 1000, 300000));
    await conn.query(`SET SESSION max_execution_time = ${timeoutValue}`) as unknown;
    
    // v394: 包装release方法以跟踪归还 + 泄露追踪
    const originalRelease = conn.release.bind(conn);
    let released = false;
    
    const tracked: TrackedConnection = {
      conn,
      borrowedAt: Date.now(),
      releaseFunc: () => {
        if (!released) {
          released = true;
          tracked.released = true;
          _poolStats.directConnReturned++;
          originalRelease();
        }
      },
      released: false,
      caller: callerStack,
    };
    
    _activeConnections.set(connId, tracked);
    
    conn.release = () => {
      tracked.releaseFunc();
      // v394: 延迟清理追踪记录（保留一段时间用于诊断）
      setTimeout(() => _activeConnections.delete(connId), 60_000);
    };
    
    return conn;
  } catch (error: unknown) {
    log.warn(`[Database] v350: 获取直接连接失败: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * v668: 获取连接池监控指标（增强版 - 含mysql2原生池指标）
 */
export function getPoolStats() {
  // v394: 计算当前活跃（未释放）的连接数
  let activeCount = 0;
  let oldestActiveMs = 0;
  const now = Date.now();
  for (const [, tracked] of _activeConnections) {
    if (!tracked.released) {
      activeCount++;
      const holdTime = now - tracked.borrowedAt;
      if (holdTime > oldestActiveMs) oldestActiveMs = holdTime;
    }
  }
  
  // v668: 获取mysql2连接池原生指标
  let nativePoolStats = {
    allConnections: 0,
    freeConnections: 0,
    activeConnections: 0,
    queuedRequests: 0,
    connectionLimit: 0,
    utilizationPercent: 0,
  };
  if (_pool) {
    try {
      const pool = _pool as any;
      const allConns = pool.pool?._allConnections?.length ?? 0;
      const freeConns = pool.pool?._freeConnections?.length ?? 0;
      const queuedReqs = pool.pool?._connectionQueue?.length ?? 0;
      const connLimit = pool.pool?.config?.connectionLimit ?? 100;
      nativePoolStats = {
        allConnections: allConns,
        freeConnections: freeConns,
        activeConnections: allConns - freeConns,
        queuedRequests: queuedReqs,
        connectionLimit: connLimit,
        utilizationPercent: connLimit > 0 ? Math.round(((allConns - freeConns) / connLimit) * 1000) / 10 : 0,
      };
    } catch { /* ignore */ }
  }
  
  return {
    ..._poolStats,
    poolExists: !!_pool,
    dbExists: !!_db,
    leakedConnections: _poolStats.directConnBorrowed - _poolStats.directConnReturned,
    // v394: 追踪指标
    activeDirectConnections: activeCount,
    oldestActiveConnectionMs: oldestActiveMs,
    trackedConnectionsTotal: _activeConnections.size,
    // v668: mysql2原生池指标
    nativePool: nativePoolStats,
  };
}

/**
 * v668: 定期连接池状态日志输出（每5分钟）
 * 便于在EB日志中排查多租户并发场景下的连接池瓶颈
 */
// v752: 连接池自适应扩缩容状态
const _poolAdaptiveState = { highLoadCount: 0, lowLoadCount: 0 };
let _poolMonitorTimer: ReturnType<typeof setInterval> | null = null;
export function startPoolMonitor() {
  if (_poolMonitorTimer) return;
  const MONITOR_INTERVAL = 5 * 60 * 1000; // 5分钟
  _poolMonitorTimer = setInterval(() => {
    if (!_pool) return;
    const stats = getPoolStats();
    const np = stats.nativePool;
    const utilStr = `${np.activeConnections}/${np.connectionLimit} (${np.utilizationPercent}%)`;
    const leakStr = stats.leakedConnections > 0 ? ` | LEAKED: ${stats.leakedConnections}` : '';
    const queueStr = np.queuedRequests > 0 ? ` | QUEUED: ${np.queuedRequests}` : '';
    log.info(`[PoolMonitor] v668: util=${utilStr} | total=${np.allConnections} free=${np.freeConnections}${queueStr}${leakStr} | rebuilds=${stats.rebuilds} hcFails=${stats.healthChecksFailed}`);
    
    // v668: 连接池利用率告警
    if (np.utilizationPercent > 70) {
      log.warn(`[PoolMonitor] v751: 连接池利用率过高 ${np.utilizationPercent}%，活跃=${np.activeConnections}/${np.connectionLimit}，队列=${np.queuedRequests}`);
    }
    if (np.queuedRequests > 10) {
      log.warn(`[PoolMonitor] v751: 连接池等待队列过长 ${np.queuedRequests}，可能存在并发瓶颈`);
    }
    
    // v752: 连接池自适应扩缩容建议
    if (np.utilizationPercent > 85 && np.queuedRequests > 20) {
      const suggestedSize = Math.min(np.connectionLimit * 1.5, 100);
      log.warn(`[PoolMonitor] v752: [AUTO-SCALE建议] 连接池持续高负载，建议扩容到 ${Math.round(suggestedSize)} (当前${np.connectionLimit})`);
      _poolAdaptiveState.highLoadCount++;
    } else if (np.utilizationPercent < 20 && np.queuedRequests === 0) {
      _poolAdaptiveState.lowLoadCount++;
      if (_poolAdaptiveState.lowLoadCount >= 6) { // 连续30分钟低负载
        const suggestedSize = Math.max(np.connectionLimit * 0.6, 20);
        log.info(`[PoolMonitor] v752: [AUTO-SCALE建议] 连接池持续低负载，可缩容到 ${Math.round(suggestedSize)} (当前${np.connectionLimit})`);
        _poolAdaptiveState.lowLoadCount = 0;
      }
    } else {
      _poolAdaptiveState.lowLoadCount = 0;
      _poolAdaptiveState.highLoadCount = 0;
    }
    
    // v752: 读库连接池监控
    const readStats = getReadPoolStats();
    if (readStats) {
      log.info(`[PoolMonitor] v752: 读库 total=${readStats.total} free=${readStats.free} queued=${readStats.queued} fallback=${readStats.fallbackToWrite}`);
    }
  }, MONITOR_INTERVAL);
  if (_poolMonitorTimer.unref) _poolMonitorTimer.unref();
  log.info('[PoolMonitor] v668: 连接池定期监控已启动（每5分钟输出状态）');
}

// v223: 注册数据库查询提供者（延迟到模块加载完成后执行）
queueMicrotask(() => {
  registerDbQueryProviders({
    getAdGroupById: (id: number) => getAdGroupById(id),
    getKeywordById: (id: number) => getKeywordById(id),
    getProductTargetById: (id: number) => getProductTargetById(id),
    getDb: () => getDb(),
  });
});

// ==================== User Functions ====================
