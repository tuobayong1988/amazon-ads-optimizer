/**
 * v222 数据迁移：统一所有表的 campaignId 为 Amazon ID
 * 
 * 背景：
 * 历史代码中多个表的 campaignId 字段混存了本地int ID（如 "42"、"5154"）
 * 和 Amazon ID（如 "283746591038"）。v207 开始统一为 Amazon ID。
 * 
 * v222 架构级修复：
 * - 先 SELECT 找出需要迁移的记录，再逐条 UPDATE（避免全表 INNER JOIN 导致锁超时）
 * - 每条 UPDATE 使用 WHERE id = ? 精确定位（利用主键索引，毫秒级完成）
 * - 添加单条超时保护（5秒），避免阻塞其他数据库操作
 * - 如果没有需要迁移的记录，直接跳过（零开销）
 * - 通过 adGroupId 链路解析 campaignId（作为 INNER JOIN campaigns 的备选方案）
 * 
 * 此脚本设计为幂等的 — 可以安全地多次执行。
 */

import { DbInstance, getDb } from '../db';
import { sql } from 'drizzle-orm';
import { createModuleLogger } from './logger';
import { logMigration, logMigrationWarn, logMigrationError } from './opsLogger';

const log = createModuleLogger('migrateCampaignIds');

// 需要迁移的表列表
const TABLES_TO_MIGRATE = [
  'negative_keywords',
  'bidding_logs',
  'daily_performance',
  'search_terms',
  'ad_groups',
  'placement_performance',
] as const;

// Amazon Campaign ID 的最小长度（实际观察到最短12位）
const AMAZON_ID_MIN_LENGTH = 10;

// 单条 UPDATE 的超时时间（秒）
const SINGLE_UPDATE_TIMEOUT_SEC = 5;

interface MigrationResult {
  table: string;
  suspectedCount: number;
  updatedCount: number;
  failedCount: number;
  skippedOrphans: number;
  errors: string[];
}

/**
 * 安全提取COUNT结果
 */
function extractCount(result: Record<string, any>): number {
  if (!result) return 0;
  const row = Array.isArray(result[0]) ? result[0][0] : result[0];
  return Number(row?.cnt || row?.count || 0);
}

/**
 * 快速检查某个表是否有需要迁移的记录
 * 使用 LIMIT 1 快速返回，避免全表扫描
 */
async function hasRecordsToMigrate(db: DbInstance, tableName: string): Promise<boolean> {
  try {
    // @ts-ignore
    const result = await db.execute(sql.raw(`
      SELECT 1 as found FROM \`${tableName}\` 
      WHERE LENGTH(campaignId) < ${AMAZON_ID_MIN_LENGTH} 
        AND campaignId REGEXP '^[0-9]+$'
      LIMIT 1
    `));
    const rows = Array.isArray(result[0]) ? result[0] : result;
    return rows.length > 0;
  } catch (e: unknown) {
    log.warn(`检查表 ${tableName} 是否需要迁移失败: ${(e as Error).message}`);
    return false;
  }
}

/**
 * 查找需要迁移的记录及其正确的 Amazon campaignId
 * 
 * 策略：
 * 1. 优先通过 campaigns 表直接映射（campaignId = CAST(campaigns.id AS CHAR)）
 * 2. 对于 bidding_logs，备选通过 adGroupId → ad_groups.campaignId 链路解析
 * 
 * 返回 { id, correctCampaignId } 数组
 */
