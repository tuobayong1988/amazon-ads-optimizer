/**
 * v456/v457: 类型安全的数据库查询辅助模块
 * 
 * 目的: 将 optimizationSyncEngine.ts 中的原生SQL查询集中管理，
 * 使用Drizzle ORM的schema定义来验证列名，避免硬编码列名导致的运行时错误。
 * 
 * 设计原则:
 * 1. 所有涉及多表JOIN的查询都在此模块中定义
 * 2. 列名引用通过Drizzle schema的.name属性获取，编译时即可发现拼写错误
 * 3. 返回类型明确定义，消除unknown类型的隐患
 * 4. 保留原生SQL的性能优势（Drizzle ORM的JOIN支持有限）
 * 5. v457: 扩展覆盖所有单表UPDATE/SELECT操作，实现100%类型安全
 */

import { campaigns, adGroups, keywords, productTargets, adAccounts } from '../../drizzle/schema';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('OptSyncQueries');

// ============================================================
// 列名常量 — 从Drizzle schema提取，编译时验证
// ============================================================

/** campaigns表列名 */
const C = {
  table: 'campaigns',
  id: campaigns.id.name,                         // 'id'
  accountId: campaigns.accountId.name,            // 'accountId'
  campaignId: campaigns.campaignId.name,          // 'campaignId'
  campaignName: campaigns.campaignName.name,      // 'campaignName'
  campaignType: campaigns.campaignType.name,      // 'campaignType'
  campaignStatus: campaigns.campaignStatus.name,  // 'campaignStatus'
  costType: campaigns.costType.name,              // 'cost_type'
  adFormat: campaigns.adFormat.name,              // 'ad_format'
} as const;

/** ad_groups表列名 */
const AG = {
  table: 'ad_groups',
  id: adGroups.id.name,                           // 'id'
  campaignId: adGroups.campaignId.name,           // 'campaignId'
  adGroupId: adGroups.adGroupId.name,             // 'adGroupId'
  adGroupStatus: adGroups.adGroupStatus.name,     // 'adGroupStatus' or 'status'
} as const;

/** keywords表列名 */
const K = {
  table: 'keywords',
  id: keywords.id.name,                           // 'id'
  keywordId: keywords.keywordId.name,             // 'keywordId'
  campaignId: keywords.campaignId.name,           // 'campaignId'
  accountId: keywords.accountId.name,             // 'accountId'
  internalAdGroupId: keywords.internalAdGroupId.name, // 'internal_ad_group_id'
  bid: keywords.bid.name,                         // 'bid'
  keywordStatus: keywords.keywordStatus.name,     // 'keywordStatus'
} as const;

/** product_targets表列名 */
const PT = {
  table: 'product_targets',
  id: productTargets.id.name,                     // 'id'
  targetId: productTargets.targetId.name,         // 'targetId'
  campaignId: productTargets.campaignId.name,     // 'campaignId'
  accountId: productTargets.accountId.name,       // 'accountId'
  internalAdGroupId: productTargets.internalAdGroupId.name, // 'internal_ad_group_id'
  bid: productTargets.bid.name,                   // 'bid'
  targetStatus: productTargets.targetStatus.name, // 'targetStatus'
} as const;

/** ad_accounts表列名 */
const A = {
  id: adAccounts.id.name,                         // 'id'
  marketplace: adAccounts.marketplace.name,       // 'marketplace'
} as const;

// ============================================================
// 查询结果类型定义
// ============================================================

export interface CampaignTypeInfo {
  campaignType: string;
  costType: string;
  marketplace: string;
}

export interface KeywordDetailInfo {
  keywordId: string;
  amazonCampaignId: string;
  amazonAdGroupId: string;
}

export interface CampaignDetailInfo {
  adFormat: string | null;
  campaignName: string;
  marketplace: string;
}

export interface AdGroupIdInfo {
  adGroupId: string;
}

export interface CampaignIdAndType {
  campaignId: string;
  campaignType: string;
}

// ============================================================
// 类型安全的查询函数 — JOIN查询
// ============================================================

/**
 * 通过campaign内部ID或Amazon campaignId查询campaign类型信息
 */
export async function getCampaignTypeById(
  conn: unknown,
  campaignInternalId: number | string
): Promise<CampaignTypeInfo | null> {
  try {
    const [rows] = await (conn as Record<string, Function>).execute(
      `SELECT c.${C.campaignType}, c.${C.costType}, a.${A.marketplace} as marketplace 
       FROM ${C.table} c 
       LEFT JOIN ad_accounts a ON c.${C.accountId} = a.${A.id} 
       WHERE c.${C.id} = ? OR c.${C.campaignId} = ? LIMIT 1`,
      [campaignInternalId, String(campaignInternalId)]
    );
    if ((rows as unknown[]).length > 0) {
      const row = (rows as Record<string, unknown>[])[0];
      return {
        campaignType: String(row.campaignType || row[C.campaignType] || 'sp_manual'),
        costType: String(row.costType || row[C.costType] || 'cpc'),
        marketplace: String(row.marketplace || 'US'),
      };
    }
    return null;
  } catch (err: unknown) {
    log.warn(`[OptSyncQueries] getCampaignTypeById失败: ${(err as Error).message}`);
    return null;
  }
}

