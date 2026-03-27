/**
 * v523.2: 实体状态对齐模块（增强版）
 * 
 * 解决问题: 本地数据库中的实体（keywords, product_targets）状态与 Amazon 端不一致，
 * 导致优化引擎持续为已在 Amazon 端删除的实体生成优化任务，产生大量 entityNotFoundError。
 * 
 * v523.2 增强:
 * 1. 同步覆盖保护: 所有同步模块在 upsert 时保护 amazon_deleted 状态不被覆盖
 * 2. 独立定时触发: 不再仅依赖 full 层同步完成，每 30 分钟独立运行一次增量扫描
 * 3. 优化任务预过滤: 提供 isEntityDeleted() 检查，供优化引擎在创建任务前过滤已删除实体
 * 4. 增量扫描: 只扫描上次对齐后新产生的 entityNotFoundError，降低数据库负载
 * 
 * 工作原理:
 * 1. 从 optimization_tasks 中扫描近期因 entityNotFoundError 而 permanently_failed 的任务
 * 2. 提取这些任务引用的实体 ID
 * 3. 检查本地数据库中这些实体的当前状态
 * 4. 将仍标记为 enabled/paused 的实体更新为 amazon_deleted
 * 5. 取消所有引用这些实体的 pending/retry 任务
 * 
 * 触发时机:
 * - 每次 full 层同步完成后自动执行（完整扫描）
 * - 每 30 分钟独立执行一次增量扫描
 * - 可通过 API 手动触发指定账户的深度对齐
 */

import * as db from '../db';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('EntityStateAlignment');

// 上次对齐时间戳（用于增量扫描）
let lastAlignmentTime: Date | null = null;

// 独立定时器
let alignmentInterval: ReturnType<typeof setInterval> | null = null;

// 已知已删除实体缓存（用于优化任务预过滤）
const deletedEntityCache = new Map<string, number>(); // key: "keyword:123" or "target:456", value: timestamp

// 缓存过期时间: 24小时
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface AlignmentResult {
  accountId: number;
  keywordsAligned: number;
  productTargetsAligned: number;
  tasksCancelled: number;
  errors: string[];
  durationMs: number;
}

/**
 * v523.2: 检查实体是否已被标记为 amazon_deleted
 * 供优化引擎在创建任务前调用，避免为已删除实体生成无效任务
 * 
 * @param entityType - 'keyword' 或 'product_target'
 * @param entityId - 实体的数据库 ID
 * @returns true 表示实体已删除，不应创建优化任务
 */
export async function isEntityDeleted(entityType: 'keyword' | 'product_target', entityId: number): Promise<boolean> {
  // 先检查缓存
  const cacheKey = `${entityType}:${entityId}`;
  const cachedTime = deletedEntityCache.get(cacheKey);
  if (cachedTime && (Date.now() - cachedTime) < CACHE_TTL_MS) {
    return true;
  }

  // 缓存未命中，查询数据库
  const database = await db.getDb();
  if (!database) return false;

  const { sql } = await import('drizzle-orm');

  try {
    if (entityType === 'keyword') {
      const [rows] = await database.execute(
        sql.raw(`SELECT keywordStatus FROM keywords WHERE id = ${Number(entityId)} LIMIT 1`)
      ) as any;
      if (Array.isArray(rows) && rows.length > 0 && rows[0].keywordStatus === 'amazon_deleted') {
        deletedEntityCache.set(cacheKey, Date.now());
        return true;
      }
    } else {
      const [rows] = await database.execute(
        sql.raw(`SELECT targetStatus FROM product_targets WHERE id = ${Number(entityId)} LIMIT 1`)
      ) as any;
      if (Array.isArray(rows) && rows.length > 0 && rows[0].targetStatus === 'amazon_deleted') {
        deletedEntityCache.set(cacheKey, Date.now());
        return true;
      }
    }
  } catch (err: unknown) {
    log.debug(`[v523.2] isEntityDeleted 查询失败: ${(err as Error).message}`);
  }

  return false;
}

/**
 * v523.2: 批量检查实体是否已删除（高性能版本）
 * 用于优化引擎批量过滤已删除实体
 */
