// Extracted from production dist/index.js
// Original module: server/migrations/v361_core_table_indexes.ts
// Lines: 58

var v361_core_table_indexes_exports = {};
__export(v361_core_table_indexes_exports, {
  runV361CoreTableIndexes: () => runV361CoreTableIndexes
});
async function runV361CoreTableIndexes(db) {
  log123.info("[v361] \u5F00\u59CB\u521B\u5EFA\u6838\u5FC3\u8868\u7D22\u5F15...");
  const indexDefinitions = [
    // v370: 修复列名为camelCase（与Drizzle migration创建的实际数据库列名一致）
    // campaigns表索引
    { name: "idx_campaigns_account_id", sql: "CREATE INDEX IF NOT EXISTS idx_campaigns_account_id ON campaigns (accountId)" },
    { name: "idx_campaigns_campaign_id", sql: "CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_campaign_id ON campaigns (campaignId)" },
    { name: "idx_campaigns_account_status", sql: "CREATE INDEX IF NOT EXISTS idx_campaigns_account_status ON campaigns (accountId, campaignStatus)" },
    { name: "idx_campaigns_perf_group", sql: "CREATE INDEX IF NOT EXISTS idx_campaigns_perf_group ON campaigns (performanceGroupId)" },
    // ad_groups表索引
    { name: "idx_ad_groups_campaign_id", sql: "CREATE INDEX IF NOT EXISTS idx_ad_groups_campaign_id ON ad_groups (campaignId)" },
    { name: "idx_ad_groups_ad_group_id", sql: "CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_groups_ad_group_id ON ad_groups (adGroupId)" },
    { name: "idx_ad_groups_account_id", sql: "CREATE INDEX IF NOT EXISTS idx_ad_groups_account_id ON ad_groups (accountId)" },
    // keywords表索引
    { name: "idx_keywords_ad_group_id", sql: "CREATE INDEX IF NOT EXISTS idx_keywords_ad_group_id ON keywords (adGroupId)" },
    { name: "idx_keywords_keyword_id", sql: "CREATE UNIQUE INDEX IF NOT EXISTS idx_keywords_keyword_id ON keywords (keywordId)" },
    { name: "idx_keywords_campaign_id", sql: "CREATE INDEX IF NOT EXISTS idx_keywords_campaign_id ON keywords (campaignId)" },
    { name: "idx_keywords_account_status", sql: "CREATE INDEX IF NOT EXISTS idx_keywords_account_status ON keywords (accountId, keywordStatus)" },
    // daily_performance表索引
    { name: "idx_daily_perf_campaign_date", sql: "CREATE INDEX IF NOT EXISTS idx_daily_perf_campaign_date ON daily_performance (campaignId, date)" },
    { name: "idx_daily_perf_account_date", sql: "CREATE INDEX IF NOT EXISTS idx_daily_perf_account_date ON daily_performance (accountId, date)" },
    { name: "idx_daily_perf_date", sql: "CREATE INDEX IF NOT EXISTS idx_daily_perf_date ON daily_performance (date)" }
  ];
  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const idx of indexDefinitions) {
    try {
      await db.execute(sql.raw(idx.sql));
      created++;
      log123.info(`[v361] \u7D22\u5F15 ${idx.name} \u521B\u5EFA\u6210\u529F`);
    } catch (error48) {
      if (error48.message?.includes("Duplicate") || error48.code === "ER_DUP_KEYNAME") {
        skipped++;
        log123.debug(`[v361] \u7D22\u5F15 ${idx.name} \u5DF2\u5B58\u5728\uFF0C\u8DF3\u8FC7`);
      } else {
        failed++;
        log123.warn(`[v361] \u7D22\u5F15 ${idx.name} \u521B\u5EFA\u5931\u8D25:`, error48.message);
      }
    }
  }
  log123.info(`[v361] \u6838\u5FC3\u8868\u7D22\u5F15\u8FC1\u79FB\u5B8C\u6210: \u521B\u5EFA=${created}, \u8DF3\u8FC7=${skipped}, \u5931\u8D25=${failed}`);
}
var log123;
var init_v361_core_table_indexes = __esm({
  "server/migrations/v361_core_table_indexes.ts"() {
    "use strict";
    init_drizzle_orm();
    init_logger();
    log123 = createModuleLogger("Migration-v361-indexes");
    __name(runV361CoreTableIndexes, "runV361CoreTableIndexes");
  }
});

