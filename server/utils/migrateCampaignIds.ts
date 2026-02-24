/**
 * v222 数据迁移：统一所有表的 campaignId 为 Amazon ID
 * 
 * 背景：
 * 历史代码中多个表的 campaignId 字段混存了本地int ID（如 "42"、"5154"）
 * 和 Amazon ID（如 "283746591038"）。v207 开始统一为 Amazon ID。
 * 
 * v222 改进：
 * - 使用子查询方式代替 UPDATE...INNER JOIN，提高数据库兼容性（MySQL/TiDB）
 * - 逐行处理可映射记录，避免批量UPDATE的潜在兼容性问题
 * - 对孤立记录（本地ID无法映射到campaigns表）添加 "ORPHAN_" 前缀标记
 * - 增强错误日志，记录具体的MySQL错误码和消息
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
  orphanedMarked: number;
  errors: string[];
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
    const row = Array.isArray(result[0]) ? result[0][0] : result[0];
    const maxLen = row?.maxLen || 5;
    const maxId = row?.maxId || 0;
    log.info(`campaigns表最大本地ID: ${maxId} (${maxLen}位)`);
    return Math.max(Number(maxLen), 5); // 至少5位
  } catch (e: any) {
    log.warn(`获取campaigns最大ID失败: ${e.message}, 使用默认值5`);
    return 5;
  }
}

/**
 * 安全提取COUNT结果
 */
function extractCount(result: any): number {
  if (!result) return 0;
  const row = Array.isArray(result[0]) ? result[0][0] : result[0];
  return Number(row?.cnt || row?.count || 0);
}

/**
 * 检查某个表中有多少条记录的 campaignId 疑似本地int
 */
async function countSuspectedLocalIds(db: any, tableName: string): Promise<{ total: number; joinable: number; orphaned: number }> {
  try {
    // 总的疑似本地ID数量（长度小于Amazon ID最小长度的纯数字，排除已标记的孤立记录）
    const totalResult = await db.execute(sql.raw(`
      SELECT COUNT(*) as cnt FROM \`${tableName}\` 
      WHERE LENGTH(campaignId) < ${AMAZON_ID_MIN_LENGTH} 
        AND campaignId REGEXP '^[0-9]+$'
    `));
    const total = extractCount(totalResult);
    
    if (total === 0) return { total: 0, joinable: 0, orphaned: 0 };
    
    // 可通过子查询映射的数量
    const joinableResult = await db.execute(sql.raw(`
      SELECT COUNT(*) as cnt FROM \`${tableName}\` t
      WHERE LENGTH(t.campaignId) < ${AMAZON_ID_MIN_LENGTH}
        AND t.campaignId REGEXP '^[0-9]+$'
        AND EXISTS (SELECT 1 FROM campaigns c WHERE CAST(c.id AS CHAR) = t.campaignId)
    `));
    const joinable = extractCount(joinableResult);
    
    return { total, joinable, orphaned: total - joinable };
  } catch (e: any) {
    log.warn(`检查表 ${tableName} 失败: ${e.message}`);
    return { total: 0, joinable: 0, orphaned: 0 };
  }
}

/**
 * 修复某个表中的 campaignId：本地int → Amazon ID
 * 
 * v222: 使用子查询方式代替 UPDATE...INNER JOIN
 * 分两步执行：
 * 1. 先查出所有需要映射的 (本地ID → Amazon ID) 对
 * 2. 逐个执行 UPDATE 确保每条记录都被正确处理
 * 3. 对孤立记录添加 "ORPHAN_" 前缀标记
 */