export async function filterDeletedEntities(
  entityType: 'keyword' | 'product_target',
  entityIds: number[]
): Promise<Set<number>> {
  const deletedIds = new Set<number>();
  if (entityIds.length === 0) return deletedIds;

  // 先从缓存中筛选
  const uncachedIds: number[] = [];
  for (const id of entityIds) {
    const cacheKey = `${entityType}:${id}`;
    const cachedTime = deletedEntityCache.get(cacheKey);
    if (cachedTime && (Date.now() - cachedTime) < CACHE_TTL_MS) {
      deletedIds.add(id);
    } else {
      uncachedIds.push(id);
    }
  }

  if (uncachedIds.length === 0) return deletedIds;

  // 批量查询数据库
  const database = await db.getDb();
  if (!database) return deletedIds;

  const { sql } = await import('drizzle-orm');

  try {
    const BATCH_SIZE = 500;
    for (let i = 0; i < uncachedIds.length; i += BATCH_SIZE) {
      const batch = uncachedIds.slice(i, i + BATCH_SIZE);
      const idList = batch.join(',');

      if (entityType === 'keyword') {
        const [rows] = await database.execute(
          sql.raw(`SELECT id FROM keywords WHERE id IN (${idList}) AND keywordStatus = 'amazon_deleted'`)
        ) as any;
        if (Array.isArray(rows)) {
          for (const row of rows) {
            const id = Number(row.id);
            deletedIds.add(id);
            deletedEntityCache.set(`keyword:${id}`, Date.now());
          }
        }
      } else {
        const [rows] = await database.execute(
          sql.raw(`SELECT id FROM product_targets WHERE id IN (${idList}) AND targetStatus = 'amazon_deleted'`)
        ) as any;
        if (Array.isArray(rows)) {
          for (const row of rows) {
            const id = Number(row.id);
            deletedIds.add(id);
            deletedEntityCache.set(`target:${id}`, Date.now());
          }
        }
      }
    }
  } catch (err: unknown) {
    log.debug(`[v523.2] filterDeletedEntities 批量查询失败: ${(err as Error).message}`);
  }

  return deletedIds;
}

/**
 * 对指定账户执行实体状态对齐
 * @param accountId - 账户 ID
 * @param incremental - 是否增量扫描（只扫描上次对齐后的新错误）
 */
