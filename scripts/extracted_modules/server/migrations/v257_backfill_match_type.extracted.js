// Extracted from production dist/index.js
// Original module: server/migrations/v257_backfill_match_type.ts
// Lines: 54

var v257_backfill_match_type_exports = {};
__export(v257_backfill_match_type_exports, {
  backfillMatchType: () => backfillMatchType
});
async function backfillMatchType() {
  const db = await getDb();
  if (!db) return { updated: 0, errors: 0 };
  let updated = 0;
  let errors = 0;
  try {
    log118.info("[v257] \u5F00\u59CB\u56DE\u586Boptimization_events.match_type...");
    const result = await db.execute(sql`
      UPDATE optimization_events oe
      JOIN keywords k ON oe.keyword_id = k.id
      SET oe.match_type = k.matchType
      WHERE oe.keyword_id IS NOT NULL
        AND (oe.match_type IS NULL OR oe.match_type = '')
        AND k.matchType IS NOT NULL
    `);
    const affectedRows = result[0]?.affectedRows || result?.affectedRows || 0;
    updated = affectedRows;
    log118.info(`[v257] match_type\u56DE\u586B\u5B8C\u6210: \u66F4\u65B0\u4E86${updated}\u6761\u8BB0\u5F55`);
    const coverageResult = await db.execute(sql`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN match_type IS NOT NULL AND match_type != '' THEN 1 ELSE 0 END) as with_match_type,
        SUM(CASE WHEN keyword_id IS NOT NULL THEN 1 ELSE 0 END) as with_keyword
      FROM optimization_events
      WHERE event_category = 'bid_adjustment'
    `);
    const coverage = coverageResult[0] || {};
    const total = Number(coverage.total) || 0;
    const withMatchType = Number(coverage.with_match_type) || 0;
    const withKeyword = Number(coverage.with_keyword) || 0;
    const coverageRate = withKeyword > 0 ? (withMatchType / withKeyword * 100).toFixed(1) : "0";
    log118.info(`[v257] match_type\u8986\u76D6\u7387: ${withMatchType}/${withKeyword}\u6761\u5173\u952E\u8BCD\u4E8B\u4EF6\u6709match_type (${coverageRate}%), \u603B\u4E8B\u4EF6=${total}`);
  } catch (error48) {
    log118.warn(`[v257] match_type\u56DE\u586B\u5931\u8D25: ${error48.message}`);
    errors++;
  }
  return { updated, errors };
}
var log118;
var init_v257_backfill_match_type = __esm({
  "server/migrations/v257_backfill_match_type.ts"() {
    "use strict";
    init_db2();
    init_drizzle_orm();
    init_logger();
    log118 = createModuleLogger("MigrationV257");
    __name(backfillMatchType, "backfillMatchType");
  }
});

