/**
 * server/sync/checkpointManager.ts
 * 
 * v663: 断点续传检查点管理器
 * 
 * 功能：
 * 1. 保存同步检查点到MySQL（sync_checkpoints_v2表）
 * 2. 加载最近4小时内的检查点用于断点续传
 * 3. 同步成功完成后清除检查点
 * 4. 构建恢复策略（计算需要跳过的已完成步骤）
 * 
 * 使用场景：
 * - syncAccount中断（超时/关闭/Token过期）时自动保存checkpoint
 * - 下次同步同一账户时自动加载checkpoint，跳过已完成步骤
 */

import * as db from '../db';
import { sql } from 'drizzle-orm';
import { typedQueryOne } from '../db/types';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('CheckpointManager');

/** 检查点数据结构 */
export interface SyncCheckpointData {
  completedSteps: string[];        // 已完成的步骤ID列表
  interruptReason: string;         // 中断原因（timeout/shutdown/token_expired/error）
  totalSynced: number;             // 已同步的总记录数
  elapsedMs: number;               // 已耗时毫秒数
  stepCheckpoints: Record<string, { status: string; synced: number; completedAt?: string }>;
  recordCheckpoints: Record<string, unknown>;  // 记录级断点（预留）
  savedAt: string;                 // 保存时间
}

/** 恢复策略 */
export interface RecoveryStrategy {
  skipSteps: Set<string>;          // 需要跳过的步骤ID集合
  recordRecovery: Record<string, unknown>;  // 记录级恢复信息（预留）
  resumeInfo: string;              // 人类可读的恢复信息
}

// 检查点最大有效期（小时）
const CHECKPOINT_MAX_AGE_HOURS = 4;

/**
 * 保存同步检查点到数据库
 * 使用 UPSERT 语义：同一 (account_id, tier) 只保留最新的检查点
 */
export async function saveSyncCheckpoint(
  accountId: number,
  tier: string,
  checkpoint: SyncCheckpointData
): Promise<boolean> {
  const database = await db.getDb();
  if (!database) {
    log.warn(`[v663] 保存检查点失败: 数据库不可用, 账户${accountId}`);
    return false;
  }
  try {
    const checkpointJson = JSON.stringify(checkpoint);
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    
    // 确保表存在（幂等操作）
    try {
      await database.execute(sql.raw(
        `CREATE TABLE IF NOT EXISTS sync_checkpoints_v2 (
          id INT AUTO_INCREMENT PRIMARY KEY,
          account_id INT NOT NULL,
          tier VARCHAR(20) NOT NULL DEFAULT 'standard',
          checkpoint_data JSON,
          interrupt_reason VARCHAR(255),
          completed_steps_count INT DEFAULT 0,
          total_synced INT DEFAULT 0,
          elapsed_ms INT DEFAULT 0,
          saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_account_tier (account_id, tier)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
      ));
    } catch (_e) { /* 表已存在则忽略 */ }
    
    await database.execute(sql`
      INSERT INTO sync_checkpoints_v2 (
        account_id, tier, checkpoint_data, interrupt_reason,
        completed_steps_count, total_synced, elapsed_ms,
        saved_at, updated_at
      ) VALUES (
        ${accountId}, ${tier}, ${checkpointJson}, ${checkpoint.interruptReason || 'unknown'},
        ${checkpoint.completedSteps.length}, ${checkpoint.totalSynced || 0}, ${checkpoint.elapsedMs || 0},
        ${now}, ${now}
      )
      ON DUPLICATE KEY UPDATE
        checkpoint_data = VALUES(checkpoint_data),
        interrupt_reason = VALUES(interrupt_reason),
        completed_steps_count = VALUES(completed_steps_count),
        total_synced = VALUES(total_synced),
        elapsed_ms = VALUES(elapsed_ms),
        saved_at = VALUES(saved_at),
        updated_at = VALUES(updated_at)
    `);
    
    log.info(`[v663] 检查点已保存 - 账户${accountId} ${tier}层, 已完成${checkpoint.completedSteps.length}步, 同步${checkpoint.totalSynced}条, 中断原因: ${checkpoint.interruptReason}`);
    return true;
  } catch (error: unknown) {
    log.warn(`[v663] 保存检查点失败: ${(error as Error).message}`);
    return false;
  }
}

/**
 * 加载最近的同步检查点
 * 只返回 CHECKPOINT_MAX_AGE_HOURS 小时内的检查点
 */
export async function loadSyncCheckpoint(
  accountId: number,
  tier: string
): Promise<SyncCheckpointData | null> {
  const database = await db.getDb();
  if (!database) return null;
  try {
    const row = await typedQueryOne<{ checkpoint_data: string | SyncCheckpointData; saved_at: string | Date }>(database, sql`
      SELECT checkpoint_data, saved_at
      FROM sync_checkpoints_v2
      WHERE account_id = ${accountId} 
        AND tier = ${tier}
        AND saved_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${CHECKPOINT_MAX_AGE_HOURS} HOUR)
      ORDER BY saved_at DESC
      LIMIT 1
    `);
    if (!row) return null;
    const checkpoint: SyncCheckpointData = typeof row.checkpoint_data === 'string'
      ? JSON.parse(row.checkpoint_data)
      : row.checkpoint_data;
    log.info(`[v663] 检查点已加载 - 账户${accountId} ${tier}层, 已完成${checkpoint.completedSteps.length}步, 中断原因: ${checkpoint.interruptReason}`);
    return checkpoint;
  } catch (error: unknown) {
    log.warn(`[v663] 加载检查点失败: ${(error as Error).message}`);
    return null;
  }
}

/**
 * 清除同步检查点（同步成功完成后调用）
 */
export async function clearSyncCheckpoint(
  accountId: number,
  tier: string
): Promise<boolean> {
  const database = await db.getDb();
  if (!database) return false;
  try {
    await database.execute(sql`
      DELETE FROM sync_checkpoints_v2
      WHERE account_id = ${accountId} AND tier = ${tier}
    `);
    log.info(`[v663] 检查点已清除 - 账户${accountId} ${tier}层`);
    return true;
  } catch (error: unknown) {
    log.warn(`[v663] 清除检查点失败: ${(error as Error).message}`);
    return false;
  }
}

/**
 * 根据检查点构建恢复策略
 * 返回需要跳过的步骤集合和恢复信息
 */
export function buildRecoveryStrategy(checkpoint: SyncCheckpointData): RecoveryStrategy {
  const skipSteps = new Set(checkpoint.completedSteps);
  const recordRecovery: Record<string, unknown> = {};
  
  // 如果有步骤级检查点，检查是否有进行中的步骤需要记录级恢复
  if (checkpoint.stepCheckpoints) {
    for (const [stepId, stepCp] of Object.entries(checkpoint.stepCheckpoints)) {
      if (stepCp.status === 'in_progress' && checkpoint.recordCheckpoints?.[stepId]) {
        recordRecovery[stepId] = checkpoint.recordCheckpoints[stepId];
      }
    }
  }
  
  const resumeInfo = `跳过${skipSteps.size}个已完成步骤, ${Object.keys(recordRecovery).length}个步骤从记录级断点恢复 (中断原因: ${checkpoint.interruptReason}, 已耗时: ${Math.round(checkpoint.elapsedMs / 1000)}s)`;
  return { skipSteps, recordRecovery, resumeInfo };
}
