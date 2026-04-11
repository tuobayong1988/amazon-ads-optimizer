// Extracted from production dist/index.js
// Original module: server/migrations/v390_performance_indexes.ts
// Lines: 58

var v390_performance_indexes_exports = {};
__export(v390_performance_indexes_exports, {
  runV390PerformanceIndexes: () => runV390PerformanceIndexes
});
async function runV390PerformanceIndexes(db) {
  log125.info("[v390] \u5F00\u59CB\u521B\u5EFA\u6027\u80FD\u4F18\u5316\u7D22\u5F15...");
  const indexDefinitions = [
    // optimization_events表 - 纠错监控高频查询索引
    { name: "idx_oe_account_sync_status", table: "optimization_events", ddl: "CREATE INDEX idx_oe_account_sync_status ON optimization_events (account_id, api_sync_status)" },
    { name: "idx_oe_account_action_type", table: "optimization_events", ddl: "CREATE INDEX idx_oe_account_action_type ON optimization_events (account_id, action_type)" },
    { name: "idx_oe_account_synced_at", table: "optimization_events", ddl: "CREATE INDEX idx_oe_account_synced_at ON optimization_events (account_id, api_synced_at)" },
    { name: "idx_oe_account_action_sync", table: "optimization_events", ddl: "CREATE INDEX idx_oe_account_action_sync ON optimization_events (account_id, action_type, api_sync_status)" },
    // 覆盖最近纠错日志查询的排序条件
    { name: "idx_oe_account_created_at", table: "optimization_events", ddl: "CREATE INDEX idx_oe_account_created_at ON optimization_events (account_id, created_at DESC)" },
    // daily_performance表 - 健康分析查询索引
    { name: "idx_dp_account_date_desc", table: "daily_performance", ddl: "CREATE INDEX idx_dp_account_date_desc ON daily_performance (accountId, date DESC)" }
  ];
  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const idx of indexDefinitions) {
    try {
      const checkSql = `SELECT COUNT(*) as cnt FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${idx.table}' AND INDEX_NAME = '${idx.name}'`;
      const checkResult = db.execute(sql.raw(checkSql));
      const rows = await checkResult;
      const exists2 = rows?.[0]?.[0]?.cnt > 0 || rows?.[0]?.cnt > 0;
      if (exists2) {
        skipped++;
        log125.debug(`[v390] \u7D22\u5F15 ${idx.name} \u5DF2\u5B58\u5728\uFF0C\u8DF3\u8FC7`);
        continue;
      }
      await db.execute(sql.raw(idx.ddl));
      created++;
      log125.info(`[v390] \u7D22\u5F15 ${idx.name} \u521B\u5EFA\u6210\u529F`);
    } catch (error48) {
      const errMsg = error48.message || "";
      if (errMsg.includes("Duplicate") || error48.code === "ER_DUP_KEYNAME") {
        skipped++;
        log125.debug(`[v390] \u7D22\u5F15 ${idx.name} \u5DF2\u5B58\u5728\uFF08Duplicate\uFF09\uFF0C\u8DF3\u8FC7`);
      } else {
        failed++;
        log125.warn(`[v390] \u7D22\u5F15 ${idx.name} \u521B\u5EFA\u5931\u8D25: ${errMsg}`);
      }
    }
  }
  log125.info(`[v390] \u6027\u80FD\u4F18\u5316\u7D22\u5F15\u8FC1\u79FB\u5B8C\u6210: \u521B\u5EFA=${created}, \u8DF3\u8FC7=${skipped}, \u5931\u8D25=${failed}`);
}
var log125;
var init_v390_performance_indexes = __esm({
  "server/migrations/v390_performance_indexes.ts"() {
    "use strict";
    init_drizzle_orm();
    init_logger();
    log125 = createModuleLogger("Migration-v390-indexes");
    __name(runV390PerformanceIndexes, "runV390PerformanceIndexes");
  }
});

