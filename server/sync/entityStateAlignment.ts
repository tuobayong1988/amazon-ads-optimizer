/**
 * v525: 双向状态对齐协议（Bidirectional State Alignment Protocol）
 * 
 * 从 v523.2 的被动式"错误驱动对齐"升级为主动式"双向协议对齐"。
 * 
 * ===== 核心设计理念 =====
 * 
 * v523.2 的局限性:
 * - 只能在 entityNotFoundError 已经发生后才能检测到状态不一致
 * - 依赖错误日志驱动，存在时间延迟（错误发生 → 对齐扫描 → 修复）
 * - 同步模块覆盖保护是"防御性"的，无法主动发现新的不一致
 * 
 * v525 双向协议:
 * 1. 正向对齐（Forward Alignment）: 同步时主动比对 Amazon 返回的实体列表与本地数据库
 *    - 如果本地有实体但 Amazon 返回列表中没有 → 标记为 amazon_deleted
 *    - 引入 lastVerifiedAt 时间戳，记录每个实体最后一次被 Amazon API 确认存在的时间
 * 2. 反向对齐（Reverse Alignment）: 保留 v523.2 的错误驱动对齐作为兜底
 *    - 扫描 entityNotFoundError → 标记 amazon_deleted → 取消相关任务
 * 3. 版本向量（Version Vector）: 每次同步记录同步版本号
 *    - 只有同步版本号更高的数据才能覆盖本地状态
 *    - 防止旧数据覆盖新的对齐结果
 * 
 * 触发时机:
 * - 正向对齐: 每次同步完成后自动执行（对比 Amazon 返回 vs 本地）
 * - 反向对齐: 每 30 分钟独立增量扫描
 * - 手动触发: 可通过 API 触发指定账户的深度对齐
 */

import * as db from '../db';
import { createModuleLogger } from '../utils/logger';
import { logSync, logSyncWarn } from '../utils/opsLogger';

const log = createModuleLogger('EntityStateAlignment');

// ============================================================
// 版本向量管理
// ============================================================

/**
 * 全局同步版本计数器
 * 每次同步周期递增，用于防止旧数据覆盖新的对齐结果
 */
let globalSyncVersion = 0;

/**
 * 获取并递增全局同步版本号
 */
export function nextSyncVersion(): number {
  return ++globalSyncVersion;
}

/**
 * 获取当前同步版本号（不递增）
 */
export function getCurrentSyncVersion(): number {
  return globalSyncVersion;
}

// ============================================================
// 实体验证时间戳管理
// ============================================================

/**
 * 实体验证记录: 记录每个实体最后一次被 Amazon API 确认存在的时间
 * key: "keyword:123" 或 "target:456"
 * value: { lastVerifiedAt: Date, syncVersion: number }
 */
interface EntityVerification {
  lastVerifiedAt: Date;
  syncVersion: number;
}

const entityVerificationMap = new Map<string, EntityVerification>();

/**
 * 记录实体被 Amazon API 确认存在
 * 在同步模块处理 Amazon 返回数据时调用
 */
export function markEntityVerified(entityType: 'keyword' | 'product_target', entityId: number, syncVersion: number): void {
  const key = `${entityType}:${entityId}`;
  entityVerificationMap.set(key, {
    lastVerifiedAt: new Date(),
    syncVersion,
  });
}

/**
 * 批量记录实体被 Amazon API 确认存在
 */
export function markEntitiesVerified(entityType: 'keyword' | 'product_target', entityIds: number[], syncVersion: number): void {
  const now = new Date();
  for (const id of entityIds) {
    entityVerificationMap.set(`${entityType}:${id}`, {
      lastVerifiedAt: now,
      syncVersion,
    });
  }
}

/**
 * 检查实体是否应该被更新（版本向量检查）
 * 只有同步版本号 >= 当前记录的版本号时才允许更新
 * 
 * @returns true 表示允许更新，false 表示应拒绝（旧数据试图覆盖新数据）
 */
export function shouldAllowStateUpdate(entityType: 'keyword' | 'product_target', entityId: number, incomingSyncVersion: number): boolean {
  const key = `${entityType}:${entityId}`;
  const existing = entityVerificationMap.get(key);
  if (!existing) return true; // 无记录，允许更新
  return incomingSyncVersion >= existing.syncVersion;
}

// ============================================================
// 已删除实体缓存（保留 v523.2 的高性能预过滤能力）
// ============================================================

const deletedEntityCache = new Map<string, number>(); // key → timestamp
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24小时

// 上次对齐时间戳（用于增量扫描）
let lastAlignmentTime: Date | null = null;

