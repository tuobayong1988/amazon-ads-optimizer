/**
 * Leader选举服务 (v371)
 * 
 * 基于MySQL的分布式Leader选举，确保多实例环境下只有一个实例执行调度任务。
 * 
 * 设计原理：
 * 1. 使用MySQL表 `leader_election` 存储当前Leader信息
 * 2. Leader通过定期心跳续约（每30秒）
 * 3. 如果Leader心跳超时（60秒），其他实例可以竞选成为新Leader
 * 4. 使用MySQL行级锁（SELECT ... FOR UPDATE）保证竞选的原子性
 * 5. 每个实例有唯一的instanceId（hostname + pid + 启动时间戳）
 * 
 * 为什么不用MySQL GET_LOCK：
 * - GET_LOCK绑定在连接上，连接断开后锁自动释放
 * - 在连接池环境下，连接可能被回收导致锁意外释放
 * - 心跳续约模式更可靠，且支持优雅的Leader转移
 */
import { createModuleLogger } from './logger';
import { logSystem } from './opsLogger';
import * as db from '../db';
const log = createModuleLogger('LeaderElection');

// 实例唯一标识
const INSTANCE_ID = `${process.env.HOSTNAME || 'unknown'}-${process.pid}-${Date.now()}`;

// 心跳间隔（30秒）
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

// Leader超时时间（60秒 - 如果Leader超过60秒没有心跳，视为失效）
const LEADER_TIMEOUT_MS = 60 * 1000;

// 选举锁名称
const ELECTION_LOCK_NAME = 'scheduler_leader';

let isLeader = false;
let heartbeatTimer: NodeJS.Timeout | null = null;
let electionTimer: NodeJS.Timeout | null = null;
let isShuttingDown = false;

// Leader变更回调
let onBecomeLeader: (() => void | Promise<void>) | null = null;
let onLoseLeadership: (() => void) | null = null;

/**
 * 初始化Leader选举表（幂等）
 */
async function ensureLeaderTable(): Promise<void> {
  try {
    const conn = await db.getDirectConnection(10000);
    try {
      await conn.execute(`CREATE TABLE IF NOT EXISTS leader_election (
        lock_name VARCHAR(64) PRIMARY KEY,
        instance_id VARCHAR(255) NOT NULL,
        last_heartbeat TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        acquired_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        metadata JSON DEFAULT NULL
      ) ENGINE=InnoDB`);
      log.info(`[LeaderElection] v371: leader_election表已就绪`);
    } finally {
      conn.release();
    }
  } catch (err: any) {
    log.warn(`[LeaderElection] v371: 创建leader_election表失败: ${(err as Error).message}`);
  }
}

/**
 * 尝试竞选Leader
 * 使用事务 + SELECT FOR UPDATE 保证原子性
 */
