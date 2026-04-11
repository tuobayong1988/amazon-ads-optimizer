// Extracted from production dist/index.js
// Original module: server/migrations/v372_extended_indexes.ts
// Lines: 97

var v372_extended_indexes_exports = {};
__export(v372_extended_indexes_exports, {
  runV372ExtendedIndexes: () => runV372ExtendedIndexes
});
async function runV372ExtendedIndexes(db) {
  log124.info("[v372] \u5F00\u59CB\u521B\u5EFA\u6269\u5C55\u7D22\u5F15\u548C\u9650\u6D41\u8868...");
  const indexDefinitions = [
    // campaigns表 - 补充索引
    { name: "idx_campaigns_account_type", sql: "CREATE INDEX IF NOT EXISTS idx_campaigns_account_type ON campaigns (accountId, campaignType)" },
    { name: "idx_campaigns_account_opt", sql: "CREATE INDEX IF NOT EXISTS idx_campaigns_account_opt ON campaigns (accountId, optimizationStatus)" },
    // adGroups表 - 补充复合索引
    { name: "idx_ad_groups_account_campaign", sql: "CREATE INDEX IF NOT EXISTS idx_ad_groups_account_campaign ON ad_groups (accountId, campaignId)" },
    // keywords表 - 补充复合索引
    { name: "idx_keywords_account_campaign", sql: "CREATE INDEX IF NOT EXISTS idx_keywords_account_campaign ON keywords (accountId, campaignId)" },
    // searchTerms表 - 全新索引
    { name: "idx_search_terms_account_id", sql: "CREATE INDEX IF NOT EXISTS idx_search_terms_account_id ON search_terms (accountId)" },
    { name: "idx_search_terms_campaign_id", sql: "CREATE INDEX IF NOT EXISTS idx_search_terms_campaign_id ON search_terms (campaignId)" },
    { name: "idx_search_terms_ad_group_id", sql: "CREATE INDEX IF NOT EXISTS idx_search_terms_ad_group_id ON search_terms (adGroupId)" },
    { name: "idx_search_terms_account_campaign", sql: "CREATE INDEX IF NOT EXISTS idx_search_terms_account_campaign ON search_terms (accountId, campaignId)" },
    // negativeKeywords表 - 全新索引
    { name: "idx_neg_kw_account_id", sql: "CREATE INDEX IF NOT EXISTS idx_neg_kw_account_id ON negative_keywords (accountId)" },
    { name: "idx_neg_kw_campaign_id", sql: "CREATE INDEX IF NOT EXISTS idx_neg_kw_campaign_id ON negative_keywords (campaignId)" },
    { name: "idx_neg_kw_account_campaign", sql: "CREATE INDEX IF NOT EXISTS idx_neg_kw_account_campaign ON negative_keywords (accountId, campaignId)" },
    // productTargets表 - 全新索引
    { name: "idx_prod_targets_account_id", sql: "CREATE INDEX IF NOT EXISTS idx_prod_targets_account_id ON product_targets (accountId)" },
    { name: "idx_prod_targets_campaign_id", sql: "CREATE INDEX IF NOT EXISTS idx_prod_targets_campaign_id ON product_targets (campaignId)" },
    { name: "idx_prod_targets_target_id", sql: "CREATE INDEX IF NOT EXISTS idx_prod_targets_target_id ON product_targets (targetId)" },
    { name: "idx_prod_targets_account_campaign", sql: "CREATE INDEX IF NOT EXISTS idx_prod_targets_account_campaign ON product_targets (accountId, campaignId)" },
    // scheduledTasks表 - 全新索引
    { name: "idx_scheduled_tasks_user_id", sql: "CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user_id ON scheduled_tasks (userId)" },
    { name: "idx_scheduled_tasks_account_id", sql: "CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_account_id ON scheduled_tasks (accountId)" },
    { name: "idx_scheduled_tasks_user_type", sql: "CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user_type ON scheduled_tasks (userId, taskType)" }
  ];
  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const idx of indexDefinitions) {
    try {
      await db.execute(sql.raw(idx.sql));
      created++;
      log124.info(`[v372] \u7D22\u5F15 ${idx.name} \u521B\u5EFA\u6210\u529F`);
    } catch (error48) {
      if (error48.message?.includes("Duplicate") || error48.code === "ER_DUP_KEYNAME") {
        skipped++;
        log124.debug(`[v372] \u7D22\u5F15 ${idx.name} \u5DF2\u5B58\u5728\uFF0C\u8DF3\u8FC7`);
      } else {
        failed++;
        log124.warn(`[v372] \u7D22\u5F15 ${idx.name} \u521B\u5EFA\u5931\u8D25:`, error48.message);
      }
    }
  }
  log124.info(`[v372] \u6269\u5C55\u7D22\u5F15\u8FC1\u79FB\u5B8C\u6210: \u521B\u5EFA=${created}, \u8DF3\u8FC7=${skipped}, \u5931\u8D25=${failed}`);
  try {
    await db.execute(sql`
 CREATE TABLE IF NOT EXISTS rate_limit_buckets (
 bucket_key VARCHAR(255) PRIMARY KEY,
 tokens DECIMAL(10,4) NOT NULL DEFAULT 0,
 last_refill_time BIGINT NOT NULL,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
 ) ENGINE=InnoDB
 `);
    log124.info("[v372] rate_limit_buckets \u8868\u521B\u5EFA\u6210\u529F");
  } catch (error48) {
    if (!error48.message?.includes("already exists")) {
      log124.warn(`[v372] rate_limit_buckets \u8868\u521B\u5EFA\u5931\u8D25: ${error48.message}`);
    }
  }
  try {
    await db.execute(sql`
 CREATE TABLE IF NOT EXISTS rate_limit_counters (
 counter_key VARCHAR(255) NOT NULL,
 window_start BIGINT NOT NULL,
 window_ms BIGINT NOT NULL,
 count INT NOT NULL DEFAULT 0,
 PRIMARY KEY (counter_key, window_start),
 INDEX idx_rlc_window_start (window_start)
 ) ENGINE=InnoDB
 `);
    log124.info("[v372] rate_limit_counters \u8868\u521B\u5EFA\u6210\u529F");
  } catch (error48) {
    if (!error48.message?.includes("already exists")) {
      log124.warn(`[v372] rate_limit_counters \u8868\u521B\u5EFA\u5931\u8D25: ${error48.message}`);
    }
  }
  log124.info("[v372] \u5206\u5E03\u5F0F\u9650\u6D41\u8868\u8FC1\u79FB\u5B8C\u6210");
}
var log124;
var init_v372_extended_indexes = __esm({
  "server/migrations/v372_extended_indexes.ts"() {
    "use strict";
    init_drizzle_orm();
    init_logger();
    log124 = createModuleLogger("Migration-v372-indexes");
    __name(runV372ExtendedIndexes, "runV372ExtendedIndexes");
  }
});

