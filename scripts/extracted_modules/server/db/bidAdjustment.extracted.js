// Extracted from production dist/index.js
// Original module: server/db/bidAdjustment.ts
// Lines: 386

var bidAdjustment_exports = {};
__export(bidAdjustment_exports, {
  getAdjustmentsNeedingTracking: () => getAdjustmentsNeedingTracking,
  getBidAdjustmentById: () => getBidAdjustmentById,
  getBidAdjustmentHistory: () => getBidAdjustmentHistory,
  getBidAdjustmentStats: () => getBidAdjustmentStats,
  getBidAdjustmentTrackingStats: () => getBidAdjustmentTrackingStats,
  getKeywordHistoryData: () => getKeywordHistoryData,
  getProductTargetHistoryData: () => getProductTargetHistoryData,
  importBidAdjustmentHistory: () => importBidAdjustmentHistory,
  recordBidAdjustment: () => recordBidAdjustment,
  recordBidAdjustmentBatch: () => recordBidAdjustmentBatch,
  rollbackBidAdjustment: () => rollbackBidAdjustment,
  updateBidAdjustmentTracking: () => updateBidAdjustmentTracking
});
async function getKeywordHistoryData(keywordId, days) {
  return [];
}
async function getProductTargetHistoryData(targetId, days) {
  return [];
}
async function recordBidAdjustment(data) {
  const db = await getDb();
  if (!db) return null;
  const bidChangePercent = data.previousBid > 0 ? (data.newBid - data.previousBid) / data.previousBid * 100 : 100;
  const result = await db.insert(bidAdjustmentHistory).values({
    accountId: data.accountId,
    campaignId: data.campaignId,
    campaignName: data.campaignName,
    performanceGroupId: data.performanceGroupId,
    performanceGroupName: data.performanceGroupName,
    keywordId: data.keywordId,
    keywordText: data.keywordText,
    matchType: data.matchType,
    previousBid: String(data.previousBid),
    newBid: String(data.newBid),
    bidChangePercent: String(Math.round(bidChangePercent * 100) / 100),
    adjustmentType: data.adjustmentType,
    adjustmentReason: data.adjustmentReason,
    expectedProfitIncrease: data.expectedProfitIncrease ? String(data.expectedProfitIncrease) : null,
    optimizationScore: data.optimizationScore,
    appliedBy: data.appliedBy,
    status: data.status || "applied",
    errorMessage: data.errorMessage
  });
  try {
    const bidChange = data.newBid - data.previousBid;
    const statusMap = {
      "applied": "success",
      "pending": "pending",
      "failed": "failed",
      "rolled_back": "rolled_back"
    };
    await db.insert(optimizationEvents).values({
      performanceGroupId: data.performanceGroupId,
      performanceGroupName: data.performanceGroupName,
      accountId: data.accountId,
      eventCategory: "bid_adjustment",
      actionType: bidChange > 0 ? "bid_increase" : bidChange < 0 ? "bid_decrease" : "bid_set",
      campaignId: data.campaignId != null ? guardCampaignIdInsert(data.campaignId, "optimization_events(bidAdjustment)") : null,
      campaignName: data.campaignName,
      keywordId: data.keywordId,
      keywordText: data.keywordText,
      matchType: data.matchType,
      previousBid: String(data.previousBid),
      newBid: String(data.newBid),
      bidChangePercent: String(Math.round(bidChangePercent * 100) / 100),
      changeReason: data.adjustmentReason,
      adjustmentType: data.adjustmentType,
      algorithmVersion: void 0,
      optimizationScore: data.optimizationScore,
      expectedProfitIncrease: data.expectedProfitIncrease ? String(data.expectedProfitIncrease) : void 0,
      status: statusMap[data.status || "applied"] || "success",
      apiSyncStatus: "synced",
      errorMessage: data.errorMessage,
      sourceTable: "bid_adjustment_history",
      sourceId: Number(result[0]?.insertId || 0)
    });
  } catch (e) {
    log15.warn("[v145] \u53CC\u5199optimization_events\u5931\u8D25(bidAdjustment):", e);
  }
  return result;
}
async function recordBidAdjustmentBatch(records) {
  const db = await getDb();
  if (!db || records.length === 0) return null;
  const values = records.map((data) => {
    const bidChangePercent = data.previousBid > 0 ? (data.newBid - data.previousBid) / data.previousBid * 100 : 100;
    return {
      accountId: data.accountId,
      campaignId: data.campaignId,
      campaignName: data.campaignName,
      performanceGroupId: data.performanceGroupId,
      performanceGroupName: data.performanceGroupName,
      keywordId: data.keywordId,
      keywordText: data.keywordText,
      matchType: data.matchType,
      previousBid: String(data.previousBid),
      newBid: String(data.newBid),
      bidChangePercent: String(Math.round(bidChangePercent * 100) / 100),
      adjustmentType: data.adjustmentType,
      adjustmentReason: data.adjustmentReason,
      expectedProfitIncrease: data.expectedProfitIncrease ? String(data.expectedProfitIncrease) : null,
      optimizationScore: data.optimizationScore,
      appliedBy: data.appliedBy,
      status: data.status || "applied",
      errorMessage: data.errorMessage
    };
  });
  const result = await db.insert(bidAdjustmentHistory).values(values);
  return result;
}
async function getBidAdjustmentHistory(params) {
  const db = await getDb();
  if (!db) return { records: [], total: 0, page: 1, pageSize: 50 };
  const page = params.page || 1;
  const pageSize = params.pageSize || 50;
  const offset = (page - 1) * pageSize;
  const conditions = [eq(bidAdjustmentHistory.accountId, params.accountId)];
  if (params.campaignId) {
    conditions.push(eq(bidAdjustmentHistory.campaignId, String(params.campaignId)));
  }
  if (params.performanceGroupId) {
    conditions.push(eq(bidAdjustmentHistory.performanceGroupId, params.performanceGroupId));
  }
  if (params.adjustmentType) {
    conditions.push(eq(bidAdjustmentHistory.adjustmentType, params.adjustmentType));
  }
  if (params.startDate) {
    conditions.push(gte(bidAdjustmentHistory.appliedAt, params.startDate));
  }
  if (params.endDate) {
    conditions.push(lte(bidAdjustmentHistory.appliedAt, params.endDate));
  }
  const countResult = await db.select({ count: sql`count(*)` }).from(bidAdjustmentHistory).where(and(...conditions));
  const total = countResult[0]?.count || 0;
  const records = await db.select().from(bidAdjustmentHistory).where(and(...conditions)).orderBy(desc(bidAdjustmentHistory.appliedAt)).limit(pageSize).offset(offset);
  return {
    records,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  };
}
async function getBidAdjustmentStats(accountId, days = 30) {
  const db = await getDb();
  if (!db) return null;
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().slice(0, 19).replace("T", " ");
  const typeStats = await db.select({
    adjustmentType: bidAdjustmentHistory.adjustmentType,
    count: sql`count(*)`,
    totalProfitIncrease: sql`COALESCE(SUM(expected_profit_increase), 0)`
  }).from(bidAdjustmentHistory).where(and(
    eq(bidAdjustmentHistory.accountId, accountId),
    gte(bidAdjustmentHistory.appliedAt, startDateStr)
  )).groupBy(bidAdjustmentHistory.adjustmentType);
  const dailyTrend = await db.select({
    date: sql`DATE(applied_at)`,
    count: sql`count(*)`,
    avgBidChange: sql`AVG(bid_change_percent)`
  }).from(bidAdjustmentHistory).where(and(
    eq(bidAdjustmentHistory.accountId, accountId),
    gte(bidAdjustmentHistory.appliedAt, startDateStr)
  )).groupBy(sql`DATE(applied_at)`).orderBy(sql`DATE(applied_at)`);
  const overallStats = await db.select({
    totalAdjustments: sql`count(*)`,
    totalProfitIncrease: sql`COALESCE(SUM(expected_profit_increase), 0)`,
    avgBidChange: sql`AVG(bid_change_percent)`,
    increasedCount: sql`SUM(CASE WHEN bid_change_percent > 0 THEN 1 ELSE 0 END)`,
    decreasedCount: sql`SUM(CASE WHEN bid_change_percent < 0 THEN 1 ELSE 0 END)`
  }).from(bidAdjustmentHistory).where(and(
    eq(bidAdjustmentHistory.accountId, accountId),
    gte(bidAdjustmentHistory.appliedAt, startDateStr)
  ));
  return {
    typeStats,
    dailyTrend,
    overall: overallStats[0] || {
      totalAdjustments: 0,
      totalProfitIncrease: 0,
      avgBidChange: 0,
      increasedCount: 0,
      decreasedCount: 0
    },
    period: {
      days,
      startDate: startDateStr,
      endDate: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
    }
  };
}
async function rollbackBidAdjustment(adjustmentId, userId) {
  const db = await getDb();
  if (!db) return null;
  const [adjustment] = await db.select().from(bidAdjustmentHistory).where(eq(bidAdjustmentHistory.id, adjustmentId));
  if (!adjustment) return null;
  if (adjustment.keywordId) {
    await db.update(keywords).set({ bid: adjustment.previousBid }).where(eq(keywords.id, adjustment.keywordId));
  }
  await db.update(bidAdjustmentHistory).set({
    status: "rolled_back",
    rolledBackAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
    rolledBackBy: userId
  }).where(eq(bidAdjustmentHistory.id, adjustmentId));
  await db.insert(bidAdjustmentHistory).values({
    accountId: adjustment.accountId,
    campaignId: adjustment.campaignId,
    campaignName: adjustment.campaignName,
    performanceGroupId: adjustment.performanceGroupId,
    performanceGroupName: adjustment.performanceGroupName,
    keywordId: adjustment.keywordId,
    keywordText: adjustment.keywordText,
    matchType: adjustment.matchType,
    previousBid: adjustment.newBid,
    // 回滚前是新出价
    newBid: adjustment.previousBid,
    // 回滚后是原出价
    bidChangePercent: String(-Number(adjustment.bidChangePercent || 0)),
    adjustmentType: "manual",
    adjustmentReason: `\u56DE\u6EDA\u8C03\u6574 #${adjustmentId}`,
    appliedBy: userId,
    status: "applied"
  });
  return { success: true, adjustmentId };
}
async function getBidAdjustmentById(adjustmentId) {
  const db = await getDb();
  if (!db) return null;
  const [adjustment] = await db.select().from(bidAdjustmentHistory).where(eq(bidAdjustmentHistory.id, adjustmentId));
  return adjustment || null;
}
async function updateBidAdjustmentTracking(adjustmentId, trackingData) {
  const db = await getDb();
  if (!db) return null;
  await db.update(bidAdjustmentHistory).set({
    actualProfit7D: trackingData.actualProfit7D !== void 0 ? String(trackingData.actualProfit7D) : void 0,
    actualProfit14D: trackingData.actualProfit14D !== void 0 ? String(trackingData.actualProfit14D) : void 0,
    actualProfit30D: trackingData.actualProfit30D !== void 0 ? String(trackingData.actualProfit30D) : void 0,
    actualImpressions7D: trackingData.actualImpressions7D,
    actualClicks7D: trackingData.actualClicks7D,
    actualConversions7D: trackingData.actualConversions7D,
    actualSpend7D: trackingData.actualSpend7D !== void 0 ? String(trackingData.actualSpend7D) : void 0,
    actualRevenue7D: trackingData.actualRevenue7D !== void 0 ? String(trackingData.actualRevenue7D) : void 0,
    trackingUpdatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
  }).where(eq(bidAdjustmentHistory.id, adjustmentId));
  return { success: true };
}
async function getAdjustmentsNeedingTracking(daysAgo = 7) {
  const db = await getDb();
  if (!db) return [];
  const cutoffDate = /* @__PURE__ */ new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysAgo);
  const cutoffDateStr = cutoffDate.toISOString().slice(0, 19).replace("T", " ");
  const results = await db.select().from(bidAdjustmentHistory).where(
    and(
      eq(bidAdjustmentHistory.status, "applied"),
      sql`${bidAdjustmentHistory.appliedAt} <= ${cutoffDateStr}`,
      sql`${bidAdjustmentHistory.trackingUpdatedAt} IS NULL OR DATE(${bidAdjustmentHistory.trackingUpdatedAt}) < DATE(NOW())`
    )
  ).limit(100);
  return results;
}
async function importBidAdjustmentHistory(records) {
  const db = await getDb();
  if (!db || records.length === 0) return { success: false, imported: 0, errors: [] };
  const errors = [];
  const validRecords = [];
  records.forEach((record2, index2) => {
    if (!record2.accountId) {
      errors.push({ row: index2 + 1, error: "\u7F3A\u5C11\u8D26\u53F7ID" });
      return;
    }
    if (record2.previousBid === void 0 || record2.newBid === void 0) {
      errors.push({ row: index2 + 1, error: "\u7F3A\u5C11\u51FA\u4EF7\u6570\u636E" });
      return;
    }
    const bidChangePercent = record2.previousBid > 0 ? (record2.newBid - record2.previousBid) / record2.previousBid * 100 : 100;
    validRecords.push({
      // @ts-ignore
      accountId: record2.accountId,
      // @ts-ignore
      campaignId: record2.campaignId,
      // @ts-ignore
      campaignName: record2.campaignName,
      // @ts-ignore
      performanceGroupId: record2.performanceGroupId,
      // @ts-ignore
      performanceGroupName: record2.performanceGroupName,
      // @ts-ignore
      keywordId: record2.keywordId,
      // @ts-ignore
      keywordText: record2.keywordText,
      // @ts-ignore
      matchType: record2.matchType,
      // @ts-ignore
      previousBid: String(record2.previousBid),
      // @ts-ignore
      newBid: String(record2.newBid),
      bidChangePercent: String(Math.round(bidChangePercent * 100) / 100),
      // @ts-ignore
      adjustmentType: record2.adjustmentType || "manual",
      // @ts-ignore
      adjustmentReason: record2.adjustmentReason || "\u6279\u91CF\u5BFC\u5165",
      // @ts-ignore
      expectedProfitIncrease: record2.expectedProfitIncrease ? String(record2.expectedProfitIncrease) : null,
      // @ts-ignore
      appliedBy: record2.appliedBy || "import",
      // @ts-ignore
      appliedAt: record2.appliedAt || (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
      // @ts-ignore
      status: record2.status || "applied"
    });
  });
  if (validRecords.length > 0) {
    await db.insert(bidAdjustmentHistory).values(validRecords);
  }
  return {
    success: true,
    imported: validRecords.length,
    skipped: errors.length,
    errors
  };
}
async function getBidAdjustmentTrackingStats(accountId, days = 30) {
  const db = await getDb();
  if (!db) return null;
  const cutoffDate = /* @__PURE__ */ new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffDateStr = cutoffDate.toISOString().slice(0, 19).replace("T", " ");
  const results = await db.select().from(bidAdjustmentHistory).where(
    and(
      eq(bidAdjustmentHistory.accountId, accountId),
      eq(bidAdjustmentHistory.status, "applied"),
      sql`${bidAdjustmentHistory.appliedAt} >= ${cutoffDateStr}`,
      sql`${bidAdjustmentHistory.actualProfit7D} IS NOT NULL`
    )
  );
  let totalExpectedProfit = 0;
  let totalActualProfit7d = 0;
  let totalActualProfit14d = 0;
  let totalActualProfit30d = 0;
  let trackedCount = 0;
  results.forEach((r) => {
    totalExpectedProfit += Number(r.expectedProfitIncrease || 0);
    totalActualProfit7d += Number(r.actualProfit7D || 0);
    totalActualProfit14d += Number(r.actualProfit14D || 0);
    totalActualProfit30d += Number(r.actualProfit30D || 0);
    trackedCount++;
  });
  return {
    trackedCount,
    totalExpectedProfit: Math.round(totalExpectedProfit * 100) / 100,
    totalActualProfit7d: Math.round(totalActualProfit7d * 100) / 100,
    totalActualProfit14d: Math.round(totalActualProfit14d * 100) / 100,
    totalActualProfit30d: Math.round(totalActualProfit30d * 100) / 100,
    accuracy7d: trackedCount > 0 && totalExpectedProfit > 0 ? Math.round(totalActualProfit7d / totalExpectedProfit * 100) : 0
  };
}
var log15;
var init_bidAdjustment = __esm({
  "server/db/bidAdjustment.ts"() {
    "use strict";
    init_drizzle_orm();
    init_connection();
    init_logger();
    init_schema2();
    init_idTypes();
    log15 = createModuleLogger("DB:bidAdjustment");
    __name(getKeywordHistoryData, "getKeywordHistoryData");
    __name(getProductTargetHistoryData, "getProductTargetHistoryData");
    __name(recordBidAdjustment, "recordBidAdjustment");
    __name(recordBidAdjustmentBatch, "recordBidAdjustmentBatch");
    __name(getBidAdjustmentHistory, "getBidAdjustmentHistory");
    __name(getBidAdjustmentStats, "getBidAdjustmentStats");
    __name(rollbackBidAdjustment, "rollbackBidAdjustment");
    __name(getBidAdjustmentById, "getBidAdjustmentById");
    __name(updateBidAdjustmentTracking, "updateBidAdjustmentTracking");
    __name(getAdjustmentsNeedingTracking, "getAdjustmentsNeedingTracking");
    __name(importBidAdjustmentHistory, "importBidAdjustmentHistory");
    __name(getBidAdjustmentTrackingStats, "getBidAdjustmentTrackingStats");
  }
});

