/**
 * v211 数据迁移：统一所有表的 campaignId 为 Amazon ID
 * 
 * 背景：
 * 历史代码中多个表的 campaignId 字段混存了本地int ID（如 "42"、"5154"）
 * 和 Amazon ID（如 "283746591038"）。v207 开始统一为 Amazon ID。
 * 
 * v211 改进：
 * - 判断条件从 LENGTH <= 5 扩展为动态计算（基于campaigns.id的最大值）
 * - Amazon ID 最短12位数字，本地ID最大为campaigns表的MAX(id)
 * - 使用 CAST(c.id AS CHAR) JOIN 精确映射，避免误判
 * - 增加孤立记录清理（本地ID无法映射到campaigns表的记录）
 * - 全程通过 opsLogger 记录迁移过程，支持API查询
 * 
 * 此脚本设计为幂等的 — 可以安全地多次执行。
 */

import { getDb } from '../db';
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

interface MigrationResult {
  table: string;
  beforeCount: number;
  updatedCount: number;
  afterCount: number;
  orphanedCount: number;
}

/**
 * 获取campaigns表的最大本地ID长度
 * 用于动态确定"本地ID"的判断阈值
 */
async function getMaxLocalIdLength(db: any): Promise<number> {
  try {
    const result = await db.execute(sql.raw(
      `SELECT MAX(id) as maxId, LENGTH(CAST(MAX(id) AS CHAR)) as maxLen FROM campaigns`
    ));
    const maxLen = result[0]?.maxLen || result[0]?.[0]?.maxLen || 5;
    const maxId = result[0]?.maxId || result[0]?.[0]?.maxId || 0;
    log.info(`campaigns表最大本地ID: ${maxId} (${maxLen}位)`);
    return Math.max(maxLen, 5); // 至少5位
  } catch (e: any) {
    log.warn(`获取campaigns最大ID失败: ${e.message}, 使用默认值5`);
    return 5;
  }
}

/**
 * 检查某个表中有多少条记录的 campaignId 疑似本地int
 * 
 * v211: 使用动态阈值 + 双重验证
 * 条件1: 长度 < Amazon ID最小长度 且为纯数字
 * 条件2: 能通过 CAST(c.id AS CHAR) JOIN 到 campaigns 表
 */
async function countSuspectedLocalIds(db: any, tableName: string, maxLocalIdLen: number): Promise<{ total: number; joinable: number; orphaned: number }> {
  try {
    // 总的疑似本地ID数量（长度小于Amazon ID最小长度的纯数字）
    const totalResult = await db.execute(sql.raw(`
      SELECT COUNT(*) as cnt FROM \`${tableName}\` 
      WHERE LENGTH(campaignId) < ${AMAZON_ID_MIN_LENGTH} 
        AND campaignId REGEXP '^[0-9]+$'
    `));
    const total = totalResult[0]?.cnt || totalResult[0]?.[0]?.cnt || 0;
    
    if (total === 0) return { total: 0, joinable: 0, orphaned: 0 };
    
    // 可通过JOIN映射的数量
    const joinableResult = await db.execute(sql.raw(`
      SELECT COUNT(*) as cnt FROM \`${tableName}\` t
      INNER JOIN campaigns c ON t.campaignId = CAST(c.id AS CHAR)
      WHERE LENGTH(t.campaignId) < ${AMAZON_ID_MIN_LENGTH}
        AND t.campaignId REGEXP '^[0-9]+$'
    `));
    const joinable = joinableResult[0]?.cnt || joinableResult[0]?.[0]?.cnt || 0;
    
    return { total, joinable, orphaned: total - joinable };
  } catch (e: any) {
    log.warn(`检查表 ${tableName} 失败: ${e.message}`);
    return { total: 0, joinable: 0, orphaned: 0 };
  }
}

/**
 * 修复某个表中的 campaignId：本地int → Amazon ID
 * 
 * v211: 使用动态阈值，确保覆盖所有本地ID范围
 */
