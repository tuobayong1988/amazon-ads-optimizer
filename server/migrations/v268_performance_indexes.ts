/**
 * v268 性能优化: 为daily_performance表添加复合索引
 * 
 * 问题: listWithPerformance查询对每个账户执行2次getAccountPerformanceSummary
 *       查询条件为 accountId + DATE(date) 范围，但缺少复合索引
 * 
 * 解决: 添加 (accountId, date) 复合索引，将全表扫描优化为索引范围扫描
 */

import { getDb } from '../db';
import { sql } from 'drizzle-orm';

export async function runV268PerformanceIndexMigration(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.log('[v268-migration] Database not available, skipping index creation');
    return;
  }

  try {
    // 检查索引是否已存在
    const [existingIndexes] = await db.execute(
      sql`SHOW INDEX FROM daily_performance WHERE Key_name = 'idx_dp_account_date'`
    ) as any;

    if (existingIndexes && existingIndexes.length > 0) {
      console.log('[v268-migration] Index idx_dp_account_date already exists, skipping');
      return;
    }

    // 创建复合索引 (accountId, date) - 覆盖getAccountPerformanceSummary的查询条件
    console.log('[v268-migration] Creating index idx_dp_account_date on daily_performance(accountId, date)...');
    await db.execute(
      sql`CREATE INDEX idx_dp_account_date ON daily_performance(accountId, date)`
    );
    console.log('[v268-migration] Index idx_dp_account_date created successfully');

    // 检查optimization_events表的索引
    const [eventsIndexes] = await db.execute(
      sql`SHOW INDEX FROM optimization_events WHERE Key_name = 'idx_oe_category_type'`
    ) as any;

    if (!eventsIndexes || eventsIndexes.length === 0) {
      console.log('[v268-migration] Creating index idx_oe_category_type on optimization_events(event_category, action_type)...');
      await db.execute(
        sql`CREATE INDEX idx_oe_category_type ON optimization_events(event_category, action_type)`
      );
      console.log('[v268-migration] Index idx_oe_category_type created successfully');
    }

  } catch (error: any) {
    // 索引可能已存在（不同名称），忽略重复索引错误
    if (error.message?.includes('Duplicate key name') || error.code === 'ER_DUP_KEYNAME') {
      console.log('[v268-migration] Index already exists (different name), skipping');
    } else {
      console.error('[v268-migration] Error creating indexes:', error.message);
    }
  }
}
