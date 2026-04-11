# 模块对比分析摘要

总模块数: 340

## 新增模块 (20 个) — 需要创建 TypeScript 源码

| 模块路径 | 生产行数 | 关键函数/类 |
|---------|---------|----------|
| `server/services/dataAnomalyDetector.ts` | 1788 | 类: ImpactPredictor, CoreKeywordManager, HealthSignalMonitor |
| `server/sync/distributedQueue.ts` | 774 | 函数: createShards, renewAccountLock, recoverInterruptedTasks, updateShardStatus, getWorkerId |
| `server/sync/startupTasks.ts` | 501 | 函数: initStartupTasks, autoArchiveTasks, deepReconcile, healthCheckAndCleanup, zombieCleanup |
| `server/services/dataRetentionService.ts` | 370 | 函数: executeDataCleanup, batchDelete, getRetentionStats, checkMemoryAvailable |
| `server/sync/reportSemaphore.ts` | 309 | 函数: getEffectiveConcurrency, countActiveNormal, calculatePriorityScore, releaseReportSemaphore, processWaitQueue |
| `server/automation/smartAutoEnrollService.ts` | 289 | 函数: createGroupedPGs, scanAndAutoEnrollAll, groupCampaignsByType, autoEnrollAccount, createSinglePG |
| `server/sync/performanceIntegrityChecker.ts` | 285 | 函数: postSyncCoverageCheck, checkAllAccountsCoverage, checkAccountPerformanceCoverage, getAllRows, getFirstRow |
| `server/services/adaptiveRateLimiter.ts` | 282 | 函数: getAdaptiveRateLimiter, recordApiResponseForAdaptiveLimiting |
| `server/utils/dynamicLogLevel.ts` | 281 | 函数: clearAccountDebug, clearGlobalLevel, stopDynamicLogLevelRefresh, clearModuleDebug, getDynamicLogStatus |
| `server/db/v550-patch/pendingEventProcessor.ts` | 246 | 函数: stopPendingEventProcessor, startPendingEventProcessor, convertEventToTask, getPendingEventProcessorStatus, processPendingEvents |
| `server/automation/optimizationHealthAlert.ts` | 226 | 函数: scanAllAccountsHealth, checkAccountOptimizationHealth |
| `server/sync/v534_upgrade_reconciliation.ts` | 218 | 函数: startReconciliationScheduler, backfillMissingValues, runReconciliation |
| `server/sync/tokenHealthChecker.ts` | 201 | 函数: shouldSkipSync, updateHealthStatus, getAllTokenHealthStatus, sendTokenAlert, resetAllTokenHealth |
| `server/sync/nightlySyncMonitor.ts` | 185 | 函数: stopNightlyMonitor, collectSnapshot, getMonitorSummary, getMonitorSnapshots, startNightlyMonitor |
| `server/services/budgetRulesCoordinator.ts` | 184 | 函数: analyzeRulesFromDB, analyzeRulesFromAPI, isScheduleRuleActive, getPSTTimeInfo, isPerformanceRulePotentiallyActive |
| `server/sync/syncTaskConsumer.ts` | 154 | 函数: stopSyncTaskConsumer, startSyncTaskConsumer, pollAndConsume, executeTask |
| `server/sync/dateGapBackfillService.ts` | 152 | 函数: getAllRows2, scanAllAccountsGaps, detectAndQueueBackfill |
| `server/sync/syncSchedulerAdapter.ts` | 152 | 函数: getActiveAccounts, enqueueSyncTier, enqueueManualSync, tierToPriority, isRedisQueueEnabled |
| `server/sync/checkpointManager.ts` | 104 | 函数: loadSyncCheckpoint, buildRecoveryStrategy, saveSyncCheckpoint, clearSyncCheckpoint |
| `server/sync/v534_upgrade_syncEngine.ts` | 48 | 函数: cleanupStaleDbSyncJobs |

## 重大变更模块 (48 个) — 需要大幅更新源码

