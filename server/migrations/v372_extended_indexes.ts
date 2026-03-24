/**
 * v372: 扩展核心表索引 - 补充v361遗漏的索引
 * 
 * 在v361的基础上，为以下表补充缺失的关键索引：
 * - campaigns: 添加 campaignType 复合索引
 * - adGroups: 添加 accountId+campaignId 复合索引
 * - keywords: 添加 accountId+campaignId 复合索引
 * - searchTerms: 添加 accountId, campaignId, adGroupId, accountId+campaignId 索引
 * - negativeKeywords: 添加 accountId, campaignId, accountId+campaignId 索引
 * - productTargets: 添加 accountId, campaignId, targetId, accountId+campaignId 索引
 * - scheduledTasks: 添加 userId, accountId, userId+taskType 索引
 * 
 * 同时创建 rate_limit_buckets 和 rate_limit_counters 表用于分布式API限流
 */

import { sql } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('Migration-v372-indexes');

export async function runV372ExtendedIndexes(db: unknown): Promise<void> {
  log.info('[v372] 开始创建扩展索引和限流表...');

  // ==================== 索引定义 ====================
  const indexDefinitions = [
    // campaigns表 - 补充索引
    { name: 'idx_campaigns_account_type', sql: 'CREATE INDEX IF NOT EXISTS idx_campaigns_account_type ON campaigns (accountId, campaignType)' },
    { name: 'idx_campaigns_account_opt', sql: 'CREATE INDEX IF NOT EXISTS idx_campaigns_account_opt ON campaigns (accountId, optimizationStatus)' },

    // adGroups表 - 补充复合索引
    { name: 'idx_ad_groups_account_campaign', sql: 'CREATE INDEX IF NOT EXISTS idx_ad_groups_account_campaign ON ad_groups (accountId, campaignId)' },

    // keywords表 - 补充复合索引
    { name: 'idx_keywords_account_campaign', sql: 'CREATE INDEX IF NOT EXISTS idx_keywords_account_campaign ON keywords (accountId, campaignId)' },

    // searchTerms表 - 全新索引
    { name: 'idx_search_terms_account_id', sql: 'CREATE INDEX IF NOT EXISTS idx_search_terms_account_id ON search_terms (accountId)' },
    { name: 'idx_search_terms_campaign_id', sql: 'CREATE INDEX IF NOT EXISTS idx_search_terms_campaign_id ON search_terms (campaignId)' },
    { name: 'idx_search_terms_ad_group_id', sql: 'CREATE INDEX IF NOT EXISTS idx_search_terms_ad_group_id ON search_terms (adGroupId)' },
    { name: 'idx_search_terms_account_campaign', sql: 'CREATE INDEX IF NOT EXISTS idx_search_terms_account_campaign ON search_terms (accountId, campaignId)' },

    // negativeKeywords表 - 全新索引
    { name: 'idx_neg_kw_account_id', sql: 'CREATE INDEX IF NOT EXISTS idx_neg_kw_account_id ON negative_keywords (accountId)' },
    { name: 'idx_neg_kw_campaign_id', sql: 'CREATE INDEX IF NOT EXISTS idx_neg_kw_campaign_id ON negative_keywords (campaignId)' },
    { name: 'idx_neg_kw_account_campaign', sql: 'CREATE INDEX IF NOT EXISTS idx_neg_kw_account_campaign ON negative_keywords (accountId, campaignId)' },

    // productTargets表 - 全新索引
    { name: 'idx_prod_targets_account_id', sql: 'CREATE INDEX IF NOT EXISTS idx_prod_targets_account_id ON product_targets (accountId)' },
    { name: 'idx_prod_targets_campaign_id', sql: 'CREATE INDEX IF NOT EXISTS idx_prod_targets_campaign_id ON product_targets (campaignId)' },
    { name: 'idx_prod_targets_target_id', sql: 'CREATE INDEX IF NOT EXISTS idx_prod_targets_target_id ON product_targets (targetId)' },
    { name: 'idx_prod_targets_account_campaign', sql: 'CREATE INDEX IF NOT EXISTS idx_prod_targets_account_campaign ON product_targets (accountId, campaignId)' },

    // scheduledTasks表 - 全新索引
    { name: 'idx_scheduled_tasks_user_id', sql: 'CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user_id ON scheduled_tasks (userId)' },
    { name: 'idx_scheduled_tasks_account_id', sql: 'CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_account_id ON scheduled_tasks (accountId)' },
    { name: 'idx_scheduled_tasks_user_type', sql: 'CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user_type ON scheduled_tasks (userId, taskType)' },
  ];

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const idx of indexDefinitions) {
    try {
      // @ts-ignore
      await db.execute(sql.raw(idx.sql));
      created++;
      log.info(`[v372] 索引 ${idx.name} 创建成功`);
    // @ts-ignore
    } catch (error: unknown) {
      // @ts-ignore
      if (error.message?.includes('Duplicate') || error.code === 'ER_DUP_KEYNAME') {
        skipped++;
        log.debug(`[v372] 索引 ${idx.name} 已存在，跳过`);
      // @ts-ignore
      } else {
        failed++;
        // @ts-ignore
        log.warn(`[v372] 索引 ${idx.name} 创建失败:`, error.message);
      }
    }
  }

  log.info(`[v372] 扩展索引迁移完成: 创建=${created}, 跳过=${skipped}, 失败=${failed}`);

  // ==================== 分布式限流表 ====================
  try {
    // @ts-ignore
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS rate_limit_buckets (
        bucket_key VARCHAR(255) PRIMARY KEY,
        tokens DECIMAL(10,4) NOT NULL DEFAULT 0,
        last_refill_time BIGINT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      // @ts-ignore
      ) ENGINE=InnoDB
    // @ts-ignore
    `);
    log.info('[v372] rate_limit_buckets 表创建成功');
  } catch (error: unknown) {
    // @ts-ignore
    if (!error.message?.includes('already exists')) {
      // @ts-ignore
      log.warn(`[v372] rate_limit_buckets 表创建失败: ${error.message}`);
    }
  }

  try {
    // @ts-ignore
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS rate_limit_counters (
        counter_key VARCHAR(255) NOT NULL,
        window_start BIGINT NOT NULL,
        window_ms BIGINT NOT NULL,
        // @ts-ignore
        count INT NOT NULL DEFAULT 0,
        // @ts-ignore
        PRIMARY KEY (counter_key, window_start),
        INDEX idx_rlc_window_start (window_start)
      ) ENGINE=InnoDB
    `);
    log.info('[v372] rate_limit_counters 表创建成功');
  } catch (error: unknown) {
    // @ts-ignore
    if (!error.message?.includes('already exists')) {
      // @ts-ignore
      log.warn(`[v372] rate_limit_counters 表创建失败: ${error.message}`);
    }
  }

  log.info('[v372] 分布式限流表迁移完成');
}
