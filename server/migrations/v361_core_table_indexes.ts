/**
 * v361: 为核心业务表添加缺失的数据库索引
 * 
 * 问题：campaigns, ad_groups, keywords, daily_performance 这4个核心表
 * 没有定义任何索引，导致大量查询走全表扫描，严重影响性能。
 * 
 * 此迁移添加了基于实际查询模式的索引：
 * - campaigns: accountId（最高频查询条件）、campaignId（唯一标识）
 * - ad_groups: campaignId（JOIN条件）、adGroupId（唯一标识）
 * - keywords: adGroupId（JOIN条件）、keywordId（唯一标识）、campaignId
 * - daily_performance: campaignId+date（最高频查询组合）、accountId+date
 */

import { sql } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('Migration-v361-indexes');

export async function runV361CoreTableIndexes(db: unknown): Promise<void> {
  log.info('[v361] 开始创建核心表索引...');

  const indexDefinitions = [
    // v370: 修复列名为camelCase（与Drizzle migration创建的实际数据库列名一致）
    // campaigns表索引
    { name: 'idx_campaigns_account_id', sql: 'CREATE INDEX IF NOT EXISTS idx_campaigns_account_id ON campaigns (accountId)' },
    { name: 'idx_campaigns_campaign_id', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_campaign_id ON campaigns (campaignId)' },
    { name: 'idx_campaigns_account_status', sql: 'CREATE INDEX IF NOT EXISTS idx_campaigns_account_status ON campaigns (accountId, campaignStatus)' },
    { name: 'idx_campaigns_perf_group', sql: 'CREATE INDEX IF NOT EXISTS idx_campaigns_perf_group ON campaigns (performanceGroupId)' },

    // ad_groups表索引
    { name: 'idx_ad_groups_campaign_id', sql: 'CREATE INDEX IF NOT EXISTS idx_ad_groups_campaign_id ON ad_groups (campaignId)' },
    { name: 'idx_ad_groups_ad_group_id', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_groups_ad_group_id ON ad_groups (adGroupId)' },
    { name: 'idx_ad_groups_account_id', sql: 'CREATE INDEX IF NOT EXISTS idx_ad_groups_account_id ON ad_groups (accountId)' },

    // keywords表索引
    { name: 'idx_keywords_ad_group_id', sql: 'CREATE INDEX IF NOT EXISTS idx_keywords_ad_group_id ON keywords (adGroupId)' },
    { name: 'idx_keywords_keyword_id', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_keywords_keyword_id ON keywords (keywordId)' },
    { name: 'idx_keywords_campaign_id', sql: 'CREATE INDEX IF NOT EXISTS idx_keywords_campaign_id ON keywords (campaignId)' },
    { name: 'idx_keywords_account_status', sql: 'CREATE INDEX IF NOT EXISTS idx_keywords_account_status ON keywords (accountId, keywordStatus)' },

    // daily_performance表索引
    { name: 'idx_daily_perf_campaign_date', sql: 'CREATE INDEX IF NOT EXISTS idx_daily_perf_campaign_date ON daily_performance (campaignId, date)' },
    { name: 'idx_daily_perf_account_date', sql: 'CREATE INDEX IF NOT EXISTS idx_daily_perf_account_date ON daily_performance (accountId, date)' },
    { name: 'idx_daily_perf_date', sql: 'CREATE INDEX IF NOT EXISTS idx_daily_perf_date ON daily_performance (date)' },
  ];

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const idx of indexDefinitions) {
    try {
      // @ts-expect-error DB query type inference limitation
      await db.execute(sql.raw(idx.sql));
      created++;
      log.info(`[v361] 索引 ${idx.name} 创建成功`);
    // @ts-expect-error Legacy code type compatibility
    } catch (error: unknown) {
      // @ts-expect-error Dynamic property access
      if (error.message?.includes('Duplicate') || error.code === 'ER_DUP_KEYNAME') {
        skipped++;
        log.debug(`[v361] 索引 ${idx.name} 已存在，跳过`);
      // @ts-expect-error Conditional type narrowing
      } else {
        failed++;
        // @ts-expect-error Complex function parameter types
        log.warn(`[v361] 索引 ${idx.name} 创建失败:`, error.message);
      }
    }
  }

  log.info(`[v361] 核心表索引迁移完成: 创建=${created}, 跳过=${skipped}, 失败=${failed}`);
}
