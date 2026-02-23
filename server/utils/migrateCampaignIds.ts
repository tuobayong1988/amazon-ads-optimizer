/**
 * v207 数据迁移：统一所有表的 campaignId 为 Amazon ID
 * 
 * 背景：
 * 历史代码中多个表的 campaignId 字段混存了本地int ID（如 "42"）
 * 和 Amazon ID（如 "283746591038"）。v207 统一为 Amazon ID。
 * 
 * 判断标准：
 * - campaigns.id 是自增int（通常 < 10000）
 * - campaigns.campaignId 是 Amazon ID（通常 > 10位数字字符串）
 * - 如果某表的 campaignId 值长度 <= 5 位且为纯数字，大概率是本地int
 * 
 * 此脚本设计为幂等的 — 可以安全地多次执行。
 */

import { getDb } from '../db';
import { sql } from 'drizzle-orm';
import { createModuleLogger } from '../logger';

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

interface MigrationResult {
  table: string;
  beforeCount: number;
  updatedCount: number;
  afterCount: number;
}

/**
 * 检查某个表中有多少条记录的 campaignId 疑似本地int
 */
async function countSuspectedLocalIds(db: any, tableName: string): Promise<number> {
  try {
    const result = await db.execute(sql.raw(`
      SELECT COUNT(*) as cnt FROM ${tableName} 
      WHERE LENGTH(campaignId) <= 5 AND campaignId REGEXP '^[0-9]+$'
    `));
    return result[0]?.cnt || result[0]?.[0]?.cnt || 0;
  } catch (e: any) {
    log.warn(`检查表 ${tableName} 失败: ${e.message}`);
    return 0;
  }
}

/**
 * 修复某个表中的 campaignId：本地int → Amazon ID
 */
async function migrateTable(db: any, tableName: string): Promise<MigrationResult> {
  const beforeCount = await countSuspectedLocalIds(db, tableName);
  
  if (beforeCount === 0) {
    return { table: tableName, beforeCount: 0, updatedCount: 0, afterCount: 0 };
  }
  
  try {
    // 通过 JOIN campaigns 表将本地int映射为 Amazon ID
    await db.execute(sql.raw(`
      UPDATE ${tableName} t
      INNER JOIN campaigns c ON t.campaignId = CAST(c.id AS CHAR)
      SET t.campaignId = c.campaignId
      WHERE LENGTH(t.campaignId) <= 5 
        AND t.campaignId REGEXP '^[0-9]+$'
    `));
    
    const afterCount = await countSuspectedLocalIds(db, tableName);
    const updatedCount = beforeCount - afterCount;
    
    return { table: tableName, beforeCount, updatedCount, afterCount };
  } catch (e: any) {
    log.error(`迁移表 ${tableName} 失败: ${e.message}`);
    return { table: tableName, beforeCount, updatedCount: 0, afterCount: beforeCount };
  }
}

/**
 * 执行完整的 campaignId 数据迁移
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
  
  log.info('=== v207 campaignId 数据迁移开始 ===');
  
  let totalBefore = 0;
  let totalUpdated = 0;
  let totalAfter = 0;
  
  for (const tableName of TABLES_TO_MIGRATE) {
    const result = await migrateTable(db, tableName);
    totalBefore += result.beforeCount;
    totalUpdated += result.updatedCount;
    totalAfter += result.afterCount;
    
    if (result.beforeCount > 0) {
      log.info(`  ${result.table}: ${result.beforeCount} 条疑似本地ID → ${result.updatedCount} 条已修复, ${result.afterCount} 条残留`);
    }
  }
  
  if (totalBefore === 0) {
    log.info('所有表的 campaignId 已经是 Amazon ID，无需迁移');
  } else {
    log.info(`=== 迁移完成: ${totalUpdated}/${totalBefore} 条记录已修复 ===`);
    if (totalAfter > 0) {
      log.warn(`⚠️ 仍有 ${totalAfter} 条记录无法映射（可能对应的campaign已被删除）`);
    }
  }
}
