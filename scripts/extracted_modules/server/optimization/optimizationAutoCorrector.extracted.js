// Extracted from production dist/index.js
// Original module: server/optimization/optimizationAutoCorrector.ts
// Lines: 4000

var optimizationAutoCorrector_exports = {};
__export(optimizationAutoCorrector_exports, {
  getConfig: () => getConfig2,
  getLastScanResult: () => getLastScanResult,
  getLatestHealthReport: () => getLatestHealthReport,
  getScanHistory: () => getScanHistory,
  getScanStatus: () => getScanStatus,
  runAutoCorrection: () => runAutoCorrection,
  runDaypartingCleanup: () => runDaypartingCleanup,
  startAutoCorrector: () => startAutoCorrector,
  stopAutoCorrector: () => stopAutoCorrector
});
function isInternalEvent(actionType, eventCategory) {
  if (INTERNAL_ACTION_TYPES.has(actionType)) return true;
  if (eventCategory === "settings_change" && !actionType.includes("budget") && !actionType.includes("placement")) return true;
  return false;
}
async function getAccountCurrencyCode(accountId) {
  const cached2 = accountCurrencyCache.get(accountId);
  if (cached2 && Date.now() - cached2.fetchedAt < CURRENCY_CACHE_TTL_MS) {
    return cached2.currencyCode;
  }
  try {
    const creds = await getAmazonApiCredentials(accountId);
    const currencyCode = creds?.currencyCode || "USD";
    accountCurrencyCache.set(accountId, { currencyCode, fetchedAt: Date.now() });
    return currencyCode;
  } catch (err) {
    log67.warn(`v204: \u83B7\u53D6\u8D26\u6237${accountId}\u8D27\u5E01\u4EE3\u7801\u5931\u8D25: ${err.message}\uFF0C\u9ED8\u8BA4\u4F7F\u7528USD`);
    return "USD";
  }
}
function getBidTolerance(currencyCode) {
  const rate = CURRENCY_TO_USD_RATE[currencyCode] || 1;
  return Math.max(0.01, AUTO_CORRECTION_CONFIG.bidToleranceBaseUSD * rate);
}
function getBudgetTolerance(currencyCode) {
  const rate = CURRENCY_TO_USD_RATE[currencyCode] || 1;
  return Math.max(1, AUTO_CORRECTION_CONFIG.budgetToleranceBaseUSD * rate);
}
function getBidVerifyTolerance(currencyCode) {
  if (currencyCode === "USD") {
    return { absTolerance: 0.02, relTolerance: 0.05 };
  }
  const rate = CURRENCY_TO_USD_RATE[currencyCode] || 1;
  return {
    absTolerance: Math.max(0.02, 0.02 * rate),
    // 按汇率缩放绝对容差
    relTolerance: 0.1
    // 非USD货币允许10%的比例差异（汇率波动）
  };
}
async function runAutoCorrection(accountId) {
  if (isScanning) {
    log67.info("v178: \u7EA0\u9519\u626B\u63CF\u6B63\u5728\u8FDB\u884C\u4E2D\uFF0C\u8DF3\u8FC7\u672C\u6B21\u8BF7\u6C42");
    return createEmptyScanResult("skipped_in_progress");
  }
  if (lastScanTime && Date.now() - lastScanTime.getTime() < AUTO_CORRECTION_CONFIG.minScanIntervalMs) {
    log67.info("v178: \u8DDD\u79BB\u4E0A\u6B21\u626B\u63CF\u4E0D\u8DB310\u5206\u949F\uFF0C\u8DF3\u8FC7");
    return createEmptyScanResult("skipped_too_frequent");
  }
  isScanning = true;
  const scanId = `scan_${Date.now()}`;
  const startedAt = /* @__PURE__ */ new Date();
  const corrections = [];
  log67.info(`v178: \u5F00\u59CB\u81EA\u52A8\u7EA0\u9519\u626B\u63CF (scanId: ${scanId}, accountId: ${accountId || "all"})`);
  try {
    const database = await getDb();
    if (!database) {
      log67.warn("v178: \u65E0\u6CD5\u83B7\u53D6\u6570\u636E\u5E93\u8FDE\u63A5");
      return createEmptyScanResult("db_error");
    }
    try {
      const nullFixResult = await fixNullApiSyncStatusRecords(database);
      if (nullFixResult > 0) {
        log67.info(`v178: \u5DF2\u4FEE\u590D${nullFixResult}\u6761\u5386\u53F2NULL api_sync_status\u8BB0\u5F55`);
      }
    } catch (nullFixError) {
      log67.warn(`v178: \u4FEE\u590DNULL\u8BB0\u5F55\u5931\u8D25: ${nullFixError.message}`);
    }
    const accountIds = accountId ? [accountId] : await getActiveAccountIds(database);
    for (const accId of accountIds) {
      const memCheck = process.memoryUsage();
      const rssMB = Math.round(memCheck.rss / 1024 / 1024);
      const heapUsedMB = Math.round(memCheck.heapUsed / 1024 / 1024);
      if (rssMB > 1200) {
        log67.warn(`[AutoCorrector] v369: \u5185\u5B58\u8D85\u9650(RSS=${rssMB}MB, heap=${heapUsedMB}MB)\uFF0C\u4E2D\u65AD\u5269\u4F59\u8D26\u6237\u7EA0\u9519\u626B\u63CF\uFF0C\u5DF2\u5904\u7406${accountIds.indexOf(accId)}/${accountIds.length}\u4E2A\u8D26\u6237`);
        if (typeof global.gc === "function") global.gc();
        break;
      }
      try {
        const daypartingCleanups = await cleanupExpiredDaypartingBids(database, accId);
        corrections.push(...daypartingCleanups);
        const bidRetries = await retryFailedBidAdjustments(database, accId);
        corrections.push(...bidRetries);
        const bidMismatches = await correctBidMismatches(database, accId);
        corrections.push(...bidMismatches);
        const budgetRetries = await retryFailedBudgetAdjustments(database, accId);
        corrections.push(...budgetRetries);
        const budgetMismatches = await correctBudgetMismatches(database, accId);
        corrections.push(...budgetMismatches);
        const placementMismatches = await correctPlacementMismatches(database, accId);
        corrections.push(...placementMismatches);
        const rollbacks = await executeUnfinishedRollbacks(database, accId);
        corrections.push(...rollbacks);
        const settingsRetries = await retryFailedSettingsChanges(database, accId);
        corrections.push(...settingsRetries);
        const keywordCreateRetries = await retryFailedKeywordCreations(database, accId);
        corrections.push(...keywordCreateRetries);
        const negKeywordRetries = await retryFailedNegativeKeywordAdds(database, accId);
        corrections.push(...negKeywordRetries);
        const maxBidViolations = await correctMaxBidViolations(database, accId);
        corrections.push(...maxBidViolations);
        const orphanCleanups = await cleanupOrphanKeywords(database, accId);
        corrections.push(...orphanCleanups);
        const harvestRetries = await retryHistoricalFailedKeywordHarvests(database, accId);
        corrections.push(...harvestRetries);
        const taskRescues = await rescuePermanentlyFailedTasks(accId);
        corrections.push(...taskRescues);
        const negIdBackfills = await backfillNegativeKeywordIds(database, accId);
        corrections.push(...negIdBackfills);
        const bidConfirmations = await verifyBiddingLogsExecution(database, accId);
        corrections.push(...bidConfirmations);
        const qualityAudits = await auditAlgorithmDecisionQuality(database, accId);
        corrections.push(...qualityAudits);
        const statusRetries = await retryFailedTargetStatusChanges(database, accId);
        corrections.push(...statusRetries);
        const ptCreateRetries = await retryFailedProductTargetCreations(database, accId);
        corrections.push(...ptCreateRetries);
        const pendingRevalidations = await revalidateStalePendingCommands(database, accId);
        // [fix24-P2-9] Orphan search terms cleanup during AutoCorrector scan
        try {
          // P4: Schedule orphan cleanup via Redis low-priority queue instead of inline execution
          const orphanResult = await scheduleOrphanCleanupViaRedis();
          if (orphanResult.cleaned > 0) {
            log67.info(`[fix24-P2-9] AutoCorrector\u89e6\u53d1\u5b64\u513f\u641c\u7d22\u8bcd\u6e05\u7406: ${orphanResult.cleaned}\u6761`);
          }
        } catch (orphanErr) {
          log67.debug(`[fix24-P2-9] \u5b64\u513f\u641c\u7d22\u8bcd\u6e05\u7406\u8df3\u8fc7: ${orphanErr.message}`);
        }
        // P4: Also check for queued cleanup tasks
        try {
          await checkQueuedOrphanCleanup();
        } catch (queueErr) {
          log67.debug(`[P4] Queued cleanup check skipped: ${queueErr.message}`);
        }
        // [fix24-P2-11] Pending command auto-retry during AutoCorrector scan
        try {
          const retryResult = await retryRecentPendingEvents(database, accId);
          if (retryResult.retried > 0) {
            results.push({ type: 'pending_retry', accountId: accId, targetId: 0, targetType: 'batch', previousValue: '', correctedValue: String(retryResult.retried), reason: `fix24-P2-11: \u91cd\u8bd5${retryResult.retried}\u6761pending\u6307\u4ee4`, success: true });
          }
        } catch (retryErr) {
          log67.debug(`[fix24-P2-11] pending\u6307\u4ee4\u91cd\u8bd5\u8df3\u8fc7: ${retryErr.message}`);
        }
        corrections.push(...pendingRevalidations);
      } catch (accError) {
        log67.warn(`v178: \u8D26\u6237 ${accId} \u7EA0\u9519\u5931\u8D25: ${accError.message}`);
      }
    }
    const completedAt = /* @__PURE__ */ new Date();
    const result = buildScanResult(scanId, startedAt, completedAt, accountIds.length, corrections);
    scanHistory.unshift(result);
    if (scanHistory.length > 20) scanHistory.pop();
    lastScanTime = completedAt;
    log67.info(`v204: \u7EA0\u9519\u626B\u63CF\u5B8C\u6210 - \u53D1\u73B0${result.totalIssuesFound}\u4E2A\u95EE\u9898, \u7EA0\u6B63${result.totalCorrected}\u4E2A, \u5931\u8D25${result.totalFailed}\u4E2A`);
    auditSystemAction("system.deploy", {
      description: `\u81EA\u52A8\u7EA0\u9519\u626B\u63CF\u5B8C\u6210: \u53D1\u73B0${result.totalIssuesFound}\u4E2A\u95EE\u9898, \u7EA0\u6B63${result.totalCorrected}\u4E2A, \u5931\u8D25${result.totalFailed}\u4E2A`,
      metadata: {
        scanId,
        accountsScanned: accountIds.length,
        totalIssuesFound: result.totalIssuesFound,
        totalCorrected: result.totalCorrected,
        totalFailed: result.totalFailed,
        durationMs: completedAt.getTime() - startedAt.getTime()
      }
    });
    for (const correction of corrections) {
      if (correction.success) {
        recordAudit({
          action: "optimization.auto_bid",
          accountId: correction.accountId,
          entityType: correction.targetType || "keyword",
          entityId: correction.targetId,
          previousValue: { value: correction.previousValue },
          newValue: { value: correction.correctedValue, type: correction.type },
          source: "system",
          result: "success",
          metadata: { module: "AutoCorrector", scanId, reason: correction.reason }
        });
      }
    }
    await evaluateSyncHealth(database, result);
    return result;
  } finally {
    isScanning = false;
  }
}
async function fixNullApiSyncStatusRecords(database) {
  try {
    let totalAffected = 0;
    const BATCH_SIZE = 2e3;
    let batchAffected = 0;
    do {
      const updateResult = await database.execute(sql`
        UPDATE optimization_logs 
        SET api_sync_status = 'legacy_unsynced'
        WHERE api_sync_status IS NULL
        LIMIT ${sql.raw(String(BATCH_SIZE))}
      `);
      batchAffected = updateResult?.[0]?.affectedRows || updateResult?.affectedRows || 0;
      totalAffected += batchAffected;
      if (batchAffected > 0) {
        log67.info(`v199: \u672C\u6279\u4FEE\u590D ${batchAffected} \u6761 optimization_logs NULL \u8BB0\u5F55, \u7D2F\u8BA1: ${totalAffected}`);
      }
    } while (batchAffected >= BATCH_SIZE);
    let batchAffected2 = 0;
    do {
      const updateResult2 = await database.execute(sql`
        UPDATE optimization_events 
        SET api_sync_status = 'legacy_unsynced'
        WHERE api_sync_status IS NULL
        LIMIT ${sql.raw(String(BATCH_SIZE))}
      `);
      batchAffected2 = updateResult2?.[0]?.affectedRows || updateResult2?.affectedRows || 0;
      totalAffected += batchAffected2;
      if (batchAffected2 > 0) {
        log67.info(`v199: \u672C\u6279\u4FEE\u590D ${batchAffected2} \u6761 optimization_events NULL \u8BB0\u5F55, \u7D2F\u8BA1: ${totalAffected}`);
      }
    } while (batchAffected2 >= BATCH_SIZE);
    if (totalAffected > 0) {
      log67.info(`v199: fixNullApiSyncStatusRecords \u5B8C\u6210, \u603B\u8BA1\u4FEE\u590D ${totalAffected} \u6761\u8BB0\u5F55`);
    }
    return totalAffected;
  } catch (error48) {
    log67.warn(`v199: fixNullApiSyncStatusRecords \u5931\u8D25: ${error48.message}`);
    return 0;
  }
}
async function retryFailedBidAdjustments(database, accountId) {
  const results = [];
  try {
    const expiryDateStr = new Date(Date.now() - AUTO_CORRECTION_CONFIG.retryExpiryDays * 24 * 60 * 60 * 1e3).toISOString().slice(0, 19).replace("T", " ");
    const failedEvents = await database.select({
      id: optimizationEvents2.id,
      keywordId: optimizationEvents2.keywordId,
      keywordText: optimizationEvents2.keywordText,
      campaignId: optimizationEvents2.campaignId,
      campaignName: optimizationEvents2.campaignName,
      previousBid: optimizationEvents2.previousBid,
      newBid: optimizationEvents2.newBid,
      actionDetail: optimizationEvents2.actionDetail,
      errorMessage: optimizationEvents2.errorMessage,
      createdAt: optimizationEvents2.createdAt
    }).from(optimizationEvents2).where(
      and(
        eq(optimizationEvents2.accountId, accountId),
        eq(optimizationEvents2.eventCategory, "bid_adjustment"),
        eq(optimizationEvents2.status, "success"),
        or(
          eq(optimizationEvents2.apiSyncStatus, "failed"),
          eq(optimizationEvents2.apiSyncStatus, "pending")
        ),
        gte(optimizationEvents2.createdAt, expiryDateStr)
      )
    ).orderBy(desc(optimizationEvents2.createdAt)).limit(AUTO_CORRECTION_CONFIG.maxRetryPerRun);
    if (failedEvents.length === 0) return results;
    log67.info(`v178: \u8D26\u6237${accountId} \u53D1\u73B0${failedEvents.length}\u6761\u5931\u8D25\u7684\u51FA\u4EF7\u8C03\u6574\u9700\u8981\u91CD\u8BD5`);
    const latestByKeyword = /* @__PURE__ */ new Map();
    for (const event of failedEvents) {
      if (event.keywordId && !latestByKeyword.has(event.keywordId)) {
        latestByKeyword.set(event.keywordId, event);
      }
    }
    const kwIds = Array.from(latestByKeyword.keys());
    const invalidKwIds = /* @__PURE__ */ new Set();
    const ptEntityIds = /* @__PURE__ */ new Set();
    if (kwIds.length > 0) {
      try {
        const kwStatusRows = await database.select({ id: keywords.id, keywordStatus: keywords.keywordStatus }).from(keywords).where(inArray(keywords.id, kwIds));
        const foundKwIds = new Set();
        for (const row of kwStatusRows) {
          foundKwIds.add(row.id);
          if (row.keywordStatus === "amazon_deleted" || row.keywordStatus === "archived" || row.keywordStatus === "amazon_archived") {
            invalidKwIds.add(row.id);
          }
        }
        const missingKwIds = kwIds.filter(id => !foundKwIds.has(id));
        if (missingKwIds.length > 0) {
          const { productTargets: productTargets_ac } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
          const ptStatusRows = await database.select({ id: productTargets_ac.id, targetStatus: productTargets_ac.targetStatus }).from(productTargets_ac).where(inArray(productTargets_ac.id, missingKwIds));
          for (const row of ptStatusRows) {
            ptEntityIds.add(row.id);
            if (row.targetStatus === "amazon_deleted" || row.targetStatus === "archived" || row.targetStatus === "amazon_archived") {
              invalidKwIds.add(row.id);
            }
          }
          log67.info(`v620-fix13: AutoCorrector preflight - ${missingKwIds.length} IDs not in keywords, ${ptStatusRows.length} found in product_targets`);
          const ptFoundIds = new Set(ptStatusRows.map(r => r.id));
          for (const id of missingKwIds) {
            if (!ptFoundIds.has(id)) {
              invalidKwIds.add(id);
              log67.debug(`v620-fix13: ID ${id} not found in keywords or product_targets, marking invalid`);
            }
          }
        }
        if (invalidKwIds.size > 0) {
          log67.info(`v513: \u8D26\u6237${accountId} \u9884\u68C0\u53D1\u73B0${invalidKwIds.size}\u4E2A\u5DF2\u5F52\u6863/\u5DF2\u5220\u9664\u7684\u5173\u952E\u8BCD\uFF0C\u6807\u8BB0\u4E3A permanently_failed`);
          const invalidEventIds = failedEvents.filter((e) => e.keywordId && invalidKwIds.has(e.keywordId)).map((e) => e.id);
          if (invalidEventIds.length > 0) {
            await database.execute(sql`
              UPDATE optimization_events 
              SET api_sync_status = 'permanently_failed',
                  error_message = CONCAT(COALESCE(error_message, ''), ' | v513: 实体已在Amazon端归档/删除，不再重试'),
                  api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.v513_preflight', 'entity_archived_or_deleted')
              WHERE id IN (${safeInClause(invalidEventIds)})
            `);
          }
          for (const event of failedEvents.filter((e) => e.keywordId && invalidKwIds.has(e.keywordId))) {
            results.push({
              type: "bid_retry",
              accountId,
              targetId: event.keywordId || 0,
              targetType: "keyword",
              previousValue: String(event.previousBid || ""),
              correctedValue: "permanently_failed",
              reason: `v513: \u9884\u68C0\u53D1\u73B0\u5B9E\u4F53\u5DF2\u5F52\u6863/\u5220\u9664\uFF0C\u6807\u8BB0\u4E3A permanently_failed`,
              success: true
            });
          }
        }
      } catch (preflightErr) {
        log67.warn(`v513: \u8D26\u6237${accountId} \u51FA\u4EF7\u9884\u68C0\u5931\u8D25: ${preflightErr.message}\uFF0C\u7EE7\u7EED\u6B63\u5E38\u91CD\u8BD5\u6D41\u7A0B`);
      }
    }
    const retryItems = Array.from(latestByKeyword.values()).filter((e) => e.keywordId && e.newBid && !invalidKwIds.has(e.keywordId)).map((e) => {
      let isPT = ptEntityIds.has(e.keywordId);
      if (!isPT && e.actionDetail) {
        try {
          const detail = typeof e.actionDetail === 'string' ? JSON.parse(e.actionDetail) : e.actionDetail;
          if (detail.isProductTarget === true || detail.targetType === 'product' || detail.bidObjectType === 'asin') {
            isPT = true;
          }
        } catch (_) {}
      }
      if (isPT) log67.info(`v620-fix13: Retry item keywordId=${e.keywordId} identified as ProductTarget`);
      return {
        keywordId: e.keywordId,
        newBid: parseFloat(String(e.newBid)),
        campaignId: e.campaignId || 0,
        reason: `[\u81EA\u52A8\u7EA0\u9519] \u91CD\u8BD5\u4E4B\u524D\u5931\u8D25\u7684\u51FA\u4EF7\u8C03\u6574 (\u539F\u4E8B\u4EF6ID: ${e.id})`,
        isProductTarget: isPT,
        productTargetId: isPT ? e.keywordId : undefined
      };
    });
    if (retryItems.length === 0) {
      log67.info(`v513: \u8D26\u6237${accountId} \u6240\u6709\u5931\u8D25\u7684\u51FA\u4EF7\u8C03\u6574\u5747\u4E3A\u65E0\u6548\u5B9E\u4F53\uFF0C\u5DF2\u5168\u90E8\u6807\u8BB0\u4E3A permanently_failed`);
      return results;
    }
    try {
      const syncResult = await syncBidAdjustmentsToAmazon(
        accountId,
        retryItems
      );
      for (const item of retryItems) {
        const event = Array.from(latestByKeyword.values()).find((e) => e.keywordId === item.keywordId);
        if (!event) continue;
        const itemResult = syncResult.itemResults?.get(item.keywordId);
        const success2 = itemResult?.status === "synced";
        results.push({
          type: "bid_retry",
          accountId,
          targetId: item.keywordId,
          targetType: "keyword",
          previousValue: String(event.previousBid || ""),
          correctedValue: String(item.newBid),
          reason: `\u91CD\u8BD5\u5931\u8D25\u7684\u51FA\u4EF7\u8C03\u6574 (\u539F\u4E8B\u4EF6: ${event.id})`,
          success: success2,
          errorMessage: success2 ? void 0 : itemResult?.error || "\u91CD\u8BD5\u4ECD\u7136\u5931\u8D25"
          // @ts-ignore
        });
        if (success2) {
          await database.update(optimizationEvents2).set({
            apiSyncStatus: "synced",
            apiSyncDetail: JSON.stringify({ correctedBy: "AutoCorrector_v425", correctedAt: (/* @__PURE__ */ new Date()).toISOString(), apiResponseId: itemResult?.apiResponseId }),
            // @ts-ignore
            apiSyncedAt: /* @__PURE__ */ new Date()
          }).where(eq(optimizationEvents2.id, event.id));
          // v620-fix13: Update correct table based on entity type
          if (item.isProductTarget) {
            const { productTargets: productTargets_retry } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
            await database.update(productTargets_retry).set({ bid: String(item.newBid) }).where(eq(productTargets_retry.id, item.keywordId));
            log67.info(`v620-fix13: PT bid updated in product_targets: id=${item.keywordId}, newBid=${item.newBid}`);
          } else {
            await database.update(keywords).set({ bid: String(item.newBid) }).where(eq(keywords.id, item.keywordId));
          }
        } else {
          await database.update(optimizationEvents2).set({
            apiSyncDetail: JSON.stringify({
              lastRetryAt: (/* @__PURE__ */ new Date()).toISOString(),
              retryError: itemResult?.error || "unknown",
              retryBy: "AutoCorrector_v425"
            })
          }).where(eq(optimizationEvents2.id, event.id));
        }
      }
    } catch (apiError) {
      log67.warn(`v178: \u8D26\u6237${accountId} \u51FA\u4EF7\u91CD\u8BD5API\u8C03\u7528\u5931\u8D25: ${apiError.message}`);
      for (const item of retryItems) {
        results.push({
          type: "bid_retry",
          accountId,
          targetId: item.keywordId,
          targetType: "keyword",
          previousValue: "",
          correctedValue: String(item.newBid),
          reason: `\u91CD\u8BD5\u5931\u8D25\u7684\u51FA\u4EF7\u8C03\u6574`,
          success: false,
          errorMessage: apiError.message
        });
      }
    }
  } catch (error48) {
    log67.warn(`v178: \u8D26\u6237${accountId} retryFailedBidAdjustments\u5931\u8D25: ${error48.message}`);
  }
  return results;
}
async function correctBidMismatches(database, accountId) {
  const results = [];
  try {
    const currencyCode = await getAccountCurrencyCode(accountId);
    const bidTolerance = getBidTolerance(currencyCode);
    const mismatchQuery = sql`
 SELECT /*+ MAX_EXECUTION_TIME(60000) */
 oe.id as event_id,
 oe.keyword_id,
 oe.keyword_text,
 oe.campaign_id,
 oe.campaign_name,
 c.campaignId as amazon_campaign_id,
 oe.new_bid as expected_bid,
 oe.previous_bid,
 k.bid as current_bid,
 oe.created_at as optimized_at,
 pg.max_bid as max_bid
 FROM optimization_events oe
 JOIN keywords k ON oe.keyword_id = k.id
 JOIN ad_groups ag ON k.internal_ad_group_id = ag.id
 JOIN campaigns c ON ag.campaignId = c.campaignId
 LEFT JOIN performance_groups pg ON c.performanceGroupId = pg.id
 WHERE oe.account_id = ${accountId}
 AND oe.event_category = 'bid_adjustment'
 AND oe.status = 'success'
 AND oe.api_sync_status = 'synced'
 AND oe.created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
 AND k.keywordId IS NOT NULL
 AND (oe.change_reason IS NULL OR oe.change_reason NOT LIKE '%AutoCorrector%')
 AND (oe.change_reason IS NULL OR oe.change_reason NOT LIKE '%熔断%')
 AND (oe.change_reason IS NULL OR oe.change_reason NOT LIKE '%冷却保护%')
 AND (oe.change_reason IS NULL OR oe.change_reason NOT LIKE '%提价恢复%')
 AND (oe.change_reason IS NULL OR oe.change_reason NOT LIKE '%曝光保护%')
 AND k.keywordStatus NOT IN ('amazon_deleted', 'archived')
 AND ABS(CAST(k.bid AS DECIMAL(10,2)) - CAST(oe.new_bid AS DECIMAL(10,2))) > ${bidTolerance}
 AND oe.id = (
 SELECT MAX(oe2.id) FROM optimization_events oe2 
 WHERE oe2.keyword_id = oe.keyword_id 
 AND oe2.event_category = 'bid_adjustment'
 AND oe2.status = 'success'
 AND oe2.api_sync_status = 'synced'
 AND (oe2.change_reason IS NULL OR oe2.change_reason NOT LIKE '%AutoCorrector%')
 )
 ORDER BY oe.created_at DESC
 LIMIT ${sql.raw(String(AUTO_CORRECTION_CONFIG.maxBidCorrectionsPerRun))}
 `;
    const mismatches = await database.execute(mismatchQuery);
    const rows = mismatches[0] || mismatches;
    if (!Array.isArray(rows) || rows.length === 0) return results;
    log67.info(`v259: \u8D26\u6237${accountId} (${currencyCode}) \u53D1\u73B0${rows.length}\u6761\u51FA\u4EF7\u4E0D\u4E00\u81F4\u5019\u9009\u9879 (bidTolerance=${bidTolerance.toFixed(3)}, \u65F6\u95F4\u7A97\u53E3=1\u5929)`);
    const arbitratedRows = [];
    let arbitrationSkipped = 0;
    for (const row of rows) {
      const newerDecisionQuery = sql`
 SELECT id, new_bid, change_reason, created_at 
 FROM optimization_events 
 WHERE keyword_id = ${row.keyword_id}
 AND event_category = 'bid_adjustment'
 AND status = 'success'
 AND id > ${row.event_id}
 ORDER BY id DESC
 LIMIT 1
 `;
      const newerResult = await database.execute(newerDecisionQuery);
      const newerRows = newerResult[0] || newerResult;
      if (Array.isArray(newerRows) && newerRows.length > 0) {
        const newerDecision = newerRows[0];
        log67.info(`v258\u4EF2\u88C1: \u8DF3\u8FC7keyword=${row.keyword_id}\u7684\u7EA0\u6B63, \u539F\u53C2\u8003\u4E8B\u4EF6#${row.event_id}(bid=$${row.expected_bid}), \u66F4\u65B0\u51B3\u7B56\u4E8B\u4EF6#${newerDecision.id}(bid=$${newerDecision.new_bid}, ${newerDecision.change_reason?.substring(0, 80)})`);
        arbitrationSkipped++;
        continue;
      }
      const recentHoldQuery = sql`
 SELECT id, change_reason FROM optimization_events 
 WHERE keyword_id = ${row.keyword_id}
 AND event_category = 'bid_adjustment'
 AND created_at > DATE_SUB(NOW(), INTERVAL 8 HOUR)
 AND (change_reason LIKE '%冷却保护%' OR change_reason LIKE '%熔断%' OR change_reason LIKE '%提价恢复%' OR change_reason LIKE '%曝光保护%' OR change_reason LIKE '%cooldown%' OR change_reason LIKE '%circuit_breaker%' OR change_reason LIKE '%recovery%')
 ORDER BY id DESC
 LIMIT 1
 `;
      const holdResult = await database.execute(recentHoldQuery);
      const holdRows = holdResult[0] || holdResult;
      if (Array.isArray(holdRows) && holdRows.length > 0) {
        log67.info(`v258\u4EF2\u88C1: \u8DF3\u8FC7keyword=${row.keyword_id}\u7684\u7EA0\u6B63, \u5F53\u524D\u5904\u4E8E\u51B7\u5374/\u7194\u65AD\u4FDD\u62A4\u671F`);
        arbitrationSkipped++;
        continue;
      }
      const recentCorrectionQuery = sql`
 SELECT id FROM optimization_events 
 WHERE keyword_id = ${row.keyword_id}
 AND event_category = 'bid_adjustment'
 AND change_reason LIKE '%AutoCorrector%'
 AND created_at > DATE_SUB(NOW(), INTERVAL 8 HOUR)
 ORDER BY id DESC
 LIMIT 1
 `;
      const recentCorrResult = await database.execute(recentCorrectionQuery);
      const recentCorrRows = recentCorrResult[0] || recentCorrResult;
      if (Array.isArray(recentCorrRows) && recentCorrRows.length > 0) {
        log67.info(`v328\u51B7\u5374: \u8DF3\u8FC7keyword=${row.keyword_id}\u7684\u7EA0\u6B63, 8\u5C0F\u65F6\u5185\u5DF2\u7EA0\u6B63\u8FC7(event#${recentCorrRows[0].id})`);
        arbitrationSkipped++;
        continue;
      }
      arbitratedRows.push(row);
    }
    log67.info(`v328\u4EF2\u88C1\u7ED3\u679C: \u8D26\u6237${accountId} \u539F\u59CB${rows.length}\u6761, \u4EF2\u88C1\u8DF3\u8FC7${arbitrationSkipped}\u6761, \u5B9E\u9645\u7EA0\u6B63${arbitratedRows.length}\u6761`);
    if (arbitratedRows.length === 0) return results;
    const correctionItems = arbitratedRows.map((row) => {
      let targetBid = parseFloat(String(row.expected_bid));
      const maxBid = row.max_bid ? parseFloat(String(row.max_bid)) : 0;
      if (maxBid > 0 && targetBid > maxBid) {
        log67.info(`v178: \u51FA\u4EF7\u7EA0\u6B63\u53D7max_bid\u9650\u5236: keyword=${row.keyword_id} expected=$${targetBid} -> max_bid=$${maxBid}`);
        targetBid = maxBid;
      }
      const currentBid = parseFloat(String(row.current_bid));
      if (Math.abs(targetBid - currentBid) <= bidTolerance) {
        log67.info(`v204: \u8DF3\u8FC7\u7EA0\u6B63(\u5DEE\u5F02\u5728${currencyCode}\u5BB9\u5DEE${bidTolerance.toFixed(3)}\u5185): keyword=${row.keyword_id} target=$${targetBid} current=$${currentBid}`);
        return null;
      }
      // v608c: AutoCorrector also respects ±20% limit (cliff recovery has its own separate path)
      const acMaxChange = currentBid * 0.20;
      let clampedTargetBid = targetBid;
      if (clampedTargetBid > currentBid + acMaxChange) {
        log67.info(`v608c: AutoCorrector\u7EA0\u6B63\u53D7\u00B120%\u9650\u5236: keyword=${row.keyword_id} target=$${targetBid.toFixed(2)} -> clamped=$${(currentBid + acMaxChange).toFixed(2)} (current=$${currentBid.toFixed(2)})`);
        clampedTargetBid = Math.round((currentBid + acMaxChange) * 100) / 100;
      } else if (clampedTargetBid < currentBid - acMaxChange) {
        log67.info(`v608c: AutoCorrector\u7EA0\u6B63\u53D7\u00B120%\u9650\u5236: keyword=${row.keyword_id} target=$${targetBid.toFixed(2)} -> clamped=$${(currentBid - acMaxChange).toFixed(2)} (current=$${currentBid.toFixed(2)})`);
        clampedTargetBid = Math.round((currentBid - acMaxChange) * 100) / 100;
      }
      clampedTargetBid = Math.max(clampedTargetBid, 0.02);
      if (Math.abs(clampedTargetBid - currentBid) <= bidTolerance) {
        return null;
      }
      return {
        keywordId: row.keyword_id,
        newBid: clampedTargetBid,
        campaignId: row.amazon_campaign_id || row.campaign_id || 0,
        reason: `[\u81EA\u52A8\u7EA0\u9519] \u51FA\u4EF7\u4E0D\u4E00\u81F4\u7EA0\u6B63: \u671F\u671B$${clampedTargetBid.toFixed(2)}, \u5F53\u524D$${row.current_bid}${maxBid > 0 ? ` (max_bid=$${maxBid})` : ""}${clampedTargetBid !== targetBid ? ` (\u539F\u59CB\u76EE\u6807$${targetBid.toFixed(2)},\u53D7\u00B120%\u9650\u5236)` : ""}`
        // @ts-ignore
      };
    }).filter((item) => item !== null);
    if (correctionItems.length === 0) {
      log67.info(`v178: \u6240\u6709\u51FA\u4EF7\u7EA0\u6B63\u9879\u5728max_bid\u9650\u5236\u540E\u5DF2\u65E0\u9700\u7EA0\u6B63`);
      return results;
    }
    try {
      const syncResult = await syncBidAdjustmentsToAmazon(
        accountId,
        // @ts-expect-error - runtime type mismatch
        correctionItems
      );
      const correctionMap = new Map(correctionItems.map((item) => [item.keywordId, item.newBid]));
      for (const row of arbitratedRows) {
        const actualTargetBid = correctionMap.get(row.keyword_id);
        if (actualTargetBid === void 0) continue;
        const success2 = syncResult.success > 0;
        results.push({
          // @ts-ignore
          type: "bid_mismatch",
          // @ts-ignore
          accountId,
          // @ts-ignore
          targetId: row.keyword_id,
          targetType: "keyword",
          // @ts-ignore
          previousValue: String(row.current_bid),
          correctedValue: String(actualTargetBid),
          // @ts-ignore
          reason: `\u51FA\u4EF7\u4E0D\u4E00\u81F4: \u7EA0\u6B63\u5230$${actualTargetBid.toFixed(2)}, \u5F53\u524D$${row.current_bid}`,
          success: success2
        });
        if (success2) {
          await database.update(keywords).set({ bid: String(actualTargetBid) }).where(eq(keywords.id, row.keyword_id));
          await logCorrectionEvent(database, {
            accountId,
            eventCategory: "bid_adjustment",
            actionType: "auto_correction",
            // @ts-ignore
            keywordId: row.keyword_id,
            // @ts-ignore
            keywordText: row.keyword_text,
            // @ts-ignore
            campaignId: row.amazon_campaign_id || row.campaign_id,
            // @ts-ignore
            campaignName: row.campaign_name,
            // @ts-ignore
            previousBid: String(row.current_bid),
            newBid: String(actualTargetBid),
            // @ts-ignore
            changeReason: `[AutoCorrector] \u51FA\u4EF7\u4E0D\u4E00\u81F4\u7EA0\u6B63: \u7EA0\u6B63\u5230$${actualTargetBid.toFixed(2)}, \u5F53\u524D$${row.current_bid}${row.max_bid ? ` (max_bid=$${row.max_bid})` : ""}`,
            // @ts-ignore
            sourceEventId: row.event_id,
            // @ts-ignore
            correctionType: "bid_mismatch"
          });
        }
      }
    } catch (apiError) {
      log67.warn(`v178: \u8D26\u6237${accountId} \u51FA\u4EF7\u7EA0\u6B63API\u8C03\u7528\u5931\u8D25: ${apiError.message}`);
      for (const row of arbitratedRows) {
        results.push({
          type: "bid_mismatch",
          accountId,
          // @ts-ignore
          targetId: row.keyword_id,
          targetType: "keyword",
          // @ts-ignore
          previousValue: String(row.current_bid),
          // @ts-ignore
          correctedValue: String(row.expected_bid),
          reason: `\u51FA\u4EF7\u4E0D\u4E00\u81F4\u7EA0\u6B63\u5931\u8D25`,
          success: false,
          errorMessage: apiError.message
        });
      }
    }
  } catch (error48) {
    log67.warn(`v178: \u8D26\u6237${accountId} correctBidMismatches\u5931\u8D25: ${error48.message}`);
  }
  return results;
}
async function retryFailedBudgetAdjustments(database, accountId) {
  const results = [];
  try {
    const expiryDateStr = new Date(Date.now() - AUTO_CORRECTION_CONFIG.retryExpiryDays * 24 * 60 * 60 * 1e3).toISOString().slice(0, 19).replace("T", " ");
    const failedEvents = await database.select({
      id: optimizationEvents2.id,
      campaignId: optimizationEvents2.campaignId,
      campaignName: optimizationEvents2.campaignName,
      previousValue: optimizationEvents2.previousValue,
      newValue: optimizationEvents2.newValue,
      actionDetail: optimizationEvents2.actionDetail,
      createdAt: optimizationEvents2.createdAt
    }).from(optimizationEvents2).where(
      and(
        eq(optimizationEvents2.accountId, accountId),
        eq(optimizationEvents2.eventCategory, "budget_adjustment"),
        eq(optimizationEvents2.status, "success"),
        or(
          eq(optimizationEvents2.apiSyncStatus, "failed"),
          eq(optimizationEvents2.apiSyncStatus, "pending")
        ),
        gte(optimizationEvents2.createdAt, expiryDateStr)
      )
    ).orderBy(desc(optimizationEvents2.createdAt)).limit(AUTO_CORRECTION_CONFIG.maxRetryPerRun);
    if (failedEvents.length === 0) return results;
    log67.warn(`v178: \u8D26\u6237${accountId} \u53D1\u73B0${failedEvents.length}\u6761\u5931\u8D25\u7684\u9884\u7B97\u8C03\u6574\u9700\u8981\u91CD\u8BD5`);
    const latestByCampaign = /* @__PURE__ */ new Map();
    for (const event of failedEvents) {
      const cid = event.campaignId != null ? String(event.campaignId) : "";
      if (cid && !latestByCampaign.has(cid)) {
        latestByCampaign.set(cid, event);
      }
    }
    for (const [campId, event] of latestByCampaign) {
      try {
        const rawBudget = String(event.newValue || "0").replace(/[^0-9.\-]/g, "");
        const newBudget = Math.round(parseFloat(rawBudget));
        if (isNaN(newBudget) || newBudget <= 0) continue;
        const amazonCampaignId = String(campId);
        try {
          const brAnalysis = await analyzeBudgetRules(accountId, amazonCampaignId);
          if (brAnalysis.shouldSkipBudgetAdjustment) {
            log67.info(`[AutoCorrector] v614i-fix22: Campaign ${amazonCampaignId} Budget Rules\u534F\u540C: \u8DF3\u8FC7\u9884\u7B97\u91CD\u8BD5 \u2014 ${brAnalysis.skipReason}`);
            results.push({
              type: "budget_retry",
              accountId,
              targetId: campId,
              targetType: "campaign",
              previousValue: String(event.previousValue || ""),
              correctedValue: String(newBudget),
              reason: `Budget Rules\u534F\u540C\u8DF3\u8FC7: ${brAnalysis.skipReason}`,
              success: false
            });
            continue;
          }
        } catch (brErr) {
          log67.debug(`[AutoCorrector] v614i-fix22: Budget Rules\u5206\u6790\u5931\u8D25: ${brErr.message}\uFF0C\u7EE7\u7EED\u91CD\u8BD5`);
        }
        const syncResult = await syncBudgetAdjustmentToAmazon(
          // @ts-ignore
          accountId,
          String(amazonCampaignId),
          newBudget,
          `[\u81EA\u52A8\u7EA0\u9519] \u91CD\u8BD5\u5931\u8D25\u7684\u9884\u7B97\u8C03\u6574 (\u539F\u4E8B\u4EF6ID: ${event.id})`
        );
        const success2 = !!syncResult;
        results.push({
          type: "budget_retry",
          accountId,
          // @ts-ignore
          targetId: campId,
          targetType: "campaign",
          previousValue: String(event.previousValue || ""),
          correctedValue: String(newBudget),
          reason: `\u91CD\u8BD5\u5931\u8D25\u7684\u9884\u7B97\u8C03\u6574 (\u539F\u4E8B\u4EF6: ${event.id})`,
          success: success2
        });
        if (success2) {
          await database.update(optimizationEvents2).set({
            apiSyncStatus: "synced",
            apiSyncDetail: JSON.stringify({ correctedBy: "AutoCorrector", correctedAt: (/* @__PURE__ */ new Date()).toISOString() }),
            apiSyncedAt: /* @__PURE__ */ new Date()
          }).where(eq(optimizationEvents2.id, event.id));
          await database.update(campaigns).set({ dailyBudget: String(newBudget) }).where(eq(campaigns.campaignId, String(campId)));
        }
      } catch (apiError) {
        results.push({
          type: "budget_retry",
          accountId,
          // @ts-ignore
          targetId: campId,
          targetType: "campaign",
          previousValue: String(event.previousValue || ""),
          correctedValue: String(event.newValue || ""),
          reason: `\u91CD\u8BD5\u5931\u8D25\u7684\u9884\u7B97\u8C03\u6574`,
          success: false,
          errorMessage: apiError.message
        });
      }
    }
  } catch (error48) {
    log67.warn(`v178: \u8D26\u6237${accountId} retryFailedBudgetAdjustments\u5931\u8D25: ${error48.message}`);
  }
  return results;
}
async function correctBudgetMismatches(database, accountId) {
  const results = [];
  try {
    const currencyCode = await getAccountCurrencyCode(accountId);
    const budgetTolerance = getBudgetTolerance(currencyCode);
    const mismatchQuery = sql`
 SELECT /*+ MAX_EXECUTION_TIME(60000) */
 oe.id as event_id,
 oe.campaign_id,
 oe.campaign_name,
 oe.new_value as expected_budget,
 oe.previous_value as previous_budget,
 c.dailyBudget as current_budget,
 c.campaignId as amazon_campaign_id,
 oe.created_at as optimized_at
 FROM optimization_events oe
 JOIN campaigns c ON oe.campaign_id = c.id
 LEFT JOIN performance_groups pg ON c.performanceGroupId = pg.id
 WHERE oe.account_id = ${accountId}
 AND oe.event_category = 'budget_adjustment'
 AND oe.status = 'success'
 AND oe.api_sync_status = 'synced'
 AND oe.created_at > DATE_SUB(NOW(), INTERVAL 3 DAY)
 AND (oe.change_reason IS NULL OR oe.change_reason NOT LIKE '%AutoCorrector%')
 AND (pg.daypartingEnabled IS NULL OR pg.daypartingEnabled = 0)
 AND ABS(CAST(c.dailyBudget AS DECIMAL(10,2)) - CAST(REPLACE(REPLACE(oe.new_value, '$', ''), ',', '') AS DECIMAL(10,2))) > ${budgetTolerance}
 AND oe.id = (
 SELECT MAX(oe2.id) FROM optimization_events oe2 
 WHERE oe2.campaign_id = oe.campaign_id 
 AND oe2.event_category = 'budget_adjustment'
 AND oe2.status = 'success'
 AND oe2.api_sync_status = 'synced'
 AND (oe2.change_reason IS NULL OR oe2.change_reason NOT LIKE '%AutoCorrector%')
 )
 ORDER BY oe.created_at DESC
 LIMIT ${sql.raw(String(AUTO_CORRECTION_CONFIG.maxBudgetCorrectionsPerRun))}
 `;
    const mismatches = await database.execute(mismatchQuery);
    const rows = mismatches[0] || mismatches;
    if (!Array.isArray(rows) || rows.length === 0) return results;
    log67.info(`v204: \u8D26\u6237${accountId} (${currencyCode}) \u53D1\u73B0${rows.length}\u6761\u9884\u7B97\u4E0D\u4E00\u81F4\u9700\u8981\u7EA0\u6B63 (budgetTolerance=${budgetTolerance.toFixed(2)})`);
    for (const row of rows) {
      try {
        const rawExpected = String(row.expected_budget || "0").replace(/[^0-9.\-]/g, "");
        const expectedBudget = Math.round(parseFloat(rawExpected));
        if (isNaN(expectedBudget) || expectedBudget <= 0) {
          log67.warn(`v175: \u8DF3\u8FC7\u65E0\u6548\u9884\u7B97\u503C: campaign=${row.campaign_id}, raw=${row.expected_budget}`);
          continue;
        }
        const currentBudgetNum = parseFloat(String(row.current_budget || "0").replace(/[^0-9.\-]/g, ""));
        if (!isNaN(currentBudgetNum) && Math.abs(expectedBudget - currentBudgetNum) <= budgetTolerance) {
          log67.debug(`v204: \u53D6\u6574\u540E\u9884\u7B97\u5DEE\u5F02\u5728${currencyCode}\u5BB9\u5DEE${budgetTolerance.toFixed(2)}\u5185: campaign=${row.campaign_id}, expected=$${expectedBudget}, current=$${currentBudgetNum}`);
          continue;
        }
        const syncResult = await syncBudgetAdjustmentToAmazon(
          accountId,
          // @ts-ignore
          String(row.amazon_campaign_id),
          expectedBudget,
          // @ts-ignore
          `[\u81EA\u52A8\u7EA0\u9519] \u9884\u7B97\u4E0D\u4E00\u81F4\u7EA0\u6B63: \u671F\u671B$${row.expected_budget}, \u5F53\u524D$${row.current_budget}`
        );
        const success2 = !!syncResult;
        results.push({
          type: "budget_mismatch",
          accountId,
          // @ts-ignore
          targetId: row.campaign_id,
          targetType: "campaign",
          // @ts-ignore
          previousValue: String(row.current_budget),
          // @ts-ignore
          correctedValue: String(row.expected_budget),
          // @ts-ignore
          reason: `\u9884\u7B97\u4E0D\u4E00\u81F4: \u671F\u671B$${row.expected_budget}, \u5F53\u524D$${row.current_budget}`,
          success: success2
        });
        if (success2) {
          await database.update(campaigns).set({ dailyBudget: String(expectedBudget) }).where(eq(campaigns.campaignId, String(row.campaign_id)));
          await logCorrectionEvent(database, {
            accountId,
            eventCategory: "budget_adjustment",
            actionType: "auto_correction",
            // @ts-ignore
            campaignId: row.campaign_id,
            // @ts-ignore
            campaignName: row.campaign_name,
            // @ts-ignore
            previousValue: String(row.current_budget),
            // @ts-ignore
            newValue: String(row.expected_budget),
            changeReason: `[AutoCorrector] \u9884\u7B97\u4E0D\u4E00\u81F4\u7EA0\u6B63`
          });
        }
      } catch (apiError) {
        results.push({
          type: "budget_mismatch",
          accountId,
          // @ts-ignore
          targetId: row.campaign_id,
          // @ts-ignore
          targetType: "campaign",
          // @ts-ignore
          previousValue: String(row.current_budget),
          // @ts-ignore
          correctedValue: String(row.expected_budget),
          reason: `\u9884\u7B97\u4E0D\u4E00\u81F4\u7EA0\u6B63\u5931\u8D25`,
          success: false,
          errorMessage: apiError.message
        });
      }
    }
  } catch (error48) {
    log67.warn(`v178: \u8D26\u6237${accountId} correctBudgetMismatches\u5931\u8D25: ${error48.message}`);
  }
  return results;
}
async function correctPlacementMismatches(database, accountId) {
  const results = [];
  try {
    const mismatchQuery = sql`
 SELECT /*+ MAX_EXECUTION_TIME(60000) */
 oe.id as event_id,
 oe.campaign_id,
 oe.campaign_name,
 oe.action_detail,
 c.placementTopSearchBidAdjustment as current_top,
 c.placementProductPageBidAdjustment as current_product,
 c.campaignId as amazon_campaign_id,
 oe.created_at as optimized_at
 FROM optimization_events oe
 JOIN campaigns c ON oe.campaign_id = c.id
 WHERE oe.account_id = ${accountId}
 AND oe.event_category = 'placement_adjustment'
 AND oe.status = 'success'
 AND oe.api_sync_status IN ('synced', 'pending')
 AND oe.created_at > DATE_SUB(NOW(), INTERVAL 3 DAY)
 AND oe.id = (
 SELECT MAX(oe2.id) FROM optimization_events oe2 
 WHERE oe2.campaign_id = oe.campaign_id 
 AND oe2.event_category = 'placement_adjustment'
 AND oe2.status = 'success'
 )
 ORDER BY oe.created_at DESC
 LIMIT ${sql.raw(String(AUTO_CORRECTION_CONFIG.maxPlacementCorrectionsPerRun))}
 `;
    const mismatches = await database.execute(mismatchQuery);
    const rows = mismatches[0] || mismatches;
    if (!Array.isArray(rows) || rows.length === 0) return results;
    for (const row of rows) {
      try {
        let expectedTop = null;
        let expectedProduct = null;
        if (row.action_detail) {
          try {
            const detail = typeof row.action_detail === "string" ? JSON.parse(row.action_detail) : row.action_detail;
            expectedTop = detail.newTopOfSearch ?? detail.suggestedTopMultiplier ?? null;
            expectedProduct = detail.newProductPage ?? detail.suggestedProductMultiplier ?? null;
          } catch (e) {
            log67.debug(`[AutoCorrector] \u975E\u5173\u952E\u64CD\u4F5C\u5931\u8D25: ${e?.message}`);
          }
        }
        if (expectedTop === null && expectedProduct === null) continue;
        const currentTop = parseFloat(String(row.current_top || "0"));
        const currentProduct = parseFloat(String(row.current_product || "0"));
        const topMismatch = expectedTop !== null && Math.abs(currentTop - expectedTop) > AUTO_CORRECTION_CONFIG.placementTolerancePercent;
        const productMismatch = expectedProduct !== null && Math.abs(currentProduct - expectedProduct) > AUTO_CORRECTION_CONFIG.placementTolerancePercent;
        if (!topMismatch && !productMismatch) continue;
        const syncResult = await syncPlacementAdjustmentToAmazon(
          accountId,
          // @ts-ignore
          String(row.amazon_campaign_id),
          expectedTop ?? currentTop,
          expectedProduct ?? currentProduct,
          `[\u81EA\u52A8\u7EA0\u9519] \u4F4D\u7F6E\u503E\u659C\u4E0D\u4E00\u81F4\u7EA0\u6B63`
        );
        const success2 = !!syncResult;
        results.push({
          type: "placement_mismatch",
          accountId,
          // @ts-ignore
          targetId: row.campaign_id,
          targetType: "campaign",
          previousValue: `Top:${currentTop}%, Product:${currentProduct}%`,
          correctedValue: `Top:${expectedTop ?? currentTop}%, Product:${expectedProduct ?? currentProduct}%`,
          reason: `\u4F4D\u7F6E\u503E\u659C\u4E0D\u4E00\u81F4\u7EA0\u6B63`,
          success: success2
        });
        if (success2) {
          const updateData = {};
          if (expectedTop !== null) updateData.placementTopSearchBidAdjustment = String(expectedTop);
          if (expectedProduct !== null) updateData.placementProductPageBidAdjustment = String(expectedProduct);
          await database.update(campaigns).set(updateData).where(eq(campaigns.campaignId, String(row.campaign_id)));
        }
      } catch (apiError) {
        results.push({
          type: "placement_mismatch",
          accountId,
          // @ts-ignore
          targetId: row.campaign_id,
          targetType: "campaign",
          previousValue: "",
          correctedValue: "",
          // @ts-ignore
          reason: `\u4F4D\u7F6E\u503E\u659C\u7EA0\u6B63\u5931\u8D25`,
          success: false,
          errorMessage: apiError.message
        });
      }
    }
  } catch (error48) {
    log67.warn(`v178: \u8D26\u6237${accountId} correctPlacementMismatches\u5931\u8D25: ${error48.message}`);
  }
  return results;
}
async function executeUnfinishedRollbacks(database, accountId) {
  const results = [];
  try {
    const unfinishedRollbacks = await database.select({
      id: optimizationEvents2.id,
      keywordId: optimizationEvents2.keywordId,
      keywordText: optimizationEvents2.keywordText,
      campaignId: optimizationEvents2.campaignId,
      // @ts-ignore
      campaignName: optimizationEvents2.campaignName,
      previousBid: optimizationEvents2.previousBid,
      newBid: optimizationEvents2.newBid,
      createdAt: optimizationEvents2.createdAt
    }).from(optimizationEvents2).where(
      and(
        eq(optimizationEvents2.accountId, accountId),
        eq(optimizationEvents2.eventCategory, "bid_adjustment"),
        eq(optimizationEvents2.status, "rolled_back"),
        isNull(optimizationEvents2.rolledBackAt)
      )
    ).orderBy(desc(optimizationEvents2.createdAt)).limit(AUTO_CORRECTION_CONFIG.maxRollbackPerRun);
    if (unfinishedRollbacks.length === 0) return results;
    log67.info(`v178: \u8D26\u6237${accountId} \u53D1\u73B0${unfinishedRollbacks.length}\u6761\u672A\u6267\u884C\u7684\u56DE\u6EDA`);
    const latestByKeyword = /* @__PURE__ */ new Map();
    for (const event of unfinishedRollbacks) {
      if (event.keywordId && !latestByKeyword.has(event.keywordId)) {
        latestByKeyword.set(event.keywordId, event);
      }
    }
    const rollbackItems = Array.from(latestByKeyword.values()).filter((e) => e.keywordId && e.previousBid).map((e) => ({
      keywordId: e.keywordId,
      newBid: parseFloat(String(e.previousBid)),
      campaignId: e.campaignId || 0,
      reason: `[\u81EA\u52A8\u7EA0\u9519] \u6267\u884C\u56DE\u6EDA: \u6062\u590D\u51FA\u4EF7\u4ECE$${e.newBid}\u5230$${e.previousBid}`
    }));
    if (rollbackItems.length === 0) return results;
    try {
      const syncResult = await syncBidAdjustmentsToAmazon(
        accountId,
        rollbackItems
      );
      const success2 = syncResult.success > 0;
      for (const [kwId, event] of latestByKeyword) {
        results.push({
          type: "rollback_execution",
          accountId,
          targetId: kwId,
          targetType: "keyword",
          previousValue: String(event.newBid || ""),
          correctedValue: String(event.previousBid || ""),
          reason: `\u6267\u884C\u56DE\u6EDA: $${event.newBid} \u2192 $${event.previousBid}`,
          success: success2
        });
        if (success2) {
          await database.update(optimizationEvents2).set({
            rolledBackAt: /* @__PURE__ */ new Date(),
            rolledBackBy: "AutoCorrector",
            apiSyncStatus: "synced",
            apiSyncDetail: JSON.stringify({ rolledBackBy: "AutoCorrector", rolledBackAt: (/* @__PURE__ */ new Date()).toISOString() })
          }).where(eq(optimizationEvents2.id, event.id));
          await database.update(keywords).set({ bid: String(event.previousBid) }).where(eq(keywords.id, kwId));
        }
      }
    } catch (apiError) {
      log67.warn(`v178: \u8D26\u6237${accountId} \u56DE\u6EDA\u6267\u884CAPI\u8C03\u7528\u5931\u8D25: ${apiError.message}`);
    }
  } catch (error48) {
    log67.warn(`v178: \u8D26\u6237${accountId} executeUnfinishedRollbacks\u5931\u8D25: ${error48.message}`);
  }
  return results;
}
async function retryFailedSettingsChanges(database, accountId) {
  const results = [];
  try {
    const expiryDateStr = new Date(Date.now() - AUTO_CORRECTION_CONFIG.retryExpiryDays * 24 * 60 * 60 * 1e3).toISOString().slice(0, 19).replace("T", " ");
    const failedEvents = await database.select({
      id: optimizationEvents2.id,
      campaignId: optimizationEvents2.campaignId,
      campaignName: optimizationEvents2.campaignName,
      // @ts-ignore
      actionType: optimizationEvents2.actionType,
      actionDetail: optimizationEvents2.actionDetail,
      previousValue: optimizationEvents2.previousValue,
      newValue: optimizationEvents2.newValue,
      createdAt: optimizationEvents2.createdAt
    }).from(optimizationEvents2).where(
      and(
        eq(optimizationEvents2.accountId, accountId),
        eq(optimizationEvents2.eventCategory, "settings_change"),
        eq(optimizationEvents2.apiSyncStatus, "failed"),
        gte(optimizationEvents2.createdAt, expiryDateStr)
      )
    ).orderBy(desc(optimizationEvents2.createdAt)).limit(AUTO_CORRECTION_CONFIG.maxRetryPerRun);
    if (failedEvents.length === 0) return results;
    log67.warn(`v178: \u8D26\u6237${accountId} \u53D1\u73B0${failedEvents.length}\u6761\u5931\u8D25\u7684\u8BBE\u7F6E\u53D8\u66F4\u9700\u8981\u91CD\u8BD5`);
    const internalEvents = [];
    const apiEvents = [];
    for (const event of failedEvents) {
      const actionType = event.actionType || "";
      const detail = event.actionDetail ? (() => {
        try {
          return JSON.parse(event.actionDetail || "{}");
        } catch {
          return {};
        }
      })() : {};
      const detailType = detail.type || "";
      if (isInternalEvent(actionType, "settings_change") || ["system_deploy", "target_reoptimized", "algorithm_config", "strategy_update", "system_config"].includes(detailType)) {
        internalEvents.push(event);
      } else {
        apiEvents.push(event);
      }
    }
    if (internalEvents.length > 0) {
      const internalIds = internalEvents.map((e) => e.id);
      try {
        await database.execute(sql`
          UPDATE optimization_events 
          SET api_sync_status = 'internal',
              api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.v513_reclassified', true, '$.reason', 'v513: 内部系统事件，不需要Amazon API同步')
          WHERE id IN (${safeInClause(internalIds)})
        `);
        log67.info(`v513: \u8D26\u6237${accountId} \u5C06${internalEvents.length}\u6761\u5185\u90E8\u4E8B\u4EF6\u4ECE failed \u91CD\u5206\u7C7B\u4E3A internal`);
      } catch (reclassErr) {
        log67.warn(`v513: \u6279\u91CF\u91CD\u5206\u7C7B\u5185\u90E8\u4E8B\u4EF6\u5931\u8D25: ${reclassErr.message}`);
      }
      for (const event of internalEvents) {
        results.push({
          type: "settings_retry",
          accountId,
          targetId: event.campaignId || 0,
          targetType: "campaign",
          previousValue: String(event.previousValue || ""),
          correctedValue: "internal",
          reason: `v513: \u5185\u90E8\u4E8B\u4EF6\u91CD\u5206\u7C7B (${event.actionType})`,
          success: true
        });
      }
    }
    if (apiEvents.length === 0) {
      log67.info(`v513: \u8D26\u6237${accountId} \u6240\u6709\u5931\u8D25\u7684\u8BBE\u7F6E\u53D8\u66F4\u5747\u4E3A\u5185\u90E8\u4E8B\u4EF6\uFF0C\u5DF2\u5168\u90E8\u91CD\u5206\u7C7B`);
      return results;
    }
    log67.info(`v513: \u8D26\u6237${accountId} ${internalEvents.length}\u6761\u5185\u90E8\u4E8B\u4EF6\u5DF2\u91CD\u5206\u7C7B\uFF0C\u5269\u4F59${apiEvents.length}\u6761\u771F\u6B63\u7684API\u4E8B\u4EF6\u9700\u8981\u91CD\u8BD5`);
    for (const event of apiEvents) {
      try {
        let success2 = false;
        const actionType = event.actionType || "";
        const detail = event.actionDetail ? JSON.parse(event.actionDetail || "{}") : {};
        const detailType = detail.type || "";
        if ((actionType.includes("budget") || detailType === "budget_adjustment") && event.campaignId && event.newValue) {
          const amazonCampaignId = String(event.campaignId);
          if (amazonCampaignId) {
            const syncResult = await syncBudgetAdjustmentToAmazon(
              accountId,
              amazonCampaignId,
              Math.round(parseFloat(String(event.newValue || "0").replace(/[^0-9.\-]/g, ""))),
              `[\u81EA\u52A8\u7EA0\u9519] \u91CD\u8BD5\u8BBE\u7F6E\u53D8\u66F4`
            );
            success2 = !!syncResult;
          }
        } else if ((actionType.includes("bid") || detailType === "bid_adjustment") && event.campaignId && event.newValue) {
          const kwId = detail.keywordId || detail.targetId;
          if (kwId) {
            const syncResult = await syncBidAdjustmentsToAmazon(
              accountId,
              [{ keywordId: kwId, newBid: parseFloat(String(event.newValue || "0").replace(/[^0-9.\-]/g, "")), reason: `v329 AutoCorrector: \u91CD\u8BD5\u5931\u8D25\u7684${actionType}\u64CD\u4F5C` }]
            );
            success2 = syncResult.success > 0;
          }
        } else if ((actionType.includes("placement") || detailType === "placement_adjustment") && event.campaignId) {
          const amazonCampaignId = String(event.campaignId);
          if (amazonCampaignId) {
            const placementValue = parseFloat(String(event.newValue || "0").replace(/[^0-9.\-]/g, ""));
            const placementType = detail.placementType || "top";
            const syncResult = await syncPlacementAdjustmentToAmazon(
              accountId,
              amazonCampaignId,
              placementType,
              placementValue,
              `[\u81EA\u52A8\u7EA0\u9519] \u91CD\u8BD5\u4F4D\u7F6E\u503E\u659C\u53D8\u66F4`
            );
            success2 = !!syncResult;
          }
        } else if (["system_deploy", "target_reoptimized", "algorithm_config", "strategy_update", "system_config"].includes(detailType)) {
          await database.update(optimizationEvents2).set({
            apiSyncStatus: "internal",
            apiSyncDetail: JSON.stringify({ reason: "v513: \u5185\u90E8\u7CFB\u7EDF\u4E8B\u4EF6\uFF0C\u4E0D\u9700\u8981Amazon API\u540C\u6B65", fixedAt: (/* @__PURE__ */ new Date()).toISOString() })
          }).where(eq(optimizationEvents2.id, event.id));
          success2 = true;
        }
        results.push({
          type: "settings_retry",
          accountId,
          targetId: event.campaignId || 0,
          targetType: "campaign",
          previousValue: String(event.previousValue || ""),
          correctedValue: String(event.newValue || ""),
          reason: `\u91CD\u8BD5\u5931\u8D25\u7684\u8BBE\u7F6E\u53D8\u66F4 (${actionType})`,
          success: success2
        });
        if (success2) {
          await database.update(optimizationEvents2).set({
            apiSyncStatus: "synced",
            apiSyncDetail: JSON.stringify({ correctedBy: "AutoCorrector", correctedAt: (/* @__PURE__ */ new Date()).toISOString() }),
            apiSyncedAt: /* @__PURE__ */ new Date()
          }).where(eq(optimizationEvents2.id, event.id));
        }
      } catch (retryError) {
        results.push({
          type: "settings_retry",
          accountId,
          targetId: event.campaignId || 0,
          targetType: "campaign",
          previousValue: "",
          // @ts-ignore
          correctedValue: "",
          reason: `\u8BBE\u7F6E\u53D8\u66F4\u91CD\u8BD5\u5931\u8D25`,
          // @ts-ignore
          success: false,
          errorMessage: retryError.message
        });
      }
    }
  } catch (error48) {
    log67.warn(`v178: \u8D26\u6237${accountId} retryFailedSettingsChanges\u5931\u8D25: ${error48.message}`);
  }
  return results;
}
async function retryFailedKeywordCreations(database, accountId) {
  const results = [];
  try {
    const expiryDateStr = new Date(Date.now() - AUTO_CORRECTION_CONFIG.retryExpiryDays * 24 * 60 * 60 * 1e3).toISOString().slice(0, 19).replace("T", " ");
    const failedEvents = await database.select({
      // @ts-ignore
      id: optimizationEvents2.id,
      keywordId: optimizationEvents2.keywordId,
      keywordText: optimizationEvents2.keywordText,
      campaignId: optimizationEvents2.campaignId,
      campaignName: optimizationEvents2.campaignName,
      actionDetail: optimizationEvents2.actionDetail,
      createdAt: optimizationEvents2.createdAt
    }).from(optimizationEvents2).where(
      // @ts-ignore
      and(
        // @ts-ignore
        eq(optimizationEvents2.accountId, accountId),
        // @ts-ignore
        eq(optimizationEvents2.actionType, "keyword_create"),
        or(
          eq(optimizationEvents2.apiSyncStatus, "failed"),
          // @ts-ignore
          eq(optimizationEvents2.apiSyncStatus, "pending")
        ),
        gte(optimizationEvents2.createdAt, expiryDateStr)
        // @ts-ignore
      )
    ).orderBy(desc(optimizationEvents2.createdAt)).limit(AUTO_CORRECTION_CONFIG.maxRetryPerRun);
    if (failedEvents.length === 0) return results;
    log67.warn(`v178: \u8D26\u6237${accountId} \u53D1\u73B0${failedEvents.length}\u6761\u5931\u8D25/pending\u7684\u5173\u952E\u8BCD\u521B\u5EFA\u9700\u8981\u91CD\u8BD5`);
    for (const event of failedEvents) {
      try {
        let detail = {};
        if (event.actionDetail) {
          try {
            detail = typeof event.actionDetail === "string" ? JSON.parse(event.actionDetail) : event.actionDetail;
          } catch (e) {
            log67.debug(`[AutoCorrector] \u975E\u5173\u952E\u64CD\u4F5C\u5931\u8D25: ${e?.message}`);
          }
        }
        const localKeywordId = event.keywordId || detail.localKeywordId;
        if (!localKeywordId) {
          log67.warn(`v178: \u5173\u952E\u8BCD\u521B\u5EFA\u91CD\u8BD5\u8DF3\u8FC7 - \u65E0\u672C\u5730keywordId, eventId=${event.id}`);
          continue;
        }
        const kwRows = await database.select({ id: keywords.id, keywordId: keywords.keywordId, adGroupId: keywords.internalAdGroupId, keywordText: keywords.keywordText, matchType: keywords.matchType, bid: keywords.bid }).from(keywords).where(eq(keywords.id, localKeywordId)).limit(1);
        if (kwRows.length === 0) {
          await database.update(optimizationEvents2).set({ apiSyncStatus: "not_applicable", apiSyncDetail: JSON.stringify({ reason: "keyword_deleted" }) }).where(eq(optimizationEvents2.id, event.id));
          continue;
        }
        const kw = kwRows[0];
        if (kw.keywordId) {
          await database.update(optimizationEvents2).set({ apiSyncStatus: "synced", apiSyncDetail: JSON.stringify({ amazonKeywordId: kw.keywordId, correctedBy: "AutoCorrector" }) }).where(eq(optimizationEvents2.id, event.id));
          results.push({ type: "keyword_create_retry", accountId, targetId: localKeywordId, targetType: "keyword", previousValue: "", correctedValue: kw.keywordId, reason: "\u5173\u952E\u8BCD\u5DF2\u5B58\u5728Amazon ID\uFF0C\u76F4\u63A5\u6807\u8BB0\u4E3Asynced", success: true });
          continue;
        }
        const agRows = await database.select({ adGroupId: adGroups.adGroupId, campaignId: adGroups.campaignId }).from(adGroups).where(eq(adGroups.id, kw.internalAdGroupId)).limit(1);
        if (agRows.length === 0) {
          log67.warn(`v178: \u5173\u952E\u8BCD\u521B\u5EFA\u91CD\u8BD5\u8DF3\u8FC7 - \u65E0adGroup, keywordId=${localKeywordId}`);
          continue;
        }
        const ag = agRows[0];
        const campRows = await database.select({ campaignId: campaigns.campaignId }).from(campaigns).where(eq(campaigns.campaignId, ag.campaignId)).limit(1);
        if (campRows.length === 0) continue;
        const syncResult = await syncNewKeywordsToAmazon(accountId, [{
          localKeywordId,
          // @ts-ignore
          adGroupId: Number(ag.adGroupId),
          campaignId: campRows[0].campaignId,
          // v201: 保持字符串避免精度丢失
          // @ts-ignore
          keywordText: kw.keywordText,
          // @ts-ignore
          matchType: kw.matchType,
          // @ts-ignore
          bid: parseFloat(String(kw.bid)) || 0.75
        }]);
        const success2 = syncResult.success > 0;
        if (success2) {
          await database.update(optimizationEvents2).set({
            apiSyncStatus: "synced",
            // @ts-ignore
            apiSyncDetail: JSON.stringify({ correctedBy: "AutoCorrector", amazonKeywordId: syncResult.createdKeywords[0]?.amazonKeywordId }),
            apiSyncedAt: /* @__PURE__ */ new Date()
          }).where(eq(optimizationEvents2.id, event.id));
          if (event.id) {
            await database.execute(sql`
              UPDATE optimization_logs SET api_sync_status = 'synced' 
              WHERE id = (SELECT source_id FROM optimization_events WHERE id = ${event.id} AND source_table = 'optimization_logs')
            `).catch(() => {
            });
          }
        } else {
          await database.update(optimizationEvents2).set({
            apiSyncStatus: "failed",
            // @ts-ignore
            apiSyncDetail: JSON.stringify({ error: syncResult.errors.join("; "), retryBy: "AutoCorrector" })
          }).where(eq(optimizationEvents2.id, event.id));
        }
        results.push({
          // @ts-expect-error - type assertion
          type: "keyword_create_retry",
          accountId,
          targetId: localKeywordId,
          targetType: "keyword",
          previousValue: "",
          // @ts-ignore
          correctedValue: kw.keywordText,
          // @ts-ignore
          reason: `\u91CD\u8BD5\u521B\u5EFA\u5173\u952E\u8BCD: ${kw.keywordText}`,
          success: success2,
          // @ts-ignore
          errorMessage: success2 ? void 0 : syncResult.errors.join("; ")
        });
      } catch (retryError) {
        results.push({ type: "keyword_create_retry", accountId, targetId: event.keywordId || 0, targetType: "keyword", previousValue: "", correctedValue: "", reason: "\u5173\u952E\u8BCD\u521B\u5EFA\u91CD\u8BD5\u5931\u8D25", success: false, errorMessage: retryError.message });
      }
    }
  } catch (error48) {
    log67.warn(`v178: \u8D26\u6237${accountId} retryFailedKeywordCreations\u5931\u8D25: ${error48.message}`);
  }
  return results;
}
async function retryFailedNegativeKeywordAdds(database, accountId) {
  const results = [];
  try {
    const expiryDateStr = new Date(Date.now() - AUTO_CORRECTION_CONFIG.retryExpiryDays * 24 * 60 * 60 * 1e3).toISOString().slice(0, 19).replace("T", " ");
    const failedEvents = await database.select({
      id: optimizationEvents2.id,
      campaignId: optimizationEvents2.campaignId,
      campaignName: optimizationEvents2.campaignName,
      keywordText: optimizationEvents2.keywordText,
      actionDetail: optimizationEvents2.actionDetail,
      // @ts-ignore
      apiSyncDetail: optimizationEvents2.apiSyncDetail,
      createdAt: optimizationEvents2.createdAt
    }).from(optimizationEvents2).where(
      and(
        eq(optimizationEvents2.accountId, accountId),
        eq(optimizationEvents2.actionType, "negative_keyword_add"),
        or(
          // @ts-ignore
          eq(optimizationEvents2.apiSyncStatus, "failed"),
          eq(optimizationEvents2.apiSyncStatus, "pending")
        ),
        gte(optimizationEvents2.createdAt, expiryDateStr)
      )
    ).orderBy(desc(optimizationEvents2.createdAt)).limit(AUTO_CORRECTION_CONFIG.maxRetryPerRun);
    if (failedEvents.length === 0) return results;
    log67.warn(`v178: \u8D26\u6237${accountId} \u53D1\u73B0${failedEvents.length}\u6761\u5931\u8D25/pending\u7684\u5426\u5B9A\u5173\u952E\u8BCD\u6DFB\u52A0\u9700\u8981\u91CD\u8BD5`);
    const negKeywordsToSync = [];
    for (const event of failedEvents) {
      try {
        let detail = {};
        if (event.actionDetail) {
          try {
            detail = typeof event.actionDetail === "string" ? JSON.parse(event.actionDetail) : event.actionDetail;
          } catch (e) {
            log67.debug(`[AutoCorrector] \u975E\u5173\u952E\u64CD\u4F5C\u5931\u8D25: ${e?.message}`);
          }
        }
        const searchTerm = detail.searchTerm || event.keywordText;
        const matchType = detail.matchType || "negative_phrase";
        const amazonCampaignId = detail.amazonCampaignId;
        const amazonAdGroupId = detail.amazonAdGroupId;
        if (!searchTerm) continue;
        let resolvedCampaignId = amazonCampaignId;
        if (!resolvedCampaignId && event.campaignId) {
          resolvedCampaignId = String(event.campaignId);
          log67.debug(`v441: \u5426\u5B9A\u8BCDcampaignId: \u76F4\u63A5\u4F7F\u7528event.campaignId=${resolvedCampaignId}\u4F5C\u4E3AAmazon ID`);
        }
        if (!resolvedCampaignId) {
          log67.warn(`v201: \u8DF3\u8FC7\u5426\u5B9A\u8BCD\u4E8B\u4EF6 eventId=${event.id}: \u65E0\u6CD5\u89E3\u6790campaignId (event.campaignId=${event.campaignId}, amazonCampaignId=${amazonCampaignId})`);
          continue;
        }
        const normalizedMatchType = matchType.includes("exact") ? "negativeExact" : "negativePhrase";
        let retryCount = 0;
        if (event.apiSyncDetail) {
          try {
            const syncDetail = typeof event.apiSyncDetail === "string" ? JSON.parse(event.apiSyncDetail) : event.apiSyncDetail;
            retryCount = syncDetail.retryCount || 0;
          } catch (e) {
            log67.debug(`[AutoCorrector] \u975E\u5173\u952E\u64CD\u4F5C\u5931\u8D25: ${e?.message}`);
          }
        }
        const nkEntry = {
          eventId: event.id,
          campaignId: resolvedCampaignId,
          internalAdGroupId: amazonAdGroupId || void 0,
          // v421: 使用internalAdGroupId
          keywordText: searchTerm,
          matchType: normalizedMatchType,
          level: amazonAdGroupId ? "adgroup" : "campaign",
          retryCount
          // @ts-ignore
        };
        negKeywordsToSync.push(nkEntry);
      } catch (parseErr) {
        log67.warn(`v178: \u89E3\u6790\u5426\u5B9A\u5173\u952E\u8BCD\u4E8B\u4EF6\u5931\u8D25: eventId=${event.id}, ${parseErr.message}`);
      }
    }
    if (negKeywordsToSync.length === 0) return results;
    const maxRetries = AUTO_CORRECTION_CONFIG.maxRetryAttempts;
    const toRetry = [];
    const toPermanentlyFail = [];
    for (const nk of negKeywordsToSync) {
      if (nk.retryCount >= maxRetries) {
        toPermanentlyFail.push(nk);
      } else {
        toRetry.push(nk);
      }
    }
    for (const nk of toPermanentlyFail) {
      await database.update(optimizationEvents2).set({
        apiSyncStatus: "not_applicable",
        apiSyncDetail: JSON.stringify({
          reason: `\u8D85\u8FC7\u6700\u5927\u91CD\u8BD5\u6B21\u6570(${maxRetries})\uFF0C\u653E\u5F03\u91CD\u8BD5`,
          retryCount: nk.retryCount,
          lastRetryAt: (/* @__PURE__ */ new Date()).toISOString()
        })
        // @ts-ignore
      }).where(eq(optimizationEvents2.id, nk.eventId));
      await database.execute(sql`
        UPDATE optimization_logs SET api_sync_status = 'not_applicable'
        WHERE id = (SELECT source_id FROM optimization_events WHERE id = ${nk.eventId} AND source_table = 'optimization_logs')
      `).catch(() => {
      });
      results.push({
        type: "settings_retry",
        // @ts-ignore
        accountId,
        targetId: nk.campaignId,
        targetType: "campaign",
        previousValue: "",
        correctedValue: nk.keywordText,
        reason: `\u5426\u5B9A\u5173\u952E\u8BCD\u8D85\u8FC7\u6700\u5927\u91CD\u8BD5\u6B21\u6570\uFF0C\u653E\u5F03: ${nk.keywordText}`,
        success: false,
        errorMessage: `\u8D85\u8FC7\u6700\u5927\u91CD\u8BD5\u6B21\u6570(${maxRetries})`
        // @ts-ignore
      });
    }
    if (toRetry.length === 0) return results;
    log67.info(`v201: \u51C6\u5907\u540C\u6B65${toRetry.length}\u4E2A\u5426\u5B9A\u5173\u952E\u8BCD\u5230Amazon:`);
    for (const nk of toRetry) {
      log67.debug(`  - eventId=${nk.eventId}, campaignId=${nk.campaignId}, keyword="${nk.keywordText}", matchType=${nk.matchType}, level=${nk.level}`);
    }
    const syncResult = await syncNegativeKeywordsToAmazon(
      // @ts-ignore
      accountId,
      toRetry.map((nk) => ({
        campaignId: String(nk.campaignId),
        // v356: 统一使用String类型传递Amazon ID
        adGroupId: nk.internalAdGroupId ? String(nk.internalAdGroupId) : void 0,
        // v356: 统一使用String类型
        keywordText: nk.keywordText,
        matchType: nk.matchType,
        level: nk.level
      }))
    );
    log67.warn(`v201: \u5426\u5B9A\u5173\u952E\u8BCD\u540C\u6B65\u7ED3\u679C: \u6210\u529F=${syncResult.success}, \u5931\u8D25=${syncResult.failed}, \u9519\u8BEF\u6570=${syncResult.errors.length}`);
    if (syncResult.errors.length > 0) {
      log67.warn(`v201: \u5426\u5B9A\u5173\u952E\u8BCD\u540C\u6B65\u9519\u8BEF\u8BE6\u60C5:`);
      for (const err of syncResult.errors) {
        log67.debug(`  - ${err}`);
      }
    }
    const failedKeywords = /* @__PURE__ */ new Set();
    for (const err of syncResult.errors) {
      const match = err.match(/\[(.+?)\]/);
      if (match) failedKeywords.add(match[1].toLowerCase());
    }
    for (const nk of toRetry) {
      const keywordFailed = failedKeywords.has(nk.keywordText.toLowerCase());
      const success2 = !keywordFailed && syncResult.success > 0;
      const newRetryCount = (nk.retryCount || 0) + 1;
      const isPermanentError = keywordFailed && syncResult.errors.some(
        (e) => e.toLowerCase().includes(nk.keywordText.toLowerCase()) && (e.includes("PATTERN_NOT_MATCHED") || e.includes("Keyword is invalid") || e.includes("malformedValueError"))
      );
      if (success2) {
        await database.update(optimizationEvents2).set({
          apiSyncStatus: "synced",
          apiSyncDetail: JSON.stringify({ correctedBy: "AutoCorrector", correctedAt: (/* @__PURE__ */ new Date()).toISOString(), retryCount: newRetryCount }),
          apiSyncedAt: /* @__PURE__ */ new Date()
        }).where(eq(optimizationEvents2.id, nk.eventId));
        await database.execute(sql`
          UPDATE optimization_logs SET api_sync_status = 'synced' 
          WHERE id = (SELECT source_id FROM optimization_events WHERE id = ${nk.eventId} AND source_table = 'optimization_logs')
        `).catch(() => {
        });
        const negLevel = nk.level || "campaign";
        const mapKey = negLevel === "campaign" ? `campaign:${nk.campaignId}:${nk.keywordText.toLowerCase()}` : `adgroup:${nk.internalAdGroupId}:${nk.keywordText.toLowerCase()}`;
        const amazonNegId = syncResult.keywordIdMap?.get(mapKey);
        if (amazonNegId) {
          await database.execute(sql`
 UPDATE negative_keywords 
 SET amazon_negative_keyword_id = ${amazonNegId}
 WHERE negativeText = ${nk.keywordText}
 AND campaignId = ${String(nk.campaignId)}
 AND amazon_negative_keyword_id IS NULL
 LIMIT 1
 `).catch((err) => {
            log67.warn(`v196: \u56DE\u5199\u5426\u5B9A\u8BCDID\u5931\u8D25: ${err.message}`);
          });
          log67.info(`v196: \u5426\u5B9A\u8BCD\u540C\u6B65\u6210\u529F\u5E76\u56DE\u5199ID: "${nk.keywordText}" -> ${amazonNegId}`);
        } else {
          log67.info(`v196: \u5426\u5B9A\u8BCD\u540C\u6B65\u6210\u529F\u4F46\u672A\u83B7\u53D6\u5230Amazon ID: "${nk.keywordText}"`);
        }
      } else if (isPermanentError) {
        await database.update(optimizationEvents2).set({
          apiSyncStatus: "not_applicable",
          apiSyncDetail: JSON.stringify({
            reason: `Amazon\u62D2\u7EDD\u5173\u952E\u8BCD: ${nk.keywordText}`,
            retryCount: newRetryCount,
            lastRetryAt: (/* @__PURE__ */ new Date()).toISOString(),
            permanentError: true
          })
        }).where(eq(optimizationEvents2.id, nk.eventId));
        await database.execute(sql`
          UPDATE optimization_logs SET api_sync_status = 'not_applicable'
          WHERE id = (SELECT source_id FROM optimization_events WHERE id = ${nk.eventId} AND source_table = 'optimization_logs')
        `).catch(() => {
        });
        log67.debug(`v178: \u5426\u5B9A\u8BCDAmazon\u6C38\u4E45\u62D2\u7EDD\uFF0C\u505C\u6B62\u91CD\u8BD5: "${nk.keywordText}"`);
        await database.execute(sql`
          UPDATE negative_keywords SET negativeStatus = 'removed'
          WHERE negativeText = ${nk.keywordText}
            AND amazon_negative_keyword_id IS NULL
        `).catch((err) => {
          log67.warn(`v178: \u66F4\u65B0negative_keywords\u5931\u8D25: ${err.message}`);
        });
      } else {
        await database.update(optimizationEvents2).set({
          apiSyncDetail: JSON.stringify({
            retryCount: newRetryCount,
            lastRetryAt: (/* @__PURE__ */ new Date()).toISOString(),
            // @ts-ignore
            lastError: syncResult.errors.join("; ").substring(0, 200)
          })
        }).where(eq(optimizationEvents2.id, nk.eventId));
      }
      results.push({
        type: "settings_retry",
        accountId,
        targetId: nk.campaignId,
        targetType: "campaign",
        previousValue: "",
        correctedValue: nk.keywordText,
        reason: isPermanentError ? `\u5426\u5B9A\u5173\u952E\u8BCDAmazon\u6C38\u4E45\u62D2\u7EDD: ${nk.keywordText}` : `\u91CD\u8BD5\u6DFB\u52A0\u5426\u5B9A\u5173\u952E\u8BCD(${newRetryCount}/${maxRetries}): ${nk.keywordText}`,
        success: success2,
        // @ts-ignore
        errorMessage: success2 ? void 0 : syncResult.errors.join("; ")
      });
    }
  } catch (error48) {
    log67.warn(`v178: \u8D26\u6237${accountId} retryFailedNegativeKeywordAdds\u5931\u8D25: ${error48.message}`);
  }
  return results;
}
async function getActiveAccountIds(database) {
  try {
    const result = await database.execute(sql`
      SELECT DISTINCT account_id FROM optimization_events 
      WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY) 
        AND account_id IS NOT NULL
    `);
    const rows = result[0] || result;
    return Array.isArray(rows) ? rows.map((r) => r.account_id).filter(Boolean) : [];
  } catch {
    return [];
  }
}
async function logCorrectionEvent(database, data) {
  try {
    const actionDetailJson = JSON.stringify({
      correctorVersion: "AutoCorrector_v257",
      correctionType: data.correctionType || "bid_mismatch",
      sourceEventId: data.sourceEventId || null,
      correctedAt: (/* @__PURE__ */ new Date()).toISOString(),
      // 关联链: 原始优化事件 → 纠错事件
      traceChain: data.sourceEventId ? `optimization_event#${data.sourceEventId} -> auto_correction` : "standalone_correction"
    });
    await database.insert(optimizationEvents2).values({
      accountId: data.accountId,
      eventCategory: data.eventCategory,
      actionType: data.actionType,
      keywordId: data.keywordId,
      keywordText: data.keywordText,
      targetId: data.targetId,
      targetName: data.targetName,
      // v441: campaignId写入前经过guardCampaignIdInsert守卫验证
      campaignId: (() => {
        if (data.campaignId == null) return void 0;
        try {
          const { guardCampaignIdInsert: guardCampaignIdInsert2 } = (init_idTypes(), __toCommonJS(idTypes_exports));
          return guardCampaignIdInsert2(data.campaignId, "optimization_events(logCorrectionEvent)");
        } catch (e) {
          log67.warn(`v441: logCorrectionEvent campaignId\u5B88\u536B\u5F02\u5E38: ${e.message}`);
          return String(data.campaignId);
        }
      })(),
      campaignName: data.campaignName,
      previousBid: data.previousBid,
      newBid: data.newBid,
      previousValue: data.previousValue,
      newValue: data.newValue,
      changeReason: data.changeReason,
      actionDetail: actionDetailJson,
      status: "success",
      apiSyncStatus: "synced",
      apiSyncedAt: /* @__PURE__ */ new Date(),
      algorithmVersion: "AutoCorrector_v257",
      createdAt: /* @__PURE__ */ new Date()
    });
  } catch (error48) {
    log67.warn(`v257: \u8BB0\u5F55\u7EA0\u9519\u4E8B\u4EF6\u5931\u8D25: ${error48.message}`);
  }
}
function createEmptyScanResult(reason) {
  return {
    scanId: `scan_${reason}_${Date.now()}`,
    startedAt: /* @__PURE__ */ new Date(),
    completedAt: /* @__PURE__ */ new Date(),
    accountsScanned: 0,
    totalIssuesFound: 0,
    totalCorrected: 0,
    totalFailed: 0,
    details: {
      bidRetries: { found: 0, corrected: 0, failed: 0 },
      bidMismatches: { found: 0, corrected: 0, failed: 0 },
      budgetRetries: { found: 0, corrected: 0, failed: 0 },
      budgetMismatches: { found: 0, corrected: 0, failed: 0 },
      placementMismatches: { found: 0, corrected: 0, failed: 0 },
      rollbackExecutions: { found: 0, corrected: 0, failed: 0 },
      settingsRetries: { found: 0, corrected: 0, failed: 0 },
      keywordCreateRetries: { found: 0, corrected: 0, failed: 0 },
      maxBidViolations: { found: 0, corrected: 0, failed: 0 },
      orphanKeywordCleanups: { found: 0, corrected: 0, failed: 0 },
      nextgenQualityAudits: { found: 0, corrected: 0, failed: 0 },
      statusChangeRetries: { found: 0, corrected: 0, failed: 0 }
    },
    corrections: []
  };
}
function buildScanResult(scanId, startedAt, completedAt, accountsScanned, corrections) {
  const details = {
    bidRetries: { found: 0, corrected: 0, failed: 0 },
    bidMismatches: { found: 0, corrected: 0, failed: 0 },
    budgetRetries: { found: 0, corrected: 0, failed: 0 },
    budgetMismatches: { found: 0, corrected: 0, failed: 0 },
    placementMismatches: { found: 0, corrected: 0, failed: 0 },
    rollbackExecutions: { found: 0, corrected: 0, failed: 0 },
    settingsRetries: { found: 0, corrected: 0, failed: 0 },
    keywordCreateRetries: { found: 0, corrected: 0, failed: 0 },
    maxBidViolations: { found: 0, corrected: 0, failed: 0 },
    orphanKeywordCleanups: { found: 0, corrected: 0, failed: 0 },
    nextgenQualityAudits: { found: 0, corrected: 0, failed: 0 },
    statusChangeRetries: { found: 0, corrected: 0, failed: 0 }
  };
  for (const c of corrections) {
    const key = c.type === "bid_retry" ? "bidRetries" : c.type === "bid_mismatch" ? "bidMismatches" : c.type === "budget_retry" ? "budgetRetries" : c.type === "budget_mismatch" ? "budgetMismatches" : c.type === "placement_mismatch" ? "placementMismatches" : c.type === "rollback_execution" ? "rollbackExecutions" : c.type === "keyword_create_retry" ? "keywordCreateRetries" : c.type === "max_bid_violation" ? "maxBidViolations" : c.type === "orphan_keyword_cleanup" ? "orphanKeywordCleanups" : c.type === "nextgen_quality_audit" ? "nextgenQualityAudits" : c.type === "status_change_retry" ? "statusChangeRetries" : "settingsRetries";
    details[key].found++;
    if (c.success) details[key].corrected++;
    else details[key].failed++;
  }
  return {
    scanId,
    startedAt,
    completedAt,
    accountsScanned,
    totalIssuesFound: corrections.length,
    totalCorrected: corrections.filter((c) => c.success).length,
    totalFailed: corrections.filter((c) => !c.success).length,
    details,
    corrections
  };
}
async function evaluateSyncHealth(database, scanResult) {
  try {
    const [syncStats] = await database.execute(sql`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN api_sync_status = 'synced' THEN 1 ELSE 0 END) as synced,
        SUM(CASE WHEN api_sync_status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN api_sync_status = 'pending' THEN 1 ELSE 0 END) as pending
      FROM optimization_events 
      WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
        AND api_sync_status NOT IN ('legacy_unsynced', 'invalid_legacy', 'not_applicable', 'internal', 'superseded', 'permanently_failed')
        AND action_type NOT IN ('settings_update', 'auto_correction', 'algorithm_config', 'strategy_update', 'system_config', 'system_deploy', 'target_reoptimized')
    `);
    const [typeStats] = await database.execute(sql`
      SELECT 
        action_type,
        COUNT(*) as total,
        SUM(CASE WHEN api_sync_status = 'synced' THEN 1 ELSE 0 END) as synced
      FROM optimization_events 
      WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
        AND api_sync_status NOT IN ('legacy_unsynced', 'invalid_legacy', 'not_applicable', 'internal', 'superseded', 'permanently_failed')
        AND action_type NOT IN ('settings_update', 'auto_correction', 'algorithm_config', 'strategy_update', 'system_config', 'system_deploy', 'target_reoptimized')
      GROUP BY action_type
    `);
    const stats4 = Array.isArray(syncStats) ? syncStats[0] : syncStats;
    const total = parseInt(String(stats4?.total || "0"));
    const synced = parseInt(String(stats4?.synced || "0"));
    const failed = parseInt(String(stats4?.failed || "0"));
    const pending = parseInt(String(stats4?.pending || "0"));
    const overallSyncRate = total > 0 ? synced / total * 100 : 100;
    const typeStatsArray = Array.isArray(typeStats) ? typeStats : [];
    const getTypeSyncRate = /* @__PURE__ */ __name((actionType) => {
      const typeStat = typeStatsArray.find((t2) => t2.action_type === actionType);
      if (!typeStat || parseInt(String(typeStat.total)) === 0) return 100;
      return parseInt(String(typeStat.synced)) / parseInt(String(typeStat.total)) * 100;
    }, "getTypeSyncRate");
    const bidSyncRate = getTypeSyncRate("bid_adjustment");
    const budgetSyncRate = getTypeSyncRate("budget_adjustment");
    const negativeKeywordSyncRate = getTypeSyncRate("negative_keyword_add");
    const keywordCreateSyncRate = getTypeSyncRate("keyword_create");
    const correctionSuccessRate = scanResult.totalIssuesFound > 0 ? scanResult.totalCorrected / scanResult.totalIssuesFound * 100 : 100;
    const alerts = [];
    const settingsSyncRate = getTypeSyncRate("settings_update");
    const searchTermSyncRate = getTypeSyncRate("search_term_harvest");
    const placementSyncRate = getTypeSyncRate("placement_adjust");
    if (bidSyncRate < 95) {
      alerts.push(`\u26A0\uFE0F \u51FA\u4EF7\u540C\u6B65\u7387\u4F4E\u4E8E95%: ${bidSyncRate.toFixed(1)}% (\u76EE\u6807100%)`);
    }
    if (budgetSyncRate < 95) {
      alerts.push(`\u26A0\uFE0F \u9884\u7B97\u540C\u6B65\u7387\u4F4E\u4E8E95%: ${budgetSyncRate.toFixed(1)}% (\u76EE\u6807100%)`);
    }
    if (negativeKeywordSyncRate < 90) {
      alerts.push(`\u26A0\uFE0F \u5426\u5B9A\u8BCD\u540C\u6B65\u7387\u4F4E\u4E8E90%: ${negativeKeywordSyncRate.toFixed(1)}% (\u76EE\u6807100%)`);
    }
    if (keywordCreateSyncRate < 90) {
      alerts.push(`\u26A0\uFE0F \u5173\u952E\u8BCD\u521B\u5EFA\u540C\u6B65\u7387\u4F4E\u4E8E90%: ${keywordCreateSyncRate.toFixed(1)}% (\u76EE\u6807100%)`);
    }
    if (settingsSyncRate < 90) {
      alerts.push(`\u26A0\uFE0F \u8BBE\u7F6E\u53D8\u66F4\u540C\u6B65\u7387\u4F4E\u4E8E90%: ${settingsSyncRate.toFixed(1)}% (\u76EE\u6807100%)`);
    }
    if (searchTermSyncRate < 90) {
      alerts.push(`\u26A0\uFE0F \u641C\u7D22\u8BCD\u6536\u5272\u540C\u6B65\u7387\u4F4E\u4E8E90%: ${searchTermSyncRate.toFixed(1)}% (\u76EE\u6807100%)`);
    }
    if (placementSyncRate < 90) {
      alerts.push(`\u26A0\uFE0F \u4F4D\u7F6E\u503E\u659C\u540C\u6B65\u7387\u4F4E\u4E8E90%: ${placementSyncRate.toFixed(1)}% (\u76EE\u6807100%)`);
    }
    if (pending > 20) {
      alerts.push(`\u{1F6A8} \u5F85\u5904\u7406\u4EFB\u52A1\u79EF\u538B: ${pending}\u4E2A\u4EFB\u52A1\u7B49\u5F85\u5904\u7406 (\u76EE\u68070)`);
    }
    if (failed > 10) {
      alerts.push(`\u{1F6A8} \u5931\u8D25\u4EFB\u52A1\u8FC7\u591A: ${failed}\u4E2A\u4EFB\u52A1\u5931\u8D25 (\u76EE\u68070)`);
    }
    if (correctionSuccessRate < 80 && scanResult.totalIssuesFound > 5) {
      alerts.push(`\u2757 \u7EA0\u9519\u6210\u529F\u7387\u4F4E\u4E8E80%: ${correctionSuccessRate.toFixed(1)}% (${scanResult.totalCorrected}/${scanResult.totalIssuesFound})`);
    }
    let level = "healthy";
    if (overallSyncRate < 70 || correctionSuccessRate < 50 && scanResult.totalIssuesFound > 10) {
      level = "emergency";
    } else if (overallSyncRate < 90 || failed > 50) {
      level = "critical";
    } else if (overallSyncRate < 98 || pending > 10 || alerts.length > 0) {
      level = "warning";
    }
    const report = {
      level,
      overallSyncRate,
      bidSyncRate,
      // @ts-ignore
      budgetSyncRate,
      // @ts-ignore
      negativeKeywordSyncRate,
      keywordCreateSyncRate,
      // @ts-ignore
      pendingCount: pending,
      failedCount: failed,
      // @ts-ignore
      alerts,
      // @ts-ignore
      evaluatedAt: /* @__PURE__ */ new Date(),
      correctionSuccessRate
    };
    latestHealthReport = report;
    const levelEmoji = level === "healthy" ? "\u2705" : level === "warning" ? "\u26A0\uFE0F" : level === "critical" ? "\u{1F6A8}" : "\u{1F534}";
    log67.info(`[SyncHealth] v204: ${levelEmoji} \u540C\u6B65\u5065\u5EB7\u5EA6: ${level.toUpperCase()}`);
    log67.info(`[SyncHealth] v204: \u603B\u4F53\u540C\u6B65\u7387=${overallSyncRate.toFixed(1)}% | \u51FA\u4EF7=${bidSyncRate.toFixed(1)}% | \u9884\u7B97=${budgetSyncRate.toFixed(1)}% | \u5426\u5B9A\u8BCD=${negativeKeywordSyncRate.toFixed(1)}% | \u5173\u952E\u8BCD\u521B\u5EFA=${keywordCreateSyncRate.toFixed(1)}%`);
    log67.warn(`[SyncHealth] v204: \u5F85\u5904\u7406=${pending} | \u5931\u8D25=${failed} | \u7EA0\u9519\u6210\u529F\u7387=${correctionSuccessRate.toFixed(1)}%`);
    if (alerts.length > 0) {
      log67.debug(`[SyncHealth] v204: === \u544A\u8B66\u4FE1\u606F (${alerts.length}\u6761) ===`);
      for (const alert of alerts) {
        log67.debug(`[SyncHealth] v204: ${alert}`);
      }
    }
    if (level === "emergency" || level === "critical") {
      log67.warn(`[SyncHealth] v204: \u2757\u2757\u2757 \u7CFB\u7EDF\u540C\u6B65\u5065\u5EB7\u5EA6\u5F02\u5E38 (${level}) \u2757\u2757\u2757`);
      log67.warn(`[SyncHealth] v204: \u8BF7\u68C0\u67E5: 1) Amazon API\u51ED\u8BC1\u662F\u5426\u8FC7\u671F 2) API\u901F\u7387\u9650\u5236 3) \u7F51\u7EDC\u8FDE\u63A5 4) \u6570\u636E\u5E93\u72B6\u6001`);
      try {
        const [recentErrors] = await database.execute(sql`
          SELECT action_type, error_message, COUNT(*) as count
          FROM optimization_events 
          WHERE api_sync_status = 'failed'
            AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
          GROUP BY action_type, SUBSTRING(error_message, 1, 100)
          ORDER BY count DESC
          LIMIT 5
        `);
        if (Array.isArray(recentErrors) && recentErrors.length > 0) {
          log67.warn(`[SyncHealth] v204: \u6700\u8FD124\u5C0F\u65F6\u5931\u8D25\u6A21\u5F0F:`);
          for (const err of recentErrors) {
            log67.warn(`[SyncHealth] v204:   ${err.action_type}: "${String(err.error_message || "").slice(0, 80)}" (${err.count}\u6B21)`);
          }
        }
      } catch (diagErr) {
        log67.warn(`[SyncHealth] v204: \u8BCA\u65AD\u4FE1\u606F\u83B7\u53D6\u5931\u8D25: ${diagErr.message}`);
      }
    }
  } catch (error48) {
    log67.warn(`[SyncHealth] v204: \u5065\u5EB7\u5EA6\u8BC4\u4F30\u5931\u8D25: ${error48.message}`);
  }
}
function getLatestHealthReport() {
  return latestHealthReport;
}
function getScanHistory() {
  return [...scanHistory];
}
function getLastScanResult() {
  return scanHistory[0] || null;
}
function getScanStatus() {
  return { isScanning, lastScanTime, historyCount: scanHistory.length };
}
function getConfig2() {
  return { ...AUTO_CORRECTION_CONFIG };
}
async function correctMaxBidViolations(database, accountId) {
  const results = [];
  try {
    const violationQuery = sql`
      SELECT 
        k.id as keyword_id,
        k.keywordText as keyword_text,
        k.keywordId as amazon_keyword_id,
        CAST(k.bid AS DECIMAL(10,2)) as current_bid,
        pg.max_bid,
        pg.id as pg_id,
        pg.name as pg_name,
        c.id as campaign_id,
        c.campaignName as campaign_name
      FROM keywords k
      JOIN ad_groups ag ON k.internal_ad_group_id = ag.id
      JOIN campaigns c ON ag.campaignId = c.campaignId
      JOIN performance_groups pg ON c.performanceGroupId = pg.id
      WHERE c.accountId = ${accountId}
        AND k.keywordStatus = 'enabled'
        AND k.keywordStatus NOT IN ('amazon_deleted', 'archived')  /* v601: 全局过滤已删除/归档关键词 */
        AND pg.max_bid IS NOT NULL AND pg.max_bid > 0
        AND CAST(k.bid AS DECIMAL(10,2)) > pg.max_bid
      ORDER BY CAST(k.bid AS DECIMAL(10,2)) - pg.max_bid DESC
      LIMIT 100
    `;
    const violations = await database.execute(violationQuery);
    const rows = violations[0] || violations;
    if (!Array.isArray(rows) || rows.length === 0) return results;
    log67.info(`v178: \u8D26\u6237${accountId} \u53D1\u73B0${rows.length}\u4E2A\u5173\u952E\u8BCD\u51FA\u4EF7\u8D85\u51FAmax_bid`);
    const correctionItems = [];
    for (const row of rows) {
      const maxBid = parseFloat(String(row.max_bid));
      if (row.amazon_keyword_id) {
        correctionItems.push({
          // @ts-ignore
          keywordId: row.keyword_id,
          newBid: maxBid,
          // @ts-ignore
          campaignId: row.campaign_id,
          // @ts-ignore
          reason: `[AutoCorrector v172] \u51FA\u4EF7$${row.current_bid}\u8D85\u51FAmax_bid$${maxBid}\uFF0C\u56DE\u9000\u5230max_bid`
        });
      }
      await database.update(keywords).set({ bid: String(maxBid) }).where(eq(keywords.id, row.keyword_id));
      results.push({
        type: "max_bid_violation",
        accountId,
        // @ts-ignore
        targetId: row.keyword_id,
        targetType: "keyword",
        // @ts-ignore
        previousValue: String(row.current_bid),
        correctedValue: String(maxBid),
        // @ts-ignore
        reason: `\u51FA\u4EF7$${row.current_bid}\u8D85\u51FAmax_bid$${maxBid} (\u4F18\u5316\u76EE\u6807: ${row.pg_name})`,
        success: true
      });
    }
    if (correctionItems.length > 0) {
      try {
        const syncResult = await syncBidAdjustmentsToAmazon(accountId, correctionItems);
        log67.warn(`v178: \u8D26\u6237${accountId} max_bid\u7EA0\u6B63\u540C\u6B65\u5230Amazon: \u6210\u529F${syncResult.success}, \u5931\u8D25${syncResult.failed}`);
      } catch (syncError) {
        log67.warn(`v178: \u8D26\u6237${accountId} max_bid\u7EA0\u6B63\u540C\u6B65\u5931\u8D25: ${syncError.message}`);
      }
    }
    const ptViolationQuery = sql`
 SELECT 
 pt.id as target_id,
 pt.targetText as target_text,
 pt.targetId as amazon_target_id,
 CAST(pt.bid AS DECIMAL(10,2)) as current_bid,
 pg.max_bid,
 pg.id as pg_id,
 pg.name as pg_name,
 c.id as campaign_id
 FROM product_targets pt
 JOIN ad_groups ag ON pt.internal_ad_group_id = ag.id
 JOIN campaigns c ON ag.campaignId = c.campaignId
 JOIN performance_groups pg ON c.performanceGroupId = pg.id
 WHERE c.accountId = ${accountId}
 AND pt.targetStatus = 'enabled'
 AND pg.max_bid IS NOT NULL AND pg.max_bid > 0
 AND CAST(pt.bid AS DECIMAL(10,2)) > pg.max_bid
 ORDER BY CAST(pt.bid AS DECIMAL(10,2)) - pg.max_bid DESC
 LIMIT 50
 `;
    const ptViolations = await database.execute(ptViolationQuery);
    const ptRows = ptViolations[0] || ptViolations;
    if (Array.isArray(ptRows) && ptRows.length > 0) {
      log67.info(`v178: \u8D26\u6237${accountId} \u53D1\u73B0${ptRows.length}\u4E2A\u5546\u54C1\u5B9A\u5411\u51FA\u4EF7\u8D85\u51FAmax_bid`);
      for (const row of ptRows) {
        const maxBid = parseFloat(String(row.max_bid));
        await database.update(productTargets).set({ bid: String(maxBid) }).where(eq(productTargets.id, row.target_id));
        results.push({
          type: "max_bid_violation",
          accountId,
          // @ts-ignore
          targetId: row.target_id,
          targetType: "product_target",
          // @ts-ignore
          previousValue: String(row.current_bid),
          correctedValue: String(maxBid),
          // @ts-ignore
          reason: `\u5546\u54C1\u5B9A\u5411\u51FA\u4EF7$${row.current_bid}\u8D85\u51FAmax_bid$${maxBid} (\u4F18\u5316\u76EE\u6807: ${row.pg_name})`,
          success: true
        });
      }
    }
    if (results.length > 0) {
      await logCorrectionEvent(database, {
        accountId,
        eventCategory: "auto_correction",
        actionType: "auto_correction",
        changeReason: `[AutoCorrector v172] \u7EA0\u6B63${results.length}\u4E2A\u8D85\u51FAmax_bid\u7684\u51FA\u4EF7`
      });
    }
  } catch (error48) {
    log67.warn(`v178: \u8D26\u6237${accountId} correctMaxBidViolations\u5931\u8D25: ${error48.message}`);
  }
  return results;
}
async function cleanupOrphanKeywords(database, accountId) {
  const results = [];
  try {
    const orphanQuery = sql`
 SELECT 
 k.id as keyword_id,
 k.keywordText as keyword_text,
 k.bid,
 k.createdAt,
 c.id as campaign_id,
 c.campaignName as campaign_name,
 pg.name as pg_name
 FROM keywords k
 JOIN ad_groups ag ON k.internal_ad_group_id = ag.id
 JOIN campaigns c ON ag.campaignId = c.campaignId
 LEFT JOIN performance_groups pg ON c.performanceGroupId = pg.id
 WHERE c.accountId = ${accountId}
 AND k.keywordStatus = 'enabled'
 AND k.keywordStatus NOT IN ('amazon_deleted', 'archived')  /* v601: 全局过滤已删除/归档关键词 */
 AND k.keywordId IS NULL
 AND k.createdAt < DATE_SUB(NOW(), INTERVAL 24 HOUR)
 ORDER BY k.createdAt ASC
 LIMIT 200
 `;
    const orphans = await database.execute(orphanQuery);
    const rows = orphans[0] || orphans;
    if (!Array.isArray(rows) || rows.length === 0) return results;
    log67.info(`v178: \u8D26\u6237${accountId} \u53D1\u73B0${rows.length}\u4E2A\u7F3A\u5C11Amazon ID\u7684\u5B64\u513F\u5173\u952E\u8BCD\uFF0C\u6807\u8BB0\u4E3Apaused`);
    for (const row of rows) {
      const keywordText = String(row.keyword_text || "");
      const hasSpecialChars = /[\uFFFC\uFFFD\u0000-\u001F]/.test(keywordText) || keywordText.length > 200;
      await database.update(keywords).set({ keywordStatus: "paused" }).where(eq(keywords.id, row.keyword_id));
      results.push({
        // @ts-ignore
        type: "orphan_keyword_cleanup",
        accountId,
        // @ts-ignore
        targetId: row.keyword_id,
        targetType: "keyword",
        previousValue: `enabled (no Amazon ID${hasSpecialChars ? ", has special chars" : ""})`,
        correctedValue: "paused",
        // @ts-ignore
        reason: `\u5B64\u513F\u5173\u952E\u8BCD\u6E05\u7406: "${keywordText.substring(0, 50)}..." \u7F3A\u5C11Amazon ID${hasSpecialChars ? "\uFF0C\u5305\u542B\u7279\u6B8A\u5B57\u7B26" : ""} (\u4F18\u5316\u76EE\u6807: ${row.pg_name || "N/A"})`,
        success: true
      });
    }
    if (results.length > 0) {
      await logCorrectionEvent(database, {
        // @ts-ignore
        accountId,
        eventCategory: "auto_correction",
        actionType: "auto_correction",
        changeReason: `[AutoCorrector v172] \u6E05\u7406${results.length}\u4E2A\u7F3A\u5C11Amazon ID\u7684\u5B64\u513F\u5173\u952E\u8BCD`
      });
    }
  } catch (error48) {
    log67.warn(`v178: \u8D26\u6237${accountId} cleanupOrphanKeywords\u5931\u8D25: ${error48.message}`);
  }
  return results;
}
async function retryHistoricalFailedKeywordHarvests(database, accountId) {
  const results = [];
  const MAX_PER_RUN = 20;
  try {
    const failedEvents = await database.execute(sql`
 SELECT id, account_id, campaign_id, campaign_name, keyword_id, keyword_text,
 action_detail, api_sync_status, api_sync_detail, created_at
 FROM optimization_events
 WHERE account_id = ${accountId}
 AND action_type IN ('keyword_create', 'search_term_harvest')
 AND api_sync_status IN ('not_applicable', 'failed', 'pending')
 AND keyword_id IS NULL
 AND action_detail IS NOT NULL
 AND action_detail != ''
 ORDER BY created_at DESC
 LIMIT ${sql.raw(String(MAX_PER_RUN))}
 `);
    const events = failedEvents[0] || failedEvents;
    if (!events || events.length === 0) return results;
    log67.warn(`v178: \u8D26\u6237${accountId} \u53D1\u73B0${events.length}\u6761\u5386\u53F2\u5931\u8D25\u7684\u641C\u7D22\u8BCD\u6536\u5272\u9700\u8981\u91CD\u8BD5`);
    const byCampaign = /* @__PURE__ */ new Map();
    for (const event of events) {
      let detail = {};
      try {
        const raw = event.action_detail || event.actionDetail;
        if (raw) detail = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch (e) {
        log67.debug(`[AutoCorrector] \u975E\u5173\u952E\u64CD\u4F5C\u5931\u8D25: ${e?.message}`);
      }
      const searchTerm = detail.searchTerm || event.keyword_text || event.keywordText;
      const matchType = detail.matchType || "phrase";
      const campaignId = event.campaign_id || event.campaignId;
      const campaignName = detail.campaignName || event.campaign_name || event.campaignName || "";
      const eventId = event.id;
      if (!searchTerm || !campaignId) {
        await database.execute(sql`
          UPDATE optimization_events SET api_sync_status = 'invalid_legacy',
            api_sync_detail = ${JSON.stringify({ reason: "v178: \u65E0\u6CD5\u63D0\u53D6searchTerm\u6216campaignId", fixedAt: (/* @__PURE__ */ new Date()).toISOString() })}
          WHERE id = ${eventId}
        `).catch(() => {
        });
        continue;
      }
      if (!byCampaign.has(campaignId)) byCampaign.set(campaignId, []);
      byCampaign.get(campaignId).push({ eventId, searchTerm, matchType, campaignName });
    }
    for (const [localCampaignId, kwEvents] of byCampaign) {
      try {
        const firstCampaignName = kwEvents[0]?.campaignName || "";
        log67.info(`v178-debug: Campaign ${localCampaignId} name="${firstCampaignName}", events=${kwEvents.length}, isPT=${isProductTargetingCampaign(firstCampaignName)}`);
        if (isProductTargetingCampaign(firstCampaignName)) {
          for (const kw of kwEvents) {
            await database.execute(sql`
 UPDATE optimization_events SET api_sync_status = 'invalid_legacy',
 api_sync_detail = ${JSON.stringify({ reason: "v311: Product Targeting campaign\u4E0D\u652F\u6301keyword\u64CD\u4F5C", fixedAt: (/* @__PURE__ */ new Date()).toISOString() })}
 WHERE id = ${kw.eventId}
 `).catch(() => {
            });
            results.push({ type: "keyword_create_retry", accountId, targetId: localCampaignId, targetType: "campaign", previousValue: "", correctedValue: kw.searchTerm, reason: `v311: PT campaign\u4E0D\u652F\u6301keyword\uFF0C\u653E\u5F03\u91CD\u8BD5: ${kw.searchTerm}`, success: false, errorMessage: "pt_campaign_no_keyword" });
          }
          continue;
        }
        const campRows = await database.select({ campaignId: campaigns.campaignId, accountId: campaigns.accountId }).from(campaigns).where(eq(campaigns.id, localCampaignId)).limit(1);
        if (campRows.length === 0) {
          for (const kw of kwEvents) {
            await database.execute(sql`
 UPDATE optimization_events SET api_sync_status = 'invalid_legacy',
 api_sync_detail = ${JSON.stringify({ reason: "v178: campaign\u4E0D\u5B58\u5728", fixedAt: (/* @__PURE__ */ new Date()).toISOString() })}
 WHERE id = ${kw.eventId}
 `).catch(() => {
            });
            results.push({ type: "keyword_create_retry", accountId, targetId: localCampaignId, targetType: "campaign", previousValue: "", correctedValue: kw.searchTerm, reason: `Campaign\u4E0D\u5B58\u5728\uFF0C\u653E\u5F03\u91CD\u8BD5: ${kw.searchTerm}`, success: false, errorMessage: "campaign_not_found" });
          }
          continue;
        }
        const amazonCampaignId = campRows[0].campaignId;
        const agRows = await database.select({ id: adGroups.id, adGroupId: adGroups.adGroupId }).from(adGroups).where(and(
          eq(adGroups.campaignId, String(amazonCampaignId)),
          eq(adGroups.adGroupStatus, "enabled")
        )).limit(1);
        if (agRows.length === 0) {
          for (const kw of kwEvents) {
            await database.execute(sql`
 UPDATE optimization_events SET api_sync_status = 'invalid_legacy',
 api_sync_detail = ${JSON.stringify({ reason: "v178: \u65E0\u6D3B\u8DC3adGroup", fixedAt: (/* @__PURE__ */ new Date()).toISOString() })}
 WHERE id = ${kw.eventId}
 `).catch(() => {
            });
            results.push({ type: "keyword_create_retry", accountId, targetId: localCampaignId, targetType: "campaign", previousValue: "", correctedValue: kw.searchTerm, reason: `\u65E0\u6D3B\u8DC3adGroup\uFF0C\u653E\u5F03\u91CD\u8BD5: ${kw.searchTerm}`, success: false, errorMessage: "no_active_adgroup" });
          }
          continue;
        }
        const localAdGroupId = agRows[0].id;
        const amazonAdGroupId = agRows[0].adGroupId;
        const existingKws = await database.select({ keywordText: keywords.keywordText, keywordId: keywords.keywordId, matchType: keywords.matchType }).from(keywords).where(eq(keywords.internalAdGroupId, localAdGroupId));
        const existingSet = new Set(existingKws.map((k) => k.keywordText?.toLowerCase()));
        const toCreate = [];
        for (const kw of kwEvents) {
          if (existingSet.has(kw.searchTerm.toLowerCase())) {
            await database.execute(sql`
 UPDATE optimization_events SET api_sync_status = 'synced',
 api_sync_detail = ${JSON.stringify({ reason: "v178: \u5173\u952E\u8BCD\u5DF2\u5B58\u5728\u4E8E\u76EE\u6807\u5E7F\u544A\u7EC4", fixedAt: (/* @__PURE__ */ new Date()).toISOString() })}
 WHERE id = ${kw.eventId}
 `).catch(() => {
            });
            results.push({ type: "keyword_create_retry", accountId, targetId: localCampaignId, targetType: "campaign", previousValue: "", correctedValue: kw.searchTerm, reason: `\u5173\u952E\u8BCD\u5DF2\u5B58\u5728\uFF0C\u6807\u8BB0\u4E3Asynced: ${kw.searchTerm}`, success: true });
          } else {
            toCreate.push(kw);
          }
        }
        if (toCreate.length === 0) continue;
        log67.debug(`v178: Campaign ${localCampaignId} \u9700\u8981\u521B\u5EFA ${toCreate.length} \u4E2A\u5173\u952E\u8BCD`);
        const keywordsToSync = [];
        for (const kw of toCreate) {
          try {
            const kwValidation = sanitizeAndValidateKeyword(kw.searchTerm, "positive");
            if (!kwValidation.isValid) {
              log67.warn(`v204: \u5173\u952E\u8BCD\u9884\u9A8C\u8BC1\u5931\u8D25\uFF0C\u6807\u8BB0\u4E3Ainvalid_legacy: "${kw.searchTerm}" \u2192 ${kwValidation.reasonMessage}`);
              await database.execute(sql`
 UPDATE optimization_events SET api_sync_status = 'invalid_legacy',
 api_sync_detail = ${JSON.stringify({ reason: `v204: \u5173\u952E\u8BCD\u9884\u9A8C\u8BC1\u5931\u8D25: ${kwValidation.reasonMessage}`, fixedAt: (/* @__PURE__ */ new Date()).toISOString() })}
 WHERE id = ${kw.eventId}
 `).catch(() => {
              });
              results.push({ type: "keyword_create_retry", accountId, targetId: localCampaignId, targetType: "keyword", previousValue: "", correctedValue: kw.searchTerm, reason: `\u9884\u9A8C\u8BC1\u5931\u8D25: ${kwValidation.reasonMessage}`, success: false, errorMessage: kwValidation.reasonCode || "VALIDATION_FAILED" });
              continue;
            }
            const cleanedSearchTerm = kwValidation.sanitizedText;
            const normalizedMatchType = kw.matchType === "exact" || kw.matchType === "phrase" || kw.matchType === "broad" ? kw.matchType : "phrase";
            const insertResult = await database.execute(sql`
              INSERT INTO keywords (internal_ad_group_id, keywordText, matchType, bid, keywordStatus, createdAt, updatedAt)
              VALUES (${localAdGroupId}, ${cleanedSearchTerm}, ${normalizedMatchType}, '0.50', 'enabled', NOW(), NOW())
              ON DUPLICATE KEY UPDATE bid = VALUES(bid), keywordStatus = VALUES(keywordStatus), updatedAt = NOW()
            `);
            const localKeywordId = insertResult[0]?.insertId || insertResult?.insertId;
            keywordsToSync.push({
              // @ts-ignore
              eventId: kw.eventId,
              // @ts-ignore
              localKeywordId,
              // @ts-ignore
              internal_ad_group_id: amazonAdGroupId,  // v14c-fix: syncNewKeywordsToAmazon期望这个字段名
              adGroupId: amazonAdGroupId,  // v14c-fix: 保留用于去重检查
              campaignId: amazonCampaignId,
              keywordText: cleanedSearchTerm,
              matchType: normalizedMatchType,
              bid: 0.5
            });
          } catch (insertErr) {
            log67.warn(`v178: \u672C\u5730\u521B\u5EFA\u5173\u952E\u8BCD\u5931\u8D25: "${kw.searchTerm}" - ${insertErr.message}`);
            await database.execute(sql`
 UPDATE optimization_events SET api_sync_status = 'invalid_legacy',
 api_sync_detail = ${JSON.stringify({ reason: `v178: \u672C\u5730\u521B\u5EFA\u5931\u8D25: ${insertErr.message}`, fixedAt: (/* @__PURE__ */ new Date()).toISOString() })}
 WHERE id = ${kw.eventId}
 `).catch(() => {
            });
            results.push({ type: "keyword_create_retry", accountId, targetId: localCampaignId, targetType: "campaign", previousValue: "", correctedValue: kw.searchTerm, reason: `\u672C\u5730\u521B\u5EFA\u5931\u8D25: ${kw.searchTerm}`, success: false, errorMessage: insertErr.message });
          }
        }
        if (keywordsToSync.length === 0) continue;
        const syncResult = await syncNewKeywordsToAmazon(
          accountId,
          keywordsToSync.map((k) => ({
            localKeywordId: k.localKeywordId,
            internal_ad_group_id: k.internal_ad_group_id,  // v14c-fix: syncNewKeywordsToAmazon内部用这个字段
            adGroupId: k.adGroupId,  // v14c-fix: 保留用于去重检查
            // @ts-ignore
            campaignId: k.campaignId,
            keywordText: k.keywordText,
            matchType: k.matchType,
            bid: k.bid
          }))
        );
        const successKeywords = new Set(
          // @ts-ignore
          syncResult.createdKeywords.map((k) => k.keywordText?.toLowerCase())
        );
        const failedKeywordErrors = /* @__PURE__ */ new Map();
        for (const err of syncResult.errors) {
          const match = err.match(/关键词创建失败: "(.+?)"\s*-\s*code=(\S+)/);
          if (match) {
            failedKeywordErrors.set(match[1].toLowerCase(), match[2]);
          }
        }
        for (const kw of keywordsToSync) {
          const isSuccess = successKeywords.has(kw.keywordText.toLowerCase());
          const errorCode = failedKeywordErrors.get(kw.keywordText.toLowerCase());
          const isDuplicate = errorCode === "DUPLICATE_VALUE" || errorCode === "DUPLICATE";
          if (isSuccess || isDuplicate) {
            await database.execute(sql`
 UPDATE optimization_events SET api_sync_status = 'synced',
 api_sync_detail = ${JSON.stringify({
              correctedBy: "AutoCorrector-v178-harvest-retry",
              fixedAt: (/* @__PURE__ */ new Date()).toISOString(),
              localKeywordId: kw.localKeywordId,
              isDuplicate
            })},
 api_synced_at = NOW()
 WHERE id = ${kw.eventId}
 `).catch(() => {
            });
            results.push({ type: "keyword_create_retry", accountId, targetId: localCampaignId, targetType: "keyword", previousValue: "", correctedValue: kw.keywordText, reason: isDuplicate ? `\u5173\u952E\u8BCDAmazon\u5DF2\u5B58\u5728: ${kw.keywordText}` : `\u91CD\u8BD5\u521B\u5EFA\u5173\u952E\u8BCD\u6210\u529F: ${kw.keywordText}`, success: true });
            log67.info(`v178: \u2705 \u5173\u952E\u8BCD\u521B\u5EFA\u6210\u529F: "${kw.keywordText}" (campaign=${localCampaignId}${isDuplicate ? ", \u5DF2\u5B58\u5728" : ""})`);
          } else {
            await database.execute(sql`
 UPDATE optimization_events SET api_sync_status = 'invalid_legacy',
 api_sync_detail = ${JSON.stringify({
              reason: `v178: Amazon\u62D2\u7EDD\u521B\u5EFA\u5173\u952E\u8BCD`,
              errorCode: errorCode || "UNKNOWN",
              fixedAt: (/* @__PURE__ */ new Date()).toISOString(),
              localKeywordId: kw.localKeywordId
            })}
 WHERE id = ${kw.eventId}
 `).catch(() => {
            });
            if (kw.localKeywordId) {
              await database.execute(sql`
 DELETE FROM keywords WHERE id = ${kw.localKeywordId} AND keywordId IS NULL
 `).catch(() => {
              });
            }
            results.push({ type: "keyword_create_retry", accountId, targetId: localCampaignId, targetType: "keyword", previousValue: "", correctedValue: kw.keywordText, reason: `\u5173\u952E\u8BCDAmazon\u62D2\u7EDD\u521B\u5EFA: ${kw.keywordText} (code=${errorCode || "UNKNOWN"})`, success: false, errorMessage: errorCode || syncResult.errors.join("; ") });
            log67.warn(`v178: \u274C \u5173\u952E\u8BCD\u521B\u5EFA\u5931\u8D25: "${kw.keywordText}" (code=${errorCode || "UNKNOWN"})`);
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 1e3));
      } catch (campError) {
        log67.warn(`v178: Campaign ${localCampaignId} \u5173\u952E\u8BCD\u6536\u5272\u91CD\u8BD5\u5931\u8D25: ${campError.message}`);
        for (const kw of kwEvents) {
          results.push({ type: "keyword_create_retry", accountId, targetId: localCampaignId, targetType: "campaign", previousValue: "", correctedValue: kw.searchTerm, reason: `Campaign\u5904\u7406\u5F02\u5E38: ${kw.searchTerm}`, success: false, errorMessage: campError.message });
        }
      }
    }
    const successCount = results.filter((r) => r.success).length;
    const failedResults = results.filter((r) => !r.success);
    const ptSkipped = failedResults.filter((r) => r.errorMessage === 'pt_campaign_no_keyword').length;
    const campNotFound = failedResults.filter((r) => r.errorMessage === 'campaign_not_found').length;
    const noAdGroup = failedResults.filter((r) => r.errorMessage === 'no_active_adgroup').length;
    const apiErrors = failedResults.filter((r) => !['pt_campaign_no_keyword','campaign_not_found','no_active_adgroup','VALIDATION_FAILED'].includes(r.errorMessage)).length;
    log67.warn(`v178: \u8D26\u6237${accountId} \u641C\u7D22\u8BCD\u6536\u5272\u91CD\u8BD5\u5B8C\u6210: \u6210\u529F=${successCount}, \u5931\u8D25=${failedResults.length} (PT\u8DF3\u8FC7=${ptSkipped}, campaign\u4E0D\u5B58\u5728=${campNotFound}, \u65E0adGroup=${noAdGroup}, API\u5931\u8D25=${apiErrors})`);
  } catch (error48) {
    log67.warn(`v178: \u8D26\u6237${accountId} retryHistoricalFailedKeywordHarvests\u5931\u8D25: ${error48.message}`);
  }
  return results;
}
async function rescuePermanentlyFailedTasks(accountId) {
  const results = [];
  try {
    const conn = await getDirectConnection();
    try {
      const [rows] = await conn.execute(
        `SELECT id, task_type, target_entity_type, target_entity_id, amazon_entity_id, 
                action, old_value, new_value, change_reason, error_message, retry_count,
                campaign_id, ad_group_id
         FROM optimization_tasks 
         WHERE account_id = ? 
           AND status = 'permanently_failed'
           AND completed_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 HOUR)
           AND completed_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
           AND (error_message NOT LIKE '%v444-unrecoverable%')
           AND (error_message NOT LIKE '%entity_deleted%')
           AND (error_message NOT LIKE '%entityNotFoundError%')
           AND (error_message NOT LIKE '%ENTITY_NOT_FOUND%')
           AND (error_message NOT LIKE '%malformedValueError%')
           AND (CHAR_LENGTH(error_message) - CHAR_LENGTH(REPLACE(error_message, 'AutoCorrector', '')) < 26)
         ORDER BY completed_at DESC
         LIMIT 20`,
        [accountId]
      );
      if (!rows || rows.length === 0) return results;
      const recoverableTasks = [];
      const archivedTaskIds = [];
      for (const task of rows) {
        let entityExists2 = true;
        try {
          if (task.target_entity_type === "keyword" && task.target_entity_id) {
            const [kwCheck] = await conn.execute(
              "SELECT id, keywordStatus FROM keywords WHERE id = ? LIMIT 1",
              [task.target_entity_id]
            );
            if (!kwCheck || kwCheck.length === 0 || kwCheck[0]?.keywordStatus === "amazon_deleted" || kwCheck[0]?.keywordStatus === "archived") {
              entityExists2 = false;
            }
          } else if (task.target_entity_type === "product_target" && task.target_entity_id) {
            const [ptCheck] = await conn.execute(
              "SELECT id, targetStatus FROM product_targets WHERE id = ? LIMIT 1",
              [task.target_entity_id]
            );
            if (!ptCheck || ptCheck.length === 0 || ptCheck[0]?.targetStatus === "amazon_deleted" || ptCheck[0]?.targetStatus === "archived") {
              entityExists2 = false;
            }
          }
        } catch (checkErr) {
          log67.debug(`v575: entity\u68C0\u67E5\u5931\u8D25: ${checkErr.message}`);
        }
        if (!entityExists2) {
          archivedTaskIds.push(task.id);
          results.push({
            type: "keyword_create_retry",
            accountId,
            targetId: task.target_entity_id,
            targetType: task.target_entity_type || "unknown",
            previousValue: task.old_value || "",
            correctedValue: "archived",
            reason: `[v575] entity\u5DF2\u5220\u9664/\u5F52\u6863\uFF0C\u4EFB\u52A1\u6807\u8BB0\u4E3Acancelled: ${task.task_type}/${task.action}`,
            success: true
          });
        } else {
          recoverableTasks.push(task);
        }
      }
      if (archivedTaskIds.length > 0) {
        await conn.execute(
          `UPDATE optimization_tasks 
           SET status = 'cancelled', 
               error_message = CONCAT('[v575 entity\u5DF2\u5220\u9664] ', IFNULL(error_message, '')),
               completed_at = UTC_TIMESTAMP()
           WHERE id IN (${archivedTaskIds.join(",")})`
        );
        log67.info(`v575: \u8D26\u6237${accountId} \u5C06${archivedTaskIds.length}\u6761entity\u5DF2\u5220\u9664\u7684permanently_failed\u4EFB\u52A1\u6807\u8BB0\u4E3Acancelled`);
      }
      if (recoverableTasks.length === 0) {
        log67.info(`v575: \u8D26\u6237${accountId} \u6240\u6709permanently_failed\u4EFB\u52A1\u5747\u4E0D\u53EF\u6062\u590D\uFF0C\u8DF3\u8FC7`);
        return results;
      }
      log67.warn(`v575: \u8D26\u6237${accountId} \u53D1\u73B0${recoverableTasks.length}\u6761\u53EF\u6062\u590D\u7684permanently_failed\u4EFB\u52A1\uFF08\u5DF2\u8FC7\u6EE4${rows.length - recoverableTasks.length}\u6761\u4E0D\u53EF\u6062\u590D\u4EFB\u52A1\uFF09`);
      for (const task of recoverableTasks) {
        if (!task.amazon_entity_id && task.target_entity_id) {
          try {
            if (task.target_entity_type === "keyword") {
              const [kwRows] = await conn.execute(
                "SELECT keywordId FROM keywords WHERE id = ? AND keywordId IS NOT NULL LIMIT 1",
                [task.target_entity_id]
              );
              if (kwRows[0]?.keywordId) {
                task.amazon_entity_id = kwRows[0].keywordId;
                await conn.execute(
                  "UPDATE optimization_tasks SET amazon_entity_id = ? WHERE id = ?",
                  [task.amazon_entity_id, task.id]
                );
              }
            } else if (task.target_entity_type === "product_target") {
              const [ptRows] = await conn.execute(
                "SELECT targetId FROM product_targets WHERE id = ? AND targetId IS NOT NULL LIMIT 1",
                [task.target_entity_id]
              );
              if (ptRows[0]?.targetId) {
                task.amazon_entity_id = ptRows[0].targetId;
                await conn.execute(
                  "UPDATE optimization_tasks SET amazon_entity_id = ? WHERE id = ?",
                  [task.amazon_entity_id, task.id]
                );
              }
            } else if (task.target_entity_type === "campaign") {
              const [cRows] = await conn.execute(
                "SELECT campaignId FROM campaigns WHERE id = ? AND campaignId IS NOT NULL LIMIT 1",
                [task.target_entity_id]
              );
              if (cRows[0]?.campaignId) {
                task.amazon_entity_id = cRows[0].campaignId;
                await conn.execute(
                  "UPDATE optimization_tasks SET amazon_entity_id = ? WHERE id = ?",
                  [task.amazon_entity_id, task.id]
                );
              }
            }
          } catch (resolveErr) {
            log67.warn(`v575: ID\u56DE\u586B\u5931\u8D25: ${resolveErr.message}`);
          }
        }
      }
      const taskIds = recoverableTasks.map((r) => r.id);
      const now = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
      await conn.execute(
        `UPDATE optimization_tasks 
         SET status = 'retry', 
             retry_count = 0, 
             error_message = CONCAT('[AutoCorrector v575 \u6062\u590D] ', IFNULL(error_message, '')),
             next_retry_at = ?
         WHERE id IN (${taskIds.join(",")})`,
        [now]
      );
      log67.warn(`v575: \u5DF2\u6062\u590D${taskIds.length}\u6761permanently_failed\u4EFB\u52A1\u4E3Aretry\u72B6\u6001`);
      for (const task of recoverableTasks) {
        results.push({
          type: "keyword_create_retry",
          accountId,
          targetId: task.target_entity_id,
          targetType: task.target_entity_type || "unknown",
          previousValue: task.old_value || "",
          correctedValue: task.new_value || "",
          reason: `[v575] \u6062\u590Dpermanently_failed\u4EFB\u52A1: ${task.task_type}/${task.action} (retry_count\u5DF2\u91CD\u7F6E)`,
          success: true
        });
      }
    } finally {
      conn.release();
    }
  } catch (error48) {
    log67.warn(`v575: \u8D26\u6237${accountId} rescuePermanentlyFailedTasks\u5931\u8D25: ${error48.message}`);
  }
  return results;
}
async function backfillNegativeKeywordIds(database, accountId) {
  const results = [];
  try {
    const [missingIdRows] = await database.execute(sql`
      SELECT id, campaignId, internal_ad_group_id as adGroupId, negativeText, negativeMatchType, negativeLevel
      FROM negative_keywords
      WHERE accountId = ${accountId}
        AND amazon_negative_keyword_id IS NULL
        AND negativeStatus = 'active'
        AND campaignId IS NOT NULL
        AND campaignId != ''
      LIMIT 50
    `);
    try {
      const [nullCampaignRows] = await database.execute(sql`
        SELECT nk.id, nk.internal_ad_group_id
        FROM negative_keywords nk
        WHERE nk.accountId = ${accountId}
          AND nk.amazon_negative_keyword_id IS NULL
          AND nk.negativeStatus = 'active'
          AND (nk.campaignId IS NULL OR nk.campaignId = '')
          AND nk.internal_ad_group_id IS NOT NULL
        LIMIT 50
      `);
      if (nullCampaignRows && nullCampaignRows.length > 0) {
        let backfilledCount = 0;
        for (const row of nullCampaignRows) {
          try {
            const agRows = await database.select({ campaignId: adGroups.campaignId }).from(adGroups).where(eq(adGroups.id, Number(row.internal_ad_group_id))).limit(1);
            if (agRows.length > 0 && agRows[0].campaignId) {
              await database.execute(sql`
 UPDATE negative_keywords SET campaignId = ${String(agRows[0].campaignId)}
 WHERE id = ${row.id}
 `);
              backfilledCount++;
            }
          } catch (_) {
          }
        }
        if (backfilledCount > 0) {
          log67.info(`v507: \u5DF2\u56DE\u586B${backfilledCount}\u4E2A\u5426\u5B9A\u8BCD\u7684campaignId (\u901A\u8FC7adGroup\u5173\u8054)`);
        }
      }
    } catch (backfillErr) {
      log67.warn(`v507: \u56DE\u586B\u5426\u5B9A\u8BCDcampaignId\u5931\u8D25: ${backfillErr.message}`);
    }
    if (!missingIdRows || missingIdRows.length === 0) return results;
    log67.info(`v196: \u8D26\u6237${accountId} \u53D1\u73B0${missingIdRows.length}\u4E2A\u7F3A\u5C11Amazon ID\u7684\u5426\u5B9A\u8BCD\uFF0C\u5C1D\u8BD5\u56DE\u586B...`);
    const syncService = await getAmazonSyncService2(accountId);
    if (!syncService) {
      log67.warn(`v196: \u65E0\u6CD5\u83B7\u53D6\u8D26\u6237${accountId}\u7684API\u670D\u52A1`);
      return results;
    }
    const rawCampaignIds = [...new Set(missingIdRows.map((r) => r.campaignId).filter(Boolean))];
    const campaignIdToAmazonIdMap = /* @__PURE__ */ new Map(); /* fix24-P3v4 */ const campaignTypeMap = /* @__PURE__ */ new Map();
    for (const rawId of rawCampaignIds) {
      const rawIdStr = String(rawId);
      const campByAmazonId = await database.select({ id: campaigns.id, campaignId: campaigns.campaignId, campaignType: campaigns.campaignType }).from(campaigns).where(eq(campaigns.campaignId, rawIdStr)).limit(1);
      if (campByAmazonId.length > 0 && campByAmazonId[0].campaignId) {
        campaignIdToAmazonIdMap.set(rawIdStr, String(campByAmazonId[0].campaignId)); /* fix24-P3v4 */ const _campType1 = campByAmazonId[0].campaignType || "unknown"; campaignTypeMap.set(rawIdStr, _campType1);
        log67.debug(`v507: \u5426\u5B9A\u8BCD\u56DE\u586BcampaignId\u89E3\u6790(Amazon ID\u5339\u914D): rawId=${rawIdStr} -> amazonId=${campByAmazonId[0].campaignId}`);
      } else {
        const localId = Number(rawId);
        if (!isNaN(localId) && localId > 0 && localId < 2147483647) {
          const campRows = await database.select({ campaignId: campaigns.campaignId, campaignType: campaigns.campaignType }).from(campaigns).where(eq(campaigns.id, localId)).limit(1);
          if (campRows.length > 0 && campRows[0].campaignId) {
            campaignIdToAmazonIdMap.set(rawIdStr, String(campRows[0].campaignId)); /* fix24-P3v4 */ const _campType2 = campRows[0].campaignType || "unknown"; campaignTypeMap.set(rawIdStr, _campType2);
            log67.debug(`v507: \u5426\u5B9A\u8BCD\u56DE\u586BcampaignId\u89E3\u6790(\u672C\u5730ID\u5339\u914D): localId=${localId} -> amazonId=${campRows[0].campaignId}`);
          } else {
            log67.warn(`v507: \u5426\u5B9A\u8BCD\u56DE\u586BcampaignId\u89E3\u6790\u5931\u8D25: rawId=${rawIdStr} \u5728campaigns\u8868\u4E2D\u4E0D\u5B58\u5728`);
          }
        } else {
          log67.warn(`v507: \u5426\u5B9A\u8BCD\u56DE\u586BcampaignId\u89E3\u6790\u5931\u8D25: rawId=${rawIdStr} \u65E2\u4E0D\u662F\u6709\u6548\u7684Amazon ID\u4E5F\u4E0D\u662F\u6709\u6548\u7684\u672C\u5730ID`);
        }
      }
    }
    const amazonNegMap = /* @__PURE__ */ new Map();
    for (const [rawId, amazonCampaignId] of campaignIdToAmazonIdMap.entries()) {
      /* fix24-P3v4: 跳过非SP campaign的否定词查询 */
      const _listCampType = campaignTypeMap.get(rawId) || "unknown";
      if (_listCampType !== "sp_manual" && _listCampType !== "sp_auto") {
        log67.info(`[fix24-P3v4] v196: 跳过非SP campaign的否定词查询: rawId=${rawId}, amazonId=${amazonCampaignId}, type=${_listCampType}`);
        continue;
      }
      try {
        const existing = await syncService.client.listSpCampaignNegativeKeywords(amazonCampaignId);
        for (const neg of existing) {
          const key = `${amazonCampaignId}:${(neg.keywordText || "").toLowerCase()}:${(neg.matchType || "").toLowerCase()}`;
          if (neg.keywordId) {
            amazonNegMap.set(key, String(neg.keywordId));
          }
        }
      } catch (listErr) {
        log67.warn(`v507: \u67E5\u8BE2campaign rawId=${rawId} amazonId=${amazonCampaignId} \u5426\u5B9A\u8BCD\u5931\u8D25: ${listErr.message}`);
      }
    }
    for (const row of missingIdRows) {
      const amazonCampaignId = campaignIdToAmazonIdMap.get(String(row.campaignId));
      if (!amazonCampaignId) {
        log67.warn(`v507: \u8DF3\u8FC7\u5426\u5B9A\u8BCD\u56DE\u586B: id=${row.id}, campaignId=${row.campaignId} \u65E0\u6CD5\u89E3\u6790Amazon Campaign ID`);
        continue;
      }
      const matchType = (row.negativeMatchType || "").replace("negative_", "negative").toLowerCase();
      const key = `${amazonCampaignId}:${(row.negativeText || "").toLowerCase()}:${matchType}`;
      const amazonId = amazonNegMap.get(key);
      if (amazonId) {
        await database.execute(sql`
 UPDATE negative_keywords SET amazon_negative_keyword_id = ${amazonId} WHERE id = ${row.id}
 `);
        results.push({
          type: "settings_retry",
          accountId,
          // @ts-ignore
          targetId: row.id,
          targetType: "negative_keyword",
          previousValue: "null",
          correctedValue: amazonId,
          // @ts-ignore
          reason: `v196: \u56DE\u586B\u5426\u5B9A\u8BCD Amazon ID: "${row.negativeText}"`,
          success: true
        });
        log67.debug(`v196: \u2705 \u56DE\u586B\u5426\u5B9A\u8BCDID: "${row.negativeText}" -> ${amazonId}`);
      } else {
        try {
          const negMode = matchType.includes("exact") ? "negative_exact" : "negative_phrase";
          let negValidation = sanitizeAndValidateKeyword(row.negativeText, negMode);
          let cleanedNegText = negValidation.sanitizedText || row.negativeText;
          let finalMatchType = matchType.includes("exact") ? "negativeExact" : "negativePhrase";
          if (!negValidation.isValid && negMode === "negative_phrase" && negValidation.reasonCode === "EXCEEDS_MAX_WORDS_NEG_PHRASE") {
            negValidation = sanitizeAndValidateKeyword(row.negativeText, "negative_exact");
            if (negValidation.isValid) {
              cleanedNegText = negValidation.sanitizedText;
              finalMatchType = "negativeExact";
              log67.debug(`v204: \u5426\u5B9A\u8BCD\u56DE\u586B"${row.negativeText}"\u8D85\u8FC74\u8BCD\u9650\u5236\uFF0C\u81EA\u52A8\u5347\u7EA7\u4E3AnegativeExact`);
            }
          }
          if (!negValidation.isValid) {
            log67.warn(`v204: \u5426\u5B9A\u8BCD\u56DE\u586B\u9884\u9A8C\u8BC1\u5931\u8D25\uFF0C\u8DF3\u8FC7\u91CD\u65B0\u521B\u5EFA: "${row.negativeText}" \u2192 ${negValidation.reasonMessage}`);
            continue;
          }
          /* fix24-P3v4: 跳过非SP campaign的否定词重新创建 */
          const _syncCampType = campaignTypeMap.get(String(row.campaignId)) || "unknown";
          if (_syncCampType !== "sp_manual" && _syncCampType !== "sp_auto") {
            log67.info(`[fix24-P3v4] v196: 跳过非SP campaign的否定词重新创建: id=${row.id}, campaignId=${row.campaignId}, type=${_syncCampType}`);
            continue;
          }
          const syncResult = await syncNegativeKeywordsToAmazon(accountId, [{
            campaignId: amazonCampaignId,
            // v203: 使用Amazon campaignId而非本地ID
            keywordText: cleanedNegText,
            matchType: finalMatchType,
            // @ts-ignore
            level: row.negativeLevel || "campaign"
          }]);
          const mapKey = `campaign:${amazonCampaignId}:${(cleanedNegText || "").toLowerCase()}`;
          const newId = syncResult.keywordIdMap?.get(mapKey);
          if (newId) {
            await database.execute(sql`
 UPDATE negative_keywords SET amazon_negative_keyword_id = ${newId} WHERE id = ${row.id}
 `);
            results.push({
              type: "settings_retry",
              accountId,
              // @ts-ignore
              targetId: row.id,
              targetType: "negative_keyword",
              previousValue: "null",
              correctedValue: newId,
              // @ts-ignore
              reason: `v196: \u91CD\u65B0\u521B\u5EFA\u5E76\u56DE\u586B\u5426\u5B9A\u8BCD Amazon ID: "${row.negativeText}"`,
              success: true
            });
          }
        } catch (createErr) {
          log67.warn(`v196: \u91CD\u65B0\u521B\u5EFA\u5426\u5B9A\u8BCD\u5931\u8D25: ${createErr.message}`);
        }
      }
    }
    log67.info(`v196: \u5426\u5B9A\u8BCDID\u56DE\u586B\u5B8C\u6210: \u6210\u529F${results.length}/${missingIdRows.length}`);
  } catch (err) {
    log67.warn(`v196: \u5426\u5B9A\u8BCDID\u56DE\u586B\u5F02\u5E38: ${err.message}`);
  }
  return results;
}
async function verifyBiddingLogsExecution(database, accountId) {
  const results = [];
  try {
    const currencyCode = await getAccountCurrencyCode(accountId);
    let recentBidLogs;
    try {
      recentBidLogs = await database.execute(sql`
 SELECT bl.id, bl.logTargetType as log_target_type, bl.targetId as target_id, bl.targetName as target_name,
 bl.previousBid as previous_bid, bl.newBid as new_bid, bl.createdAt as created_at,
 bl.campaignId as campaign_id, bl.internal_ad_group_id as ad_group_id
 FROM bidding_logs bl
 INNER JOIN (
 SELECT targetId, logTargetType, MAX(id) as max_id
 FROM bidding_logs
 WHERE accountId = ${accountId}
 AND execution_status = 'success'
 AND createdAt > DATE_SUB(NOW(), INTERVAL 24 HOUR)
 GROUP BY targetId, logTargetType
 ) latest ON bl.id = latest.max_id
 LIMIT 200
 `);
    } catch (camelErr) {
      log67.warn(`v200: camelCase\u67E5\u8BE2\u5931\u8D25\uFF0C\u5C1D\u8BD5snake_case\u5217\u540D: ${camelErr.message?.substring(0, 100)}`);
      recentBidLogs = await database.execute(sql`
 SELECT bl.id, bl.log_target_type, bl.target_id, bl.target_name,
 bl.previous_bid, bl.new_bid, bl.created_at,
 bl.campaign_id, bl.internal_ad_group_id
 FROM bidding_logs bl
 INNER JOIN (
 SELECT target_id, log_target_type, MAX(id) as max_id
 FROM bidding_logs
 WHERE account_id = ${accountId}
 AND execution_status = 'success'
 AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
 GROUP BY target_id, log_target_type
 ) latest ON bl.id = latest.max_id
 LIMIT 200
 `);
    }
    const rows = recentBidLogs?.[0] || recentBidLogs;
    if (!Array.isArray(rows) || rows.length === 0) {
      log67.info(`v196: \u8D26\u6237${accountId} \u6700\u8FD124\u5C0F\u65F6\u65E0\u6210\u529F\u7684\u51FA\u4EF7\u8C03\u6574\u65E5\u5FD7`);
      return results;
    }
    let verified = 0;
    let mismatched = 0;
    let corrected = 0;
    for (const bidLog of rows) {
      const expectedBid = parseFloat(String(bidLog.new_bid));
      const targetId = bidLog.target_id;
      const targetType = bidLog.log_target_type;
      let currentBid = null;
      if (targetType === "keyword") {
        const [kw] = await database.select({ bid: keywords.bid, keywordStatus: keywords.keywordStatus }).from(keywords).where(eq(keywords.id, targetId)).limit(1);
        if (kw && (kw.keywordStatus === "amazon_deleted" || kw.keywordStatus === "archived" || kw.keywordStatus === "amazon_archived")) {
          continue;
        }
        if (kw) currentBid = parseFloat(String(kw.bid || "0"));
      } else if (targetType === "product_target") {
        const [pt] = await database.select({ bid: productTargets.bid }).from(productTargets).where(eq(productTargets.id, targetId)).limit(1);
        if (pt) currentBid = parseFloat(String(pt.bid || "0"));
      }
      if (currentBid === null) continue;
      const absDiff = Math.abs(currentBid - expectedBid);
      const relDiff = expectedBid > 0 ? absDiff / expectedBid : 0;
      const { absTolerance: verifyAbsTol, relTolerance: verifyRelTol } = getBidVerifyTolerance(currencyCode);
      if (absDiff <= verifyAbsTol || relDiff <= verifyRelTol) {
        verified++;
        if (absDiff > 0.01) {
          log67.debug(`v204: \u51FA\u4EF7\u786E\u8BA4(${currencyCode}\u5BB9\u5DEE\u5185): ${targetType} id=${targetId} expected=$${expectedBid.toFixed(2)} actual=$${currentBid.toFixed(2)} diff=${(relDiff * 100).toFixed(1)}%`);
        }
        continue;
      }
      mismatched++;
      log67.warn(`v204: \u51FA\u4EF7\u6267\u884C\u786E\u8BA4\u5931\u8D25(${currencyCode}): ${targetType} id=${targetId} expected=$${expectedBid.toFixed(2)} actual=$${currentBid.toFixed(2)} diff=${(relDiff * 100).toFixed(1)}% (absTol=${verifyAbsTol.toFixed(3)}, relTol=${(verifyRelTol * 100).toFixed(0)}%)`);
      try {
        if (targetType === "keyword") {
          await database.update(keywords).set({ bid: String(expectedBid) }).where(eq(keywords.id, targetId));
        } else if (targetType === "product_target") {
          await database.update(productTargets).set({ bid: String(expectedBid) }).where(eq(productTargets.id, targetId));
        }
        corrected++;
        results.push({
          type: "bid_execution_verify",
          accountId,
          targetId,
          targetType,
          previousValue: String(currentBid),
          correctedValue: String(expectedBid),
          reason: `[v196\u6267\u884C\u786E\u8BA4] bidding_logs\u8BB0\u5F55\u6210\u529F\u4F46\u672C\u5730bid\u4E0D\u4E00\u81F4: \u671F\u671B$${expectedBid.toFixed(2)}, \u5B9E\u9645$${currentBid.toFixed(2)}`,
          success: true
        });
      } catch (corrErr) {
        log67.warn(`v196: \u51FA\u4EF7\u6267\u884C\u786E\u8BA4\u7EA0\u6B63\u5931\u8D25: ${corrErr.message}`);
        results.push({
          type: "bid_execution_verify",
          // @ts-ignore
          accountId,
          targetId,
          targetType,
          previousValue: String(currentBid),
          correctedValue: String(expectedBid),
          reason: `[v196\u6267\u884C\u786E\u8BA4] \u7EA0\u6B63\u5931\u8D25: ${corrErr.message}`,
          success: false
        });
      }
    }
    log67.info(`v196: \u8D26\u6237${accountId} \u51FA\u4EF7\u6267\u884C\u786E\u8BA4\u5B8C\u6210: \u68C0\u67E5=${rows.length}, \u786E\u8BA4=${verified}, \u4E0D\u4E00\u81F4=${mismatched}, \u7EA0\u6B63=${corrected}`);
  } catch (err) {
    log67.warn(`v199: \u51FA\u4EF7\u6267\u884C\u786E\u8BA4\u5F02\u5E38: ${err.message}`);
    if (err.cause) log67.warn(`v199: MySQL\u9519\u8BEF\u8BE6\u60C5: ${JSON.stringify(err.cause).substring(0, 500)}`);
    if (err.sql) log67.warn(`v199: \u5931\u8D25SQL: ${err.sql?.substring(0, 200)}`);
  }
  return results;
}
async function auditAlgorithmDecisionQuality(database, accountId) {
  const results = [];
  try {
    const auditCandidates = await database.execute(sql`
      SELECT 
        k.id as keyword_id,
        k.keywordText as keyword_text,
        k.bid as current_bid,
        k.matchType as match_type,
        k.impressions,
        k.clicks,
        k.spend,
        k.sales,
        k.orders,
        k.keywordStatus as keyword_status,
        ag.campaignId as amazon_campaign_id,
        c.id as campaign_db_id,
        c.campaignName as campaign_name,
        c.campaignStatus as campaign_status,
        pg.id as perf_group_id,
        pg.targetAcos as target_acos,
        pg.max_bid,
        pg.optimizationGoal as optimization_goal,
        pg.daily_budget,
        oe.algorithm_version as last_algo_version,
        oe.created_at as last_optimized_at
      FROM keywords k
      INNER JOIN ad_groups ag ON k.internal_ad_group_id = ag.id
      INNER JOIN campaigns c ON ag.campaignId = c.campaignId AND c.accountId = ${accountId}
      INNER JOIN performance_groups pg ON c.performanceGroupId = pg.id
      LEFT JOIN (
        SELECT keyword_id, algorithm_version, created_at,
               ROW_NUMBER() OVER (PARTITION BY keyword_id ORDER BY created_at DESC) as rn
        FROM optimization_events
        WHERE account_id = ${accountId}
          AND event_category = 'bid_adjustment'
          AND status = 'success'
          AND created_at > DATE_SUB(NOW(), INTERVAL ${sql.raw(String(QUALITY_AUDIT_CONFIG.lookbackDays))} DAY)
      ) oe ON oe.keyword_id = k.id AND oe.rn = 1
      WHERE k.keywordStatus = 'enabled'
        AND k.keywordStatus NOT IN ('amazon_deleted', 'archived', 'paused')  /* v601: 全局过滤已删除/归档关键词 */
        AND c.campaignStatus = 'enabled'
        AND pg.status = 'active'
        AND CAST(k.bid AS DECIMAL(10,2)) > 0
        AND (k.impressions > 0 OR CAST(k.spend AS DECIMAL(10,2)) > 0)
        AND (
          oe.algorithm_version IS NULL
          OR (
            oe.algorithm_version NOT LIKE '%v197%'
            AND oe.algorithm_version NOT LIKE '%v198%'
            AND oe.algorithm_version NOT LIKE '%v199%'
            AND oe.algorithm_version NOT LIKE '%v200%'
            AND oe.algorithm_version NOT LIKE '%v201%'
            AND oe.algorithm_version NOT LIKE '%v202%'
            AND oe.algorithm_version NOT LIKE '%v203%'
            AND oe.algorithm_version NOT LIKE '%v204%'
            AND oe.algorithm_version NOT LIKE '%NextGen%'
            AND oe.algorithm_version NOT LIKE '%nextgen%'
            AND oe.algorithm_version NOT LIKE '%AutoCorrector%'
          )
        )
      ORDER BY CAST(k.spend AS DECIMAL(10,2)) DESC
      LIMIT ${sql.raw(String(QUALITY_AUDIT_CONFIG.maxAuditsPerRun))}
    `);
    const rows = auditCandidates?.[0] || auditCandidates;
    if (!Array.isArray(rows) || rows.length === 0) {
      log67.debug(`v198: \u8D26\u6237${accountId} \u65E0\u9700NextGen\u8D28\u91CF\u5BA1\u8BA1\uFF08\u6240\u6709\u6D3B\u8DC3\u5173\u952E\u8BCD\u5DF2\u7531NextGen\u4F18\u5316\uFF09`);
      return results;
    }
    log67.info(`v198: \u8D26\u6237${accountId} \u53D1\u73B0${rows.length}\u4E2A\u5173\u952E\u8BCD\u9700\u8981NextGen\u8D28\u91CF\u5BA1\u8BA1`);
    const { calculateNextGenBid: calculateNextGenBid2 } = await Promise.resolve().then(() => (init_nextGenBidOrchestrator(), nextGenBidOrchestrator_exports));
    const groupConfigs = /* @__PURE__ */ new Map();
    for (const row of rows) {
      if (!groupConfigs.has(row.perf_group_id)) {
        groupConfigs.set(row.perf_group_id, {
          // @ts-ignore
          optimizationGoal: row.optimization_goal || "balanced",
          // @ts-ignore
          targetAcos: row.target_acos ? parseFloat(String(row.target_acos)) : void 0,
          // @ts-ignore
          dailyBudget: row.daily_budget ? parseFloat(String(row.daily_budget)) : void 0,
          // @ts-ignore
          maxBid: row.max_bid ? parseFloat(String(row.max_bid)) : void 0
        });
      }
    }
    let audited = 0;
    let deviationsFound = 0;
    let corrected = 0;
    const bidAdjustments = [];
    for (const row of rows) {
      try {
        const currentBid = parseFloat(String(row.current_bid || "0"));
        if (currentBid <= 0) continue;
        const bidConfig = groupConfigs.get(row.perf_group_id);
        if (!bidConfig) continue;
        const maxBidLimit = row.max_bid ? parseFloat(String(row.max_bid)) : 2;
        const target = {
          // @ts-ignore
          id: row.keyword_id,
          type: "keyword",
          currentBid,
          // @ts-ignore
          impressions: row.impressions || 0,
          // @ts-ignore
          clicks: row.clicks || 0,
          // @ts-ignore
          spend: parseFloat(String(row.spend || "0")),
          // @ts-ignore
          sales: parseFloat(String(row.sales || "0")),
          // @ts-ignore
          orders: row.orders || 0,
          // @ts-ignore
          matchType: row.match_type
        };
        const nextGenResult = await calculateNextGenBid2(accountId, target, bidConfig, maxBidLimit);
        audited++;
        const deviation = Math.abs(nextGenResult.newBid - currentBid) / currentBid;
        if (deviation >= QUALITY_AUDIT_CONFIG.bidDeviationThreshold && nextGenResult.actionType !== "hold") {
          deviationsFound++;
          let adjustedBid = nextGenResult.newBid;
          const maxChange = currentBid * QUALITY_AUDIT_CONFIG.maxSingleAdjustmentPercent;
          if (adjustedBid > currentBid + maxChange) {
            adjustedBid = Math.round((currentBid + maxChange) * 100) / 100;
          } else if (adjustedBid < currentBid - maxChange) {
            adjustedBid = Math.round((currentBid - maxChange) * 100) / 100;
          }
          adjustedBid = Math.max(adjustedBid, 0.02);
          adjustedBid = Math.min(adjustedBid, maxBidLimit);
          adjustedBid = Math.round(adjustedBid * 100) / 100;
          if (Math.abs(adjustedBid - currentBid) > 0.01) {
            bidAdjustments.push({
              // @ts-ignore
              keywordId: row.keyword_id,
              newBid: adjustedBid,
              // @ts-ignore
              campaignId: row.campaign_id,
              reason: `[v198\u8D28\u91CF\u5BA1\u8BA1] NextGen\u5EFA\u8BAE$${nextGenResult.newBid.toFixed(2)}(${nextGenResult.algorithmUsed}), \u65E7\u51FA\u4EF7$${currentBid.toFixed(2)}, \u504F\u5DEE${(deviation * 100).toFixed(1)}%, \u5B89\u5168\u8C03\u6574\u5230$${adjustedBid.toFixed(2)}`,
              isProductTarget: false
            });
            results.push({
              type: "nextgen_quality_audit",
              accountId,
              // @ts-ignore
              targetId: row.keyword_id,
              // @ts-ignore
              targetType: "keyword",
              previousValue: String(currentBid),
              correctedValue: String(adjustedBid),
              // @ts-ignore
              reason: `[v198\u8D28\u91CF\u5BA1\u8BA1] "${row.keyword_text}" \u65E7\u7B97\u6CD5\u51FA\u4EF7$${currentBid.toFixed(2)} \u2192 NextGen\u5EFA\u8BAE$${adjustedBid.toFixed(2)} (${nextGenResult.algorithmUsed}, \u504F\u5DEE${(deviation * 100).toFixed(1)}%)`,
              success: true
              // 暂标记为true，API同步后更新
            });
          }
        }
      } catch (kwErr) {
        log67.warn(`v198: \u5173\u952E\u8BCD${row.keyword_id}\u8D28\u91CF\u5BA1\u8BA1\u5931\u8D25: ${kwErr.message}`);
      }
    }
    if (bidAdjustments.length > 0) {
      try {
        const syncResult = await syncBidAdjustmentsToAmazon(accountId, bidAdjustments);
        corrected = syncResult.success;
        for (const adj of bidAdjustments) {
          const itemResult = syncResult.itemResults?.get(adj.keywordId);
          const synced = itemResult?.status === "synced";
          if (synced) {
            await database.update(keywords).set({ bid: String(adj.newBid) }).where(eq(keywords.id, adj.keywordId));
          }
          await logCorrectionEvent(database, {
            accountId,
            eventCategory: "bid_adjustment",
            actionType: "nextgen_quality_audit",
            keywordId: adj.keywordId,
            campaignId: adj.campaignId,
            previousBid: results.find((r) => r.targetId === adj.keywordId)?.previousValue,
            newBid: String(adj.newBid),
            changeReason: adj.reason
          });
          const resultItem = results.find((r) => r.targetId === adj.keywordId);
          if (resultItem && !synced) {
            resultItem.success = false;
            resultItem.errorMessage = itemResult?.error || "API sync failed";
          }
        }
        log67.warn(`v198: \u8D26\u6237${accountId} NextGen\u8D28\u91CF\u5BA1\u8BA1API\u540C\u6B65\u5B8C\u6210: \u6210\u529F=${syncResult.success}, \u5931\u8D25=${syncResult.failed}`);
      } catch (apiErr) {
        log67.warn(`v198: \u8D26\u6237${accountId} NextGen\u8D28\u91CF\u5BA1\u8BA1API\u540C\u6B65\u5931\u8D25: ${apiErr.message}`);
        for (const r of results) {
          if (r.type === "nextgen_quality_audit") {
            r.success = false;
            r.errorMessage = apiErr.message;
          }
        }
      }
    }
    log67.info(`v198: \u8D26\u6237${accountId} NextGen\u8D28\u91CF\u5BA1\u8BA1\u5B8C\u6210: \u5BA1\u8BA1=${audited}, \u504F\u5DEE=${deviationsFound}, \u7EA0\u6B63=${corrected}`);
  } catch (err) {
    log67.warn(`v199: \u8D26\u6237${accountId} NextGen\u8D28\u91CF\u5BA1\u8BA1\u5F02\u5E38: ${err.message}`);
    if (err.cause) log67.warn(`v199: MySQL\u9519\u8BEF\u8BE6\u60C5: ${JSON.stringify(err.cause).substring(0, 500)}`);
    if (err.sql) log67.warn(`v199: \u5931\u8D25SQL: ${err.sql?.substring(0, 200)}`);
  }
  return results;
}
function startAutoCorrector() {
  // P5: Skip in web process if worker is handling it
  const _p5WorkerActive = process.env.P5_WORKER_ENABLED === "true" && !process.env.P5_IS_WORKER;
  if (_p5WorkerActive) {
    const _acLog = console;
    try { _acLog.info("[P5] AutoCorrector delegated to worker process, skipping in web process"); } catch(_e) {}
    return;
  }
  if (correctionInterval) {
    log67.debug("\u5B9A\u65F6\u7EA0\u9519\u670D\u52A1\u5DF2\u5728\u8FD0\u884C\u4E2D");
    return;
  }
  if (!daypartingCleanupInterval) {
    daypartingCleanupInterval = setInterval(async () => {
      try {
        log67.info("[v426] \u72EC\u7ACB dayparting \u6E05\u7406\u4EFB\u52A1\u5F00\u59CB...");
        const database = await getDb();
        if (!database) return;
        const accountIds = await getActiveAccountIds(database);
        let totalCleaned = 0;
        for (const accId of accountIds) {
          const cleanups = await cleanupExpiredDaypartingBids(database, accId);
          totalCleaned += cleanups.length;
        }
        if (totalCleaned > 0) {
          log67.warn(`[v426] \u72EC\u7ACB dayparting \u6E05\u7406\u5B8C\u6210: ${totalCleaned}\u4E2A\u8D26\u6237\u6709\u6E05\u7406\u64CD\u4F5C`);
        }
      } catch (err) {
        log67.warn(`[v426] \u72EC\u7ACB dayparting \u6E05\u7406\u5931\u8D25: ${err.message}`);
      }
    }, 30 * 60 * 1e3);
    log67.info("[v426] \u72EC\u7ACB dayparting \u6E05\u7406\u5B9A\u65F6\u4EFB\u52A1\u5DF2\u542F\u52A8\uFF0C\u6BCF30\u5206\u949F\u8FD0\u884C\u4E00\u6B21");
  }
  const intervalMs = AUTO_CORRECTION_CONFIG.scanIntervalHours ? AUTO_CORRECTION_CONFIG.scanIntervalHours * 60 * 60 * 1e3 : 4 * 60 * 60 * 1e3;
  correctionInterval = setInterval(async () => {
    try {
      const mem = process.memoryUsage();
      const heapSizeLimit = import_v82.default.getHeapStatistics().heap_size_limit;
      const heapUtil = Math.round(mem.heapUsed / heapSizeLimit * 100);
      if (heapUtil > 80) {
        log67.warn(`[AutoCorrector] v397: \u5185\u5B58\u7D27\u5F20(${heapUtil}%, ${Math.round(mem.heapUsed / 1024 / 1024)}MB/${Math.round(heapSizeLimit / 1024 / 1024)}MB)\uFF0C\u8DF3\u8FC7\u672C\u6B21\u7EA0\u9519\u626B\u63CF`);
        if (typeof global.gc === "function") global.gc();
        return;
      }
      log67.info(`\u5B9A\u65F6\u7EA0\u9519\u626B\u63CF\u5F00\u59CB... heap=${heapUtil}%`);
      const result = await runAutoCorrection();
      log67.warn(`\u5B9A\u65F6\u7EA0\u9519\u626B\u63CF\u5B8C\u6210: \u53D1\u73B0${result.totalIssuesFound}\u4E2A\u95EE\u9898, \u7EA0\u6B63${result.totalCorrected}\u4E2A, \u5931\u8D25${result.totalFailed}\u4E2A`);
      try {
        const { executeRiskActions: executeRiskActions2 } = await Promise.resolve().then(() => (init_riskActionEngine(), riskActionEngine_exports));
        const riskResult = await executeRiskActions2();
        if (riskResult.actionsTriggered > 0) {
          log67.warn(`v235 \u98CE\u9669\u884C\u52A8\u5F15\u64CE: \u89E6\u53D1${riskResult.actionsTriggered}\u4E2A\u884C\u52A8, critical\u8D26\u6237=${riskResult.accountRisks.filter((a) => a.riskLevel === "critical").length}, \u540C\u6B65\u5065\u5EB7=${riskResult.syncHealth.healthStatus}`);
        }
      } catch (riskErr) {
        log67.warn(`v235 \u98CE\u9669\u884C\u52A8\u5F15\u64CE\u6267\u884C\u5931\u8D25: ${riskErr.message}`);
      }
    } catch (err) {
      log67.warn("\u5B9A\u65F6\u7EA0\u9519\u626B\u63CF\u5931\u8D25:", err.message);
    }
  }, intervalMs);
  log67.info(`\u5B9A\u65F6\u7EA0\u9519\u670D\u52A1\u5DF2\u542F\u52A8\uFF0C\u6BCF${AUTO_CORRECTION_CONFIG.scanIntervalHours || 4}\u5C0F\u65F6\u8FD0\u884C\u4E00\u6B21`);
  setInterval(async () => {
    try {
      const db = await getDb();
      if (!db) return;
      const { keywords: kwTable } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
      const { lt: lt4, eq: eqOp, isNotNull: isNotNullOp } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1e3).toISOString().slice(0, 19).replace("T", " ");
      const stuckKeywords = await db.select({ id: kwTable.id, pendingBid: kwTable.pendingBid }).from(kwTable).where(
        // @ts-ignore
        eqOp(kwTable.bidSyncStatus, "pending_confirmation")
      ).limit(500);
      if (stuckKeywords.length === 0) return;
      let recovered = 0;
      for (const kw of stuckKeywords) {
        try {
          await db.update(kwTable).set({
            bidSyncStatus: "synced",
            // @ts-ignore
            ...kw.pendingBid ? { bid: kw.pendingBid, pendingBid: null } : { pendingBid: null }
          }).where(eqOp(kwTable.id, kw.id));
          recovered++;
        } catch (_e) {
        }
      }
      if (recovered > 0) {
        log67.warn(`[v530] pending_confirmation\u8D85\u65F6\u6062\u590D: \u5171\u6062\u590D${recovered}\u6761\u5361\u4F4F\u7684\u7ADE\u4EF7\u6307\u4EE4\u4E3Asynced\u72B6\u6001`);
      }
    } catch (err) {
      log67.warn(`[v530] pending_confirmation\u8D85\u65F6\u6062\u590D\u4EFB\u52A1\u5931\u8D25: ${err.message}`);
    }
  }, 60 * 60 * 1e3);
  log67.info("[v530] pending_confirmation\u8D85\u65F6\u6062\u590D\u5B9A\u65F6\u4EFB\u52A1\u5DF2\u542F\u52A8\uFF0C\u6BCF\u5C0F\u65F6\u8FD0\u884C\u4E00\u6B21");
  setInterval(async () => {
    try {
      const { executeDataCleanup: executeDataCleanup2 } = await Promise.resolve().then(() => (init_dataRetentionService(), dataRetentionService_exports));
      const cleanupResult = await executeDataCleanup2();
      if (cleanupResult.totalDeleted > 0) {
        log67.warn(`[v614i-fix22] \u6570\u636E\u6E05\u7406\u5B8C\u6210: \u5171\u6E05\u7406${cleanupResult.totalDeleted}\u6761\u8BB0\u5F55, \u8017\u65F6${cleanupResult.durationMs}ms`);
        for (const t2 of cleanupResult.tables) {
          if (t2.deletedCount > 0) {
            log67.info(`  - ${t2.table}: ${t2.deletedCount}\u6761 (${t2.description}, \u4FDD\u7559${t2.retentionDays}\u5929)`);
          }
        }
      }
    } catch (cleanupErr) {
      log67.warn(`[v614i-fix22] \u6570\u636E\u6E05\u7406\u5B9A\u65F6\u4EFB\u52A1\u5931\u8D25: ${cleanupErr.message}`);
    }
  }, 24 * 60 * 60 * 1e3);
  log67.info("[v614i-fix22] \u6570\u636E\u4FDD\u7559\u4E0E\u6E05\u7406\u5B9A\u65F6\u4EFB\u52A1\u5DF2\u542F\u52A8\uFF0C\u6BCF24\u5C0F\u65F6\u8FD0\u884C\u4E00\u6B21");
  setInterval(async () => {
    try {
      const { runAnomalyDetection: runAnomalyDetection2 } = await Promise.resolve().then(() => (init_dataAnomalyDetector(), dataAnomalyDetector_exports));
      const result = await runAnomalyDetection2();
      if (result.totalAnomalies > 0) {
        log67.warn(`[v614i-fix23] \u5F02\u5E38\u6570\u636E\u68C0\u6D4B: \u53D1\u73B0${result.totalAnomalies}\u4E2A\u5F02\u5E38 (critical:${result.criticalCount} high:${result.highCount} medium:${result.mediumCount}), \u8017\u65F6${result.durationMs}ms`);
        for (const alert of result.alerts.filter((a) => a.severity === "critical" || a.severity === "high")) {
          log67.warn(`  [${alert.severity.toUpperCase()}] ${alert.description}`);
          log67.info(`    \u5EFA\u8BAE: ${alert.suggestedAction}`);
        }
      } else {
        log67.info(`[v614i-fix23] \u5F02\u5E38\u6570\u636E\u68C0\u6D4B: \u672A\u53D1\u73B0\u5F02\u5E38, \u8017\u65F6${result.durationMs}ms`);
      }
    } catch (anomalyErr) {
      log67.warn(`[v614i-fix23] \u5F02\u5E38\u6570\u636E\u68C0\u6D4B\u5B9A\u65F6\u4EFB\u52A1\u5931\u8D25: ${anomalyErr.message}`);
    }
  }, 6 * 60 * 60 * 1e3);
  log67.info("[v614i-fix23] \u5F02\u5E38\u6570\u636E\u68C0\u6D4B\u544A\u8B66\u5B9A\u65F6\u4EFB\u52A1\u5DF2\u542F\u52A8\uFF0C\u6BCF6\u5C0F\u65F6\u8FD0\u884C\u4E00\u6B21");
}
function stopAutoCorrector() {
  if (correctionInterval) {
    clearInterval(correctionInterval);
    correctionInterval = null;
    log67.debug("\u5B9A\u65F6\u7EA0\u9519\u670D\u52A1\u5DF2\u505C\u6B62");
  }
  if (daypartingCleanupInterval) {
    clearInterval(daypartingCleanupInterval);
    daypartingCleanupInterval = null;
    log67.debug("[v426] \u72EC\u7ACB dayparting \u6E05\u7406\u5B9A\u65F6\u4EFB\u52A1\u5DF2\u505C\u6B62");
  }
}
async function runDaypartingCleanup() {
  const database = await getDb();
  if (!database) return { accountsCleaned: 0, totalRecordsCleaned: 0 };
  const accountIds = await getActiveAccountIds(database);
  let accountsCleaned = 0;
  let totalRecordsCleaned = 0;
  for (const accId of accountIds) {
    const cleanups = await cleanupExpiredDaypartingBids(database, accId);
    if (cleanups.length > 0) {
      accountsCleaned++;
      totalRecordsCleaned += cleanups.reduce((sum2, c) => sum2 + parseInt(c.previousValue.match(/\d+/)?.[0] || "0"), 0);
    }
  }
  log67.warn(`[v426] \u624B\u52A8dayparting\u6E05\u7406\u5B8C\u6210: ${accountsCleaned}\u4E2A\u8D26\u6237, ${totalRecordsCleaned}\u6761\u8BB0\u5F55`);
  return { accountsCleaned, totalRecordsCleaned };
}
async function retryFailedTargetStatusChanges(database, accountId) {
  const results = [];
  try {
    const expiryDateStr = new Date(Date.now() - AUTO_CORRECTION_CONFIG.retryExpiryDays * 24 * 60 * 60 * 1e3).toISOString().slice(0, 19).replace("T", " ");
    const failedEvents = await database.select({
      id: optimizationEvents2.id,
      campaignId: optimizationEvents2.campaignId,
      campaignName: optimizationEvents2.campaignName,
      keywordId: optimizationEvents2.keywordId,
      keywordText: optimizationEvents2.keywordText,
      actionType: optimizationEvents2.actionType,
      actionDetail: optimizationEvents2.actionDetail,
      // @ts-ignore
      newValue: optimizationEvents2.newValue,
      apiSyncDetail: optimizationEvents2.apiSyncDetail,
      createdAt: optimizationEvents2.createdAt
    }).from(optimizationEvents2).where(
      and(
        eq(optimizationEvents2.accountId, accountId),
        or(
          // @ts-ignore
          eq(optimizationEvents2.actionType, "target_enable"),
          eq(optimizationEvents2.actionType, "target_pause")
        ),
        or(
          eq(optimizationEvents2.apiSyncStatus, "failed"),
          // @ts-ignore
          eq(optimizationEvents2.apiSyncStatus, "pending")
        ),
        gte(optimizationEvents2.createdAt, expiryDateStr)
      )
    ).orderBy(desc(optimizationEvents2.createdAt)).limit(AUTO_CORRECTION_CONFIG.maxRetryPerRun);
    if (failedEvents.length === 0) return results;
    log67.warn(`v202: \u8D26\u6237${accountId} \u53D1\u73B0${failedEvents.length}\u6761\u5931\u8D25\u7684\u5173\u952E\u8BCD\u72B6\u6001\u53D8\u66F4\u9700\u8981\u91CD\u8BD5`);
    const statusChanges = [];
    for (const event of failedEvents) {
      try {
        let detail = {};
        if (event.actionDetail) {
          try {
            detail = typeof event.actionDetail === "string" ? JSON.parse(event.actionDetail) : event.actionDetail;
          } catch (e) {
            log67.debug(`[AutoCorrector] \u975E\u5173\u952E\u64CD\u4F5C\u5931\u8D25: ${e?.message}`);
          }
        }
        const localKeywordId = detail.keywordId || event.keywordId;
        if (!localKeywordId) {
          await database.update(optimizationEvents2).set({
            apiSyncStatus: "invalid_legacy",
            apiSyncDetail: JSON.stringify({ reason: "v202: \u65E0\u6CD5\u786E\u5B9AkeywordId", fixedAt: (/* @__PURE__ */ new Date()).toISOString() })
          }).where(eq(optimizationEvents2.id, event.id));
          continue;
        }
        const newStatus = event.actionType === "target_enable" ? "enabled" : "paused";
        const isProductTarget = detail.isProductTarget || detail.targetType === "product" || false;
        let retryCount = 0;
        if (event.apiSyncDetail) {
          try {
            const syncDetail = typeof event.apiSyncDetail === "string" ? JSON.parse(event.apiSyncDetail) : event.apiSyncDetail;
            retryCount = syncDetail.retryCount || 0;
          } catch (e) {
            log67.debug(`[AutoCorrector] \u975E\u5173\u952E\u64CD\u4F5C\u5931\u8D25: ${e?.message}`);
          }
        }
        if (retryCount >= AUTO_CORRECTION_CONFIG.maxRetryAttempts) {
          await database.update(optimizationEvents2).set({
            apiSyncStatus: "not_applicable",
            apiSyncDetail: JSON.stringify({
              reason: `\u8D85\u8FC7\u6700\u5927\u91CD\u8BD5\u6B21\u6570(${AUTO_CORRECTION_CONFIG.maxRetryAttempts})`,
              retryCount,
              lastRetryAt: (/* @__PURE__ */ new Date()).toISOString()
            })
          }).where(eq(optimizationEvents2.id, event.id));
          results.push({
            type: "status_change_retry",
            accountId,
            targetId: localKeywordId,
            targetType: "keyword",
            previousValue: "",
            correctedValue: newStatus,
            reason: `\u5173\u952E\u8BCD\u72B6\u6001\u53D8\u66F4\u8D85\u8FC7\u6700\u5927\u91CD\u8BD5\u6B21\u6570: ${event.keywordText || localKeywordId}`,
            success: false,
            errorMessage: `\u8D85\u8FC7\u6700\u5927\u91CD\u8BD5\u6B21\u6570(${AUTO_CORRECTION_CONFIG.maxRetryAttempts})`
          });
          continue;
        }
        statusChanges.push({
          eventId: event.id,
          keywordId: localKeywordId,
          newStatus,
          campaignId: event.campaignId || 0,
          // @ts-ignore
          reason: `[AutoCorrector v202] \u91CD\u8BD5\u5173\u952E\u8BCD\u72B6\u6001\u53D8\u66F4`,
          // @ts-ignore
          isProductTarget
          // @ts-ignore
        });
      } catch (parseErr) {
        log67.warn(`v202: \u89E3\u6790\u72B6\u6001\u53D8\u66F4\u4E8B\u4EF6\u5931\u8D25: eventId=${event.id}, ${parseErr.message}`);
      }
    }
    if (statusChanges.length === 0) return results;
    log67.info(`v202: \u51C6\u5907\u91CD\u8BD5${statusChanges.length}\u4E2A\u5173\u952E\u8BCD\u72B6\u6001\u53D8\u66F4`);
    const syncResult = await syncKeywordStatusToAmazon(
      accountId,
      statusChanges.map((sc) => ({
        keywordId: sc.keywordId,
        newStatus: sc.newStatus,
        campaignId: sc.campaignId,
        reason: sc.reason,
        isProductTarget: sc.isProductTarget
      }))
    );
    log67.warn(`v202: \u5173\u952E\u8BCD\u72B6\u6001\u53D8\u66F4\u540C\u6B65\u7ED3\u679C: \u6210\u529F=${syncResult.success}, \u5931\u8D25=${syncResult.failed}`);
    const failedKeywordIds = /* @__PURE__ */ new Set();
    for (const err of syncResult.errors) {
      const match = err.match(/关键词\s*(\d+)/);
      if (match) failedKeywordIds.add(Number(match[1]));
    }
    for (const sc of statusChanges) {
      const success2 = !failedKeywordIds.has(sc.keywordId) && syncResult.success > 0;
      if (success2) {
        await database.update(optimizationEvents2).set({
          apiSyncStatus: "synced",
          // @ts-ignore
          apiSyncDetail: JSON.stringify({ correctedBy: "AutoCorrector v202", correctedAt: (/* @__PURE__ */ new Date()).toISOString() }),
          apiSyncedAt: /* @__PURE__ */ new Date()
        }).where(eq(optimizationEvents2.id, sc.eventId));
        await database.execute(sql`
          UPDATE optimization_logs SET api_sync_status = 'synced'
          WHERE id = (SELECT source_id FROM optimization_events WHERE id = ${sc.eventId} AND source_table = 'optimization_logs')
        `).catch(() => {
        });
      } else {
        let retryCount = 0;
        try {
          const event = failedEvents.find((e) => e.id === sc.eventId);
          if (event?.apiSyncDetail) {
            const syncDetail = typeof event.apiSyncDetail === "string" ? JSON.parse(event.apiSyncDetail) : event.apiSyncDetail;
            retryCount = (syncDetail.retryCount || 0) + 1;
          } else {
            retryCount = 1;
          }
        } catch (e) {
          log67.debug(`[AutoCorrector] \u975E\u5173\u952E\u64CD\u4F5C\u5931\u8D25: ${e?.message}`);
        }
        await database.update(optimizationEvents2).set({
          apiSyncDetail: JSON.stringify({
            retryCount,
            lastRetryAt: (/* @__PURE__ */ new Date()).toISOString(),
            // @ts-ignore
            lastError: syncResult.errors.join("; ").substring(0, 200)
          })
        }).where(eq(optimizationEvents2.id, sc.eventId));
      }
      results.push({
        type: "status_change_retry",
        accountId,
        targetId: sc.keywordId,
        targetType: "keyword",
        previousValue: "",
        correctedValue: sc.newStatus,
        reason: `\u91CD\u8BD5\u5173\u952E\u8BCD\u72B6\u6001\u53D8\u66F4(${sc.newStatus}): keywordId=${sc.keywordId}`,
        success: success2,
        // @ts-ignore
        errorMessage: success2 ? void 0 : syncResult.errors.join("; ")
      });
    }
  } catch (error48) {
    log67.warn(`v202: \u8D26\u6237${accountId} retryFailedTargetStatusChanges\u5931\u8D25: ${error48.message}`);
  }
  return results;
}
async function retryFailedProductTargetCreations(database, accountId) {
  const results = [];
  try {
    const expiryDateStr = new Date(Date.now() - AUTO_CORRECTION_CONFIG.retryExpiryDays * 24 * 60 * 60 * 1e3).toISOString().slice(0, 19).replace("T", " ");
    const [missingTargets] = await database.execute(sql`
 SELECT pt.id, pt.internal_ad_group_id, pt.targetType, pt.targetExpression, pt.bid, pt.targetStatus,
 ag.adGroupId as amazon_ad_group_id, ag.campaignId as amazon_campaign_id
 FROM product_targets pt
 INNER JOIN ad_groups ag ON pt.internal_ad_group_id = ag.id
 WHERE pt.accountId = ${accountId}
 AND (pt.targetId IS NULL OR pt.targetId = '' OR pt.targetId = '0')
 AND pt.targetStatus != 'archived'
 AND ag.adGroupId IS NOT NULL
 AND ag.campaignId IS NOT NULL
 LIMIT 200
 `);
    if (!missingTargets || missingTargets.length === 0) {
      log67.info(`v310: \u8D26\u6237${accountId} \u65E0\u7F3A\u5C11Amazon ID\u7684\u5546\u54C1\u5B9A\u5411\u9700\u8981\u521B\u5EFA`);
      return results;
    }
    log67.warn(`v310: \u8D26\u6237${accountId} \u53D1\u73B0${missingTargets.length}\u4E2A\u7F3A\u5C11Amazon ID\u7684\u5546\u54C1\u5B9A\u5411\u9700\u8981\u521B\u5EFA`);
    const targetsToCreate = [];
    for (const pt of missingTargets) {
      try {
        let expression = [];
        if (pt.targetExpression) {
          try {
            expression = typeof pt.targetExpression === "string" ? JSON.parse(pt.targetExpression) : pt.targetExpression;
          } catch (e) {
            log67.debug(`[AutoCorrector] \u975E\u5173\u952E\u64CD\u4F5C\u5931\u8D25: ${e?.message}`);
          }
        }
        let asin = "";
        let targetingType = "exact";
        for (const expr of expression) {
          if (expr.type === "asinSameAs" && expr.value) {
            asin = expr.value;
            targetingType = "exact";
            break;
          } else if (expr.type === "asinExpandedFrom" && expr.value) {
            asin = expr.value;
            targetingType = "expanded";
            break;
          }
        }
        if (!asin) {
          log67.debug(`v310: \u8DF3\u8FC7\u65E0ASIN\u7684\u5546\u54C1\u5B9A\u5411 id=${pt.id}`);
          continue;
        }
        targetsToCreate.push({
          localTargetId: pt.id,
          adGroupId: String(pt.amazon_ad_group_id),
          campaignId: String(pt.amazon_campaign_id),
          asin,
          targetingType,
          bid: parseFloat(String(pt.bid)) || 0.75
        });
      } catch (parseErr) {
        log67.warn(`v310: \u89E3\u6790\u5546\u54C1\u5B9A\u5411\u5931\u8D25 id=${pt.id}: ${parseErr.message}`);
      }
    }
    if (targetsToCreate.length === 0) {
      log67.info(`v310: \u8D26\u6237${accountId} \u65E0\u6709\u6548\u7684\u5546\u54C1\u5B9A\u5411\u53EF\u521B\u5EFA`);
      return results;
    }
    log67.info(`v310: \u51C6\u5907\u521B\u5EFA${targetsToCreate.length}\u4E2A\u5546\u54C1\u5B9A\u5411...`);
    const syncResult = await syncNewProductTargetsToAmazon(accountId, targetsToCreate);
    log67.warn(`v310: \u5546\u54C1\u5B9A\u5411\u521B\u5EFA\u7ED3\u679C: \u6210\u529F=${syncResult.success}, \u5931\u8D25=${syncResult.failed}`);
    for (const target of targetsToCreate) {
      const mapKey = `${target.adGroupId}:${target.asin}`;
      const amazonTargetId = syncResult.targetIdMap.get(mapKey);
      if (amazonTargetId) {
        await database.execute(sql`
          UPDATE product_targets SET targetId = ${String(amazonTargetId)} WHERE id = ${target.localTargetId}
        `);
        await database.execute(sql`
          UPDATE optimization_events SET api_sync_status = 'synced', error_message = 'v324: AutoCorrector创建成功'
          WHERE target_id = ${target.localTargetId} AND api_sync_status = 'pending'
        `).catch(() => {
        });
        results.push({
          // @ts-expect-error - type assertion
          type: "keyword_create_retry",
          // 复用现有类型
          accountId,
          targetId: target.localTargetId,
          targetType: "product_target",
          previousValue: "",
          correctedValue: String(amazonTargetId),
          reason: `v310: \u521B\u5EFA\u5546\u54C1\u5B9A\u5411\u6210\u529F ASIN=${target.asin}`,
          success: true
        });
      } else {
        results.push({
          // @ts-expect-error - type assertion
          type: "keyword_create_retry",
          accountId,
          targetId: target.localTargetId,
          targetType: "product_target",
          previousValue: "",
          correctedValue: target.asin,
          reason: `v310: \u521B\u5EFA\u5546\u54C1\u5B9A\u5411\u5931\u8D25 ASIN=${target.asin}`,
          success: false,
          // @ts-ignore
          errorMessage: syncResult.errors.join("; ").substring(0, 200)
        });
      }
    }
  } catch (error48) {
    log67.warn(`v310: \u8D26\u6237${accountId} retryFailedProductTargetCreations\u5931\u8D25: ${error48.message}`);
  }
  return results;
}
async function revalidateStalePendingCommands(database, accountId) {
  const results = [];
  try {
    const [stalePending] = await database.execute(sql`
      SELECT oe.id, oe.action_type, oe.keyword_id, oe.target_id,
             oe.previous_value, oe.new_value, oe.previous_bid, oe.new_bid,
             oe.created_at, oe.performance_group_id,
             k.bid as kw_current_bid, k.keywordId as amazon_keyword_id,
             pt.bid as pt_current_bid, pt.targetId as amazon_target_id
      FROM optimization_events oe
      LEFT JOIN keywords k ON oe.keyword_id IS NOT NULL AND oe.keyword_id = k.id
      LEFT JOIN product_targets pt ON oe.target_id IS NOT NULL AND oe.target_id = pt.id
      WHERE oe.api_sync_status = 'pending'
        AND oe.action_type IN ('bid_increase', 'bid_decrease', 'target_pause', 'target_enable', 'dayparting_bid')
        AND oe.created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
        AND oe.created_at > DATE_SUB(NOW(), INTERVAL 14 DAY)
        AND oe.account_id = ${accountId}
      ORDER BY oe.created_at ASC
      LIMIT 500
    `);
    if (!stalePending || stalePending.length === 0) {
      return results;
    }
    log67.warn(`v310: \u8D26\u6237${accountId} \u53D1\u73B0${stalePending.length}\u6761\u8D8524h\u7684pending\u6307\u4EE4\u9700\u8981\u91CD\u8BC4\u4F30`);
    let cancelled = 0;
    let kept = 0;
    for (const row of stalePending) {
      try {
        const actionType = row.action_type;
        const newValue = parseFloat(String(row.new_bid || row.new_value || 0));
        const prevValue = parseFloat(String(row.previous_bid || row.previous_value || 0));
        const currentBid = parseFloat(String(row.kw_current_bid || row.pt_current_bid || 0));
        let shouldCancel = false;
        let cancelReason = "";
        if (row.keyword_id) {
          try {
            const [kwStatus] = await database.execute(sql`SELECT keywordStatus FROM keywords WHERE id = ${row.keyword_id} LIMIT 1`);
            const statusRows = Array.isArray(kwStatus) ? kwStatus : [kwStatus];
            if (statusRows.length > 0 && (statusRows[0]?.keywordStatus === "amazon_deleted" || statusRows[0]?.keywordStatus === "archived" || statusRows[0]?.keywordStatus === "amazon_archived")) {
              shouldCancel = true;
              cancelReason = `v614i-fix21: \u5173\u952E\u8BCD\u5DF2${statusRows[0].keywordStatus}\uFF0C\u53D6\u6D88pending\u6307\u4EE4`;
            }
          } catch (_kwErr) {
          }
        }
        if (actionType === "dayparting_bid") {
          if (Math.abs(newValue - prevValue) < 1e-3) {
            shouldCancel = true;
            cancelReason = "\u5206\u65F6\u7ADE\u4EF7\u51FA\u4EF7\u672A\u53D8\u66F4";
          } else if (currentBid > 0 && Math.abs(currentBid - newValue) < 0.01) {
            shouldCancel = true;
            cancelReason = `\u5F53\u524D\u51FA\u4EF7$${currentBid.toFixed(2)}\u5DF2\u7B49\u4E8E\u76EE\u6807$${newValue.toFixed(2)}`;
          }
        }
        if (actionType === "bid_increase" && currentBid >= newValue && currentBid > 0) {
          shouldCancel = true;
          cancelReason = `\u5F53\u524D\u51FA\u4EF7$${currentBid.toFixed(2)}\u5DF2>=\u63D0\u4EF7\u76EE\u6807$${newValue.toFixed(2)}`;
        } else if (actionType === "bid_decrease" && currentBid <= newValue && currentBid > 0) {
          shouldCancel = true;
          cancelReason = `\u5F53\u524D\u51FA\u4EF7$${currentBid.toFixed(2)}\u5DF2<=\u964D\u4EF7\u76EE\u6807$${newValue.toFixed(2)}`;
        }
        if (!shouldCancel && prevValue > 0 && (actionType === "bid_increase" || actionType === "bid_decrease")) {
          const changePercent = Math.abs(newValue - prevValue) / prevValue;
          if (changePercent > 0.5) {
            shouldCancel = true;
            cancelReason = `\u8C03\u6574\u5E45\u5EA6${(changePercent * 100).toFixed(1)}%\u8D85\u8FC750%\u5B89\u5168\u9608\u503C`;
          }
        }
        if ((actionType === "target_pause" || actionType === "target_enable") && !row.amazon_keyword_id && !row.amazon_target_id) {
          shouldCancel = true;
          cancelReason = "\u7F3A\u5C11Amazon ID\uFF0C\u65E0\u6CD5\u6267\u884C";
        }
        if (shouldCancel) {
          await database.execute(sql`
 UPDATE optimization_events 
 SET api_sync_status = 'not_applicable',
 error_message = ${`v324\u589E\u91CF\u91CD\u8BC4\u4F30: ${cancelReason}`}
 WHERE id = ${row.id}
 `);
          cancelled++;
          results.push({
            // @ts-expect-error - type assertion
            type: "bid_execution_verify",
            accountId,
            // @ts-ignore
            targetId: row.keyword_id || row.target_id,
            // @ts-ignore
            targetType: row.keyword_id ? "keyword" : row.target_id ? "product_target" : "unknown",
            // @ts-ignore
            previousValue: String(row.new_value),
            correctedValue: "cancelled",
            reason: `v310: \u53D6\u6D88\u8FC7\u65F6pending\u6307\u4EE4(${actionType}): ${cancelReason}`,
            success: true
          });
        } else {
          kept++;
        }
      } catch (evalErr) {
        log67.warn(`v310: \u589E\u91CF\u91CD\u8BC4\u4F30\u5355\u6761\u5931\u8D25: ${evalErr.message}`);
      }
    }
    if (cancelled > 0 || kept > 0) {
      log67.warn(`v310: \u8D26\u6237${accountId} \u589E\u91CF\u91CD\u8BC4\u4F30\u5B8C\u6210: \u603B\u8BA1=${stalePending.length}, \u53D6\u6D88=${cancelled}, \u4FDD\u7559=${kept}`);
    }
  } catch (error48) {
    log67.warn(`v310: \u8D26\u6237${accountId} revalidateStalePendingCommands\u5931\u8D25: ${error48.message}`);
  }
  return results;
}
// [P3v12] Orphan search terms cleanup - batched delete to reduce lock contention
// P4: Redis-based low-priority task queue for heavy cleanup operations
async function scheduleOrphanCleanupViaRedis() {
  try {
    const { getRedis, isRedisAvailable } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
    if (isRedisAvailable()) {
      const redis = getRedis();
      if (redis) {
        // Check if cleanup is already scheduled or running
        const lockKey = "orphan_cleanup:lock";
        const lastRunKey = "orphan_cleanup:last_run";
        const isLocked = await redis.get(lockKey);
        if (isLocked) {
          log67.debug("[P4] Orphan cleanup already in progress, skipping");
          return { cleaned: 0, errors: [] };
        }
        // Only run during low-traffic hours (UTC 8-14 = PST 0-6 AM)
        const currentHour = new Date().getUTCHours();
        const isLowTraffic = currentHour >= 8 && currentHour <= 14;
        // Check last run time - at most once per 6 hours
        const lastRun = await redis.get(lastRunKey);
        const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
        if (lastRun && parseInt(lastRun) > sixHoursAgo) {
          log67.debug("[P4] Orphan cleanup ran recently, skipping");
          return { cleaned: 0, errors: [] };
        }
        if (!isLowTraffic) {
          // Queue for later execution during low-traffic window
          await redis.set("orphan_cleanup:queued", "1", "EX", 43200); // 12h TTL
          log67.info(`[P4] Orphan cleanup queued for low-traffic window (current UTC hour: ${currentHour})`);
          return { cleaned: 0, errors: [] };
        }
        // Acquire lock and execute
        await redis.set(lockKey, "1", "EX", 600); // 10 min lock
        log67.info("[P4] Executing orphan cleanup during low-traffic window");
        try {
          const result = await cleanupOrphanSearchTerms();
          await redis.set(lastRunKey, String(Date.now()), "EX", 86400);
          await redis.del("orphan_cleanup:queued");
          return result;
        } finally {
          await redis.del(lockKey);
        }
      }
    }
    // Fallback: Redis not available, check time window manually
    const currentHour = new Date().getUTCHours();
    if (currentHour >= 8 && currentHour <= 14) {
      return await cleanupOrphanSearchTerms();
    }
    log67.debug("[P4] Orphan cleanup deferred (no Redis, not in low-traffic window)");
    return { cleaned: 0, errors: [] };
  } catch (err) {
    log67.debug(`[P4] Orphan cleanup scheduling error: ${err.message}`);
    return { cleaned: 0, errors: [err.message] };
  }
}

