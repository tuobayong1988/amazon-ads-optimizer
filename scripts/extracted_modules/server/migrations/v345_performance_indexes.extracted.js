// Extracted from production dist/index.js
// Original module: server/migrations/v345_performance_indexes.ts
// Lines: 102

var v345_performance_indexes_exports = {};
__export(v345_performance_indexes_exports, {
  runV345PerformanceIndexMigration: () => runV345PerformanceIndexMigration
});
async function runV345PerformanceIndexMigration() {
  const result = { created: 0, skipped: 0, failed: 0 };
  const db = await getDb();
  if (!db) {
    log122.info("[v345-indexes] Database not available, skipping index creation");
    return result;
  }
  for (const idx of INDEXES) {
    try {
      const [existingIndexes] = await db.execute(
        sql.raw(`SHOW INDEX FROM ${idx.table} WHERE Key_name = '${idx.name}'`)
      );
      if (existingIndexes && existingIndexes.length > 0) {
        log122.info(`[v345-indexes] ${idx.name} \u5DF2\u5B58\u5728\uFF0C\u8DF3\u8FC7`);
        result.skipped++;
        continue;
      }
      log122.info(`[v345-indexes] \u521B\u5EFA\u7D22\u5F15 ${idx.name} ON ${idx.table}(${idx.columns})...`);
      await db.execute(
        sql.raw(`CREATE INDEX ${idx.name} ON ${idx.table}(${idx.columns})`)
      );
      log122.info(`[v345-indexes] ${idx.name} \u521B\u5EFA\u6210\u529F`);
      result.created++;
    } catch (error48) {
      if (error48.message?.includes("Duplicate key name") || error48.code === "ER_DUP_KEYNAME") {
        log122.info(`[v345-indexes] ${idx.name} \u5DF2\u5B58\u5728\uFF08\u4E0D\u540C\u68C0\u6D4B\u65B9\u5F0F\uFF09\uFF0C\u8DF3\u8FC7`);
        result.skipped++;
      } else if (error48.message?.includes("doesn't exist") || error48.code === "ER_NO_SUCH_TABLE") {
        log122.info(`[v345-indexes] \u8868 ${idx.table} \u4E0D\u5B58\u5728\uFF0C\u8DF3\u8FC7\u7D22\u5F15 ${idx.name}`);
        result.skipped++;
      } else {
        console.error(`[v345-indexes] \u521B\u5EFA\u7D22\u5F15 ${idx.name} \u5931\u8D25:`, error48.message);
        result.failed++;
      }
    }
  }
  log122.info(`[v345-indexes] \u7D22\u5F15\u8FC1\u79FB\u5B8C\u6210: \u521B\u5EFA=${result.created}, \u8DF3\u8FC7=${result.skipped}, \u5931\u8D25=${result.failed}`);
  return result;
}
var log122, INDEXES;
var init_v345_performance_indexes = __esm({
  "server/migrations/v345_performance_indexes.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_drizzle_orm();
    log122 = createModuleLogger("Migration:v345idx");
    INDEXES = [
      // hourly_performance 复合索引
      {
        name: "idx_hp_account_date_campaign",
        table: "hourly_performance",
        columns: "accountId, date, campaignId"
      },
      {
        name: "idx_hp_campaign_date_hour",
        table: "hourly_performance",
        columns: "campaignId, date, hour"
      },
      // bidding_logs 复合索引
      {
        name: "idx_bl_account_created",
        table: "bidding_logs",
        columns: "accountId, createdAt"
      },
      {
        name: "idx_bl_account_action_status",
        table: "bidding_logs",
        columns: "accountId, actionType, executionStatus"
      },
      {
        name: "idx_bl_campaign_created",
        table: "bidding_logs",
        columns: "campaignId, createdAt"
      },
      // daily_performance 补充索引
      {
        name: "idx_dp_campaign_date",
        table: "daily_performance",
        columns: "campaignId, date"
      },
      // keywords 查询优化索引
      {
        name: "idx_kw_account_campaign",
        table: "keywords",
        columns: "accountId, campaignId"
      },
      // campaigns 查询优化索引
      {
        name: "idx_camp_account_status",
        table: "campaigns",
        columns: "accountId, status"
      }
    ];
    __name(runV345PerformanceIndexMigration, "runV345PerformanceIndexMigration");
  }
});