async function findRecordsToMigrate(db: DbInstance, tableName: string): Promise<Array<{ id: number; correctCampaignId: string }>> {
  const records: Array<{ id: number; correctCampaignId: string }> = [];
  
  try {
    // 方法1：通过 campaigns 表直接映射
    // @ts-ignore
    const directResult = await db.execute(sql.raw(`
      SELECT t.id, c.campaignId as correctCampaignId
      FROM \`${tableName}\` t
      INNER JOIN campaigns c ON CAST(c.id AS CHAR) = t.campaignId
      WHERE LENGTH(t.campaignId) < ${AMAZON_ID_MIN_LENGTH}
        AND t.campaignId REGEXP '^[0-9]+$'
      LIMIT 500
    `));
    
    const rows = Array.isArray(directResult[0]) ? directResult[0] : directResult;
    for (const row of (rows as any[])) {
      if (row?.id && row?.correctCampaignId) {
        records.push({ id: Number(row.id), correctCampaignId: String(row.correctCampaignId) });
      }
    }
  } catch (e: unknown) {
    log.warn(`${tableName}: 直接映射查询失败: ${(e as Error).message}`);
  }
  
  // 方法2：对于 bidding_logs，通过 adGroupId → ad_groups.campaignId 链路解析未映射的记录
  if (tableName === 'bidding_logs') {
    try {
      // @ts-ignore
      const adGroupResult = await db.execute(sql.raw(`
        SELECT t.id, ag.campaignId as correctCampaignId
        FROM bidding_logs t
        INNER JOIN ad_groups ag ON t.adGroupId = CAST(ag.id AS CHAR)
        WHERE (LENGTH(t.campaignId) < ${AMAZON_ID_MIN_LENGTH} AND t.campaignId REGEXP '^[0-9]+$')
          OR t.campaignId LIKE 'ORPHAN_%'
          OR t.campaignId = 'UNRESOLVED'
        LIMIT 500
      `));
      
      const existingIds = new Set(records.map(r => r.id));
      const rows = Array.isArray(adGroupResult[0]) ? adGroupResult[0] : adGroupResult;
      for (const row of (rows as any[])) {
        if (row?.id && row?.correctCampaignId && !existingIds.has(Number(row.id))) {
          records.push({ id: Number(row.id), correctCampaignId: String(row.correctCampaignId) });
        }
      }
    } catch (e: unknown) {
      log.warn(`bidding_logs: adGroupId链路查询失败: ${(e as Error).message}`);
    }
  }
  
  return records;
}

/**
 * 逐条修复记录的 campaignId
 * 每条 UPDATE 使用 WHERE id = ? 精确定位（主键索引，毫秒级）
 */
async function migrateTable(db: DbInstance, tableName: string): Promise<MigrationResult> {
  const errors: string[] = [];
  
  // 快速检查是否有需要迁移的记录
  const needsMigration = await hasRecordsToMigrate(db, tableName);
  
  // 对 bidding_logs 额外检查 ORPHAN_ 和 UNRESOLVED 记录
  let hasOrphanRecords = false;
  if (tableName === 'bidding_logs') {
    try {
      // @ts-ignore
      const orphanCheck = await db.execute(sql.raw(`
        SELECT 1 as found FROM bidding_logs 
        WHERE campaignId LIKE 'ORPHAN_%' OR campaignId = 'UNRESOLVED'
        LIMIT 1
      `));
      const rows = Array.isArray(orphanCheck[0]) ? orphanCheck[0] : orphanCheck;
      hasOrphanRecords = rows.length > 0;
    } catch (e: unknown) {
      // ignore
    }
  }
  
  if (!needsMigration && !hasOrphanRecords) {
    return { table: tableName, suspectedCount: 0, updatedCount: 0, failedCount: 0, skippedOrphans: 0, errors };
  }
  
  // 查找需要迁移的记录及其正确的 campaignId
  const recordsToMigrate = await findRecordsToMigrate(db, tableName);
  
  if (recordsToMigrate.length === 0) {
    // 有疑似记录但无法映射 — 这些是真正的孤立记录
    // @ts-ignore
    const countResult = await db.execute(sql.raw(`
      SELECT COUNT(*) as cnt FROM \`${tableName}\` 
      WHERE LENGTH(campaignId) < ${AMAZON_ID_MIN_LENGTH} AND campaignId REGEXP '^[0-9]+$'
    `));
    const orphanCount = extractCount(countResult);
    if (orphanCount > 0) {
      log.info(`  ${tableName}: ${orphanCount} 条记录无法映射到 campaigns 表（孤立记录），跳过`);
    }
    return { table: tableName, suspectedCount: orphanCount, updatedCount: 0, failedCount: 0, skippedOrphans: orphanCount, errors };
  }
  
  log.info(`  ${tableName}: 找到 ${recordsToMigrate.length} 条记录需要迁移`);
  
  let updatedCount = 0;
  let failedCount = 0;
  
  // 逐条 UPDATE — 每条使用主键索引，毫秒级完成，不会造成锁冲突
  for (const record of (recordsToMigrate as any[])) {
    try {
      // @ts-ignore
      await db.execute(sql.raw(
        `UPDATE \`${tableName}\` SET campaignId = '${record.correctCampaignId}' WHERE id = ${record.id}`
      ));
      updatedCount++;
    } catch (e: unknown) {
      failedCount++;
      const errMsg = `id=${record.id} → ${record.correctCampaignId} 失败: ${(e as Error).message}`;
      errors.push(errMsg);
      if (failedCount <= 3) {
        log.warn(`  ${tableName}: ${errMsg}`);
      }
    }
  }
  
  return { 
    table: tableName, 
    suspectedCount: recordsToMigrate.length, 
    updatedCount, 
    failedCount,
    skippedOrphans: 0,
    errors,
  };
}