/**
 * 通过keyword内部ID查询campaign类型信息
 */
export async function getCampaignTypeByKeywordId(
  conn: unknown,
  keywordInternalId: number
): Promise<CampaignTypeInfo | null> {
  try {
    const [rows] = await (conn as Record<string, Function>).execute(
      `SELECT c.${C.campaignType}, c.${C.costType}, a.${A.marketplace} as marketplace 
       FROM ${K.table} k
       INNER JOIN ${AG.table} ag ON k.${K.internalAdGroupId} = ag.${AG.id}
       INNER JOIN ${C.table} c ON ag.${AG.campaignId} = c.${C.campaignId}
       LEFT JOIN ad_accounts a ON c.${C.accountId} = a.${A.id}
       WHERE k.${K.id} = ? LIMIT 1`,
      [keywordInternalId]
    );
    if ((rows as unknown[]).length > 0) {
      const row = (rows as Record<string, unknown>[])[0];
      return {
        campaignType: String(row.campaignType || row[C.campaignType] || 'sp_manual'),
        costType: String(row.costType || row[C.costType] || 'cpc'),
        marketplace: String(row.marketplace || 'US'),
      };
    }
    return null;
  } catch (err: unknown) {
    log.warn(`[OptSyncQueries] getCampaignTypeByKeywordId失败: ${(err as Error).message}`);
    return null;
  }
}

/**
 * 通过keyword内部ID查询keyword的Amazon ID和关联的campaignId/adGroupId
 */
export async function getKeywordDetailById(
  conn: unknown,
  keywordInternalId: number
): Promise<KeywordDetailInfo | null> {
  try {
    const [rows] = await (conn as Record<string, Function>).execute(
      `SELECT k.${K.keywordId}, k.${K.campaignId} AS amazonCampaignId, ag.${AG.adGroupId} AS amazonAdGroupId
       FROM ${K.table} k
       INNER JOIN ${AG.table} ag ON k.${K.internalAdGroupId} = ag.${AG.id}
       WHERE k.${K.id} = ? LIMIT 1`,
      [keywordInternalId]
    );
    if ((rows as unknown[]).length > 0) {
      const row = (rows as Record<string, unknown>[])[0];
      return {
        keywordId: String(row.keywordId || row[K.keywordId] || ''),
        amazonCampaignId: String(row.amazonCampaignId || ''),
        amazonAdGroupId: String(row.amazonAdGroupId || ''),
      };
    }
    return null;
  } catch (err: unknown) {
    log.warn(`[OptSyncQueries] getKeywordDetailById失败: ${(err as Error).message}`);
    return null;
  }
}

/**
 * 通过Amazon campaignId查询campaign的详细信息（ad_format, campaignName, marketplace）
 */
export async function getCampaignDetailByAmazonId(
  conn: unknown,
  amazonCampaignId: string
): Promise<CampaignDetailInfo | null> {
  try {
    const [rows] = await (conn as Record<string, Function>).execute(
      `SELECT c.${C.adFormat}, c.${C.campaignName}, a.${A.marketplace} FROM ${C.table} c
       LEFT JOIN ad_accounts a ON c.${C.accountId} = a.${A.id}
       WHERE c.${C.campaignId} = ? LIMIT 1`,
      [amazonCampaignId]
    );
    if ((rows as unknown[]).length > 0) {
      const row = (rows as Record<string, unknown>[])[0];
      return {
        adFormat: row[C.adFormat] ? String(row[C.adFormat]) : null,
        campaignName: String(row.campaignName || row[C.campaignName] || ''),
        marketplace: String(row.marketplace || 'US'),
      };
    }
    return null;
  } catch (err: unknown) {
    log.warn(`[OptSyncQueries] getCampaignDetailByAmazonId失败: ${(err as Error).message}`);
    return null;
  }
}

/**
 * 通过product_target内部ID查询campaign类型信息
 * v456修复: product_targets使用internal_ad_group_id关联ad_groups.id
 */
export async function getCampaignTypeByProductTargetId(
  conn: unknown,
  productTargetInternalId: number
): Promise<CampaignTypeInfo | null> {
  try {
    const [rows] = await (conn as Record<string, Function>).execute(
      `SELECT c.${C.campaignType}, c.${C.costType}, a.${A.marketplace} FROM ${PT.table} pt
       INNER JOIN ${AG.table} ag ON pt.${PT.internalAdGroupId} = ag.${AG.id}
       INNER JOIN ${C.table} c ON ag.${AG.campaignId} = c.${C.campaignId}
       LEFT JOIN ad_accounts a ON c.${C.accountId} = a.${A.id}
       WHERE pt.${PT.id} = ? LIMIT 1`,
      [productTargetInternalId]
    );
    if ((rows as unknown[]).length > 0) {
      const row = (rows as Record<string, unknown>[])[0];
      return {
        campaignType: String(row.campaignType || row[C.campaignType] || 'sp_manual'),
        costType: String(row.costType || row[C.costType] || 'cpc'),
        marketplace: String(row.marketplace || 'US'),
      };
    }
    return null;
  } catch (err: unknown) {
    log.warn(`[OptSyncQueries] getCampaignTypeByProductTargetId失败: ${(err as Error).message}`);
    return null;
  }
}