async function tryBecomeLeader(): Promise<boolean> {
  let conn: unknown = null;
  try {
    conn = await db.getDirectConnection(5000);
    
    // @ts-ignore
    await conn.beginTransaction();
    
    // 查询当前Leader（加行锁）
    // @ts-ignore
    const [rows] = await conn.execute(
      'SELECT instance_id, last_heartbeat FROM leader_election WHERE lock_name = ? FOR UPDATE',
      [ELECTION_LOCK_NAME]
    ) as unknown[];
    
    // @ts-ignore
    const now = new Date();
    
    // @ts-ignore
    if (!rows || rows.length === 0) {
      // 没有Leader记录，插入自己
      // @ts-ignore
      await conn.execute(
        // @ts-ignore
        'INSERT INTO leader_election (lock_name, instance_id, last_heartbeat, acquired_at) VALUES (?, ?, ?, ?)',
        [ELECTION_LOCK_NAME, INSTANCE_ID, now, now]
      );
      // @ts-ignore
      await conn.commit();
      // @ts-ignore
      conn.release();
      return true;
    }
    
    // @ts-ignore
    const currentLeader = rows[0];
    const lastHeartbeat = new Date(currentLeader.last_heartbeat);
    const timeSinceHeartbeat = now.getTime() - lastHeartbeat.getTime();
    
    // @ts-ignore
    if (currentLeader.instance_id === INSTANCE_ID) {
      // 自己就是Leader，续约心跳
      // @ts-ignore
      await conn.execute(
        'UPDATE leader_election SET last_heartbeat = ? WHERE lock_name = ?',
        [now, ELECTION_LOCK_NAME]
      );
      // @ts-ignore
      await conn.commit();
      // @ts-ignore
      conn.release();
      // @ts-ignore
      return true;
    // @ts-ignore
    }
    
    if (timeSinceHeartbeat > LEADER_TIMEOUT_MS) {
      // 当前Leader已超时，抢占
      log.warn(`[LeaderElection] v371: Leader ${currentLeader.instance_id} 心跳超时 (${Math.round(timeSinceHeartbeat / 1000)}秒)，尝试接管...`);
      // @ts-ignore
      await conn.execute(
        'UPDATE leader_election SET instance_id = ?, last_heartbeat = ?, acquired_at = ? WHERE lock_name = ?',
        [INSTANCE_ID, now, now, ELECTION_LOCK_NAME]
      );
      // @ts-ignore
      await conn.commit();
      // @ts-ignore
      conn.release();
      logSystem('LeaderElection', 'v371: Leader接管', {
        // @ts-ignore
        oldLeader: currentLeader.instance_id,
        // @ts-ignore
        newLeader: INSTANCE_ID,
        timeoutMs: timeSinceHeartbeat,
      });
      return true;
    }
    
    // 当前Leader仍然活跃，竞选失败
    // @ts-ignore
    await conn.commit();
    // @ts-ignore
    conn.release();
    return false;
  } catch (err: any) {
    if (conn) {
      // @ts-ignore
      try { await conn.rollback(); } catch (e: any) { /* ignore */ }
      // @ts-ignore
      try { conn.release(); } catch (e: any) { /* ignore */ }
    // @ts-ignore
    }
    log.warn(`[LeaderElection] v371: 竞选异常: ${(err as Error).message}`);
    return false;
  // @ts-ignore
  }
}

/**
 * 发送心跳（仅Leader调用）
 */
async function sendHeartbeat(): Promise<boolean> {
  let conn: unknown = null;
  // @ts-ignore
  try {
    conn = await db.getDirectConnection(5000);
    // @ts-ignore
    const [result] = await conn.execute(
      'UPDATE leader_election SET last_heartbeat = NOW() WHERE lock_name = ? AND instance_id = ?',
      [ELECTION_LOCK_NAME, INSTANCE_ID]
    ) as unknown[];
    // @ts-ignore
    conn.release();
    
    // 检查是否更新成功（如果被其他实例抢占，affectedRows=0）
    // @ts-ignore
    const affected = result?.affectedRows ?? 0;
    // @ts-ignore
    if (affected === 0) {
      log.warn(`[LeaderElection] v371: 心跳失败 - Leadership已被其他实例接管`);
      return false;
    }
    
    return true;
  } catch (err: any) {
    // @ts-ignore
    if (conn) try { conn.release(); } catch (e: any) { /* ignore */ }
    log.warn(`[LeaderElection] v371: 心跳异常: ${(err as Error).message}`);
    return false;
  }
}

/**
 * 放弃Leadership（优雅关闭时调用）
 */
async function resignLeadership(): Promise<void> {
  let conn: unknown = null;
  try {
    conn = await db.getDirectConnection(5000);
    // @ts-ignore
    await conn.execute(
      'DELETE FROM leader_election WHERE lock_name = ? AND instance_id = ?',
      [ELECTION_LOCK_NAME, INSTANCE_ID]
    );
    // @ts-ignore
    conn.release();
    log.info(`[LeaderElection] v371: 已放弃Leadership`);
  } catch (err: any) {
    // @ts-ignore
    if (conn) try { conn.release(); } catch (e: any) { /* ignore */ }
    log.warn(`[LeaderElection] v371: 放徃Leadership异常: ${(err as Error).message}`);
  }
}

/**
 * 启动Leader选举
 * @param callbacks 回调函数
 */