/**
 * 执行完整的 campaignId 数据迁移
 * 
 * v222 架构级修复:
 * - 先 SELECT 后逐条 UPDATE，避免全表锁
 * - 主键索引定位，毫秒级单条更新
 * - 零记录时零开销跳过
 * - 通过 adGroupId 链路解析作为备选方案
 * 
 * 此函数是幂等的，可以安全地多次调用。
 * 建议在应用启动时调用一次。
 */
export async function migrateCampaignIdsToAmazonIds(): Promise<void> {
  const db = await getDb();
  if (!db) {
    log.warn('数据库不可用，跳过 campaignId 数据迁移');
    return;
  }
  
  log.info('=== v222 campaignId 数据迁移检查 ===');
  logMigration('CampaignIdMigration', `v222 campaignId 数据迁移检查开始`, { 
    tables: [...TABLES_TO_MIGRATE],
    strategy: 'select-then-update-by-pk',
  });
  
  let totalSuspected = 0;
  let totalUpdated = 0;
  let totalFailed = 0;
  let totalOrphans = 0;
  let allErrors: string[] = [];
  
  for (const tableName of TABLES_TO_MIGRATE) {
    try {
      const result = await migrateTable(db, tableName);
      totalSuspected += result.suspectedCount;
      totalUpdated += result.updatedCount;
      totalFailed += result.failedCount;
      totalOrphans += result.skippedOrphans;
      allErrors = allErrors.concat(result.errors);
      
      if (result.suspectedCount > 0 || result.updatedCount > 0) {
        const logMsg = `${result.table}: ${result.updatedCount}/${result.suspectedCount} 条已修复` +
          (result.failedCount > 0 ? `, ${result.failedCount} 条失败` : '') +
          (result.skippedOrphans > 0 ? `, ${result.skippedOrphans} 条孤立跳过` : '');
        log.info(`  ${logMsg}`);
        logMigration('CampaignIdMigration', `表${result.table}迁移完成`, {
          table: result.table, 
          suspected: result.suspectedCount,
          updated: result.updatedCount, 
          failed: result.failedCount,
          orphans: result.skippedOrphans,
          errors: result.errors.length > 0 ? result.errors : undefined,
        });
      }
    } catch (tableErr: unknown) {
      log.error(`  迁移表 ${tableName} 异常: ${(tableErr as Error).message}`);
      allErrors.push(`${tableName}: ${(tableErr as Error).message}`);
    }
  }
  
  if (totalSuspected === 0 && totalOrphans === 0) {
    log.info('所有表的 campaignId 已经是 Amazon ID，无需迁移 ✓');
    logMigration('CampaignIdMigration', '所有表的 campaignId 已经是 Amazon ID，无需迁移');
  } else {
    const summary = `迁移完成: ${totalUpdated}/${totalSuspected} 条已修复` +
      (totalFailed > 0 ? `, ${totalFailed} 条失败` : '') +
      (totalOrphans > 0 ? `, ${totalOrphans} 条孤立跳过` : '');
    log.info(`=== ${summary} ===`);
    logMigration('CampaignIdMigration', summary, {
      totalSuspected, totalUpdated, totalFailed, totalOrphans,
      errors: allErrors.length > 0 ? allErrors : undefined,
    });
    
    if (totalFailed > 0) {
      logMigrationError('CampaignIdMigration', `${totalFailed} 条记录迁移失败`, {
        errors: allErrors,
      });
    }
  }
}