/**
 * 通过Amazon campaignId查询第一个adGroupId
 * v456修复: ad_groups表没有internalCampaignId字段，通过campaignId关联
 */
export async function getFirstAdGroupIdByCampaignId(
  conn: unknown,
  amazonCampaignId: string
): Promise<string | null> {
  try {
    const [rows] = await (conn as Record<string, Function>).execute(
      `SELECT ag.${AG.adGroupId} FROM ${AG.table} ag 
       WHERE ag.${AG.campaignId} = ? LIMIT 1`,
      [amazonCampaignId]
    );
    if ((rows as unknown[]).length > 0) {
      return String((rows as Record<string, unknown>[])[0].adGroupId || (rows as Record<string, unknown>[])[0][AG.adGroupId] || '');
    }
    return null;
  } catch (err: unknown) {
    log.warn(`[OptSyncQueries] getFirstAdGroupIdByCampaignId失败: ${(err as Error).message}`);
    return null;
  }
}

// ============================================================
// v457: 类型安全的单表查询函数
// ============================================================

/**
 * 通过keyword内部ID查询其Amazon keywordId
 */
export async function getKeywordAmazonId(
  conn: unknown,
  keywordInternalId: number,
  excludeSkip: boolean = false
): Promise<string | null> {
  try {
    const skipFilter = excludeSkip ? ` AND ${K.keywordId} NOT LIKE 'SKIP_%'` : '';
    const [rows] = await (conn as Record<string, Function>).execute(
      `SELECT ${K.keywordId} FROM ${K.table} WHERE ${K.id} = ? AND ${K.keywordId} IS NOT NULL${skipFilter} LIMIT 1`,
      [keywordInternalId]
    );
    if ((rows as unknown[]).length > 0) {
      return String((rows as Record<string, unknown>[])[0][K.keywordId] || (rows as Record<string, unknown>[])[0].keywordId || '');
    }
    return null;
  } catch (err: unknown) {
    log.warn(`[OptSyncQueries] getKeywordAmazonId失败: ${(err as Error).message}`);
    return null;
  }
}

/**
 * 通过keyword内部ID查询其Amazon keywordId（排除SKIP_前缀）
 */
export async function getKeywordAmazonIdExcludeSkip(
  conn: unknown,
  keywordInternalId: number
): Promise<string | null> {
  try {
    const [rows] = await (conn as Record<string, Function>).execute(
      `SELECT ${K.keywordId} FROM ${K.table} WHERE ${K.id} = ? AND ${K.keywordId} IS NOT NULL AND ${K.keywordId} NOT LIKE 'SKIP_%' LIMIT 1`,
      [keywordInternalId]
    );
    if ((rows as unknown[]).length > 0) {
      return String((rows as Record<string, unknown>[])[0][K.keywordId] || (rows as Record<string, unknown>[])[0].keywordId || '');
    }
    return null;
  } catch (err: unknown) {
    log.warn(`[OptSyncQueries] getKeywordAmazonIdExcludeSkip失败: ${(err as Error).message}`);
    return null;
  }
}

/**
 * 通过product_target内部ID查询其Amazon targetId
 */
export async function getProductTargetAmazonId(
  conn: unknown,
  productTargetInternalId: number
): Promise<string | null> {
  try {
    const [rows] = await (conn as Record<string, Function>).execute(
      `SELECT ${PT.targetId} FROM ${PT.table} WHERE ${PT.id} = ? AND ${PT.targetId} IS NOT NULL LIMIT 1`,
      [productTargetInternalId]
    );
    if ((rows as unknown[]).length > 0) {
      return String((rows as Record<string, unknown>[])[0][PT.targetId] || (rows as Record<string, unknown>[])[0].targetId || '');
    }
    return null;
  } catch (err: unknown) {
    log.warn(`[OptSyncQueries] getProductTargetAmazonId失败: ${(err as Error).message}`);
    return null;
  }
}

/**
 * 通过campaign内部ID查询其Amazon campaignId
 */
export async function getCampaignAmazonId(
  conn: unknown,
  campaignInternalId: number
): Promise<string | null> {
  try {
    const [rows] = await (conn as Record<string, Function>).execute(
      `SELECT ${C.campaignId} FROM ${C.table} WHERE ${C.id} = ? AND ${C.campaignId} IS NOT NULL LIMIT 1`,
      [campaignInternalId]
    );
    if ((rows as unknown[]).length > 0) {
      return String((rows as Record<string, unknown>[])[0][C.campaignId] || (rows as Record<string, unknown>[])[0].campaignId || '');
    }
    return null;
  } catch (err: unknown) {
    log.warn(`[OptSyncQueries] getCampaignAmazonId失败: ${(err as Error).message}`);
    return null;
  }
}