// P4: Also add a periodic check for queued cleanup tasks
async function checkQueuedOrphanCleanup() {
  try {
    const { getRedis, isRedisAvailable } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
    if (!isRedisAvailable()) return;
    const redis = getRedis();
    if (!redis) return;
    const isQueued = await redis.get("orphan_cleanup:queued");
    if (!isQueued) return;
    const currentHour = new Date().getUTCHours();
    if (currentHour >= 8 && currentHour <= 14) {
      log67.info("[P4] Processing queued orphan cleanup task");
      await scheduleOrphanCleanupViaRedis();
    }
  } catch (err) {
    log67.debug(`[P4] Queued cleanup check error: ${err.message}`);
  }
}

async function cleanupOrphanSearchTerms() {
  const results = { cleaned: 0, errors: [] };
  const conn = await getDirectConnection();
  const BATCH_SIZE = 1000; // P3v12: smaller batches to reduce lock time
  const BATCH_DELAY = 500; // P3v12: 500ms between batches
  try {
    // Clean search_terms for disconnected/error accounts (older than 30 days) - in batches
    let disconnectedCleaned = 0;
    for (let _batch = 0; _batch < 5; _batch++) {
      const [batchResult] = await conn.execute(
        `DELETE FROM search_terms
         WHERE id IN (
           SELECT sub.id FROM (
             SELECT st.id FROM search_terms st
             INNER JOIN ad_accounts aa ON st.accountId = CAST(aa.accountId AS UNSIGNED)
             WHERE aa.connectionStatus IN ('disconnected', 'error')
               AND st.createdAt < DATE_SUB(NOW(), INTERVAL 30 DAY)
             LIMIT ${BATCH_SIZE}
           ) AS sub
         )`
      );
      const affected = batchResult?.affectedRows || 0;
      disconnectedCleaned += affected;
      if (affected < BATCH_SIZE) break;
      await new Promise(r => setTimeout(r, BATCH_DELAY));
    }
    // Clean search_terms where campaign no longer exists (older than 14 days) - in batches
    let orphanCleaned = 0;
    for (let _batch = 0; _batch < 5; _batch++) {
      const [batchResult] = await conn.execute(
        `DELETE FROM search_terms
         WHERE id IN (
           SELECT sub.id FROM (
             SELECT st.id FROM search_terms st
             LEFT JOIN campaigns c ON st.campaignId = c.campaignId AND st.accountId = CAST(c.accountId AS UNSIGNED)
             WHERE c.campaignId IS NULL
               AND st.createdAt < DATE_SUB(NOW(), INTERVAL 14 DAY)
             LIMIT ${BATCH_SIZE}
           ) AS sub
         )`
      );
      const affected = batchResult?.affectedRows || 0;
      orphanCleaned += affected;
      if (affected < BATCH_SIZE) break;
      await new Promise(r => setTimeout(r, BATCH_DELAY));
    }
    results.cleaned = disconnectedCleaned + orphanCleaned;
    if (results.cleaned > 0) {
      log67.warn(`[P3v12] \u5b64\u513f\u641c\u7d22\u8bcd\u6e05\u7406\u5b8c\u6210: \u65ad\u8fde\u8d26\u6237=${disconnectedCleaned}, \u5b64\u513fcampaign=${orphanCleaned}`);
    }
  } catch (error) {
    log67.warn(`[P3v12] \u5b64\u513f\u641c\u7d22\u8bcd\u6e05\u7406\u5931\u8d25: ${error.message}`);
    results.errors.push(error.message);
  } finally {
    conn.release();
  }
  return results;
}
// [fix24-P2-11v2] Pending command auto-retry for 4-24h old events - using direct MySQL connection
async function retryRecentPendingEvents(database, accountId) {
  const retryResults = { retried: 0, skipped: 0, errors: [] };
  const conn = await getDirectConnection();
  try {
    const [recentPending] = await conn.execute(
      `SELECT oe.id, oe.action_type, oe.keyword_id, oe.target_id,
              oe.new_bid, oe.previous_bid, oe.account_id
       FROM optimization_events oe
       WHERE oe.api_sync_status = 'pending'
         AND oe.action_type IN ('bid_increase', 'bid_decrease')
         AND oe.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
         AND oe.created_at < DATE_SUB(NOW(), INTERVAL 4 HOUR)
         AND oe.account_id = ?
       ORDER BY oe.created_at ASC
       LIMIT 50`,
      [accountId]
    );
    if (!recentPending || recentPending.length === 0) {
      return retryResults;
    }
    log67.info(`[fix24-P2-11v2] \u8d26\u6237${accountId} \u53d1\u73b0${recentPending.length}\u67614-24h\u7684pending\u6307\u4ee4, \u5c1d\u8bd5\u91cd\u65b0\u5165\u961f`);
    for (const row of recentPending) {
      try {
        const entityId = row.keyword_id || row.target_id;
        const entityType = row.keyword_id ? 'keyword' : 'product_target';
        const newBid = parseFloat(String(row.new_bid || 0));
        if (!entityId || newBid <= 0) {
          retryResults.skipped++;
          continue;
        }
        // Check if there's already a newer task processing this entity
        const [existingTask] = await conn.execute(
          `SELECT id FROM optimization_tasks
           WHERE target_entity_id = ?
             AND target_entity_type = ?
             AND status IN ('pending', 'processing', 'retry')
             AND created_at > DATE_SUB(NOW(), INTERVAL 4 HOUR)
           LIMIT 1`,
          [entityId, entityType]
        );
        if (existingTask && existingTask.length > 0) {
          retryResults.skipped++;
          continue;
        }
        // Enqueue a new optimization_task for retry
        const { enqueueTasks: enqueueTasks2 } = await Promise.resolve().then(() => (init_optimizationSyncEngine(), optimizationSyncEngine_exports));
        await enqueueTasks2([{
          accountId: row.account_id,
          taskType: 'bid_adjustment',
          targetEntityType: entityType,
          targetEntityId: entityId,
          newValue: String(newBid),
          previousValue: String(row.previous_bid || ''),
          eventId: row.id,
          priority: 'low',
          source: 'fix24-P2-11v2-retry'
        }]);
        retryResults.retried++;
      } catch (retryErr) {
        retryResults.errors.push(`event ${row.id}: ${retryErr.message}`);
      }
    }
    if (retryResults.retried > 0) {
      log67.warn(`[fix24-P2-11v2] \u8d26\u6237${accountId} pending\u6307\u4ee4\u91cd\u8bd5: \u5165\u961f=${retryResults.retried}, \u8df3\u8fc7=${retryResults.skipped}, \u9519\u8bef=${retryResults.errors.length}`);
    }
  } catch (error) {
    log67.warn(`[fix24-P2-11v2] \u8d26\u6237${accountId} pending\u6307\u4ee4\u91cd\u8bd5\u5931\u8d25: ${error.message}`);
  } finally {
    conn.release();
  }
  return retryResults;
}
async function cleanupExpiredDaypartingBids(database, accountId) {
  const results = [];
  try {
    const [expiredRecords] = await database.execute(sql`
      SELECT id, keyword_id, action_type, api_sync_status, new_bid, previous_bid, created_at
      FROM optimization_events
      WHERE account_id = ${accountId}
        AND action_type = 'dayparting_bid'
        AND api_sync_status IN ('failed', 'pending')
        AND created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
        AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
      ORDER BY created_at ASC
      LIMIT 2000
    `);
    if (!expiredRecords || expiredRecords.length === 0) {
      return results;
    }
    log67.info(`v425: \u8D26\u6237${accountId} \u53D1\u73B0${expiredRecords.length}\u6761\u8FC7\u671F\u7684dayparting_bid\u5931\u8D25/pending\u8BB0\u5F55`);
    const expiredIds = expiredRecords.map((r) => r.id);
    for (let i = 0; i < expiredIds.length; i += 500) {
      const batch = expiredIds.slice(i, i + 500);
      await database.execute(sql`
        UPDATE optimization_events 
        SET api_sync_status = 'superseded',
            error_message = CONCAT(COALESCE(error_message, ''), ' | v425: 分时竞价超过24h已过时，标记为superseded')
        WHERE id IN (${safeInClause(batch)})
      `);
    }
    log67.warn(`v425: \u8D26\u6237${accountId} \u5DF2\u5C06${expiredRecords.length}\u6761\u8FC7\u671Fdayparting_bid\u6807\u8BB0\u4E3Asuperseded`);
    results.push({
      // @ts-expect-error - type assertion
      type: "dayparting_cleanup",
      accountId,
      targetId: 0,
      targetType: "batch",
      previousValue: `${expiredRecords.length} expired dayparting_bid records`,
      correctedValue: "superseded",
      reason: `v425: \u6E05\u7406${expiredRecords.length}\u6761\u8D85\u8FC724h\u7684\u8FC7\u671Fdayparting_bid\u8BB0\u5F55`,
      success: true
    });
    const [oldFailedRecords] = await database.execute(sql`
      SELECT COUNT(*) as cnt
      FROM optimization_events
      WHERE account_id = ${accountId}
        AND api_sync_status = 'failed'
        AND action_type != 'dayparting_bid'
        AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
        AND created_at > DATE_SUB(NOW(), INTERVAL 60 DAY)
    `);
    const oldFailedCount = oldFailedRecords?.[0]?.cnt || 0;
    if (oldFailedCount > 0) {
      await database.execute(sql`
        UPDATE optimization_events 
        SET api_sync_status = 'permanently_failed',
            error_message = CONCAT(COALESCE(error_message, ''), ' | v425: 超过7天未成功同步，标记为permanently_failed')
        WHERE account_id = ${accountId}
          AND api_sync_status = 'failed'
          AND action_type != 'dayparting_bid'
          AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
          AND created_at > DATE_SUB(NOW(), INTERVAL 60 DAY)
        LIMIT 1000
      `);
      log67.warn(`v425: \u8D26\u6237${accountId} \u5DF2\u5C06${Math.min(oldFailedCount, 1e3)}\u6761\u8D857\u5929\u7684\u975Edayparting\u5931\u8D25\u8BB0\u5F55\u6807\u8BB0\u4E3Apermanently_failed`);
      results.push({
        // @ts-expect-error - type assertion
        type: "old_failure_cleanup",
        accountId,
        targetId: 0,
        targetType: "batch",
        previousValue: `${oldFailedCount} old failed records`,
        correctedValue: "permanently_failed",
        reason: `v425: \u6E05\u7406${Math.min(oldFailedCount, 1e3)}\u6761\u8D857\u5929\u7684\u975Edayparting\u5931\u8D25\u8BB0\u5F55`,
        success: true
      });
    }
  } catch (error48) {
    log67.warn(`v425: \u8D26\u6237${accountId} cleanupExpiredDaypartingBids\u5931\u8D25: ${error48.message}`);
  }
  return results;
}
var import_v82, log67, AUTO_CORRECTION_CONFIG, CURRENCY_TO_USD_RATE, INTERNAL_ACTION_TYPES, accountCurrencyCache, CURRENCY_CACHE_TTL_MS, lastScanTime, isScanning, scanHistory, latestHealthReport, correctionInterval, daypartingCleanupInterval, QUALITY_AUDIT_CONFIG;
var init_optimizationAutoCorrector = __esm({
  "server/optimization/optimizationAutoCorrector.ts"() {
    "use strict";
    init_db2();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_amazonApiHelper();
    init_budgetRulesCoordinator();
    init_keywordValidator();
    init_logger();
    init_auditLogService2();
    init_safeSql();
    import_v82 = __toESM(require("v8"));
    log67 = createModuleLogger("AutoCorrector");
    AUTO_CORRECTION_CONFIG = {
      // v199: 大幅提高每次纠错扫描的处理量，确保商用级数据完整性
      maxBidCorrectionsPerRun: 500,
      maxBudgetCorrectionsPerRun: 200,
      maxPlacementCorrectionsPerRun: 200,
      maxRetryPerRun: 2e3,
      maxRollbackPerRun: 200,
      // API同步失败重试的最大次数
      maxRetryAttempts: 3,
      // 认为优化事件“过期”的天数（超过此天数不再重试）
      retryExpiryDays: 7,
      // v328: 出价容差基准值（USD）— 从$0.01提升到$0.03
      // 根因：$0.01容差太小，导致AutoCorrector在803个关键词上与优化器形成“拉锯战”（最高23次/周），
      // 产生23.9%的无效操作。$0.03容差可以容纳正常的算法微调和四舍五入差异。
      bidToleranceBaseUSD: 0.03,
      // v204: 预算容差基准值（USD）— 实际容差会根据账户货币动态计算
      budgetToleranceBaseUSD: 2,
      // 位置倾斜不一致的容差范围（百分比）
      placementTolerancePercent: 1,
      // 两次纠错扫描之间的最小间隔（毫秒）
      minScanIntervalMs: 10 * 60 * 1e3,
      // 10分钟
      // 定时扫描间隔（小时）
      scanIntervalHours: 1
    };
    CURRENCY_TO_USD_RATE = {
      "USD": 1,
      // 美元
      "CAD": 1.37,
      // 加拿大元
      "GBP": 0.79,
      // 英鎊
      "EUR": 0.92,
      // 欧元
      "JPY": 150,
      // 日元
      "AUD": 1.55,
      // 澳元
      "MXN": 17.2,
      // 墨西哥比索
      "BRL": 4.95,
      // 巴西雷亚尔
      "INR": 83,
      // 印度卢比
      "SGD": 1.34,
      // 新加坡元
      "AED": 3.67,
      // 阿联酋迪拉姆
      "SAR": 3.75,
      // 沙特里亚尔
      "SEK": 10.5,
      // 瑞典克朗
      "PLN": 4.05,
      // 波兰兹罗提
      "EGP": 30.9,
      // 埃及鎊
      "TRY": 27
      // 土耳其里拉
    };
    INTERNAL_ACTION_TYPES = /* @__PURE__ */ new Set([
      "settings_update",
      // 系统设置变更（算法参数、策略配置等）
      "auto_correction",
      // 自动纠错记录本身
      "algorithm_config",
      // 算法配置变更
      "strategy_update",
      // 策略更新
      "system_config",
      // 系统配置
      "system_deploy",
      // 部署事件
      "target_reoptimized"
      // 重优化标记
    ]);
    __name(isInternalEvent, "isInternalEvent");
    accountCurrencyCache = /* @__PURE__ */ new Map();
    CURRENCY_CACHE_TTL_MS = 60 * 60 * 1e3;
    __name(getAccountCurrencyCode, "getAccountCurrencyCode");
    __name(getBidTolerance, "getBidTolerance");
    __name(getBudgetTolerance, "getBudgetTolerance");
    __name(getBidVerifyTolerance, "getBidVerifyTolerance");
    lastScanTime = null;
    isScanning = false;
    scanHistory = [];
    __name(runAutoCorrection, "runAutoCorrection");
    __name(fixNullApiSyncStatusRecords, "fixNullApiSyncStatusRecords");
    __name(retryFailedBidAdjustments, "retryFailedBidAdjustments");
    __name(correctBidMismatches, "correctBidMismatches");
    __name(retryFailedBudgetAdjustments, "retryFailedBudgetAdjustments");
    __name(correctBudgetMismatches, "correctBudgetMismatches");
    __name(correctPlacementMismatches, "correctPlacementMismatches");
    __name(executeUnfinishedRollbacks, "executeUnfinishedRollbacks");
    __name(retryFailedSettingsChanges, "retryFailedSettingsChanges");
    __name(retryFailedKeywordCreations, "retryFailedKeywordCreations");
    __name(retryFailedNegativeKeywordAdds, "retryFailedNegativeKeywordAdds");
    __name(getActiveAccountIds, "getActiveAccountIds");
    __name(logCorrectionEvent, "logCorrectionEvent");
    __name(createEmptyScanResult, "createEmptyScanResult");
    __name(buildScanResult, "buildScanResult");
    latestHealthReport = null;
    __name(evaluateSyncHealth, "evaluateSyncHealth");
    __name(getLatestHealthReport, "getLatestHealthReport");
    __name(getScanHistory, "getScanHistory");
    __name(getLastScanResult, "getLastScanResult");
    __name(getScanStatus, "getScanStatus");
    __name(getConfig2, "getConfig");
    __name(correctMaxBidViolations, "correctMaxBidViolations");
    __name(cleanupOrphanKeywords, "cleanupOrphanKeywords");
    __name(retryHistoricalFailedKeywordHarvests, "retryHistoricalFailedKeywordHarvests");
    __name(rescuePermanentlyFailedTasks, "rescuePermanentlyFailedTasks");
    correctionInterval = null;
    daypartingCleanupInterval = null;
    __name(backfillNegativeKeywordIds, "backfillNegativeKeywordIds");
    __name(verifyBiddingLogsExecution, "verifyBiddingLogsExecution");
    QUALITY_AUDIT_CONFIG = {
      maxAuditsPerRun: 100,
      bidDeviationThreshold: 0.15,
      // 15%偏差阈值
      maxSingleAdjustmentPercent: 0.20,
      // 单次最大调整20% (v608c: 统一±20%限制)
      lookbackDays: 7,
      // 审计最近7天的决策
      minDataForAudit: true
      // 要求有最低数据量
    };
    __name(auditAlgorithmDecisionQuality, "auditAlgorithmDecisionQuality");
    __name(startAutoCorrector, "startAutoCorrector");
    __name(stopAutoCorrector, "stopAutoCorrector");
    __name(runDaypartingCleanup, "runDaypartingCleanup");
    __name(retryFailedTargetStatusChanges, "retryFailedTargetStatusChanges");
    __name(retryFailedProductTargetCreations, "retryFailedProductTargetCreations");
    __name(revalidateStalePendingCommands, "revalidateStalePendingCommands");
    __name(cleanupExpiredDaypartingBids, "cleanupExpiredDaypartingBids");
  }
});

