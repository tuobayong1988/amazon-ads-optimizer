# 源码升级任务清单

总模块数: 407

## 1. 新增模块 (20) — 需要创建 TypeScript 源码

### `server/services/dataAnomalyDetector.ts` (1791 行)
- 函数: _hsGetCached, _hsInitSubscriber, _hsMemGet, _hsMemSet, _hsPrecomputeAll, _hsPrecomputeForAccount, _hsQuery, _hsRedisGet, _hsRedisSet, _hsSetCached
- 类: CoreKeywordManager, DiscoveryGovernor, EventCalendar, HealthSignalMonitor, ImpactPredictor, OperationReviewGateway, SyncOrchestrator

### `server/sync/distributedQueue.ts` (777 行)
- 函数: acquireAccountLock, cleanupStuckTasks, clearStaleAccountLocks, completeTask, createShards, dequeueMySQLFallback, dequeueTask, enqueueBatch, enqueueTask, failTask

### `server/sync/startupTasks.ts` (504 行)
- 函数: accountHealthManager, autoArchiveTasks, checkWeeklyReset, deepReconcile, ensureAdAccountFields, ensureTables, healthCheckAndCleanup, initStartupTasks, pstHour, reconcile

### `server/services/dataRetentionService.ts` (373 行)
- 函数: batchDelete, checkMemoryAvailable, executeDataCleanup, getRetentionStats

### `server/sync/reportSemaphore.ts` (312 行)
- 函数: acquireReportSemaphore, adjustDynamicConcurrency, calculatePriorityScore, countActiveNormal, countActiveXL, getEffectiveConcurrency, getReportSemaphoreStatus, processWaitQueue, releaseReportSemaphore, resetReportSemaphore

### `server/automation/smartAutoEnrollService.ts` (292 行)
- 函数: autoEnrollAccount, createGroupedPGs, createSinglePG, findUnmanagedHighSpendCampaigns, groupCampaignsByType, postSyncAutoEnrollCheck, scanAndAutoEnrollAll

### `server/sync/performanceIntegrityChecker.ts` (288 行)
- 函数: checkAccountPerformanceCoverage, checkAllAccountsCoverage, getAllRows, getFirstRow, postSyncCoverageCheck

### `server/services/adaptiveRateLimiter.ts` (285 行)
- 函数: getAdaptiveRateLimiter, recordApiResponseForAdaptiveLimiting

### `server/utils/dynamicLogLevel.ts` (284 行)
- 函数: clearAccountDebug, clearGlobalLevel, clearModuleDebug, getDynamicLogStatus, refreshCache, setAccountDebug, setGlobalLevel, setModuleDebug, shouldEnableDebug, startDynamicLogLevelRefresh

### `server/db/v550-patch/pendingEventProcessor.ts` (249 行)
- 函数: convertEventToTask, getPendingEventProcessorStatus, processPendingEvents, startPendingEventProcessor, stopPendingEventProcessor

### `server/automation/optimizationHealthAlert.ts` (229 行)
- 函数: checkAccountOptimizationHealth, daysSinceLastOpt, scanAllAccountsHealth, spendChange

### `server/sync/v534_upgrade_reconciliation.ts` (221 行)
- 函数: backfillMissingValues, runReconciliation, startReconciliationScheduler

### `server/sync/tokenHealthChecker.ts` (204 行)
- 函数: axios2, getAllTokenHealthStatus, markTokenUnhealthy, precheckToken, resetAllTokenHealth, resetTokenHealth, sendTokenAlert, shouldSkipSync, updateHealthStatus

### `server/sync/nightlySyncMonitor.ts` (188 行)
- 函数: collectSnapshot, getMonitorSnapshots, getMonitorSummary, startNightlyMonitor, stopNightlyMonitor

### `server/services/budgetRulesCoordinator.ts` (187 行)
- 函数: analyzeBudgetRules, analyzeRulesFromAPI, analyzeRulesFromDB, getPSTTimeInfo, isPerformanceRulePotentiallyActive, isScheduleRuleActive

### `server/sync/syncTaskConsumer.ts` (157 行)
- 函数: executeTask, pollAndConsume, startSyncTaskConsumer, stopSyncTaskConsumer

### `server/sync/dateGapBackfillService.ts` (155 行)
- 函数: detectAndQueueBackfill, getAllRows2, scanAllAccountsGaps