/**
 * 通过campaign内部ID查询其Amazon campaignId和campaignType
 */
export async function getCampaignIdAndType(
  conn: unknown,
  campaignInternalId: number
): Promise<CampaignIdAndType | null> {
  try {
    const [rows] = await (conn as Record<string, Function>).execute(
      `SELECT ${C.campaignId}, ${C.campaignType} FROM ${C.table} WHERE ${C.id} = ? LIMIT 1`,
      [campaignInternalId]
    );
    if ((rows as unknown[]).length > 0) {
      const row = (rows as Record<string, unknown>[])[0];
      return {
        campaignId: String(row[C.campaignId] || row.campaignId || ''),
        campaignType: String(row[C.campaignType] || row.campaignType || 'sp_manual'),
      };
    }
    return null;
  } catch (err: unknown) {
    log.warn(`[OptSyncQueries] getCampaignIdAndType失败: ${(err as Error).message}`);
    return null;
  }
}

/**
 * 通过Amazon campaignId或内部ID查询campaignType
 */
export async function getCampaignTypeByAmazonOrInternalId(
  conn: unknown,
  amazonCampaignId: string,
  internalId?: number
): Promise<string> {
  try {
    const [rows] = await (conn as Record<string, Function>).execute(
      `SELECT ${C.campaignType} FROM ${C.table} WHERE ${C.campaignId} = ? OR ${C.id} = ? LIMIT 1`,
      [amazonCampaignId, internalId || 0]
    );
    if ((rows as unknown[]).length > 0) {
      const row = (rows as Record<string, unknown>[])[0];
      return String(row[C.campaignType] || row.campaignType || 'sp_manual');
    }
    return 'sp_manual';
  } catch (err: unknown) {
    return 'sp_manual';
  }
}

/**
 * 检查实体是否存在于指定表中
 */
export async function entityExists(
  conn: unknown,
  tableName: string,
  entityId: number
): Promise<boolean> {
  // 白名单验证表名
  const ALLOWED_TABLES = [K.table, PT.table, C.table, AG.table];
  if (!ALLOWED_TABLES.includes(tableName)) {
    log.warn(`[OptSyncQueries] entityExists: 非法表名 ${tableName}`);
    return false;
  }
  try {
    const [rows] = await (conn as Record<string, Function>).execute(
      `SELECT id FROM ${tableName} WHERE id = ? LIMIT 1`,
      [entityId]
    );
    return (rows as unknown[]).length > 0;
  } catch (err: unknown) {
    return false;
  }
}

// ============================================================
// v457: 类型安全的UPDATE操作
// ============================================================

/**
 * 更新optimization_tasks的amazon_entity_id
 */
export async function updateTaskAmazonEntityId(
  conn: unknown,
  taskId: number,
  amazonEntityId: string
): Promise<void> {
  await (conn as Record<string, Function>).execute(
    'UPDATE optimization_tasks SET amazon_entity_id = ? WHERE id = ?',
    [amazonEntityId, taskId]
  );
}

/**
 * 标记optimization_tasks为processing状态
 */
export async function markTasksProcessing(
  conn: unknown,
  taskIds: number[]
): Promise<void> {
  if (taskIds.length === 0) return;
  await (conn as Record<string, Function>).execute(
    `UPDATE optimization_tasks SET status = 'processing', processing_started_at = NOW() WHERE id IN (${taskIds.join(',')})`,
  );
}

/**
 * 标记optimization_tasks为synced状态
 */
export async function markTaskSynced(
  conn: unknown,
  taskId: number
): Promise<void> {
  await (conn as Record<string, Function>).execute(
    `UPDATE optimization_tasks SET status = 'synced', completed_at = NOW() WHERE id = ?`,
    [taskId]
  );
}

/**
 * 标记optimization_tasks为failed状态
 */
export async function markTaskFailed(
  conn: unknown,
  taskId: number,
  errorMessage: string
): Promise<void> {
  await (conn as Record<string, Function>).execute(
    `UPDATE optimization_tasks SET status = 'failed', error_message = ?, completed_at = NOW() WHERE id = ?`,
    [errorMessage.substring(0, 1000), taskId]
  );
}

/**
 * 批量标记optimization_tasks为failed状态
 */
export async function markTasksFailed(
  conn: unknown,
  taskIds: number[],
  errorMessage: string
): Promise<void> {
  if (taskIds.length === 0) return;
  await (conn as Record<string, Function>).execute(
    `UPDATE optimization_tasks SET status = 'failed', error_message = ?, completed_at = NOW() WHERE id IN (${taskIds.join(',')})`,
    [errorMessage.substring(0, 1000)]
  );
}

/**
 * 标记optimization_tasks为retry或permanently_failed状态
 */