| 模块路径 | 生产行数 | 仓库行数 | 变化倍数 |
|---------|---------|---------|--------|
| `server/utils/patchSqlstring.ts` | 21939 | 88 | 249.31x |
| `server/_core/cookies.ts` | 21733 | 48 | 452.77x |
| `server/_core/amazonAuthCallback.ts` | 16403 | 314 | 52.24x |
| `server/_core/context.ts` | 2822 | 48 | 58.79x |
| `server/routes/notification.ts` | 1854 | 199 | 9.32x |
| `server/_core/oauth.ts` | 1836 | 55 | 33.38x |
| `server/prelaunch/services/project.ts` | 1277 | 263 | 4.86x |
| `server/budget/daypartingService.ts` | 576 | 1188 | 0.48x |
| `server/system/trafficIsolationService.ts` | 559 | 1413 | 0.4x |
| `server/analytics/timeDecayWeightedDataService.ts` | 366 | 1020 | 0.36x |
| `server/algorithm/algorithmEffectService.ts` | 307 | 623 | 0.49x |
| `server/db.ts` | 298 | 67 | 4.45x |
| `server/algorithm/algorithmUtils.ts` | 295 | 791 | 0.37x |
| `server/optimization/crossProductTransferEngine.ts` | 292 | 667 | 0.44x |
| `server/utils/dbQueryProvider.ts` | 275 | 102 | 2.7x |
| `server/optimization/optimizationSafetyGuardrails.ts` | 272 | 620 | 0.44x |
| `server/system/apiSecurityService.ts` | 264 | 953 | 0.28x |
| `server/prelaunch/oxylabs.ts` | 238 | 497 | 0.48x |
| `server/scheduler/schedulerService.ts` | 217 | 621 | 0.35x |
| `server/analytics/attributionWindowHelper.ts` | 209 | 457 | 0.46x |
| `server/analytics/keywordGraphService.ts` | 193 | 419 | 0.46x |
| `server/services/auditLogService.ts` | 190 | 416 | 0.46x |
| `server/utils/lockManager.ts` | 179 | 484 | 0.37x |
| `server/optimization/bidOptimizer/bidAdjustment.ts` | 172 | 613 | 0.28x |
| `server/optimization/gradualOptimizationEngine.ts` | 169 | 615 | 0.27x |
| `server/analytics/abTestIntegration.ts` | 156 | 408 | 0.38x |
| `server/services/bidCoordinator.ts` | 140 | 405 | 0.35x |
| `server/utils/keywordValidator.ts` | 126 | 308 | 0.41x |
| `server/gto/gtoExploratoryInvestmentEngine.ts` | 122 | 268 | 0.46x |
| `server/sync/syncCoordinator.ts` | 117 | 26 | 4.5x |
| `server/automation/batchOperationService.ts` | 109 | 249 | 0.44x |
| `server/gto/gtoDynamicEVEngine.ts` | 106 | 235 | 0.45x |
| `server/gto/gtoOpportunityWindowEngine.ts` | 103 | 218 | 0.47x |
| `server/gto/gtoBudgetPoolingEngine.ts` | 100 | 216 | 0.46x |
| `server/middleware/tenantMiddleware.ts` | 89 | 317 | 0.28x |
| `server/utils/timezone.ts` | 67 | 266 | 0.25x |
| `server/sync/infrastructure/shardManager.ts` | 49 | 563 | 0.09x |
| `server/optimization/safetyBoundary.ts` | 44 | 498 | 0.09x |
| `server/utils/taskLifecycle.ts` | 43 | 106 | 0.41x |
| `server/optimization/bidOptimizer/businessAware.ts` | 42 | 216 | 0.19x |
| `server/optimization/bidOptimizer/types.ts` | 40 | 224 | 0.18x |
| `server/types/utilTypes.ts` | 30 | 368 | 0.08x |
| `server/services/syncPriorityScheduler.ts` | 23 | 5 | 4.6x |
| `server/utils/safeSql.ts` | 23 | 143 | 0.16x |
| `server/services/sync/dataIntegrityChecker.ts` | 14 | 5 | 2.8x |
| `server/services/sync/sloMonitor.ts` | 13 | 5 | 2.6x |
| `server/optimization/bidOptimizer/index.ts` | 12 | 71 | 0.17x |
| `server/optimization/bidOptimizer/enhanced.ts` | 10 | 461 | 0.02x |

## 小幅变更模块 (272 个)

这些模块变化较小，需要逐一对比确认。

## 最大的 20 个模块（按生产行数排序）

| 模块路径 | 生产行数 | 状态 |
|---------|---------|-----|
| `server/utils/patchSqlstring.ts` | 21939 | major_change |
| `server/_core/cookies.ts` | 21733 | major_change |
| `server/_core/amazonAuthCallback.ts` | 16403 | major_change |
| `server/sync/amazonAdsApi.ts` | 6343 | minor_change |
| `server/optimization/optimizationAutoCorrector.ts` | 4001 | minor_change |
| `server/_core/context.ts` | 2822 | major_change |
| `server/sync/unifiedSyncEngine.ts` | 2424 | minor_change |
| `server/postDeployOptimizer.ts` | 2134 | minor_change |
| `server/routes/amazonApi.ts` | 1969 | minor_change |
| `server/sync/dataSyncScheduler.ts` | 1953 | minor_change |
| `server/services/amazonApiHelper.ts` | 1946 | minor_change |
| `server/routes/ops.ts` | 1920 | minor_change |
| `server/routes/notification.ts` | 1854 | major_change |
| `server/sync/optimizationSyncEngine.ts` | 1849 | minor_change |
| `server/_core/oauth.ts` | 1836 | major_change |
| `server/services/dataAnomalyDetector.ts` | 1788 | new |
| `server/sync/syncPerformance.ts` | 1677 | minor_change |
| `server/automation/automationExecutionEngine.ts` | 1548 | minor_change |
| `server/optimization/nextGenBidOrchestrator.ts` | 1530 | minor_change |
| `server/sync/syncSb.ts` | 1298 | minor_change |