### `server/sync/syncSchedulerAdapter.ts` (155 行)
- 函数: enqueueManualSync, enqueueSyncTier, getActiveAccounts, isRedisQueueEnabled, tierToPriority

### `server/sync/checkpointManager.ts` (107 行)
- 函数: buildRecoveryStrategy, clearSyncCheckpoint, loadSyncCheckpoint, now, saveSyncCheckpoint

### `server/sync/v534_upgrade_syncEngine.ts` (51 行)
- 函数: cleanupStaleDbSyncJobs

## 2. 重大更新 (34) — 需要大幅修改

### `server/_core/amazonAuthCallback.ts`
- 生产: 16406 行, 仓库: 314 行
- 新增函数: ClassRegistry, ClassRegistry2, CustomTransformerRegistry, CustomTransformerRegistry2, DoubleIndexedKV, DoubleIndexedKV2, Registry, Registry2, SuperJSON, SuperJSON2
- 新版本标记: 577, 620

### `server/utils/patchSqlstring.ts`
- 生产: 21942 行, 仓库: 88 行
- 新增函数: AsyncFromSyncIterator, AsyncFromSyncIteratorContinuation, AsyncGenerator, Negotiator, SafeBuffer, _OverloadYield, _asyncGeneratorDelegate, _asyncIterator, _awaitAsyncGenerator, _createBatchStreamProducer

### `server/_core/cookies.ts`
- 生产: 21736 行, 仓库: 48 行
- 新增函数: AxiosURLSearchParams, CombinedStream, CustomError, DataStream, DelayedStream, Empty2, FormData3, GetIntrinsic, RedirectableRequest, SignStream

### `server/_core/context.ts`
- 生产: 2825 行, 仓库: 48 行
- 新增函数: _encodeGeneratedRanges, _encodeOriginalScopes, addRefreshWrapper, ast, asyncWalk, babelOptions, canSkipBabel, catchupLine, createBabelOptions, decode4

### `server/prelaunch/services/project.ts`
- 生产: 1280 行, 仓库: 263 行
- 新增函数: __asyncGenerator, __await, addHelpers, aggregateResponses, apiVersion, assignRoleToPartsAndValidateSendMessageRequest, baseUrl, batchEmbedContents, buildFetchOptions, calls

### `server/_core/oauth.ts`
- 生产: 1839 行, 仓库: 55 行
- 新增函数: BigNumber2, bitFloor, clone2, coeffToString, compare2, compare3, f, format, intCheck, isOdd

### `server/routes/notification.ts`
- 生产: 1857 行, 仓库: 199 行
- 新增函数: _async, _crypt, _ekskey, _encipher, _hash, _key, _streamtoword, base64_decode, base64_encode, compare

### `server/utils/logger.ts`
- 生产: 693 行, 仓库: 658 行
- 新增函数: arrayToList, bufferToString, convertTimezone, dateToString, escape, escapeId, escapeString, format, objectToValues, raw
- 新版本标记: 614

### `server/optimization/optimizationAutoCorrector.ts`
- 生产: 4004 行, 仓库: 4960 行
- 新增函数: _v4, checkQueuedOrphanCleanup, cleanupOrphanSearchTerms, getConfig2, now, retryRecentPendingEvents, rng, scheduleOrphanCleanupViaRedis, unsafeStringify, v4
- 新版本标记: 444, 530, 575, 601, 608

### `server/services/amazonApiHelper.ts`
- 生产: 1949 行, 仓库: 2315 行
- 新增函数: batchUpdateWithBisectRetry, errDetail584, getAmazonSyncService2, kw, now, processBatch, text2
- 新版本标记: 577, 579, 580, 584, 585

### `server/sync/dataSyncScheduler.ts`
- 生产: 1956 行, 仓库: 2951 行
- 新增函数: deleteSyncSchedule3, getSchedulerStatus3, releaseLock2, sleep4, startOptimizationScheduler2, stopOptimizationScheduler2, v620AutoMigrate
- 新版本标记: 550, 580, 614, 620

### `server/sync/optimizationSyncEngine.ts`
- 生产: 1852 行, 仓库: 2566 行
- 新增函数: agStatus, campStatus, markTaskFailed2, markTaskForRetry2, markTaskSynced2, markTasksFailed2, updateLogsSyncStatus2
- 新版本标记: 529, 535, 577, 579, 614

