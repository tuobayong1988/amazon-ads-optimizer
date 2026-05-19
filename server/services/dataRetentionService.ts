// @ts-nocheck
/**
 * server/services/dataRetentionService.ts
 * 
 * Auto-converted from production bundle to TypeScript source.
 * Version: v621147 (production)
 */

import { getDb } from '../db';
import { keywords } from '../../drizzle/schema';

function checkMemoryAvailable() {
  const mem = process.memoryUsage();
  const heapSizeLimit = import_v8.default.getHeapStatistics().heap_size_limit;
  const heapUtil = Math.round(mem.heapUsed / heapSizeLimit * 100);
  return {
    available: heapUtil < RETENTION_CONFIG.memoryThresholdPercent,
    heapUtil
  };
}
async function batchDelete(database, deleteQuery, params, batchSize) {
  let totalDeleted = 0;
  let batchDeleted = 0;
  do {
    const queryWithLimit = `${deleteQuery} LIMIT ${batchSize}`;
    const [result] = await database.execute(sql.raw(queryWithLimit));
    batchDeleted = result.affectedRows || 0;
    totalDeleted += batchDeleted;
    if (batchDeleted > 0 && batchDeleted >= batchSize) {
      await new Promise((resolve) => setTimeout(resolve, RETENTION_CONFIG.batchDelayMs));
    }
  } while (batchDeleted >= batchSize);
  return totalDeleted;
}
export async function executeDataCleanup() {
  const startTime = /* @__PURE__ */ new Date();
  const tables = [];
  let totalDeleted = 0;
  const memCheck = checkMemoryAvailable();
  if (!memCheck.available) {
    log65.warn(`[DataRetention] v614i-fix22: \u5185\u5B58\u7D27\u5F20(${memCheck.heapUtil}%)\uFF0C\u8DF3\u8FC7\u6570\u636E\u6E05\u7406`);
    return {
      success: false,
      startTime: startTime.toISOString(),
      endTime: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: Date.now() - startTime.getTime(),
      tables: [],
      totalDeleted: 0,
      skippedReason: `\u5185\u5B58\u7D27\u5F20: ${memCheck.heapUtil}%`
    };
  }
  log65.info(`[DataRetention] v614i-fix22: \u5F00\u59CB\u6570\u636E\u6E05\u7406 (heap=${memCheck.heapUtil}%)`);
  try {
    const database = await getDb();
    if (!database) {
      return {
        success: false,
        startTime: startTime.toISOString(),
        endTime: (/* @__PURE__ */ new Date()).toISOString(),
        durationMs: Date.now() - startTime.getTime(),
        tables: [],
        totalDeleted: 0,
        skippedReason: "\u6570\u636E\u5E93\u8FDE\u63A5\u4E0D\u53EF\u7528"
      };
    }
    try {
      const kwDeleted = await batchDelete(
        database,
        `DELETE FROM keywords WHERE keywordStatus = 'amazon_deleted' AND updated_at < DATE_SUB(NOW(), INTERVAL ${RETENTION_CONFIG.deletedEntityRetentionDays} DAY)`,
        [],
        RETENTION_CONFIG.batchSize
      );
      tables.push({
        table: "keywords",
        description: "amazon_deleted\u72B6\u6001\u5173\u952E\u8BCD",
        deletedCount: kwDeleted,
        retentionDays: RETENTION_CONFIG.deletedEntityRetentionDays
      });
      totalDeleted += kwDeleted;
      if (kwDeleted > 0) log65.info(`[DataRetention] keywords: \u6E05\u7406${kwDeleted}\u6761amazon_deleted\u8BB0\u5F55`);
    } catch (err) {
      tables.push({
        table: "keywords",
        description: "amazon_deleted\u72B6\u6001\u5173\u952E\u8BCD",
        deletedCount: 0,
        retentionDays: RETENTION_CONFIG.deletedEntityRetentionDays,
        error: err.message
      });
      log65.warn(`[DataRetention] keywords\u6E05\u7406\u5931\u8D25: ${err.message}`);
    }
    try {
      const ptDeleted = await batchDelete(
        database,
        `DELETE FROM product_targets WHERE targetStatus = 'amazon_deleted' AND updated_at < DATE_SUB(NOW(), INTERVAL ${RETENTION_CONFIG.deletedEntityRetentionDays} DAY)`,
        [],
        RETENTION_CONFIG.batchSize
      );
      tables.push({
        table: "product_targets",
        description: "amazon_deleted\u72B6\u6001\u5546\u54C1\u5B9A\u5411",
        deletedCount: ptDeleted,
        retentionDays: RETENTION_CONFIG.deletedEntityRetentionDays
      });
      totalDeleted += ptDeleted;
      if (ptDeleted > 0) log65.info(`[DataRetention] product_targets: \u6E05\u7406${ptDeleted}\u6761amazon_deleted\u8BB0\u5F55`);
    } catch (err) {
      tables.push({
        table: "product_targets",
        description: "amazon_deleted\u72B6\u6001\u5546\u54C1\u5B9A\u5411",
        deletedCount: 0,
        retentionDays: RETENTION_CONFIG.deletedEntityRetentionDays,
        error: err.message
      });
      log65.warn(`[DataRetention] product_targets\u6E05\u7406\u5931\u8D25: ${err.message}`);
    }
    try {
      const taskDeleted = await batchDelete(
        database,
        `DELETE FROM optimization_tasks WHERE status IN ('synced', 'permanently_failed') AND created_at < DATE_SUB(NOW(), INTERVAL ${RETENTION_CONFIG.completedTaskRetentionDays} DAY)`,
        [],
        RETENTION_CONFIG.batchSize
      );
      tables.push({
        table: "optimization_tasks",
        description: "\u5DF2\u5B8C\u6210/\u6C38\u4E45\u5931\u8D25\u7684\u4F18\u5316\u4EFB\u52A1",
        deletedCount: taskDeleted,
        retentionDays: RETENTION_CONFIG.completedTaskRetentionDays
      });
      totalDeleted += taskDeleted;
      if (taskDeleted > 0) log65.info(`[DataRetention] optimization_tasks: \u6E05\u7406${taskDeleted}\u6761\u5DF2\u5B8C\u6210\u4EFB\u52A1`);
    } catch (err) {
      tables.push({
        table: "optimization_tasks",
        description: "\u5DF2\u5B8C\u6210/\u6C38\u4E45\u5931\u8D25\u7684\u4F18\u5316\u4EFB\u52A1",
        deletedCount: 0,
        retentionDays: RETENTION_CONFIG.completedTaskRetentionDays,
        error: err.message
      });
      log65.warn(`[DataRetention] optimization_tasks\u6E05\u7406\u5931\u8D25: ${err.message}`);
    }
    try {
      const logDeleted = await batchDelete(
        database,
        `DELETE FROM bidding_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ${RETENTION_CONFIG.biddingLogRetentionDays} DAY)`,
        [],
        RETENTION_CONFIG.batchSize
      );
      tables.push({
        table: "bidding_logs",
        description: "\u5386\u53F2\u51FA\u4EF7\u65E5\u5FD7",
        deletedCount: logDeleted,
        retentionDays: RETENTION_CONFIG.biddingLogRetentionDays
      });
      totalDeleted += logDeleted;
      if (logDeleted > 0) log65.info(`[DataRetention] bidding_logs: \u6E05\u7406${logDeleted}\u6761\u8FC7\u671F\u65E5\u5FD7`);
    } catch (err) {
      tables.push({
        table: "bidding_logs",
        description: "\u5386\u53F2\u51FA\u4EF7\u65E5\u5FD7",
        deletedCount: 0,
        retentionDays: RETENTION_CONFIG.biddingLogRetentionDays,
        error: err.message
      });
      log65.warn(`[DataRetention] bidding_logs\u6E05\u7406\u5931\u8D25: ${err.message}`);
    }
    try {
      const conflictDeleted = await batchDelete(
        database,
        `DELETE FROM sync_conflicts WHERE created_at < DATE_SUB(NOW(), INTERVAL ${RETENTION_CONFIG.syncConflictRetentionDays} DAY)`,
        [],
        RETENTION_CONFIG.batchSize
      );
      tables.push({
        table: "sync_conflicts",
        description: "\u540C\u6B65\u51B2\u7A81\u8BB0\u5F55",
        deletedCount: conflictDeleted,
        retentionDays: RETENTION_CONFIG.syncConflictRetentionDays
      });
      totalDeleted += conflictDeleted;
      if (conflictDeleted > 0) log65.info(`[DataRetention] sync_conflicts: \u6E05\u7406${conflictDeleted}\u6761\u8FC7\u671F\u8BB0\u5F55`);
    } catch (err) {
      tables.push({
        table: "sync_conflicts",
        description: "\u540C\u6B65\u51B2\u7A81\u8BB0\u5F55",
        deletedCount: 0,
        retentionDays: RETENTION_CONFIG.syncConflictRetentionDays,
        error: err.message
      });
    }
    try {
      const sysLogDeleted = await batchDelete(
        database,
        `DELETE FROM system_logs WHERE timestamp < DATE_SUB(NOW(), INTERVAL ${RETENTION_CONFIG.systemLogRetentionDays} DAY)`,
        [],
        RETENTION_CONFIG.batchSize
      );
      tables.push({
        table: "system_logs",
        description: "\u7CFB\u7EDF\u65E5\u5FD7",
        deletedCount: sysLogDeleted,
        retentionDays: RETENTION_CONFIG.systemLogRetentionDays
      });
      totalDeleted += sysLogDeleted;
      if (sysLogDeleted > 0) log65.info(`[DataRetention] system_logs: \u6E05\u7406${sysLogDeleted}\u6761\u8FC7\u671F\u65E5\u5FD7`);
    } catch (err) {
      tables.push({
        table: "system_logs",
        description: "\u7CFB\u7EDF\u65E5\u5FD7",
        deletedCount: 0,
        retentionDays: RETENTION_CONFIG.systemLogRetentionDays,
        error: err.message
      });
    }
    try {
      const changeDeleted = await batchDelete(
        database,
        `DELETE FROM sync_change_records WHERE created_at < DATE_SUB(NOW(), INTERVAL ${RETENTION_CONFIG.syncChangeRecordRetentionDays} DAY)`,
        [],
        RETENTION_CONFIG.batchSize
      );
      tables.push({
        table: "sync_change_records",
        description: "\u540C\u6B65\u53D8\u66F4\u8BB0\u5F55",
        deletedCount: changeDeleted,
        retentionDays: RETENTION_CONFIG.syncChangeRecordRetentionDays
      });
      totalDeleted += changeDeleted;
      if (changeDeleted > 0) log65.info(`[DataRetention] sync_change_records: \u6E05\u7406${changeDeleted}\u6761\u8FC7\u671F\u8BB0\u5F55`);
    } catch (err) {
      tables.push({
        table: "sync_change_records",
        description: "\u540C\u6B65\u53D8\u66F4\u8BB0\u5F55",
        deletedCount: 0,
        retentionDays: RETENTION_CONFIG.syncChangeRecordRetentionDays,
        error: err.message
      });
    }
    try {
      const archivedKwDeleted = await batchDelete(
        database,
        `DELETE FROM keywords WHERE keywordStatus = 'archived' AND updated_at < DATE_SUB(NOW(), INTERVAL 60 DAY)`,
        [],
        RETENTION_CONFIG.batchSize
      );
      tables.push({
        table: "keywords (archived)",
        description: "archived\u72B6\u6001\u5173\u952E\u8BCD(60\u5929)",
        deletedCount: archivedKwDeleted,
        retentionDays: 60
      });
      totalDeleted += archivedKwDeleted;
      if (archivedKwDeleted > 0) log65.info(`[DataRetention] keywords(archived): \u6E05\u7406${archivedKwDeleted}\u6761archived\u8BB0\u5F55`);
    } catch (err) {
      tables.push({
        table: "keywords (archived)",
        description: "archived\u72B6\u6001\u5173\u952E\u8BCD(60\u5929)",
        deletedCount: 0,
        retentionDays: 60,
        error: err.message
      });
    }
    try {
      const archivedPtDeleted = await batchDelete(
        database,
        `DELETE FROM product_targets WHERE targetStatus = 'archived' AND updated_at < DATE_SUB(NOW(), INTERVAL 60 DAY)`,
        [],
        RETENTION_CONFIG.batchSize
      );
      tables.push({
        table: "product_targets (archived)",
        description: "archived\u72B6\u6001\u5546\u54C1\u5B9A\u5411(60\u5929)",
        deletedCount: archivedPtDeleted,
        retentionDays: 60
      });
      totalDeleted += archivedPtDeleted;
      if (archivedPtDeleted > 0) log65.info(`[DataRetention] product_targets(archived): \u6E05\u7406${archivedPtDeleted}\u6761archived\u8BB0\u5F55`);
    } catch (err) {
      tables.push({
        table: "product_targets (archived)",
        description: "archived\u72B6\u6001\u5546\u54C1\u5B9A\u5411(60\u5929)",
        deletedCount: 0,
        retentionDays: 60,
        error: err.message
      });
    }
    const endTime = /* @__PURE__ */ new Date();
    const result = {
      success: true,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMs: endTime.getTime() - startTime.getTime(),
      tables,
      totalDeleted
    };
    log65.warn(`[DataRetention] v614i-fix22: \u6570\u636E\u6E05\u7406\u5B8C\u6210 \u2014 \u5171\u6E05\u7406${totalDeleted}\u6761\u8BB0\u5F55, \u8017\u65F6${result.durationMs}ms`);
    return result;
  } catch (err) {
    const endTime = /* @__PURE__ */ new Date();
    log65.warn(`[DataRetention] v614i-fix22: \u6570\u636E\u6E05\u7406\u5931\u8D25: ${err.message}`);
    return {
      success: false,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMs: endTime.getTime() - startTime.getTime(),
      tables,
      totalDeleted,
      skippedReason: err.message
    };
  }
}
export async function getRetentionStats() {
  try {
    const database = await getDb();
    if (!database) return { error: "\u6570\u636E\u5E93\u8FDE\u63A5\u4E0D\u53EF\u7528" };
    const stats4 = {};
    const queries = [
      { key: "keywords_amazon_deleted", query: `SELECT COUNT(*) as cnt FROM keywords WHERE keywordStatus = 'amazon_deleted' AND updated_at < DATE_SUB(NOW(), INTERVAL ${RETENTION_CONFIG.deletedEntityRetentionDays} DAY)` },
      { key: "keywords_archived", query: `SELECT COUNT(*) as cnt FROM keywords WHERE keywordStatus = 'archived' AND updated_at < DATE_SUB(NOW(), INTERVAL 60 DAY)` },
      { key: "product_targets_amazon_deleted", query: `SELECT COUNT(*) as cnt FROM product_targets WHERE targetStatus = 'amazon_deleted' AND updated_at < DATE_SUB(NOW(), INTERVAL ${RETENTION_CONFIG.deletedEntityRetentionDays} DAY)` },
      { key: "product_targets_archived", query: `SELECT COUNT(*) as cnt FROM product_targets WHERE targetStatus = 'archived' AND updated_at < DATE_SUB(NOW(), INTERVAL 60 DAY)` },
      { key: "optimization_tasks_completed", query: `SELECT COUNT(*) as cnt FROM optimization_tasks WHERE status IN ('synced', 'permanently_failed') AND created_at < DATE_SUB(NOW(), INTERVAL ${RETENTION_CONFIG.completedTaskRetentionDays} DAY)` },
      { key: "bidding_logs_expired", query: `SELECT COUNT(*) as cnt FROM bidding_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ${RETENTION_CONFIG.biddingLogRetentionDays} DAY)` },
      { key: "sync_conflicts_expired", query: `SELECT COUNT(*) as cnt FROM sync_conflicts WHERE created_at < DATE_SUB(NOW(), INTERVAL ${RETENTION_CONFIG.syncConflictRetentionDays} DAY)` },
      { key: "system_logs_expired", query: `SELECT COUNT(*) as cnt FROM system_logs WHERE timestamp < DATE_SUB(NOW(), INTERVAL ${RETENTION_CONFIG.systemLogRetentionDays} DAY)` }
    ];
    for (const { key, query } of queries) {
      try {
        const [rows] = await database.execute(sql.raw(query));
        stats4[key] = rows?.[0]?.cnt || 0;
      } catch {
        stats4[key] = "error";
      }
    }
    stats4.retentionConfig = RETENTION_CONFIG;
    return stats4;
  } catch (err) {
    return { error: err.message };
  }
}
var import_v8, log65, RETENTION_CONFIG;
