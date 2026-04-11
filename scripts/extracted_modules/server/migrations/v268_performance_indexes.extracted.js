// Extracted from production dist/index.js
// Original module: server/migrations/v268_performance_indexes.ts
// Lines: 49

var v268_performance_indexes_exports = {};
__export(v268_performance_indexes_exports, {
  runV268PerformanceIndexMigration: () => runV268PerformanceIndexMigration
});
async function runV268PerformanceIndexMigration() {
  const db = await getDb();
  if (!db) {
    log120.info("[v268-migration] Database not available, skipping index creation");
    return;
  }
  try {
    const [existingIndexes] = await db.execute();
    if (existingIndexes && existingIndexes.length > 0) {
      log120.info("[v268-migration] Index idx_dp_account_date already exists, skipping");
      return;
    }
    log120.info("[v268-migration] Creating index idx_dp_account_date on daily_performance(accountId, date)...");
    await db.execute(
      sql`CREATE INDEX idx_dp_account_date ON daily_performance(accountId, date)`
    );
    log120.info("[v268-migration] Index idx_dp_account_date created successfully");
    const [eventsIndexes] = await db.execute();
    if (!eventsIndexes || eventsIndexes.length === 0) {
      log120.info("[v268-migration] Creating index idx_oe_category_type on optimization_events(event_category, action_type)...");
      await db.execute(
        sql`CREATE INDEX idx_oe_category_type ON optimization_events(event_category, action_type)`
      );
      log120.info("[v268-migration] Index idx_oe_category_type created successfully");
    }
  } catch (error48) {
    if (error48.message?.includes("Duplicate key name") || error48.code === "ER_DUP_KEYNAME") {
      log120.info("[v268-migration] Index already exists (different name), skipping");
    } else {
      console.error("[v268-migration] Error creating indexes:", error48.message);
    }
  }
}
var log120;
var init_v268_performance_indexes = __esm({
  "server/migrations/v268_performance_indexes.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_drizzle_orm();
    log120 = createModuleLogger("Migration:v268idx");
    __name(runV268PerformanceIndexMigration, "runV268PerformanceIndexMigration");
  }
});