async function migrateTable(db: any, tableName: string): Promise<MigrationResult> {
  const before = await countSuspectedLocalIds(db, tableName);
  const errors: string[] = [];
  
  if (before.total === 0) {
    return { table: tableName, beforeCount: 0, updatedCount: 0, afterCount: 0, orphanedCount: 0, orphanedMarked: 0, errors };
  }
  
  let updatedCount = 0;
  let orphanedMarked = 0;
  
  // 步骤1: 使用子查询方式批量更新可映射的记录
  try {
    // 方法A: 使用子查询UPDATE（兼容MySQL和TiDB）
    const updateResult = await db.execute(sql.raw(`
      UPDATE \`${tableName}\` t
      SET t.campaignId = (
        SELECT c.campaignId FROM campaigns c WHERE CAST(c.id AS CHAR) = t.campaignId LIMIT 1
      )
      WHERE LENGTH(t.campaignId) < ${AMAZON_ID_MIN_LENGTH}
        AND t.campaignId REGEXP '^[0-9]+$'
        AND EXISTS (SELECT 1 FROM campaigns c WHERE CAST(c.id AS CHAR) = t.campaignId)
    `));
    
    // 尝试获取affected rows
    const affected = updateResult?.[0]?.affectedRows || updateResult?.affectedRows || 0;
    updatedCount = Number(affected);
    log.info(`  ${tableName}: 子查询UPDATE成功, affected=${updatedCount}`);
  } catch (updateErr: any) {
    const errMsg = updateErr?.message || String(updateErr);
    const errCode = updateErr?.code || updateErr?.errno || 'unknown';
    log.warn(`  ${tableName}: 子查询UPDATE失败 (code=${errCode}): ${errMsg}`);
    errors.push(`子查询UPDATE失败: [${errCode}] ${errMsg}`);
    
    // 方法B: 如果子查询UPDATE也失败，尝试逐行更新
    try {
      log.info(`  ${tableName}: 尝试逐行更新...`);
      
      // 先查出所有映射关系
      const mappingResult = await db.execute(sql.raw(`
        SELECT DISTINCT t.campaignId as localId, c.campaignId as amazonId
        FROM \`${tableName}\` t
        INNER JOIN campaigns c ON CAST(c.id AS CHAR) = t.campaignId
        WHERE LENGTH(t.campaignId) < ${AMAZON_ID_MIN_LENGTH}
          AND t.campaignId REGEXP '^[0-9]+$'
      `));
      
      const mappings = Array.isArray(mappingResult[0]) ? mappingResult[0] : mappingResult;
      
      for (const mapping of mappings) {
        const localId = mapping?.localId || mapping?.local_id;
        const amazonId = mapping?.amazonId || mapping?.amazon_id;
        if (!localId || !amazonId) continue;
        
        try {
          await db.execute(sql.raw(`
            UPDATE \`${tableName}\` SET campaignId = '${amazonId}' WHERE campaignId = '${localId}'
          `));
          updatedCount++;
        } catch (rowErr: any) {
          errors.push(`逐行更新 ${localId}→${amazonId} 失败: ${rowErr.message}`);
        }
      }
      
      log.info(`  ${tableName}: 逐行更新完成, 成功=${updatedCount}`);
    } catch (fallbackErr: any) {
      errors.push(`逐行更新查询失败: ${fallbackErr.message}`);
      log.error(`  ${tableName}: 逐行更新也失败: ${fallbackErr.message}`);
    }
  }
  
  // 步骤2: 标记孤立记录（本地ID在campaigns表中找不到对应记录）
  try {
    const orphanResult = await db.execute(sql.raw(`
      SELECT COUNT(*) as cnt FROM \`${tableName}\`
      WHERE LENGTH(campaignId) < ${AMAZON_ID_MIN_LENGTH}
        AND campaignId REGEXP '^[0-9]+$'
        AND NOT EXISTS (SELECT 1 FROM campaigns c WHERE CAST(c.id AS CHAR) = campaignId)
    `));
    const orphanCount = extractCount(orphanResult);
    
    if (orphanCount > 0) {
      log.info(`  ${tableName}: 发现 ${orphanCount} 条孤立记录，添加 ORPHAN_ 前缀标记`);
      
      try {
        await db.execute(sql.raw(`
          UPDATE \`${tableName}\`
          SET campaignId = CONCAT('ORPHAN_', campaignId)
          WHERE LENGTH(campaignId) < ${AMAZON_ID_MIN_LENGTH}
            AND campaignId REGEXP '^[0-9]+$'
            AND NOT EXISTS (SELECT 1 FROM campaigns c WHERE CAST(c.id AS CHAR) = campaignId)
        `));
        orphanedMarked = orphanCount;
        log.info(`  ${tableName}: ${orphanCount} 条孤立记录已标记`);
      } catch (markErr: any) {
        errors.push(`标记孤立记录失败: ${markErr.message}`);
        log.warn(`  ${tableName}: 标记孤立记录失败: ${markErr.message}`);
      }
    }
  } catch (orphanCheckErr: any) {
    errors.push(`检查孤立记录失败: ${orphanCheckErr.message}`);
  }
  
  const after = await countSuspectedLocalIds(db, tableName);
  
  return { 
    table: tableName, 
    beforeCount: before.total, 
    updatedCount, 
    afterCount: after.total,
    orphanedCount: before.orphaned,
    orphanedMarked,
    errors,
  };
}

