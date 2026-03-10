/**
 * v394: 数据库连接管理
 * 从db.ts拆分的子模块
 * v394: 添加连接泄露自动检测和超时回收机制
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
 * v394: 连接泄露追踪器
 * 追踪每个借出连接的获取时间和调用栈，超时后自动回收
 */
const CONNECTION_MAX_HOLD_TIME = 120_000; // 连接最大持有时间120秒
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
          log.error(`[Database] v394: 自动回收连接 #${id} 失败: ${(e as Error).message}`);
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
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Health check getConnection timeout')), 5000))
      ]);
      await Promise.race([
        conn.ping(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Health check ping timeout')), 3000))
      ]);
      conn.release();
      _lastHealthCheck = now;
    } catch (error: unknown) {
      _poolStats.healthChecksFailed++;
      log.warn(`[Database] v350: 连接健康检查失败(#${_poolStats.healthChecksFailed}):`, (error as Error).message);
      
      // 冷却期保护：防止频繁重建连接池
      if (now - _lastPoolRebuild > POOL_REBUILD_COOLDOWN) {
        try { await _pool.end(); } catch (e) { /* ignore */ }
        _db = null;
        _pool = null;
        _lastPoolRebuild = now;
        _poolStats.rebuilds++;
        log.info(`[Database] v350: 连接池已销毁，将在下次getDb()时重建 (重建次数: ${_poolStats.rebuilds})`);
      } else {
        log.info(`[Database] v350: 跳过连接池重建（冷却期内，距上次重建${now - _lastPoolRebuild}ms）`);
      }
    }
  }
  
  if (!_db) {
    try {
      // v373: 连接池优化 - 适配500租户规模
      const poolSize = parseInt(process.env.DB_POOL_SIZE || '25', 10);
      const poolIdleTimeout = parseInt(process.env.DB_IDLE_TIMEOUT || '300000', 10);
      _pool = mysql.createPool({
        uri: process.env.DATABASE_URL,
        waitForConnections: true,
        connectionLimit: poolSize,
        maxIdle: Math.floor(poolSize * 0.4),
        idleTimeout: poolIdleTimeout,
        connectTimeout: 15_000,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10_000,
        queueLimit: poolSize * 4,
      });
      
      // v350: 注册连接池事件监听，用于诊断
      _pool.on('connection', () => {
        _poolStats.created++;
      });
      
      // @ts-ignore
      _db = drizzle(_pool as unknown, { casing: 'camelCase' });
      _lastHealthCheck = Date.now();
      _lastPoolRebuild = Date.now();
      
      // v394: 启动连接泄露检查器
      startLeakChecker();
      
      log.info(`[Database] v394: 连接池已建立 (limit=${poolSize}, idle=${Math.floor(poolSize*0.4)}, connectTimeout=15s, keepAlive=10s, queueLimit=${poolSize*4}, leakCheck=30s)`);
    } catch (error) {
      log.warn("[Database] v350: 连接池创建失败:", error);
      _db = null;
      _pool = null;
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
  
  try {
    const conn = await Promise.race([
      _pool.getConnection(),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error(`v350: 获取连接超时(${timeoutMs}ms)，连接池可能已满`)), timeoutMs)
      )
    ]);
    
    // v350: 设置会话级查询超时，防止单个慢查询无限期占用连接
    const queryTimeoutSec = Math.ceil(timeoutMs / 1000);
    const timeoutValue = Math.max(1000, Math.min(queryTimeoutSec * 1000, 300000));
    await conn.query(`SET SESSION max_execution_time = ${timeoutValue}`) as any;
    
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
    log.error(`[Database] v350: 获取直接连接失败: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * v394: 获取连接池监控指标（增强版）
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
  
  return {
    ..._poolStats,
    poolExists: !!_pool,
    dbExists: !!_db,
    leakedConnections: _poolStats.directConnBorrowed - _poolStats.directConnReturned,
    // v394: 新增监控指标
    activeDirectConnections: activeCount,
    oldestActiveConnectionMs: oldestActiveMs,
    trackedConnectionsTotal: _activeConnections.size,
  };
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
