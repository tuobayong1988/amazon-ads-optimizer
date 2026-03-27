/**
 * v523: 实体状态对齐模块
 * 
 * 解决问题: 本地数据库中的实体（keywords, product_targets）状态与 Amazon 端不一致，
 * 导致优化引擎持续为已在 Amazon 端删除的实体生成优化任务，产生大量 entityNotFoundError。
 * 
 * 工作原理:
 * 1. 从 optimization_tasks 中扫描近期因 entityNotFoundError 而 permanently_failed 的任务
 * 2. 提取这些任务引用的实体 ID
 * 3. 检查本地数据库中这些实体的当前状态
 * 4. 将仍标记为 enabled/paused 的实体更新为 amazon_deleted
 * 5. 取消所有引用这些实体的 pending/retry 任务
 * 
 * 触发时机:
 * - 每次 full 层同步完成后自动执行
 * - 可通过 API 手动触发指定账户的深度对齐
 */

import * as db from '../db';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('EntityStateAlignment');

export interface AlignmentResult {
  accountId: number;
  keywordsAligned: number;
  productTargetsAligned: number;
  tasksCancelled: number;
  errors: string[];
  durationMs: number;
}

/**
 * 对指定账户执行实体状态对齐
 * 扫描因 entityNotFoundError 失败的优化任务，将对应的本地实体标记为 amazon_deleted
 */