export async function alignEntityStates(accountId: number, incremental: boolean = false): Promise<AlignmentResult> {
  const startTime = Date.now();
  const result: AlignmentResult = {
    accountId,
    keywordsAligned: 0,
    productTargetsAligned: 0,
    tasksCancelled: 0,
    errors: [],
    durationMs: 0,
  };

  log.info(`[v523.2] 开始实体状态对齐: 账户 ${accountId}, 模式=${incremental ? '增量' : '全量'}`);

  const database = await db.getDb();
  if (!database) {
    result.errors.push('数据库不可用');
    result.durationMs = Date.now() - startTime;
    return result;
  }

  const { sql } = await import('drizzle-orm');

  // 增量扫描的时间窗口
  const timeFilter = incremental && lastAlignmentTime
    ? `AND ot.completed_at >= '${lastAlignmentTime.toISOString().slice(0, 19).replace('T', ' ')}'`
    : `AND ot.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;

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
          ${timeFilter}
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
      const BATCH_SIZE = 500;
      for (let i = 0; i < keywordEntityIds.length; i += BATCH_SIZE) {
        const batch = keywordEntityIds.slice(i, i + BATCH_SIZE);
        const idList = batch.join(',');
        await database.execute(
          sql.raw(`UPDATE keywords SET keywordStatus = 'amazon_deleted', updatedAt = NOW() WHERE id IN (${idList}) AND keywordStatus NOT IN ('amazon_deleted', 'archived')`)
        );
      }
      result.keywordsAligned = keywordEntityIds.length;
      // 更新缓存
      for (const id of keywordEntityIds) {
        deletedEntityCache.set(`keyword:${id}`, Date.now());
      }
      log.warn(`[v523.2] 账户 ${accountId}: 标记 ${keywordEntityIds.length} 个 keyword 为 amazon_deleted`);
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
          ${timeFilter}
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
      // 更新缓存
      for (const id of targetEntityIds) {
        deletedEntityCache.set(`target:${id}`, Date.now());
      }
      log.warn(`[v523.2] 账户 ${accountId}: 标记 ${targetEntityIds.length} 个 product_target 为 amazon_deleted`);
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
                error_message = CONCAT(COALESCE(error_message, ''), ' | v523.2: 实体已在Amazon端删除，自动取消'),
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
        log.warn(`[v523.2] 账户 ${accountId}: 取消 ${totalCancelled} 个引用已删除实体的待处理任务`);
      }
    }

    log.info(`[v523.2] 实体状态对齐完成: 账户 ${accountId}, ` +
      `keywords=${result.keywordsAligned}, targets=${result.productTargetsAligned}, ` +
      `cancelled=${result.tasksCancelled}`);

  } catch (err: unknown) {
    const errMsg = (err as Error).message;
    result.errors.push(errMsg);
    log.warn(`[v523.2] 实体状态对齐失败: 账户 ${accountId}, 错误: ${errMsg}`);
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

/**
 * 对所有活跃账户执行实体状态对齐
 * @param incremental - 是否增量扫描
 */
export async function alignAllAccountEntityStates(incremental: boolean = false): Promise<{
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

  log.info(`[v523.2] 开始全账户实体状态对齐, 模式=${incremental ? '增量' : '全量'}...`);

  const database = await db.getDb();
  if (!database) {
    log.warn('[v523.2] 数据库不可用，跳过全账户对齐');
    return summary;
  }

  const { sql } = await import('drizzle-orm');

  try {
    // 查找有 entityNotFoundError 的活跃账户
    const timeFilter = incremental && lastAlignmentTime
      ? `AND ot.completed_at >= '${lastAlignmentTime.toISOString().slice(0, 19).replace('T', ' ')}'`
      : `AND ot.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;

    const [accountRows] = await database.execute(
      sql.raw(`
        SELECT DISTINCT ot.account_id
        FROM optimization_tasks ot
        INNER JOIN ad_accounts a ON ot.account_id = a.id
        WHERE ot.status IN ('permanently_failed', 'failed')
          AND ot.error_message LIKE '%entityNotFound%'
          ${timeFilter}
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
    log.info(`[v523.2] 发现 ${accountIds.length} 个账户需要实体状态对齐`);

    for (const accountId of accountIds) {
      const result = await alignEntityStates(accountId, incremental);
      summary.accountResults.push(result);
      summary.totalKeywordsAligned += result.keywordsAligned;
      summary.totalTargetsAligned += result.productTargetsAligned;
      summary.totalTasksCancelled += result.tasksCancelled;

      // 账户间延迟，避免数据库压力
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 更新上次对齐时间
    lastAlignmentTime = new Date();

    // 清理过期缓存
    cleanupCache();

    log.info(`[v523.2] 全账户实体状态对齐完成: ` +
      `${summary.totalAccounts}个账户, ` +
      `keywords=${summary.totalKeywordsAligned}, targets=${summary.totalTargetsAligned}, ` +
      `cancelled=${summary.totalTasksCancelled}`);

  } catch (err: unknown) {
    log.warn(`[v523.2] 全账户实体状态对齐失败: ${(err as Error).message}`);
  }

  return summary;
}

/**
 * v523.2: 启动独立定时对齐器
 * 每 30 分钟执行一次增量扫描，不依赖 full 层同步
 */
export function startAlignmentScheduler(): void {
  if (alignmentInterval) {
    log.info('[v523.2] 对齐调度器已在运行，跳过重复启动');
    return;
  }

  const INTERVAL_MS = 30 * 60 * 1000; // 30 分钟

  alignmentInterval = setInterval(async () => {
    try {
      log.info('[v523.2] 独立增量对齐扫描开始...');
      const result = await alignAllAccountEntityStates(true);
      const totalAligned = result.totalKeywordsAligned + result.totalTargetsAligned;
      if (totalAligned > 0 || result.totalTasksCancelled > 0) {
        log.warn(`[v523.2] 增量对齐发现问题: aligned=${totalAligned}, cancelled=${result.totalTasksCancelled}`);
      } else {
        log.info('[v523.2] 增量对齐扫描完成，无新的不一致实体');
      }
    } catch (err: unknown) {
      log.warn(`[v523.2] 独立增量对齐失败: ${(err as Error).message}`);
    }
  }, INTERVAL_MS);

  log.info(`[v523.2] 实体状态对齐独立调度器已启动，间隔: 30分钟`);
}

/**
 * v523.2: 停止独立定时对齐器
 */
export function stopAlignmentScheduler(): void {
  if (alignmentInterval) {
    clearInterval(alignmentInterval);
    alignmentInterval = null;
    log.info('[v523.2] 实体状态对齐独立调度器已停止');
  }
}

/**
 * 清理过期的缓存条目
 */
function cleanupCache(): void {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, timestamp] of deletedEntityCache.entries()) {
    if (now - timestamp > CACHE_TTL_MS) {
      deletedEntityCache.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    log.debug(`[v523.2] 清理 ${cleaned} 个过期缓存条目, 剩余 ${deletedEntityCache.size} 个`);
  }
}
