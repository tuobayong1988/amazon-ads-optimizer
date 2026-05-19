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
    skippedRecently: 0, // v659: 跟踪因近期已同步而跳过的账户数
    mode: "direct"
  };
  if (!isRedisQueueEnabled()) {
    log143.debug(`[v580] Redis\u961F\u5217\u672A\u542F\u7528\uFF0Ctier=${tier2} \u5C06\u4F7F\u7528\u76F4\u63A5\u6267\u884C\u6A21\u5F0F`);
    result.mode = "direct";
    return result;
  }
  try {
    let accounts = await getActiveAccounts();
    
    // v659: full层添加per-account 24小时频率控制
    // 如果账户在过24小时内已成功完成全量同步，则跳过
    if (tier2 === 'full' || tier2 === 'nightly') {
      const eligibleAccounts = [];
      let skippedRecently = 0;
      for (const account of accounts) {
        const recentlysynced = await hasRecentFullSync(account.id, 24);
        if (recentlysynced) {
          skippedRecently++;
        } else {
          eligibleAccounts.push(account);
        }
      }
      result.skippedRecently = skippedRecently;
      if (skippedRecently > 0) {
        log143.info(`[v659] ${tier2}层: ${skippedRecently}个账户近24h内已同步，跳过；${eligibleAccounts.length}个账户需要同步`);
      }
      accounts = eligibleAccounts;
      
      // v659: 按账户大小排序（小账户先入队，错峰出发）
      // 这样小账户快速完成后，大账户可以独占资源
      accounts = await sortAccountsBySize(accounts);
    }
    
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
// v659: 检查账户在指定小时内是否已成功完成全量同步
async function hasRecentFullSync(accountId: number, hoursThreshold: number): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    const cutoff = new Date(Date.now() - hoursThreshold * 60 * 60 * 1000).toISOString();
    const result = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM data_sync_jobs
      WHERE account_id = ${accountId}
        AND tier = 'full'
        AND status = 'completed'
        AND completed_at > ${cutoff}
    `);
    // @ts-ignore - dynamic query result
    const rows = Array.isArray(result) ? result[0] : result.rows || result;
    // @ts-ignore - dynamic query result
    const cnt = Array.isArray(rows) && rows.length > 0 ? Number(rows[0].cnt || rows[0].CNT || 0) : 0;
    return cnt > 0;
  } catch (e) {
    // 查询失败时保守处理：允许同步（宁可多同步不可漏同步）
    return false;
  }
}

// v659: 按账户大小排序（小账户先入队，错峰出发）
async function sortAccountsBySize(accounts: Array<{id: number; accountName: string; marketplace: string}>): Promise<Array<{id: number; accountName: string; marketplace: string}>> {
  try {
    const db = await getDb();
    if (!db) return accounts;
    // 查询每个账户的广告活动数量作为大小指标
    const accountIds = accounts.map(a => a.id);
    if (accountIds.length === 0) return accounts;
    const sizeResult = await db.execute(sql`
      SELECT account_id, COUNT(*) as campaign_count
      FROM campaigns
      WHERE account_id IN (${sql.join(accountIds.map(id => sql`${id}`), sql`, `)})
      GROUP BY account_id
    `);
    // @ts-ignore - dynamic query result
    const rows = Array.isArray(sizeResult) ? sizeResult[0] : sizeResult.rows || sizeResult;
    const sizeMap = new Map<number, number>();
    if (Array.isArray(rows)) {
      for (const row of rows) {
        // @ts-ignore - dynamic query result
        sizeMap.set(Number(row.account_id), Number(row.campaign_count || 0));
      }
    }
    // 按广告活动数量升序排列（小账户先跑）
    return accounts.sort((a, b) => (sizeMap.get(a.id) || 0) - (sizeMap.get(b.id) || 0));
  } catch (e) {
    // 排序失败不影响正常流程
    return accounts;
  }
}

var import_crypto5, log143;