### `server/routes/ops.ts`
- 生产: 1923 行, 仓库: 1630 行
- 新增函数: campCnt, credCnt, extractCount2, kwCnt, logCnt, pgCnt
- 新版本标记: 577, 614, 620

### `server/sync/dataSyncService.ts`
- 生产: 829 行, 仓库: 1132 行
- 新增函数: calculateNextRunTime2, createSyncJob2, createSyncSchedule2, deleteSyncSchedule2, getSyncLogs2, updateSyncSchedule2

### `server/sync/unifiedSyncEngine.ts`
- 生产: 2427 行, 仓库: 2284 行
- 新增函数: ageDays, getDistributedWorkerInfo, hoursSinceLastSync, shutdownDistributedWorker, sleep3, v534Init
- 新版本标记: 534, 548, 578, 596, 614

### `server/sync/optSyncQueries.ts`
- 生产: 793 行, 仓库: 1129 行
- 新增函数: getCampaignAmazonId2, getKeywordAmazonId2, markKeywordAndAdGroupDeleted, updateKeywordBid2, updateProductTargetBid2
- 新版本标记: 529

### `server/automation/adAutomation.ts`
- 生产: 985 行, 仓库: 1750 行
- 新增函数: analyzeBidAdjustments2, calculateEfficiencyScore2, generateNgrams2, tokenize2

### `server/deployLifecycleManager.ts`
- 生产: 844 行, 仓库: 1146 行
- 新增函数: isShuttingDown2, recoverInterruptedTasks2, registerActiveTask3, unregisterActiveTask3
- 新版本标记: 580

### `server/sync/syncPerformance.ts`
- 生产: 1680 行, 仓库: 2040 行
- 新增函数: ageMinutes, batchUpdateByIds, isLargeAccountSync, isLargeAcctBatch
- 新版本标记: 578, 587, 596, 614

### `server/optimization/nextGenBidOrchestrator.ts`
- 生产: 1533 行, 仓库: 2253 行
- 新增函数: buildResult2, currentHour
- 新版本标记: 601, 608

### `server/sync/infrastructure/shardManager.ts`
- 生产: 52 行, 仓库: 563 行
- 新增函数: acquireLock2, releaseLock3

### `server/sync/syncSb.ts`
- 生产: 1301 行, 仓库: 1827 行
- 新增函数: _isLockTimeout, nowStr
- 新版本标记: 614

### `server/sync/syncWithTracking.ts`
- 生产: 923 行, 仓库: 1178 行
- 新增函数: _isLockTimeout2, _isLockTimeout3

### `server/system/trafficIsolationService.ts`
- 生产: 562 行, 仓库: 1413 行
- 新增函数: detectTrafficConflicts2, tokenize3

### `server/targetEngine/bidOptimizationExecutor.ts`
- 生产: 1182 行, 仓库: 1195 行
- 新增函数: inRange, nowStr
- 新版本标记: 579, 601, 620

### `server/budget/daypartingService.ts`
- 生产: 579 行, 仓库: 1188 行
- 新增函数: resolveAmazonCampaignId2

### `server/postDeployOptimizer.ts`
- 生产: 2137 行, 仓库: 2547 行
- 新增函数: sleep2
- 新版本标记: 596, 614

### `server/types/utilTypes.ts`
- 生产: 33 行, 仓库: 368 行
- 新增函数: extractRows2

### `server/algorithm/algorithmUtils.ts`
- 生产: 298 行, 仓库: 791 行

### `server/dbAutoMigration.ts`
- 生产: 1017 行, 仓库: 1151 行
- 新版本标记: 596, 614

### `server/optimization/bidOptimizer/index.ts`
- 生产: 15 行, 仓库: 71 行

### `server/optimization/safetyBoundary.ts`
- 生产: 47 行, 仓库: 498 行

### `server/sync/amazonAdsApi.ts`
- 生产: 6346 行, 仓库: 6949 行
- 新版本标记: 509, 535, 577, 578, 580

### `server/targetEngine/searchTermExecutor.ts`
- 生产: 1187 行, 仓库: 1505 行
- 新版本标记: 600

## 3. 中等更新 (60)

