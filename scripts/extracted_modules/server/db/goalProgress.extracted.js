// Extracted from production dist/index.js
// Original module: server/db/goalProgress.ts
// Lines: 311

async function getGoalProgressTrendData(performanceGroupId2, groupCreatedAt) {
  const db = await getDb();
  if (!db) return { before: null, after: null };
  const createdDate = new Date(groupCreatedAt).toISOString().split("T")[0];
  try {
    const groupCampaigns = await db.select({ id: campaigns.id, campaignId: campaigns.campaignId }).from(campaigns).where(eq(campaigns.performanceGroupId, performanceGroupId2));
    if (groupCampaigns.length === 0) return { before: null, after: null };
    const campaignIds = groupCampaigns.map((c) => c.campaignId);
    const beforeData = await db.select({
      days: sql`COUNT(DISTINCT ${dailyPerformance.date})`,
      totalSpend: sql`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
      totalSales: sql`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
      totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
      totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
      totalImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`
    }).from(dailyPerformance).where(and(
      inArray(dailyPerformance.campaignId, campaignIds),
      sql`${dailyPerformance.date} < ${createdDate}`
    ));
    const afterData = await db.select({
      days: sql`COUNT(DISTINCT ${dailyPerformance.date})`,
      totalSpend: sql`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
      totalSales: sql`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
      totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
      totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
      totalImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`
    }).from(dailyPerformance).where(and(
      inArray(dailyPerformance.campaignId, campaignIds),
      sql`${dailyPerformance.date} >= ${createdDate}`
    ));
    const before = beforeData[0] || null;
    const after = afterData[0] || null;
    return { before, after };
  } catch (error48) {
    log18.warn(`[getGoalProgressTrendData] Error for group ${performanceGroupId2}:`, error48);
    return { before: null, after: null };
  }
}
async function getMultiWindowTrendData(performanceGroupId2, groupCreatedAt) {
  const db = await getDb();
  if (!db) return null;
  try {
    const groupCampaigns = await db.select({ id: campaigns.id, campaignId: campaigns.campaignId }).from(campaigns).where(eq(campaigns.performanceGroupId, performanceGroupId2));
    if (groupCampaigns.length === 0) return null;
    const campaignIds = groupCampaigns.map((c) => c.campaignId);
    const createdDate = new Date(groupCreatedAt).toISOString().split("T")[0];
    const now = /* @__PURE__ */ new Date();
    const getWindowData = /* @__PURE__ */ __name(async (daysBack) => {
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - daysBack);
      const startStr = startDate.toISOString().split("T")[0];
      const result = await db.select({
        days: sql`COUNT(DISTINCT ${dailyPerformance.date})`,
        totalSpend: sql`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
        totalSales: sql`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
        totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
        totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
        totalImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`
      }).from(dailyPerformance).where(and(
        inArray(dailyPerformance.campaignId, campaignIds),
        sql`${dailyPerformance.date} >= ${startStr}`
      ));
      return result[0] || null;
    }, "getWindowData");
    const preOptData = await db.select({
      days: sql`COUNT(DISTINCT ${dailyPerformance.date})`,
      totalSpend: sql`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
      totalSales: sql`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
      totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
      totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
      totalImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`
    }).from(dailyPerformance).where(and(
      inArray(dailyPerformance.campaignId, campaignIds),
      sql`${dailyPerformance.date} < ${createdDate}`
    ));
    const [recent7d, recent14d, recent30d, recent60d, recent90d] = await Promise.all([
      getWindowData(7),
      getWindowData(14),
      getWindowData(30),
      getWindowData(60),
      getWindowData(90)
    ]);
    return {
      recent7d,
      recent14d,
      recent30d,
      recent60d,
      recent90d,
      preOptimization: preOptData[0] || null
    };
  } catch (error48) {
    log18.warn(`[getMultiWindowTrendData] Error for group ${performanceGroupId2}:`, error48);
    return null;
  }
}
async function getTimeWeightedMetricsForGoalProgress(performanceGroupId2) {
  const db = await getDb();
  if (!db) return null;
  try {
    const groupCampaigns = await db.select({ id: campaigns.id, campaignId: campaigns.campaignId }).from(campaigns).where(eq(campaigns.performanceGroupId, performanceGroupId2));
    if (groupCampaigns.length === 0) return null;
    const campaignIds = groupCampaigns.map((c) => c.campaignId);
    const now = /* @__PURE__ */ new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 90);
    const startStr = startDate.toISOString().split("T")[0];
    const dailyData = await db.select({
      date: dailyPerformance.date,
      spend: sql`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
      sales: sql`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
      orders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
      clicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
      impressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`
    }).from(dailyPerformance).where(and(
      inArray(dailyPerformance.campaignId, campaignIds),
      sql`${dailyPerformance.date} >= ${startStr}`
    )).groupBy(dailyPerformance.date).orderBy(dailyPerformance.date);
    if (dailyData.length === 0) return null;
    const TIME_DECAY_WEIGHTS = [
      { maxDaysAgo: 3, weight: 1 },
      { maxDaysAgo: 7, weight: 0.85 },
      { maxDaysAgo: 14, weight: 0.65 },
      { maxDaysAgo: 30, weight: 0.4 },
      { maxDaysAgo: 60, weight: 0.2 },
      { maxDaysAgo: 90, weight: 0.08 }
    ];
    const ATTRIBUTION_CORRECTION = [
      { daysAgo: 1, factor: 1.8 },
      { daysAgo: 2, factor: 1.5 },
      { daysAgo: 3, factor: 1.3 },
      { daysAgo: 4, factor: 1.2 },
      { daysAgo: 5, factor: 1.15 },
      { daysAgo: 6, factor: 1.1 },
      { daysAgo: 7, factor: 1.05 }
    ];
    let weightedSpend = 0;
    let weightedSales = 0;
    let weightedOrders = 0;
    let weightedClicks = 0;
    let weightedImpressions = 0;
    let totalWeight = 0;
    let effectiveDataDays = 0;
    let totalClicksRaw = 0;
    let recent7dSpend = 0, recent7dSales = 0;
    let recent30dSpend = 0, recent30dSales = 0;
    for (const day2 of dailyData) {
      const dayDate = new Date(day2.date);
      const daysAgo = Math.floor((now.getTime() - dayDate.getTime()) / (1e3 * 60 * 60 * 24));
      let weight = 0.08;
      for (const tw of TIME_DECAY_WEIGHTS) {
        if (daysAgo <= tw.maxDaysAgo) {
          weight = tw.weight;
          break;
        }
      }
      let attributionFactor = 1;
      for (const ac of ATTRIBUTION_CORRECTION) {
        if (daysAgo <= ac.daysAgo) {
          attributionFactor = ac.factor;
          break;
        }
      }
      const spend = Number(day2.spend) || 0;
      const sales = (Number(day2.sales) || 0) * attributionFactor;
      const orders = (Number(day2.orders) || 0) * attributionFactor;
      const clicks = Number(day2.clicks) || 0;
      const impressions = Number(day2.impressions) || 0;
      weightedSpend += spend * weight;
      weightedSales += sales * weight;
      weightedOrders += orders * weight;
      weightedClicks += clicks * weight;
      weightedImpressions += impressions * weight;
      totalWeight += weight;
      totalClicksRaw += clicks;
      if (spend > 0 || clicks > 0) effectiveDataDays++;
      if (daysAgo <= 7) {
        recent7dSpend += spend;
        recent7dSales += sales;
      }
      if (daysAgo <= 30) {
        recent30dSpend += spend;
        recent30dSales += sales;
      }
    }
    if (totalWeight === 0) return null;
    const weightedDailySpend = weightedSpend / totalWeight;
    const weightedDailySales = weightedSales / totalWeight;
    const weightedDailyOrders = weightedOrders / totalWeight;
    const weightedAcos = weightedSales > 0 ? weightedSpend / weightedSales * 100 : 0;
    const weightedRoas = weightedSpend > 0 ? weightedSales / weightedSpend : 0;
    const weightedCvr = weightedClicks > 0 ? weightedOrders / weightedClicks * 100 : 0;
    const weightedCpc = weightedClicks > 0 ? weightedSpend / weightedClicks : 0;
    let dataConfidence;
    if (effectiveDataDays >= 30 && totalClicksRaw >= 200) dataConfidence = "high";
    else if (effectiveDataDays >= 14 && totalClicksRaw >= 50) dataConfidence = "medium";
    else if (effectiveDataDays >= 7 && totalClicksRaw >= 10) dataConfidence = "low";
    else dataConfidence = "very_low";
    let trendDirection;
    const recent7dRoas = recent7dSpend > 0 ? recent7dSales / recent7dSpend : 0;
    const recent30dRoas = recent30dSpend > 0 ? recent30dSales / recent30dSpend : 0;
    if (recent30dRoas > 0) {
      const roasChange = (recent7dRoas - recent30dRoas) / recent30dRoas;
      if (roasChange > 0.05) trendDirection = "improving";
      else if (roasChange < -0.05) trendDirection = "declining";
      else trendDirection = "stable";
    } else {
      trendDirection = recent7dRoas > 0 ? "improving" : "stable";
    }
    return {
      weightedAcos,
      weightedRoas,
      weightedDailySpend,
      weightedDailySales,
      weightedDailyOrders,
      weightedCvr,
      weightedCpc,
      dataConfidence,
      trendDirection,
      effectiveDataDays
    };
  } catch (error48) {
    log18.warn(`[getTimeWeightedMetricsForGoalProgress] Error for group ${performanceGroupId2}:`, error48);
    return null;
  }
}
async function getAccountLevelMetrics(accountId) {
  try {
    const dbConn = await getDb();
    if (!dbConn) return null;
    const thirtyDaysAgo = /* @__PURE__ */ new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const result = await dbConn.select({
      totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
      totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
      totalSpend: sql`COALESCE(SUM(${dailyPerformance.spend}), '0')`,
      totalSales: sql`COALESCE(SUM(${dailyPerformance.sales}), '0')`
    }).from(dailyPerformance).where(
      and(
        eq(dailyPerformance.accountId, accountId),
        gte(dailyPerformance.date, thirtyDaysAgo.toISOString().split("T")[0])
      )
    );
    const row = result[0];
    if (!row || row.totalClicks === 0) return null;
    const totalClicks = Number(row.totalClicks);
    const totalOrders = Number(row.totalOrders);
    const totalSpend = parseFloat(row.totalSpend);
    const totalSales = parseFloat(row.totalSales);
    return {
      totalClicks,
      totalOrders,
      totalSpend,
      totalSales,
      accountAvgCvr: totalClicks > 0 ? totalOrders / totalClicks : 0,
      accountAvgCpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
      accountAvgAov: totalOrders > 0 ? totalSales / totalOrders : 0
    };
  } catch (error48) {
    log18.warn(`[getAccountLevelMetrics] Error for account ${accountId}:`, error48);
    return null;
  }
}
async function getCrossCampaignCategoryMetrics(accountId, excludePerformanceGroupId) {
  try {
    const dbConn = await getDb();
    if (!dbConn) return null;
    const thirtyDaysAgo = /* @__PURE__ */ new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const result = await dbConn.select({
      totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
      totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`
    }).from(dailyPerformance).where(
      and(
        eq(dailyPerformance.accountId, accountId),
        gte(dailyPerformance.date, thirtyDaysAgo.toISOString().split("T")[0]),
        // 排除当前优化目标的数据，避免自引用
        excludePerformanceGroupId ? sql`${dailyPerformance.performanceGroupId} != ${excludePerformanceGroupId}` : sql`1=1`
      )
      // @ts-ignore
    );
    const row = result[0];
    if (!row || Number(row.totalClicks) === 0) return null;
    const totalClicks = Number(row.totalClicks);
    const totalOrders = Number(row.totalOrders);
    return {
      totalClicks,
      totalOrders,
      crossCampaignCvr: totalClicks > 0 ? totalOrders / totalClicks : 0
    };
  } catch (error48) {
    log18.warn(`[getCrossCampaignCategoryMetrics] Error for account ${accountId}:`, error48);
    return null;
  }
}
var log18;
var init_goalProgress = __esm({
  "server/db/goalProgress.ts"() {
    "use strict";
    init_drizzle_orm();
    init_connection();
    init_logger();
    init_schema2();
    log18 = createModuleLogger("DB:goalProgress");
    __name(getGoalProgressTrendData, "getGoalProgressTrendData");
    __name(getMultiWindowTrendData, "getMultiWindowTrendData");
    __name(getTimeWeightedMetricsForGoalProgress, "getTimeWeightedMetricsForGoalProgress");
    __name(getAccountLevelMetrics, "getAccountLevelMetrics");
    __name(getCrossCampaignCategoryMetrics, "getCrossCampaignCategoryMetrics");
  }
});

