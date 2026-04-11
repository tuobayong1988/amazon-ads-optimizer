// Extracted from production dist/index.js
// Original module: server/sync/reportSemaphore.ts
// Lines: 308

var reportSemaphore_exports = {};
__export(reportSemaphore_exports, {
  acquireReportSemaphore: () => acquireReportSemaphore,
  getReportSemaphoreStatus: () => getReportSemaphoreStatus,
  releaseReportSemaphore: () => releaseReportSemaphore,
  resetReportSemaphore: () => resetReportSemaphore
});
function startLeakDetection() {
  if (leakDetectionTimer) return;
  leakDetectionTimer = setInterval(() => {
    const now = Date.now();
    for (const [accountId, slot] of activeSlots.entries()) {
      const holdTime = now - slot.acquiredAt;
      if (holdTime > DEFAULT_CONFIG5.leakDetectionMs) {
        log78.warn(`[ReportSemaphore] v614i-fix23: \u4FE1\u53F7\u91CF\u6CC4\u6F0F\u68C0\u6D4B - \u8D26\u6237 ${accountId} \u6301\u6709 ${Math.round(holdTime / 1e3)}s (\u6B65\u9AA4: ${slot.stepName})\uFF0C\u81EA\u52A8\u56DE\u6536`);
        activeSlots.delete(accountId);
        stats2.leakedSlotsRecovered++;
        processWaitQueue();
      }
    }
  }, 60 * 1e3);
}
function calculatePriorityScore(campaignCount, isManualSync, waitTimeMs = 0) {
  let score = campaignCount;
  if (isManualSync) {
    score -= DEFAULT_CONFIG5.manualSyncPriorityBoost;
    stats2.manualSyncFastTracked++;
  }
  const waitMinutes = waitTimeMs / 6e4;
  score -= waitMinutes * 10;
  return score;
}
function getEffectiveConcurrency(isXL) {
  if (isXL) {
    return { current: countActiveXL(), max: DEFAULT_CONFIG5.maxConcurrentXL };
  }
  const adjustment = dynamicState.concurrencyAdjustment;
  const max2 = Math.max(3, DEFAULT_CONFIG5.maxConcurrentNormal + adjustment);
  return { current: countActiveNormal(), max: max2 };
}
function countActiveXL() {
  let count11 = 0;
  for (const slot of activeSlots.values()) {
    if (slot.isXL) count11++;
  }
  return count11;
}
function countActiveNormal() {
  let count11 = 0;
  for (const slot of activeSlots.values()) {
    if (!slot.isXL) count11++;
  }
  return count11;
}
async function acquireReportSemaphore(accountId, campaignCount = 0, stepName = "unknown", heartbeatCallback, isManualSync = false) {
  const config2 = DEFAULT_CONFIG5;
  const isXL = campaignCount >= config2.xlThreshold;
  if (activeSlots.has(accountId)) {
    log78.debug(`[ReportSemaphore] \u8D26\u6237 ${accountId} \u5DF2\u6301\u6709\u4FE1\u53F7\u91CF\uFF0C\u6B65\u9AA4 ${stepName} \u76F4\u63A5\u901A\u8FC7`);
    return true;
  }
  const { current, max: max2 } = getEffectiveConcurrency(isXL);
  if (current < max2) {
    activeSlots.set(accountId, {
      accountId,
      acquiredAt: Date.now(),
      stepName,
      campaignCount,
      isXL
    });
    stats2.totalAcquired++;
    const tier3 = isXL ? "XL" : "Normal";
    log78.info(`[ReportSemaphore] v614i-fix23: \u8D26\u6237 ${accountId}(${tier3}) \u83B7\u53D6\u62A5\u544A\u4FE1\u53F7\u91CF [${current + 1}/${max2}]\uFF0C\u6B65\u9AA4: ${stepName}\uFF0C\u603B\u6D3B\u8DC3: ${activeSlots.size}\uFF0C\u7B49\u5F85\u961F\u5217: ${waitQueue.length}` + (isManualSync ? " [\u624B\u52A8\u540C\u6B65VIP]" : ""));
    return true;
  }
  const waitStart = Date.now();
  const tier2 = isXL ? "XL" : "Normal";
  log78.info(`[ReportSemaphore] v614i-fix23: \u8D26\u6237 ${accountId}(${tier2}) \u6392\u961F\u7B49\u5F85\u62A5\u544A\u4FE1\u53F7\u91CF\uFF0C\u5F53\u524D${tier2}\u5360\u7528: ${current}/${max2}\uFF0C\u603B\u6D3B\u8DC3: ${activeSlots.size}\uFF0C\u961F\u5217\u4F4D\u7F6E: ${waitQueue.length + 1}` + (isManualSync ? " [\u624B\u52A8\u540C\u6B65VIP - \u4F18\u5148\u6392\u961F]" : ""));
  return new Promise((resolve) => {
    const priorityScore = calculatePriorityScore(campaignCount, isManualSync);
    const waiter = {
      accountId,
      campaignCount,
      isManualSync,
      priorityScore,
      resolve: /* @__PURE__ */ __name(() => {
        const waitTime = Date.now() - waitStart;
        stats2.totalWaitTimeMs += waitTime;
        stats2.maxWaitTimeMs = Math.max(stats2.maxWaitTimeMs, waitTime);
        activeSlots.set(accountId, {
          accountId,
          acquiredAt: Date.now(),
          stepName,
          campaignCount,
          isXL
        });
        stats2.totalAcquired++;
        const { current: newCurrent, max: newMax } = getEffectiveConcurrency(isXL);
        log78.info(`[ReportSemaphore] v614i-fix23: \u8D26\u6237 ${accountId}(${tier2}) \u7B49\u5F85 ${(waitTime / 1e3).toFixed(0)}s \u540E\u83B7\u53D6\u62A5\u544A\u4FE1\u53F7\u91CF [${newCurrent}/${newMax}]\uFF0C\u5269\u4F59\u961F\u5217: ${waitQueue.length}` + (isManualSync ? " [\u624B\u52A8\u540C\u6B65VIP]" : ""));
        resolve(true);
      }, "resolve"),
      enqueuedAt: waitStart
    };
    if (heartbeatCallback) {
      waiter.heartbeatTimer = setInterval(async () => {
        try {
          await heartbeatCallback();
          waiter.priorityScore = calculatePriorityScore(campaignCount, isManualSync, Date.now() - waitStart);
          const waitSec = Math.round((Date.now() - waitStart) / 1e3);
          log78.info(`[ReportSemaphore] v614i-fix23: \u8D26\u6237 ${accountId} \u4FE1\u53F7\u91CF\u7B49\u5F85\u5FC3\u8DF3 (\u5DF2\u7B49\u5F85 ${waitSec}s)\uFF0C\u961F\u5217\u4F4D\u7F6E: ${waitQueue.indexOf(waiter) + 1}/${waitQueue.length}`);
        } catch (err) {
          log78.warn(`[ReportSemaphore] v614i-fix23: \u8D26\u6237 ${accountId} \u5FC3\u8DF3\u56DE\u8C03\u5931\u8D25: ${err.message}`);
        }
      }, config2.heartbeatIntervalMs);
    }
    let insertIndex = waitQueue.length;
    for (let i = 0; i < waitQueue.length; i++) {
      if (priorityScore < waitQueue[i].priorityScore) {
        insertIndex = i;
        break;
      }
    }
    waitQueue.splice(insertIndex, 0, waiter);
    stats2.maxQueueLength = Math.max(stats2.maxQueueLength, waitQueue.length);
    const timeout = setTimeout(() => {
      const idx = waitQueue.indexOf(waiter);
      if (idx >= 0) {
        waitQueue.splice(idx, 1);
        if (waiter.heartbeatTimer) {
          clearInterval(waiter.heartbeatTimer);
          waiter.heartbeatTimer = void 0;
        }
        stats2.totalTimeouts++;
        const waitTime = Date.now() - waitStart;
        log78.warn(`[ReportSemaphore] v614i-fix23: \u8D26\u6237 ${accountId}(${tier2}) \u7B49\u5F85\u4FE1\u53F7\u91CF\u8D85\u65F6 (${(waitTime / 1e3).toFixed(0)}s)\uFF0C\u964D\u7EA7\u4E3A\u65E0\u9650\u5236\u6A21\u5F0F`);
        resolve(false);
      }
    }, config2.maxWaitTimeMs);
    const originalResolve = waiter.resolve;
    waiter.resolve = () => {
      clearTimeout(timeout);
      if (waiter.heartbeatTimer) {
        clearInterval(waiter.heartbeatTimer);
        waiter.heartbeatTimer = void 0;
      }
      originalResolve();
    };
  });
}
function releaseReportSemaphore(accountId) {
  const slot = activeSlots.get(accountId);
  if (!slot) {
    log78.debug(`[ReportSemaphore] \u8D26\u6237 ${accountId} \u672A\u6301\u6709\u4FE1\u53F7\u91CF\uFF0C\u5FFD\u7565\u91CA\u653E`);
    return;
  }
  const holdTime = Date.now() - slot.acquiredAt;
  activeSlots.delete(accountId);
  stats2.totalReleased++;
  dynamicState.recentCompletionTimes.push(holdTime);
  if (dynamicState.recentCompletionTimes.length > 20) {
    dynamicState.recentCompletionTimes.shift();
  }
  adjustDynamicConcurrency();
  const tier2 = slot.isXL ? "XL" : "Normal";
  const { current, max: max2 } = getEffectiveConcurrency(slot.isXL);
  log78.info(`[ReportSemaphore] v614i-fix23: \u8D26\u6237 ${accountId}(${tier2}) \u91CA\u653E\u62A5\u544A\u4FE1\u53F7\u91CF\uFF0C\u6301\u6709 ${(holdTime / 1e3).toFixed(0)}s\uFF0C[${current}/${max2}]\uFF0C\u7B49\u5F85\u961F\u5217: ${waitQueue.length}`);
  processWaitQueue();
}
function adjustDynamicConcurrency() {
  const now = Date.now();
  if (now - dynamicState.lastAdjustmentTime < 5 * 60 * 1e3) return;
  if (dynamicState.recentCompletionTimes.length < 5) return;
  const avgTime = dynamicState.recentCompletionTimes.reduce((a, b) => a + b, 0) / dynamicState.recentCompletionTimes.length;
  const avgMinutes = avgTime / 6e4;
  let newAdjustment = dynamicState.concurrencyAdjustment;
  if (avgMinutes < 3 && newAdjustment < 6) {
    newAdjustment = Math.min(6, newAdjustment + 2);
    log78.info(`[ReportSemaphore] v614i-fix23: \u52A8\u6001\u5E76\u53D1\u4E0A\u8C03 \u2192 ${DEFAULT_CONFIG5.maxConcurrentNormal + newAdjustment} (\u5E73\u5747\u5B8C\u6210\u65F6\u95F4: ${avgMinutes.toFixed(1)}min)`);
  } else if (avgMinutes > 10 && newAdjustment > -3) {
    newAdjustment = Math.max(-3, newAdjustment - 2);
    log78.info(`[ReportSemaphore] v614i-fix23: \u52A8\u6001\u5E76\u53D1\u4E0B\u8C03 \u2192 ${DEFAULT_CONFIG5.maxConcurrentNormal + newAdjustment} (\u5E73\u5747\u5B8C\u6210\u65F6\u95F4: ${avgMinutes.toFixed(1)}min)`);
  }
  dynamicState.concurrencyAdjustment = newAdjustment;
  dynamicState.lastAdjustmentTime = now;
}
function processWaitQueue() {
  if (waitQueue.length === 0) return;
  waitQueue.sort((a, b) => {
    const scoreA = calculatePriorityScore(a.campaignCount, a.isManualSync, Date.now() - a.enqueuedAt);
    const scoreB = calculatePriorityScore(b.campaignCount, b.isManualSync, Date.now() - b.enqueuedAt);
    return scoreA - scoreB;
  });
  let i = 0;
  while (i < waitQueue.length) {
    const waiter = waitQueue[i];
    const isXL = waiter.campaignCount >= DEFAULT_CONFIG5.xlThreshold;
    const { current, max: max2 } = getEffectiveConcurrency(isXL);
    if (current < max2) {
      waitQueue.splice(i, 1);
      waiter.resolve();
    } else {
      i++;
    }
  }
}
function getReportSemaphoreStatus() {
  const now = Date.now();
  const normalConcurrency = getEffectiveConcurrency(false);
  const xlConcurrency = getEffectiveConcurrency(true);
  const avgCompletionTime = dynamicState.recentCompletionTimes.length > 0 ? dynamicState.recentCompletionTimes.reduce((a, b) => a + b, 0) / dynamicState.recentCompletionTimes.length / 1e3 : 0;
  return {
    activeCount: activeSlots.size,
    maxConcurrent: DEFAULT_CONFIG5.maxConcurrentNormal + DEFAULT_CONFIG5.maxConcurrentXL,
    queueLength: waitQueue.length,
    activeAccounts: Array.from(activeSlots.values()).map((s) => ({
      accountId: s.accountId,
      stepName: s.stepName,
      holdTimeSec: Math.round((now - s.acquiredAt) / 1e3),
      tier: s.isXL ? "XL" : "Normal"
    })),
    stats: { ...stats2 },
    tiers: {
      normal: { active: normalConcurrency.current, max: normalConcurrency.max },
      xl: { active: xlConcurrency.current, max: xlConcurrency.max }
    },
    dynamicConcurrency: {
      adjustment: dynamicState.concurrencyAdjustment,
      effectiveNormalMax: normalConcurrency.max,
      avgCompletionTimeSec: Math.round(avgCompletionTime)
    }
  };
}
function resetReportSemaphore() {
  const activeCount = activeSlots.size;
  const queueCount = waitQueue.length;
  activeSlots.clear();
  while (waitQueue.length > 0) {
    const waiter = waitQueue.shift();
    if (waiter) {
      if (waiter.heartbeatTimer) {
        clearInterval(waiter.heartbeatTimer);
        waiter.heartbeatTimer = void 0;
      }
      waiter.resolve();
    }
  }
  dynamicState.recentCompletionTimes.length = 0;
  dynamicState.concurrencyAdjustment = 0;
  dynamicState.lastAdjustmentTime = 0;
  if (activeCount > 0 || queueCount > 0) {
    log78.info(`[ReportSemaphore] v614i-fix23: \u4FE1\u53F7\u91CF\u91CD\u7F6E\uFF0C\u6E05\u7406 ${activeCount} \u4E2A\u6D3B\u8DC3\u69FD\u4F4D\u548C ${queueCount} \u4E2A\u7B49\u5F85\u8005`);
  }
}
var log78, DEFAULT_CONFIG5, activeSlots, waitQueue, dynamicState, stats2, leakDetectionTimer;
var init_reportSemaphore = __esm({
  "server/sync/reportSemaphore.ts"() {
    "use strict";
    init_logger();
    log78 = createModuleLogger("ReportSemaphore");
    DEFAULT_CONFIG5 = {
      maxConcurrentNormal: parseInt(process.env.MAX_CONCURRENT_REPORT_ACCOUNTS || "10", 10),
      maxConcurrentXL: parseInt(process.env.MAX_CONCURRENT_REPORT_XL || "3", 10),
      xlThreshold: 1e3,
      maxWaitTimeMs: 30 * 60 * 1e3,
      // 30分钟
      checkIntervalMs: 5e3,
      heartbeatIntervalMs: 3 * 60 * 1e3,
      leakDetectionMs: 30 * 60 * 1e3,
      // 30分钟泄漏检测
      manualSyncPriorityBoost: 1e4
      // 手动同步优先级提升
    };
    activeSlots = /* @__PURE__ */ new Map();
    waitQueue = [];
    dynamicState = {
      /** 最近10次报告完成的耗时（毫秒） */
      recentCompletionTimes: [],
      /** 当前动态并发调整值（0表示不调整） */
      concurrencyAdjustment: 0,
      /** 上次调整时间 */
      lastAdjustmentTime: 0
    };
    stats2 = {
      totalAcquired: 0,
      totalReleased: 0,
      totalTimeouts: 0,
      totalWaitTimeMs: 0,
      maxWaitTimeMs: 0,
      maxQueueLength: 0,
      leakedSlotsRecovered: 0,
      manualSyncFastTracked: 0
    };
    leakDetectionTimer = null;
    __name(startLeakDetection, "startLeakDetection");
    startLeakDetection();
    __name(calculatePriorityScore, "calculatePriorityScore");
    __name(getEffectiveConcurrency, "getEffectiveConcurrency");
    __name(countActiveXL, "countActiveXL");
    __name(countActiveNormal, "countActiveNormal");
    __name(acquireReportSemaphore, "acquireReportSemaphore");
    __name(releaseReportSemaphore, "releaseReportSemaphore");
    __name(adjustDynamicConcurrency, "adjustDynamicConcurrency");
    __name(processWaitQueue, "processWaitQueue");
    __name(getReportSemaphoreStatus, "getReportSemaphoreStatus");
    __name(resetReportSemaphore, "resetReportSemaphore");
  }
});

