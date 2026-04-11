// Extracted from production dist/index.js
// Original module: server/services/dataCliffAutoRecoveryEngine.ts
// Lines: 731

var dataCliffAutoRecoveryEngine_exports = {};
__export(dataCliffAutoRecoveryEngine_exports, {
  CLIFF_RECOVERY_CONFIG: () => CLIFF_RECOVERY_CONFIG,
  isInCliffRecoveryLockdown: () => isInCliffRecoveryLockdown,
  scanAndRecoverDataCliffs: () => scanAndRecoverDataCliffs
});
async function scanAndRecoverDataCliffs(accountId) {
  const startTime = Date.now();
  const allCliffs = [];
  let totalScanned = 0;
  log62.info(`[DataCliffRecovery] ========== \u5F00\u59CB\u6570\u636E\u65AD\u5D16\u4E3B\u52A8\u626B\u63CF (accountId=${accountId}) ==========`);
  try {
    const keywordCliffs = await scanKeywordCliffs(accountId);
    allCliffs.push(...keywordCliffs.cliffs);
    totalScanned += keywordCliffs.scanned;
    const targetCliffs = await scanProductTargetCliffs(accountId);
    allCliffs.push(...targetCliffs.cliffs);
    totalScanned += targetCliffs.scanned;
    log62.info(`[DataCliffRecovery] \u51fa\u4ef7\u65ad\u5d16\u626b\u63cf\u5b8c\u6210: \u5171${totalScanned}\u4e2a\u6295\u653e\u8bcd, \u68c0\u6d4b\u5230${allCliffs.length}\u4e2a\u65ad\u5d16`);
    let repaired = 0;
    for (const cliff of allCliffs) {
      try {
        const success2 = await executeCliffRepair(cliff);
        if (success2) repaired++;
      } catch (repairErr) {
        log62.error(`[DataCliffRecovery] \u4fee\u590d\u5931\u8d25(${cliff.entityType}=${cliff.entityId}): ${repairErr.message}`);
      }
    }
    /* v608: \u589e\u52a0\u9884\u7b97\u65ad\u5d16\u68c0\u6d4b\u4e0e\u4fee\u590d */
    let budgetRepaired = 0;
    try {
      const budgetCliffs = await scanBudgetCliffs(accountId);
      log62.info(`[DataCliffRecovery] v608 \u9884\u7b97\u65ad\u5d16\u626b\u63cf: \u68c0\u6d4b\u5230${budgetCliffs.length}\u4e2a\u9884\u7b97\u5f02\u5e38`);
      for (const bc of budgetCliffs) {
        try {
          const success3 = await executeBudgetCliffRepair(bc);
          if (success3) budgetRepaired++;
        } catch (budgetErr) {
          log62.error(`[DataCliffRecovery] v608 \u9884\u7b97\u4fee\u590d\u5931\u8d25(campaign=${bc.campaignId}): ${budgetErr.message}`);
        }
      }
      if (budgetCliffs.length > 0) {
        logOptimizationWarn(`[DataCliffRecovery] v608 \u8d26\u6237${accountId}: \u68c0\u6d4b\u5230${budgetCliffs.length}\u4e2a\u9884\u7b97\u65ad\u5d16, \u5df2\u4fee\u590d${budgetRepaired}\u4e2a`);
      }
    } catch (budgetScanErr) {
      log62.warn(`[DataCliffRecovery] v608 \u9884\u7b97\u65ad\u5d16\u626b\u63cf\u5931\u8d25: ${budgetScanErr.message}`);
    }
    const duration3 = Date.now() - startTime;
    log62.info(`[DataCliffRecovery] ========== \u65AD\u5D16\u4FEE\u590D\u5B8C\u6210 (${duration3}ms) ==========`);
    log62.info(`[DataCliffRecovery] v608 \u6c47\u603b: \u626b\u63cf${totalScanned}\u4e2a\u6295\u653e\u8bcd, \u51fa\u4ef7\u65ad\u5d16${allCliffs.length}\u4e2a/\u4fee\u590d${repaired}\u4e2a, \u9884\u7b97\u65ad\u5d16\u4fee\u590d${budgetRepaired}\u4e2a`);
    if (allCliffs.length > 0) {
      logOptimizationWarn(`[DataCliffRecovery] \u8D26\u6237${accountId}: \u68C0\u6D4B\u5230${allCliffs.length}\u4E2A\u6570\u636E\u65AD\u5D16, \u5DF2\u4FEE\u590D${repaired}\u4E2A`);
    }
    return {
      accountId,
      scanTime: /* @__PURE__ */ new Date(),
      duration: duration3,
      totalScanned,
      cliffsDetected: allCliffs.length,
      cliffsRepaired: repaired,
      details: allCliffs
    };
  } catch (error48) {
    log62.error(`[DataCliffRecovery] \u626B\u63CF\u5F02\u5E38: ${error48.message}`);
    return {
      accountId,
      scanTime: /* @__PURE__ */ new Date(),
      duration: Date.now() - startTime,
      totalScanned,
      cliffsDetected: allCliffs.length,
      cliffsRepaired: 0,
      details: allCliffs
    };
  }
}
async function scanKeywordCliffs(accountId) {
  const cliffs = [];
  try {
    const db = await getDb();
    if (!db) return { scanned: 0, cliffs };
    const config2 = CLIFF_RECOVERY_CONFIG;
    const coreKeywords = await db.execute(sql`
      SELECT 
        k.id, k.keywordId, k.keywordText, k.matchType,
        k.bid as currentBid, k.keywordCpc as historicalCpc,
        k.orders as totalOrders, k.clicks as totalClicks,
        k.campaignId,
        c.campaignName,
        c.campaignType
      FROM keywords k
      JOIN campaigns c ON k.campaignId = c.campaignId AND k.accountId = c.accountId
      WHERE k.accountId = ${accountId}
        AND k.keywordStatus = 'enabled'
        AND k.bid IS NOT NULL
        AND k.orders >= ${config2.historicalOrderThreshold}
    `);
    const kwRows = Array.isArray(coreKeywords) ? Array.isArray(coreKeywords[0]) ? coreKeywords[0] : coreKeywords : [];
    const rows = kwRows;
    log62.info(`[DataCliffRecovery] \u5173\u952E\u8BCD\u626B\u63CF: ${rows.length}\u4E2A\u6838\u5FC3\u5173\u952E\u8BCD(\u5386\u53F2\u8BA2\u5355>=${config2.historicalOrderThreshold})`);
    for (const kw of rows) {
      try {
        const cliff = await detectCliffForEntity(
          db,
          accountId,
          "keyword",
          Number(kw.id),
          Number(kw.currentBid) || 0,
          Number(kw.historicalCpc) || 0,
          String(kw.keywordText || "") + " (" + String(kw.matchType || "") + ")",
          String(kw.campaignId || ""),
          String(kw.campaignName || ""),
          String(kw.campaignType || "sp")
        );
        if (cliff) cliffs.push(cliff);
      } catch (err) {
      }
    }
    return { scanned: rows.length, cliffs };
  } catch (error48) {
    log62.error(`[DataCliffRecovery] \u5173\u952E\u8BCD\u626B\u63CF\u5931\u8D25: ${error48.message}`);
    return { scanned: 0, cliffs };
  }
}
async function scanProductTargetCliffs(accountId) {
  const cliffs = [];
  try {
    const db = await getDb();
    if (!db) return { scanned: 0, cliffs };
    const config2 = CLIFF_RECOVERY_CONFIG;
    const coreTargets = await db.execute(sql`
      SELECT 
        pt.id, pt.targetId, pt.targetValue,
        pt.bid as currentBid, pt.targetCpc as historicalCpc,
        pt.orders as totalOrders, pt.clicks as totalClicks,
        pt.campaignId,
        c.campaignName,
        c.campaignType
      FROM product_targets pt
      JOIN campaigns c ON pt.campaignId = c.campaignId AND pt.accountId = c.accountId
      WHERE pt.accountId = ${accountId}
        AND pt.targetStatus = 'enabled'
        AND pt.bid IS NOT NULL
        AND pt.orders >= ${config2.historicalOrderThreshold}
    `);
    const ptRows = Array.isArray(coreTargets) ? Array.isArray(coreTargets[0]) ? coreTargets[0] : coreTargets : [];
    const rows = ptRows;
    log62.info(`[DataCliffRecovery] Product Target\u626B\u63CF: ${rows.length}\u4E2A\u6838\u5FC3Target(\u5386\u53F2\u8BA2\u5355>=${config2.historicalOrderThreshold})`);
    for (const pt of rows) {
      try {
        const cliff = await detectCliffForEntity(
          db,
          accountId,
          "product_target",
          Number(pt.id),
          Number(pt.currentBid) || 0,
          Number(pt.historicalCpc) || 0,
          String(pt.targetValue || ""),
          String(pt.campaignId || ""),
          String(pt.campaignName || ""),
          String(pt.campaignType || "sp")
        );
        if (cliff) cliffs.push(cliff);
      } catch (err) {
      }
    }
    return { scanned: rows.length, cliffs };
  } catch (error48) {
    log62.error(`[DataCliffRecovery] Product Target\u626B\u63CF\u5931\u8D25: ${error48.message}`);
    return { scanned: 0, cliffs };
  }
}
async function detectCliffForEntity(db, accountId, entityType, entityId, currentBid, historicalCpc, entityName, campaignId, campaignName, adType) {
  if (!db || currentBid <= 0) return null;
  const config2 = CLIFF_RECOVERY_CONFIG;
  /* v608d: 使用 target_performance_windows 表进行 keyword/target 级别的断崖检测，
     而不是 campaign 级别的 daily_performance 表 */
  const targetType = entityType === 'keyword' ? 'keyword' : 'product_target';
  const windowResult = await db.execute(sql`
    SELECT 
      timeWindow, orders, clicks, impressions, spend, cpc, dataPoints
    FROM target_performance_windows
    WHERE accountId = ${accountId}
      AND targetType = ${targetType}
      AND targetId = ${entityId}
      AND timeWindow IN ('last_7d', 'last_30d', 'last_60d', 'last_90d', 'd30_to_d60', 'd60_to_d90')
  `);
  const windowRows = Array.isArray(windowResult) ? Array.isArray(windowResult[0]) ? windowResult[0] : windowResult : [];
  const windowMap = {};
  for (const row of windowRows) {
    windowMap[row.timeWindow] = row;
  }
  /* 如果 target_performance_windows 没有数据，回退到 campaign 级别的 daily_performance */
  let baselineDailyOrders, recentDailyOrders, baselineDailyClicks, recentDailyClicks;
  let effectiveHistoricalCpc_local;
  let baselineDays, recentDays;
  if (windowMap['d60_to_d90'] || windowMap['d30_to_d60'] || windowMap['last_90d']) {
    /* 使用 target_performance_windows 表的预计算数据 */
    const baseline90 = windowMap['d60_to_d90'];
    const baseline60 = windowMap['d30_to_d60'];
    const recent7 = windowMap['last_7d'];
    const recent30 = windowMap['last_30d'];
    /* 基线：优先使用 d60_to_d90 (30天窗口)，回退到 d30_to_d60 */
    const baselineWindow = baseline90 || baseline60;
    const recentWindow = recent7;
    if (!baselineWindow || !recentWindow) {
      /* 没有足够的窗口数据，回退到 campaign 级别 */
      return await detectCliffForEntityFallback(db, accountId, entityType, entityId, currentBid, historicalCpc, entityName, campaignId, campaignName, adType);
    }
    const bDays = Math.max(Number(baselineWindow.dataPoints) || 30, 1);
    const rDays = Math.max(Number(recentWindow.dataPoints) || 7, 1);
    baselineDays = bDays;
    recentDays = rDays;
    baselineDailyOrders = (Number(baselineWindow.orders) || 0) / (bDays / (baseline90 ? 30 : 30));
    recentDailyOrders = (Number(recentWindow.orders) || 0) / (rDays / 7);
    baselineDailyClicks = (Number(baselineWindow.clicks) || 0) / (bDays / (baseline90 ? 30 : 30));
    recentDailyClicks = (Number(recentWindow.clicks) || 0) / (rDays / 7);
    /* 历史CPC：优先使用窗口表的CPC，回退到传入的historicalCpc */
    effectiveHistoricalCpc_local = Number(baselineWindow.cpc) || 0;
    if (effectiveHistoricalCpc_local <= 0) {
      const bSpend = Number(baselineWindow.spend) || 0;
      const bClicks = Number(baselineWindow.clicks) || 0;
      effectiveHistoricalCpc_local = bClicks > 0 ? bSpend / bClicks : historicalCpc;
    }
    /* 中期窗口对比 */
    if (baseline60) {
      const midOrders = (Number(baseline60.orders) || 0) / (Math.max(Number(baseline60.dataPoints) || 30, 1) / 30);
      const midClicks = (Number(baseline60.clicks) || 0) / (Math.max(Number(baseline60.dataPoints) || 30, 1) / 30);
      baselineDailyOrders = Math.max(baselineDailyOrders, midOrders);
      baselineDailyClicks = Math.max(baselineDailyClicks, midClicks);
      if (effectiveHistoricalCpc_local <= 0) {
        const mCpc = Number(baseline60.cpc) || 0;
        if (mCpc > 0) effectiveHistoricalCpc_local = mCpc;
      }
    }
    log62.info(`[DataCliffRecovery] v608d keyword级检测: ${entityType}="${entityName}" 基线日均订单=${baselineDailyOrders.toFixed(2)} 近期日均订单=${recentDailyOrders.toFixed(2)} 历史CPC=$${effectiveHistoricalCpc_local.toFixed(2)} 当前出价=$${currentBid.toFixed(2)}`);
  } else {
    /* 没有 target_performance_windows 数据，回退到 campaign 级别 */
    return await detectCliffForEntityFallback(db, accountId, entityType, entityId, currentBid, historicalCpc, entityName, campaignId, campaignName, adType);
  }
  /* 如果基线期日均订单很低，说明该词本身不是高绩效词，跳过 */
  if (baselineDailyOrders < 0.05) return null;
  const effectiveBaselineOrders = baselineDailyOrders;
  const effectiveBaselineClicks = baselineDailyClicks;
  if (effectiveBaselineOrders < 0.05) return null;
  const effectiveHistoricalCpc = effectiveHistoricalCpc_local > 0 ? effectiveHistoricalCpc_local : historicalCpc;
  const orderDropPercent = effectiveBaselineOrders > 0 ? (effectiveBaselineOrders - recentDailyOrders) / effectiveBaselineOrders * 100 : 0;
  const trafficDropPercent = effectiveBaselineClicks > 0 ? (effectiveBaselineClicks - recentDailyClicks) / effectiveBaselineClicks * 100 : 0;
  const bidGapPercent = effectiveHistoricalCpc > 0 ? (effectiveHistoricalCpc - currentBid) / effectiveHistoricalCpc * 100 : 0;
  const isTrafficCliff = trafficDropPercent >= config2.thresholds.trafficDropPercent;
  const isOrderCliff = orderDropPercent >= config2.thresholds.orderDropPercent;
  const isBidGap = bidGapPercent >= config2.thresholds.bidGapPercent;
  if (!(isTrafficCliff || isOrderCliff) || !isBidGap) return null;
  const severity = orderDropPercent >= 90 ? "critical" : orderDropPercent >= 80 ? "high" : "medium";
  /* v608: 断崖修复不受常规±20%限制，根据严重程度快速恢复到断崖前水平 */
  let targetRecoveryBid;
  let recoveryStep = 0;
  if (severity === "critical" || severity === "high") {
    /* 严重/高危断崖：直接恢复到历史CPC的90%，不做分步限制 */
    targetRecoveryBid = effectiveHistoricalCpc * config2.recovery.criticalRecoveryRatio;
    recoveryStep = 1;
    log62.warn(`[DataCliffRecovery] v608 严重断崖快速恢复: ${entityType}="${entityName}" severity=${severity}, 直接恢复到历史CPC×90%=$${targetRecoveryBid.toFixed(2)}`);
  } else {
    /* 中等断崖：分步恢复，但每步也不受±20%限制 */
    const stepCount = await getCurrentRecoveryStep(db, accountId, entityType, entityId);
    const stepIndex = Math.min(stepCount, config2.recovery.mediumRecoverySteps.length - 1);
    const targetRatio = config2.recovery.mediumRecoverySteps[stepIndex];
    targetRecoveryBid = effectiveHistoricalCpc * targetRatio;
    recoveryStep = stepCount + 1;
    log62.warn(`[DataCliffRecovery] v608 中等断崖分步恢复: ${entityType}="${entityName}" 步骤${recoveryStep}/${config2.recovery.mediumRecoverySteps.length}, 目标比例=${(targetRatio * 100).toFixed(0)}%`);
  }
  /* v608: 安全护栏：不超过绝对上限，不低于最小值 */
  targetRecoveryBid = Math.min(targetRecoveryBid, config2.recovery.maxAbsoluteRecoveryBid);
  targetRecoveryBid = Math.max(targetRecoveryBid, config2.recovery.minRecoveryBid);
  if (currentBid >= targetRecoveryBid) return null;
  const roundedRecoveryBid = Math.round(targetRecoveryBid * 100) / 100;
  log62.warn(`[DataCliffRecovery] v608 \u65AD\u5D16\u68C0\u6D4B: ${entityType}="${entityName}" \u8BA2\u5355\u2193${orderDropPercent.toFixed(0)}% \u6D41\u91CF\u2193${trafficDropPercent.toFixed(0)}% \u51FA\u4EF7\u5DEE\u8DDD${bidGapPercent.toFixed(0)}% | $${currentBid.toFixed(2)}\u2192$${roundedRecoveryBid.toFixed(2)} (severity=${severity}, \u5386\u53F2CPC=$${effectiveHistoricalCpc.toFixed(2)})`);
  return {
    entityType,
    entityId,
    entityName,
    accountId,
    campaignId,
    campaignName,
    adType,
    currentBid,
    historicalCpc: effectiveHistoricalCpc,
    baselineDailyOrders,
    recentDailyOrders,
    orderDropPercent,
    baselineDailyClicks,
    recentDailyClicks,
    trafficDropPercent,
    bidGapPercent,
    targetRecoveryBid,
    actualRecoveryBid: roundedRecoveryBid,
    recoveryStep,
    severity
  };
}
async function getCurrentRecoveryStep(db, accountId, entityType, entityId) {
  try {
    const entityColumn = entityType === "keyword" ? "keyword_id" : "target_id";
    const result = await db.execute(sql`
      SELECT COUNT(*) as recovery_count
      FROM optimization_events
      WHERE account_id = ${accountId}
        AND ${sql.raw(entityColumn)} = ${entityId}
        AND event_category = 'cliff_recovery'
        AND created_at >= DATE_SUB(NOW(), INTERVAL ${CLIFF_RECOVERY_CONFIG.lockdownDays} DAY)
    `);
    const rows = Array.isArray(result) ? Array.isArray(result[0]) ? result[0] : result : [];
    const row = rows[0];
    return Math.min(Number(row?.recovery_count) || 0, CLIFF_RECOVERY_CONFIG.recovery.mediumRecoverySteps.length - 1);
  } catch {
    return 0;
  }
}
/* v608d: Campaign级别的断崖检测回退函数 - 当 target_performance_windows 没有数据时使用 */
async function detectCliffForEntityFallback(db, accountId, entityType, entityId, currentBid, historicalCpc, entityName, campaignId, campaignName, adType) {
  const config2 = CLIFF_RECOVERY_CONFIG;
  log62.info(`[DataCliffRecovery] v608d 回退到campaign级检测: ${entityType}="${entityName}" campaignId=${campaignId}`);
  const baselineResult = await db.execute(sql`
    SELECT 
      COALESCE(SUM(orders), 0) as total_orders,
      COALESCE(SUM(clicks), 0) as total_clicks,
      COALESCE(SUM(impressions), 0) as total_impressions,
      COALESCE(SUM(spend), 0) as total_spend,
      COUNT(DISTINCT date) as data_days
    FROM daily_performance
    WHERE accountId = ${accountId}
      AND campaignId = ${campaignId}
      AND date >= DATE_SUB(CURDATE(), INTERVAL ${config2.windows.baseline.startDaysAgo} DAY)
      AND date <= DATE_SUB(CURDATE(), INTERVAL ${config2.windows.baseline.endDaysAgo} DAY)
  `);
  const recentResult = await db.execute(sql`
    SELECT 
      COALESCE(SUM(orders), 0) as total_orders,
      COALESCE(SUM(clicks), 0) as total_clicks,
      COALESCE(SUM(impressions), 0) as total_impressions,
      COALESCE(SUM(spend), 0) as total_spend,
      COUNT(DISTINCT date) as data_days
    FROM daily_performance
    WHERE accountId = ${accountId}
      AND campaignId = ${campaignId}
      AND date >= DATE_SUB(CURDATE(), INTERVAL ${config2.windows.recent.startDaysAgo} DAY)
  `);
  const baselineRows = Array.isArray(baselineResult) ? Array.isArray(baselineResult[0]) ? baselineResult[0] : baselineResult : [];
  const recentRows = Array.isArray(recentResult) ? Array.isArray(recentResult[0]) ? recentResult[0] : recentResult : [];
  const baseline = baselineRows[0];
  const recent = recentRows[0];
  if (!baseline || !recent) return null;
  const baselineDays = Math.max(Number(baseline.data_days) || 1, 1);
  const recentDays = Math.max(Number(recent.data_days) || 1, 1);
  if (baselineDays < 7) return null;
  const baselineDailyOrders = (Number(baseline.total_orders) || 0) / baselineDays;
  const recentDailyOrders = (Number(recent.total_orders) || 0) / recentDays;
  const baselineDailyClicks = (Number(baseline.total_clicks) || 0) / baselineDays;
  const recentDailyClicks = (Number(recent.total_clicks) || 0) / recentDays;
  if (baselineDailyOrders < 0.1) return null;
  const orderDropPercent = baselineDailyOrders > 0 ? (baselineDailyOrders - recentDailyOrders) / baselineDailyOrders * 100 : 0;
  const trafficDropPercent = baselineDailyClicks > 0 ? (baselineDailyClicks - recentDailyClicks) / baselineDailyClicks * 100 : 0;
  const baselineSpend = Number(baseline.total_spend) || 0;
  const baselineClicks = Number(baseline.total_clicks) || 0;
  const preciseHistoricalCpc = baselineClicks > 0 ? baselineSpend / baselineClicks : historicalCpc;
  const effectiveHistoricalCpc = preciseHistoricalCpc > 0 ? preciseHistoricalCpc : historicalCpc;
  const bidGapPercent = effectiveHistoricalCpc > 0 ? (effectiveHistoricalCpc - currentBid) / effectiveHistoricalCpc * 100 : 0;
  const isTrafficCliff = trafficDropPercent >= config2.thresholds.trafficDropPercent;
  const isOrderCliff = orderDropPercent >= config2.thresholds.orderDropPercent;
  const isBidGap = bidGapPercent >= config2.thresholds.bidGapPercent;
  if (!(isTrafficCliff || isOrderCliff) || !isBidGap) return null;
  const severity = orderDropPercent >= 90 ? 'critical' : orderDropPercent >= 80 ? 'high' : 'medium';
  let targetRecoveryBid;
  let recoveryStep = 0;
  if (severity === 'critical' || severity === 'high') {
    targetRecoveryBid = effectiveHistoricalCpc * config2.recovery.criticalRecoveryRatio;
    recoveryStep = 1;
  } else {
    const stepCount = await getCurrentRecoveryStep(db, accountId, entityType, entityId);
    const stepIndex = Math.min(stepCount, config2.recovery.mediumRecoverySteps.length - 1);
    targetRecoveryBid = effectiveHistoricalCpc * config2.recovery.mediumRecoverySteps[stepIndex];
    recoveryStep = stepCount + 1;
  }
  targetRecoveryBid = Math.min(targetRecoveryBid, config2.recovery.maxAbsoluteRecoveryBid);
  targetRecoveryBid = Math.max(targetRecoveryBid, config2.recovery.minRecoveryBid);
  if (currentBid >= targetRecoveryBid) return null;
  const roundedRecoveryBid = Math.round(targetRecoveryBid * 100) / 100;
  log62.warn(`[DataCliffRecovery] v608d campaign级回退检测: ${entityType}="${entityName}" 订单↓${orderDropPercent.toFixed(0)}% 流量↓${trafficDropPercent.toFixed(0)}% 出价差距${bidGapPercent.toFixed(0)}% | $${currentBid.toFixed(2)}→$${roundedRecoveryBid.toFixed(2)} (severity=${severity})`);
  return {
    entityType, entityId, entityName, accountId, campaignId, campaignName, adType, currentBid,
    historicalCpc: effectiveHistoricalCpc, baselineDailyOrders, recentDailyOrders, orderDropPercent,
    baselineDailyClicks, recentDailyClicks, trafficDropPercent, bidGapPercent,
    targetRecoveryBid, actualRecoveryBid: roundedRecoveryBid, recoveryStep, severity
  };
}
async function executeCliffRepair(cliff) {
  try {
    const db = await getDb();
    if (!db) return false;
    const tableName = cliff.entityType === "keyword" ? "keywords" : "product_targets";
    /* v608: 先调用Amazon API，成功后再更新本地DB，确保指令真正传递给亚马逊 */
    let apiSyncStatus = 'pending';
    try {
      const { syncBidAdjustmentsToAmazon: syncBidAdjustmentsToAmazon2 } = await Promise.resolve().then(() => (init_amazonApiHelper(), amazonApiHelper_exports));
      await syncBidAdjustmentsToAmazon2(cliff.accountId, [{
        keywordId: cliff.entityType === "keyword" ? cliff.entityId : void 0,
        targetId: cliff.entityType === "product_target" ? cliff.entityId : void 0,
        productTargetId: cliff.entityType === "product_target" ? cliff.entityId : void 0, // fix24-P3v2-1: 正确标记product_target
        isProductTarget: cliff.entityType === "product_target", // fix24-P3v2-1: 让syncBidAdjustmentsToAmazon正确分类
        newBid: cliff.actualRecoveryBid,
        reason: `[v608 DataCliffRecovery] ${cliff.severity}: $${cliff.currentBid}\u2192$${cliff.actualRecoveryBid} (\u5386\u53f2CPC=$${cliff.historicalCpc.toFixed(2)})`
      }]);
      apiSyncStatus = 'synced';
      log62.info(`[DataCliffRecovery] v608 API\u540c\u6b65\u6210\u529f: ${cliff.entityType}=${cliff.entityId}, $${cliff.currentBid.toFixed(2)}\u2192$${cliff.actualRecoveryBid.toFixed(2)}`);
    } catch (syncErr) {
      apiSyncStatus = 'failed';
      log62.error(`[DataCliffRecovery] v608 API\u540c\u6b65\u5931\u8d25(${cliff.entityType}=${cliff.entityId}): ${syncErr.message}`);
      /* API失败时仍然更新本地DB，但标记为failed，等待重试机制处理 */
    }
    /* 更新本地数据库 */
    await db.execute(sql`
      UPDATE ${sql.raw(tableName)}
      SET bid = ${String(cliff.actualRecoveryBid)}
      WHERE id = ${cliff.entityId} AND accountId = ${cliff.accountId}
    `);
    /* 记录优化事件 */
    await db.execute(sql`
      INSERT INTO optimization_events (
        account_id, event_category, action_type, status,
        ${sql.raw(cliff.entityType === "keyword" ? "keyword_id" : "target_id")},
        previous_bid, new_bid,
        action_detail, api_sync_status, created_at
      ) VALUES (
        ${cliff.accountId}, 'cliff_recovery', ${cliff.entityType + "_bid_restore"}, 'success',
        ${cliff.entityId},
        ${String(cliff.currentBid)}, ${String(cliff.actualRecoveryBid)},
        ${JSON.stringify({
      severity: cliff.severity,
      orderDropPercent: cliff.orderDropPercent,
      trafficDropPercent: cliff.trafficDropPercent,
      bidGapPercent: cliff.bidGapPercent,
      historicalCpc: cliff.historicalCpc,
      recoveryStep: cliff.recoveryStep,
      targetRecoveryBid: cliff.targetRecoveryBid,
      campaignName: cliff.campaignName,
      version: 'v608'
    })},
        ${apiSyncStatus},
        NOW()
      )
    `);
    recordAudit({
      // @ts-ignore
      action: `${cliff.entityType}.cliff_recovery`,
      accountId: cliff.accountId,
      entityType: cliff.entityType,
      // @ts-ignore
      entityId: cliff.entityId,
      // @ts-ignore
      entityName: cliff.entityName,
      // @ts-ignore
      previousValue: cliff.currentBid,
      // @ts-ignore
      newValue: cliff.actualRecoveryBid,
      reason: `[v608\u65ad\u5d16\u5feb\u901f\u4fee\u590d] ${cliff.severity} \u8ba2\u5355\u2193${cliff.orderDropPercent.toFixed(0)}% \u6d41\u91cf\u2193${cliff.trafficDropPercent.toFixed(0)}% | $${cliff.currentBid.toFixed(2)}\u2192$${cliff.actualRecoveryBid.toFixed(2)} (\u5386\u53f2CPC=$${cliff.historicalCpc.toFixed(2)}, API=${apiSyncStatus})`
    });
    logOptimization(`[DataCliffRecovery] v608 \u4fee\u590d${apiSyncStatus === 'synced' ? '\u6210\u529f' : '(API\u5f85\u91cd\u8bd5)'}: ${cliff.entityType}="${cliff.entityName}" $${cliff.currentBid.toFixed(2)}\u2192$${cliff.actualRecoveryBid.toFixed(2)} (${cliff.severity})`);
    return apiSyncStatus === 'synced';
  } catch (error48) {
    log62.error(`[DataCliffRecovery] v608 \u4fee\u590d\u6267\u884c\u5931\u8d25(${cliff.entityType}=${cliff.entityId}): ${error48.message}`);
    return false;
  }
}
/* v608: 预算断崖扫描 - 检测被错误压低的广告活动预算 */
async function scanBudgetCliffs(accountId) {
  const cliffs = [];
  try {
    const db = await getDb();
    if (!db) return cliffs;
    /* [P3v5] Check if budget_logs table exists before querying */
    try {
      const [tableCheck] = await db.execute(sql`SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'budget_logs'`);
      const tableExists = Array.isArray(tableCheck) ? (Number(tableCheck[0]?.cnt) > 0) : (Number(tableCheck?.cnt) > 0);
      if (!tableExists) {
        log62.info("[DataCliffRecovery] [P3v5] budget_logs table not found, skipping budget cliff scan for accountId=" + accountId);
        return cliffs;
      }
    } catch (checkErr) {
      log62.info("[DataCliffRecovery] [P3v5] Failed to check budget_logs table, skipping: " + String(checkErr.message || checkErr).slice(0, 100));
      return cliffs;
    }
    const config2 = CLIFF_RECOVERY_CONFIG.budgetCliff;
    /* 查找所有启用的广告活动，对比当前预算和历史平均预算 */
    const result = await db.execute(sql`
      SELECT 
        c.campaignId, c.campaignName, c.campaignType, c.accountId,
        CAST(c.dailyBudget AS DECIMAL(10,2)) as currentBudget,
        (
          SELECT AVG(CAST(bl.new_value AS DECIMAL(10,2)))
          FROM budget_logs bl
          WHERE bl.campaign_id = c.campaignId 
            AND bl.account_id = c.accountId
            AND bl.created_at >= DATE_SUB(NOW(), INTERVAL ${config2.baselineWindowDays} DAY)
            AND bl.created_at < DATE_SUB(NOW(), INTERVAL 14 DAY)
            AND CAST(bl.new_value AS DECIMAL(10,2)) > ${config2.minNormalBudget}
        ) as historicalAvgBudget,
        (
          SELECT MAX(CAST(bl2.new_value AS DECIMAL(10,2)))
          FROM budget_logs bl2
          WHERE bl2.campaign_id = c.campaignId 
            AND bl2.account_id = c.accountId
            AND bl2.created_at >= DATE_SUB(NOW(), INTERVAL ${config2.baselineWindowDays} DAY)
        ) as historicalMaxBudget
      FROM campaigns c
      WHERE c.accountId = ${accountId}
        AND c.campaignStatus = 'enabled'
        AND c.dailyBudget IS NOT NULL
        AND CAST(c.dailyBudget AS DECIMAL(10,2)) < ${config2.minNormalBudget}
    `);
    const rows = Array.isArray(result) ? Array.isArray(result[0]) ? result[0] : result : [];
    log62.info(`[DataCliffRecovery] v608 \u9884\u7b97\u626b\u63cf: ${rows.length}\u4e2a\u4f4e\u9884\u7b97\u5e7f\u544a\u6d3b\u52a8(<$${config2.minNormalBudget})`);
    for (const row of rows) {
      const currentBudget = Number(row.currentBudget) || 0;
      const historicalAvgBudget = Number(row.historicalAvgBudget) || 0;
      const historicalMaxBudget = Number(row.historicalMaxBudget) || 0;
      /* \u4f7f\u7528\u5386\u53f2\u5e73\u5747\u6216\u5386\u53f2\u6700\u5927\u503c\u4f5c\u4e3a\u53c2\u8003 */
      const referenceBudget = historicalAvgBudget > 0 ? historicalAvgBudget : historicalMaxBudget;
      if (referenceBudget <= 0) {
        /* \u6ca1\u6709\u5386\u53f2\u9884\u7b97\u8bb0\u5f55\uff0c\u4f46\u5f53\u524d\u9884\u7b97\u5f02\u5e38\u4f4e\uff0c\u8bbe\u7f6e\u4e3a\u6700\u4f4e\u6b63\u5e38\u503c */
        if (currentBudget < config2.minNormalBudget) {
          cliffs.push({
            campaignId: String(row.campaignId),
            campaignName: String(row.campaignName || ''),
            campaignType: String(row.campaignType || 'sp'),
            accountId,
            currentBudget,
            referenceBudget: config2.minNormalBudget,
            targetBudget: config2.minNormalBudget,
            budgetDropPercent: 100,
            severity: 'high'
          });
        }
        continue;
      }
      const budgetDropPercent = (referenceBudget - currentBudget) / referenceBudget * 100;
      if (budgetDropPercent >= config2.budgetDropPercent) {
        const targetBudget = Math.round(referenceBudget * config2.recoveryTargetRatio * 100) / 100;
        const severity = budgetDropPercent >= 80 ? 'critical' : budgetDropPercent >= 60 ? 'high' : 'medium';
        cliffs.push({
          campaignId: String(row.campaignId),
          campaignName: String(row.campaignName || ''),
          campaignType: String(row.campaignType || 'sp'),
          accountId,
          currentBudget,
          referenceBudget,
          targetBudget,
          budgetDropPercent,
          severity
        });
        log62.warn(`[DataCliffRecovery] v608 \u9884\u7b97\u65ad\u5d16: campaign="${row.campaignName}" \u5f53\u524d$${currentBudget}\u2192\u76ee\u6807$${targetBudget} (\u5386\u53f2\u5e73\u5747$${referenceBudget.toFixed(2)}, \u4e0b\u964d${budgetDropPercent.toFixed(0)}%)`);
      }
    }
    return cliffs;
  } catch (error48) {
    log62.error(`[DataCliffRecovery] v608 \u9884\u7b97\u65ad\u5d16\u626b\u63cf\u5931\u8d25: ${error48.message}`);
    return cliffs;
  }
}
/* v608: \u6267\u884c\u9884\u7b97\u65ad\u5d16\u4fee\u590d - \u76f4\u63a5\u6062\u590d\u5230\u5386\u53f2\u6c34\u5e73\uff0c\u4e0d\u53d7\u00b120%\u9650\u5236 */
async function executeBudgetCliffRepair(budgetCliff) {
  try {
    const db = await getDb();
    if (!db) return false;
    /* \u5148\u8c03\u7528Amazon API */
    let apiSyncStatus = 'pending';
    try {
      const { syncBudgetAdjustmentToAmazon: syncBudgetAdjustmentToAmazon2 } = await Promise.resolve().then(() => (init_amazonApiHelper(), amazonApiHelper_exports));
      await syncBudgetAdjustmentToAmazon2(
        budgetCliff.accountId,
        budgetCliff.campaignId,
        budgetCliff.targetBudget,
        `[v608 BudgetCliffRecovery] ${budgetCliff.severity}: $${budgetCliff.currentBudget}\u2192$${budgetCliff.targetBudget}`,
        budgetCliff.campaignType
      );
      apiSyncStatus = 'synced';
      log62.info(`[DataCliffRecovery] v608 \u9884\u7b97API\u540c\u6b65\u6210\u529f: campaign=${budgetCliff.campaignId}, $${budgetCliff.currentBudget}\u2192$${budgetCliff.targetBudget}`);
    } catch (syncErr) {
      apiSyncStatus = 'failed';
      log62.error(`[DataCliffRecovery] v608 \u9884\u7b97API\u540c\u6b65\u5931\u8d25(campaign=${budgetCliff.campaignId}): ${syncErr.message}`);
    }
    /* \u66f4\u65b0\u672c\u5730DB */
    await db.execute(sql`
      UPDATE campaigns
      SET dailyBudget = ${String(budgetCliff.targetBudget)}
      WHERE campaignId = ${budgetCliff.campaignId} AND accountId = ${budgetCliff.accountId}
    `);
    /* \u8bb0\u5f55\u4f18\u5316\u4e8b\u4ef6 */
    await db.execute(sql`
      INSERT INTO optimization_events (
        account_id, event_category, action_type, status,
        campaign_id, previous_bid, new_bid,
        action_detail, api_sync_status, created_at
      ) VALUES (
        ${budgetCliff.accountId}, 'budget_cliff_recovery', 'campaign_budget_restore', 'success',
        ${budgetCliff.campaignId},
        ${String(budgetCliff.currentBudget)}, ${String(budgetCliff.targetBudget)},
        ${JSON.stringify({
      severity: budgetCliff.severity,
      budgetDropPercent: budgetCliff.budgetDropPercent,
      referenceBudget: budgetCliff.referenceBudget,
      campaignName: budgetCliff.campaignName,
      version: 'v608'
    })},
        ${apiSyncStatus},
        NOW()
      )
    `);
    recordAudit({
      action: 'campaign.budget_cliff_recovery',
      accountId: budgetCliff.accountId,
      entityType: 'campaign',
      entityId: budgetCliff.campaignId,
      entityName: budgetCliff.campaignName,
      previousValue: budgetCliff.currentBudget,
      newValue: budgetCliff.targetBudget,
      reason: `[v608\u9884\u7b97\u65ad\u5d16\u5feb\u901f\u4fee\u590d] ${budgetCliff.severity} \u9884\u7b97\u2193${budgetCliff.budgetDropPercent.toFixed(0)}% | $${budgetCliff.currentBudget}\u2192$${budgetCliff.targetBudget} (\u5386\u53f2\u53c2\u8003=$${budgetCliff.referenceBudget.toFixed(2)}, API=${apiSyncStatus})`
    });
    logOptimization(`[DataCliffRecovery] v608 \u9884\u7b97\u4fee\u590d${apiSyncStatus === 'synced' ? '\u6210\u529f' : '(API\u5f85\u91cd\u8bd5)'}: campaign="${budgetCliff.campaignName}" $${budgetCliff.currentBudget}\u2192$${budgetCliff.targetBudget} (${budgetCliff.severity})`);
    return apiSyncStatus === 'synced';
  } catch (error48) {
    log62.error(`[DataCliffRecovery] v608 \u9884\u7b97\u4fee\u590d\u5931\u8d25(campaign=${budgetCliff.campaignId}): ${error48.message}`);
    return false;
  }
}
async function isInCliffRecoveryLockdown(accountId, entityType, entityId) {
  try {
    const db = await getDb();
    if (!db) return { locked: false, reason: "" };
    const entityColumn = entityType === "keyword" ? "keyword_id" : "target_id";
    const result = await db.execute(sql`
      SELECT COUNT(*) as recovery_count, MAX(created_at) as last_recovery
      FROM optimization_events
      WHERE account_id = ${accountId}
        AND ${sql.raw(entityColumn)} = ${entityId}
        AND event_category = 'cliff_recovery'
        AND created_at >= DATE_SUB(NOW(), INTERVAL ${CLIFF_RECOVERY_CONFIG.lockdownDays} DAY)
    `);
    const rows = Array.isArray(result) ? Array.isArray(result[0]) ? result[0] : result : [];
    const row = rows[0];
    const recoveryCount = Number(row?.recovery_count) || 0;
    if (recoveryCount > 0) {
      const lastRecovery = row?.last_recovery ? new Date(String(row.last_recovery)) : /* @__PURE__ */ new Date();
      const hoursAgo = ((Date.now() - lastRecovery.getTime()) / 36e5).toFixed(1);
      return {
        locked: true,
        reason: `[v510\u65AD\u5D16\u4FEE\u590D\u9501\u5B9A] ${recoveryCount}\u6B21\u4FEE\u590D\u4E2D(\u6700\u8FD1${hoursAgo}h\u524D), \u9501\u5B9A${CLIFF_RECOVERY_CONFIG.lockdownDays}\u5929\u5185\u6682\u505C\u964D\u4EF7`
      };
    }
    return { locked: false, reason: "" };
  } catch {
    return { locked: false, reason: "" };
  }
}
var log62, CLIFF_RECOVERY_CONFIG;
var init_dataCliffAutoRecoveryEngine = __esm({
  "server/services/dataCliffAutoRecoveryEngine.ts"() {
    "use strict";
    init_db2();
    init_drizzle_orm();
    init_logger();
    init_opsLogger();
    init_auditLogService2();
    log62 = createModuleLogger("DataCliffRecovery");
    CLIFF_RECOVERY_CONFIG = {
      /** 历史订单数门槛：超过此值的投放词触发断崖检测 */
      historicalOrderThreshold: 4,
      /** 多窗口对比配置 */
      windows: {
        /** 远期窗口：30-95天前的数据作为历史基线 */
        baseline: { startDaysAgo: 95, endDaysAgo: 30 },
        /** 近期窗口：最近7天的数据 */
        recent: { startDaysAgo: 7, endDaysAgo: 0 }
      },
      /** 断崖触发阈值 */
      thresholds: {
        /** 流量下降幅度（%）：近期日均曝光/点击较历史基线下降超过此值 */
        trafficDropPercent: 70,
        /** 订单下降幅度（%）：近期日均订单较历史基线下降超过此值 */
        orderDropPercent: 70,
        /** 出价差距阈值（%）：当前出价比历史CPC低于此比例才触发修复 */
        bidGapPercent: 20
      },
      /** v608: 断崖修复不受常规±20%限制，根据严重程度快速恢复到断崖前水平 */
      recovery: {
        /** 严重断崖(critical/high)：直接恢复到历史CPC的90% */
        criticalRecoveryRatio: 0.90,
        /** 中等断崖(medium)：分步恢复 */
        mediumRecoverySteps: [0.85, 1.0],
        /** 中等断崖每步间隔（小时） */
        mediumStepIntervalHours: 48,
        /** 单次恢复的绝对上限（美元）：防止异常数据导致极端提价 */
        maxAbsoluteRecoveryBid: 15.0,
        /** 最小恢复出价（美元）：确保恢复后的出价不低于此值 */
        minRecoveryBid: 0.15
      },
      /** 修复期锁定：断崖修复期间暂停常规降价优化的天数 */
      lockdownDays: 7,
      /** v608: 预算断崖检测配置 */
      budgetCliff: {
        /** 预算下降阈值（%）：当前预算比历史平均预算低于此比例触发修复 */
        budgetDropPercent: 50,
        /** 历史预算参考窗口（天） */
        baselineWindowDays: 60,
        /** 最低预算阈值（美元）：低于此值的预算视为异常 */
        minNormalBudget: 10,
        /** 恢复目标：历史平均预算的比例 */
        recoveryTargetRatio: 0.90
      }
    };
    __name(scanAndRecoverDataCliffs, "scanAndRecoverDataCliffs");
    __name(scanKeywordCliffs, "scanKeywordCliffs");
    __name(scanProductTargetCliffs, "scanProductTargetCliffs");
    __name(detectCliffForEntity, "detectCliffForEntity");
    __name(detectCliffForEntityFallback, "detectCliffForEntityFallback");
    __name(getCurrentRecoveryStep, "getCurrentRecoveryStep");
    __name(executeCliffRepair, "executeCliffRepair");
    __name(scanBudgetCliffs, "scanBudgetCliffs");
    __name(executeBudgetCliffRepair, "executeBudgetCliffRepair");
    __name(isInCliffRecoveryLockdown, "isInCliffRecoveryLockdown");
  }
});