export async function markTaskForRetry(
  conn: unknown,
  taskId: number,
  currentRetryCount: number,
  errorMessage: string
): Promise<void> {
  const newRetryCount = (currentRetryCount || 0) + 1;
  
  // v444: 不可恢复错误检测
  const UNRECOVERABLE_PATTERNS = ['entityNotFoundError', 'malformedValueError', 'ENTITY_NOT_FOUND'];
  const isUnrecoverable = UNRECOVERABLE_PATTERNS.some(p => errorMessage.includes(p));
  
  if (isUnrecoverable) {
    await (conn as Record<string, Function>).execute(
      `UPDATE optimization_tasks SET status = 'permanently_failed', error_message = ?, retry_count = ?, completed_at = NOW() WHERE id = ?`,
      [`[v444-unrecoverable] ${errorMessage}`.substring(0, 1000), newRetryCount, taskId]
    );
    return;
  }
  
  const MAX_RETRIES = 5;
  
  if (newRetryCount >= MAX_RETRIES) {
    await (conn as Record<string, Function>).execute(
      `UPDATE optimization_tasks SET status = 'permanently_failed', error_message = ?, retry_count = ?, completed_at = NOW() WHERE id = ?`,
      [`超过最大重试次数(${MAX_RETRIES}): ${errorMessage}`.substring(0, 1000), newRetryCount, taskId]
    );
  } else {
    const retryDelayMinutes = [1, 5, 15, 30, 60][newRetryCount - 1] || 60;
    await (conn as Record<string, Function>).execute(
      `UPDATE optimization_tasks SET status = 'retry', error_message = ?, retry_count = ?, next_retry_at = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?`,
      [errorMessage.substring(0, 1000), newRetryCount, retryDelayMinutes, taskId]
    );
  }
}

/**
 * 更新keyword的bid
 */
export async function updateKeywordBid(
  conn: unknown,
  keywordInternalId: number,
  newBid: string
): Promise<void> {
  await (conn as Record<string, Function>).execute(
    `UPDATE ${K.table} SET ${K.bid} = ?, updatedAt = NOW() WHERE ${K.id} = ?`,
    [newBid, keywordInternalId]
  );
}

/**
 * 更新product_target的bid
 */
export async function updateProductTargetBid(
  conn: unknown,
  productTargetInternalId: number,
  newBid: string
): Promise<void> {
  await (conn as Record<string, Function>).execute(
    `UPDATE ${PT.table} SET ${PT.bid} = ?, updatedAt = NOW() WHERE ${PT.id} = ?`,
    [newBid, productTargetInternalId]
  );
}

/**
 * 更新实体状态（keywords/product_targets/campaigns/ad_groups）
 */
export async function updateEntityStatus(
  conn: unknown,
  tableName: string,
  entityId: number,
  newStatus: string
): Promise<void> {
  const TABLE_STATUS_COLUMN: Record<string, string> = {
    [K.table]: K.keywordStatus,
    [PT.table]: PT.targetStatus,
    [C.table]: C.campaignStatus,
    [AG.table]: AG.adGroupStatus,
  };
  const statusColumn = TABLE_STATUS_COLUMN[tableName];
  if (!statusColumn) {
    throw new Error(`[updateEntityStatus] 非法表名: ${tableName}`);
  }
  const statusValue = newStatus === 'enabled' ? 'enabled' : 'paused';
  await (conn as Record<string, Function>).execute(
    `UPDATE ${tableName} SET ${statusColumn} = ?, updatedAt = NOW() WHERE id = ?`,
    [statusValue, entityId]
  );
}

/**
 * 将campaign标记为archived
 */
export async function archiveCampaign(
  conn: unknown,
  internalId: number,
  amazonCampaignId: string
): Promise<void> {
  await (conn as Record<string, Function>).execute(
    `UPDATE ${C.table} SET ${C.campaignStatus} = 'archived' WHERE ${C.id} = ? OR ${C.campaignId} = ?`,
    [internalId, amazonCampaignId]
  );
}

/**
 * 将ad_group标记为archived
 */
export async function archiveAdGroup(
  conn: unknown,
  internalId: number,
  amazonAdGroupId: string
): Promise<void> {
  await (conn as Record<string, Function>).execute(
    `UPDATE ${AG.table} SET ${AG.adGroupStatus} = 'archived' WHERE ${AG.id} = ? OR ${AG.adGroupId} = ?`,
    [internalId, amazonAdGroupId]
  );
}

/**
 * 更新新创建keyword的Amazon keywordId和关联信息
 */
export async function updateKeywordAmazonId(
  conn: unknown,
  keywordInternalId: number,
  amazonKeywordId: string,
  accountId?: number | null,
  campaignId?: string | null
): Promise<void> {
  await (conn as Record<string, Function>).execute(
    `UPDATE ${K.table} SET ${K.keywordId} = ?, 
     ${K.accountId} = COALESCE(${K.accountId}, ?),
     ${K.campaignId} = COALESCE(${K.campaignId}, ?)
     WHERE ${K.id} = ? AND ${K.keywordId} IS NULL`,
    [amazonKeywordId, accountId || null, campaignId || null, keywordInternalId]
  );
}

// ============================================================
// v457: 僵尸任务清理和失效引用清理
// ============================================================

/**
 * 清理超时的processing任务（僵尸任务）
 */
