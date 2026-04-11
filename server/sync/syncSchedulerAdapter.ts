/**
 * server/sync/syncSchedulerAdapter.ts
 * 
 * Auto-converted from production bundle to TypeScript source.
 * Version: v621147 (production)
 */

import { getDb } from '../db';
import { sql } from 'drizzle-orm';

export function isRedisQueueEnabled() {
  const envFlag = process.env.REDIS_QUEUE_ENABLED;
  if (envFlag === "true") return true;
  if (envFlag === "false") return false;
  return isRedisAvailable();
}
export async function enqueueSyncTier(tier2) {
  const result = {
    success: false,
    totalAccounts: 0,
    enqueued: 0,
    skipped: 0,
    mode: "direct"
  };
  if (!isRedisQueueEnabled()) {
    log143.debug(`[v580] Redis\u961F\u5217\u672A\u542F\u7528\uFF0Ctier=${tier2} \u5C06\u4F7F\u7528\u76F4\u63A5\u6267\u884C\u6A21\u5F0F`);
    result.mode = "direct";
    return result;
  }
  try {
    const accounts = await getActiveAccounts();
    result.totalAccounts = accounts.length;
    if (accounts.length === 0) {
      log143.info(`[v580] \u65E0\u6D3B\u8DC3\u8D26\u6237\u9700\u8981\u540C\u6B65\uFF0Ctier=${tier2}`);
      result.success = true;
      result.mode = "redis";
      return result;
    }
    const queueStatus = await getQueueStatus();
    const totalPending = queueStatus.high + queueStatus.medium + queueStatus.low + queueStatus.nightly;
    // v619: Dynamic backpressure - consider both pending and processing tasks
    // Allow up to 1.5x accounts + processing tasks as threshold
    const backpressureThreshold = Math.max(accounts.length * 1.5, 10) + queueStatus.processing;
    if (totalPending > backpressureThreshold) {
      log143.warn(`[v619] \u961F\u5217\u79EF\u538B(${totalPending}/${Math.round(backpressureThreshold)}\u4E2A\u4EFB\u52A1, processing=${queueStatus.processing})\uFF0C\u8DF3\u8FC7\u672C\u6B21 ${tier2} \u5C42\u5165\u961F`);
      result.success = true;
      result.mode = "redis";
      return result;
    }
    const priority = tierToPriority(tier2);
    const tasks = accounts.map((account) => ({
      id: `${tier2}-${account.id}-${Date.now().toString(36)}-${(0, import_crypto5.randomUUID)().substring(0, 8)}`,
      accountId: account.id,
      syncType: tier2,
      priority,
      tier: tier2,
      triggerSource: "auto",
      maxRetries: 3,
      payload: {
        accountName: account.accountName,
        marketplace: account.marketplace
      }
    }));
    const batchResult = await enqueueBatch(tasks);
    result.enqueued = batchResult.enqueued;
    result.skipped = batchResult.skipped;
    result.success = true;
    result.mode = "redis";
    log143.info(
      `[v580] ${tier2}\u5C42\u540C\u6B65\u4EFB\u52A1\u5DF2\u5165\u961F: ${batchResult.enqueued}/${accounts.length}\u4E2A\u8D26\u6237, ${batchResult.skipped}\u4E2A\u8DF3\u8FC7(\u53BB\u91CD), priority=${priority}`
    );
  } catch (e) {
    log143.warn(`[v580] ${tier2}\u5C42\u5165\u961F\u5931\u8D25: ${e.message}\uFF0C\u5C06\u56DE\u9000\u5230\u76F4\u63A5\u6267\u884C`);
    result.mode = "direct";
  }
  return result;
}
export async function enqueueManualSync(accountId, tier2 = "full") {
  const taskId = `manual-${tier2}-${accountId}-${Date.now().toString(36)}`;
  if (!isRedisQueueEnabled()) {
    return { success: false, taskId };
  }
  const task = {
    id: taskId,
    accountId,
    syncType: tier2,
    priority: "high",
    // 手动触发的任务使用高优先级
    tier: tier2,
    triggerSource: "manual",
    maxRetries: 2
  };
  const enqueued = await enqueueTask(task);
  if (enqueued) {
    log143.info(`[v580] \u624B\u52A8\u540C\u6B65\u4EFB\u52A1\u5DF2\u5165\u961F: account=${accountId}, tier=${tier2}, id=${taskId}`);
  }
  return { success: enqueued, taskId };
}
function tierToPriority(tier2) {
  switch (tier2) {
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "full":
      return "low";
    case "nightly":
      return "nightly";
    default:
      return "medium";
  }
}
async function getActiveAccounts() {
  try {
    const db = await getDb();
    if (!db) return [];
    const result = await db.execute(sql`
      SELECT id, account_name as accountName, marketplace
      FROM ad_accounts
      WHERE status = 'active'
        AND access_token IS NOT NULL
        AND access_token != ''
      ORDER BY id
    `);
    const rows = Array.isArray(result) ? result[0] : result.rows || result;
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => ({
      id: row.id,
      accountName: row.accountName || `Account-${row.id}`,
      marketplace: row.marketplace || "US"
    }));
  } catch (e) {
    log143.warn(`[v580] \u83B7\u53D6\u6D3B\u8DC3\u8D26\u6237\u5931\u8D25: ${e.message}`);
    return [];
  }
}
var import_crypto5, log143;