- `server/_core/llm.ts`: +0 函数 ()
- `server/_core/notification.ts`: +0 函数 ()
- `server/_core/sdk.ts`: +2 函数 (parsed, signedInAt)
- `server/_core/systemRouter.ts`: +6 函数 (calculateDateRangeByMarketplace, formatMarketplaceLocalTime, getMarketplaceCurrentHour, getMarketplaceLocalDate, getMarketplaceLocalTime)
- `server/advancedPlacementService.ts`: +1 函数 (getDbInstance13)
- `server/algorithm/algorithmEvolutionEngine.ts`: +2 函数 (calculateEffectScore3, runEvolutionCycle2)
- `server/algorithm/causalInferenceEngine.ts`: +2 函数 (getDbInstance5, today)
- `server/algorithm/decisionTreeService.ts`: +1 函数 (getDbInstance12)
- `server/algorithm/goalProgressAlgorithm.ts`: +0 函数 ()
- `server/algorithm/metaLearningSelector.ts`: +3 函数 (dayOfWeek, getDbInstance7, hourOfDay)
- `server/algorithm/rlDataRecorder.ts`: +3 函数 (currentHour, getDbInstance2, today)
- `server/algorithm/sigmoidCurveFitter.ts`: +3 函数 (getDbInstance3, marginalProfit2, today)
- `server/analytics/abTestIntegration.ts`: +0 函数 ()
- `server/analytics/advancedAnalyticsService.ts`: +2 函数 (calculateEffectScore2, detectAnomalies3)
- `server/analytics/dashboardRecommendationEngine.ts`: +0 函数 ()
- `server/analytics/intelligentRecommendationEngine.ts`: +1 函数 (calculateHealthScore2)
- `server/analytics/keywordGraphService.ts`: +1 函数 (getDbInstance9)
- `server/analytics/specialScenarioOptimizationService.ts`: +3 函数 (currentHour, resolveAmazonCampaignId3, weekday)
- `server/analytics/timeDecayWeightedDataService.ts`: +0 函数 ()
- `server/budget/budgetAlertService.ts`: +0 函数 ()
- `server/budget/budgetAllocationService.ts`: +2 函数 (calculatePriorityScore2, changePercent)
- `server/budget/budgetAutoExecutionService.ts`: +3 函数 (duration3, executeBudgetAllocation2, now)
- `server/budget/seasonalBudgetService.ts`: +0 函数 ()
- `server/middleware/tenantMiddleware.ts`: +0 函数 ()
- `server/optimization/bidOptimizer/bidAdjustment.ts`: +0 函数 ()
- `server/optimization/bidOptimizer/enhanced.ts`: +0 函数 ()
- `server/optimization/gradualOptimizationEngine.ts`: +0 函数 ()
- `server/optimization/marketCurveService.ts`: +2 函数 (calculateOptimalBid2, getDbInstance11)
- `server/optimization/optimizationMonitoringService.ts`: +1 函数 (checkAlgorithmHealth2)
- `server/optimization/optimizationSafetyGuardrails.ts`: +0 函数 ()
- `server/optimization/optimizationTargetEngine.ts`: +1 函数 (getAccountMarketplace2)
- `server/optimization/postOptimizationVerifier.ts`: +0 函数 ()
- `server/optimization/riskActionEngine.ts`: +2 函数 (avgDailyBudget, timestamp2)
- `server/routes/analytics.ts`: +0 函数 ()
- `server/scheduler/schedulerService.ts`: +0 函数 ()
- `server/services/bidCoordinator.ts`: +0 函数 ()
- `server/services/cloudwatchMonitor.ts`: +3 函数 (activeDepth, collectRedisQueueMetrics, getClient2)
- `server/services/dataCliffAutoRecoveryEngine.ts`: +6 函数 (budgetDropPercent, detectCliffForEntityFallback, executeBudgetCliffRepair, midClicks, midOrders)
- `server/services/entityIdResolver.ts`: +2 函数 (getCacheStats2, getDb2)
- `server/services/selfHealingScheduler.ts`: +0 函数 ()
- `server/sync/amazonSyncService.ts`: +1 函数 (nowStr)
- `server/sync/infrastructure/dataIntegrityChecker.ts`: +2 函数 (checkTime, now)
- `server/sync/infrastructure/sloMonitor.ts`: +2 函数 (stats4, timestamp2)
- `server/sync/scheduling/syncPriorityScheduler.ts`: +4 函数 (clearThrottlePause, evaluateThrottlePause, getThrottlePauseStatus, shouldPauseLowPriority)
- `server/sync/sqsConsumerService.ts`: +0 函数 ()
- `server/sync/syncIdempotencyService.ts`: +2 函数 (acquireMemoryLock2, releaseMemoryLock2)
- `server/sync/syncSd.ts`: +0 函数 ()
- `server/sync/syncSp.ts`: +0 函数 ()
- `server/system/apiSecurityService.ts`: +0 函数 ()
- `server/system/auditLogService.ts`: +2 函数 (logSync2, now)
- `server/system/localAuthService.ts`: +1 函数 (now)
- `server/system/systemDefenseService.ts`: +0 函数 ()
- `server/system/systemHealthMetricsService.ts`: +1 函数 (text2)
- `server/system/trafficMigration.ts`: +1 函数 (detectTrafficConflicts3)
- `server/targetEngine/budgetExecutor.ts`: +4 函数 (campaignType, isBudgetQuarantined, recordBudgetFailure, recordBudgetSuccess)
- `server/utils/accessControl.ts`: +3 函数 (getCampaignAccountId2, getUserAccountIds2, verifyBatchKeywordAccess)
- `server/utils/amazonBidConstraints.ts`: +0 函数 ()
- `server/utils/lockManager.ts`: +0 函数 ()
- `server/utils/opsLogger.ts`: +0 函数 ()
- `server/utils/timezone.ts`: +0 函数 ()

