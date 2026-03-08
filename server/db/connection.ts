/**
 * v361: 数据库连接管理
 * 从db.ts拆分的子模块
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

/** v360: 非空数据库实例类型 */
export type DbInstanceNonNull = NonNullable<DbInstance>;

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: mysql.Pool | null = null;
let _lastHealthCheck = 0;
let _poolStats = { created: 0, healthChecksFailed: 0, rebuilds: 0, directConnBorrowed: 0, directConnReturned: 0 };
const HEALTH_CHECK_INTERVAL = 30_000; // v350: 30秒检查一次连接健康（从60秒缩短）
const POOL_REBUILD_COOLDOWN = 5_000; // v350: 连接池重建冷却期5秒，防止频繁重建
let _lastPoolRebuild = 0;

/**
 * v350: 彻底重写数据库连接管理 — 一次性解决ETIMEDOUT
 * 
 * 根因分析:
 * 1. db.t4g.micro实例1GB内存，27MB缓冲池无法缓存750MB数据 → 已升级到db.t4g.small
 * 2. 11处独立createConnection绕过连接池，存在连接泄漏 → 提供getDirectConnection统一管理
 * 3. connectionLimit=10太小，并发优化任务时连接不够 → 提升到20
 * 4. 没有查询超时保护，慢查询无限期占用连接 → 添加30秒查询超时
 * 5. 健康检查间隔60秒太长 → 缩短到30秒
 * 6. 连接池重建没有冷却期 → 添加5秒冷却期防止雪崩
 * 
 * 设计原则:
 * - 所有数据库操作必须通过连接池，禁止独立createConnection
 * - 需要直接SQL的场景使用getDirectConnection()从池中借用
 * - 连接池自动处理断线重连、超时、keepalive
 * - 添加连接池监控指标，便于诊断
 */

/**
 * v350: 彻底重写数据库连接管理 — 一次性解决ETIMEDOUT
 * 
 * 根因分析:
 * 1. db.t4g.micro实例1GB内存，27MB缓冲池无法缓存750MB数据 → 已升级到db.t4g.small
 * 2. 11处独立createConnection绕过连接池，存在连接泄漏 → 提供getDirectConnection统一管理
 * 3. connectionLimit=10太小，并发优化任务时连接不够 → 提升到20
 * 4. 没有查询超时保护，慢查询无限期占用连接 → 添加30秒查询超时
 * 5. 健康检查间隔60秒太长 → 缩短到30秒
 * 6. 连接池重建没有冷却期 → 添加5秒冷却期防止雪崩
 * 
 * 设计原则:
 * - 所有数据库操作必须通过连接池，禁止独立createConnection
 * - 需要直接SQL的场景使用getDirectConnection()从池中借用
 * - 连接池自动处理断线重连、超时、keepalive
 * - 添加连接池监控指标，便于诊断
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
      // v364: 进一步优化连接池配置 — 支持200-500租户规模
      const poolSize = parseInt(process.env.DB_POOL_SIZE || '50', 10);
      const poolIdleTimeout = parseInt(process.env.DB_IDLE_TIMEOUT || '300000', 10);
      _pool = mysql.createPool({
        uri: process.env.DATABASE_URL,
        waitForConnections: true,
        connectionLimit: poolSize,     // v364: 可配置，默认50（从25提升，支持更多并发租户）
        maxIdle: Math.floor(poolSize * 0.4), // v364: 保持40%空闲连接，减少内存占用
        idleTimeout: poolIdleTimeout,  // v364: 可配置，默认300秒（从180秒提升，减少重建频率）
        connectTimeout: 15_000,        // v350: 15秒连接超时
        enableKeepAlive: true,         // 保持连接活跃
        keepAliveInitialDelay: 10_000, // v350: 10秒keepAlive
        queueLimit: poolSize * 4,      // v364: 动态计算，队列为连接数的4倍（从3倍提升）
      });
      
      // v350: 注册连接池事件监听，用于诊断
      _pool.on('connection', () => {
        _poolStats.created++;
      });
      
      // @ts-ignore
      _db = drizzle(_pool as unknown, { casing: 'camelCase' });
      _lastHealthCheck = Date.now();
      _lastPoolRebuild = Date.now();
      log.info(`[Database] v364: 连接池已建立 (limit=${poolSize}, idle=${Math.floor(poolSize*0.4)}, connectTimeout=15s, keepAlive=10s, queueLimit=${poolSize*4})`);
    } catch (error) {
      log.warn("[Database] v350: 连接池创建失败:", error);
      _db = null;
      _pool = null;
    }
  }
  return _db;
}

/**
 * v350: 从连接池获取一个直接的mysql2连接
 * 
 * 用途: 替代所有独立createConnection调用，统一通过连接池管理
 * 重要: 调用者必须在finally块中调用conn.release()归还连接
 * 
 * @param timeoutMs 查询超时时间（毫秒），默认30秒
 * @returns mysql2 PoolConnection，使用完毕后必须release()
 * 
 * 使用示例:
 * ```
 * const conn = await getDirectConnection();
 * try {
 *   await conn.execute('UPDATE ...') as any;
 * } finally {
 *   conn.release();
 * }
 * ```
 */

