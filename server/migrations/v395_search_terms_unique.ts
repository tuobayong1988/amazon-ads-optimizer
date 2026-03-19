/**
 * v395: search_terms表唯一约束迁移
 * 
 * 问题：
 * - search_terms表没有唯一约束，每次同步都会INSERT新记录
 * - existingMap被预加载但从未使用来去重（SP搜索词）
 * - 导致search_terms表随着每次同步不断膨胀，同一搜索词有大量重复记录
 * 
 * 解决：
 * 1. 先清理重复数据（保留最新的一条）
 * 2. 添加唯一约束 (accountId, campaignId, adGroupId, searchTerm, reportStartDate)
 * 3. 由于searchTerm字段是varchar(500)，在utf8mb4下可能超过索引长度限制
 *    因此使用前缀索引: searchTerm(191) 来控制索引大小
 */

import { sql } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('Migration-v395-search-terms-unique');

export async function runV395SearchTermsUnique(db: unknown): Promise<void> {
  log.info('[v395] 开始search_terms唯一约束迁移...');

  try {
    // Step 1: 统计当前重复数据量
    const [countResult] = await db.execute(sql.raw(`
      SELECT COUNT(*) as total FROM search_terms
    `));
    const totalBefore = countResult?.[0]?.total || countResult?.total || 0;
    log.info(`[v395] 当前search_terms总记录数: ${totalBefore}`);

    // Step 2: 删除重复数据，保留每组中id最大的（最新的）记录
    // 使用子查询找出需要保留的id
    log.info('[v395] 开始清理重复搜索词数据...');
    
    const deleteResult = await db.execute(sql.raw(`
      DELETE t1 FROM search_terms t1
      INNER JOIN (
        SELECT MAX(id) as keep_id, accountId, campaignId, adGroupId, searchTerm, report_start_date
        FROM search_terms
        GROUP BY accountId, campaignId, adGroupId, searchTerm, report_start_date
      ) t2 ON t1.accountId = t2.accountId 
        AND t1.campaignId = t2.campaignId 
        AND t1.internal_ad_group_id = t2.internal_ad_group_id 
        AND t1.searchTerm = t2.searchTerm 
        AND (t1.report_start_date = t2.report_start_date OR (t1.report_start_date IS NULL AND t2.report_start_date IS NULL))
      WHERE t1.id < t2.keep_id
    `));
    
    const deletedCount = deleteResult?.[0]?.affectedRows || deleteResult?.affectedRows || 0;
    log.info(`[v395] 清理完成，删除了 ${deletedCount} 条重复记录`);

    // Step 3: 处理report_start_date为NULL的记录（旧数据可能没有日期）
    // 将NULL的report_start_date设置为createdAt的日期
    await db.execute(sql.raw(`
      UPDATE search_terms 
      SET report_start_date = DATE(createdAt)
      WHERE report_start_date IS NULL
    `));
    log.info('[v395] 已将NULL的report_start_date回填为createdAt日期');

    // Step 4: 添加唯一约束（使用searchTerm前缀索引191字符以适应InnoDB限制）
    try {
      await db.execute(sql.raw(`
        ALTER TABLE search_terms 
        ADD UNIQUE INDEX uk_search_term (accountId, campaignId, adGroupId, searchTerm(191), report_start_date)
      `));
      log.info('[v395] 唯一约束 uk_search_term 创建成功');
    } catch (error: unknown) {
      if (error.message?.includes('Duplicate') || error.code === 'ER_DUP_KEYNAME') {
        log.info('[v395] 唯一约束 uk_search_term 已存在，跳过');
      } else if (error.message?.includes('Duplicate entry')) {
        // 仍有重复数据，尝试更激进的清理
        log.warn('[v395] 仍有重复数据，执行更激进的清理...');
        await db.execute(sql.raw(`
          DELETE t1 FROM search_terms t1
          INNER JOIN search_terms t2
          WHERE t1.id < t2.id
            AND t1.accountId = t2.accountId
            AND t1.campaignId = t2.campaignId
            AND t1.internal_ad_group_id = t2.internal_ad_group_id
            AND LEFT(t1.searchTerm, 191) = LEFT(t2.searchTerm, 191)
            AND t1.report_start_date = t2.report_start_date
        `));
        // 重试创建唯一约束
        await db.execute(sql.raw(`
          ALTER TABLE search_terms 
          ADD UNIQUE INDEX uk_search_term (accountId, campaignId, adGroupId, searchTerm(191), report_start_date)
        `));
        log.info('[v395] 二次清理后唯一约束创建成功');
      } else {
        throw error;
      }
    }

    // Step 5: 统计清理后的数据量
    const [countAfter] = await db.execute(sql.raw(`
      SELECT COUNT(*) as total FROM search_terms
    `));
    const totalAfter = countAfter?.[0]?.total || countAfter?.total || 0;
    log.info(`[v395] 迁移完成: 清理前=${totalBefore}, 清理后=${totalAfter}, 减少=${Number(totalBefore) - Number(totalAfter)}条`);

  } catch (error: unknown) {
    log.warn(`[v395] search_terms唯一约束迁移失败 (可能已应用):`, (error as Error).message);
    // 不抛出错误，允许系统继续启动
  }
}