// node_modules/uuid/dist-node/stringify.js
function unsafeStringify(arr, offset = 0) {
  return (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
}
var byteToHex;
var init_stringify = __esm({
  "node_modules/uuid/dist-node/stringify.js"() {
    byteToHex = [];
    for (let i = 0; i < 256; ++i) {
      byteToHex.push((i + 256).toString(16).slice(1));
    }
    __name(unsafeStringify, "unsafeStringify");
  }
});

// node_modules/uuid/dist-node/rng.js
function rng() {
  if (poolPtr > rnds8Pool.length - 16) {
    (0, import_node_crypto.randomFillSync)(rnds8Pool);
    poolPtr = 0;
  }
  return rnds8Pool.slice(poolPtr, poolPtr += 16);
}
var import_node_crypto, rnds8Pool, poolPtr;
var init_rng = __esm({
  "node_modules/uuid/dist-node/rng.js"() {
    import_node_crypto = require("node:crypto");
    rnds8Pool = new Uint8Array(256);
    poolPtr = rnds8Pool.length;
    __name(rng, "rng");
  }
});

// node_modules/uuid/dist-node/native.js
var import_node_crypto2, native_default;
var init_native = __esm({
  "node_modules/uuid/dist-node/native.js"() {
    import_node_crypto2 = require("node:crypto");
    native_default = { randomUUID: import_node_crypto2.randomUUID };
  }
});

// node_modules/uuid/dist-node/v4.js
function _v4(options, buf, offset) {
  options = options || {};
  const rnds = options.random ?? options.rng?.() ?? rng();
  if (rnds.length < 16) {
    throw new Error("Random bytes length must be >= 16");
  }
  rnds[6] = rnds[6] & 15 | 64;
  rnds[8] = rnds[8] & 63 | 128;
  if (buf) {
    offset = offset || 0;
    if (offset < 0 || offset + 16 > buf.length) {
      throw new RangeError(`UUID byte range ${offset}:${offset + 15} is out of buffer bounds`);
    }
    for (let i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }
    return buf;
  }
  return unsafeStringify(rnds);
}
function v4(options, buf, offset) {
  if (native_default.randomUUID && !buf && !options) {
    return native_default.randomUUID();
  }
  return _v4(options, buf, offset);
}
var v4_default;
var init_v4 = __esm({
  "node_modules/uuid/dist-node/v4.js"() {
    init_native();
    init_rng();
    init_stringify();
    __name(_v4, "_v4");
    __name(v4, "v4");
    v4_default = v4;
  }
});

// node_modules/uuid/dist-node/index.js
var init_dist_node = __esm({
  "node_modules/uuid/dist-node/index.js"() {
    init_v4();
  }
});

