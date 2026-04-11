// Extracted from production dist/index.js
// Original module: server/algorithm/causalInferenceEngine.ts
// Lines: 267

async function getDbInstance5() {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  return db;
}
function bootstrapCI(values, confidence = 0.95, nBootstrap = 500) {
  if (values.length < 3) return Infinity;
  const bootstrapMeans = [];
  for (let i = 0; i < nBootstrap; i++) {
    const sample = Array.from(
      { length: values.length },
      () => (
        // @ts-ignore
        values[Math.floor(Math.random() * values.length)]
      )
    );
    bootstrapMeans.push(sample.reduce((a, b) => a + b, 0) / sample.length);
  }
  bootstrapMeans.sort((a, b) => a - b);
  const alpha = (1 - confidence) / 2;
  const lower = bootstrapMeans[Math.floor(alpha * nBootstrap)];
  const upper = bootstrapMeans[Math.floor((1 - alpha) * nBootstrap)];
  return (upper - lower) / 2;
}
function didEstimate(treatBefore, treatAfter, controlBefore, controlAfter) {
  const treatDiff = treatAfter.cvr - treatBefore.cvr;
  const controlDiff = controlAfter.cvr - controlBefore.cvr;
  const ite = treatDiff - controlDiff;
  return {
    ite,
    treatmentEffect: treatDiff,
    timeEffect: controlDiff
  };
}
async function estimateCausalEffect(accountId, keywordId, targetId, campaignId) {
  const db = await getDbInstance5();
  try {
    const bidChanges = await db.select({
      actionBidBefore: rlTrainingLogs.actionBidBefore,
      actionBidAfter: rlTrainingLogs.actionBidAfter,
      createdAt: rlTrainingLogs.createdAt,
      reward: rlTrainingLogs.reward,
      rewardSales: rlTrainingLogs.rewardSales,
      rewardSpend: rlTrainingLogs.rewardSpend,
      rewardOrders: rlTrainingLogs.rewardOrders,
      rewardClicks: rlTrainingLogs.rewardClicks,
      rewardImpressions: rlTrainingLogs.rewardImpressions
    }).from(rlTrainingLogs).where(and(
      eq(rlTrainingLogs.accountId, accountId),
      keywordId ? eq(rlTrainingLogs.keywordId, keywordId) : sql`1=1`,
      targetId ? eq(rlTrainingLogs.targetId, targetId) : sql`1=1`,
      isNotNull(rlTrainingLogs.rewardFilledAt)
    )).orderBy(sql`created_at DESC`).limit(20);
    if (bidChanges.length < 3) {
      return null;
    }
    const events = [];
    for (const change of bidChanges) {
      const changeDate = new Date(change.createdAt);
      const beforeStart = new Date(changeDate.getTime() - 7 * 864e5).toISOString().split("T")[0];
      const beforeEnd = new Date(changeDate.getTime() - 1 * 864e5).toISOString().split("T")[0];
      const afterStart = new Date(changeDate.getTime() + 1 * 864e5).toISOString().split("T")[0];
      const afterEnd = new Date(changeDate.getTime() + 7 * 864e5).toISOString().split("T")[0];
      const [perfBefore, perfAfter] = await Promise.all([
        getAggregatedPerf(db, accountId, campaignId, beforeStart, beforeEnd),
        getAggregatedPerf(db, accountId, campaignId, afterStart, afterEnd)
      ]);
      if (perfBefore && perfAfter) {
        events.push({
          keywordId,
          targetId,
          campaignId,
          bidBefore: Number(change.actionBidBefore),
          bidAfter: Number(change.actionBidAfter),
          changeDate: changeDate.toISOString().split("T")[0],
          perfBefore,
          perfAfter
        });
      }
    }
    if (events.length < 2) return null;
    const controlPerf = await getAccountAveragePerf(db, accountId);
    const iteValues = [];
    for (const event of events) {
      const did = didEstimate(
        event.perfBefore,
        // @ts-ignore
        event.perfAfter,
        controlPerf.before,
        controlPerf.after
      );
      iteValues.push(did.ite);
    }
    const avgITE = iteValues.reduce((a, b) => a + b, 0) / iteValues.length;
    const ci = bootstrapCI(iteValues);
    const latestEvent = events[0];
    const avgClicks = (latestEvent.perfAfter.clicks + latestEvent.perfBefore.clicks) / 2;
    const avgAOV = latestEvent.perfAfter.sales > 0 && latestEvent.perfAfter.orders > 0 ? latestEvent.perfAfter.sales / latestEvent.perfAfter.orders : 30;
    const incrementalOrders = avgClicks * Math.max(0, avgITE);
    const incrementalRevenue = incrementalOrders * avgAOV;
    const incrementalCost = latestEvent.perfAfter.spend - latestEvent.perfBefore.spend;
    const incrementalProfit = incrementalRevenue - incrementalCost;
    const incrementalROAS = incrementalCost > 0 ? incrementalRevenue / incrementalCost : 0;
    const currentBid = latestEvent.bidAfter;
    const optimalBid = incrementalProfit > 0 ? currentBid * (1 + Math.min(0.1, avgITE * 2)) : currentBid * (1 - Math.min(0.1, Math.abs(avgITE) * 2));
    const result = {
      keywordId,
      targetId,
      campaignId,
      estimatedITE: avgITE,
      // @ts-ignore
      treatmentCVR: latestEvent.perfAfter.cvr,
      controlCVR: controlPerf.after.cvr,
      upliftScore: controlPerf.after.cvr > 0 ? avgITE / controlPerf.after.cvr : 0,
      confidenceInterval: ci,
      incrementalRevenue: Math.round(incrementalRevenue * 100) / 100,
      incrementalCost: Math.round(incrementalCost * 100) / 100,
      incrementalProfit: Math.round(incrementalProfit * 100) / 100,
      incrementalROAS: Math.round(incrementalROAS * 100) / 100,
      optimalBid: Math.round(optimalBid * 100) / 100,
      optimalBidLower: Math.round(optimalBid * 0.9 * 100) / 100,
      optimalBidUpper: Math.round(optimalBid * 1.1 * 100) / 100,
      sampleSize: events.length
    };
    await saveCausalResult(db, accountId, result);
    return result;
  } catch (error48) {
    log44.warn(`[CausalInference] Error estimating causal effect:`, error48);
    return null;
  }
}
async function getAggregatedPerf(db, accountId, campaignId, startDate, endDate) {
  const results = await db.select({
    totalImpressions: sql`SUM(impressions)`,
    totalClicks: sql`SUM(clicks)`,
    // @ts-ignore
    totalOrders: sql`SUM(orders)`,
    // @ts-ignore
    totalSpend: sql`SUM(CAST(spend AS DECIMAL(10,2)))`,
    // @ts-ignore
    totalSales: sql`SUM(CAST(sales AS DECIMAL(10,2)))`
    // @ts-ignore
  }).from(dailyPerformance).where(and(
    eq(dailyPerformance.accountId, accountId),
    campaignId ? eq(dailyPerformance.campaignId, campaignId) : sql`1=1`,
    gte(dailyPerformance.date, startDate),
    lte(dailyPerformance.date, endDate)
  ));
  const r = results[0];
  if (!r) return null;
  const impressions = Number(r.totalImpressions) || 0;
  const clicks = Number(r.totalClicks) || 0;
  const orders = Number(r.totalOrders) || 0;
  const spend = Number(r.totalSpend) || 0;
  const sales = Number(r.totalSales) || 0;
  return {
    impressions,
    clicks,
    orders,
    spend,
    sales,
    cvr: clicks > 0 ? orders / clicks : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    acos: sales > 0 ? spend / sales : 0
  };
}
async function getAccountAveragePerf(db, accountId) {
  const now = /* @__PURE__ */ new Date();
  const days14Ago = new Date(now.getTime() - 14 * 864e5).toISOString().split("T")[0];
  const days7Ago = new Date(now.getTime() - 7 * 864e5).toISOString().split("T")[0];
  const today = now.toISOString().split("T")[0];
  const [before, after] = await Promise.all([
    getAggregatedPerf(db, accountId, void 0, days14Ago, days7Ago),
    getAggregatedPerf(db, accountId, void 0, days7Ago, today)
  ]);
  const defaultPerf = {
    impressions: 0,
    clicks: 0,
    orders: 0,
    spend: 0,
    sales: 0,
    cvr: 0,
    cpc: 0,
    acos: 0
  };
  return {
    before: before || defaultPerf,
    after: after || defaultPerf
  };
}
async function saveCausalResult(db, accountId, result) {
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  await db.insert(causalInferenceResults).values({
    accountId,
    keywordId: result.keywordId || null,
    targetId: result.targetId || null,
    campaignId: result.campaignId || null,
    analysisDate: today,
    estimatedIte: String(result.estimatedITE),
    treatmentCvr: String(result.treatmentCVR),
    controlCvr: String(result.controlCVR),
    upliftScore: String(result.upliftScore),
    confidenceInterval: String(result.confidenceInterval),
    incrementalRevenue: String(result.incrementalRevenue),
    incrementalCost: String(result.incrementalCost),
    incrementalProfit: String(result.incrementalProfit),
    incrementalRoas: String(result.incrementalROAS),
    optimalBid: String(result.optimalBid),
    optimalBidLower: String(result.optimalBidLower),
    optimalBidUpper: String(result.optimalBidUpper),
    modelVersion: "did_v1",
    sampleSize: result.sampleSize
  });
}
async function batchCausalAnalysis(accountId) {
  const db = await getDbInstance5();
  const result = { analyzed: 0, significant: 0, errors: 0 };
  const entitiesWithLogs = await db.select({
    keywordId: rlTrainingLogs.keywordId,
    targetId: rlTrainingLogs.targetId,
    campaignId: rlTrainingLogs.campaignId,
    logCount: sql`COUNT(*)`
  }).from(rlTrainingLogs).where(and(
    eq(rlTrainingLogs.accountId, accountId),
    isNotNull(rlTrainingLogs.rewardFilledAt)
  )).groupBy(rlTrainingLogs.keywordId, rlTrainingLogs.targetId, rlTrainingLogs.campaignId).having(sql`COUNT(*) >= 3`).limit(200);
  for (const entity of entitiesWithLogs) {
    try {
      const effect = await estimateCausalEffect(
        accountId,
        entity.keywordId ?? void 0,
        entity.targetId ?? void 0,
        entity.campaignId ?? void 0
      );
      if (effect) {
        result.analyzed++;
        if (Math.abs(effect.estimatedITE) > effect.confidenceInterval) {
          result.significant++;
        }
      }
    } catch (e) {
      result.errors++;
    }
  }
  log44.info(`[CausalInference] Batch analysis: ${result.analyzed} analyzed, ${result.significant} significant, ${result.errors} errors`);
  return result;
}
var log44;
var init_causalInferenceEngine = __esm({
  "server/algorithm/causalInferenceEngine.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    log44 = createModuleLogger("CausalInferenceEngine");
    __name(getDbInstance5, "getDbInstance");
    __name(bootstrapCI, "bootstrapCI");
    __name(didEstimate, "didEstimate");
    __name(estimateCausalEffect, "estimateCausalEffect");
    __name(getAggregatedPerf, "getAggregatedPerf");
    __name(getAccountAveragePerf, "getAccountAveragePerf");
    __name(saveCausalResult, "saveCausalResult");
    __name(batchCausalAnalysis, "batchCausalAnalysis");
  }
});

