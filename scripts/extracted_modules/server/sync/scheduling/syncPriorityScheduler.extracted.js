// Extracted from production dist/index.js
// Original module: server/sync/scheduling/syncPriorityScheduler.ts
// Lines: 317

var syncPriorityScheduler_exports = {};
__export(syncPriorityScheduler_exports, {
  calculateAccountPriorities: () => calculateAccountPriorities,
  clearThrottlePause: () => clearThrottlePause,
  evaluateThrottlePause: () => evaluateThrottlePause,
  getConcurrencyStatus: () => getConcurrencyStatus,
  getCurrentBatchDelay: () => getCurrentBatchDelay,
  getCurrentConcurrency: () => getCurrentConcurrency,
  getMaxAccountsForTier: () => getMaxAccountsForTier,
  getThrottlePauseStatus: () => getThrottlePauseStatus,
  recordSuccessEvent: () => recordSuccessEvent,
  recordThrottleEvent: () => recordThrottleEvent,
  resetConcurrencyCounters: () => resetConcurrencyCounters,
  shouldPauseLowPriority: () => shouldPauseLowPriority
});
async function calculateAccountPriorities(accounts, config2 = DEFAULT_CONFIG3) {
  const database = await getDb();
  if (!database) {
    log22.warn("[SyncPriority] v373: \u6570\u636E\u5E93\u4E0D\u53EF\u7528\uFF0C\u4F7F\u7528\u9ED8\u8BA4\u4F18\u5148\u7EA7\u6392\u5E8F");
    return accounts;
  }
  try {
    // v620-fix14: 任务7 - 大账户优先同步策略
    const campaignCounts = /* @__PURE__ */ new Map();
    try {
      const campaignCountResults = await database.execute(
        sql`SELECT accountId, COUNT(*) as cnt 
            FROM campaigns 
            WHERE campaignStatus IN ('enabled', 'paused') 
            GROUP BY accountId`
      );
      const ccRows = campaignCountResults[0] || [];
      for (const row of ccRows) {
        campaignCounts.set(Number(row.accountId), Number(row.cnt));
      }
      const topAccounts = [...campaignCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, cnt]) => `${id}(${cnt})`).join(', ');
      log22.info(`[SyncPriority] v620-fix14: 查询campaign数量完成, ${campaignCounts.size}个账号, TOP5: ${topAccounts}`);
    } catch (err) {
      log22.warn(`[SyncPriority] v620-fix14: 查询campaign数量失败: ${err.message}`);
    }
    const activeTargetCounts = /* @__PURE__ */ new Map();
    try {
      const targetResults = await database.execute(
        sql`SELECT accountId, COUNT(*) as target_count 
            FROM performance_groups 
            WHERE \`status\` = 'active' 
            GROUP BY accountId`
      );
      const rows = targetResults[0] || [];
      for (const row of rows) {
        activeTargetCounts.set(Number(row.accountId), Number(row.target_count));
      }
    } catch (err) {
      log22.warn(`[SyncPriority] v373: \u67E5\u8BE2\u6D3B\u8DC3\u4F18\u5316\u76EE\u6807\u5931\u8D25: ${err.message}`);
    }
    const recentlyActiveAccounts = /* @__PURE__ */ new Set();
    try {
      const activityResults = await database.execute(
        sql`SELECT DISTINCT account_id FROM optimization_logs 
            WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE)
            UNION
            SELECT DISTINCT account_id FROM optimization_events 
            WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE)`
        // @ts-ignore
      );
      const rows = activityResults[0] || [];
      for (const row of rows) {
        recentlyActiveAccounts.add(Number(row.account_id));
      }
    } catch (err) {
      log22.warn(`[SyncPriority] v373: \u67E5\u8BE2\u6700\u8FD1\u7528\u6237\u6D3B\u52A8\u5931\u8D25: ${err.message}`);
    }
    const now = Date.now();
    for (const account of accounts) {
      let score = 0;
      const reasons = [];
      if (!account.lastSyncAt) {
        score += config2.newAccountBonus;
        reasons.push(`\u65B0\u8D26\u53F7+${config2.newAccountBonus}`);
      } else {
        const minutesSinceSync = (now - new Date(account.lastSyncAt).getTime()) / 6e4;
        if (minutesSinceSync > config2.staleSyncThresholdMinutes) {
          const staleBonus = Math.min(
            (minutesSinceSync - config2.staleSyncThresholdMinutes) * config2.staleSyncBonusPerMinute,
            100
            // 最多加100分
          );
          score += staleBonus;
          reasons.push(`\u8FC7\u671F${Math.round(minutesSinceSync)}min+${staleBonus.toFixed(1)}`);
        }
      }
      const targetCount = activeTargetCounts.get(account.accountId) || 0;
      if (targetCount > 0) {
        const targetBonus = Math.min(config2.activeTargetBonus * targetCount, 90);
        score += targetBonus;
        reasons.push(`${targetCount}\u4E2A\u6D3B\u8DC3\u76EE\u6807+${targetBonus}`);
      }
      if (recentlyActiveAccounts.has(account.accountId)) {
        score += config2.recentActivityBonus;
        reasons.push(`\u8FD1\u671F\u6D3B\u8DC3+${config2.recentActivityBonus}`);
      }
      // v620-fix14: 任务7 - 大账户优先同步加分
      const accountCampaignCount = campaignCounts.get(account.accountId) || 0;
      if (accountCampaignCount >= 1000) {
        const largeAccountBonus = 80;
        score += largeAccountBonus;
        reasons.push(`\u5927\u8D26\u6237(${accountCampaignCount}campaigns)+${largeAccountBonus}`);
      } else if (accountCampaignCount >= 500) {
        const mediumAccountBonus = 40;
        score += mediumAccountBonus;
        reasons.push(`\u4E2D\u578B\u8D26\u6237(${accountCampaignCount}campaigns)+${mediumAccountBonus}`);
      } else if (accountCampaignCount >= 200) {
        const smallBonus = 15;
        score += smallBonus;
        reasons.push(`\u6D3B\u8DC3\u8D26\u6237(${accountCampaignCount}campaigns)+${smallBonus}`);
      }
      account.priorityScore = score;
      account.priorityReasons = reasons;
    }
    accounts.sort((a, b) => b.priorityScore - a.priorityScore);
    log22.info(`[SyncPriority] v373: \u4F18\u5148\u7EA7\u8BC4\u5206\u5B8C\u6210\uFF0C${accounts.length}\u4E2A\u8D26\u53F7\uFF0CTOP3: ${accounts.slice(0, 3).map((a) => `${a.accountId}(${a.priorityScore.toFixed(0)}\u5206)`).join(", ")}`);
    return accounts;
  } catch (err) {
    log22.warn(`[SyncPriority] v373: \u4F18\u5148\u7EA7\u8BC4\u5206\u5931\u8D25: ${err.message}`);
    return accounts;
  }
}
function getMaxAccountsForTier(tier2, config2 = DEFAULT_CONFIG3) {
  switch (tier2) {
    case "high":
      return config2.highFreqMaxAccounts;
    case "medium":
      return config2.mediumFreqMaxAccounts;
    case "full":
      return config2.fullSyncMaxAccounts;
    default:
      return config2.fullSyncMaxAccounts;
  }
}
function recordThrottleEvent() {
  concurrencyState.recentThrottleCount++;
  if (concurrencyState.recentThrottleCount >= 3) {
    const oldConcurrency = concurrencyState.currentConcurrency;
    concurrencyState.currentConcurrency = Math.max(
      concurrencyState.minConcurrency,
      Math.floor(concurrencyState.currentConcurrency * 0.7)
      // 降低30%
    );
    concurrencyState.currentBatchDelay = Math.min(
      concurrencyState.maxBatchDelay,
      concurrencyState.currentBatchDelay * 1.5
      // 增加50%延迟
    );
    concurrencyState.recentThrottleCount = 0;
    concurrencyState.lastAdjustTime = /* @__PURE__ */ new Date();
    log22.warn(`[SyncPriority] v373: API\u9650\u6D41\u964D\u7EA7 - \u5E76\u53D1 ${oldConcurrency}\u2192${concurrencyState.currentConcurrency}, \u5EF6\u8FDF ${concurrencyState.currentBatchDelay}ms`);
  }
}
function recordSuccessEvent() {
  concurrencyState.recentSuccessCount++;
  const timeSinceLastAdjust = Date.now() - concurrencyState.lastAdjustTime.getTime();
  if (concurrencyState.recentSuccessCount >= 50 && timeSinceLastAdjust > 5 * 60 * 1e3) {
    const oldConcurrency = concurrencyState.currentConcurrency;
    concurrencyState.currentConcurrency = Math.min(
      concurrencyState.maxConcurrency,
      concurrencyState.currentConcurrency + 1
      // 逐步增加1
    );
    concurrencyState.currentBatchDelay = Math.max(
      concurrencyState.minBatchDelay,
      concurrencyState.currentBatchDelay * 0.9
      // 减少10%延迟
    );
    concurrencyState.recentSuccessCount = 0;
    concurrencyState.recentThrottleCount = 0;
    concurrencyState.lastAdjustTime = /* @__PURE__ */ new Date();
    if (oldConcurrency !== concurrencyState.currentConcurrency) {
      log22.info(`[SyncPriority] v373: API\u6210\u529F\u5347\u7EA7 - \u5E76\u53D1 ${oldConcurrency}\u2192${concurrencyState.currentConcurrency}, \u5EF6\u8FDF ${concurrencyState.currentBatchDelay.toFixed(0)}ms`);
    }
  }
}
function getCurrentConcurrency() {
  return concurrencyState.currentConcurrency;
}
function getCurrentBatchDelay() {
  return Math.round(concurrencyState.currentBatchDelay);
}
function getConcurrencyStatus() {
  return { ...concurrencyState };
}
function resetConcurrencyCounters() {
  concurrencyState.recentThrottleCount = 0;
  concurrencyState.recentSuccessCount = 0;
}
function shouldPauseLowPriority() {
  if (!throttlePauseState.lowPriorityPaused) return false;
  if (Date.now() - throttlePauseState.pausedSince > throttlePauseState.maxPauseDurationMs) {
    throttlePauseState.lowPriorityPaused = false;
    throttlePauseState.consecutiveThrottleEvents = 0;
    log22.info(`[SyncPriority] v614i-fix8: \u4F4E\u4F18\u5148\u7EA7\u4EFB\u52A1\u6682\u505C\u5DF2\u8D85\u65F6\uFF0C\u81EA\u52A8\u6062\u590D`);
    return false;
  }
  return true;
}
function evaluateThrottlePause() {
  throttlePauseState.consecutiveThrottleEvents++;
  if (throttlePauseState.consecutiveThrottleEvents >= throttlePauseState.pauseThreshold && !throttlePauseState.lowPriorityPaused) {
    throttlePauseState.lowPriorityPaused = true;
    throttlePauseState.pausedSince = Date.now();
    log22.warn(`[SyncPriority] v614i-fix8: API\u9650\u6D41\u4E25\u91CD(\u8FDE\u7EED${throttlePauseState.consecutiveThrottleEvents}\u6B21)\uFF0C\u6682\u505C\u4F4E\u4F18\u5148\u7EA7\u4EFB\u52A1${throttlePauseState.maxPauseDurationMs / 6e4}\u5206\u949F\uFF0C\u4F18\u5148\u4FDD\u969C\u5F53\u65E5\u7EE9\u6548\u548C\u7ADE\u4EF7\u8C03\u6574`);
  }
}
function clearThrottlePause() {
  if (throttlePauseState.consecutiveThrottleEvents > 0) {
    throttlePauseState.consecutiveThrottleEvents = 0;
  }
  if (throttlePauseState.lowPriorityPaused && Date.now() - throttlePauseState.pausedSince > 2 * 60 * 1e3) {
    throttlePauseState.lowPriorityPaused = false;
    log22.info(`[SyncPriority] v614i-fix8: \u4F4E\u4F18\u5148\u7EA7\u4EFB\u52A1\u63D0\u524D\u6062\u590D\uFF08\u68C0\u6D4B\u5230\u6210\u529F\u8BF7\u6C42\uFF09`);
  }
}
function getThrottlePauseStatus() {
  return { ...throttlePauseState };
}
var log22, DEFAULT_CONFIG3, concurrencyState, throttlePauseState;
var init_syncPriorityScheduler = __esm({
  "server/sync/scheduling/syncPriorityScheduler.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_drizzle_orm();
    log22 = createModuleLogger("SyncPriority");
    DEFAULT_CONFIG3 = {
      // v395: 提升500租户规模下的同步吞吐量
      // 500租户规模分析（v395优化后）：
      //   高频(15min): 80个账号/周期 → 1000账号需187min(3.1h)轮转一遍
      //   中频(30min): 120个账号/周期 → 1000账号需250min(4.2h)轮转一遍
      //   全量(2h): 200个账号/周期 → 1000账号需10h轮转一遍（每天可完成2.4轮）
      highFreqMaxAccounts: parseInt(process.env.SYNC_HIGH_FREQ_MAX || "80", 10),
      mediumFreqMaxAccounts: parseInt(process.env.SYNC_MEDIUM_FREQ_MAX || "120", 10),
      fullSyncMaxAccounts: parseInt(process.env.SYNC_FULL_MAX || "200", 10),
      staleSyncThresholdMinutes: 30,
      // 30分钟未同步视为过期
      activeTargetBonus: 30,
      // 有活跃优化目标加30分
      recentActivityBonus: 20,
      // 最近有用户操作加20分
      staleSyncBonusPerMinute: 0.5,
      // 每超过1分钟加0.5分
      newAccountBonus: 50
      // 新账号（从未同步）加50分
    };
    concurrencyState = {
      // v399: 默认并发从10→15，与unifiedSyncEngine保持一致
      currentConcurrency: parseInt(process.env.MAX_CONCURRENT_ACCOUNTS || "15", 10),
      minConcurrency: 3,
      maxConcurrency: parseInt(process.env.MAX_CONCURRENT_ACCOUNTS || "15", 10),
      recentThrottleCount: 0,
      recentSuccessCount: 0,
      lastAdjustTime: /* @__PURE__ */ new Date(),
      currentBatchDelay: 200,
      minBatchDelay: 100,
      maxBatchDelay: 2e3
    };
    __name(calculateAccountPriorities, "calculateAccountPriorities");
    __name(getMaxAccountsForTier, "getMaxAccountsForTier");
    __name(recordThrottleEvent, "recordThrottleEvent");
    __name(recordSuccessEvent, "recordSuccessEvent");
    __name(getCurrentConcurrency, "getCurrentConcurrency");
    __name(getCurrentBatchDelay, "getCurrentBatchDelay");
    __name(getConcurrencyStatus, "getConcurrencyStatus");
    __name(resetConcurrencyCounters, "resetConcurrencyCounters");
    throttlePauseState = {
      lowPriorityPaused: false,
      pausedSince: 0,
      maxPauseDurationMs: 10 * 60 * 1e3,
      // 最多暂停10分钟
      consecutiveThrottleEvents: 0,
      pauseThreshold: 5
      // 连续5次限流后暂停低优先级任务
    };
    __name(shouldPauseLowPriority, "shouldPauseLowPriority");
    __name(evaluateThrottlePause, "evaluateThrottlePause");
    __name(clearThrottlePause, "clearThrottlePause");
    __name(getThrottlePauseStatus, "getThrottlePauseStatus");
  }
});

// node_modules/@trpc/server/dist/index.mjs
var dist_exports = {};
__export(dist_exports, {
  StandardSchemaV1Error: () => StandardSchemaV1Error,
  TRPCError: () => TRPCError,
  callTRPCProcedure: () => callProcedure,
  createTRPCFlatProxy: () => createFlatProxy,
  createTRPCRecursiveProxy: () => createRecursiveProxy,
  experimental_lazy: () => lazy,
  experimental_standaloneMiddleware: () => experimental_standaloneMiddleware,
  experimental_trpcMiddleware: () => experimental_standaloneMiddleware,
  getErrorShape: () => getErrorShape,
  getTRPCErrorFromUnknown: () => getTRPCErrorFromUnknown,
  getTRPCErrorShape: () => getErrorShape,
  initTRPC: () => initTRPC,
  isTrackedEnvelope: () => isTrackedEnvelope,
  lazy: () => lazy,
  sse: () => sse,
  tracked: () => tracked,
  transformTRPCResponse: () => transformTRPCResponse
});
var init_dist = __esm({
  "node_modules/@trpc/server/dist/index.mjs"() {
    init_getErrorShape_vC8mUXJD();
    init_tracked_DiE3uR1B();
    init_initTRPC_B1ggxyJl();
  }
});

