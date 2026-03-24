/**
 * v509: 优化事件数据一致性检查器
 * 
 * 目的: 定期扫描 optimization_events 中状态不一致的记录，
 * 通过与 optimization_tasks 匹配来自动修复状态。
 * 
 * 解决的问题:
 * 1. optimization_events.api_sync_status = 'pending' 超过24小时的记录
 *    （说明同步引擎已处理但状态未回写）
 * 2. optimization_events 与 optimization_tasks 状态不一致
 *    （如 tasks 已 synced 但 events 仍为 pending）
 * 3. 孤立的 pending 事件（没有对应的 optimization_tasks 记录）
 * 
 * 调度方式: 由 dataSyncScheduler 每2小时调用一次
 */

import { sql } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger';
import { getDb } from '../db/connection';

const log = createModuleLogger('OptConsistencyChecker');

// ============================================================
// 类型定义
// ============================================================

export interface ConsistencyCheckResult {
  checkTime: string;
  /** 扫描的事件总数 */
  scannedEvents: number;
  /** 通过 event_id 外键匹配修复的数量 */
  fixedByEventId: number;
  /** 通过 keyword_id + 时间窗口匹配修复的数量 */
  fixedByKeywordMatch: number;
  /** 标记为 permanently_failed 的孤立事件数量 */
  markedPermanentlyFailed: number;
  /** 标记为 superseded 的过时分时事件数量 */
  markedSuperseded: number;
  /** 检查耗时(ms) */
  duration: number;
  /** 错误信息 */
  errors: string[];
}

// ============================================================
// 一致性检查主函数
// ============================================================

/**
 * 执行优化事件一致性检查和自动修复
 * 
 * 检查范围: 最近7天内 api_sync_status = 'pending' 且创建时间超过24小时的事件
 * 
 * 修复策略:
 * 1. 优先通过 event_id 外键精确匹配（v509新增）
 * 2. 回退到 keyword_id + account_id + 时间窗口模糊匹配
 * 3. 对于超过72小时仍无法匹配的事件，标记为 permanently_failed
 * 4. 对于分时竞价类事件，超过24小时标记为 superseded（已被新指令覆盖）
 */
