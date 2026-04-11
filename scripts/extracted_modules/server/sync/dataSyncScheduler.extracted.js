// Extracted from production dist/index.js
// Original module: server/sync/dataSyncScheduler.ts
// Lines: 1952

var dataSyncScheduler_exports = {};
__export(dataSyncScheduler_exports, {
  OPTIMIZATION_SCHEDULE: () => OPTIMIZATION_SCHEDULE,
  SYNC_TIER_CONFIG: () => SYNC_TIER_CONFIG,
  acquireAccountOptimizationLock: () => acquireAccountOptimizationLock2,
  acquireAccountOptimizationLockWithRetry: () => acquireAccountOptimizationLockWithRetry2,
  deleteSyncSchedule: () => deleteSyncSchedule3,
  frequencyToMs: () => frequencyToMs,
  getModuleLockGroup: () => getModuleLockGroup2,
  getSchedulerStatus: () => getSchedulerStatus3,
  getSyncHealthStatus: () => getSyncHealthStatus,
  getSyncQueueStatus: () => getSyncQueueStatus,
  getSyncSchedule: () => getSyncSchedule,
  isSyncRunning: () => isSyncRunning,
  recordModuleExecution: () => recordModuleExecution,
  releaseAccountOptimizationLock: () => releaseAccountOptimizationLock2,
  startDataSyncScheduler: () => startDataSyncScheduler,
  startOptimizationScheduler: () => startOptimizationScheduler2,
  stopDataSyncScheduler: () => stopDataSyncScheduler,
  stopOptimizationScheduler: () => stopOptimizationScheduler2,
  triggerImmediateSync: () => triggerImmediateSync,
  triggerManualSync: () => triggerManualSync,
  upsertSyncSchedule: () => upsertSyncSchedule,
  withExponentialBackoff: () => withExponentialBackoff
});
function getSchedulerStatus3() {
  return { ...schedulerStatus2 };
}
async function startDataSyncScheduler(defaultIntervalMs = 60 * 60 * 1e3) {
  if (schedulerStatus2.isRunning) {
    log148.info("[DataSyncScheduler] \u5B9A\u65F6\u540C\u6B65\u8C03\u5EA6\u5668\u5DF2\u5728\u8FD0\u884C\u4E2D");
    return;
  }
  schedulerStatus2.isRunning = true;
  log148.info("[DataSyncScheduler] v384: \u5355\u5B9E\u4F8B\u6A21\u5F0F\uFF0C\u76F4\u63A5\u542F\u52A8\u6240\u6709\u8C03\u5EA6\u5668...");
  logSystem("DataSyncScheduler", "v384: \u5355\u5B9E\u4F8B\u6A21\u5F0F\u542F\u52A8\u6240\u6709\u8C03\u5EA6\u5668");
  startSchedulerTasks(defaultIntervalMs);
  startOptimizationScheduler2();
  log148.info("[DataSyncScheduler] v384: \u4F18\u5316\u8C03\u5EA6\u5668\u5DF2\u542F\u52A8");
  try {
    const { startSelfHealing: startSelfHealing2 } = await Promise.resolve().then(() => (init_selfHealingScheduler(), selfHealingScheduler_exports));
    startSelfHealing2();
    log148.info("[DataSyncScheduler] v384: \u81EA\u6108\u8C03\u5EA6\u5668\u5DF2\u542F\u52A8");
  } catch (healErr) {
    log148.warn(`[DataSyncScheduler] v384: \u81EA\u6108\u8C03\u5EA6\u5668\u542F\u52A8\u5931\u8D25: ${healErr.message}`);
  }
  log148.info(`[DataSyncScheduler] v384: \u6240\u6709\u8C03\u5EA6\u5668\u5DF2\u542F\u52A8\u5B8C\u6210`);
  try {
    const { startPendingEventProcessor: startPendingEventProcessor2 } = (init_pendingEventProcessor(), __toCommonJS(pendingEventProcessor_exports));
    startPendingEventProcessor2();
    log148.info("[DataSyncScheduler] v550-patch: Pending Event Processor \u5DF2\u542F\u52A8\uFF0830\u79D2\u95F4\u9694\u81EA\u52A8\u5904\u7406pending events\uFF09");
  } catch (v550Err) {
    log148.warn(`[DataSyncScheduler] v550-patch: \u542F\u52A8\u5931\u8D25: ${v550Err.message}`);
  }
}
function stopSchedulerTasks() {
  Object.keys(schedulerIntervals).forEach((tier2) => {
    const interval = schedulerIntervals[tier2];
    if (interval) {
      clearInterval(interval);
      schedulerIntervals[tier2] = null;
    }
  });
  for (const timer of monitoringIntervals) {
    clearInterval(timer);
  }
  monitoringIntervals.length = 0;
  schedulerStatus2.currentTier = null;
}
async function startSchedulerTasks(defaultIntervalMs) {
  (async () => {
    try {
      const { cleanupStaleJobs: cleanupStaleJobs2, cleanupOrphanedPendingJobs: cleanupOrphanedPendingJobs2 } = await Promise.resolve().then(() => (init_dataSyncService(), dataSyncService_exports));
      const staleResult = await cleanupStaleJobs2(30);
      const orphanResult = await cleanupOrphanedPendingJobs2(60);
      if (staleResult.cleaned > 0 || orphanResult.cleaned > 0) {
        log148.warn(`[DataSyncScheduler] v335: \u542F\u52A8\u6E05\u7406\u5B8C\u6210 - \u5361\u6B7B\u4EFB\u52A1: ${staleResult.cleaned}\u4E2A (${staleResult.jobIds.join(",")}), \u5B64\u513F\u4EFB\u52A1: ${orphanResult.cleaned}\u4E2A`);
        logSystem("DataSyncScheduler", "v335\u542F\u52A8\u65F6\u5361\u6B7B\u4EFB\u52A1\u6E05\u7406", { staleCleaned: staleResult.cleaned, orphanCleaned: orphanResult.cleaned, staleJobIds: staleResult.jobIds });
      }
    } catch (cleanupErr) {
      log148.warn(`[DataSyncScheduler] v335: \u542F\u52A8\u6E05\u7406\u5931\u8D25: ${cleanupErr.message}`);
    }
  })();
  log148.info("[DataSyncScheduler] v371: Leader\u542F\u52A8\u7EDF\u4E00\u540C\u6B65\u5F15\u64CE\u9A71\u52A8\u7684\u5206\u5C42\u540C\u6B65\u8C03\u5EA6\u5668...");
  logSystem("DataSyncScheduler", "v371 Leader\u542F\u52A8\u540C\u6B65\u8C03\u5EA6\u5668", { defaultIntervalMs, mode: "unified_engine" });
  schedulerIntervals.high = setInterval(async () => {
    await executeUnifiedSync("high");
  }, SYNC_TIER_CONFIG.high.intervalMs);
  log148.info(`[DataSyncScheduler] v219: \u9AD8\u9891\u540C\u6B65\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: ${SYNC_TIER_CONFIG.high.intervalMs / 1e3 / 60} \u5206\u949F`);
  schedulerIntervals.medium = setInterval(async () => {
    await executeUnifiedSync("medium");
  }, SYNC_TIER_CONFIG.medium.intervalMs);
  log148.info(`[DataSyncScheduler] v219: \u4E2D\u9891\u540C\u6B65\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: ${SYNC_TIER_CONFIG.medium.intervalMs / 1e3 / 60} \u5206\u949F`);
  schedulerIntervals.full = setInterval(async () => {
    await executeUnifiedSync("full");
  }, defaultIntervalMs);
  schedulerStatus2.nextRunTime = new Date(Date.now() + defaultIntervalMs);
  log148.info(`[DataSyncScheduler] v219: \u5B8C\u6574\u540C\u6B65\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: ${defaultIntervalMs / 1e3 / 60} \u5206\u949F`);
  const nightlyDelayMs = (() => {
    const now = /* @__PURE__ */ new Date();
    const nextNightly = new Date(now);
    nextNightly.setUTCHours(10, 0, 0, 0);
    if (nextNightly.getTime() <= now.getTime()) {
      nextNightly.setDate(nextNightly.getDate() + 1);
    }
    return nextNightly.getTime() - now.getTime();
  })();
  setTimeout(() => {
    log148.info("[DataSyncScheduler] v406: \u591C\u95F4\u540C\u6B65\u9996\u6B21\u6267\u884C\uFF08PST\u51CC\u66682\u70B9 = UTC 10:00\uFF09...");
    executeUnifiedSync("nightly");
    schedulerIntervals.nightly = setInterval(async () => {
      log148.info("[DataSyncScheduler] v406: \u591C\u95F4\u540C\u6B65\u5B9A\u65F6\u6267\u884C\uFF08PST\u51CC\u66682\u70B9\uFF09...");
      await executeUnifiedSync("nightly");
    }, 24 * 60 * 60 * 1e3);
  }, nightlyDelayMs);
  log148.info(`[DataSyncScheduler] v406: \u591C\u95F4\u540C\u6B65\u5DF2\u8C03\u5EA6\uFF0C\u9996\u6B21\u6267\u884C\u5C06\u5728 ${Math.round(nightlyDelayMs / 1e3 / 60)} \u5206\u949F\u540E\uFF08PST\u51CC\u66682\u70B9 = UTC 10:00\uFF09`);
  setTimeout(async () => {
    log148.info("[DataSyncScheduler] v336: \u542F\u52A8\u540E\u9996\u6B21\u9AD8\u9891\u540C\u6B65\uFF0830\u79D2\u5EF6\u8FDF\uFF09...");
    await executeUnifiedSync("high");
    log148.info("[DataSyncScheduler] v336: \u542F\u52A8\u540E\u9996\u6B21\u9AD8\u9891\u540C\u6B65\u5B8C\u6210");
  }, 30 * 1e3);
  setTimeout(async () => {
    const interruptedJobs = global.__interrupted_sync_jobs;
    if (interruptedJobs && interruptedJobs.length > 0) {
      log148.info(`[DataSyncScheduler] v411: \u53D1\u73B0 ${interruptedJobs.length} \u4E2A\u4E2D\u65AD\u4EFB\u52A1\u9700\u8981\u63A5\u7BA1\u6062\u590D`);
      for (const job of interruptedJobs) {
        if (job.totalSteps >= 10 && job.currentStepIndex > 3) {
          log148.info(`[DataSyncScheduler] v411: \u63A5\u7BA1Job${job.id}(\u8D26\u6237${job.accountId}) - \u4ECE\u6B65\u9AA4${job.currentStepIndex}/${job.totalSteps}\u6062\u590D\u6267\u884C\uFF08\u8DF3\u8FC7\u5DF2\u5B8C\u6210\u7684\u524D${job.currentStepIndex}\u6B65\uFF09`);
          try {
            const { syncAllAccounts: syncAllAccounts2, SYNC_STEPS: SYNC_STEPS2 } = await Promise.resolve().then(() => (init_unifiedSyncEngine(), unifiedSyncEngine_exports));
            const allStepIds = SYNC_STEPS2.map((s) => s.id);
            const remainingStepIds = allStepIds.slice(job.currentStepIndex);
            if (remainingStepIds.length > 0) {
              log148.info(`[DataSyncScheduler] v411: \u4E3A\u8D26\u6237${job.accountId}\u6062\u590D\u6267\u884C\u5269\u4F59${remainingStepIds.length}\u4E2A\u6B65\u9AA4`);
              const syncResult = await syncAllAccounts2("full");
              log148.info(`[DataSyncScheduler] v411: \u4EFB\u52A1\u63A5\u7BA1\u540C\u6B65\u5B8C\u6210 - \u6210\u529F: ${syncResult.successfulAccounts}/${syncResult.totalAccounts}, \u5931\u8D25: ${syncResult.failedAccounts}, \u8017\u65F6: ${syncResult.durationMs}ms`);
            }
          } catch (resumeErr) {
            log148.warn(`[DataSyncScheduler] v411: \u4EFB\u52A1\u63A5\u7BA1\u5931\u8D25: ${resumeErr.message}`);
          }
          break;
        } else {
          log148.info(`[DataSyncScheduler] v411: Job${job.id}(\u8D26\u6237${job.accountId})\u6B65\u9AA4\u8F83\u5C11(${job.currentStepIndex}/${job.totalSteps})\uFF0C\u5C06\u901A\u8FC7\u5E38\u89C4\u8C03\u5EA6\u91CD\u65B0\u6267\u884C`);
        }
      }
      delete global.__interrupted_sync_jobs;
    } else {
      log148.info("[DataSyncScheduler] v411: \u65E0\u4E2D\u65AD\u4EFB\u52A1\uFF0C\u6267\u884C\u5E38\u89C4\u542F\u52A8\u540E\u5B8C\u6574\u540C\u6B65\uFF0860\u79D2\u5EF6\u8FDF\uFF09...");
      const result = await executeUnifiedSync("full");
      log148.info("[DataSyncScheduler] v411: \u542F\u52A8\u540E\u5B8C\u6574\u540C\u6B65\u5DF2\u5B8C\u6210");
    }
    try {
      await verifySyncHealth();
    } catch (verifyErr) {
      log148.warn(`[DataSyncScheduler] v336: \u540C\u6B65\u5065\u5EB7\u9A8C\u8BC1\u5931\u8D25: ${verifyErr.message}`);
    }
  }, 60 * 1e3);
  monitoringIntervals.push(setInterval(async () => {
    try {
      const { logHealthSnapshot: logHealthSnapshot2 } = await Promise.resolve().then(() => (init_unifiedSyncEngine(), unifiedSyncEngine_exports));
      logHealthSnapshot2();
    } catch (err) {
      log148.warn(`[DataSyncScheduler] v220: \u5065\u5EB7\u76D1\u63A7\u5FEB\u7167\u5931\u8D25: ${err.message}`);
    }
  }, 15 * 60 * 1e3));
  log148.info("[DataSyncScheduler] v220: \u7CFB\u7EDF\u5065\u5EB7\u76D1\u63A7\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: 15\u5206\u949F");
  monitoringIntervals.push(setInterval(async () => {
    try {
      const { processRetryTasks: processRetryTasks2 } = await Promise.resolve().then(() => (init_optimizationSyncEngine(), optimizationSyncEngine_exports));
      const retryResult = await processRetryTasks2();
      if (retryResult.processed > 0) {
        log148.warn(`[DataSyncScheduler] \u91CD\u8BD5\u540C\u6B65\u5B8C\u6210: \u5904\u7406=${retryResult.processed}, \u6210\u529F=${retryResult.synced}, \u5931\u8D25=${retryResult.failed}`);
      }
    } catch (err) {
      log148.warn(`[DataSyncScheduler] \u91CD\u8BD5\u540C\u6B65\u5F02\u5E38: ${err.message}`);
    }
  }, 5 * 60 * 1e3));
  log148.info(`[DataSyncScheduler] v137: \u4F18\u5316\u4EFB\u52A1\u91CD\u8BD5\u540C\u6B65\u5F15\u64CE\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: 5\u5206\u949F`);
  monitoringIntervals.push(setInterval(async () => {
    try {
      const { cleanupStaleJobs: cleanupStaleJobs2 } = await Promise.resolve().then(() => (init_dataSyncService(), dataSyncService_exports));
      const result = await cleanupStaleJobs2(45);
      if (result.cleaned > 0) {
        log148.warn(`[DataSyncScheduler] v614i-fix12: \u5B9A\u671F\u6E05\u7406\u53D1\u73B0 ${result.cleaned} \u4E2A\u5FC3\u8DF3\u8D85\u65F6\u4EFB\u52A1(45\u5206\u949F\u65E0\u66F4\u65B0): ${result.jobIds.join(", ")}`);
      }
    } catch (err) {
      log148.warn(`[DataSyncScheduler] v614i-fix12: \u5B9A\u671F\u5361\u6B7B\u4EFB\u52A1\u6E05\u7406\u5F02\u5E38: ${err.message}`);
    }
  }, 10 * 60 * 1e3));
  log148.info("[DataSyncScheduler] v614i-fix12: \u5FC3\u8DF3\u611F\u77E5\u7684\u5361\u6B7B\u4EFB\u52A1\u5B9A\u671F\u6E05\u7406\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: 10\u5206\u949F\uFF0C\u5FC3\u8DF3\u8D85\u65F6: 45\u5206\u949F");
  monitoringIntervals.push(setInterval(async () => {
    try {
      const { getSLOMetrics: getSLOMetrics2 } = await Promise.resolve().then(() => (init_sloMonitor2(), sloMonitor_exports2));
      const metrics = await getSLOMetrics2();
      if (metrics.overallStatus === "unhealthy") {
        log148.warn(`[DataSyncScheduler] v358.1: SLO\u5065\u5EB7\u5EA6\u5F02\u5E38! score=${metrics.overallScore}, syncRate=${metrics.syncSuccessRate.actual}%, coverage=${metrics.dataCoverage.actual}%, freshness=${metrics.dataFreshness.actual}`);
      } else if (metrics.overallStatus === "degraded") {
        log148.warn(`[DataSyncScheduler] v358.1: SLO\u5065\u5EB7\u5EA6\u964D\u7EA7 score=${metrics.overallScore}, syncRate=${metrics.syncSuccessRate.actual}%, coverage=${metrics.dataCoverage.actual}%`);
      } else {
        log148.debug(`[DataSyncScheduler] v358.1: SLO\u6B63\u5E38 score=${metrics.overallScore}`);
      }
    } catch (err) {
      log148.warn(`[DataSyncScheduler] v358.1: SLO\u76D1\u63A7\u91C7\u96C6\u5931\u8D25: ${err.message}`);
    }
  }, 10 * 60 * 1e3));
  log148.info("[DataSyncScheduler] v358.1: SLO\u76D1\u63A7\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: 10\u5206\u949F");
  monitoringIntervals.push(setInterval(async () => {
    try {
      const { checkAllAccountsIntegrity: checkAllAccountsIntegrity2, executeAutoRepair: executeAutoRepair2 } = await Promise.resolve().then(() => (init_dataIntegrityChecker2(), dataIntegrityChecker_exports2));
      log148.info("[DataSyncScheduler] v358.1: \u5F00\u59CB\u6570\u636E\u5B8C\u6574\u6027\u5B9A\u671F\u68C0\u67E5...");
      const checkResult = await checkAllAccountsIntegrity2(14);
      log148.info(`[DataSyncScheduler] v358.1: \u5B8C\u6574\u6027\u68C0\u67E5\u5B8C\u6210 - \u603B\u8BA1=${checkResult.totalAccounts}, \u5065\u5EB7=${checkResult.healthyAccounts}, \u9700\u4FEE\u590D=${checkResult.unhealthyAccounts}`);
      const unhealthyResults = checkResult.results.filter((r) => r.needsRepair);
      for (const result of unhealthyResults) {
        try {
          const repairResult = await executeAutoRepair2(result);
          log148.info(`[DataSyncScheduler] v358.1: \u8D26\u6237${result.accountId}\u81EA\u52A8\u4FEE\u590D: \u6210\u529F=${repairResult.repaired}, \u52A8\u4F5C=${repairResult.actionsExecuted}, \u9519\u8BEF=${repairResult.errors.length}`);
        } catch (repairErr) {
          log148.warn(`[DataSyncScheduler] v358.1: \u8D26\u6237${result.accountId}\u81EA\u52A8\u4FEE\u590D\u5931\u8D25: ${repairErr.message}`);
        }
      }
    } catch (err) {
      log148.warn(`[DataSyncScheduler] v358.1: \u6570\u636E\u5B8C\u6574\u6027\u68C0\u67E5\u5931\u8D25: ${err.message}`);
    }
  }, 4 * 60 * 60 * 1e3));
  log148.info("[DataSyncScheduler] v358.1: \u6570\u636E\u5B8C\u6574\u6027\u68C0\u67E5\u5668\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: 4\u5C0F\u65F6");
  setTimeout(async () => {
    try {
      const { checkAllAccountsIntegrity: checkAllAccountsIntegrity2 } = await Promise.resolve().then(() => (init_dataIntegrityChecker2(), dataIntegrityChecker_exports2));
      log148.info("[DataSyncScheduler] v358.1: \u90E8\u7F72\u540E\u9996\u6B21\u5B8C\u6574\u6027\u68C0\u67E5...");
      const checkResult = await checkAllAccountsIntegrity2(14);
      log148.info(`[DataSyncScheduler] v358.1: \u90E8\u7F72\u540E\u9996\u6B21\u68C0\u67E5\u5B8C\u6210 - \u603B\u8BA1=${checkResult.totalAccounts}, \u5065\u5EB7=${checkResult.healthyAccounts}, \u9700\u4FEE\u590D=${checkResult.unhealthyAccounts}`);
    } catch (err) {
      log148.warn(`[DataSyncScheduler] v358.1: \u90E8\u7F72\u540E\u9996\u6B21\u5B8C\u6574\u6027\u68C0\u67E5\u5931\u8D25: ${err.message}`);
    }
  }, 5 * 60 * 1e3);
  monitoringIntervals.push(setInterval(async () => {
    try {
      const cleaned = await cleanupExpiredOverrides();
      if (cleaned && cleaned > 0) {
        log148.warn(`[DataSyncScheduler] v488: SyncCoordinator\u6E05\u7406\u4E86 ${cleaned} \u4E2A\u8FC7\u671F\u7684\u624B\u52A8\u63A5\u7BA1\u72B6\u6001`);
      }
      const coordStatus = getCoordinatorStatus();
      const overrides = Array.isArray(coordStatus?.manualOverrides) ? coordStatus.manualOverrides : [];
      if (overrides.length > 0) {
        log148.info(`[DataSyncScheduler] v488: SyncCoordinator\u72B6\u6001 - \u624B\u52A8\u63A5\u7BA1\u4E2D: ${overrides.map((o) => `\u8D26\u53F7${o.accountId}(\u9636\u6BB5:${o.phase},\u8017\u65F6:${(o.elapsedMs / 1e3).toFixed(0)}s)`).join(", ")}`);
      }
    } catch (err) {
      log148.warn(`[DataSyncScheduler] v488: SyncCoordinator\u6E05\u7406\u5F02\u5E38: ${err.message}`);
    }
  }, COORDINATOR_CLEANUP_INTERVAL_MS));
  log148.info("[DataSyncScheduler] v488: SyncCoordinator\u8FC7\u671F\u72B6\u6001\u6E05\u7406\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: 10\u5206\u949F");
  monitoringIntervals.push(setInterval(async () => {
    try {
      const { runConsistencyCheck: runConsistencyCheck3 } = await Promise.resolve().then(() => (init_optimizationConsistencyChecker(), optimizationConsistencyChecker_exports));
      log148.info("[DataSyncScheduler] v509: \u5F00\u59CB\u4F18\u5316\u4E8B\u4EF6\u4E00\u81F4\u6027\u68C0\u67E5...");
      const checkResult = await runConsistencyCheck3();
      const totalFixed = checkResult.fixedByEventId + checkResult.fixedByKeywordMatch + checkResult.markedSuperseded + checkResult.markedPermanentlyFailed;
      if (totalFixed > 0) {
        log148.warn(`[DataSyncScheduler] v509: \u4E00\u81F4\u6027\u68C0\u67E5\u5B8C\u6210 - \u4FEE\u590D=${totalFixed} (event_id=${checkResult.fixedByEventId}, keyword=${checkResult.fixedByKeywordMatch}, superseded=${checkResult.markedSuperseded}, perm_failed=${checkResult.markedPermanentlyFailed}), \u5269\u4F59pending=${checkResult.scannedEvents}`);
      } else {
        log148.debug(`[DataSyncScheduler] v509: \u4E00\u81F4\u6027\u68C0\u67E5\u5B8C\u6210 - \u65E0\u9700\u4FEE\u590D, pending=${checkResult.scannedEvents}`);
      }
    } catch (err) {
      log148.warn(`[DataSyncScheduler] v509: \u4F18\u5316\u4E8B\u4EF6\u4E00\u81F4\u6027\u68C0\u67E5\u5931\u8D25: ${err.message}`);
    }
  }, 2 * 60 * 60 * 1e3));
  log148.info("[DataSyncScheduler] v509: \u4F18\u5316\u4E8B\u4EF6\u4E00\u81F4\u6027\u68C0\u67E5\u5668\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: 2\u5C0F\u65F6");
  setTimeout(async () => {
    try {
      const { runConsistencyCheck: runConsistencyCheck3 } = await Promise.resolve().then(() => (init_optimizationConsistencyChecker(), optimizationConsistencyChecker_exports));
      log148.info("[DataSyncScheduler] v509: \u90E8\u7F72\u540E\u9996\u6B21\u4E00\u81F4\u6027\u68C0\u67E5...");
      const checkResult = await runConsistencyCheck3();
      log148.info(`[DataSyncScheduler] v509: \u90E8\u7F72\u540E\u9996\u6B21\u68C0\u67E5\u5B8C\u6210 - \u4FEE\u590D=${checkResult.fixedByEventId + checkResult.fixedByKeywordMatch + checkResult.markedSuperseded + checkResult.markedPermanentlyFailed}, pending=${checkResult.scannedEvents}`);
    } catch (err) {
      log148.warn(`[DataSyncScheduler] v509: \u90E8\u7F72\u540E\u9996\u6B21\u4E00\u81F4\u6027\u68C0\u67E5\u5931\u8D25: ${err.message}`);
    }
  }, 3 * 60 * 1e3);
  log148.info(`[DataSyncScheduler] v488: \u7EDF\u4E00\u540C\u6B65\u8C03\u5EA6\u5668\u5DF2\u542F\u52A8\uFF0C\u5B8C\u6574\u540C\u6B65\u95F4\u9694: ${defaultIntervalMs / 1e3 / 60} \u5206\u949F`);
}
function stopDataSyncScheduler() {
  if (!schedulerStatus2.isRunning) {
    log148.info("[DataSyncScheduler] \u5B9A\u65F6\u540C\u6B65\u8C03\u5EA6\u5668\u672A\u5728\u8FD0\u884C");
    return;
  }
  stopSchedulerTasks();
  log148.info(`[DataSyncScheduler] v371: \u5DF2\u6E05\u7406\u6240\u6709\u76D1\u63A7\u5B9A\u65F6\u5668`);
  schedulerStatus2.isRunning = false;
  schedulerStatus2.nextRunTime = null;
  schedulerStatus2.currentTier = null;
  log148.info("[DataSyncScheduler] \u5B9A\u65F6\u540C\u6B65\u8C03\u5EA6\u5668\u5DF2\u505C\u6B62");
  logSystem("DataSyncScheduler", "\u540C\u6B65\u8C03\u5EA6\u5668\u5DF2\u505C\u6B62");
}
async function executeUnifiedSync(tier2) {
  const mutexAcquired = acquireGlobalMutex(tier2);
  if (!mutexAcquired) {
    const waitStart = Date.now();
    let acquired = false;
    while (Date.now() - waitStart < MUTEX_MAX_WAIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, MUTEX_POLL_INTERVAL_MS));
      acquired = acquireGlobalMutex(tier2);
      if (acquired) break;
    }
    if (!acquired) {
      log148.info(`[DataSyncScheduler] v580: ${tier2}\u5C42\u8DF3\u8FC7 - \u5168\u5C40\u4E92\u65A5\u9501\u7B49\u5F85\u8D85\u65F6(${MUTEX_MAX_WAIT_MS / 1e3}\u79D2)\uFF0C\u5C06\u5728\u4E0B\u4E00\u4E2A\u8C03\u5EA6\u5468\u671F\u91CD\u8BD5`);
      logSync("DataSyncScheduler", `v580: ${tier2}\u5C42\u4E92\u65A5\u9501\u7B49\u5F85\u8D85\u65F6`, { tier: tier2, waitedMs: Date.now() - waitStart });
      return;
    }
    log148.info(`[DataSyncScheduler] v580: ${tier2}\u5C42\u83B7\u5F97\u5168\u5C40\u4E92\u65A5\u9501\uFF08\u7B49\u5F85\u4E86${((Date.now() - waitStart) / 1e3).toFixed(1)}\u79D2\uFF09`);
  }
  try {
    try {
      const database = await getDb();
      if (database) {
        const runningJobs = await database.execute(
          sql`SELECT id, accountId, syncType, trigger_source, current_step, current_step_index, total_steps,
 TIMESTAMPDIFF(MINUTE, startedAt, NOW()) as running_minutes,
 TIMESTAMPDIFF(SECOND, updated_at, NOW()) as seconds_since_heartbeat
 FROM data_sync_jobs
 WHERE status = 'running'
 AND updated_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)
 AND (trigger_source IS NULL OR trigger_source = 'auto')
 ORDER BY id`
        );
        const runningRows = Array.isArray(runningJobs) ? runningJobs[0] : runningJobs.rows || runningJobs;
        if (runningRows && runningRows.length > 0) {
          const jobSummary = runningRows.map((j) => {
            const progress = j.total_steps > 0 ? Math.round(j.current_step_index / j.total_steps * 100) : 0;
            const heartbeatAge = j.seconds_since_heartbeat || 0;
            return `Job${j.id}(\u8D26\u6237${j.accountId},${j.current_step}[${j.current_step_index}/${j.total_steps}]=${progress}%,\u8FD0\u884C${j.running_minutes}\u5206\u949F,\u5FC3\u8DF3${heartbeatAge}\u79D2\u524D)`;
          }).join(", ");
          schedulerSkipCount[tier2] = (schedulerSkipCount[tier2] || 0) + 1;
          const skipCount = schedulerSkipCount[tier2];
          log148.info(`[DataSyncScheduler] v411: ${tier2}\u5C42\u8DF3\u8FC7(\u7B2C${skipCount}\u6B21) - \u6570\u636E\u5E93\u4E2D\u6709${runningRows.length}\u4E2Arunning\u4EFB\u52A1: ${jobSummary}`);
          logSync("DataSyncScheduler", `v411: ${tier2}\u5C42\u8DF3\u8FC7`, {
            tier: tier2,
            skipCount,
            // @ts-ignore
            runningCount: runningRows.length,
            runningJobs: jobSummary
          });
          return;
        } else {
          if (schedulerSkipCount[tier2] > 0) {
            log148.info(`[DataSyncScheduler] v411: ${tier2}\u5C42\u6062\u590D\u6267\u884C\uFF08\u4E4B\u524D\u8DF3\u8FC7\u4E86${schedulerSkipCount[tier2]}\u6B21\uFF09`);
            schedulerSkipCount[tier2] = 0;
          }
        }
      }
    } catch (dbCheckErr) {
      log148.warn(`[DataSyncScheduler] v410: \u6570\u636E\u5E93\u5E76\u53D1\u68C0\u67E5\u5931\u8D25\uFF0C\u56DE\u9000\u5230\u5185\u5B58\u68C0\u67E5: ${dbCheckErr.message}`);
    }
    if (tier2 === "high") {
      if (tierRunningState.full) {
        log148.info(`[DataSyncScheduler] v222: high\u5C42\u8DF3\u8FC7 - full\u5C42\u6B63\u5728\u8FD0\u884C\uFF08full\u5DF2\u5305\u542Bhigh\u6B65\u9AA4\uFF09`);
        logSync("DataSyncScheduler", "v222: high\u5C42\u667A\u80FD\u8DF3\u8FC7", { reason: "full_running" });
        return;
      }
      if (tierRunningState.medium) {
        log148.info(`[DataSyncScheduler] v222: high\u5C42\u8DF3\u8FC7 - medium\u5C42\u6B63\u5728\u8FD0\u884C\uFF08\u907F\u514DAPI\u5E76\u53D1\u538B\u529B\uFF09`);
        logSync("DataSyncScheduler", "v222: high\u5C42\u667A\u80FD\u8DF3\u8FC7", { reason: "medium_running" });
        return;
      }
    }
    if (tier2 === "medium") {
      if (tierRunningState.full) {
        log148.info(`[DataSyncScheduler] v222: medium\u5C42\u8DF3\u8FC7 - full\u5C42\u6B63\u5728\u8FD0\u884C\uFF08full\u5DF2\u5305\u542Bmedium\u6B65\u9AA4\uFF09`);
        logSync("DataSyncScheduler", "v222: medium\u5C42\u667A\u80FD\u8DF3\u8FC7", { reason: "full_running" });
        return;
      }
    }
    tierRunningState[tier2] = true;
    let memSnapshotBefore = null;
    if (tier2 === "nightly" || tier2 === "full") {
      try {
        const { startNightlyMonitor: startNightlyMonitor2 } = (init_nightlySyncMonitor(), __toCommonJS(nightlySyncMonitor_exports));
        startNightlyMonitor2(tier2);
      } catch {
      }
      const memBefore = process.memoryUsage();
      memSnapshotBefore = {
        rssMB: Math.round(memBefore.rss / 1024 / 1024),
        heapUsedMB: Math.round(memBefore.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memBefore.heapTotal / 1024 / 1024)
      };
      log148.info(`[DataSyncScheduler] v614i-fix23-patch: ${tier2}\u5C42\u540C\u6B65\u524D\u5185\u5B58\u5FEB\u7167: RSS=${memSnapshotBefore.rssMB}MB, Heap=${memSnapshotBefore.heapUsedMB}/${memSnapshotBefore.heapTotalMB}MB`);
      logSync("DataSyncScheduler", `v614i-fix23-patch: ${tier2}\u5C42\u540C\u6B65\u524D\u5185\u5B58`, memSnapshotBefore);
      if (typeof global.gc === "function") {
        global.gc();
        const memAfterGc = process.memoryUsage();
        log148.info(`[DataSyncScheduler] v614i-fix23-patch: \u540C\u6B65\u524DGC\u5B8C\u6210: Heap ${memSnapshotBefore.heapUsedMB}MB \u2192 ${Math.round(memAfterGc.heapUsed / 1024 / 1024)}MB`);
      }
    }
    log148.info(`[DataSyncScheduler] v222: \u5F00\u59CB\u6267\u884C${SYNC_TIER_CONFIG[tier2].description} (\u7EDF\u4E00\u5F15\u64CE) - ${(/* @__PURE__ */ new Date()).toISOString()}`);
    logSync("DataSyncScheduler", `v222: \u5F00\u59CB${SYNC_TIER_CONFIG[tier2].description}`, { tier: tier2, mode: "unified_engine" });
    schedulerStatus2.currentTier = tier2;
    try {
      try {
        const { enqueueSyncTier: enqueueSyncTier2, isRedisQueueEnabled: isRedisQueueEnabled2 } = await Promise.resolve().then(() => (init_syncSchedulerAdapter(), syncSchedulerAdapter_exports));
        if (isRedisQueueEnabled2()) {
          const enqueueResult = await enqueueSyncTier2(tier2);
          if (enqueueResult.mode === "redis" && enqueueResult.success) {
            log148.info(
              `[DataSyncScheduler] v580: ${tier2}\u5C42\u5DF2\u901A\u8FC7 Redis \u961F\u5217\u5206\u6D41: ${enqueueResult.enqueued}/${enqueueResult.totalAccounts}\u4E2A\u8D26\u6237\u5165\u961F, ${enqueueResult.skipped}\u4E2A\u8DF3\u8FC7(\u53BB\u91CD)`
            );
            logSync("DataSyncScheduler", `v580: ${tier2}\u5C42 Redis \u961F\u5217\u5206\u6D41`, {
              tier: tier2,
              mode: "redis",
              enqueued: enqueueResult.enqueued,
              total: enqueueResult.totalAccounts,
              skipped: enqueueResult.skipped
            });
            schedulerStatus2.tierLastRun[tier2] = /* @__PURE__ */ new Date();
            schedulerStatus2.lastRunTime = /* @__PURE__ */ new Date();
            schedulerStatus2.totalSyncs += enqueueResult.enqueued;
            return;
          }
          if (enqueueResult.mode === "direct") {
            log148.info(`[DataSyncScheduler] v580: ${tier2}\u5C42 Redis \u961F\u5217\u4E0D\u53EF\u7528\uFF0C\u56DE\u9000\u5230\u76F4\u63A5\u6267\u884C\u6A21\u5F0F`);
          }
        }
      } catch (v580Err) {
        log148.warn(`[DataSyncScheduler] v580: Redis \u961F\u5217\u5206\u6D41\u5931\u8D25\uFF0C\u56DE\u9000\u5230\u76F4\u63A5\u6267\u884C: ${v580Err.message}`);
      }
      const { syncAllAccounts: syncAllAccounts2 } = await Promise.resolve().then(() => (init_unifiedSyncEngine(), unifiedSyncEngine_exports));
      const batchResult = await syncAllAccounts2(tier2);
      schedulerStatus2.tierLastRun[tier2] = /* @__PURE__ */ new Date();
      schedulerStatus2.lastRunTime = /* @__PURE__ */ new Date();
      schedulerStatus2.successfulSyncs += batchResult.successfulAccounts;
      schedulerStatus2.failedSyncs += batchResult.failedAccounts;
      schedulerStatus2.totalSyncs += batchResult.totalAccounts;
      log148.info(`[DataSyncScheduler] v219: ${SYNC_TIER_CONFIG[tier2].description}\u5B8C\u6210: ${batchResult.successfulAccounts}/${batchResult.totalAccounts} \u6210\u529F, ${batchResult.failedAccounts} \u5931\u8D25, ${batchResult.skippedAccounts} \u8DF3\u8FC7, \u8017\u65F6 ${batchResult.durationMs}ms`);
      if (memSnapshotBefore && (tier2 === "nightly" || tier2 === "full")) {
        const memAfter = process.memoryUsage();
        const afterSnapshot = {
          rssMB: Math.round(memAfter.rss / 1024 / 1024),
          heapUsedMB: Math.round(memAfter.heapUsed / 1024 / 1024),
          heapTotalMB: Math.round(memAfter.heapTotal / 1024 / 1024)
        };
        const rssDelta = afterSnapshot.rssMB - memSnapshotBefore.rssMB;
        const heapDelta = afterSnapshot.heapUsedMB - memSnapshotBefore.heapUsedMB;
        log148.info(`[DataSyncScheduler] v614i-fix23-patch: ${tier2}\u5C42\u540C\u6B65\u540E\u5185\u5B58: RSS=${afterSnapshot.rssMB}MB(\u0394${rssDelta > 0 ? "+" : ""}${rssDelta}MB), Heap=${afterSnapshot.heapUsedMB}MB(\u0394${heapDelta > 0 ? "+" : ""}${heapDelta}MB)`);
        logSync("DataSyncScheduler", `v614i-fix23-patch: ${tier2}\u5C42\u540C\u6B65\u540E\u5185\u5B58`, { ...afterSnapshot, rssDelta, heapDelta });
        if (rssDelta > 500) {
          log148.warn(`[DataSyncScheduler] v614i-fix23-patch: \u26A0\uFE0F ${tier2}\u5C42\u540C\u6B65\u671F\u95F4RSS\u5185\u5B58\u589E\u957F${rssDelta}MB\uFF0C\u53EF\u80FD\u5B58\u5728\u5185\u5B58\u6CC4\u6F0F\uFF01\u540C\u6B65\u524D=${memSnapshotBefore.rssMB}MB, \u540C\u6B65\u540E=${afterSnapshot.rssMB}MB`);
          logSync("DataSyncScheduler", `v614i-fix23-patch: \u5185\u5B58\u589E\u957F\u544A\u8B66`, { tier: tier2, rssDelta, before: memSnapshotBefore.rssMB, after: afterSnapshot.rssMB });
        }
        if (afterSnapshot.heapUsedMB > 1024) {
          log148.warn(`[DataSyncScheduler] v614i-fix23-patch: \u26A0\uFE0F ${tier2}\u5C42\u540C\u6B65\u540EHeap\u8D85\u8FC71GB(${afterSnapshot.heapUsedMB}MB)\uFF0C\u89E6\u53D1\u4E3B\u52A8GC`);
          if (typeof global.gc === "function") {
            global.gc();
            const memPostGc = process.memoryUsage();
            log148.info(`[DataSyncScheduler] v614i-fix23-patch: \u540C\u6B65\u540EGC\u5B8C\u6210: Heap ${afterSnapshot.heapUsedMB}MB \u2192 ${Math.round(memPostGc.heapUsed / 1024 / 1024)}MB`);
          }
        }
      }
      if (tier2 === "full" || tier2 === "low") {
        for (const accountResult of batchResult.accountResults) {
          if (!accountResult.success) continue;
          try {
            const { triggerAccountOptimizations: triggerAccountOptimizations2 } = await Promise.resolve().then(() => (init_optimizationScheduler(), optimizationScheduler_exports));
            await triggerAccountOptimizations2(accountResult.accountId, "unified_sync_complete");
            log148.info(`[DataSyncScheduler] v219: \u8D26\u6237 ${accountResult.accountId} \u4F18\u5316\u76EE\u6807\u89E6\u53D1\u5B8C\u6210`);
          } catch (optErr) {
            log148.warn(`[DataSyncScheduler] v219: \u8D26\u6237 ${accountResult.accountId} \u4F18\u5316\u76EE\u6807\u89E6\u53D1\u5931\u8D25: ${optErr.message}`);
          }
        }
        try {
          log148.info(`[DataSyncScheduler] v337.4: \u6570\u636E\u540C\u6B65\u5B8C\u6210\uFF0C\u89E6\u53D1\u5FEB\u901F\u5426\u5B9A\u626B\u63CF...`);
          await executeOptimizationTask("daily_search_term_negation");
          log148.info(`[DataSyncScheduler] v337.4: \u5FEB\u901F\u5426\u5B9A\u626B\u63CF\u5B8C\u6210`);
        } catch (negErr) {
          log148.warn(`[DataSyncScheduler] v337.4: \u5FEB\u901F\u5426\u5B9A\u626B\u63CF\u5931\u8D25: ${negErr.message}`);
        }
        try {
          log148.info(`[DataSyncScheduler] v523: \u6570\u636E\u540C\u6B65\u5B8C\u6210\uFF0C\u89E6\u53D1\u5B9E\u4F53\u72B6\u6001\u5BF9\u9F50...`);
          const { alignAllAccountEntityStates: alignAllAccountEntityStates2 } = await Promise.resolve().then(() => (init_entityStateAlignment(), entityStateAlignment_exports));
          const alignResult = await alignAllAccountEntityStates2();
          log148.info(`[DataSyncScheduler] v523: \u5B9E\u4F53\u72B6\u6001\u5BF9\u9F50\u5B8C\u6210: ${alignResult.totalAccounts}\u4E2A\u8D26\u6237, keywords=${alignResult.totalKeywordsAligned}, targets=${alignResult.totalTargetsAligned}, cancelled=${alignResult.totalTasksCancelled}`);
        } catch (alignErr) {
          log148.warn(`[DataSyncScheduler] v523: \u5B9E\u4F53\u72B6\u6001\u5BF9\u9F50\u5931\u8D25: ${alignErr.message}`);
        }
      }
      if (tier2 === "full") {
        schedulerStatus2.nextRunTime = new Date(Date.now() + (schedulerIntervals.full ? 60 * 60 * 1e3 : 30 * 60 * 1e3));
      }
      schedulerStatus2.errors = schedulerStatus2.errors.slice(-10);
    } catch (error48) {
      log148.warn(`[DataSyncScheduler] v219: ${tier2}\u5C42\u540C\u6B65\u6267\u884C\u5931\u8D25:`, error48);
      schedulerStatus2.errors.push(`v219 ${tier2}\u5C42\u540C\u6B65\u5931\u8D25: ${error48.message}`);
      logSyncError("DataSyncScheduler", `v219 ${tier2}\u5C42\u540C\u6B65\u5931\u8D25`, { tier: tier2, error: error48.message });
    }
    schedulerStatus2.currentTier = null;
    tierRunningState[tier2] = false;
  } finally {
    if (tier2 === "nightly" || tier2 === "full") {
      try {
        const { stopNightlyMonitor: stopNightlyMonitor2 } = (init_nightlySyncMonitor(), __toCommonJS(nightlySyncMonitor_exports));
        stopNightlyMonitor2();
      } catch {
      }
    }
    releaseGlobalMutex(tier2);
    log148.info(`[DataSyncScheduler] v488: ${tier2}\u5C42\u5B8C\u6210\uFF0C\u8FDB\u5165\u5C42\u7EA7\u95F4\u51B7\u5374\u671F(${TIER_COOLDOWN_MS / 1e3}\u79D2)...`);
    await new Promise((resolve) => setTimeout(resolve, TIER_COOLDOWN_MS));
  }
}
async function triggerManualSync(userId, accountId) {
  try {
    const { triggerManualFullSync: triggerManualFullSync2 } = await Promise.resolve().then(() => (init_unifiedSyncEngine(), unifiedSyncEngine_exports));
    const syncResult = await triggerManualFullSync2(accountId);
    if (!syncResult) {
      return { success: false, message: "\u8D26\u53F7\u4E0D\u5B58\u5728\u6216\u672A\u914D\u7F6EAPI\u51ED\u8BC1" };
    }
    return {
      // @ts-ignore
      success: syncResult.success,
      // @ts-ignore
      message: syncResult.success ? (
        // @ts-ignore
        `\u540C\u6B65\u5B8C\u6210: ${syncResult.completedSteps}/${syncResult.totalSteps}\u6B65\u6210\u529F, \u540C\u6B65${syncResult.totalSynced}\u6761\u6570\u636E, \u8017\u65F6${syncResult.durationMs}ms`
      ) : (
        // @ts-ignore
        `\u540C\u6B65\u90E8\u5206\u5B8C\u6210: ${syncResult.completedSteps}/${syncResult.totalSteps}\u6B65\u6210\u529F, \u9519\u8BEF: ${syncResult.errors.slice(0, 3).join("; ")}`
      ),
      result: {
        // @ts-ignore
        campaigns: (syncResult.stepResults["sp_campaigns"]?.synced || 0) + // @ts-ignore
        (syncResult.stepResults["sb_campaigns"]?.synced || 0) + // @ts-ignore
        (syncResult.stepResults["sd_campaigns"]?.synced || 0),
        // @ts-ignore
        adGroups: (syncResult.stepResults["sp_ad_groups"]?.synced || 0) + // @ts-ignore
        (syncResult.stepResults["sb_ad_groups"]?.synced || 0) + // @ts-ignore
        (syncResult.stepResults["sd_ad_groups"]?.synced || 0),
        // @ts-ignore
        keywords: (syncResult.stepResults["sp_keywords"]?.synced || 0) + // @ts-ignore
        (syncResult.stepResults["sb_keywords"]?.synced || 0),
        // @ts-ignore
        targets: (syncResult.stepResults["sp_product_targets"]?.synced || 0) + // @ts-ignore
        (syncResult.stepResults["sb_product_targets"]?.synced || 0) + // @ts-ignore
        (syncResult.stepResults["sd_product_targets"]?.synced || 0),
        // @ts-ignore
        performance: syncResult.stepResults["performance_95d"]?.synced || 0,
        // @ts-ignore
        spCampaigns: syncResult.stepResults["sp_campaigns"]?.synced || 0,
        // @ts-ignore
        sbCampaigns: syncResult.stepResults["sb_campaigns"]?.synced || 0,
        // @ts-ignore
        sdCampaigns: syncResult.stepResults["sd_campaigns"]?.synced || 0,
        // @ts-ignore
        durationMs: syncResult.durationMs,
        // @ts-ignore
        completedSteps: syncResult.completedSteps,
        // @ts-ignore
        totalSteps: syncResult.totalSteps,
        // @ts-ignore
        failedSteps: syncResult.failedSteps
      }
    };
  } catch (error48) {
    return {
      success: false,
      message: `\u540C\u6B65\u5931\u8D25: ${error48.message}`
    };
  }
}
function getSyncQueueStatus() {
  return {
    queueLength: requestQueue.length,
    isProcessing: isProcessingQueue,
    schedulerStatus: { ...schedulerStatus2 }
  };
}
async function upsertSyncSchedule(params) {
  const existing = await getSyncScheduleByAccountId(params.userId, params.accountId);
  if (existing) {
    await updateSyncSchedule(existing.id, {
      syncType: params.syncType || "full_sync",
      frequency: params.frequency,
      preferredTime: params.preferredTime,
      preferredDayOfWeek: params.preferredDayOfWeek,
      isEnabled: params.isEnabled
    });
    return { ...existing, ...params };
  } else {
    const id = await createSyncSchedule({
      userId: params.userId,
      accountId: params.accountId,
      syncType: params.syncType || "full_sync",
      frequency: params.frequency,
      preferredTime: params.preferredTime,
      preferredDayOfWeek: params.preferredDayOfWeek,
      isEnabled: params.isEnabled
    });
    return {
      id,
      userId: params.userId,
      // @ts-ignore
      accountId: params.accountId,
      syncType: params.syncType || "full_sync",
      frequency: params.frequency,
      preferredTime: params.preferredTime || null,
      preferredDayOfWeek: params.preferredDayOfWeek || null,
      isEnabled: params.isEnabled ? 1 : 0,
      lastRunAt: null,
      nextRunAt: null,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
}
async function getSyncSchedule(userId, accountId) {
  return getSyncScheduleByAccountId(userId, accountId);
}
async function deleteSyncSchedule3(scheduleId) {
  await deleteSyncSchedule(scheduleId);
}
function sleep4(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function withExponentialBackoff(fn, maxRetries = 3, baseDelayMs = 1e3) {
  let lastError = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error48) {
      lastError = error48;
      if (error48.response?.status === 429 || error48.message?.includes("429")) {
        const delay2 = baseDelayMs * Math.pow(2, attempt);
        log148.info(`[DataSyncScheduler] \u9047\u5230\u901F\u7387\u9650\u5236\uFF0C\u7B49\u5F85 ${delay2}ms \u540E\u91CD\u8BD5 (\u5C1D\u8BD5 ${attempt + 1}/${maxRetries})`);
        await sleep4(delay2);
      } else {
        throw error48;
      }
    }
  }
  throw lastError || new Error("\u91CD\u8BD5\u6B21\u6570\u5DF2\u7528\u5C3D");
}
function shouldExecuteModuleForTarget(targetId, moduleName, stage) {
  const key = `${targetId}:${moduleName}`;
  const lastExecuted = moduleLastExecutionMap.get(key) || null;
  const result = shouldExecuteModule(moduleName, lastExecuted, stage);
  return { shouldExecute: result.shouldExecute, reason: result.reason };
}
async function recordModuleExecution(targetId, moduleName) {
  const key = `${targetId}:${moduleName}`;
  const now = /* @__PURE__ */ new Date();
  moduleLastExecutionMap.set(key, now);
  try {
    const dbInstance = await getDb();
    if (dbInstance) {
      const rows = await dbInstance.execute(sql`SELECT module_execution_times FROM performance_groups WHERE id = ${targetId}`);
      let executionTimes = {};
      const rowData = Array.isArray(rows) ? rows[0] : rows?.rows?.[0];
      if (rowData) {
        const rawArr = Array.isArray(rowData) ? rowData : [rowData];
        for (const r of rawArr) {
          const met = r.module_execution_times;
          if (met) {
            try {
              executionTimes = JSON.parse(met);
            } catch (e) {
              executionTimes = {};
            }
            break;
          }
        }
      }
      executionTimes[moduleName] = now.toISOString();
      await dbInstance.execute(sql`UPDATE performance_groups SET module_execution_times = ${JSON.stringify(executionTimes)} WHERE id = ${targetId}`);
    }
  } catch (dbErr) {
    log148.warn(`[OptimizationScheduler] v242: \u6301\u4E45\u5316\u6A21\u5757\u6267\u884C\u65F6\u95F4\u5931\u8D25(target=${targetId}, module=${moduleName}): ${dbErr.message}`);
  }
}
function acquireLock(taskType) {
  if (executionLocks[taskType]) {
    log148.info(`[OptimizationScheduler] \u4EFB\u52A1 ${taskType} \u6B63\u5728\u6267\u884C\u4E2D\uFF0C\u8DF3\u8FC7`);
    return false;
  }
  executionLocks[taskType] = true;
  return true;
}
function releaseLock2(taskType) {
  executionLocks[taskType] = false;
}
function shouldExecuteThisHour(taskType) {
  const now = /* @__PURE__ */ new Date();
  const hourKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
  if (lastExecutionHour[taskType] === hourKey) {
    return false;
  }
  lastExecutionHour[taskType] = hourKey;
  return true;
}
async function startOptimizationScheduler2() {
  log148.info("[OptimizationScheduler] \u542F\u52A8v156\u751F\u547D\u5468\u671F\u611F\u77E5\u667A\u80FD\u4F18\u5316\u8C03\u5EA6\u5668...");
  try {
    const { getEnabledOptimizationTargets: getEnabledOptimizationTargets2 } = await Promise.resolve().then(() => (init_optimizationTargetEngine(), optimizationTargetEngine_exports));
    const targets = await getEnabledOptimizationTargets2();
    const dbInstance = await getDb();
    let restoredFromJson = 0;
    let restoredFromFallback = 0;
    for (const target of targets) {
      let moduleTimesRestored = false;
      if (dbInstance) {
        try {
          const rows = await dbInstance.execute(sql`SELECT module_execution_times FROM performance_groups WHERE id = ${target.id}`);
          const resultRows = Array.isArray(rows) ? rows[0] : rows;
          const dataArr = Array.isArray(resultRows) ? resultRows : [resultRows];
          for (const row of dataArr) {
            const met = row?.module_execution_times;
            if (met) {
              const executionTimes = JSON.parse(met);
              const modules = Object.keys(executionTimes);
              if (modules.length > 0) {
                for (const mod of modules) {
                  const key = `${target.id}:${mod}`;
                  if (!moduleLastExecutionMap.has(key)) {
                    moduleLastExecutionMap.set(key, new Date(executionTimes[mod]));
                  }
                }
                moduleTimesRestored = true;
                restoredFromJson++;
                log148.info(`[OptimizationScheduler] v242: \u4ECE\u6A21\u5757\u6267\u884C\u65F6\u95F4JSON\u6062\u590D ${target.name}: ${modules.map((m) => `${m}=${executionTimes[m]}`).join(", ")}`);
              }
              break;
            }
          }
        } catch (jsonErr) {
          log148.warn(`[OptimizationScheduler] v242: \u89E3\u6790\u6A21\u5757\u6267\u884C\u65F6\u95F4JSON\u5931\u8D25(target=${target.id}): ${jsonErr.message}`);
        }
      }
      if (!moduleTimesRestored) {
        restoredFromFallback++;
        log148.info(`[OptimizationScheduler] v242f: ${target.name} \u65E0\u6A21\u5757\u6267\u884C\u65F6\u95F4\u8BB0\u5F55\uFF0C\u5C06\u5141\u8BB8\u9996\u6B21\u6267\u884C (\u4E0D\u518D\u4F7F\u7528last_optimization_at\u56DE\u9000)`);
      }
    }
    log148.info(`[OptimizationScheduler] v242: \u5DF2\u6062\u590D ${moduleLastExecutionMap.size} \u4E2A\u6A21\u5757\u6267\u884C\u65F6\u95F4\u8BB0\u5F55 (JSON\u7CBE\u786E\u6062\u590D=${restoredFromJson}, \u56DE\u9000\u6062\u590D=${restoredFromFallback})`);
  } catch (restoreErr) {
    log148.warn(`[OptimizationScheduler] v242: \u6062\u590D\u6A21\u5757\u6267\u884C\u65F6\u95F4\u5931\u8D25: ${restoreErr.message}`);
  }
  setTimeout(() => {
    optimizationIntervals.intraday_pacing = setInterval(async () => {
      await executeOptimizationTask("intraday_pacing");
    }, OPTIMIZATION_SCHEDULE.intraday_pacing.intervalMs);
    executeOptimizationTask("intraday_pacing");
  }, 1 * 60 * 1e3);
  log148.info(`[OptimizationScheduler] \u65E5\u5185\u8282\u594F\u76D1\u63A7\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: 30\u5206\u949F\uFF0C\u504F\u79FB: 1\u5206\u949F`);
  setTimeout(() => {
    optimizationIntervals.risk_scan = setInterval(async () => {
      await executeOptimizationTask("risk_scan");
    }, OPTIMIZATION_SCHEDULE.risk_scan.intervalMs);
    executeOptimizationTask("risk_scan");
  }, 6 * 60 * 1e3);
  log148.info(`[OptimizationScheduler] \u9AD8\u9891\u98CE\u63A7\u626B\u63CF\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: 2\u5C0F\u65F6\uFF0C\u504F\u79FB: 6\u5206\u949F`);
  setTimeout(() => {
    optimizationIntervals.dayparting_adjustment = setInterval(async () => {
      await executeOptimizationTask("dayparting_adjustment");
    }, OPTIMIZATION_SCHEDULE.dayparting_adjustment.intervalMs);
    executeOptimizationTask("dayparting_adjustment");
  }, 11 * 60 * 1e3);
  log148.info(`[OptimizationScheduler] \u5206\u65F6\u7ADE\u4EF7\u8C03\u6574\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: 1\u5C0F\u65F6\uFF0C\u504F\u79FB: 11\u5206\u949F`);
  setTimeout(() => {
    optimizationIntervals.dayparting_budget = setInterval(async () => {
      await executeOptimizationTask("dayparting_budget");
    }, OPTIMIZATION_SCHEDULE.dayparting_budget.intervalMs);
  }, 16 * 60 * 1e3);
  log148.info(`[OptimizationScheduler] v179: \u5206\u65F6\u9884\u7B97\u8C03\u6574\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: 24\u5C0F\u65F6\uFF0C\u504F\u79FB: 16\u5206\u949F`);
  setTimeout(() => {
    optimizationIntervals.daily_bid_optimization = setInterval(async () => {
      await executeOptimizationTask("daily_bid_optimization");
    }, OPTIMIZATION_SCHEDULE.daily_bid_optimization.intervalMs);
    executeOptimizationTask("daily_bid_optimization");
  }, 21 * 60 * 1e3);
  log148.info(`[OptimizationScheduler] \u51FA\u4EF7\u667A\u80FD\u4F18\u5316\u5DF2\u542F\u52A8\uFF0C\u89E6\u53D1\u95F4\u9694: 2\u5C0F\u65F6\uFF0C\u504F\u79FB: 21\u5206\u949F`);
  setTimeout(() => {
    optimizationIntervals.daily_placement_optimization = setInterval(async () => {
      await executeOptimizationTask("daily_placement_optimization");
    }, 4 * 60 * 60 * 1e3);
    executeOptimizationTask("daily_placement_optimization");
  }, 26 * 60 * 1e3);
  log148.info(`[OptimizationScheduler] \u4F4D\u7F6E\u4F18\u5316\u5DF2\u542F\u52A8\uFF0C\u89E6\u53D1\u95F4\u9694: 4\u5C0F\u65F6\uFF0C\u504F\u79FB: 26\u5206\u949F`);
  setTimeout(() => {
    optimizationIntervals.daily_search_term_negation = setInterval(async () => {
      await executeOptimizationTask("daily_search_term_negation");
    }, 6 * 60 * 60 * 1e3);
    executeOptimizationTask("daily_search_term_negation");
  }, 31 * 60 * 1e3);
  log148.info(`[OptimizationScheduler] v337.4: \u641C\u7D22\u8BCD\u5426\u5B9A\u5DF2\u542F\u52A8\uFF0C\u89E6\u53D1\u95F4\u9694: 6\u5C0F\u65F6\uFF0C\u504F\u79FB: 31\u5206\u949F`);
  setTimeout(() => {
    optimizationIntervals.budget_allocation = setInterval(async () => {
      await executeOptimizationTask("budget_allocation");
    }, 4 * 60 * 60 * 1e3);
    executeOptimizationTask("budget_allocation");
  }, 36 * 60 * 1e3);
  log148.info(`[OptimizationScheduler] \u9884\u7B97\u667A\u80FD\u5206\u914D\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: 4\u5C0F\u65F6\uFF0C\u504F\u79FB: 36\u5206\u949F`);
  setTimeout(() => {
    optimizationIntervals.search_term_harvest = setInterval(async () => {
      await executeOptimizationTask("search_term_harvest");
    }, 8 * 60 * 60 * 1e3);
    executeOptimizationTask("search_term_harvest");
  }, 41 * 60 * 1e3);
  log148.info(`[OptimizationScheduler] v337.4: \u641C\u7D22\u8BCD\u6536\u5272\u5DF2\u542F\u52A8\uFF0C\u89E6\u53D1\u95F4\u9694: 8\u5C0F\u65F6\uFF0C\u504F\u79FB: 41\u5206\u949F`);
  optimizationIntervals.weekly_report = setInterval(async () => {
    const now = /* @__PURE__ */ new Date();
    const localHour = getLocalHour(now, "US");
    const localDow = getLocalDayOfWeek(now, "US");
    if (localDow === 1 && localHour === 9 && shouldExecuteThisHour("weekly_report")) {
      await executeOptimizationTask("weekly_report");
    }
  }, 60 * 60 * 1e3);
  log148.info(`[OptimizationScheduler] \u7EE9\u6548\u5468\u62A5\u5DF2\u542F\u52A8\uFF0C\u6267\u884C\u65F6\u95F4: \u5468\u4E00\u4E0A\u53489:00 (\u7AD9\u70B9\u672C\u5730\u65F6\u95F4)`);
  log148.info("[OptimizationScheduler] v143\u751F\u547D\u5468\u671F\u611F\u77E5\u8C03\u5EA6\u5668\u542F\u52A8\u5B8C\u6210");
  log148.debug("[OptimizationScheduler] \u751F\u547D\u5468\u671F\u9891\u7387\u8868:");
  log148.info("  | \u6A21\u5757           | \u542F\u52A8\u671F  | \u6210\u957F\u671F  | \u6210\u719F\u671F  |");
  log148.debug("  |----------------|---------|---------|---------|");
  log148.debug("  | \u51FA\u4EF7\u4F18\u5316       | 4\u5C0F\u65F6   | 6\u5C0F\u65F6   | 12\u5C0F\u65F6  |");
  log148.debug("  | \u5206\u65F6\u8C03\u6574       | 1\u5C0F\u65F6   | 1\u5C0F\u65F6   | 1\u5C0F\u65F6   |");
  log148.debug("  | \u4F4D\u7F6E\u503E\u659C       | 24\u5C0F\u65F6  | 12\u5C0F\u65F6  | 12\u5C0F\u65F6  |");
  log148.debug("  | \u5426\u5B9A\u641C\u7D22\u8BCD     | 48\u5C0F\u65F6  | 24\u5C0F\u65F6  | 24\u5C0F\u65F6  |");
  log148.debug("  | \u641C\u7D22\u8BCD\u8FC1\u79FB     | 72\u5C0F\u65F6  | 48\u5C0F\u65F6  | 24\u5C0F\u65F6  |");
  log148.debug("  | \u9884\u7B97\u5206\u914D       | 4\u5C0F\u65F6   | 4\u5C0F\u65F6   | 4\u5C0F\u65F6   |");
  try {
    startAutoCorrector();
    // v620-fix9: Start healthSignal precomputation cron job
    try {
      startHealthSignalPrecompute();
      log148.info("[DataSyncScheduler] v620-fix9: HealthSignal precompute cron started (10min interval)");
    } catch (hsErr) {
      log148.warn("[DataSyncScheduler] v620-fix9: HealthSignal precompute start failed: " + hsErr.message);
    }

    // v620: Auto-create P1-P4 database tables
    async function v620AutoMigrate() {
      try {
        const tables = [
          `CREATE TABLE IF NOT EXISTS operation_reviews (
            id INT AUTO_INCREMENT PRIMARY KEY,
            accountId INT NOT NULL,
            operationType VARCHAR(50) NOT NULL,
            targetId VARCHAR(100) NOT NULL,
            targetName VARCHAR(500) DEFAULT '',
            currentValue VARCHAR(100),
            proposedValue VARCHAR(100),
            riskLevel VARCHAR(20) DEFAULT 'low',
            reason TEXT,
            impactEstimate TEXT,
            status VARCHAR(30) DEFAULT 'pending_review',
            rejectedReason TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            approvedAt DATETIME,
            expiresAt DATETIME,
            INDEX idx_account_status (accountId, status),
            INDEX idx_expires (expiresAt)
          )`,
          `CREATE TABLE IF NOT EXISTS core_keywords (
            id INT AUTO_INCREMENT PRIMARY KEY,
            accountId INT NOT NULL,
            keywordId INT NOT NULL,
            keywordText VARCHAR(500),
            tier VARCHAR(5) DEFAULT 'C',
            protectionLevel VARCHAR(20) DEFAULT 'standard',
            minBidFloor DECIMAL(10,4) DEFAULT 0.15,
            maxBidCeiling DECIMAL(10,4) DEFAULT 10.00,
            totalOrders INT DEFAULT 0,
            totalSales DECIMAL(12,2) DEFAULT 0,
            acos DECIMAL(8,2) DEFAULT 0,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uk_keyword (accountId, keywordId),
            INDEX idx_tier (tier)
          )`,
          `CREATE TABLE IF NOT EXISTS custom_events (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(200) NOT NULL,
            startDate DATE NOT NULL,
            endDate DATE NOT NULL,
            bidMultiplier DECIMAL(5,2) DEFAULT 1.00,
            budgetMultiplier DECIMAL(5,2) DEFAULT 1.00,
            marketplace VARCHAR(10) DEFAULT 'US',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_dates (startDate, endDate)
          )`
        ];
        for (const sql of tables) {
          await db.execute(sql);
        }
        console.log("[v620] Auto-migration completed: 3 tables created/verified");
      } catch (e) {
        console.error("[v620] Auto-migration error:", e.message);
      }
    }
    __name(v620AutoMigrate, "v620AutoMigrate");
    v620AutoMigrate();

    log148.info("[OptimizationScheduler] v167: \u81EA\u52A8\u7EA0\u9519\u670D\u52A1\u5DF2\u542F\u52A8");
  } catch (correctorErr) {
    log148.warn("[OptimizationScheduler] v167: \u81EA\u52A8\u7EA0\u9519\u670D\u52A1\u542F\u52A8\u5931\u8D25:", correctorErr.message);
  }
  try {
    const { startAlignmentScheduler: startAlignmentScheduler2 } = await Promise.resolve().then(() => (init_entityStateAlignment(), entityStateAlignment_exports));
    startAlignmentScheduler2();
    log148.info("[OptimizationScheduler] v523.2: \u5B9E\u4F53\u72B6\u6001\u5BF9\u9F50\u8C03\u5EA6\u5668\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: 30\u5206\u949F");
  } catch (alignErr) {
    log148.warn("[OptimizationScheduler] v523.2: \u5B9E\u4F53\u72B6\u6001\u5BF9\u9F50\u8C03\u5EA6\u5668\u542F\u52A8\u5931\u8D25:", alignErr.message);
  }
  setTimeout(() => {
    executeOptimizationTask("nextgen_maintenance");
  }, 2 * 60 * 1e3);
  optimizationIntervals.nextgen_maintenance = setInterval(async () => {
    await executeOptimizationTask("nextgen_maintenance");
  }, OPTIMIZATION_SCHEDULE.nextgen_maintenance.intervalMs);
  log148.info(`[OptimizationScheduler] v232: NextGen\u7EF4\u62A4\u4EFB\u52A1\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: ${OPTIMIZATION_SCHEDULE.nextgen_maintenance.intervalMs / 6e4}\u5206\u949F\uFF0C\u9996\u6B21\u6267\u884C: 2\u5206\u949F\u540E`);
  optimizationIntervals.nextgen_model_training = setInterval(async () => {
    await executeOptimizationTask("nextgen_model_training");
  }, OPTIMIZATION_SCHEDULE.nextgen_model_training.intervalMs);
  setTimeout(() => {
    executeOptimizationTask("nextgen_model_training");
  }, 10 * 60 * 1e3);
  log148.info(`[OptimizationScheduler] v204: NextGen\u6A21\u578B\u8BAD\u7EC3\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: 6\u5C0F\u65F6\uFF0C\u9996\u6B21\u6267\u884C: 10\u5206\u949F\u540E`);
  optimizationIntervals.nextgen_budget_optimization = setInterval(async () => {
    const now = /* @__PURE__ */ new Date();
    const localHour = getLocalHour(now, "US");
    if (localHour === 2 && shouldExecuteThisHour("nextgen_budget_optimization")) {
      await executeOptimizationTask("nextgen_budget_optimization");
    }
  }, 60 * 60 * 1e3);
  log148.info(`[OptimizationScheduler] v197: NextGen\u9884\u7B97\u4F18\u5316+\u5173\u952E\u8BCD\u56FE\u8C31\u5DF2\u542F\u52A8\uFF0C\u6267\u884C\u65F6\u95F4: \u6BCF\u65E5\u51CC\u66282:00`);
  optimizationIntervals.ab_test_metrics = setInterval(async () => {
    const now = /* @__PURE__ */ new Date();
    const localHour = getLocalHour(now, "US");
    if (localHour === 3 && shouldExecuteThisHour("ab_test_metrics")) {
      try {
        const abTestService = await Promise.resolve().then(() => (init_abTestService(), abTestService_exports));
        const db = await Promise.resolve().then(() => (init_db2(), db_exports));
        const accounts = await db.getAdAccounts();
        for (const account of accounts) {
          const tests = await abTestService.getABTests(account.id);
          const activeTests = tests.filter((t2) => t2.status === "running");
          for (const test2 of activeTests) {
            try {
              const analysis = await abTestService.analyzeABTestResults(test2.id);
              const primaryMetric = analysis.metrics?.[0];
              if (primaryMetric?.isSignificant) {
                log148.info(`[ABTestScheduler] v267: \u6D4B\u8BD5${test2.id}\u5DF2\u8FBE\u5230\u7EDF\u8BA1\u663E\u8457\u6027! \u80DC\u8005: ${analysis.overallWinner}, p\u503C: ${primaryMetric.pValue}`);
              }
              const startDate = test2.startDate ? new Date(test2.startDate) : null;
              const daysSinceStart = startDate ? (Date.now() - startDate.getTime()) / (1e3 * 60 * 60 * 24) : 0;
              if (daysSinceStart > 30) {
                await abTestService.completeABTest(test2.id);
                log148.info(`[ABTestScheduler] v267: \u6D4B\u8BD5${test2.id}\u8D85\u8FC730\u5929\uFF0C\u81EA\u52A8\u5B8C\u6210`);
              }
            } catch (testErr) {
              log148.warn(`[ABTestScheduler] v267: \u5904\u7406\u6D4B\u8BD5${test2.id}\u5931\u8D25: ${testErr.message}`);
            }
          }
        }
        log148.info(`[ABTestScheduler] v267: A/B\u6D4B\u8BD5\u6BCF\u65E5\u6307\u6807\u6536\u96C6\u5B8C\u6210`);
      } catch (err) {
        log148.warn(`[ABTestScheduler] v267: A/B\u6D4B\u8BD5\u8C03\u5EA6\u5931\u8D25: ${err.message}`);
      }
    }
  }, 60 * 60 * 1e3);
  log148.info(`[OptimizationScheduler] v267: A/B\u6D4B\u8BD5\u6307\u6807\u6536\u96C6\u5DF2\u542F\u52A8\uFF0C\u6267\u884C\u65F6\u95F4: \u6BCF\u65E5\u51CC\u6628\u66283:00`);
  monitoringIntervals.push(setInterval(async () => {
    const now = /* @__PURE__ */ new Date();
    const localHour = getLocalHour(now, "US");
    if (localHour === 4 && shouldExecuteThisHour("data_cleanup")) {
      try {
        log148.info("[DataCleanup] v350: \u5F00\u59CB\u81EA\u52A8\u6570\u636E\u6E05\u7406...");
        const { getDirectConnection: getDirectConnection2 } = await Promise.resolve().then(() => (init_db2(), db_exports));
        const conn = await getDirectConnection2(12e4);
        try {
          const RETENTION_DAYS = 30;
          const [r1] = await conn.execute(
            `DELETE FROM sync_conflicts WHERE created_at < DATE_SUB(NOW(), INTERVAL ${sql.raw(String(RETENTION_DAYS))} DAY)`
          );
          const [r2] = await conn.execute(
            `DELETE FROM sync_change_records WHERE created_at < DATE_SUB(NOW(), INTERVAL ${sql.raw(String(RETENTION_DAYS))} DAY)`
          );
          const [r3] = await conn.execute(
            `DELETE FROM system_logs WHERE timestamp < DATE_SUB(NOW(), INTERVAL ${sql.raw(String(RETENTION_DAYS))} DAY)`
          );
          const [r4] = await conn.execute(
            `DELETE FROM optimization_tasks WHERE status IN ('synced', 'permanently_failed') AND created_at < DATE_SUB(NOW(), INTERVAL ${sql.raw(String(RETENTION_DAYS))} DAY)`
          );
          log148.warn(`[DataCleanup] v350: \u81EA\u52A8\u6E05\u7406\u5B8C\u6210 - sync_conflicts:${r1.affectedRows}, sync_change_records:${r2.affectedRows}, system_logs:${r3.affectedRows}, optimization_tasks:${r4.affectedRows}`);
        } finally {
          conn.release();
        }
      } catch (err) {
        log148.warn(`[DataCleanup] v350: \u81EA\u52A8\u6570\u636E\u6E05\u7406\u5931\u8D25: ${err.message}`);
      }
    }
  }, 60 * 60 * 1e3));
  log148.info(`[OptimizationScheduler] v350: \u81EA\u52A8\u6570\u636E\u6E05\u7406\u5DF2\u542F\u52A8\uFF0C\u6267\u884C\u65F6\u95F4: \u6BCF\u65E5\u51CC\u6628\u66684:00 (EST)`);
  try {
    // P5: Check if a dedicated worker process is handling background tasks
    const _p5WorkerActive = process.env.P5_WORKER_ENABLED === "true" && !process.env.P5_IS_WORKER;
    if (_p5WorkerActive) {
      log148.info("[P5] AutoStopLoss delegated to worker process, skipping in web process");
    }
    const { executeFullStopLossScan: executeFullStopLossScan2 } = await Promise.resolve().then(() => (init_autoStopLossService(), autoStopLossService_exports));
    const { getAdAccounts: getAdAccounts2 } = await Promise.resolve().then(() => (init_accounts(), accounts_exports));
    if (!_p5WorkerActive) {
    setTimeout(async () => {
      try {
        const accounts = await getAdAccounts2();
        for (const account of accounts) {
          try {
            await executeFullStopLossScan2(account.id);
          } catch (accountErr) {
            log148.warn(`[AutoStopLoss] \u8D26\u6237${account.id}\u6B62\u8840\u626B\u63CF\u5931\u8D25: ${accountErr.message}`);
          }
        }
      } catch (err) {
        log148.warn(`[AutoStopLoss] \u9996\u6B21\u6B62\u8840\u626B\u63CF\u5931\u8D25: ${err.message}`);
      }
    }, 5 * 60 * 1e3);
    optimizationIntervals.auto_stop_loss = setInterval(async () => {
      try {
        const accounts = await getAdAccounts2();
        for (const account of accounts) {
          try {
            await executeFullStopLossScan2(account.id);
          } catch (accountErr) {
            log148.warn(`[AutoStopLoss] \u8D26\u6237${account.id}\u6B62\u8840\u626B\u63CF\u5931\u8D25: ${accountErr.message}`);
          }
        }
      } catch (err) {
        log148.warn(`[AutoStopLoss] \u5B9A\u65F6\u6B62\u8840\u626B\u63CF\u5931\u8D25: ${err.message}`);
      }
    }, OPTIMIZATION_SCHEDULE.auto_stop_loss.intervalMs);
    log148.info(`[OptimizationScheduler] v503: \u81EA\u52A8\u6B62\u8840\u626B\u63CF\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: ${OPTIMIZATION_SCHEDULE.auto_stop_loss.intervalMs / 36e5}\u5C0F\u65F6\uFF0C\u9996\u6B21\u6267\u884C: 5\u5206\u949F\u540E`);
    } // P5: end of !_p5WorkerActive guard
  } catch (stopLossErr) {
    log148.warn(`[OptimizationScheduler] v503: \u81EA\u52A8\u6B62\u8840\u670D\u52A1\u542F\u52A8\u5931\u8D25: ${stopLossErr.message}`);
  }
  try {
    const { runSystemDefenseScan: runSystemDefenseScan2 } = await Promise.resolve().then(() => (init_systemDefenseService(), systemDefenseService_exports));
    setTimeout(async () => {
      try {
        const scanResult = await runSystemDefenseScan2();
        log148.info(`[SystemDefense] \u9996\u6B21\u626B\u63CF\u5B8C\u6210: ${scanResult.summary}`);
      } catch (firstErr) {
        log148.warn(`[SystemDefense] \u9996\u6B21\u626B\u63CF\u5931\u8D25: ${firstErr.message}`);
      }
    }, 10 * 60 * 1e3);
    optimizationIntervals.system_defense = setInterval(async () => {
      try {
        const scanResult = await runSystemDefenseScan2();
        log148.info(`[SystemDefense] \u5B9A\u65F6\u626B\u63CF\u5B8C\u6210: ${scanResult.summary}`);
      } catch (err) {
        log148.warn(`[SystemDefense] \u5B9A\u65F6\u626B\u63CF\u5931\u8D25: ${err.message}`);
      }
    }, OPTIMIZATION_SCHEDULE.system_defense.intervalMs);
    log148.info(`[OptimizationScheduler] v504: \u7CFB\u7EDF\u9632\u7EBF\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: ${OPTIMIZATION_SCHEDULE.system_defense.intervalMs / 36e5}\u5C0F\u65F6\uFF0C\u9996\u6B21\u6267\u884C: 10\u5206\u949F\u540E`);
  } catch (defenseErr) {
    log148.warn(`[OptimizationScheduler] v504: \u7CFB\u7EDF\u9632\u7EBF\u542F\u52A8\u5931\u8D25: ${defenseErr.message}`);
  }
  try {
    const { scanAndRecoverDataCliffs: scanAndRecoverDataCliffs2 } = await Promise.resolve().then(() => (init_dataCliffAutoRecoveryEngine(), dataCliffAutoRecoveryEngine_exports));
    const { getAdAccounts: getCliffAccounts } = await Promise.resolve().then(() => (init_accounts(), accounts_exports));
    setTimeout(async () => {
      try {
        const accounts = await getCliffAccounts();
        for (const account of accounts) {
          try {
            const result = await scanAndRecoverDataCliffs2(account.id);
            if (result.cliffsDetected > 0) {
              log148.info(`[DataCliffRecovery] \u8D26\u6237${account.id}: \u68C0\u6D4B${result.cliffsDetected}\u4E2A\u65AD\u5D16, \u4FEE\u590D${result.cliffsRepaired}\u4E2A`);
            }
          } catch (accountErr) {
            log148.warn(`[DataCliffRecovery] \u8D26\u6237${account.id}\u65AD\u5D16\u626B\u63CF\u5931\u8D25: ${accountErr.message}`);
          }
        }
      } catch (err) {
        log148.warn(`[DataCliffRecovery] \u9996\u6B21\u65AD\u5D16\u626B\u63CF\u5931\u8D25: ${err.message}`);
      }
    }, 15 * 60 * 1e3);
    optimizationIntervals.data_cliff_recovery = setInterval(async () => {
      try {
        const accounts = await getCliffAccounts();
        for (const account of accounts) {
          try {
            const result = await scanAndRecoverDataCliffs2(account.id);
            if (result.cliffsDetected > 0) {
              log148.info(`[DataCliffRecovery] \u8D26\u6237${account.id}: \u68C0\u6D4B${result.cliffsDetected}\u4E2A\u65AD\u5D16, \u4FEE\u590D${result.cliffsRepaired}\u4E2A`);
            }
          } catch (accountErr) {
            log148.warn(`[DataCliffRecovery] \u8D26\u6237${account.id}\u65AD\u5D16\u626B\u63CF\u5931\u8D25: ${accountErr.message}`);
          }
        }
      } catch (err) {
        log148.warn(`[DataCliffRecovery] \u5B9A\u65F6\u65AD\u5D16\u626B\u63CF\u5931\u8D25: ${err.message}`);
      }
    }, 6 * 3600 * 1e3);
    log148.info(`[OptimizationScheduler] v510: \u6570\u636E\u65AD\u5D16\u4E3B\u52A8\u76D1\u63A7\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: 6\u5C0F\u65F6\uFF0C\u9996\u6B21\u6267\u884C: 15\u5206\u949F\u540E`);
  } catch (cliffErr) {
    log148.warn(`[OptimizationScheduler] v510: \u6570\u636E\u65AD\u5D16\u76D1\u63A7\u542F\u52A8\u5931\u8D25: ${cliffErr.message}`);
  }
  try {
    const { scanAndRecoverDormantTargets: scanAndRecoverDormantTargets2 } = await Promise.resolve().then(() => (init_historicalDataRecoveryService(), historicalDataRecoveryService_exports));
    const { getAdAccounts: getRecoveryAccounts } = await Promise.resolve().then(() => (init_accounts(), accounts_exports));
    setTimeout(async () => {
      try {
        const accounts = await getRecoveryAccounts();
        for (const account of accounts) {
          try {
            const result = await scanAndRecoverDormantTargets2(account.id);
            if (result.recovered > 0) {
              log148.info(`[HistoricalRecovery] \u8D26\u6237${account.id}: \u53D1\u73B0${result.candidatesFound}\u4E2A\u5019\u9009, \u6062\u590D${result.recovered}\u4E2A`);
            }
          } catch (accountErr) {
            log148.warn(`[HistoricalRecovery] \u8D26\u6237${account.id}\u77FF\u6E23\u63D0\u70BC\u5931\u8D25: ${accountErr.message}`);
          }
        }
      } catch (err) {
        log148.warn(`[HistoricalRecovery] \u9996\u6B21\u77FF\u6E23\u63D0\u70BC\u5931\u8D25: ${err.message}`);
      }
    }, 30 * 60 * 1e3);
    optimizationIntervals.historical_recovery = setInterval(async () => {
      try {
        const accounts = await getRecoveryAccounts();
        for (const account of accounts) {
          try {
            const result = await scanAndRecoverDormantTargets2(account.id);
            if (result.recovered > 0) {
              log148.info(`[HistoricalRecovery] \u8D26\u6237${account.id}: \u53D1\u73B0${result.candidatesFound}\u4E2A\u5019\u9009, \u6062\u590D${result.recovered}\u4E2A`);
            }
          } catch (accountErr) {
            log148.warn(`[HistoricalRecovery] \u8D26\u6237${account.id}\u77FF\u6E23\u63D0\u70BC\u5931\u8D25: ${accountErr.message}`);
          }
        }
      } catch (err) {
        log148.warn(`[HistoricalRecovery] \u5B9A\u65F6\u77FF\u6E23\u63D0\u70BC\u5931\u8D25: ${err.message}`);
      }
    }, 7 * 24 * 3600 * 1e3);
    log148.info(`[OptimizationScheduler] v510: \u77FF\u6E23\u63D0\u70BC\u670D\u52A1\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: 7\u5929\uFF0C\u9996\u6B21\u6267\u884C: 30\u5206\u949F\u540E`);
  } catch (recoveryErr) {
    log148.warn(`[OptimizationScheduler] v510: \u77FF\u6E23\u63D0\u70BC\u670D\u52A1\u542F\u52A8\u5931\u8D25: ${recoveryErr.message}`);
  }
}
function stopOptimizationScheduler2() {
  Object.keys(optimizationIntervals).forEach((type) => {
    const interval = optimizationIntervals[type];
    if (interval) {
      clearInterval(interval);
      optimizationIntervals[type] = null;
    }
  });
  log148.debug("[OptimizationScheduler] \u5206\u5C42\u4F18\u5316\u8C03\u5EA6\u5668\u5DF2\u505C\u6B62");
  try {
    stopAutoCorrector();
  } catch (e) {
    log148.debug(`\u505C\u6B62AutoCorrector\u65F6\u5FFD\u7565: ${e.message}`);
  }
}
async function executeOptimizationTask(taskType) {
  try {
    const { isDeployRecoveryComplete: isDeployRecoveryComplete2 } = await Promise.resolve().then(() => (init_deployLifecycleManager(), deployLifecycleManager_exports));
    if (!isDeployRecoveryComplete2()) {
      log148.info(`[OptimizationScheduler] v491: \u90E8\u7F72\u6062\u590D\u5C1A\u672A\u5B8C\u6210\uFF08\u7EA0\u9519/\u9A8C\u8BC1\u8FDB\u884C\u4E2D\uFF09\uFF0C\u8DF3\u8FC7\u5B9A\u671F\u4F18\u5316\u4EFB\u52A1: ${taskType}`);
      return;
    }
  } catch (gateErr) {
    log148.warn(`[OptimizationScheduler] v491: \u90E8\u7F72\u6062\u590D\u95E8\u63A7\u68C0\u67E5\u5931\u8D25\uFF0C\u9ED8\u8BA4\u5141\u8BB8\u6267\u884C: ${gateErr.message}`);
  }
  if (!acquireLock(taskType)) return;
  const mem = process.memoryUsage();
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
  const { memoryConfig: memoryConfig2 } = (init_systemConfigService2(), __toCommonJS(systemConfigService_exports2));
  const MEMORY_CRITICAL_MB = memoryConfig2.rssCriticalMB;
  const MEMORY_WARNING_MB = memoryConfig2.rssWarningMB;
  const criticalTasks = ["daily_bid_optimization", "risk_scan", "intraday_pacing", "dayparting_adjustment"];
  const isCritical = criticalTasks.includes(taskType);
  if (rssMB > MEMORY_CRITICAL_MB) {
    log148.warn(`[OptimizationScheduler] v347: \u5185\u5B58\u5371\u6025(RSS=${rssMB}MB, heap=${heapUsedMB}/${heapTotalMB}MB)\uFF0C\u8DF3\u8FC7\u4EFB\u52A1: ${taskType}`);
    if (typeof global.gc === "function") global.gc();
    releaseLock2(taskType);
    return;
  }
  if (rssMB > MEMORY_WARNING_MB && !isCritical) {
    log148.warn(`[OptimizationScheduler] v347: \u5185\u5B58\u7D27\u5F20(RSS=${rssMB}MB, heap=${heapUsedMB}/${heapTotalMB}MB)\uFF0C\u8DF3\u8FC7\u975E\u5173\u952E\u4EFB\u52A1: ${taskType}`);
    if (typeof global.gc === "function") global.gc();
    releaseLock2(taskType);
    return;
  }
  const config2 = OPTIMIZATION_SCHEDULE[taskType];
  log148.info(`[OptimizationScheduler] \u5F00\u59CB\u6267\u884C: ${config2.description} - RSS=${rssMB}MB, heap=${heapUsedMB}/${heapTotalMB}MB - ${(/* @__PURE__ */ new Date()).toISOString()}`);
  try {
    const { executeAllEnabledTargets: executeAllEnabledTargets2, getEnabledOptimizationTargets: getEnabledOptimizationTargets2 } = await Promise.resolve().then(() => (init_optimizationTargetEngine(), optimizationTargetEngine_exports));
    switch (taskType) {
      // ==================== 日内节奏监控（每30分钟）====================
      case "intraday_pacing": {
        log148.info(`[OptimizationScheduler] \u6267\u884C\u65E5\u5185\u8282\u594F\u76D1\u63A7`);
        try {
          const { checkAllCampaignsPacing: checkAllCampaignsPacing2, applyIntradayAdjustment: applyIntradayAdjustment2 } = await Promise.resolve().then(() => (init_intradayPacingService(), intradayPacingService_exports));
          const targets = await getEnabledOptimizationTargets2();
          const checkedAccountIds = /* @__PURE__ */ new Set();
          for (const target of targets) {
            if (checkedAccountIds.has(target.accountId)) continue;
            checkedAccountIds.add(target.accountId);
            try {
              const adjustments = await checkAllCampaignsPacing2(target.accountId);
              const criticalCount = adjustments.filter((a) => a.pacingStatus === "critical" || a.anomalyDetected).length;
              const overspendCount = adjustments.filter((a) => a.pacingStatus === "overspending").length;
              const underspendCount = adjustments.filter((a) => a.pacingStatus === "underspending").length;
              for (const adj of adjustments) {
                if (adj.suggestedAction !== "none" && (adj.pacingStatus === "critical" || adj.pacingStatus === "overspending")) {
                  await applyIntradayAdjustment2(adj);
                }
              }
              log148.info(`[OptimizationScheduler] \u8D26\u53F7 ${target.accountId} \u65E5\u5185\u8282\u594F\u68C0\u67E5\u5B8C\u6210: ${adjustments.length}\u4E2ACampaign, \u5371\u6025=${criticalCount}, \u8D85\u901F=${overspendCount}, \u6B20\u901F=${underspendCount}`);
            } catch (pacingError) {
              log148.warn(`[OptimizationScheduler] \u8D26\u53F7 ${target.accountId} \u65E5\u5185\u8282\u594F\u68C0\u67E5\u5F02\u5E38:`, pacingError.message);
            }
          }
        } catch (pacingError) {
          log148.warn(`[OptimizationScheduler] \u65E5\u5185\u8282\u594F\u76D1\u63A7\u5F02\u5E38:`, pacingError.message);
        }
        break;
      }
      // ==================== 高频风控扫描（每2小时，仅风控）====================
      case "risk_scan": {
        log148.info(`[OptimizationScheduler] \u6267\u884C\u98CE\u63A7\u626B\u63CF(\u4EC5\u98CE\u63A7\uFF0C\u4E0D\u542B\u4F18\u5316)`);
        try {
          const targets = await getEnabledOptimizationTargets2();
          const scannedAccountIds = /* @__PURE__ */ new Set();
          for (const target of targets) {
            if (scannedAccountIds.has(target.accountId)) continue;
            scannedAccountIds.add(target.accountId);
            try {
              const riskCampaigns = await getCampaignsByAccountId(target.accountId);
              const enabledCampaigns = riskCampaigns.filter((c) => c.campaignStatus === "enabled");
              let totalRisks = 0;
              for (const campaign of enabledCampaigns) {
                const riskResult = await detectRiskSignals(target.accountId, campaign.campaignId);
                if (riskResult.hasRisk) {
                  totalRisks += riskResult.risks.length;
                  for (const risk of riskResult.risks) {
                    log148.warn(`[RiskScan] Campaign ${campaign.campaignName}: [${risk.severity}] ${risk.description}`);
                  }
                }
              }
              log148.info(`[OptimizationScheduler] \u8D26\u53F7 ${target.accountId} \u98CE\u63A7\u626B\u63CF\u5B8C\u6210: ${enabledCampaigns.length}\u4E2ACampaign, ${totalRisks}\u4E2A\u98CE\u9669\u4FE1\u53F7`);
            } catch (riskError) {
              log148.warn(`[OptimizationScheduler] \u8D26\u53F7 ${target.accountId} \u98CE\u63A7\u626B\u63CF\u5F02\u5E38:`, riskError.message);
            }
          }
        } catch (riskError) {
          log148.warn(`[OptimizationScheduler] \u98CE\u63A7\u626B\u63CF\u5F02\u5E38:`, riskError.message);
        }
        break;
      }
      // ==================== 分时竞价调整（每小时）====================
      case "dayparting_adjustment": {
        log148.info(`[OptimizationScheduler] \u6267\u884C\u5206\u65F6\u7ADE\u4EF7\u8C03\u6574`);
        try {
          const daypartingResults = await executeAllEnabledTargets2(void 0, {
            dryRun: false,
            specificModules: ["multidim", "dayparting", "coordination"]
          });
          log148.info(`[OptimizationScheduler] \u5206\u65F6\u7ADE\u4EF7\u8C03\u6574\u5B8C\u6210: ${daypartingResults.length}\u4E2A\u76EE\u6807`);
          for (const r of daypartingResults) {
            log148.debug(`  - ${r.targetName}: \u5206\u65F6\u8C03\u6574=${r.daypartingOptimization.adjustmentsCount}`);
          }
          for (const r of daypartingResults) {
            if (r.status !== "failed") {
              try {
                await recordModuleExecution(r.targetId, "dayparting");
              } catch (recErr) {
                log148.warn(`[OptimizationScheduler] v351: recordModuleExecution(dayparting)\u5931\u8D25: ${recErr.message}`);
              }
            }
          }
        } catch (daypartingError) {
          log148.warn(`[OptimizationScheduler] \u5206\u65F6\u7ADE\u4EF7\u8C03\u6574\u5931\u8D25:`, daypartingError.message);
        }
        break;
      }
      // ==================== v179: 分时预算调整（每天凌昨6:00）====================
      case "dayparting_budget": {
        log148.info(`[OptimizationScheduler] v179: \u6267\u884C\u5206\u65F6\u9884\u7B97\u8C03\u6574`);
        try {
          const daypartingBudgetResults = await executeAllEnabledTargets2(void 0, {
            dryRun: false,
            specificModules: ["multidim", "dayparting_budget"]
          });
          log148.info(`[OptimizationScheduler] v179: \u5206\u65F6\u9884\u7B97\u8C03\u6574\u5B8C\u6210: ${daypartingBudgetResults.length}\u4E2A\u76EE\u6807`);
          for (const r of daypartingBudgetResults) {
            log148.debug(`  - ${r.targetName}: \u5206\u65F6\u9884\u7B97\u8C03\u6574=${r.daypartingBudgetOptimization?.adjustmentsCount || 0}`);
          }
        } catch (daypartingBudgetError) {
          log148.warn(`[OptimizationScheduler] v179: \u5206\u65F6\u9884\u7B97\u8C03\u6574\u5931\u8D25:`, daypartingBudgetError.message);
        }
        break;
      }
      // ==================== v143: 出价智能优化（生命周期感知）====================
      case "daily_bid_optimization": {
        log148.info(`[OptimizationScheduler] \u51FA\u4EF7\u4F18\u5316\u89E6\u53D1\uFF0C\u5F00\u59CB\u751F\u547D\u5468\u671F\u611F\u77E5\u6267\u884C...`);
        try {
          const targets = await getEnabledOptimizationTargets2();
          let executedCount = 0;
          let skippedCount = 0;
          for (const target of targets) {
            const stage = target.lifecycleStage || "mature";
            const check2 = shouldExecuteModuleForTarget(target.id, "bid", stage);
            if (!check2.shouldExecute) {
              skippedCount++;
              log148.info(`[OptimizationScheduler] \u8DF3\u8FC7\u51FA\u4EF7\u4F18\u5316: ${target.name} (${check2.reason})`);
              continue;
            }
            try {
              const { executeOptimizationTarget: executeOptimizationTarget2 } = await Promise.resolve().then(() => (init_optimizationTargetEngine(), optimizationTargetEngine_exports));
              const result = await executeOptimizationTarget2(target.id, {
                dryRun: false,
                specificModules: ["bid", "keyword", "coordination"]
              });
              await recordModuleExecution(target.id, "bid");
              executedCount++;
              log148.debug(`  - ${target.name} [${stage}]: \u51FA\u4EF7\u8C03\u6574=${result.bidOptimization.adjustmentsCount}, \u5173\u952E\u8BCD\u6682\u505C=${result.keywordStatusChanges.pausedCount}`);
            } catch (targetErr) {
              log148.warn(`  - ${target.name} \u51FA\u4EF7\u4F18\u5316\u5931\u8D25: ${targetErr.message}`);
            }
          }
          log148.info(`[OptimizationScheduler] v273\u51FA\u4EF7\u4F18\u5316\u5B8C\u6210: \u6267\u884C=${executedCount}, \u8DF3\u8FC7=${skippedCount}, \u603B\u76EE\u6807=${targets.length}, \u65F6\u95F4=${(/* @__PURE__ */ new Date()).toISOString()}`);
        } catch (bidError) {
          log148.warn(`[OptimizationScheduler] \u51FA\u4EF7\u4F18\u5316\u5931\u8D25:`, bidError.message);
        }
        break;
      }
      // ==================== v143: 位置优化（生命周期感知）====================
      case "daily_placement_optimization": {
        log148.info(`[OptimizationScheduler] \u4F4D\u7F6E\u4F18\u5316\u89E6\u53D1\uFF0C\u5F00\u59CB\u751F\u547D\u5468\u671F\u611F\u77E5\u6267\u884C...`);
        try {
          const targets = await getEnabledOptimizationTargets2();
          let executedCount = 0;
          let skippedCount = 0;
          for (const target of targets) {
            const stage = target.lifecycleStage || "mature";
            const check2 = shouldExecuteModuleForTarget(target.id, "placement", stage);
            if (!check2.shouldExecute) {
              skippedCount++;
              log148.info(`[OptimizationScheduler] \u8DF3\u8FC7\u4F4D\u7F6E\u4F18\u5316: ${target.name} (${check2.reason})`);
              continue;
            }
            try {
              const { executeOptimizationTarget: executeOptimizationTarget2 } = await Promise.resolve().then(() => (init_optimizationTargetEngine(), optimizationTargetEngine_exports));
              const result = await executeOptimizationTarget2(target.id, {
                dryRun: false,
                specificModules: ["placement"]
              });
              await recordModuleExecution(target.id, "placement");
              executedCount++;
              log148.debug(`  - ${target.name} [${stage}]: \u4F4D\u7F6E\u8C03\u6574=${result.placementOptimization.adjustmentsCount}`);
            } catch (targetErr) {
              log148.warn(`  - ${target.name} \u4F4D\u7F6E\u4F18\u5316\u5931\u8D25: ${targetErr.message}`);
            }
          }
          log148.info(`[OptimizationScheduler] \u4F4D\u7F6E\u4F18\u5316\u5B8C\u6210: \u6267\u884C=${executedCount}, \u8DF3\u8FC7=${skippedCount}`);
        } catch (placementError) {
          log148.warn(`[OptimizationScheduler] \u4F4D\u7F6E\u4F18\u5316\u5931\u8D25:`, placementError.message);
        }
        break;
      }
      // ==================== v143: 搜索词否定（生命周期感知）====================
      case "daily_search_term_negation": {
        log148.info(`[OptimizationScheduler] \u641C\u7D22\u8BCD\u5426\u5B9A\u89E6\u53D1\uFF0C\u5F00\u59CB\u751F\u547D\u5468\u671F\u611F\u77E5\u6267\u884C...`);
        try {
          const targets = await getEnabledOptimizationTargets2();
          let executedCount = 0;
          let skippedCount = 0;
          for (const target of targets) {
            const stage = target.lifecycleStage || "mature";
            const check2 = shouldExecuteModuleForTarget(target.id, "negativeKeyword", stage);
            if (!check2.shouldExecute) {
              skippedCount++;
              log148.info(`[OptimizationScheduler] \u8DF3\u8FC7\u641C\u7D22\u8BCD\u5426\u5B9A: ${target.name} (${check2.reason})`);
              continue;
            }
            try {
              const { executeOptimizationTarget: executeOptimizationTarget2 } = await Promise.resolve().then(() => (init_optimizationTargetEngine(), optimizationTargetEngine_exports));
              const result = await executeOptimizationTarget2(target.id, {
                dryRun: false,
                specificModules: ["searchterm"]
              });
              await recordModuleExecution(target.id, "negativeKeyword");
              executedCount++;
              log148.debug(`  - ${target.name} [${stage}]: \u5426\u5B9A\u8BCD\u6DFB\u52A0=${result.searchTermAnalysis.negativeKeywordsAdded}, \u65B0\u5173\u952E\u8BCD=${result.searchTermAnalysis.newKeywordsAdded}`);
            } catch (targetErr) {
              log148.warn(`  - ${target.name} \u641C\u7D22\u8BCD\u5426\u5B9A\u5931\u8D25: ${targetErr.message}`);
            }
          }
          log148.info(`[OptimizationScheduler] \u641C\u7D22\u8BCD\u5426\u5B9A\u5B8C\u6210: \u6267\u884C=${executedCount}, \u8DF3\u8FC7=${skippedCount}`);
        } catch (searchTermError) {
          log148.warn(`[OptimizationScheduler] \u641C\u7D22\u8BCD\u5426\u5B9A\u5931\u8D25:`, searchTermError.message);
        }
        break;
      }
      // ==================== v143: 预算智能分配（生命周期感知）====================
      case "budget_allocation": {
        log148.info(`[OptimizationScheduler] \u9884\u7B97\u5206\u914D\u89E6\u53D1\uFF0C\u5F00\u59CB\u751F\u547D\u5468\u671F\u611F\u77E5\u6267\u884C...`);
        try {
          const targets = await getEnabledOptimizationTargets2();
          let executedCount = 0;
          let skippedCount = 0;
          for (const target of targets) {
            const stage = target.lifecycleStage || "mature";
            const check2 = shouldExecuteModuleForTarget(target.id, "budget", stage);
            if (!check2.shouldExecute) {
              skippedCount++;
              log148.info(`[OptimizationScheduler] \u8DF3\u8FC7\u9884\u7B97\u5206\u914D: ${target.name} (${check2.reason})`);
              continue;
            }
            try {
              const { executeOptimizationTarget: executeOptimizationTarget2 } = await Promise.resolve().then(() => (init_optimizationTargetEngine(), optimizationTargetEngine_exports));
              const result = await executeOptimizationTarget2(target.id, {
                dryRun: false,
                specificModules: ["budget"]
              });
              await recordModuleExecution(target.id, "budget");
              executedCount++;
              log148.debug(`  - ${target.name} [${stage}]: \u9884\u7B97\u8C03\u6574=${result.budgetAllocation.adjustmentsCount}`);
            } catch (targetErr) {
              log148.warn(`  - ${target.name} \u9884\u7B97\u5206\u914D\u5931\u8D25: ${targetErr.message}`);
            }
          }
          log148.info(`[OptimizationScheduler] \u9884\u7B97\u5206\u914D\u5B8C\u6210: \u6267\u884C=${executedCount}, \u8DF3\u8FC7=${skippedCount}`);
          try {
            const { checkAndExecutePendingTasks: checkAndExecutePendingTasks2 } = await Promise.resolve().then(() => (init_budgetAutoExecutionService(), budgetAutoExecutionService_exports));
            const autoExecResult = await checkAndExecutePendingTasks2();
            log148.info(`[OptimizationScheduler] v267: \u9884\u7B97\u81EA\u52A8\u6267\u884C\u5B8C\u6210: \u6267\u884C=${autoExecResult.executed}, \u5931\u8D25=${autoExecResult.failed}, \u9519\u8BEF\u6570=${autoExecResult.errors.length}`);
          } catch (autoExecErr) {
            log148.warn(`[OptimizationScheduler] v267: \u9884\u7B97\u81EA\u52A8\u6267\u884C\u5931\u8D25:`, autoExecErr.message);
          }
        } catch (budgetError) {
          log148.warn(`[OptimizationScheduler] \u9884\u7B97\u5206\u914D\u5931\u8D25:`, budgetError.message);
        }
        break;
      }
      // ==================== 搜索词收割（周一凌晨5:00）====================
      case "search_term_harvest": {
        log148.info(`[OptimizationScheduler] \u6267\u884C\u641C\u7D22\u8BCD\u6536\u5272`);
        try {
          const targets = await getEnabledOptimizationTargets2();
          const harvestedAccountIds = /* @__PURE__ */ new Set();
          for (const target of targets) {
            if (harvestedAccountIds.has(target.accountId)) continue;
            harvestedAccountIds.add(target.accountId);
            try {
              const harvestResult = await batchHarvestSearchTerms(
                target.accountId,
                { dryRun: false }
              );
              log148.info(`[OptimizationScheduler] \u8D26\u53F7 ${target.accountId} \u641C\u7D22\u8BCD\u6536\u5272\u5B8C\u6210: \u5019\u9009=${harvestResult.summary.total}, \u6210\u529F=${harvestResult.summary.success}, \u5931\u8D25=${harvestResult.summary.failed}, \u56DE\u6EDA=${harvestResult.summary.rolledBack}`);
            } catch (harvestError) {
              log148.warn(`[OptimizationScheduler] \u8D26\u53F7 ${target.accountId} \u641C\u7D22\u8BCD\u6536\u5272\u5F02\u5E38:`, harvestError.message);
            }
          }
        } catch (harvestError) {
          log148.warn(`[OptimizationScheduler] \u641C\u7D22\u8BCD\u6536\u5272\u5F02\u5E38:`, harvestError.message);
        }
        break;
      }
      // ==================== 绩效周报（周一上午9:00）====================
      case "weekly_report": {
        log148.debug(`[OptimizationScheduler] \u751F\u6210\u7EE9\u6548\u5468\u62A5`);
        break;
      }
      // ==================== v197: NextGen维护任务 ====================
      case "nextgen_maintenance": {
        log148.info(`[OptimizationScheduler] v197: NextGen\u7EF4\u62A4\u4EFB\u52A1\u89E6\u53D1...`);
        try {
          const targets = await getEnabledOptimizationTargets2();
          for (const target of targets) {
            try {
              const result = await executeNextGenMaintenanceTasks(target.accountId);
              log148.debug(`  - \u8D26\u6237${target.accountId}: \u7279\u5F81\u7F13\u5B58=${result.featuresCached}, Sigmoid\u62DF\u5408=${result.sigmoidFitted.fitted}, Reward\u56DE\u586B=${result.rewardsBackfilled}, \u56E0\u679C\u5206\u6790=${result.causalAnalysis.analyzed}`);
            } catch (err) {
              log148.warn(`  - \u8D26\u6237${target.accountId} NextGen\u7EF4\u62A4\u5931\u8D25: ${err.message}`);
            }
          }
          try {
            const { backfillBidPerformanceResults: backfillBidPerformanceResults2 } = await Promise.resolve().then(() => (init_rlDataRecorder(), rlDataRecorder_exports));
            const backfillResult = await backfillBidPerformanceResults2();
            log148.info(`[OptimizationScheduler] v230: bidPerformanceHistory\u56DE\u586B\u5B8C\u6210: updated=${backfillResult.updated}, skipped=${backfillResult.skipped}`);
          } catch (bErr) {
            log148.warn(`[OptimizationScheduler] v230: bidPerformanceHistory\u56DE\u586B\u5931\u8D25: ${bErr.message}`);
          }
        } catch (err) {
          log148.warn(`[OptimizationScheduler] v197: NextGen\u7EF4\u62A4\u5931\u8D25:`, err.message);
        }
        break;
      }
      // ==================== v197: NextGen模型训练 ====================
      case "nextgen_model_training": {
        log148.info(`[OptimizationScheduler] v197: NextGen\u6A21\u578B\u8BAD\u7EC3\u89E6\u53D1...`);
        try {
          const targets = await getEnabledOptimizationTargets2();
          for (const target of targets) {
            try {
              await executeModelTraining(target.accountId);
              log148.info(`  - \u8D26\u6237${target.accountId}: CQL\u6A21\u578B\u8BAD\u7EC3\u5B8C\u6210`);
            } catch (err) {
              log148.warn(`  - \u8D26\u6237${target.accountId} CQL\u8BAD\u7EC3\u5931\u8D25: ${err.message}`);
            }
          }
        } catch (err) {
          log148.warn(`[OptimizationScheduler] v197: \u6A21\u578B\u8BAD\u7EC3\u5931\u8D25:`, err.message);
        }
        break;
      }
      // ==================== v197: NextGen预算优化+关键词图谱 ====================
      case "nextgen_budget_optimization": {
        log148.info(`[OptimizationScheduler] v197: NextGen\u9884\u7B97\u4F18\u5316+\u5173\u952E\u8BCD\u56FE\u8C31\u89E6\u53D1...`);
        try {
          const targets = await getEnabledOptimizationTargets2();
          for (const target of targets) {
            try {
              await executeBudgetOptimization(target.accountId);
              log148.info(`  - \u8D26\u6237${target.accountId}: \u9884\u7B97\u7EC4\u5408\u4F18\u5316\u5B8C\u6210`);
            } catch (err) {
              log148.warn(`  - \u8D26\u6237${target.accountId} \u9884\u7B97\u4F18\u5316\u5931\u8D25: ${err.message}`);
            }
            try {
              await executeKeywordGraphAnalysis(target.accountId);
              log148.info(`  - \u8D26\u6237${target.accountId}: \u5173\u952E\u8BCD\u56FE\u8C31\u5206\u6790\u5B8C\u6210`);
            } catch (err) {
              log148.warn(`  - \u8D26\u6237${target.accountId} \u5173\u952E\u8BCD\u56FE\u8C31\u5931\u8D25: ${err.message}`);
            }
          }
        } catch (err) {
          log148.warn(`[OptimizationScheduler] v197: \u9884\u7B97\u4F18\u5316\u5931\u8D25:`, err.message);
        }
        break;
      }
    }
    log148.info(`[OptimizationScheduler] ${config2.description} \u6267\u884C\u5B8C\u6210`);
  } catch (error48) {
    log148.warn(`[OptimizationScheduler] ${taskType} \u6267\u884C\u5931\u8D25:`, error48.message);
  } finally {
    releaseLock2(taskType);
  }
}
async function verifySyncHealth() {
  try {
    const database = await getDb();
    if (!database) return;
    const recentJobs = await database.execute(sql`
      SELECT accountId as account_id, status, syncType as sync_type, completedAt as completed_at, errorMessage as error_message
      FROM data_sync_jobs 
      WHERE createdAt > DATE_SUB(NOW(), INTERVAL 2 HOUR)
      ORDER BY createdAt DESC
      LIMIT 20
    `);
    const jobs = recentJobs?.[0] || [];
    const successCount = jobs.filter((j) => j.status === "completed").length;
    const failCount = jobs.filter((j) => j.status === "failed").length;
    if (jobs.length === 0) {
      consecutiveFailures++;
      log148.warn(`[DataSyncScheduler] v336: \u540C\u6B65\u5065\u5EB7\u544A\u8B66 - \u6700\u8FD12\u5C0F\u65F6\u65E0\u540C\u6B65\u8BB0\u5F55 (\u8FDE\u7EED\u5931\u8D25: ${consecutiveFailures})`);
    } else if (failCount > 0 && successCount === 0) {
      consecutiveFailures++;
      log148.warn(`[DataSyncScheduler] v336: \u540C\u6B65\u5065\u5EB7\u544A\u8B66 - \u6700\u8FD1${jobs.length}\u6B21\u540C\u6B65\u5168\u90E8\u5931\u8D25 (\u8FDE\u7EED\u5931\u8D25: ${consecutiveFailures})`);
    } else {
      consecutiveFailures = 0;
      log148.info(`[DataSyncScheduler] v336: \u540C\u6B65\u5065\u5EB7\u68C0\u67E5\u901A\u8FC7 - \u6210\u529F:${successCount}, \u5931\u8D25:${failCount}`);
    }
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      const { optimizationEvents: optimizationEvents9 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
      const { SYSTEM_VERSION: SYSTEM_VERSION2 } = await Promise.resolve().then(() => (init_systemVersion(), systemVersion_exports));
      const alertDetail = JSON.stringify({
        type: "sync_health_alert",
        systemVersion: SYSTEM_VERSION2,
        consecutiveFailures,
        // @ts-ignore
        recentJobs: jobs.slice(0, 5).map((j) => ({
          accountId: j.account_id,
          status: j.status,
          syncType: j.sync_type,
          // @ts-ignore
          error: j.error_message?.substring(0, 200)
        })),
        alertTime: (/* @__PURE__ */ new Date()).toISOString()
      });
      await database.insert(optimizationEvents9).values({
        accountId: 0,
        eventCategory: "settings_change",
        actionType: "auto_correction",
        actionDetail: alertDetail,
        changeReason: `v${SYSTEM_VERSION2} \u540C\u6B65\u5065\u5EB7\u544A\u8B66: \u8FDE\u7EED${consecutiveFailures}\u6B21\u540C\u6B65\u5931\u8D25`,
        algorithmVersion: `v${SYSTEM_VERSION2}`,
        status: "failed",
        apiSyncStatus: "not_applicable"
      });
      log148.warn(`[DataSyncScheduler] v336: \u2757 \u540C\u6B65\u5065\u5EB7\u4E25\u91CD\u544A\u8B66 - \u8FDE\u7EED${consecutiveFailures}\u6B21\u540C\u6B65\u5931\u8D25\uFF0C\u5DF2\u8BB0\u5F55\u544A\u8B66\u4E8B\u4EF6`);
      consecutiveFailures = 0;
    }
  } catch (err) {
    log148.warn(`[DataSyncScheduler] v336: \u540C\u6B65\u5065\u5EB7\u68C0\u67E5\u5F02\u5E38: ${err.message}`);
  }
}
async function triggerImmediateSync(accountId, reason) {
  log148.info(`[DataSyncScheduler] v336: \u4E8B\u4EF6\u9A71\u52A8\u540C\u6B65\u89E6\u53D1 - \u8D26\u6237${accountId}, \u539F\u56E0: ${reason}`);
  logSync("DataSyncScheduler", `v336: \u4E8B\u4EF6\u9A71\u52A8\u540C\u6B65`, { accountId, reason });
  try {
    setTimeout(async () => {
      try {
        const { syncAllAccounts: syncAllAccounts2 } = await Promise.resolve().then(() => (init_unifiedSyncEngine(), unifiedSyncEngine_exports));
        const result = await syncAllAccounts2("full");
        log148.info(`[DataSyncScheduler] v336: \u4E8B\u4EF6\u9A71\u52A8\u540C\u6B65\u5B8C\u6210 - \u8D26\u6237${accountId}, \u539F\u56E0: ${reason}, \u6210\u529F: ${result.successfulAccounts}/${result.totalAccounts}`);
        await verifySyncHealth();
      } catch (syncErr) {
        log148.warn(`[DataSyncScheduler] v336: \u4E8B\u4EF6\u9A71\u52A8\u540C\u6B65\u5931\u8D25 - \u8D26\u6237${accountId}: ${syncErr.message}`);
        logSyncError("DataSyncScheduler", `v336: \u4E8B\u4EF6\u9A71\u52A8\u540C\u6B65\u5931\u8D25`, { accountId, reason, error: syncErr.message });
      }
    }, 5 * 1e3);
  } catch (err) {
    log148.warn(`[DataSyncScheduler] v336: \u4E8B\u4EF6\u9A71\u52A8\u540C\u6B65\u89E6\u53D1\u5F02\u5E38: ${err.message}`);
  }
}
function getSyncHealthStatus() {
  return {
    consecutiveFailures,
    lastSyncTime: schedulerStatus2.lastRunTime,
    isRunning: schedulerStatus2.isRunning
  };
}
function isSyncRunning() {
  if (schedulerStatus2.isRunning || Object.values(executionLocks).some((v) => v)) {
    return true;
  }
  try {
    const { getEngineStatus: getEngineStatus2 } = (init_unifiedSyncEngine(), __toCommonJS(unifiedSyncEngine_exports));
    const engineStatus2 = getEngineStatus2();
    if (engineStatus2.currentlyRunning && engineStatus2.currentlyRunning.length > 0) {
      return true;
    }
  } catch {
  }
  return false;
}
var log148, SYNC_TIER_CONFIG, schedulerStatus2, schedulerIntervals, monitoringIntervals, requestQueue, isProcessingQueue, TIER_COOLDOWN_MS, MUTEX_POLL_INTERVAL_MS, MUTEX_MAX_WAIT_MS, COORDINATOR_CLEANUP_INTERVAL_MS, frequencyToMs, tierRunningState, schedulerSkipCount, OPTIMIZATION_SCHEDULE, optimizationIntervals, executionLocks, lastExecutionHour, getModuleLockGroup2, acquireAccountOptimizationLock2, releaseAccountOptimizationLock2, acquireAccountOptimizationLockWithRetry2, moduleLastExecutionMap, consecutiveFailures, MAX_CONSECUTIVE_FAILURES;
var init_dataSyncScheduler = __esm({
  "server/sync/dataSyncScheduler.ts"() {
    "use strict";
    init_db2();
    init_drizzle_orm();
    init_amazonSyncService();
    init_notification();
    init_algorithmUtils();
    init_searchTermHarvester();
    init_attributionWindowHelper();
    init_campaignLifecycleService();
    init_optimizationAutoCorrector();
    init_nextGenBidOrchestrator();
    init_logger();
    init_opsLogger();
    init_lockManager();
    init_syncCoordinator();
    init_bulkheadService();
    log148 = createModuleLogger("Scheduler");
    SYNC_TIER_CONFIG = {
      high: {
        intervalMs: 30 * 60 * 1e3,
        // v488: 30分钟（从15分钟调整，降低API压力，优先保证精准）
        description: "v488: \u9AD8\u9891\u540C\u6B65 - \u5E7F\u544A\u6D3B\u52A8\u72B6\u6001\u548C\u9884\u7B97\uFF0C\u6BCF30\u5206\u949F",
        syncTypes: ["campaigns_status", "budgets"]
      },
      medium: {
        intervalMs: 60 * 60 * 1e3,
        // v488: 60分钟（从30分钟调整，与高频同步错开）
        description: "v488: \u4E2D\u9891\u540C\u6B65 - \u5E7F\u544A\u7EC4\u3001\u5173\u952E\u8BCD\u3001\u5B9A\u4F4D\uFF0C\u6BCF60\u5206\u949F",
        syncTypes: ["ad_groups", "keywords", "targets"]
      },
      low: {
        intervalMs: 60 * 60 * 1e3,
        // 1小时
        description: "\u4F4E\u9891\u540C\u6B65 - \u5B8C\u6574\u6570\u636E\u540C\u6B65",
        syncTypes: ["full_sync"]
      },
      full: {
        intervalMs: 3 * 60 * 60 * 1e3,
        // v488: 3小时（从2小时调整，给API令牌桶充足的恢复时间）
        description: "v488: \u5B8C\u6574\u540C\u6B65 - \u6240\u6709\u6570\u636E\uFF08SP 90\u5929/SB 60\u5929/SD 90\u5929\uFF09\uFF0C\u6BCF3\u5C0F\u65F6",
        syncTypes: ["all"]
      },
      nightly: {
        intervalMs: 24 * 60 * 60 * 1e3,
        // v403: 24小时（每日凌晨执行一次）
        description: "v488: \u591C\u95F4\u540C\u6B65 - \u8017\u65F6\u6700\u957F\u7684\u5173\u952E\u8BCD/\u5B9A\u4F4D/\u5E7F\u544A\u7EC4\u7EE9\u6548\u62A5\u8868\uFF0C\u8D85\u65F6\u65F6\u95F44\u5C0F\u65F6",
        syncTypes: ["keyword_performance", "target_performance", "ad_group_performance"]
      }
    };
    schedulerStatus2 = {
      isRunning: false,
      lastRunTime: null,
      nextRunTime: null,
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      errors: [],
      currentTier: null,
      tierLastRun: {
        high: null,
        medium: null,
        low: null,
        full: null,
        nightly: null
      }
    };
    schedulerIntervals = {
      high: null,
      medium: null,
      low: null,
      full: null,
      nightly: null,
      confirmation: null
    };
    monitoringIntervals = [];
    requestQueue = [];
    isProcessingQueue = false;
    TIER_COOLDOWN_MS = 30 * 1e3;
    MUTEX_POLL_INTERVAL_MS = 10 * 1e3;
    MUTEX_MAX_WAIT_MS = 5 * 60 * 1e3;
    COORDINATOR_CLEANUP_INTERVAL_MS = 10 * 60 * 1e3;
    frequencyToMs = {
      "every_15_minutes": 15 * 60 * 1e3,
      "every_30_minutes": 30 * 60 * 1e3,
      "hourly": 60 * 60 * 1e3,
      "every_2_hours": 2 * 60 * 60 * 1e3,
      "every_4_hours": 4 * 60 * 60 * 1e3,
      "every_6_hours": 6 * 60 * 60 * 1e3,
      "every_12_hours": 12 * 60 * 60 * 1e3,
      "daily": 24 * 60 * 60 * 1e3,
      "weekly": 7 * 24 * 60 * 60 * 1e3
    };
    __name(getSchedulerStatus3, "getSchedulerStatus");
    __name(startDataSyncScheduler, "startDataSyncScheduler");
    __name(stopSchedulerTasks, "stopSchedulerTasks");
    __name(startSchedulerTasks, "startSchedulerTasks");
    __name(stopDataSyncScheduler, "stopDataSyncScheduler");
    tierRunningState = {
      high: false,
      medium: false,
      full: false,
      nightly: false
    };
    schedulerSkipCount = {
      high: 0,
      medium: 0,
      full: 0,
      nightly: 0
    };
    __name(executeUnifiedSync, "executeUnifiedSync");
    __name(triggerManualSync, "triggerManualSync");
    __name(getSyncQueueStatus, "getSyncQueueStatus");
    __name(upsertSyncSchedule, "upsertSyncSchedule");
    __name(getSyncSchedule, "getSyncSchedule");
    __name(deleteSyncSchedule3, "deleteSyncSchedule");
    __name(sleep4, "sleep");
    __name(withExponentialBackoff, "withExponentialBackoff");
    OPTIMIZATION_SCHEDULE = {
      intraday_pacing: {
        type: "intraday_pacing",
        description: "\u65E5\u5185\u8282\u594F\u76D1\u63A7 - \u9884\u7B97\u6D88\u8017\u901F\u5EA6\u76D1\u63A7\u548C\u5F02\u5E38\u6D41\u91CF\u68C0\u6D4B",
        intervalMs: 30 * 60 * 1e3,
        // 每30分钟
        specificModules: []
        // 独立执行，不走优化目标引擎
      },
      risk_scan: {
        type: "risk_scan",
        description: "\u9AD8\u9891\u98CE\u63A7\u626B\u63CF - \u96F6\u66DD\u5149\u98CE\u66B4\u3001\u5F02\u5E38\u82B1\u9500\u3001CPC\u98D9\u5347\u68C0\u6D4B",
        intervalMs: 2 * 60 * 60 * 1e3,
        // 每2小时（从4小时缩短到2小时）
        specificModules: []
        // 仅风控，不执行优化模块
      },
      dayparting_adjustment: {
        type: "dayparting_adjustment",
        description: "\u5206\u65F6\u7ADE\u4EF7\u8C03\u6574 - \u6839\u636E\u5F53\u524D\u65F6\u6BB5\u52A8\u6001\u8C03\u6574\u51FA\u4EF7\u4E58\u6570",
        intervalMs: 60 * 60 * 1e3,
        // 每小时
        specificModules: ["multidim", "dayparting", "coordination"]
        // v179: 添加multidim模块以生成分时竞价规则
      },
      dayparting_budget: {
        type: "dayparting_budget",
        description: "v179: \u5206\u65F6\u9884\u7B97\u8C03\u6574 - \u6839\u636E\u661F\u671F\u51E0\u7684\u8868\u73B0\u52A8\u6001\u8C03\u6574\u9884\u7B97",
        intervalMs: 24 * 60 * 60 * 1e3,
        // 每天执行一次
        cronHours: [6],
        // 凌昨6:00执行（在分时竞价规则生成后）
        specificModules: ["multidim", "dayparting_budget"]
        // 先生成规则，再应用预算
      },
      daily_bid_optimization: {
        type: "daily_bid_optimization",
        description: "\u51FA\u4EF7\u667A\u80FD\u4F18\u5316 - \u6BCF2\u5C0F\u65F6\u57FA\u4E8E\u5E02\u573A\u66F2\u7EBF\u6A21\u578B\u81EA\u52A8\u8C03\u6574\u51FA\u4EF7",
        intervalMs: 2 * 60 * 60 * 1e3,
        // v122h: 从每日1次提升到每2小时，与宣传一致
        specificModules: ["bid", "keyword", "coordination"]
      },
      daily_placement_optimization: {
        type: "daily_placement_optimization",
        description: "\u6BCF\u65E5\u4F4D\u7F6E\u4F18\u5316 - \u5E7F\u544A\u4F4D\u7F6E\u503E\u659C\u6BD4\u4F8B\u8C03\u6574",
        intervalMs: 24 * 60 * 60 * 1e3,
        cronHours: [3],
        // 凌晨3:00
        specificModules: ["placement"]
        // 仅位置优化
      },
      daily_search_term_negation: {
        type: "daily_search_term_negation",
        description: "v337.4: \u641C\u7D22\u8BCD\u5426\u5B9A - \u6BCF6\u5C0F\u65F6\u81EA\u52A8\u5426\u5B9A\u4F4E\u6548\u641C\u7D22\u8BCD",
        intervalMs: 6 * 60 * 60 * 1e3,
        // v337.4: 24h→6h
        cronHours: [],
        // v337.4: 移除固定时间限制，改为纯间隔驱动
        specificModules: ["searchterm"]
        // 仅搜索词分析
      },
      budget_allocation: {
        type: "budget_allocation",
        description: "\u9884\u7B97\u667A\u80FD\u5206\u914D - \u65E9\u665A\u4E24\u6B21\u9884\u7B97\u5206\u914D",
        intervalMs: 12 * 60 * 60 * 1e3,
        cronHours: [8, 18],
        // 早8:00 + 晚18:00
        specificModules: ["budget"]
        // 仅预算分配
      },
      search_term_harvest: {
        type: "search_term_harvest",
        description: "v337.4: \u641C\u7D22\u8BCD\u6536\u5272 - \u6BCF8\u5C0F\u65F6\u81EA\u52A8\u6536\u5272\u9AD8\u8F6C\u5316\u641C\u7D22\u8BCD\u5E76\u6DFB\u52A0\u5426\u5B9A\u8BCD",
        intervalMs: 8 * 60 * 60 * 1e3,
        // v337.4: 24h→8h
        cronHours: [],
        // v337.4: 移除固定时间限制，改为纯间隔驱动
        specificModules: []
        // 独立执行，使用searchTermHarvester服务
      },
      weekly_report: {
        type: "weekly_report",
        description: "\u7EE9\u6548\u5468\u62A5 - \u6BCF\u5468\u81EA\u52A8\u751F\u6210\u5E7F\u544A\u4F18\u5316\u62A5\u544A",
        intervalMs: 7 * 24 * 60 * 60 * 1e3,
        cronHours: [9],
        // 上午9:00
        cronDayOfWeek: 1,
        // 周一
        specificModules: []
      },
      // v197: 下一代算法定时任务
      nextgen_maintenance: {
        type: "nextgen_maintenance",
        description: "v204: NextGen\u7EF4\u62A4 - \u7279\u5F81\u7F13\u5B58\u3001Sigmoid\u62DF\u5408\u3001RL Reward\u56DE\u586B\u3001\u56E0\u679C\u5206\u6790",
        intervalMs: 30 * 60 * 1e3,
        // v232: 从2小时大幅缩短到30分钟，加速算法进化
        specificModules: []
      },
      nextgen_model_training: {
        type: "nextgen_model_training",
        description: "v197: NextGen\u6A21\u578B\u8BAD\u7EC3 - CQL\u79BB\u7EBF\u5F3A\u5316\u5B66\u4E60\u6A21\u578B\u8BAD\u7EC3",
        intervalMs: 6 * 60 * 60 * 1e3,
        // 每6小时
        specificModules: []
      },
      nextgen_budget_optimization: {
        type: "nextgen_budget_optimization",
        description: "v197: NextGen\u9884\u7B97\u7EC4\u5408\u4F18\u5316 + \u5173\u952E\u8BCD\u56FE\u8C31\u5206\u6790",
        intervalMs: 24 * 60 * 60 * 1e3,
        // 每日
        cronHours: [2],
        // 凌晨2:00
        specificModules: []
      },
      ab_test_metrics: {
        type: "ab_test_metrics",
        description: "v267: A/B\u6D4B\u8BD5\u6BCF\u65E5\u6307\u6807\u6536\u96C6",
        intervalMs: 24 * 60 * 60 * 1e3,
        // 每日
        cronHours: [23],
        // 晚上23:00
        specificModules: []
      },
      // v503: 自动止血扫描
      auto_stop_loss: {
        type: "auto_stop_loss",
        description: "v503: \u81EA\u52A8\u6B62\u8840\u626B\u63CF - \u9AD8ACoS Campaign\u6682\u505C\u3001\u641C\u7D22\u8BCD\u81EA\u52A8\u5426\u5B9A\u3001\u91CD\u65B0\u6FC0\u6D3B\u9632\u62A4\u3001\u6570\u636E\u60AC\u5D16\u4FEE\u590D",
        intervalMs: 4 * 60 * 60 * 1e3,
        cronHours: [],
        specificModules: []
      },
      system_defense: {
        type: "system_defense",
        description: "v504: \u7CFB\u7EDF\u9632\u7EBF\u5168\u91CF\u626B\u63CF - \u540C\u6B65\u6E05\u7406\u3001\u7B97\u6CD5\u7194\u65AD\u3001\u6B7B\u4EA1\u87BA\u65CB\u5E72\u9884\u3001\u7D27\u6025\u4F18\u5316",
        intervalMs: 6 * 60 * 60 * 1e3,
        // 每6小时执行一次
        cronHours: [],
        specificModules: []
      }
    };
    optimizationIntervals = {
      intraday_pacing: null,
      risk_scan: null,
      dayparting_adjustment: null,
      dayparting_budget: null,
      // v179
      daily_bid_optimization: null,
      daily_placement_optimization: null,
      daily_search_term_negation: null,
      budget_allocation: null,
      search_term_harvest: null,
      weekly_report: null,
      // v197: NextGen定时任务
      nextgen_maintenance: null,
      nextgen_model_training: null,
      nextgen_budget_optimization: null,
      ab_test_metrics: null,
      // v267 P2-2
      auto_stop_loss: null,
      // v503
      system_defense: null
      // v504
    };
    executionLocks = {};
    lastExecutionHour = {};
    getModuleLockGroup2 = getModuleLockGroup;
    acquireAccountOptimizationLock2 = acquireAccountOptimizationLock;
    releaseAccountOptimizationLock2 = releaseAccountOptimizationLock;
    acquireAccountOptimizationLockWithRetry2 = acquireAccountOptimizationLockWithRetry;
    moduleLastExecutionMap = /* @__PURE__ */ new Map();
    __name(shouldExecuteModuleForTarget, "shouldExecuteModuleForTarget");
    __name(recordModuleExecution, "recordModuleExecution");
    __name(acquireLock, "acquireLock");
    __name(releaseLock2, "releaseLock");
    __name(shouldExecuteThisHour, "shouldExecuteThisHour");
    __name(startOptimizationScheduler2, "startOptimizationScheduler");
    __name(stopOptimizationScheduler2, "stopOptimizationScheduler");
    __name(executeOptimizationTask, "executeOptimizationTask");
    consecutiveFailures = 0;
    MAX_CONSECUTIVE_FAILURES = 3;
    __name(verifySyncHealth, "verifySyncHealth");
    __name(triggerImmediateSync, "triggerImmediateSync");
    __name(getSyncHealthStatus, "getSyncHealthStatus");
    __name(isSyncRunning, "isSyncRunning");
  }
});

