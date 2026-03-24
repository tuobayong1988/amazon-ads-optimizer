/**
 * v257: match_type历史数据回填迁移脚本
 * 
 * 问题：optimization_events表中的match_type字段在早期版本中未被填充，
 * 导致优化日志无法按匹配类型进行筛选和分析。
 * 
 * 解决方案：从keywords表中回填match_type到optimization_events表，
 * 通过keyword_id关联查询。
 * 
 * 执行方式：由postDeployOptimizer在v257部署时自动触发
 */

import { getDb } from '../db';
import { sql } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('MigrationV257');

export async function backfillMatchType(): Promise<{ updated: number; errors: number }> {
  const db = await getDb();
  if (!db) return { updated: 0, errors: 0 };
  
  let updated = 0;
  let errors = 0;
  
  try {
    log.info('[v257] 开始回填optimization_events.match_type...');
    
    // 批量更新：从keywords表中获取matchType并回填到optimization_events
    // 只更新有keyword_id但缺少match_type的记录
    const result = await db.execute(sql`
      UPDATE optimization_events oe
      JOIN keywords k ON oe.keyword_id = k.id
      SET oe.match_type = k.matchType
      WHERE oe.keyword_id IS NOT NULL
        AND (oe.match_type IS NULL OR oe.match_type = '')
        AND k.matchType IS NOT NULL
    `);
    
    // 获取受影响的行数
    // @ts-expect-error - MySQL affectedRows
    const affectedRows = (result as Record<string, unknown>[][])[0]?.affectedRows || (result as unknown)?.affectedRows || 0;
    updated = affectedRows;
    
    log.info(`[v257] match_type回填完成: 更新了${updated}条记录`);
    
    // 统计回填后的覆盖率
    const coverageResult = await db.execute(sql`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN match_type IS NOT NULL AND match_type != '' THEN 1 ELSE 0 END) as with_match_type,
        SUM(CASE WHEN keyword_id IS NOT NULL THEN 1 ELSE 0 END) as with_keyword
      FROM optimization_events
      WHERE event_category = 'bid_adjustment'
    `);
    
    // @ts-ignore
    const coverage = (coverageResult as Record<string, unknown>[])[0] || {};
    const total = Number(coverage.total) || 0;
    const withMatchType = Number(coverage.with_match_type) || 0;
    const withKeyword = Number(coverage.with_keyword) || 0;
    const coverageRate = withKeyword > 0 ? ((withMatchType / withKeyword) * 100).toFixed(1) : '0';
    
    log.info(`[v257] match_type覆盖率: ${withMatchType}/${withKeyword}条关键词事件有match_type (${coverageRate}%), 总事件=${total}`);
    
  } catch (error: unknown) {
    log.warn(`[v257] match_type回填失败: ${(error as Error).message}`);
    errors++;
  }
  
  return { updated, errors };
}
