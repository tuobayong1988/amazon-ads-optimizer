// Extracted from production dist/index.js
// Original module: server/algorithm/rlDataRecorder.ts
// Lines: 773

var rlDataRecorder_exports = {};
__export(rlDataRecorder_exports, {
  backfillBidPerformanceResults: () => backfillBidPerformanceResults,
  backfillRewards: () => backfillRewards,
  batchRecordBidPerformanceHistory: () => batchRecordBidPerformanceHistory,
  getTrainingDataset: () => getTrainingDataset,
  recordBidAction: () => recordBidAction,
  recordBidPerformanceHistory: () => recordBidPerformanceHistory
});
async function getDbInstance2() {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  return db;
}
function classifyAction(bidBefore, bidAfter) {
  if (bidAfter === 0) return "pause";
  if (bidBefore === 0 && bidAfter > 0) return "resume";
  const delta = bidAfter - bidBefore;
  const threshold = bidBefore * 5e-3;
  if (Math.abs(delta) <= threshold) return "bid_hold";
  return delta > 0 ? "bid_increase" : "bid_decrease";
}
async function getOrCreateEpisodeId(db, accountId, keywordId, targetId) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  let lastLog;
  if (keywordId) {
    const results = await db.select({
      episodeId: rlTrainingLogs.episodeId,
      stepIndex: rlTrainingLogs.stepIndex,
      createdAt: rlTrainingLogs.createdAt
    }).from(rlTrainingLogs).where(and(
      eq(rlTrainingLogs.accountId, accountId),
      eq(rlTrainingLogs.keywordId, keywordId),
      gte(rlTrainingLogs.createdAt, sevenDaysAgo)
    )).orderBy(sql`created_at DESC`).limit(1);
    lastLog = results[0];
  } else if (targetId) {
    const results = await db.select({
      episodeId: rlTrainingLogs.episodeId,
      stepIndex: rlTrainingLogs.stepIndex,
      createdAt: rlTrainingLogs.createdAt
    }).from(rlTrainingLogs).where(and(
      eq(rlTrainingLogs.accountId, accountId),
      eq(rlTrainingLogs.targetId, targetId),
      gte(rlTrainingLogs.createdAt, sevenDaysAgo)
    )).orderBy(sql`created_at DESC`).limit(1);
    lastLog = results[0];
  }
  if (lastLog && lastLog.episodeId) {
    return {
      episodeId: lastLog.episodeId,
      stepIndex: (lastLog.stepIndex || 0) + 1
    };
  }
  return {
    episodeId: `ep_${uuidv4().substring(0, 12)}`,
    stepIndex: 0
  };
}
async function recordBidAction(action) {
  if (!action.accountId) {
    rlLog.warn(`[RLDataRecorder] v231: recordBidAction skipped - missing accountId`);
    return;
  }
  if (!action.keywordId && !action.targetId) {
    rlLog.warn(`[RLDataRecorder] v231: recordBidAction skipped - missing both keywordId and targetId`);
    return;
  }
  if (action.bidAfter == null || !isFinite(action.bidAfter)) {
    rlLog.warn(`[RLDataRecorder] v231: recordBidAction skipped - invalid bidAfter: ${action.bidAfter}`);
    return;
  }
  const db = await getDbInstance2();
  try {
    const state = await captureStateSnapshot(
      db,
      action.accountId,
      action.keywordId,
      action.targetId,
      action.campaignId
    );
    let contextFeatures;
    try {
      contextFeatures = await extractFeatureVector(
        action.accountId,
        action.keywordId,
        action.targetId,
        action.campaignId
      );
    } catch (e) {
    }
    const { episodeId, stepIndex } = await getOrCreateEpisodeId(
      db,
      action.accountId,
      action.keywordId,
      action.targetId
    );
    await db.insert(rlTrainingLogs).values({
      accountId: action.accountId,
      keywordId: action.keywordId || null,
      targetId: action.targetId || null,
      campaignId: action.campaignId || null,
      adGroupId: action.adGroupId || null,
      // v526: 修复列名映射，与schema一致
      episodeId,
      stepIndex,
      // State
      stateBid: String(state.bid),
      stateImpressions: state.impressions,
      stateClicks: state.clicks,
      stateOrders: state.orders,
      stateSpend: String(state.spend),
      stateSales: String(state.sales),
      stateAcos: String(state.acos),
      stateCvr: String(state.cvr),
      stateCpc: String(state.cpc),
      stateCompetition: String(state.competition),
      stateContext: contextFeatures ? JSON.stringify(contextFeatures) : null,
      // Action
      actionType: classifyAction(action.bidBefore, action.bidAfter),
      actionBidBefore: String(action.bidBefore),
      actionBidAfter: String(action.bidAfter),
      actionBidDelta: String(action.bidAfter - action.bidBefore),
      actionSource: action.actionSource
    });
  } catch (error48) {
    rlLog.warn(`[RLDataRecorder] v474: Failed to record bid action: accountId=${action.accountId}, keywordId=${action.keywordId}, targetId=${action.targetId}, source=${action.actionSource}, error=${error48.message}`);
  }
}
async function captureStateSnapshot(db, accountId, keywordId, targetId, campaignId) {
  let currentBid = 0;
  let impressions = 0;
  let clicks = 0;
  let orders = 0;
  let spend = 0;
  let sales = 0;
  let dataSource = "none";
  if (keywordId) {
    const kwResults = await db.select({
      bid: keywords.bid,
      impressions: keywords.impressions,
      clicks: keywords.clicks,
      orders: keywords.orders,
      spend: keywords.spend,
      sales: keywords.sales
    }).from(keywords).where(eq(keywords.id, keywordId)).limit(1);
    if (kwResults[0]) {
      currentBid = Number(kwResults[0].bid) || 0;
      impressions = Number(kwResults[0].impressions) || 0;
      clicks = Number(kwResults[0].clicks) || 0;
      orders = Number(kwResults[0].orders) || 0;
      spend = Number(kwResults[0].spend) || 0;
      sales = Number(kwResults[0].sales) || 0;
      dataSource = "keyword_entity";
    }
  } else if (targetId) {
    const tgtResults = await db.select({
      bid: productTargets.bid,
      impressions: productTargets.impressions,
      clicks: productTargets.clicks,
      orders: productTargets.orders,
      spend: productTargets.spend,
      sales: productTargets.sales
    }).from(productTargets).where(eq(productTargets.id, targetId)).limit(1);
    if (tgtResults[0]) {
      currentBid = Number(tgtResults[0].bid) || 0;
      impressions = Number(tgtResults[0].impressions) || 0;
      clicks = Number(tgtResults[0].clicks) || 0;
      orders = Number(tgtResults[0].orders) || 0;
      spend = Number(tgtResults[0].spend) || 0;
      sales = Number(tgtResults[0].sales) || 0;
      dataSource = "product_target_entity";
    }
  }
  if (dataSource === "none" && campaignId) {
    const days7Ago = new Date(Date.now() - 7 * 864e5).toISOString().split("T")[0];
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const perfResults = await db.select({
      totalImpressions: sql`SUM(impressions)`,
      totalClicks: sql`SUM(clicks)`,
      totalOrders: sql`SUM(orders)`,
      totalSpend: sql`SUM(CAST(spend AS DECIMAL(10,2)))`,
      totalSales: sql`SUM(CAST(sales AS DECIMAL(10,2)))`
    }).from(dailyPerformance).where(and(
      eq(dailyPerformance.accountId, accountId),
      eq(dailyPerformance.campaignId, campaignId),
      gte(dailyPerformance.date, days7Ago),
      lte(dailyPerformance.date, today)
    ));
    const perf = perfResults[0] || {};
    impressions = Number(perf.totalImpressions) || 0;
    clicks = Number(perf.totalClicks) || 0;
    orders = Number(perf.totalOrders) || 0;
    spend = Number(perf.totalSpend) || 0;
    sales = Number(perf.totalSales) || 0;
    dataSource = "campaign_daily";
    if (currentBid === 0) {
      if (keywordId) {
        const kw = await db.select({ bid: keywords.bid }).from(keywords).where(eq(keywords.id, keywordId)).limit(1);
        currentBid = kw[0] ? Number(kw[0].bid) : 0;
      } else if (targetId) {
        const tgt = await db.select({ bid: productTargets.bid }).from(productTargets).where(eq(productTargets.id, targetId)).limit(1);
        currentBid = tgt[0] ? Number(tgt[0].bid) : 0;
      }
    }
  }
  if (dataSource === "none") {
    const days7Ago = new Date(Date.now() - 7 * 864e5).toISOString().split("T")[0];
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const perfResults = await db.select({
      totalImpressions: sql`SUM(impressions)`,
      totalClicks: sql`SUM(clicks)`,
      totalOrders: sql`SUM(orders)`,
      totalSpend: sql`SUM(CAST(spend AS DECIMAL(10,2)))`,
      totalSales: sql`SUM(CAST(sales AS DECIMAL(10,2)))`
    }).from(dailyPerformance).where(and(
      eq(dailyPerformance.accountId, accountId),
      gte(dailyPerformance.date, days7Ago),
      lte(dailyPerformance.date, today)
    ));
    const perf = perfResults[0] || {};
    impressions = Number(perf.totalImpressions) || 0;
    clicks = Number(perf.totalClicks) || 0;
    orders = Number(perf.totalOrders) || 0;
    spend = Number(perf.totalSpend) || 0;
    sales = Number(perf.totalSales) || 0;
    dataSource = "account_fallback";
    rlLog.warn(`[captureStateSnapshot] v252: \u4F7F\u7528\u8D26\u6237\u7EA7\u522B\u56DE\u9000\u6570\u636E accountId=${accountId}, keywordId=${keywordId}, targetId=${targetId} (\u65E0campaignId)`);
  }
  return {
    bid: currentBid,
    impressions,
    clicks,
    orders,
    spend,
    sales,
    acos: sales > 0 ? spend / sales : 0,
    cvr: clicks > 0 ? orders / clicks : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    competition: 0
    // 将由上下文特征填充
  };
}
async function backfillRewards(accountId) {
  const db = await getDbInstance2();
  let filledCount = 0;
  let skippedNoData = 0;
  let immediateFilledCount = 0;
  let retriedFromZero = 0;
  let channelCSuccess = 0;
  try {
    const hoursAgo168 = new Date(Date.now() - 168 * 36e5).toISOString();
    const zeroFilledLogs = await db.select({
      id: rlTrainingLogs.id,
      keywordId: rlTrainingLogs.keywordId,
      targetId: rlTrainingLogs.targetId,
      campaignId: rlTrainingLogs.campaignId,
      accountId: rlTrainingLogs.accountId,
      actionBidAfter: rlTrainingLogs.actionBidAfter,
      actionBidBefore: rlTrainingLogs.actionBidBefore,
      createdAt: rlTrainingLogs.createdAt
    }).from(rlTrainingLogs).where(and(
      eq(rlTrainingLogs.accountId, accountId),
      sql`reward = '0'`,
      sql`reward_impressions = 0`,
      sql`reward_clicks = 0`,
      gte(rlTrainingLogs.createdAt, hoursAgo168)
    )).limit(200);
    for (const zLog of zeroFilledLogs) {
      try {
        let hasRealData = false;
        let ri = 0, rc = 0, ro = 0, rsp = 0, rsa = 0;
        if (zLog.keywordId) {
          const kwPerf = await db.select({
            impressions: keywords.impressions,
            clicks: keywords.clicks,
            orders: keywords.orders,
            spend: keywords.spend,
            sales: keywords.sales
          }).from(keywords).where(eq(keywords.id, zLog.keywordId)).limit(1);
          if (kwPerf[0] && (Number(kwPerf[0].impressions) > 0 || Number(kwPerf[0].clicks) > 0)) {
            ri = Number(kwPerf[0].impressions) || 0;
            rc = Number(kwPerf[0].clicks) || 0;
            ro = Number(kwPerf[0].orders) || 0;
            rsp = Number(kwPerf[0].spend) || 0;
            rsa = Number(kwPerf[0].sales) || 0;
            hasRealData = true;
          }
        } else if (zLog.targetId) {
          const tgtPerf = await db.select({
            impressions: productTargets.impressions,
            clicks: productTargets.clicks,
            orders: productTargets.orders,
            spend: productTargets.spend,
            sales: productTargets.sales
          }).from(productTargets).where(eq(productTargets.id, zLog.targetId)).limit(1);
          if (tgtPerf[0] && (Number(tgtPerf[0].impressions) > 0 || Number(tgtPerf[0].clicks) > 0)) {
            ri = Number(tgtPerf[0].impressions) || 0;
            rc = Number(tgtPerf[0].clicks) || 0;
            ro = Number(tgtPerf[0].orders) || 0;
            rsp = Number(tgtPerf[0].spend) || 0;
            rsa = Number(tgtPerf[0].sales) || 0;
            hasRealData = true;
          }
        }
        if (hasRealData) {
          const profit = rsa - rsp;
          const reward = rsp > 0 ? profit / rsp : profit;
          await db.update(rlTrainingLogs).set({
            reward: String(reward),
            rewardImpressions: ri,
            rewardClicks: rc,
            rewardOrders: ro,
            rewardSpend: String(rsp),
            rewardSales: String(rsa),
            rewardProfit: String(profit),
            rewardFilledAt: (/* @__PURE__ */ new Date()).toISOString()
          }).where(eq(rlTrainingLogs.id, zLog.id));
          retriedFromZero++;
        }
      } catch (retryErr) {
      }
    }
    if (retriedFromZero > 0) {
      rlLog.info(`[backfillRewards] \u8D26\u6237${accountId}: v259\u96F6\u6570\u636E\u91CD\u8BD5\u6210\u529F ${retriedFromZero}/${zeroFilledLogs.length}\u6761`);
    }
    rlLog.info(`[backfillRewards] \u8D26\u6237${accountId}: \u67E5\u627E168h\u5185\u672A\u56DE\u586B\u7684RL\u65E5\u5FD7\uFF08v259\u589E\u5F3A\u4E09\u901A\u9053+\u91CD\u8BD5\uFF09...`);
    const pendingLogs = await db.select({
      id: rlTrainingLogs.id,
      accountId: rlTrainingLogs.accountId,
      keywordId: rlTrainingLogs.keywordId,
      targetId: rlTrainingLogs.targetId,
      campaignId: rlTrainingLogs.campaignId,
      actionBidAfter: rlTrainingLogs.actionBidAfter,
      actionBidBefore: rlTrainingLogs.actionBidBefore,
      createdAt: rlTrainingLogs.createdAt
    }).from(rlTrainingLogs).where(and(
      eq(rlTrainingLogs.accountId, accountId),
      isNull(rlTrainingLogs.rewardFilledAt),
      gte(rlTrainingLogs.createdAt, hoursAgo168)
    ));
    rlLog.info(`[backfillRewards] \u8D26\u6237${accountId}: \u627E\u5230${pendingLogs.length}\u6761\u5F85\u56DE\u586B\u8BB0\u5F55`);
    for (const log216 of pendingLogs) {
      try {
        const logDate = new Date(log216.createdAt);
        const logAgeHours = (Date.now() - logDate.getTime()) / 36e5;
        const nextDay = new Date(logDate.getTime() + 864e5).toISOString().split("T")[0];
        const twoDaysLater = new Date(logDate.getTime() + 2 * 864e5).toISOString().split("T")[0];
        let rewardImpressions = 0;
        let rewardClicks = 0;
        let rewardOrders = 0;
        let rewardSpend = 0;
        let rewardSales = 0;
        let dataSource = "none";
        let usedImmediateChannel = false;
        if (log216.keywordId || log216.targetId) {
          const adjustDate = logDate.toISOString().split("T")[0];
          const beforeDate = new Date(logDate.getTime() - 864e5).toISOString().split("T")[0];
          const afterDate1 = new Date(logDate.getTime() + 864e5).toISOString().split("T")[0];
          const afterDate2 = new Date(logDate.getTime() + 2 * 864e5).toISOString().split("T")[0];
          if (logAgeHours >= 48) {
            const beforePerf = await db.select({
              totalImpressions: sql`SUM(impressions)`,
              totalClicks: sql`SUM(clicks)`,
              totalOrders: sql`SUM(orders)`,
              totalSpend: sql`SUM(CAST(spend AS DECIMAL(10,2)))`,
              totalSales: sql`SUM(CAST(sales AS DECIMAL(10,2)))`
              // @ts-ignore
            }).from(dailyPerformance).where(and(
              // @ts-ignore
              eq(dailyPerformance.accountId, log216.accountId),
              // @ts-ignore
              log216.campaignId ? eq(dailyPerformance.campaignId, log216.campaignId) : sql`1=1`,
              eq(dailyPerformance.date, beforeDate)
            ));
            const afterPerf = await db.select({
              totalImpressions: sql`SUM(impressions)`,
              totalClicks: sql`SUM(clicks)`,
              totalOrders: sql`SUM(orders)`,
              // @ts-ignore
              totalSpend: sql`SUM(CAST(spend AS DECIMAL(10,2)))`,
              // @ts-ignore
              totalSales: sql`SUM(CAST(sales AS DECIMAL(10,2)))`
            }).from(dailyPerformance).where(and(
              // @ts-ignore
              eq(dailyPerformance.accountId, log216.accountId),
              // @ts-ignore
              log216.campaignId ? eq(dailyPerformance.campaignId, log216.campaignId) : sql`1=1`,
              gte(dailyPerformance.date, afterDate1),
              lte(dailyPerformance.date, afterDate2)
            ));
            const bPerf = beforePerf[0] || {};
            const aPerf = afterPerf[0] || {};
            const bImpressions = Number(bPerf.totalImpressions) || 0;
            const aImpressions = Number(aPerf.totalImpressions) || 0;
            if (bImpressions > 0 || aImpressions > 0) {
              const afterDays = 2;
              rewardImpressions = Math.round((Number(aPerf.totalImpressions) || 0) / afterDays);
              rewardClicks = Math.round((Number(aPerf.totalClicks) || 0) / afterDays);
              rewardOrders = Math.round((Number(aPerf.totalOrders) || 0) / afterDays);
              rewardSpend = (Number(aPerf.totalSpend) || 0) / afterDays;
              rewardSales = (Number(aPerf.totalSales) || 0) / afterDays;
              dataSource = "daily_performance_incremental";
              usedImmediateChannel = true;
            }
          }
          if (dataSource === "none") {
            if (log216.keywordId) {
              const kwPerf = await db.select({
                impressions: keywords.impressions,
                clicks: keywords.clicks,
                orders: keywords.orders,
                spend: keywords.spend,
                sales: keywords.sales
                // @ts-ignore
              }).from(keywords).where(eq(keywords.id, log216.keywordId)).limit(1);
              if (kwPerf[0]) {
                const ci = Number(kwPerf[0].impressions) || 0;
                const cc = Number(kwPerf[0].clicks) || 0;
                if (logAgeHours >= 24 && (ci > 0 || cc > 0)) {
                  rewardImpressions = ci;
                  rewardClicks = cc;
                  rewardOrders = Number(kwPerf[0].orders) || 0;
                  rewardSpend = Number(kwPerf[0].spend) || 0;
                  rewardSales = Number(kwPerf[0].sales) || 0;
                  dataSource = "keyword_post_attribution";
                  usedImmediateChannel = true;
                } else if (ci > 0 || cc > 0) {
                  rewardImpressions = ci;
                  rewardClicks = cc;
                  rewardOrders = Number(kwPerf[0].orders) || 0;
                  rewardSpend = Number(kwPerf[0].spend) || 0;
                  rewardSales = Number(kwPerf[0].sales) || 0;
                  dataSource = "keyword_pre_attribution";
                  usedImmediateChannel = true;
                }
              }
            } else if (log216.targetId) {
              const tgtPerf = await db.select({
                impressions: productTargets.impressions,
                clicks: productTargets.clicks,
                orders: productTargets.orders,
                spend: productTargets.spend,
                sales: productTargets.sales
                // @ts-ignore
              }).from(productTargets).where(eq(productTargets.id, log216.targetId)).limit(1);
              if (tgtPerf[0]) {
                const ci = Number(tgtPerf[0].impressions) || 0;
                const cc = Number(tgtPerf[0].clicks) || 0;
                if (logAgeHours >= 24 && (ci > 0 || cc > 0)) {
                  rewardImpressions = ci;
                  rewardClicks = cc;
                  rewardOrders = Number(tgtPerf[0].orders) || 0;
                  rewardSpend = Number(tgtPerf[0].spend) || 0;
                  rewardSales = Number(tgtPerf[0].sales) || 0;
                  dataSource = "target_post_attribution";
                  usedImmediateChannel = true;
                } else if (ci > 0 || cc > 0) {
                  rewardImpressions = ci;
                  rewardClicks = cc;
                  rewardOrders = Number(tgtPerf[0].orders) || 0;
                  rewardSpend = Number(tgtPerf[0].spend) || 0;
                  rewardSales = Number(tgtPerf[0].sales) || 0;
                  dataSource = "target_pre_attribution";
                  usedImmediateChannel = true;
                }
              }
            }
          }
        }
        if (dataSource === "none") {
          if (logAgeHours < 6) {
            continue;
          }
          const threeDaysLater = new Date(logDate.getTime() + 3 * 864e5).toISOString().split("T")[0];
          const afterPerf = await db.select({
            totalImpressions: sql`SUM(impressions)`,
            totalClicks: sql`SUM(clicks)`,
            totalOrders: sql`SUM(orders)`,
            totalSpend: sql`SUM(CAST(spend AS DECIMAL(10,2)))`,
            totalSales: sql`SUM(CAST(sales AS DECIMAL(10,2)))`
          }).from(dailyPerformance).where(and(
            // @ts-ignore
            eq(dailyPerformance.accountId, log216.accountId),
            // @ts-ignore
            log216.campaignId ? eq(dailyPerformance.campaignId, log216.campaignId) : sql`1=1`,
            gte(dailyPerformance.date, nextDay),
            lte(dailyPerformance.date, threeDaysLater)
          ));
          const perf = afterPerf[0] || {};
          rewardImpressions = Number(perf.totalImpressions) || 0;
          rewardClicks = Number(perf.totalClicks) || 0;
          rewardOrders = Number(perf.totalOrders) || 0;
          rewardSpend = Number(perf.totalSpend) || 0;
          rewardSales = Number(perf.totalSales) || 0;
          dataSource = "campaign_daily";
        }
        if (dataSource === "none" || rewardImpressions === 0 && rewardClicks === 0 && rewardSpend === 0) {
          try {
            const { optimizationEvents: optimizationEvents9 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
            const entityConditions = [
              // @ts-ignore
              eq(optimizationEvents9.accountId, log216.accountId),
              sql`${optimizationEvents9.eventCategory} = 'bid_adjustment'`,
              sql`${optimizationEvents9.status} = 'success'`,
              gte(optimizationEvents9.createdAt, new Date(logDate.getTime() - 36e5).toISOString()),
              lte(optimizationEvents9.createdAt, new Date(logDate.getTime() + 48 * 36e5).toISOString())
            ];
            if (log216.keywordId) {
              entityConditions.push(eq(optimizationEvents9.keywordId, log216.keywordId));
            } else if (log216.targetId) {
              entityConditions.push(eq(optimizationEvents9.targetId, log216.targetId));
            }
            const eventData = await db.select({
              performanceData: optimizationEvents9.performanceData,
              previousBid: optimizationEvents9.previousBid,
              newBid: optimizationEvents9.newBid
            }).from(optimizationEvents9).where(and(...entityConditions)).orderBy(sql`created_at DESC`).limit(1);
            if (eventData[0]?.performanceData) {
              const perfData = typeof eventData[0].performanceData === "string" ? JSON.parse(eventData[0].performanceData) : eventData[0].performanceData;
              if (perfData) {
                rewardImpressions = Number(perfData.impressions || perfData.stateImpressions) || 0;
                rewardClicks = Number(perfData.clicks || perfData.stateClicks) || 0;
                rewardOrders = Number(perfData.orders || perfData.stateOrders) || 0;
                rewardSpend = Number(perfData.spend || perfData.stateSpend) || 0;
                rewardSales = Number(perfData.sales || perfData.stateSales) || 0;
                if (rewardImpressions > 0 || rewardClicks > 0) {
                  dataSource = "optimization_events_synthesis";
                }
              }
            }
          } catch (synthErr) {
          }
        }
        if (rewardImpressions === 0 && rewardClicks === 0 && rewardSpend === 0) {
          const bidBefore = Number(log216.actionBidBefore) || 0;
          const bidAfter = Number(log216.actionBidAfter) || 0;
          const bidChangeRatio = bidBefore > 0 ? (bidAfter - bidBefore) / bidBefore : 0;
          let syntheticReward = 0;
          if (Math.abs(bidChangeRatio) <= 0.15) {
            syntheticReward = bidChangeRatio < 0 ? 0.1 : 0.05;
          } else {
            syntheticReward = 0;
          }
          skippedNoData++;
          await db.update(rlTrainingLogs).set({
            reward: String(syntheticReward),
            rewardImpressions: 0,
            rewardClicks: 0,
            rewardOrders: 0,
            rewardSpend: "0",
            rewardSales: "0",
            rewardProfit: "0",
            rewardFilledAt: (/* @__PURE__ */ new Date()).toISOString()
          }).where(eq(rlTrainingLogs.id, log216.id));
          filledCount++;
          continue;
        }
        const rewardProfit = rewardSales - rewardSpend;
        const bidDelta = Number(log216.actionBidAfter) - Number(log216.actionBidBefore);
        const reward = rewardSpend > 0 ? rewardProfit / rewardSpend : rewardProfit;
        await db.update(rlTrainingLogs).set({
          reward: String(reward),
          rewardImpressions,
          rewardClicks,
          rewardOrders,
          rewardSpend: String(rewardSpend),
          rewardSales: String(rewardSales),
          rewardProfit: String(rewardProfit),
          rewardFilledAt: (/* @__PURE__ */ new Date()).toISOString()
        }).where(eq(rlTrainingLogs.id, log216.id));
        if (usedImmediateChannel) immediateFilledCount++;
        filledCount++;
      } catch (e) {
        rlLog.error(`[RLDataRecorder] Failed to fill reward for log ${log216.id}:`, e);
      }
    }
    rlLog.info(`[backfillRewards] \u8D26\u6237${accountId}: v259\u589E\u5F3A\u56DE\u586B\u5B8C\u6210, \u5F85\u56DE\u586B=${pendingLogs.length}, \u6210\u529F\u56DE\u586B=${filledCount}, \u5373\u65F6\u901A\u9053A=${immediateFilledCount}, \u96F6\u6570\u636E\u4E2D\u6027=${skippedNoData}, \u96F6\u6570\u636E\u91CD\u8BD5\u6210\u529F=${retriedFromZero}`);
    const totalProcessed = filledCount + skippedNoData;
    const realDataRate = totalProcessed > 0 ? ((filledCount - skippedNoData) / totalProcessed * 100).toFixed(1) : "0";
    const channelARate = totalProcessed > 0 ? (immediateFilledCount / totalProcessed * 100).toFixed(1) : "0";
    rlLog.info(`[backfillRewards] v259\u5065\u5EB7\u68C0\u67E5: \u771F\u5B9E\u6570\u636E\u7387=${realDataRate}%, \u901A\u9053A\u6210\u529F\u7387=${channelARate}%, \u96F6\u6570\u636E\u91CD\u8BD5=${retriedFromZero}\u6761`);
    return filledCount;
  } catch (error48) {
    rlLog.error(`[backfillRewards] \u8D26\u6237${accountId}\u56DE\u586B\u5F02\u5E38: ${error48.message}`);
    return filledCount;
  }
}
async function getTrainingDataset(accountId, limit = 1e4) {
  const db = await getDbInstance2();
  const data = await db.select().from(rlTrainingLogs).where(and(
    eq(rlTrainingLogs.accountId, accountId),
    sql`reward IS NOT NULL`,
    sql`reward_filled_at IS NOT NULL`
  )).orderBy(sql`created_at DESC`).limit(limit);
  return data;
}
async function recordBidPerformanceHistory(params) {
  if (!params.accountId || !params.campaignId || !params.bidObjectId || params.bid == null) {
    rlLog.warn(`[RLDataRecorder] v231: recordBidPerformanceHistory skipped - missing required params: accountId=${params.accountId}, campaignId=${params.campaignId}, bidObjectId=${params.bidObjectId}, bid=${params.bid}`);
    return;
  }
  if (params.bid <= 0 || !isFinite(params.bid)) {
    rlLog.warn(`[RLDataRecorder] v231: recordBidPerformanceHistory skipped - invalid bid value: ${params.bid}`);
    return;
  }
  try {
    const db = await getDbInstance2();
    const { bidPerformanceHistory: bidPerformanceHistory2 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const currentHour = (/* @__PURE__ */ new Date()).getHours();
    const impressions = params.impressions || 0;
    const clicks = params.clicks || 0;
    const spend = params.spend || 0;
    const sales = params.sales || 0;
    const orders = params.orders || 0;
    const ctr = impressions > 0 ? clicks / impressions : 0;
    const cvr = clicks > 0 ? orders / clicks : 0;
    const acos = sales > 0 ? spend / sales : 0;
    const roas = spend > 0 ? sales / spend : 0;
    const effectiveCpc = clicks > 0 ? spend / clicks : 0;
    const revenue = sales;
    const profit = sales - spend;
    await db.insert(bidPerformanceHistory2).values({
      accountId: params.accountId,
      campaignId: String(params.campaignId),
      bidObjectType: params.bidObjectType,
      bidObjectId: String(params.bidObjectId),
      bid: String(params.bid),
      effectiveCpc: String(effectiveCpc),
      date: today,
      timeSlot: currentHour,
      impressions,
      clicks,
      spend: String(spend),
      sales: String(sales),
      orders,
      ctr: String(ctr),
      cvr: String(cvr),
      acos: String(acos),
      roas: String(roas),
      revenue: String(revenue),
      profit: String(profit)
    });
    rlLog.info(`[RLDataRecorder] v230: bidPerformanceHistory recorded: account=${params.accountId}, type=${params.bidObjectType}, id=${params.bidObjectId}, bid=${params.bid}`);
  } catch (error48) {
    rlLog.error(`[RLDataRecorder] v230: Failed to record bidPerformanceHistory:`, error48);
  }
}
async function batchRecordBidPerformanceHistory(records) {
  let recorded = 0;
  let failed = 0;
  for (const record2 of records) {
    try {
      await recordBidPerformanceHistory(record2);
      recorded++;
    } catch (e) {
      failed++;
    }
  }
  rlLog.info(`[RLDataRecorder] v230: batchRecordBidPerformanceHistory: recorded=${recorded}, failed=${failed}`);
  return { recorded, failed };
}
async function backfillBidPerformanceResults() {
  try {
    const db = await getDbInstance2();
    const { bidPerformanceHistory: bidPerformanceHistory2, keywords: keywords10, productTargets: productTargets5 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const staleRecords = await db.select({
      id: bidPerformanceHistory2.id,
      bidObjectType: bidPerformanceHistory2.bidObjectType,
      bidObjectId: bidPerformanceHistory2.bidObjectId
    }).from(bidPerformanceHistory2).where(
      // @ts-ignore
      and(
        eq(bidPerformanceHistory2.impressions, 0),
        sql`${bidPerformanceHistory2.createdAt} < DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
        sql`${bidPerformanceHistory2.createdAt} > DATE_SUB(NOW(), INTERVAL 7 DAY)`
      )
    ).limit(200);
    let updated = 0;
    let skipped = 0;
    for (const record2 of staleRecords) {
      try {
        let perfData = null;
        if (record2.bidObjectType === "keyword") {
          const [kw] = await db.select({
            // @ts-ignore
            impressions: keywords10.impressions,
            // @ts-ignore
            clicks: keywords10.clicks,
            // @ts-ignore
            spend: keywords10.spend,
            // @ts-ignore
            sales: keywords10.sales,
            // @ts-ignore
            orders: keywords10.orders
          }).from(keywords10).where(eq(keywords10.id, Number(record2.bidObjectId))).limit(1);
          perfData = kw;
        } else {
          const [pt] = await db.select({
            impressions: productTargets5.impressions,
            clicks: productTargets5.clicks,
            spend: productTargets5.spend,
            sales: productTargets5.sales,
            orders: productTargets5.orders
          }).from(productTargets5).where(eq(productTargets5.id, Number(record2.bidObjectId))).limit(1);
          perfData = pt;
        }
        if (perfData && parseInt(String(perfData.impressions || "0")) > 0) {
          const impressions = parseInt(String(perfData.impressions || "0"));
          const clicks = parseInt(String(perfData.clicks || "0"));
          const spend = parseFloat(String(perfData.spend || "0"));
          const sales = parseFloat(String(perfData.sales || "0"));
          const orders = parseInt(String(perfData.orders || "0"));
          const ctr = impressions > 0 ? clicks / impressions : 0;
          const cvr = clicks > 0 ? orders / clicks : 0;
          const acos = sales > 0 ? spend / sales : 0;
          const roas = spend > 0 ? sales / spend : 0;
          await db.update(bidPerformanceHistory2).set({
            impressions: String(impressions),
            clicks: String(clicks),
            spend: String(spend),
            sales: String(sales),
            orders: String(orders),
            ctr: String(ctr),
            cvr: String(cvr),
            acos: String(acos),
            roas: String(roas),
            revenue: String(sales),
            profit: String(sales - spend)
          }).where(eq(bidPerformanceHistory2.id, record2.id));
          updated++;
        } else {
          skipped++;
        }
      } catch (e) {
        skipped++;
      }
    }
    if (updated > 0 || staleRecords.length > 0) {
      rlLog.info(`[RLDataRecorder] v230: backfillBidPerformanceResults: updated=${updated}, skipped=${skipped}, total_checked=${staleRecords.length}`);
    }
    return { updated, skipped };
  } catch (error48) {
    rlLog.error(`[RLDataRecorder] v230: Failed to backfill bid performance results:`, error48);
    return { updated: 0, skipped: 0 };
  }
}
var import_crypto3, rlLog, uuidv4;
var init_rlDataRecorder = __esm({
  "server/algorithm/rlDataRecorder.ts"() {
    "use strict";
    init_db2();
    init_logger();
    init_schema2();
    init_drizzle_orm();
    init_contextualFeatureService();
    import_crypto3 = require("crypto");
    rlLog = createModuleLogger("RLDataRecorder");
    uuidv4 = import_crypto3.randomUUID;
    __name(getDbInstance2, "getDbInstance");
    __name(classifyAction, "classifyAction");
    __name(getOrCreateEpisodeId, "getOrCreateEpisodeId");
    __name(recordBidAction, "recordBidAction");
    __name(captureStateSnapshot, "captureStateSnapshot");
    __name(backfillRewards, "backfillRewards");
    __name(getTrainingDataset, "getTrainingDataset");
    __name(recordBidPerformanceHistory, "recordBidPerformanceHistory");
    __name(batchRecordBidPerformanceHistory, "batchRecordBidPerformanceHistory");
    __name(backfillBidPerformanceResults, "backfillBidPerformanceResults");
  }
});