## 4. 小幅更新 (113)

- `server/_core/index.ts`: +2 函数
- `server/_core/trpc.ts`: +1 函数
- `server/_debug/debug-sync.ts`: +1 函数
- `server/algorithm/algorithmConfigService.ts`: +0 函数
- `server/algorithm/algorithmEffectService.ts`: +0 函数
- `server/algorithm/contextualBanditService.ts`: +1 函数
- `server/algorithm/offlineRLService.ts`: +1 函数
- `server/algorithm/selfEvolutionEngine.ts`: +1 函数
- `server/analytics/attributionWindowHelper.ts`: +0 函数
- `server/analytics/contextualFeatureService.ts`: +1 函数
- `server/automation/autoStopLossService.ts`: +0 函数
- `server/automation/automationExecutionEngine.ts`: +2 函数
- `server/automation/batchOperationService.ts`: +0 函数
- `server/automation/correctionService.ts`: +0 函数
- `server/automation/searchTermHarvester.ts`: +1 函数
- `server/budget/budgetPortfolioOptimizer.ts`: +2 函数
- `server/budget/budgetTrackingService.ts`: +0 函数
- `server/db/accounts.ts`: +2 函数
- `server/db/analytics.ts`: +0 函数
- `server/db/biddingLogs.ts`: +0 函数
- `server/db/campaigns.ts`: +0 函数
- `server/db/connection.ts`: +1 函数
- `server/db/goalProgress.ts`: +0 函数
- `server/db/optimizationEvents.ts`: +0 函数
- `server/db/searchTerms.ts`: +0 函数
- `server/db/syncJobs.ts`: +1 函数
- `server/db/users.ts`: +1 函数
- `server/gto/gtoDynamicEVEngine.ts`: +0 函数
- `server/gto/gtoExploratoryInvestmentEngine.ts`: +0 函数
- `server/gto/gtoIntegrationOrchestrator.ts`: +0 函数
- `server/gto/gtoOpportunityWindowEngine.ts`: +0 函数
- `server/migrations/v257_backfill_match_type.ts`: +0 函数
- `server/migrations/v390_performance_indexes.ts`: +0 函数
- `server/migrations/v395_search_terms_unique.ts`: +0 函数
- `server/ml/bidOptimizer.ts`: +1 函数
- `server/optimization/bidOptimizer/businessAware.ts`: +0 函数
- `server/optimization/bidOptimizer/marketCurve.ts`: +0 函数
- `server/optimization/coldStartService.ts`: +0 函数
- `server/optimization/crossProductTransferEngine.ts`: +0 函数
- `server/optimization/marginalBenefitBatchService.ts`: +0 函数
- `server/optimization/marginalBenefitHistoryService.ts`: +1 函数
- `server/optimization/multiDimComboAnalyzer.ts`: +2 函数
- `server/optimization/multiDimensionOptimizer.ts`: +2 函数
- `server/optimization/nextGenMigration.ts`: +0 函数
- `server/optimization/optimizationScheduler.ts`: +1 函数
- `server/optimization/placementOptimizationService.ts`: +1 函数
- `server/optimization/unifiedOptimizationEngine.ts`: +1 函数
- `server/postDeployCommandRevalidator.ts`: +0 函数
- `server/prelaunch/gemini.ts`: +0 函数
- `server/prelaunch/services/m1-keywords.ts`: +0 函数
- `server/prelaunch/services/m6-video.ts`: +0 函数
- `server/prelaunchDbMigration.ts`: +1 函数
- `server/routers.ts`: +0 函数
- `server/routes/_helpers.ts`: +0 函数
- `server/routes/adAccount.ts`: +1 函数
- `server/routes/amazonApi.ts`: +0 函数
- `server/routes/audit.ts`: +0 函数
- `server/routes/campaign.ts`: +1 函数
- `server/routes/correction.ts`: +0 函数
- `server/routes/dashboardRecommendation.ts`: +0 函数
- `server/routes/dataHealth.ts`: +0 函数
- `server/routes/performanceGroup.ts`: +1 函数
- `server/routes/placement.ts`: +0 函数
- `server/routes/sitemap.ts`: +1 函数
- `server/routes/smartCampaign.ts`: +1 函数
- `server/services/accountInitializationService.ts`: +0 函数
- `server/services/adaptiveTimeoutService.ts`: +0 函数
- `server/services/amazonApiErrorMapper.ts`: +0 函数
- `server/services/amazonIdResolver.ts`: +0 函数
- `server/services/apiRateLimitService.ts`: +0 函数
- `server/services/auditLogService.ts`: +0 函数
- `server/services/bulkheadService.ts`: +0 函数
- `server/services/campaignLifecycleService.ts`: +0 函数
- `server/services/circuitBreakerService.ts`: +0 函数
- `server/services/guardrailConfigService.ts`: +0 函数
- `server/services/historicalCpcFloorService.ts`: +0 函数
- `server/services/historicalDataRecoveryService.ts`: +0 函数
- `server/services/intradayPacingService.ts`: +1 函数
- `server/services/optimizationConsistencyChecker.ts`: +0 函数
- `server/services/reportJobScheduler.ts`: +0 函数
- `server/services/targetingAlgorithm.ts`: +0 函数
- `server/services/typeSafeQueryBuilder.ts`: +0 函数
- `server/sync/daily-sync-task.ts`: +0 函数
- `server/sync/entityStateAlignment.ts`: +0 函数
- `server/sync/infrastructure/zombieAccountDetector.ts`: +0 函数
- `server/sync/scheduling/asyncReportService.ts`: +1 函数
- `server/sync/scheduling/dualTrackSyncService.ts`: +2 函数
- `server/sync/scheduling/enhancedDualTrackService.ts`: +1 函数
- `server/sync/scheduling/syncServiceProvider.ts`: +0 函数
- `server/sync/syncBidOperations.ts`: +1 函数
- `server/sync/syncCoordinator.ts`: +0 函数
- `server/sync/syncHelpers.ts`: +0 函数
- `server/system/accountInitializationService.ts`: +0 函数
- `server/system/auditService.ts`: +1 函数
- `server/system/collaborationNotificationService.ts`: +1 函数
- `server/system/holidayConfigService.ts`: +1 函数
- `server/system/inviteCodeService.ts`: +1 函数
- `server/system/notificationService.ts`: +0 函数
- `server/system/observabilityService.ts`: +2 函数
- `server/system/systemConfigService.ts`: +0 函数
- `server/targetEngine/daypartingExecutor.ts`: +1 函数
- `server/targetEngine/executionLogger.ts`: +1 函数
- `server/targetEngine/statusChangeExecutor.ts`: +0 函数
- `server/utils/asyncMutex.ts`: +0 函数
- `server/utils/dbQueryProvider.ts`: +1 函数
- `server/utils/dbRLS.ts`: +0 函数
- `server/utils/distributedLock.ts`: +0 函数
- `server/utils/idTypes.ts`: +0 函数
- `server/utils/keywordValidator.ts`: +0 函数
- `server/utils/migrateCampaignIds.ts`: +1 函数
- `server/utils/redisClient.ts`: +0 函数
- `server/utils/safeSql.ts`: +0 函数
- `server/utils/taskLifecycle.ts`: +0 函数