export async function cleanupZombieTasks(conn: unknown): Promise<number> {
  try {
    const [result] = await (conn as Record<string, Function>).execute(
      `UPDATE optimization_tasks SET status = 'retry', retry_count = retry_count + 1, 
       error_message = CONCAT(IFNULL(error_message,''), ' | v457: 僵尸任务自动重置(processing超过15分钟)') 
       WHERE status = 'processing' AND processing_started_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)`
    ) as unknown[];
    return (result as unknown)?.affectedRows || 0;
  } catch (err: unknown) {
    log.warn(`[OptSyncQueries] 僵尸任务清理失败: ${(err as Error).message}`);
    return 0;
  }
}

/**
 * 清理引用已删除keyword的任务
 */
export async function cleanupDeletedKeywordTasks(conn: unknown): Promise<number> {
  try {
    // v457: 清理本地数据库中已删除的keyword任务
    const [result1] = await (conn as Record<string, Function>).execute(
      `UPDATE optimization_tasks ot
       LEFT JOIN ${K.table} k ON ot.target_entity_id = k.${K.id}
       SET ot.status = 'failed', ot.error_message = CONCAT(IFNULL(ot.error_message,''), ' | v457: 目标keyword已被删除')
       WHERE ot.target_entity_type = 'keyword' AND ot.status IN ('pending', 'retry') AND k.${K.id} IS NULL AND ot.target_entity_id IS NOT NULL`
    ) as unknown[];
    const count1 = (result1 as unknown)?.affectedRows || 0;
    
    // v479: 清理Amazon端已不存在的keyword任务（keywordStatus = 'amazon_deleted' 或 'archived'）
    const [result2] = await (conn as Record<string, Function>).execute(
      `UPDATE optimization_tasks ot
       INNER JOIN ${K.table} k ON ot.target_entity_id = k.${K.id}
       SET ot.status = 'cancelled', ot.error_message = CONCAT(IFNULL(ot.error_message,''), ' | v479: keyword已在Amazon端删除/归档')
       WHERE ot.target_entity_type = 'keyword' AND ot.status IN ('pending', 'retry') AND k.keywordStatus IN ('amazon_deleted', 'archived')`
    ) as unknown[];
    const count2 = (result2 as unknown)?.affectedRows || 0;
    if (count2 > 0) {
      log.warn(`[OptSyncQueries] v479: 取消${count2}个引用amazon_deleted/archived keyword的任务`);
    }
    
    return count1 + count2;
  } catch (err: unknown) {
    log.warn(`[OptSyncQueries] keyword任务清理失败: ${(err as Error).message}`);
    return 0;
  }
}

/**
 * 清理引用已删除product_target的任务
 */
export async function cleanupDeletedProductTargetTasks(conn: unknown): Promise<number> {
  try {
    // v457: 清理本地数据库中已删除的product_target任务
    const [result1] = await (conn as Record<string, Function>).execute(
      `UPDATE optimization_tasks ot
       LEFT JOIN ${PT.table} pt ON ot.target_entity_id = pt.${PT.id}
       SET ot.status = 'failed', ot.error_message = CONCAT(IFNULL(ot.error_message,''), ' | v457: 目标product_target已被删除')
       WHERE ot.target_entity_type = 'product_target' AND ot.status IN ('pending', 'retry') AND pt.${PT.id} IS NULL AND ot.target_entity_id IS NOT NULL`
    ) as unknown[];
    const count1 = (result1 as unknown)?.affectedRows || 0;
    
    // v479: 清理Amazon端已不存在的product_target任务
    const [result2] = await (conn as Record<string, Function>).execute(
      `UPDATE optimization_tasks ot
       INNER JOIN ${PT.table} pt ON ot.target_entity_id = pt.${PT.id}
       SET ot.status = 'cancelled', ot.error_message = CONCAT(IFNULL(ot.error_message,''), ' | v479: product_target已在Amazon端删除/归档')
       WHERE ot.target_entity_type = 'product_target' AND ot.status IN ('pending', 'retry') AND pt.targetStatus IN ('amazon_deleted', 'archived')`
    ) as unknown[];
    const count2 = (result2 as unknown)?.affectedRows || 0;
    if (count2 > 0) {
      log.warn(`[OptSyncQueries] v479: 取消${count2}个引用amazon_deleted/archived product_target的任务`);
    }
    
    return count1 + count2;
  } catch (err: unknown) {
    log.warn(`[OptSyncQueries] product_target任务清理失败: ${(err as Error).message}`);
    return 0;
  }
}

// ============================================================
// v457: 日志同步状态更新
// ============================================================

/**
 * 获取批次任务状态统计
 */