// 独立定时器
let alignmentInterval: ReturnType<typeof setInterval> | null = null;

export interface AlignmentResult {
  accountId: number;
  keywordsAligned: number;
  productTargetsAligned: number;
  tasksCancelled: number;
  forwardAligned: number;   // v525: 正向对齐发现的不一致数量
  reverseAligned: number;   // v525: 反向对齐发现的不一致数量
  errors: string[];
  durationMs: number;
}

// ============================================================
// 正向对齐（Forward Alignment）
// ============================================================

/**
 * v525: 正向对齐 - 同步完成后比对 Amazon 返回的实体列表与本地数据库
 * 
 * 工作原理:
 * 1. 接收同步模块传入的 Amazon 返回的实体 ID 列表
 * 2. 查询本地数据库中该账户下所有活跃的同类型实体
 * 3. 找出"本地有但 Amazon 没有"的实体
 * 4. 将这些实体标记为 amazon_deleted
 * 
 * @param accountId - 账户 ID
 * @param entityType - 实体类型
 * @param amazonEntityIds - Amazon API 返回的实体 Amazon ID 列表
 * @param campaignId - 可选，限定在特定广告活动范围内对齐
 */
export async function forwardAlign(
  accountId: number,
  entityType: 'keyword' | 'product_target',
  amazonEntityIds: string[],
  campaignId?: number
): Promise<{ aligned: number; entityIds: number[] }> {
  const result = { aligned: 0, entityIds: [] as number[] };
  
  if (amazonEntityIds.length === 0) return result;

  const database = await db.getDb();
  if (!database) return result;

  const { sql } = await import('drizzle-orm');

  try {
    const amazonIdSet = new Set(amazonEntityIds.map(id => String(id)));
    
    // 查询本地活跃实体
    const tableName = entityType === 'keyword' ? 'keywords' : 'product_targets';
    const statusCol = entityType === 'keyword' ? 'keywordStatus' : 'targetStatus';
    const amazonIdCol = entityType === 'keyword' ? 'keywordId' : 'targetId';
    
    let localQuery = `
      SELECT id, ${amazonIdCol} as amazonId 
      FROM ${tableName} 
      WHERE account_id = ${Number(accountId)}
        AND ${statusCol} NOT IN ('amazon_deleted', 'archived', 'deleted')
    `;
    if (campaignId) {
      localQuery += ` AND campaign_id = ${Number(campaignId)}`;
    }

    const [localRows] = await database.execute(sql.raw(localQuery)) as any;
    
    if (!Array.isArray(localRows) || localRows.length === 0) return result;

    // 找出本地有但 Amazon 没有的实体
    const missingEntities: number[] = [];
    for (const row of localRows) {
      const amazonId = String(row.amazonId);
      if (amazonId && !amazonIdSet.has(amazonId)) {
        missingEntities.push(Number(row.id));
      }
    }

    if (missingEntities.length === 0) return result;

    // 安全阈值: 如果超过 50% 的本地实体在 Amazon 端"消失"，可能是 API 分页问题而非真正删除
    const missingRatio = missingEntities.length / localRows.length;
    if (missingRatio > 0.5 && missingEntities.length > 10) {
      log.warn(`[v525] 正向对齐安全阈值触发: 账户${accountId} ${entityType} ` +
        `${missingEntities.length}/${localRows.length} (${(missingRatio * 100).toFixed(1)}%) 实体缺失, ` +
        `疑似API分页不完整, 跳过标记`);
      logSyncWarn('EntityStateAlignment', `正向对齐安全阈值触发`, {
        accountId, entityType, missing: missingEntities.length, total: localRows.length
      });
      return result;
    }

    // 批量标记为 amazon_deleted
    const BATCH_SIZE = 500;
    for (let i = 0; i < missingEntities.length; i += BATCH_SIZE) {
      const batch = missingEntities.slice(i, i + BATCH_SIZE);
      const idList = batch.join(',');
      await database.execute(
        sql.raw(`UPDATE ${tableName} SET ${statusCol} = 'amazon_deleted', updatedAt = NOW() WHERE id IN (${idList}) AND ${statusCol} NOT IN ('amazon_deleted', 'archived')`)
      );
    }

    result.aligned = missingEntities.length;
    result.entityIds = missingEntities;

    // 更新缓存
    for (const id of missingEntities) {
      deletedEntityCache.set(`${entityType}:${id}`, Date.now());
    }

    if (missingEntities.length > 0) {
      log.warn(`[v525] 正向对齐: 账户${accountId} 标记 ${missingEntities.length} 个 ${entityType} 为 amazon_deleted`);
      logSync('EntityStateAlignment', `正向对齐完成`, {
        accountId, entityType, aligned: missingEntities.length
      });
    }

    // 取消引用这些实体的待处理任务
    if (missingEntities.length > 0) {
      for (let i = 0; i < missingEntities.length; i += BATCH_SIZE) {
        const batch = missingEntities.slice(i, i + BATCH_SIZE);
        const idList = batch.join(',');
        await database.execute(
          sql.raw(`
            UPDATE optimization_tasks 
            SET status = 'cancelled', 
                error_message = CONCAT(COALESCE(error_message, ''), ' | v525: 正向对齐-实体在Amazon端不存在'),
                completed_at = NOW()
            WHERE target_entity_id IN (${idList})
              AND account_id = ${Number(accountId)}
              AND status IN ('pending', 'retry')
          `)
        );
      }
    }

  } catch (err: unknown) {
    log.warn(`[v525] 正向对齐失败: 账户${accountId} ${entityType}: ${(err as Error).message}`);
  }

  return result;
}