export async function runConsistencyCheck(): Promise<ConsistencyCheckResult> {
  const startTime = Date.now();
  const result: ConsistencyCheckResult = {
    checkTime: new Date().toISOString(),
    scannedEvents: 0,
    fixedByEventId: 0,
    fixedByKeywordMatch: 0,
    markedPermanentlyFailed: 0,
    markedSuperseded: 0,
    duration: 0,
    errors: [],
  };

  const database = await getDb();
  if (!database) {
    result.errors.push('数据库连接不可用');
    return result;
  }

  try {
    log.info('[v509] 开始优化事件一致性检查...');

    // ========== Step 1: 通过 event_id 外键精确匹配 ==========
    // v509新增: optimization_tasks.event_id → optimization_events.id
    try {
      const [eventIdResult] = await database.execute(sql.raw(`
        UPDATE optimization_events oe
        INNER JOIN optimization_tasks ot ON ot.event_id = oe.id
        SET oe.api_sync_status = CASE 
              WHEN ot.status = 'synced' THEN 'synced'
              WHEN ot.status = 'permanently_failed' THEN 'permanently_failed'
              WHEN ot.status = 'failed' THEN 'failed'
              ELSE oe.api_sync_status
            END,
            oe.error_message = CASE
              WHEN ot.status IN ('synced', 'permanently_failed', 'failed') 
              THEN CONCAT(COALESCE(oe.error_message, ''), ' | v509: event_id精确匹配回写(', ot.status, ')')
              ELSE oe.error_message
            END,
            oe.api_synced_at = CASE
              WHEN ot.status = 'synced' THEN ot.completed_at
              ELSE oe.api_synced_at
            END
        WHERE oe.api_sync_status = 'pending'
          AND oe.created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
          AND oe.created_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)
          AND ot.status IN ('synced', 'permanently_failed', 'failed')
      `)) as unknown[];
      result.fixedByEventId = (eventIdResult as Record<string, unknown>).affectedRows as number || 0;
      if (result.fixedByEventId > 0) {
        log.info(`[v509] Step 1: event_id精确匹配修复 ${result.fixedByEventId} 条`);
      }
    } catch (e: unknown) {
      // event_id列可能还不存在（迁移尚未执行），静默跳过
      const msg = (e as Error).message;
      if (!msg.includes('Unknown column') && !msg.includes("doesn't exist")) {
        log.warn(`[v509] Step 1 event_id匹配失败: ${msg}`);
        result.errors.push(`event_id匹配: ${msg}`);
      }
    }

    // ========== Step 2: 通过 keyword_id + 时间窗口模糊匹配 ==========
    // 针对出价调整事件，通过 keyword_id + account_id + 60分钟时间窗口匹配
    try {
      const [kwMatchResult] = await database.execute(sql.raw(`
        UPDATE optimization_events oe
        INNER JOIN optimization_tasks ot 
          ON oe.keyword_id = ot.target_entity_id 
          AND oe.account_id = ot.account_id
          AND ot.task_type = 'bid_adjustment'
          AND ABS(TIMESTAMPDIFF(MINUTE, oe.created_at, ot.created_at)) < 60
        SET oe.api_sync_status = CASE 
              WHEN ot.status = 'synced' THEN 'synced'
              WHEN ot.status = 'permanently_failed' THEN 'permanently_failed'
              WHEN ot.status = 'failed' THEN 'failed'
              ELSE oe.api_sync_status
            END,
            oe.error_message = CASE
              WHEN ot.status IN ('synced', 'permanently_failed', 'failed')
              THEN CONCAT(COALESCE(oe.error_message, ''), ' | v509: keyword匹配回写(', ot.status, ')')
              ELSE oe.error_message
            END,
            oe.api_synced_at = CASE
              WHEN ot.status = 'synced' THEN ot.completed_at
              ELSE oe.api_synced_at
            END
        WHERE oe.api_sync_status = 'pending'
          AND oe.action_type IN ('bid_increase', 'bid_decrease', 'dayparting_bid')
          AND oe.keyword_id IS NOT NULL
          AND oe.created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
          AND oe.created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
          AND ot.status IN ('synced', 'permanently_failed', 'failed')
      `)) as unknown[];
      result.fixedByKeywordMatch = (kwMatchResult as Record<string, unknown>).affectedRows as number || 0;
      if (result.fixedByKeywordMatch > 0) {
        log.info(`[v509] Step 2: keyword匹配修复 ${result.fixedByKeywordMatch} 条`);
      }
    } catch (e: unknown) {
      log.warn(`[v509] Step 2 keyword匹配失败: ${(e as Error).message}`);
      result.errors.push(`keyword匹配: ${(e as Error).message}`);
    }

    // ========== Step 3: 分时竞价超时标记为 superseded ==========
    // dayparting_bid 事件超过24小时仍为pending，说明已被新的分时指令覆盖
    try {
      const [supersededResult] = await database.execute(sql.raw(`
        UPDATE optimization_events 
        SET api_sync_status = 'superseded',
            error_message = CONCAT(COALESCE(error_message, ''), ' | v509: 分时竞价超24h未同步，已被新指令覆盖')
        WHERE api_sync_status = 'pending'
          AND action_type = 'dayparting_bid'
          AND created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
          AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
      `)) as unknown[];
      result.markedSuperseded = (supersededResult as Record<string, unknown>).affectedRows as number || 0;
      if (result.markedSuperseded > 0) {
        log.info(`[v509] Step 3: 分时竞价superseded ${result.markedSuperseded} 条`);
      }
    } catch (e: unknown) {
      log.warn(`[v509] Step 3 superseded标记失败: ${(e as Error).message}`);
      result.errors.push(`superseded标记: ${(e as Error).message}`);
    }

    // ========== Step 4: 超过72小时的孤立pending事件 → permanently_failed ==========
    try {
      const [orphanResult] = await database.execute(sql.raw(`
        UPDATE optimization_events 
        SET api_sync_status = 'permanently_failed',
            error_message = CONCAT(COALESCE(error_message, ''), ' | v509: pending超72h无匹配任务，标记为permanently_failed')
        WHERE api_sync_status = 'pending'
          AND action_type IN ('bid_increase', 'bid_decrease')
          AND created_at < DATE_SUB(NOW(), INTERVAL 72 HOUR)
          AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
      `)) as unknown[];
      result.markedPermanentlyFailed = (orphanResult as Record<string, unknown>).affectedRows as number || 0;
      if (result.markedPermanentlyFailed > 0) {
        log.info(`[v509] Step 4: 孤立事件permanently_failed ${result.markedPermanentlyFailed} 条`);
      }
    } catch (e: unknown) {
      log.warn(`[v509] Step 4 孤立事件标记失败: ${(e as Error).message}`);
      result.errors.push(`孤立事件标记: ${(e as Error).message}`);
    }

    // ========== Step 5: 统计当前pending事件数量（用于监控） ==========
    try {
      const [countResult] = await database.execute(sql.raw(`
        SELECT COUNT(*) as cnt FROM optimization_events 
        WHERE api_sync_status = 'pending'
          AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
      `)) as unknown[];
      result.scannedEvents = (countResult as Record<string, unknown>[])?.[0]?.cnt as number || 0;
    } catch (e: unknown) {
      log.warn(`[v509] 统计pending事件失败: ${(e as Error).message}`);
    }

    result.duration = Date.now() - startTime;
    const totalFixed = result.fixedByEventId + result.fixedByKeywordMatch + result.markedSuperseded + result.markedPermanentlyFailed;
    
    if (totalFixed > 0) {
      log.warn(`[v509] 一致性检查完成: 修复=${totalFixed} (event_id=${result.fixedByEventId}, keyword=${result.fixedByKeywordMatch}, superseded=${result.markedSuperseded}, permanently_failed=${result.markedPermanentlyFailed}), 剩余pending=${result.scannedEvents}, 耗时=${result.duration}ms`);
    } else {
      log.info(`[v509] 一致性检查完成: 无需修复, 当前pending=${result.scannedEvents}, 耗时=${result.duration}ms`);
    }

  } catch (error: unknown) {
    log.warn(`[v509] 一致性检查异常: ${(error as Error).message}`);
    result.errors.push(`检查异常: ${(error as Error).message}`);
  }

  return result;
}