## 5. 无变更 (113)

这些模块可以直接保留仓库中的 TypeScript 源码。

- `server/_core/env.ts`
- `server/_core/vite.ts`
- `server/algorithm/algorithmEfficacyService.ts`
- `server/algorithm/algorithmObservabilityService.ts`
- `server/algorithm/algorithmOptimizationService.ts`
- `server/algorithm/weightAutoTuningService.ts`
- `server/analytics/abTestService.ts`
- `server/analytics/ngramAnalysis.ts`
- `server/analytics/strategyRecommendationService.ts`
- `server/automation/autoOperationService.ts`
- `server/automation/autoRollbackService.ts`
- `server/budget/intelligentBudgetAllocationService.ts`
- `server/db-performance-trend.ts`
- `server/db.ts`
- `server/db/adGroups.ts`
- `server/db/aiOptimization.ts`
- `server/db/batchOps.ts`
- `server/db/bidAdjustment.ts`
- `server/db/bulkOperations.ts`
- `server/db/campaignDetail.ts`
- `server/db/corrections.ts`
- `server/db/credentials.ts`
- `server/db/emailSubscriptions.ts`
- `server/db/importJobs.ts`
- `server/db/keywords.ts`
- `server/db/notifications.ts`
- `server/db/performance.ts`
- `server/db/productTargets.ts`
- `server/db/scheduledTasks.ts`
- `server/db/sdAudiences.ts`
- `server/db/team.ts`
- `server/gto/gtoBudgetPoolingEngine.ts`
- `server/gto/gtoKeywordPortfolioBalancer.ts`
- `server/migrations/v258_add_log_fields.ts`
- `server/migrations/v268_performance_indexes.ts`
- `server/migrations/v345_encrypt_credentials.ts`
- `server/migrations/v345_performance_indexes.ts`
- `server/migrations/v361_core_table_indexes.ts`
- `server/migrations/v372_extended_indexes.ts`
- `server/optimization/aiOptimizationService.ts`
- `server/optimization/bayesianBidSmoothingEngine.ts`
- `server/optimization/bidOptimizer/types.ts`
- `server/optimization/localBidRecommendationEngine.ts`
- `server/optimization/marginalBenefitAnalysisService.ts`
- `server/optimization/nashEquilibriumEngine.ts`
- `server/optimization/paretoTierEngine.ts`
- `server/optimization/suggestedBidColdStartEngine.ts`
- `server/optimization/timeSeriesForecastEngine.ts`
- `server/prelaunch/oxylabs.ts`
- `server/prelaunch/router.ts`
- `server/prelaunch/services/dashboard.ts`
- `server/prelaunch/services/m2-competitors.ts`
- `server/prelaunch/services/m3-persona.ts`
- `server/prelaunch/services/m4x-copy.ts`
- `server/prelaunch/services/m5-visual.ts`
- `server/prelaunch/services/m7-ad-framework.ts`
- `server/prelaunch/services/pipeline.ts`
- `server/reviewRouter.ts`
- `server/routes/abTest.ts`
- `server/routes/adAutomation.ts`
- `server/routes/adGroup.ts`
- `server/routes/algorithm.ts`
- `server/routes/apiSecurity.ts`
- `server/routes/automation.ts`
- `server/routes/batchOperation.ts`
- `server/routes/bidding.ts`
- `server/routes/budget.ts`
- `server/routes/crossAccount.ts`
- `server/routes/dailySync.ts`
- `server/routes/dataSync.ts`
- `server/routes/dayparting.ts`
- `server/routes/dev.ts`
- `server/routes/exchangeRate.ts`
- `server/routes/guardrailConfig.ts`
- `server/routes/import.ts`
- `server/routes/intelligentRecommendation.ts`
- `server/routes/keyword.ts`
- `server/routes/mlOptimization.ts`
- `server/routes/monitoring.ts`
- `server/routes/multiTenant.ts`
- `server/routes/nextGen.ts`
- `server/routes/optimization.ts`
- `server/routes/scheduler.ts`
- `server/routes/specialScenario.ts`
- `server/routes/stopLoss.ts`
- `server/routes/systemConfig.ts`
- `server/routes/systemDefense.ts`
- `server/routes/systemLog.ts`
- `server/routes/team.ts`
- `server/routes/user.ts`
- `server/scheduler/effectTrackingScheduler.ts`
- `server/services/apiCacheService.ts`
- `server/services/commandConfirmationService.ts`
- `server/services/entityIdResolverDbProvider.ts`
- `server/services/exchangeRateService.ts`
- `server/services/mysqlRateLimitStore.ts`
- `server/services/resilienceMonitor.ts`
- `server/services/sync/dataIntegrityChecker.ts`
- `server/services/sync/sloMonitor.ts`
- `server/services/syncPriorityScheduler.ts`
- `server/services/systemConfigService.ts`
- `server/smartCampaign/decisionEngine.ts`
- `server/sync/autoBidOptimization.ts`
- `server/sync/init.ts`
- `server/sync/scheduling/smartSyncService.ts`
- `server/sync/scheduling/tieredSyncService.ts`
- `server/targetEngine/bidCoordinationExecutor.ts`
- `server/targetEngine/placementExecutor.ts`
- `server/utils/campaignIdResolver.ts`
- `server/utils/cryptoService.ts`
- `server/utils/logSanitizer.ts`
- `server/utils/redisDistributedLock.ts`
- `server/utils/systemVersion.ts`