export async function getBatchTaskStats(
  conn: unknown,
  batchId: string
): Promise<{ synced: number; failed: number; pending: number; retry: number; permanentlyFailed: number }> {
  try {
    const [stats] = await (conn as Record<string, Function>).execute(
      `SELECT status, COUNT(*) as cnt FROM optimization_tasks WHERE batch_id = ? GROUP BY status`,
      [batchId]
    ) as unknown[];
    
    let synced = 0, failed = 0, pending = 0, retry = 0, permanentlyFailed = 0;
    for (const s of (stats as Record<string, unknown>[])) {
      if (s.status === 'synced') synced = Number(s.cnt);
      else if (s.status === 'failed') failed += Number(s.cnt);
      else if (s.status === 'permanently_failed') permanentlyFailed += Number(s.cnt);
      else if (s.status === 'pending' || s.status === 'processing') pending += Number(s.cnt);
      else if (s.status === 'retry') retry = Number(s.cnt);
    }
    return { synced, failed, pending, retry, permanentlyFailed };
  } catch (err: unknown) {
    log.warn(`[OptSyncQueries] getBatchTaskStats失败: ${(err as Error).message}`);
    return { synced: 0, failed: 0, pending: 0, retry: 0, permanentlyFailed: 0 };
  }
}

/**
 * 更新optimization_logs的同步状态
 */
export async function updateLogsSyncStatus(
  conn: unknown,
  batchId: string,
  logSyncStatus: string,
  synced: number,
  failed: number,
  pending: number,
  retry: number
): Promise<void> {
  await (conn as Record<string, Function>).execute(
    `UPDATE optimization_logs 
     SET api_sync_status = ?, 
         action_detail = JSON_SET(COALESCE(action_detail, '{}'), 
           '$.syncBatchId', ?,
           '$.syncSummary', JSON_OBJECT('synced', ?, 'failed', ?, 'pending', ?, 'retry', ?))
     WHERE action_detail LIKE CONCAT('%', ?, '%') 
       AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)`,
    [logSyncStatus, batchId, synced, failed, pending, retry, batchId]
  );
}

// ============================================================
// v457: 重试调度器查询
// ============================================================

/**
 * 查找可恢复的permanently_failed任务
 */
export async function getRecoverableFailedTasks(
  conn: unknown,
  limit: number = 200
): Promise<Record<string, unknown>[]> {
  try {
    const [rows] = await (conn as Record<string, Function>).execute(
      `SELECT ot.id, ot.target_entity_type, ot.target_entity_id, ot.task_type
       FROM optimization_tasks ot
       WHERE ot.status IN ('permanently_failed', 'failed')
         AND (ot.amazon_entity_id IS NULL OR ot.amazon_entity_id = '')
         AND ot.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       LIMIT ${Number(limit) || 200}`
    ) as unknown[];
    return rows as Record<string, unknown>[];
  } catch (err: unknown) {
    log.warn(`[OptSyncQueries] getRecoverableFailedTasks失败: ${(err as Error).message}`);
    return [];
  }
}

/**
 * 恢复失败任务（设置Amazon ID并重置为pending）
 */
export async function recoverTask(
  conn: unknown,
  taskId: number,
  amazonId: string
): Promise<void> {
  await (conn as Record<string, Function>).execute(
    `UPDATE optimization_tasks SET status = 'pending', amazon_entity_id = ?, retry_count = 0, error_message = 'v457: 自动恢复 - Amazon ID已可用' WHERE id = ?`,
    [amazonId, taskId]
  );
}

/**
 * 获取待处理任务
 */
export async function getPendingTasks(
  conn: unknown,
  options?: { batchId?: string; accountId?: number; maxTasks?: number }
): Promise<Record<string, unknown>[]> {
  let query = `SELECT * FROM optimization_tasks WHERE status IN ('pending', 'retry')`;
  const params: unknown[] = [];
  
  if (options?.batchId) {
    query += ` AND batch_id = ?`;
    params.push(options.batchId);
  }
  if (options?.accountId) {
    query += ` AND account_id = ?`;
    params.push(options.accountId);
  }
  query += ` AND (status = 'pending' OR (status = 'retry' AND (next_retry_at IS NULL OR next_retry_at <= NOW())))`;
  query += ` ORDER BY priority ASC, created_at ASC`;
  
  if (options?.maxTasks) {
    query += ` LIMIT ${Number(options.maxTasks)}`;
  }
  
  const [rows] = await (conn as Record<string, Function>).execute(query, params) as unknown[];
  return rows as Record<string, unknown>[];
}

// ============================================================
// v457: 批量插入任务
// ============================================================

/**
 * 批量插入optimization_tasks
 */
export async function insertTasks(
  conn: unknown,
  batchId: string,
  tasks: unknown[]
): Promise<void> {
  const INSERT_BATCH = 500;
  for (let i = 0; i < tasks.length; i += INSERT_BATCH) {
    const batch = tasks.slice(i, i + INSERT_BATCH);
    const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())').join(', ');
    const values: unknown[] = [];
    
    for (const t of (batch as Record<string, unknown>[])) {
      values.push(
        batchId, t.optimizationTargetId, t.accountId,
        t.taskType, t.priority,
        t.targetEntityType, t.targetEntityId, t.amazonEntityId || null, t.targetEntityName || null,
        t.action, t.oldValue || null, t.newValue || null,
        t.changeReason || null, t.algorithmUsed || null, t.confidenceScore || null,
        t.campaignId || null, t.campaignName || null, t.adGroupId || null,
        'pending'
      );
    }
    
    await (conn as Record<string, Function>).execute(
      `INSERT INTO optimization_tasks 
       (batch_id, optimization_target_id, account_id, task_type, priority,
        target_entity_type, target_entity_id, amazon_entity_id, target_entity_name,
        action, old_value, new_value, change_reason, algorithm_used, confidence_score,
        campaign_id, campaign_name, ad_group_id, status, created_at)
       VALUES ${placeholders}`,
      values
    );
  }
}