/**
 * 执行完整的 campaignId 数据迁移
 * 
 * v222 改进:
 * - 使用子查询方式代替 UPDATE...INNER JOIN，提高兼容性
 * - 逐行回退机制确保迁移成功率
 * - 孤立记录标记（ORPHAN_前缀）而非忽略
 * - 详细错误日志包含MySQL错误码
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
  
  log.info('=== v222 campaignId 数据迁移开始 ===');
  const maxLocalIdLen = await getMaxLocalIdLength(db);
  logMigration('CampaignIdMigration', `v222 campaignId 数据迁移开始`, { 
    tables: [...TABLES_TO_MIGRATE],
    amazonIdMinLength: AMAZON_ID_MIN_LENGTH,
    maxLocalIdLength: maxLocalIdLen,
  });
  
  let totalBefore = 0;
  let totalUpdated = 0;
  let totalAfter = 0;
  let totalOrphaned = 0;
  let totalOrphanedMarked = 0;
  let allErrors: string[] = [];
  
  for (const tableName of TABLES_TO_MIGRATE) {
    const result = await migrateTable(db, tableName);
    totalBefore += result.beforeCount;
    totalUpdated += result.updatedCount;
    totalAfter += result.afterCount;
    totalOrphaned += result.orphanedCount;
    totalOrphanedMarked += result.orphanedMarked;
    allErrors = allErrors.concat(result.errors);
    
    if (result.beforeCount > 0) {
      const logMsg = `${result.table}: ${result.beforeCount}条疑似本地ID → ${result.updatedCount}条已修复, ${result.afterCount}条残留 (${result.orphanedCount}条孤立, ${result.orphanedMarked}条已标记)`;
      log.info(`  ${logMsg}`);
      logMigration('CampaignIdMigration', `表${result.table}迁移完成`, {
        table: result.table, 
        before: result.beforeCount, 
        updated: result.updatedCount, 
        remaining: result.afterCount,
        orphaned: result.orphanedCount,
        orphanedMarked: result.orphanedMarked,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    }
  }
  
  if (totalBefore === 0) {
    log.info('所有表的 campaignId 已经是 Amazon ID，无需迁移');
    logMigration('CampaignIdMigration', '所有表的 campaignId 已经是 Amazon ID，无需迁移');
  } else {
    log.info(`=== 迁移完成: ${totalUpdated}/${totalBefore} 条记录已修复, ${totalOrphanedMarked}/${totalOrphaned} 条孤立已标记 ===`);
    logMigration('CampaignIdMigration', `迁移完成: ${totalUpdated}/${totalBefore} 条记录已修复`, {
      totalBefore, totalUpdated, totalAfter, totalOrphaned, totalOrphanedMarked,
      errors: allErrors.length > 0 ? allErrors : undefined,
    });
    
    if (totalAfter > 0 && totalOrphanedMarked === 0) {
      logMigrationWarn('CampaignIdMigration', `仍有 ${totalAfter} 条记录未修复且未标记`, { 
        totalAfter, totalOrphaned,
        note: '这些记录可能需要手动处理',
        errors: allErrors,
      });
    }
    
    if (allErrors.length > 0) {
      logMigrationError('CampaignIdMigration', `迁移过程中出现 ${allErrors.length} 个错误`, {
        errors: allErrors,
      });
    }
  }
}
