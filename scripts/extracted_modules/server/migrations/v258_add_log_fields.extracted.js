// Extracted from production dist/index.js
// Original module: server/migrations/v258_add_log_fields.ts
// Lines: 66

var v258_add_log_fields_exports = {};
__export(v258_add_log_fields_exports, {
  runV258Migration: () => runV258Migration
});
async function runV258Migration() {
  const db = await getDb();
  if (!db) {
    log119.warn("v258\u8FC1\u79FB: \u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25");
    return;
  }
  try {
    log119.info("v258\u8FC1\u79FB: \u5F00\u59CB\u6DFB\u52A0\u4F18\u5316\u65E5\u5FD7\u589E\u5F3A\u5B57\u6BB5...");
    const [columns] = await db.execute(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'optimization_events' 
      AND COLUMN_NAME IN ('reason_details', 'guardrail_info', 'related_event_id')
    `);
    const existingColumns = new Set(
      (Array.isArray(columns) ? columns : []).map((c) => c.COLUMN_NAME)
    );
    if (!existingColumns.has("reason_details")) {
      await db.execute(`
        ALTER TABLE optimization_events 
        ADD COLUMN reason_details JSON DEFAULT NULL 
        COMMENT 'v258: \u7ED3\u6784\u5316\u8C03\u6574\u5F52\u56E0\u8BE6\u60C5(\u89E6\u53D1\u89C4\u5219/\u6838\u5FC3\u6570\u636E/\u7B97\u6CD5\u9009\u62E9)'
      `);
      log119.info("v258\u8FC1\u79FB: \u5DF2\u6DFB\u52A0 reason_details \u5B57\u6BB5");
    }
    if (!existingColumns.has("guardrail_info")) {
      await db.execute(`
        ALTER TABLE optimization_events 
        ADD COLUMN guardrail_info JSON DEFAULT NULL 
        COMMENT 'v258: \u62A4\u680F\u673A\u5236\u4ECB\u5165\u4FE1\u606F(\u51B7\u5374/\u7194\u65AD/\u4EF2\u88C1\u72B6\u6001)'
      `);
      log119.info("v258\u8FC1\u79FB: \u5DF2\u6DFB\u52A0 guardrail_info \u5B57\u6BB5");
    }
    if (!existingColumns.has("related_event_id")) {
      await db.execute(`
        ALTER TABLE optimization_events 
        ADD COLUMN related_event_id INT DEFAULT NULL 
        COMMENT 'v258: \u5173\u8054\u7684\u539F\u59CB\u4F18\u5316\u4E8B\u4EF6ID'
      `);
      await db.execute(`
        ALTER TABLE optimization_events 
        ADD INDEX idx_oe_related_event (related_event_id)
      `).catch(() => {
        log119.warn("v258\u8FC1\u79FB: related_event_id\u7D22\u5F15\u5DF2\u5B58\u5728\u6216\u521B\u5EFA\u5931\u8D25");
      });
      log119.info("v258\u8FC1\u79FB: \u5DF2\u6DFB\u52A0 related_event_id \u5B57\u6BB5\u548C\u7D22\u5F15");
    }
    log119.info("v258\u8FC1\u79FB: \u4F18\u5316\u65E5\u5FD7\u589E\u5F3A\u5B57\u6BB5\u6DFB\u52A0\u5B8C\u6210");
  } catch (error48) {
    log119.warn(`v258\u8FC1\u79FB\u5931\u8D25: ${error48.message}`);
  }
}
var log119;
var init_v258_add_log_fields = __esm({
  "server/migrations/v258_add_log_fields.ts"() {
    "use strict";
    init_db2();
    init_logger();
    log119 = createModuleLogger("Migration-v258");
    __name(runV258Migration, "runV258Migration");
  }
});