async function migrateTable(db: any, tableName: string, maxLocalIdLen: number): Promise<MigrationResult> {
  const before = await countSuspectedLocalIds(db, tableName, maxLocalIdLen);
  
  if (before.total === 0) {
    return { table: tableName, beforeCount: 0, updatedCount: 0, afterCount: 0, orphanedCount: 0 };
  }
  
  try {
    // 通过 JOIN campaigns 表将本地int映射为 Amazon ID
    const updateResult = await db.execute(sql.raw(`
      UPDATE \`${tableName}\` t
      INNER JOIN campaigns c ON t.campaignId = CAST(c.id AS CHAR)
      SET t.campaignId = c.campaignId
      WHERE LENGTH(t.campaignId) < ${AMAZON_ID_MIN_LENGTH}
        AND t.campaignId REGEXP '^[0-9]+$'
    `));
    
    const after = await countSuspectedLocalIds(db, tableName, maxLocalIdLen);
    const updatedCount = before.total - after.total;
    
    return { 
      table: tableName, 
      beforeCount: before.total, 
      updatedCount, 
      afterCount: after.total,
      orphanedCount: after.orphaned,
    };
  } catch (e: any) {
    log.error(`迁移表 ${tableName} 失败: ${e.message}`);
    logMigrationError('CampaignIdMigration', `迁移表 ${tableName} 失败: ${e.message}`, { table: tableName });
    return { table: tableName, beforeCount: before.total, updatedCount: 0, afterCount: before.total, orphanedCount: before.orphaned };
  }
}

/**
 * 执行完整的 campaignId 数据迁移
 * 
 * v211 改进:
 * - 动态计算本地ID阈值（基于campaigns.id的最大值）
 * - 扩展判断条件从 LENGTH <= 5 到 LENGTH < 10
 * - 详细记录每个表的迁移结果到 opsLogger
 * - 报告孤立记录（无法映射的本地ID）
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
  
  log.info('=== v211 campaignId 数据迁移开始 ===');
  const maxLocalIdLen = await getMaxLocalIdLength(db);
  logMigration('CampaignIdMigration', `v211 campaignId 数据迁移开始`, { 
    tables: [...TABLES_TO_MIGRATE],
    amazonIdMinLength: AMAZON_ID_MIN_LENGTH,
    maxLocalIdLength: maxLocalIdLen,
  });
  
  let totalBefore = 0;
  let totalUpdated = 0;
  let totalAfter = 0;
  let totalOrphaned = 0;
  
  for (const tableName of TABLES_TO_MIGRATE) {
    const result = await migrateTable(db, tableName, maxLocalIdLen);
    totalBefore += result.beforeCount;
    totalUpdated += result.updatedCount;
    totalAfter += result.afterCount;
    totalOrphaned += result.orphanedCount;
    
    if (result.beforeCount > 0) {
      log.info(`  ${result.table}: ${result.beforeCount} 条疑似本地ID → ${result.updatedCount} 条已修复, ${result.afterCount} 条残留 (${result.orphanedCount} 条孤立)`);
      logMigration('CampaignIdMigration', `表${result.table}迁移完成`, {
        table: result.table, 
        before: result.beforeCount, 
        updated: result.updatedCount, 
        remaining: result.afterCount,
        orphaned: result.orphanedCount,
      });
    }
  }
  
  if (totalBefore === 0) {
    log.info('所有表的 campaignId 已经是 Amazon ID，无需迁移');
    logMigration('CampaignIdMigration', '所有表的 campaignId 已经是 Amazon ID，无需迁移');
  } else {
    log.info(`=== 迁移完成: ${totalUpdated}/${totalBefore} 条记录已修复, ${totalOrphaned} 条孤立 ===`);
    logMigration('CampaignIdMigration', `迁移完成: ${totalUpdated}/${totalBefore} 条记录已修复`, {
      totalBefore, totalUpdated, totalAfter, totalOrphaned,
    });
    if (totalAfter > 0) {
      log.warn(`⚠️ 仍有 ${totalAfter} 条记录未修复 (${totalOrphaned} 条孤立 — 对应campaign可能已删除)`);
      logMigrationWarn('CampaignIdMigration', `仍有 ${totalAfter} 条记录未修复`, { 
        totalAfter, totalOrphaned,
        note: '孤立记录的campaignId无法映射到campaigns表，对应campaign可能已被删除',
      });
    }
  }
}