export async function startLeaderElection(callbacks: {
  onBecomeLeader: () => void | Promise<void>;
  onLoseLeadership: () => void;
}): Promise<void> {
  onBecomeLeader = callbacks.onBecomeLeader;
  onLoseLeadership = callbacks.onLoseLeadership;
  
  log.info(`[LeaderElection] v371: 启动Leader选举, instanceId=${INSTANCE_ID}`);
  logSystem('LeaderElection', 'v371: 启动Leader选举', { instanceId: INSTANCE_ID });
  
  // 确保表存在
  await ensureLeaderTable();
  
  // 立即尝试竞选
  const elected = await tryBecomeLeader();
  if (elected) {
    isLeader = true;
    log.info(`[LeaderElection] v371: 当选为Leader! instanceId=${INSTANCE_ID}`);
    logSystem('LeaderElection', 'v371: 当选为Leader', { instanceId: INSTANCE_ID });
    await Promise.resolve(onBecomeLeader());
    
    // 启动心跳
    heartbeatTimer = setInterval(async () => {
      if (isShuttingDown) return;
      const ok = await sendHeartbeat();
      if (!ok && isLeader) {
        isLeader = false;
        log.warn(`[LeaderElection] v371: 失去Leadership (心跳失败)`);
        logSystem('LeaderElection', 'v371: 失去Leadership', { reason: 'heartbeat_failed' });
        onLoseLeadership?.();
        // 停止心跳，启动选举
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        startElectionLoop();
      }
    }, HEARTBEAT_INTERVAL_MS);
  } else {
    log.info(`[LeaderElection] v371: 未当选Leader，进入Follower模式`);
    startElectionLoop();
  }
  
  // 注册优雅关闭
  const gracefulShutdown = async () => {
    isShuttingDown = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (electionTimer) clearInterval(electionTimer);
    if (isLeader) {
      await resignLeadership();
    }
  };
  
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

/**
 * 启动选举循环（Follower模式下定期尝试竞选）
 */
function startElectionLoop(): void {
  if (electionTimer) clearInterval(electionTimer);
  
  // 每45秒尝试一次竞选（略大于心跳间隔，避免频繁竞争）
  electionTimer = setInterval(async () => {
    if (isShuttingDown || isLeader) return;
    
    const elected = await tryBecomeLeader();
    if (elected) {
      isLeader = true;
      log.info(`[LeaderElection] v371: Follower晋升为Leader! instanceId=${INSTANCE_ID}`);
      logSystem('LeaderElection', 'v371: Follower晋升为Leader', { instanceId: INSTANCE_ID });
      
      // 停止选举循环
      if (electionTimer) clearInterval(electionTimer);
      electionTimer = null;
      
      // 启动心跳
      heartbeatTimer = setInterval(async () => {
        if (isShuttingDown) return;
        const ok = await sendHeartbeat();
        if (!ok && isLeader) {
          isLeader = false;
          log.warn(`[LeaderElection] v371: 失去Leadership (心跳失败)`);
          onLoseLeadership?.();
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          heartbeatTimer = null;
          startElectionLoop();
        }
      }, HEARTBEAT_INTERVAL_MS);
      
      // v383: 支持async回调
      Promise.resolve(onBecomeLeader?.()).catch((err: any) => {
        log.warn(`[LeaderElection] v383: onBecomeLeader回调执行失败: ${(err as Error).message}`);
      });
    }
  }, 45 * 1000);
}

/**
 * 检查当前实例是否为Leader
 */
export function isCurrentLeader(): boolean {
  return isLeader;
}

/**
 * 获取Leader选举状态
 */
export function getLeaderStatus(): {
  isLeader: boolean;
  instanceId: string;
  mode: 'leader' | 'follower';
} {
  return {
    isLeader,
    instanceId: INSTANCE_ID,
    mode: isLeader ? 'leader' : 'follower',
  };
}

/**
 * 停止Leader选举
 */
export async function stopLeaderElection(): Promise<void> {
  isShuttingDown = true;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (electionTimer) {
    clearInterval(electionTimer);
    electionTimer = null;
  }
  if (isLeader) {
    await resignLeadership();
    isLeader = false;
  }
  log.info(`[LeaderElection] v371: Leader选举已停止`);
}
