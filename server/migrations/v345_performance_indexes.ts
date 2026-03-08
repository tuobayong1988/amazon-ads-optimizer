/**
 * v345 性能优化: 为大表添加复合索引
 * 
 * 审计报告发现:
 * - hourly_performance (39万行) 缺少 accountId+date+campaignId 复合索引
 * - bidding_logs (14万行) 缺少 accountId+createdAt+actionType 复合索引
 * - daily_performance 缺少 campaignId+date 复合索引（用于按campaign查询绩效）
 * 
 * 这些索引将显著提升:
 * - 分时策略查询性能
 * - 竞价日志查询和分析性能
 * - 按campaign维度的绩效查询性能
 */

import { getDb } from '../db';
import { sql } from 'drizzle-orm';

interface IndexDef {
  name: string;
  table: string;
  columns: string;
}

const INDEXES: IndexDef[] = [
  // hourly_performance 复合索引
  {
    name: 'idx_hp_account_date_campaign',
    table: 'hourly_performance',
    columns: 'accountId, date, campaignId',
  },
  {
    name: 'idx_hp_campaign_date_hour',
    table: 'hourly_performance',
    columns: 'campaignId, date, hour',
  },
  // bidding_logs 复合索引
  {
    name: 'idx_bl_account_created',
    table: 'bidding_logs',
    columns: 'accountId, createdAt',
  },
  {
    name: 'idx_bl_account_action_status',
    table: 'bidding_logs',
    columns: 'accountId, actionType, executionStatus',
  },
  {
    name: 'idx_bl_campaign_created',
    table: 'bidding_logs',
    columns: 'campaignId, createdAt',
  },
  // daily_performance 补充索引
  {
    name: 'idx_dp_campaign_date',
    table: 'daily_performance',
    columns: 'campaignId, date',
  },
  // keywords 查询优化索引
  {
    name: 'idx_kw_account_campaign',
    table: 'keywords',
    columns: 'accountId, campaignId',
  },
  // campaigns 查询优化索引
  {
    name: 'idx_camp_account_status',
    table: 'campaigns',
    columns: 'accountId, status',
  },
];

export async function runV345PerformanceIndexMigration(): Promise<{
  created: number;
  skipped: number;
  failed: number;
}> {
  const result = { created: 0, skipped: 0, failed: 0 };
  
  const db = await getDb();
  if (!db) {
    console.log('[v345-indexes] Database not available, skipping index creation');
    return result;
  }

  for (const idx of INDEXES) {
    try {
      // 检查索引是否已存在
      const [existingIndexes] = await db.execute(
        sql.raw(`SHOW INDEX FROM ${idx.table} WHERE Key_name = '${idx.name}'`)
      ) as unknown;
      
      if (existingIndexes && existingIndexes.length > 0) {
        console.log(`[v345-indexes] ${idx.name} 已存在，跳过`);
        result.skipped++;
        continue;
      }

      // 创建索引
      console.log(`[v345-indexes] 创建索引 ${idx.name} ON ${idx.table}(${idx.columns})...`);
      await db.execute(
        sql.raw(`CREATE INDEX ${idx.name} ON ${idx.table}(${idx.columns})`)
      );
      console.log(`[v345-indexes] ${idx.name} 创建成功`);
      result.created++;
    } catch (error: unknown) {
      if ((error as Error).message?.includes('Duplicate key name') || error.code === 'ER_DUP_KEYNAME') {
        console.log(`[v345-indexes] ${idx.name} 已存在（不同检测方式），跳过`);
        result.skipped++;
      } else if ((error as Error).message?.includes("doesn't exist") || error.code === 'ER_NO_SUCH_TABLE') {
        console.log(`[v345-indexes] 表 ${idx.table} 不存在，跳过索引 ${idx.name}`);
        result.skipped++;
      } else {
        console.error(`[v345-indexes] 创建索引 ${idx.name} 失败:`, (error as Error).message);
        result.failed++;
      }
    }
  }

  console.log(`[v345-indexes] 索引迁移完成: 创建=${result.created}, 跳过=${result.skipped}, 失败=${result.failed}`);
  return result;
}
