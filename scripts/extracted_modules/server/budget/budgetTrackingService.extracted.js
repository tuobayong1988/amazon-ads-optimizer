// Extracted from production dist/index.js
// Original module: server/budget/budgetTrackingService.ts
// Lines: 245

async function createTracking(userId, allocationId, trackingPeriod = "7_days", accountId) {
  const db = await getDb();
  if (!db) return null;
  const now = /* @__PURE__ */ new Date();
  const baselineDays = TRACKING_DAYS[trackingPeriod];
  const baselineEndDate = new Date(now.getTime() - 24 * 60 * 60 * 1e3);
  const baselineStartDate = new Date(baselineEndDate.getTime() - baselineDays * 24 * 60 * 60 * 1e3);
  const baselineMetrics = await calculatePeriodMetrics(userId, baselineStartDate, baselineEndDate, accountId);
  const trackingData = {
    userId,
    // @ts-ignore
    accountId: accountId ?? null,
    allocationId,
    trackingPeriod,
    startDate: now.toISOString(),
    baselineStartDate: baselineStartDate.toISOString(),
    baselineEndDate: baselineEndDate.toISOString(),
    baselineSpend: baselineMetrics.spend.toString(),
    baselineSales: baselineMetrics.sales.toString(),
    baselineRoas: baselineMetrics.roas.toString(),
    baselineAcos: baselineMetrics.acos.toString(),
    baselineConversions: baselineMetrics.conversions,
    baselineCtr: baselineMetrics.ctr.toString(),
    baselineCpc: baselineMetrics.cpc.toString(),
    status: "tracking"
  };
  const result = await db.insert(budgetAllocationTracking).values(trackingData);
  return result[0].insertId;
}
async function calculatePeriodMetrics(userId, startDate, endDate, accountId) {
  const db = await getDb();
  if (!db) return { spend: 0, sales: 0, roas: 0, acos: 0, conversions: 0, ctr: 0, cpc: 0 };
  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];
  const conditions = [
    sql`${dailyPerformance.date} >= ${startDateStr}`,
    sql`${dailyPerformance.date} < DATE_ADD(${endDateStr}, INTERVAL 1 DAY)`
  ];
  const performance = await db.select({
    totalSpend: sql`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
    totalSales: sql`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
    totalImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`
  }).from(dailyPerformance).where(and(...conditions));
  const data = performance[0];
  const spend = Number(data?.totalSpend) || 0;
  const sales = Number(data?.totalSales) || 0;
  const impressions = Number(data?.totalImpressions) || 0;
  const clicks = Number(data?.totalClicks) || 0;
  const orders = Number(data?.totalOrders) || 0;
  return {
    spend,
    sales,
    roas: spend > 0 ? sales / spend : 0,
    acos: sales > 0 ? spend / sales * 100 : 0,
    conversions: orders,
    ctr: impressions > 0 ? clicks / impressions * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0
  };
}
async function updateTrackingMetrics(trackingId) {
  const db = await getDb();
  if (!db) return false;
  const tracking = await db.select().from(budgetAllocationTracking).where(eq(budgetAllocationTracking.id, trackingId)).limit(1);
  if (!tracking[0]) return false;
  const record2 = tracking[0];
  const now = /* @__PURE__ */ new Date();
  const trackingDays = TRACKING_DAYS[record2.trackingPeriod];
  const startDateObj = new Date(record2.startDate);
  const expectedEndDate = new Date(startDateObj.getTime() + trackingDays * 24 * 60 * 60 * 1e3);
  const currentMetrics = await calculatePeriodMetrics(
    // @ts-ignore
    record2.userId,
    // @ts-ignore
    startDateObj,
    now,
    // @ts-ignore
    record2.accountId ?? void 0
  );
  const baselineRoas = Number(record2.baselineRoas) || 0;
  const baselineAcos = Number(record2.baselineAcos) || 0;
  const baselineSales = Number(record2.baselineSales) || 0;
  const baselineSpend = Number(record2.baselineSpend) || 0;
  const roasChange = currentMetrics.roas - baselineRoas;
  const acosChange = currentMetrics.acos - baselineAcos;
  const salesChange = currentMetrics.sales - baselineSales;
  const spendChange = currentMetrics.spend - baselineSpend;
  const { rating, summary } = evaluateEffect(
    { roas: baselineRoas, acos: baselineAcos, sales: baselineSales, spend: baselineSpend },
    currentMetrics,
    { roasChange, acosChange, salesChange, spendChange }
  );
  const isCompleted = now >= expectedEndDate;
  await db.update(budgetAllocationTracking).set({
    currentSpend: currentMetrics.spend.toString(),
    currentSales: currentMetrics.sales.toString(),
    currentRoas: currentMetrics.roas.toString(),
    currentAcos: currentMetrics.acos.toString(),
    currentConversions: currentMetrics.conversions,
    currentCtr: currentMetrics.ctr.toString(),
    currentCpc: currentMetrics.cpc.toString(),
    roasChange: roasChange.toString(),
    acosChange: acosChange.toString(),
    salesChange: salesChange.toString(),
    spendChange: spendChange.toString(),
    effectRating: rating,
    effectSummary: summary,
    status: isCompleted ? "completed" : "tracking",
    endDate: isCompleted ? now.toISOString() : null,
    updatedAt: now.toISOString()
  }).where(eq(budgetAllocationTracking.id, trackingId));
  return true;
}
function evaluateEffect(baseline, current, changes) {
  const roasChangePercent = baseline.roas > 0 ? changes.roasChange / baseline.roas * 100 : 0;
  const acosChangePercent = baseline.acos > 0 ? changes.acosChange / baseline.acos * 100 : 0;
  const salesChangePercent = baseline.sales > 0 ? changes.salesChange / baseline.sales * 100 : 0;
  let rating;
  let summary;
  if (roasChangePercent >= 20 && acosChangePercent <= -10) {
    rating = "excellent";
    summary = `\u6548\u679C\u4F18\u79C0\uFF01ROAS\u63D0\u5347${roasChangePercent.toFixed(1)}%\uFF0CACoS\u4E0B\u964D${Math.abs(acosChangePercent).toFixed(1)}%\uFF0C\u9500\u552E\u989D\u589E\u957F${salesChangePercent.toFixed(1)}%\u3002\u9884\u7B97\u5206\u914D\u7B56\u7565\u975E\u5E38\u6709\u6548\u3002`;
  } else if (roasChangePercent >= 10 || acosChangePercent <= -5) {
    rating = "good";
    summary = `\u6548\u679C\u826F\u597D\u3002ROAS\u53D8\u5316${roasChangePercent.toFixed(1)}%\uFF0CACoS\u53D8\u5316${acosChangePercent.toFixed(1)}%\u3002\u9884\u7B97\u5206\u914D\u7B56\u7565\u4EA7\u751F\u4E86\u6B63\u5411\u6548\u679C\u3002`;
  } else if (roasChangePercent >= -5 && acosChangePercent <= 5) {
    rating = "neutral";
    summary = `\u6548\u679C\u4E2D\u6027\u3002ROAS\u53D8\u5316${roasChangePercent.toFixed(1)}%\uFF0CACoS\u53D8\u5316${acosChangePercent.toFixed(1)}%\u3002\u9884\u7B97\u5206\u914D\u7B56\u7565\u5F71\u54CD\u6709\u9650\uFF0C\u5EFA\u8BAE\u89C2\u5BDF\u66F4\u957F\u65F6\u95F4\u3002`;
  } else if (roasChangePercent >= -15 || acosChangePercent <= 15) {
    rating = "poor";
    summary = `\u6548\u679C\u6B20\u4F73\u3002ROAS\u4E0B\u964D${Math.abs(roasChangePercent).toFixed(1)}%\uFF0CACoS\u4E0A\u5347${acosChangePercent.toFixed(1)}%\u3002\u5EFA\u8BAE\u68C0\u67E5\u5206\u914D\u7B56\u7565\u6216\u5E02\u573A\u53D8\u5316\u3002`;
  } else {
    rating = "very_poor";
    summary = `\u6548\u679C\u5F88\u5DEE\u3002ROAS\u5927\u5E45\u4E0B\u964D${Math.abs(roasChangePercent).toFixed(1)}%\uFF0CACoS\u5927\u5E45\u4E0A\u5347${acosChangePercent.toFixed(1)}%\u3002\u5F3A\u70C8\u5EFA\u8BAE\u56DE\u6EDA\u9884\u7B97\u5206\u914D\u6216\u91CD\u65B0\u8BC4\u4F30\u7B56\u7565\u3002`;
  }
  return { rating, summary };
}
async function getTrackingReport(trackingId) {
  const db = await getDb();
  if (!db) return null;
  const tracking = await db.select().from(budgetAllocationTracking).where(eq(budgetAllocationTracking.id, trackingId)).limit(1);
  if (!tracking[0]) return null;
  const record2 = tracking[0];
  return {
    // @ts-ignore
    trackingId: record2.id,
    // @ts-ignore
    allocationId: record2.allocationId,
    // @ts-ignore
    trackingPeriod: record2.trackingPeriod,
    // @ts-ignore
    startDate: new Date(record2.startDate),
    // @ts-ignore
    endDate: record2.endDate ? new Date(record2.endDate) : null,
    // @ts-ignore
    baseline: {
      // @ts-ignore
      spend: Number(record2.baselineSpend) || 0,
      // @ts-ignore
      sales: Number(record2.baselineSales) || 0,
      // @ts-ignore
      roas: Number(record2.baselineRoas) || 0,
      // @ts-ignore
      acos: Number(record2.baselineAcos) || 0,
      // @ts-ignore
      conversions: record2.baselineConversions || 0,
      // @ts-ignore
      ctr: Number(record2.baselineCtr) || 0,
      // @ts-ignore
      cpc: Number(record2.baselineCpc) || 0
    },
    current: {
      // @ts-ignore
      spend: Number(record2.currentSpend) || 0,
      // @ts-ignore
      sales: Number(record2.currentSales) || 0,
      // @ts-ignore
      roas: Number(record2.currentRoas) || 0,
      // @ts-ignore
      acos: Number(record2.currentAcos) || 0,
      // @ts-ignore
      conversions: record2.currentConversions || 0,
      // @ts-ignore
      ctr: Number(record2.currentCtr) || 0,
      // @ts-ignore
      cpc: Number(record2.currentCpc) || 0
    },
    changes: {
      // @ts-ignore
      roasChange: Number(record2.roasChange) || 0,
      // @ts-ignore
      acosChange: Number(record2.acosChange) || 0,
      // @ts-ignore
      salesChange: Number(record2.salesChange) || 0,
      // @ts-ignore
      spendChange: Number(record2.spendChange) || 0,
      // @ts-ignore
      roasChangePercent: Number(record2.baselineRoas) > 0 ? Number(record2.roasChange) / Number(record2.baselineRoas) * 100 : 0,
      // @ts-ignore
      acosChangePercent: Number(record2.baselineAcos) > 0 ? Number(record2.acosChange) / Number(record2.baselineAcos) * 100 : 0,
      // @ts-ignore
      salesChangePercent: Number(record2.baselineSales) > 0 ? Number(record2.salesChange) / Number(record2.baselineSales) * 100 : 0,
      // @ts-ignore
      spendChangePercent: Number(record2.baselineSpend) > 0 ? Number(record2.spendChange) / Number(record2.baselineSpend) * 100 : 0
    },
    // @ts-ignore
    effectRating: record2.effectRating || "neutral",
    // @ts-ignore
    effectSummary: record2.effectSummary || "",
    // @ts-ignore
    status: record2.status || "tracking"
  };
}
async function getTrackingList(userId, options = {}) {
  const db = await getDb();
  if (!db) return { trackings: [], total: 0 };
  const conditions = [eq(budgetAllocationTracking.userId, userId)];
  if (options.accountId) conditions.push(eq(budgetAllocationTracking.accountId, options.accountId));
  if (options.status) conditions.push(eq(budgetAllocationTracking.status, options.status));
  const trackings = await db.select().from(budgetAllocationTracking).where(and(...conditions)).orderBy(desc(budgetAllocationTracking.createdAt)).limit(options.limit || 50).offset(options.offset || 0);
  const countResult = await db.select({ count: sql`count(*)` }).from(budgetAllocationTracking).where(and(...conditions));
  return { trackings, total: countResult[0]?.count || 0 };
}
var TRACKING_DAYS;
var init_budgetTrackingService = __esm({
  "server/budget/budgetTrackingService.ts"() {
    "use strict";
    init_drizzle_orm();
    init_db2();
    init_schema2();
    TRACKING_DAYS = {
      "7_days": 7,
      "14_days": 14,
      "30_days": 30
    };
    __name(createTracking, "createTracking");
    __name(calculatePeriodMetrics, "calculatePeriodMetrics");
    __name(updateTrackingMetrics, "updateTrackingMetrics");
    __name(evaluateEffect, "evaluateEffect");
    __name(getTrackingReport, "getTrackingReport");
    __name(getTrackingList, "getTrackingList");
  }
});