export async function alignEntityStates(accountId: number): Promise<AlignmentResult> {
  const startTime = Date.now();
  const result: AlignmentResult = {
    accountId,
    keywordsAligned: 0,
    productTargetsAligned: 0,
    tasksCancelled: 0,
    errors: [],
    durationMs: 0,
  };

  log.info(`[v523] 开始实体状态对齐: 账户 ${accountId}`);

  const database = await db.getDb();
  if (!database) {
    result.errors.push('数据库不可用');
    result.durationMs = Date.now() - startTime;
    return result;
  }

  const { sql } = await import('drizzle-orm');

  try {
    // ============================================================
    // Step 1: 扫描因 entityNotFoundError 失败的 keyword 任务
    // ============================================================
    const [keywordRows] = await database.execute(
      sql.raw(`
        SELECT DISTINCT ot.target_entity_id, ot.amazon_entity_id
        FROM optimization_tasks ot
        INNER JOIN keywords k ON ot.target_entity_id = k.id
        WHERE ot.account_id = ${Number(accountId)}
          AND ot.target_entity_type = 'keyword'
          AND ot.status IN ('permanently_failed', 'failed')
          AND ot.error_message LIKE '%entityNotFound%'
          AND ot.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
          AND k.keywordStatus NOT IN ('amazon_deleted', 'archived')
      `)
    ) as any;

    const keywordEntityIds: number[] = [];
    if (Array.isArray(keywordRows)) {
      for (const row of keywordRows) {
        keywordEntityIds.push(Number(row.target_entity_id));
      }
    }

    if (keywordEntityIds.length > 0) {
      // 批量标记为 amazon_deleted
      const BATCH_SIZE = 500;
      for (let i = 0; i < keywordEntityIds.length; i += BATCH_SIZE) {
        const batch = keywordEntityIds.slice(i, i + BATCH_SIZE);
        const idList = batch.join(',');
        await database.execute(
          sql.raw(`UPDATE keywords SET keywordStatus = 'amazon_deleted', updatedAt = NOW() WHERE id IN (${idList}) AND keywordStatus NOT IN ('amazon_deleted', 'archived')`)
        );
      }
      result.keywordsAligned = keywordEntityIds.length;
      log.warn(`[v523] 账户 ${accountId}: 标记 ${keywordEntityIds.length} 个 keyword 为 amazon_deleted`);
    }

    // ============================================================
    // Step 2: 扫描因 entityNotFoundError 失败的 product_target 任务
    // ============================================================
    const [targetRows] = await database.execute(
      sql.raw(`
        SELECT DISTINCT ot.target_entity_id, ot.amazon_entity_id
        FROM optimization_tasks ot
        INNER JOIN product_targets pt ON ot.target_entity_id = pt.id
        WHERE ot.account_id = ${Number(accountId)}
          AND ot.target_entity_type = 'product_target'
          AND ot.status IN ('permanently_failed', 'failed')
          AND ot.error_message LIKE '%entityNotFound%'
          AND ot.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
          AND pt.targetStatus NOT IN ('amazon_deleted', 'archived')
      `)
    ) as any;

    const targetEntityIds: number[] = [];
    if (Array.isArray(targetRows)) {
      for (const row of targetRows) {
        targetEntityIds.push(Number(row.target_entity_id));
      }
    }

    if (targetEntityIds.length > 0) {
      const BATCH_SIZE = 500;
      for (let i = 0; i < targetEntityIds.length; i += BATCH_SIZE) {
        const batch = targetEntityIds.slice(i, i + BATCH_SIZE);
        const idList = batch.join(',');
        await database.execute(
          sql.raw(`UPDATE product_targets SET targetStatus = 'amazon_deleted', updatedAt = NOW() WHERE id IN (${idList}) AND targetStatus NOT IN ('amazon_deleted', 'archived')`)
        );
      }
      result.productTargetsAligned = targetEntityIds.length;
      log.warn(`[v523] 账户 ${accountId}: 标记 ${targetEntityIds.length} 个 product_target 为 amazon_deleted`);
    }

    // ============================================================
    // Step 3: 取消所有引用已标记为 amazon_deleted 实体的 pending/retry 任务
    // ============================================================
    const allDeletedEntityIds = [...keywordEntityIds, ...targetEntityIds];
    if (allDeletedEntityIds.length > 0) {
      const BATCH_SIZE = 500;
      let totalCancelled = 0;
      for (let i = 0; i < allDeletedEntityIds.length; i += BATCH_SIZE) {
        const batch = allDeletedEntityIds.slice(i, i + BATCH_SIZE);
        const idList = batch.join(',');
        const [cancelResult] = await database.execute(
          sql.raw(`
            UPDATE optimization_tasks 
            SET status = 'cancelled', 
                error_message = CONCAT(COALESCE(error_message, ''), ' | v523: 实体已在Amazon端删除，自动取消'),
                completed_at = NOW()
            WHERE target_entity_id IN (${idList})
              AND account_id = ${Number(accountId)}
              AND status IN ('pending', 'retry')
          `)
        ) as any;
        totalCancelled += (cancelResult as any)?.affectedRows || 0;
      }
      result.tasksCancelled = totalCancelled;
      if (totalCancelled > 0) {
        log.warn(`[v523] 账户 ${accountId}: 取消 ${totalCancelled} 个引用已删除实体的待处理任务`);
      }
    }

    log.info(`[v523] 实体状态对齐完成: 账户 ${accountId}, ` +
      `keywords=${result.keywordsAligned}, targets=${result.productTargetsAligned}, ` +
      `cancelled=${result.tasksCancelled}`);

  } catch (err: unknown) {
    const errMsg = (err as Error).message;
    result.errors.push(errMsg);
    log.warn(`[v523] 实体状态对齐失败: 账户 ${accountId}, 错误: ${errMsg}`);
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

/**
 * 对所有活跃账户执行实体状态对齐
 * 通常在 full 层同步完成后由调度器调用
 */
export async function alignAllAccountEntityStates(): Promise<{
  totalAccounts: number;
  totalKeywordsAligned: number;
  totalTargetsAligned: number;
  totalTasksCancelled: number;
  accountResults: AlignmentResult[];
}> {
  const summary = {
    totalAccounts: 0,
    totalKeywordsAligned: 0,
    totalTargetsAligned: 0,
    totalTasksCancelled: 0,
    accountResults: [] as AlignmentResult[],
  };

  log.info('[v523] 开始全账户实体状态对齐...');

  const database = await db.getDb();
  if (!database) {
    log.warn('[v523] 数据库不可用，跳过全账户对齐');
    return summary;
  }

  const { sql } = await import('drizzle-orm');

  try {
    // 查找有 entityNotFoundError 的活跃账户
    const [accountRows] = await database.execute(
      sql.raw(`
        SELECT DISTINCT ot.account_id
        FROM optimization_tasks ot
        INNER JOIN ad_accounts a ON ot.account_id = a.id
        WHERE ot.status IN ('permanently_failed', 'failed')
          AND ot.error_message LIKE '%entityNotFound%'
          AND ot.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
          AND a.status = 'active'
      `)
    ) as any;

    const accountIds: number[] = [];
    if (Array.isArray(accountRows)) {
      for (const row of accountRows) {
        accountIds.push(Number(row.account_id));
      }
    }

    summary.totalAccounts = accountIds.length;
    log.info(`[v523] 发现 ${accountIds.length} 个账户需要实体状态对齐`);

    for (const accountId of accountIds) {
      const result = await alignEntityStates(accountId);
      summary.accountResults.push(result);
      summary.totalKeywordsAligned += result.keywordsAligned;
      summary.totalTargetsAligned += result.productTargetsAligned;
      summary.totalTasksCancelled += result.tasksCancelled;

      // 账户间延迟，避免数据库压力
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    log.info(`[v523] 全账户实体状态对齐完成: ` +
      `${summary.totalAccounts}个账户, ` +
      `keywords=${summary.totalKeywordsAligned}, targets=${summary.totalTargetsAligned}, ` +
      `cancelled=${summary.totalTasksCancelled}`);

  } catch (err: unknown) {
    log.warn(`[v523] 全账户实体状态对齐失败: ${(err as Error).message}`);
  }

  return summary;
}