// ============================================================
// 反向对齐（Reverse Alignment）- 保留 v523.2 的错误驱动对齐
// ============================================================

/**
 * v523.2 → v525: 检查实体是否已被标记为 amazon_deleted
 * 供优化引擎在创建任务前调用
 */
export async function isEntityDeleted(entityType: 'keyword' | 'product_target', entityId: number): Promise<boolean> {
  const cacheKey = `${entityType}:${entityId}`;
  const cachedTime = deletedEntityCache.get(cacheKey);
  if (cachedTime && (Date.now() - cachedTime) < CACHE_TTL_MS) {
    return true;
  }

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
    log.debug(`[v525] isEntityDeleted 查询失败: ${(err as Error).message}`);
  }

  return false;
}

/**
 * v523.2 → v525: 批量检查实体是否已删除（高性能版本）
 */
export async function filterDeletedEntities(
  entityType: 'keyword' | 'product_target',
  entityIds: number[]
): Promise<Set<number>> {
  const deletedIds = new Set<number>();
  if (entityIds.length === 0) return deletedIds;

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
    log.debug(`[v525] filterDeletedEntities 批量查询失败: ${(err as Error).message}`);
  }

  return deletedIds;
}

/**
 * 反向对齐: 对指定账户执行错误驱动的实体状态对齐
 */