/**
 * v350: 从连接池获取一个直接的mysql2连接
 * 
 * 用途: 替代所有独立createConnection调用，统一通过连接池管理
 * 重要: 调用者必须在finally块中调用conn.release()归还连接
 * 
 * @param timeoutMs 查询超时时间（毫秒），默认30秒
 * @returns mysql2 PoolConnection，使用完毕后必须release()
 * 
 * 使用示例:
 * ```
 * const conn = await getDirectConnection();
 * try {
 *   await conn.execute('UPDATE ...') as any;
 * } finally {
 *   conn.release();
 * }
 * ```
 */
export async function getDirectConnection(timeoutMs: number = 30_000): Promise<mysql.PoolConnection> {
  // 确保连接池已初始化
  await getDb();
  if (!_pool) {
    throw new Error('[Database] v350: 连接池不可用，无法获取直接连接');
  }
  
  _poolStats.directConnBorrowed++;
  
  try {
    const conn = await Promise.race([
      _pool.getConnection(),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error(`v350: 获取连接超时(${timeoutMs}ms)，连接池可能已满`)), timeoutMs)
      )
    ]);
    
    // v350: 设置会话级查询超时，防止单个慢查询无限期占用连接
    const queryTimeoutSec = Math.ceil(timeoutMs / 1000);
    // v362: SQL注入防护 - 使用参数化查询
    const timeoutValue = Math.max(1000, Math.min(queryTimeoutSec * 1000, 300000)); // 限制在1-300秒
    await conn.execute('SET SESSION max_execution_time = ?', [timeoutValue]) as any;
    
    // v350: 包装release方法以跟踪归还
    const originalRelease = conn.release.bind(conn);
    let released = false;
    conn.release = () => {
      if (!released) {
        released = true;
        _poolStats.directConnReturned++;
        originalRelease();
      }
    };
    
    return conn;
  } catch (error: unknown) {
    log.error(`[Database] v350: 获取直接连接失败: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * v350: 获取连接池监控指标
 */

/**
 * v350: 获取连接池监控指标
 */
export function getPoolStats() {
  return {
    ..._poolStats,
    poolExists: !!_pool,
    dbExists: !!_db,
    leakedConnections: _poolStats.directConnBorrowed - _poolStats.directConnReturned,
  };
}

// v223: 注册数据库查询提供者（延迟到模块加载完成后执行）
// 使用 queueMicrotask 确保所有函数定义完成后再注册
queueMicrotask(() => {
  registerDbQueryProviders({
    getAdGroupById: (id: number) => getAdGroupById(id),
    getKeywordById: (id: number) => getKeywordById(id),
    getProductTargetById: (id: number) => getProductTargetById(id),
    getDb: () => getDb(),
  });
});

// ==================== User Functions ====================
