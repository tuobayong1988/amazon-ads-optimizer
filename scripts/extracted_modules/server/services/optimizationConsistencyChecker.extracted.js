// Extracted from production dist/index.js
// Original module: server/services/optimizationConsistencyChecker.ts
// Lines: 167

var optimizationConsistencyChecker_exports = {};
__export(optimizationConsistencyChecker_exports, {
  runConsistencyCheck: () => runConsistencyCheck
});
async function runConsistencyCheck() {
  const startTime = Date.now();
  const result = {
    checkTime: (/* @__PURE__ */ new Date()).toISOString(),
    scannedEvents: 0,
    fixedByEventId: 0,
    fixedByKeywordMatch: 0,
    markedPermanentlyFailed: 0,
    markedSuperseded: 0,
    duration: 0,
    errors: []
  };
  const database = await getDb();
  if (!database) {
    result.errors.push("\u6570\u636E\u5E93\u8FDE\u63A5\u4E0D\u53EF\u7528");
    return result;
  }
  try {
    log141.info("[v509] \u5F00\u59CB\u4F18\u5316\u4E8B\u4EF6\u4E00\u81F4\u6027\u68C0\u67E5...");
    try {
      const [eventIdResult] = await database.execute(sql.raw(`
        UPDATE optimization_events oe
        INNER JOIN optimization_tasks ot ON ot.event_id = oe.id
        SET oe.api_sync_status = CASE 
              WHEN ot.status = 'synced' THEN 'synced'
              WHEN ot.status = 'permanently_failed' THEN 'permanently_failed'
              WHEN ot.status = 'failed' THEN 'failed'
              ELSE oe.api_sync_status
            END,
            oe.error_message = CASE
              WHEN ot.status IN ('synced', 'permanently_failed', 'failed') 
              THEN CONCAT(COALESCE(oe.error_message, ''), ' | v509: event_id\u7CBE\u786E\u5339\u914D\u56DE\u5199(', ot.status, ')')
              ELSE oe.error_message
            END,
            oe.api_synced_at = CASE
              WHEN ot.status = 'synced' THEN ot.completed_at
              ELSE oe.api_synced_at
            END
        WHERE oe.api_sync_status = 'pending'
          AND oe.created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
          AND oe.created_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)
          AND ot.status IN ('synced', 'permanently_failed', 'failed')
      `));
      result.fixedByEventId = eventIdResult.affectedRows || 0;
      if (result.fixedByEventId > 0) {
        log141.info(`[v509] Step 1: event_id\u7CBE\u786E\u5339\u914D\u4FEE\u590D ${result.fixedByEventId} \u6761`);
      }
    } catch (e) {
      const msg = e.message;
      if (!msg.includes("Unknown column") && !msg.includes("doesn't exist")) {
        log141.warn(`[v509] Step 1 event_id\u5339\u914D\u5931\u8D25: ${msg}`);
        result.errors.push(`event_id\u5339\u914D: ${msg}`);
      }
    }
    try {
      const [kwMatchResult] = await database.execute(sql.raw(`
        UPDATE optimization_events oe
        INNER JOIN optimization_tasks ot 
          ON oe.keyword_id = ot.target_entity_id 
          AND oe.account_id = ot.account_id
          AND ot.task_type = 'bid_adjustment'
          AND ABS(TIMESTAMPDIFF(MINUTE, oe.created_at, ot.created_at)) < 60
        SET oe.api_sync_status = CASE 
              WHEN ot.status = 'synced' THEN 'synced'
              WHEN ot.status = 'permanently_failed' THEN 'permanently_failed'
              WHEN ot.status = 'failed' THEN 'failed'
              ELSE oe.api_sync_status
            END,
            oe.error_message = CASE
              WHEN ot.status IN ('synced', 'permanently_failed', 'failed')
              THEN CONCAT(COALESCE(oe.error_message, ''), ' | v509: keyword\u5339\u914D\u56DE\u5199(', ot.status, ')')
              ELSE oe.error_message
            END,
            oe.api_synced_at = CASE
              WHEN ot.status = 'synced' THEN ot.completed_at
              ELSE oe.api_synced_at
            END
        WHERE oe.api_sync_status = 'pending'
          AND oe.action_type IN ('bid_increase', 'bid_decrease', 'dayparting_bid')
          AND oe.keyword_id IS NOT NULL
          AND oe.created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
          AND oe.created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
          AND ot.status IN ('synced', 'permanently_failed', 'failed')
      `));
      result.fixedByKeywordMatch = kwMatchResult.affectedRows || 0;
      if (result.fixedByKeywordMatch > 0) {
        log141.info(`[v509] Step 2: keyword\u5339\u914D\u4FEE\u590D ${result.fixedByKeywordMatch} \u6761`);
      }
    } catch (e) {
      log141.warn(`[v509] Step 2 keyword\u5339\u914D\u5931\u8D25: ${e.message}`);
      result.errors.push(`keyword\u5339\u914D: ${e.message}`);
    }
    try {
      const [supersededResult] = await database.execute(sql.raw(`
        UPDATE optimization_events 
        SET api_sync_status = 'superseded',
            error_message = CONCAT(COALESCE(error_message, ''), ' | v509: \u5206\u65F6\u7ADE\u4EF7\u8D8524h\u672A\u540C\u6B65\uFF0C\u5DF2\u88AB\u65B0\u6307\u4EE4\u8986\u76D6')
        WHERE api_sync_status = 'pending'
          AND action_type = 'dayparting_bid'
          AND created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
          AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
      `));
      result.markedSuperseded = supersededResult.affectedRows || 0;
      if (result.markedSuperseded > 0) {
        log141.info(`[v509] Step 3: \u5206\u65F6\u7ADE\u4EF7superseded ${result.markedSuperseded} \u6761`);
      }
    } catch (e) {
      log141.warn(`[v509] Step 3 superseded\u6807\u8BB0\u5931\u8D25: ${e.message}`);
      result.errors.push(`superseded\u6807\u8BB0: ${e.message}`);
    }
    try {
      const [orphanResult] = await database.execute(sql.raw(`
        UPDATE optimization_events 
        SET api_sync_status = 'permanently_failed',
            error_message = CONCAT(COALESCE(error_message, ''), ' | v509: pending\u8D8572h\u65E0\u5339\u914D\u4EFB\u52A1\uFF0C\u6807\u8BB0\u4E3Apermanently_failed')
        WHERE api_sync_status = 'pending'
          AND action_type IN ('bid_increase', 'bid_decrease')
          AND created_at < DATE_SUB(NOW(), INTERVAL 72 HOUR)
          AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
      `));
      result.markedPermanentlyFailed = orphanResult.affectedRows || 0;
      if (result.markedPermanentlyFailed > 0) {
        log141.info(`[v509] Step 4: \u5B64\u7ACB\u4E8B\u4EF6permanently_failed ${result.markedPermanentlyFailed} \u6761`);
      }
    } catch (e) {
      log141.warn(`[v509] Step 4 \u5B64\u7ACB\u4E8B\u4EF6\u6807\u8BB0\u5931\u8D25: ${e.message}`);
      result.errors.push(`\u5B64\u7ACB\u4E8B\u4EF6\u6807\u8BB0: ${e.message}`);
    }
    try {
      const [countResult] = await database.execute(sql.raw(`
        SELECT COUNT(*) as cnt FROM optimization_events 
        WHERE api_sync_status = 'pending'
          AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
      `));
      result.scannedEvents = countResult?.[0]?.cnt || 0;
    } catch (e) {
      log141.warn(`[v509] \u7EDF\u8BA1pending\u4E8B\u4EF6\u5931\u8D25: ${e.message}`);
    }
    result.duration = Date.now() - startTime;
    const totalFixed = result.fixedByEventId + result.fixedByKeywordMatch + result.markedSuperseded + result.markedPermanentlyFailed;
    if (totalFixed > 0) {
      log141.warn(`[v509] \u4E00\u81F4\u6027\u68C0\u67E5\u5B8C\u6210: \u4FEE\u590D=${totalFixed} (event_id=${result.fixedByEventId}, keyword=${result.fixedByKeywordMatch}, superseded=${result.markedSuperseded}, permanently_failed=${result.markedPermanentlyFailed}), \u5269\u4F59pending=${result.scannedEvents}, \u8017\u65F6=${result.duration}ms`);
    } else {
      log141.info(`[v509] \u4E00\u81F4\u6027\u68C0\u67E5\u5B8C\u6210: \u65E0\u9700\u4FEE\u590D, \u5F53\u524Dpending=${result.scannedEvents}, \u8017\u65F6=${result.duration}ms`);
    }
  } catch (error48) {
    log141.warn(`[v509] \u4E00\u81F4\u6027\u68C0\u67E5\u5F02\u5E38: ${error48.message}`);
    result.errors.push(`\u68C0\u67E5\u5F02\u5E38: ${error48.message}`);
  }
  return result;
}
var log141;
var init_optimizationConsistencyChecker = __esm({
  "server/services/optimizationConsistencyChecker.ts"() {
    "use strict";
    init_drizzle_orm();
    init_logger();
    init_connection();
    log141 = createModuleLogger("OptConsistencyChecker");
    __name(runConsistencyCheck, "runConsistencyCheck");
  }
});