export async function alignEntityStates(accountId: number, incremental: boolean = false): Promise<AlignmentResult> {
  const startTime = Date.now();
  const result: AlignmentResult = {
    accountId,
    keywordsAligned: 0,
    productTargetsAligned: 0,
    tasksCancelled: 0,
    forwardAligned: 0,
    reverseAligned: 0,
    errors: [],
    durationMs: 0,
  };

  log.info(`[v525] 反向对齐开始: 账户 ${accountId}, 模式=${incremental ? '增量' : '全量'}`);

  const database = await db.getDb();
  if (!database) {
    result.errors.push('数据库不可用');
    result.durationMs = Date.now() - startTime;
    return result;
  }

  const { sql } = await import('drizzle-orm');

  const timeFilter = incremental && lastAlignmentTime
    ? `AND ot.completed_at >= '${lastAlignmentTime.toISOString().slice(0, 19).replace('T', ' ')}'`
    : `AND ot.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;

  try {
    // Step 1: 扫描因 entityNotFoundError 失败的 keyword 任务
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
      result.reverseAligned += keywordEntityIds.length;
      for (const id of keywordEntityIds) {
        deletedEntityCache.set(`keyword:${id}`, Date.now());
      }
      log.warn(`[v525] 反向对齐: 账户 ${accountId} 标记 ${keywordEntityIds.length} 个 keyword 为 amazon_deleted`);
    }

    // Step 2: 扫描因 entityNotFoundError 失败的 product_target 任务
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
      result.reverseAligned += targetEntityIds.length;
      for (const id of targetEntityIds) {
        deletedEntityCache.set(`target:${id}`, Date.now());
      }
      log.warn(`[v525] 反向对齐: 账户 ${accountId} 标记 ${targetEntityIds.length} 个 product_target 为 amazon_deleted`);
    }

    // Step 3: 取消引用已删除实体的待处理任务
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
                error_message = CONCAT(COALESCE(error_message, ''), ' | v525: 反向对齐-实体已在Amazon端删除'),
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
        log.warn(`[v525] 反向对齐: 账户 ${accountId} 取消 ${totalCancelled} 个引用已删除实体的待处理任务`);
      }
    }

    log.info(`[v525] 反向对齐完成: 账户 ${accountId}, ` +
      `keywords=${result.keywordsAligned}, targets=${result.productTargetsAligned}, ` +
      `cancelled=${result.tasksCancelled}`);

  } catch (err: unknown) {
    const errMsg = (err as Error).message;
    result.errors.push(errMsg);
    log.warn(`[v525] 反向对齐失败: 账户 ${accountId}, 错误: ${errMsg}`);
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

/**
 * 对所有活跃账户执行反向对齐
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

  log.info(`[v525] 全账户反向对齐开始, 模式=${incremental ? '增量' : '全量'}...`);

  const database = await db.getDb();
  if (!database) {
    log.warn('[v525] 数据库不可用，跳过全账户对齐');
    return summary;
  }

  const { sql } = await import('drizzle-orm');

  try {
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
    log.info(`[v525] 发现 ${accountIds.length} 个账户需要反向对齐`);

    for (const accountId of accountIds) {
      const result = await alignEntityStates(accountId, incremental);
      summary.accountResults.push(result);
      summary.totalKeywordsAligned += result.keywordsAligned;
      summary.totalTargetsAligned += result.productTargetsAligned;
      summary.totalTasksCancelled += result.tasksCancelled;

      // 账户间延迟，避免数据库压力
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    lastAlignmentTime = new Date();
    cleanupCache();

    log.info(`[v525] 全账户反向对齐完成: ` +
      `${summary.totalAccounts}个账户, ` +
      `keywords=${summary.totalKeywordsAligned}, targets=${summary.totalTargetsAligned}, ` +
      `cancelled=${summary.totalTasksCancelled}`);

  } catch (err: unknown) {
    log.warn(`[v525] 全账户反向对齐失败: ${(err as Error).message}`);
  }

  return summary;
}

// ============================================================
// 对齐健康报告
// ============================================================

export interface AlignmentHealthReport {
  cacheSize: number;
  verificationMapSize: number;
  globalSyncVersion: number;
  lastAlignmentTime: string | null;
  schedulerRunning: boolean;
}

/**
 * v525: 获取对齐模块健康报告
 */
export function getAlignmentHealth(): AlignmentHealthReport {
  return {
    cacheSize: deletedEntityCache.size,
    verificationMapSize: entityVerificationMap.size,
    globalSyncVersion,
    lastAlignmentTime: lastAlignmentTime?.toISOString() || null,
    schedulerRunning: alignmentInterval !== null,
  };
}

// ============================================================
// 调度器
// ============================================================

/**
 * v525: 启动独立定时对齐器
 * 每 30 分钟执行一次增量反向对齐扫描
 */
export function startAlignmentScheduler(): void {
  if (alignmentInterval) {
    log.info('[v525] 对齐调度器已在运行，跳过重复启动');
    return;
  }

  const INTERVAL_MS = 30 * 60 * 1000; // 30 分钟

  alignmentInterval = setInterval(async () => {
    try {
      log.info('[v525] 独立增量反向对齐扫描开始...');
      const result = await alignAllAccountEntityStates(true);
      const totalAligned = result.totalKeywordsAligned + result.totalTargetsAligned;
      if (totalAligned > 0 || result.totalTasksCancelled > 0) {
        log.warn(`[v525] 增量对齐发现问题: aligned=${totalAligned}, cancelled=${result.totalTasksCancelled}`);
      } else {
        log.info('[v525] 增量对齐扫描完成，无新的不一致实体');
      }
    } catch (err: unknown) {
      log.warn(`[v525] 独立增量对齐失败: ${(err as Error).message}`);
    }
  }, INTERVAL_MS);

  // 同时定期清理验证映射（每 6 小时清理超过 24 小时未验证的条目）
  setInterval(() => {
    const cutoff = Date.now() - CACHE_TTL_MS;
    let cleaned = 0;
    for (const [key, record] of entityVerificationMap.entries()) {
      if (record.lastVerifiedAt.getTime() < cutoff) {
        entityVerificationMap.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      log.debug(`[v525] 清理 ${cleaned} 个过期验证记录, 剩余 ${entityVerificationMap.size} 个`);
    }
  }, 6 * 60 * 60 * 1000);

  log.info(`[v525] 双向状态对齐调度器已启动 (反向对齐间隔: 30分钟)`);
}

/**
 * v525: 停止独立定时对齐器
 */
export function stopAlignmentScheduler(): void {
  if (alignmentInterval) {
    clearInterval(alignmentInterval);
    alignmentInterval = null;
    log.info('[v525] 双向状态对齐调度器已停止');
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
    log.debug(`[v525] 清理 ${cleaned} 个过期缓存条目, 剩余 ${deletedEntityCache.size} 个`);
  }
}