## 6. 仅在仓库中 (67)

这些模块在生产 bundle 中不存在，可能已被移除或未被引用。

- `server/_core/dataApi.ts`
- `server/_core/imageGeneration.ts`
- `server/_core/map.ts`
- `server/_core/types/cookie.d.ts`
- `server/_core/types/manusTypes.ts`
- `server/_core/voiceTranscription.ts`
- `server/_debug/verifyAlgorithms.ts`
- `server/_debug/verifyNextGen.ts`
- `server/abTesting/experimentService.ts`
- `server/budget/profitEstimationService.ts`
- `server/config/algorithmConstants.ts`
- `server/config/envValidator.ts`
- `server/db/index.ts`
- `server/gto/gtoCompetitorAwarenessEngine.ts`
- `server/layeredOptimization/executionEngine.ts`
- `server/layeredOptimization/strategyOrchestrator.ts`
- `server/scripts/populateHourlyAndPlacementData.ts`
- `server/services/abTestAutomation.ts`
- `server/services/asyncReportService.ts`
- `server/services/dualTrackSyncService.ts`
- `server/services/enhancedDualTrackService.ts`
- `server/services/globalNegativeKeywordService.ts`
- `server/services/placementRoiAnalyzer.ts`
- `server/services/smartSyncService.ts`
- `server/services/sync/adaptiveSync.ts`
- `server/services/sync/autoBidOptimization.ts`
- `server/services/sync/bidOperations.ts`
- `server/services/sync/index.ts`
- `server/services/sync/init.ts`
- `server/services/sync/shardManager.ts`
- `server/services/sync/shardSyncOrchestrator.ts`
- `server/services/sync/shardWorker.ts`
- `server/services/sync/syncHelpers.ts`
- `server/services/sync/syncPerformance.ts`
- `server/services/sync/syncSb.ts`
- `server/services/sync/syncSd.ts`
- `server/services/sync/syncSp.ts`
- `server/services/sync/syncWithTracking.ts`
- `server/services/syncServiceProvider.ts`
- `server/services/tieredSyncService.ts`
- `server/services/timerManager.ts`
- `server/storage.ts`
- `server/sync/adGroupSync.ts`
- `server/sync/asyncReportService.ts`
- `server/sync/bidOperations.ts`
- `server/sync/campaignSync.ts`
- `server/sync/index.ts`
- `server/sync/infrastructure/adaptiveSync.ts`
- `server/sync/infrastructure/shardSyncOrchestrator.ts`
- `server/sync/infrastructure/shardWorker.ts`
- `server/sync/keywordSync.ts`
- `server/sync/negativeKeywordSync.ts`
- `server/sync/performanceSync.ts`
- `server/sync/productTargetSync.ts`
- `server/sync/sbAdsSync.ts`
- `server/sync/searchTermSync.ts`
- `server/sync/targetingSync.ts`
- `server/targetEngine/types.ts`
- `server/types/syncTypes.ts`
- `server/utils/amazonApiValidator.ts`
- `server/utils/batchQueryHelper.ts`
- `server/utils/errorHandler.ts`
- `server/utils/leaderElection.ts`
- `server/utils/timerManager.ts`
- `server/validation/amazonApiSchemas.ts`
- `server/validation/index.ts`
- `server/validation/optimizationSchemas.ts`