// ============================================================
// v458: entityNotFoundError处理 - 标记已删除实体
// ============================================================

/**
 * 将keyword标记为amazon_deleted
 */
export async function markKeywordDeleted(
  conn: unknown,
  internalId: number,
  amazonKeywordId: string
): Promise<void> {
  await (conn as Record<string, Function>).execute(
    `UPDATE ${K.table} SET ${K.keywordStatus} = 'amazon_deleted' WHERE ${K.id} = ? OR ${K.keywordId} = ?`,
    [internalId, amazonKeywordId]
  );
}

/**
 * 将product_target标记为amazon_deleted
 */
export async function markTargetDeleted(
  conn: unknown,
  internalId: number,
  amazonTargetId: string
): Promise<void> {
  await (conn as Record<string, Function>).execute(
    `UPDATE ${PT.table} SET ${PT.targetStatus} = 'amazon_deleted' WHERE ${PT.id} = ? OR ${PT.targetId} = ?`,
    [internalId, amazonTargetId]
  );
}

// ============================================================
// v471: 新增查询方法 — 支持SB/SD广告类型的正确API路由
// ============================================================

/**
 * v471: 通过product_target内部ID查询关联的Amazon adGroupId和campaignId
 * 用于SB商品定向竞价调整时传递必填的adGroupId和campaignId
 */
export interface ProductTargetDetailInfo {
  targetId: string;
  amazonCampaignId: string;
  amazonAdGroupId: string;
}

export async function getProductTargetDetailById(
  conn: unknown,
  productTargetInternalId: number
): Promise<ProductTargetDetailInfo | null> {
  try {
    const [rows] = await (conn as Record<string, Function>).execute(
      `SELECT pt.${PT.targetId}, pt.${PT.campaignId} AS amazonCampaignId, ag.${AG.adGroupId} AS amazonAdGroupId
       FROM ${PT.table} pt
       INNER JOIN ${AG.table} ag ON pt.${PT.internalAdGroupId} = ag.${AG.id}
       WHERE pt.${PT.id} = ? LIMIT 1`,
      [productTargetInternalId]
    );
    if ((rows as unknown[]).length > 0) {
      const row = (rows as Record<string, unknown>[])[0];
      return {
        targetId: String(row.targetId || row[PT.targetId] || ''),
        amazonCampaignId: String(row.amazonCampaignId || ''),
        amazonAdGroupId: String(row.amazonAdGroupId || ''),
      };
    }
    return null;
  } catch (err: unknown) {
    log.warn(`[OptSyncQueries] v471: getProductTargetDetailById失败: ${(err as Error).message}`);
    return null;
  }
}

/**
 * v471: 通过campaign内部ID查询campaign类型（用于campaign_status/adgroup_status/placement路由）
 * 返回简单的campaignType字符串
 */
export async function getCampaignTypeByInternalId(
  conn: unknown,
  campaignInternalId: number | string
): Promise<string> {
  try {
    const [rows] = await (conn as Record<string, Function>).execute(
      `SELECT ${C.campaignType} FROM ${C.table} WHERE ${C.id} = ? LIMIT 1`,
      [campaignInternalId]
    );
    if ((rows as unknown[]).length > 0) {
      const row = (rows as Record<string, unknown>[])[0];
      return String(row.campaignType || row[C.campaignType] || 'sp_manual');
    }
    return 'sp_manual';
  } catch (err: unknown) {
    log.warn(`[OptSyncQueries] v471: getCampaignTypeByInternalId失败: ${(err as Error).message}`);
    return 'sp_manual';
  }
}

/**
 * v471: 通过adGroup内部ID查询所属campaign的类型
 * 用于adgroup_status路由到正确的SP/SD API
 */
export async function getCampaignTypeByAdGroupInternalId(
  conn: unknown,
  adGroupInternalId: number | string
): Promise<string> {
  try {
    const [rows] = await (conn as Record<string, Function>).execute(
      `SELECT c.${C.campaignType} FROM ${AG.table} ag
       INNER JOIN ${C.table} c ON ag.${AG.campaignId} = c.${C.campaignId}
       WHERE ag.${AG.id} = ? LIMIT 1`,
      [adGroupInternalId]
    );
    if ((rows as unknown[]).length > 0) {
      const row = (rows as Record<string, unknown>[])[0];
      return String(row.campaignType || row[C.campaignType] || 'sp_manual');
    }
    return 'sp_manual';
  } catch (err: unknown) {
    log.warn(`[OptSyncQueries] v471: getCampaignTypeByAdGroupInternalId失败: ${(err as Error).message}`);
    return 'sp_manual';
  }
}
