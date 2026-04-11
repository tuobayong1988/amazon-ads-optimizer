// Extracted from production dist/index.js
// Original module: server/db/v550-patch/pendingEventProcessor.ts
// Lines: 245

var pendingEventProcessor_exports = {};
__export(pendingEventProcessor_exports, {
  getPendingEventProcessorStatus: () => getPendingEventProcessorStatus,
  startPendingEventProcessor: () => startPendingEventProcessor,
  stopPendingEventProcessor: () => stopPendingEventProcessor
});
function startPendingEventProcessor() {
  // P5e: Skip in web process if worker is handling it
  const _p5eWorkerActive = process.env.P5_WORKER_ENABLED === "true" && !process.env.P5_IS_WORKER;
  if (_p5eWorkerActive) {
    log138.info("[P5e] PendingEventProcessor delegated to worker process, skipping in web process");
    return;
  }
  if (processorInterval) {
    log138.warn("[v550-patch] Pending Event Processor \u5DF2\u5728\u8FD0\u884C");
    return;
  }
  log138.info(`[v550-patch] \u542F\u52A8Pending Event Processor\uFF0C\u95F4\u9694: ${CONFIG2.PROCESS_INTERVAL_MS}ms`);
  processPendingEvents().catch((err) => {
    log138.error("[v550-patch] \u521D\u59CB\u5904\u7406\u5931\u8D25:", err.message);
  });
  processorInterval = setInterval(() => {
    if (!isProcessing) {
      processPendingEvents().catch((err) => {
        log138.error("[v550-patch] \u5B9A\u65F6\u5904\u7406\u5931\u8D25:", err.message);
      });
    }
  }, CONFIG2.PROCESS_INTERVAL_MS);
}
function stopPendingEventProcessor() {
  if (processorInterval) {
    clearInterval(processorInterval);
    processorInterval = null;
    log138.info("[v550-patch] Pending Event Processor \u5DF2\u505C\u6B62");
  }
}
async function processPendingEvents() {
  if (isProcessing) {
    return { processed: 0, created: 0, skipped: 0, errors: 0 };
  }
  isProcessing = true;
  const result = { processed: 0, created: 0, skipped: 0, errors: 0 };
  try {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }
    const pendingEvents = await db.execute(sql`
      SELECT 
        oe.id as event_id,
        oe.account_id,
        oe.campaign_id,
        oe.keyword_id,
        oe.action_type,
        oe.previous_bid,
        oe.new_bid,
        oe.previous_value,
        oe.new_value,
        oe.target_name,
        oe.keyword_text,
        oe.change_reason,
        oe.campaign_name,
        oe.algorithm_version,
        oe.created_at,
        k.keywordId as amazon_keyword_id
      FROM optimization_events oe
      LEFT JOIN optimization_tasks ot ON ot.event_id = oe.id
      LEFT JOIN keywords k ON k.id = oe.keyword_id
      WHERE oe.api_sync_status = 'pending'
        AND oe.action_type IN (${CONFIG2.SYNCABLE_ACTIONS.map((a) => `'${a}'`).join(",")})
        AND oe.created_at > DATE_SUB(NOW(), INTERVAL ${CONFIG2.MAX_AGE_DAYS} DAY)
        AND ot.id IS NULL
      ORDER BY oe.created_at ASC
      LIMIT ${CONFIG2.MAX_BATCH_SIZE}
    `);
    const events = Array.isArray(pendingEvents) ? pendingEvents : [];
    result.processed = events.length;
    if (events.length === 0) {
      isProcessing = false;
      return result;
    }
    log138.info(`[v550-patch] \u53D1\u73B0 ${events.length} \u4E2Apending events\u9700\u8981\u5904\u7406`);
    const { enqueueTasks: enqueueTasks2 } = await Promise.resolve().then(() => (init_optimizationSyncEngine(), optimizationSyncEngine_exports));
    const { randomUUID: randomUUID6 } = await import("crypto");
    const batchId = `v550_${Date.now()}`;
    const tasks = [];
    for (const event of events) {
      try {
        const task = convertEventToTask(event, batchId);
        if (task) {
          tasks.push(task);
          result.created++;
        } else {
          result.skipped++;
        }
      } catch (err) {
        result.errors++;
        log138.warn(`[v550-patch] \u8F6C\u6362event\u5931\u8D25: event_id=${event.event_id}, error=${err.message}`);
      }
    }
    if (tasks.length > 0) {
      try {
        await enqueueTasks2(tasks);
        log138.info(`[v550-patch] \u2705 \u6210\u529F\u5165\u961F ${tasks.length} \u4E2Atasks, batchId=${batchId}`);
        const eventIds = events.map((e) => e.event_id).filter(Boolean);
        if (eventIds.length > 0) {
          await db.execute(sql`
            UPDATE optimization_events 
            SET api_sync_status = 'processing',
                api_sync_detail = CONCAT('v550-patch: 已创建task, batch_id=${batchId}')
            WHERE id IN (${eventIds.join(",")})
          `);
        }
      } catch (err) {
        result.errors += tasks.length;
        log138.error(`[v550-patch] \u274C \u6279\u91CF\u5165\u961F\u5931\u8D25: ${err.message}`);
      }
    }
    log138.info(`[v550-patch] \u5904\u7406\u5B8C\u6210: processed=${result.processed}, created=${result.created}, skipped=${result.skipped}, errors=${result.errors}`);
  } catch (err) {
    log138.error(`[v550-patch] \u5904\u7406\u5F02\u5E38: ${err.message}`);
    result.errors++;
  } finally {
    isProcessing = false;
  }
  return result;
}
function convertEventToTask(event, batchId) {
  const actionType = event.action_type;
  if (!actionType) return null;
  const actionToTaskType = {
    "bid_increase": "bid_adjustment",
    "bid_decrease": "bid_adjustment",
    "bid_set": "bid_adjustment",
    "budget_increase": "budget_adjustment",
    "budget_decrease": "budget_adjustment",
    "campaign_pause": "campaign_status",
    "campaign_enable": "campaign_status",
    "keyword_pause": "keyword_status",
    "keyword_enable": "keyword_status",
    "negative_keyword_add": "negative_keyword",
    "search_term_harvest": "new_keyword",
    "placement_adjust": "placement_adjustment",
    "dayparting_bid": "dayparting_adjustment"
  };
  const actionToEntityType = {
    "bid_increase": "keyword",
    "bid_decrease": "keyword",
    "bid_set": "keyword",
    "budget_increase": "campaign",
    "budget_decrease": "campaign",
    "campaign_pause": "campaign",
    "campaign_enable": "campaign",
    "keyword_pause": "keyword",
    "keyword_enable": "keyword",
    "negative_keyword_add": "negative_keyword",
    "search_term_harvest": "keyword",
    "placement_adjust": "placement",
    "dayparting_bid": "keyword"
  };
  const taskType = actionToTaskType[actionType];
  const entityType = actionToEntityType[actionType];
  if (!taskType || !entityType) {
    return null;
  }
  let targetEntityId = 0;
  let optimizationTargetId = 0;
  if (entityType === "keyword" && event.keyword_id) {
    targetEntityId = event.keyword_id;
    optimizationTargetId = event.keyword_id;
  }
  return {
    batch_id: batchId,
    optimization_target_id: optimizationTargetId,
    account_id: event.account_id,
    task_type: taskType,
    priority: 5,
    target_entity_type: entityType,
    target_entity_id: targetEntityId,
    amazon_entity_id: event.amazon_keyword_id || null,
    target_entity_name: event.target_name || event.keyword_text || null,
    action: actionType,
    old_value: event.previous_bid || event.previous_value,
    new_value: event.new_bid || event.new_value,
    change_reason: event.change_reason,
    algorithm_used: event.algorithm_version,
    confidence_score: null,
    campaign_id: event.campaign_id ? String(event.campaign_id) : null,
    campaign_name: event.campaign_name,
    status: "pending",
    retry_count: 0,
    max_retries: 3,
    created_at: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
    event_id: event.event_id
  };
}
function getPendingEventProcessorStatus() {
  return {
    isRunning: processorInterval !== null,
    isProcessing,
    config: CONFIG2
  };
}
var log138, CONFIG2, processorInterval, isProcessing;
var init_pendingEventProcessor = __esm({
  "server/db/v550-patch/pendingEventProcessor.ts"() {
    "use strict";
    init_connection();
    init_drizzle_orm();
    init_logger();
    log138 = createModuleLogger("v550:PendingEventProcessor");
    CONFIG2 = {
      // 处理间隔: 30秒（快速响应）
      PROCESS_INTERVAL_MS: 30 * 1e3,
      // 每次最多处理数量
      MAX_BATCH_SIZE: 50,
      // 只处理最近7天的events
      MAX_AGE_DAYS: 7,
      // 需要处理的action类型
      SYNCABLE_ACTIONS: [
        "bid_increase",
        "bid_decrease",
        "bid_set",
        "budget_increase",
        "budget_decrease",
        "campaign_pause",
        "campaign_enable",
        "keyword_pause",
        "keyword_enable",
        "negative_keyword_add",
        "search_term_harvest",
        "placement_adjust",
        "dayparting_bid"
      ]
    };
    processorInterval = null;
    isProcessing = false;
    __name(startPendingEventProcessor, "startPendingEventProcessor");
    __name(stopPendingEventProcessor, "stopPendingEventProcessor");
    __name(processPendingEvents, "processPendingEvents");
    __name(convertEventToTask, "convertEventToTask");
    __name(getPendingEventProcessorStatus, "getPendingEventProcessorStatus");
  }
});

