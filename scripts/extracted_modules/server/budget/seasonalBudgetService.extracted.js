// Extracted from production dist/index.js
// Original module: server/budget/seasonalBudgetService.ts
// Lines: 282

async function getPromotionalEvents(options = {}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (options.marketplace) conditions.push(eq(promotionalEvents.marketplace, options.marketplace));
  if (options.isActive !== void 0) conditions.push(eq(promotionalEvents.isActive, options.isActive ? 1 : 0));
  return db.select().from(promotionalEvents).where(conditions.length > 0 ? and(...conditions) : void 0).orderBy(promotionalEvents.startDate);
}
async function getSeasonalTrends(userId, accountId) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(seasonalTrends.userId, userId)];
  if (accountId) conditions.push(eq(seasonalTrends.accountId, accountId));
  return db.select().from(seasonalTrends).where(and(...conditions)).orderBy(seasonalTrends.year, seasonalTrends.month);
}
async function generateSeasonalRecommendations(userId, accountId) {
  const db = await getDb();
  if (!db) return [];
  const now = /* @__PURE__ */ new Date();
  const recommendations = [];
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1e3);
  const nowStr = now.toISOString().slice(0, 19).replace("T", " ");
  const thirtyDaysLaterStr = thirtyDaysLater.toISOString().slice(0, 19).replace("T", " ");
  const upcomingEvents = await db.select().from(promotionalEvents).where(and(eq(promotionalEvents.isActive, 1), gte(promotionalEvents.startDate, nowStr), lte(promotionalEvents.startDate, thirtyDaysLaterStr)));
  const conditions = [eq(campaigns.campaignStatus, "enabled")];
  if (accountId) conditions.push(eq(campaigns.accountId, accountId));
  const activeCampaigns = await db.select().from(campaigns).where(and(...conditions));
  const trends = await getSeasonalTrends(userId, accountId);
  const currentMonth = now.getMonth() + 1;
  const currentTrend = trends.find((t2) => t2.month === currentMonth);
  const seasonalIndex = currentTrend ? Number(currentTrend.seasonalIndex) : 1;
  for (const campaign of activeCampaigns) {
    const currentBudget = Number(campaign.maxBid) * 100 || 100;
    for (const event of upcomingEvents) {
      const isWarmup = event.warmupStartDate && now >= new Date(event.warmupStartDate) && now < new Date(event.startDate);
      const isEvent = now >= new Date(event.startDate) && now <= new Date(event.endDate);
      if (isWarmup || isEvent) {
        const multiplier = isEvent ? Number(event.recommendedBudgetMultiplier) : Number(event.warmupBudgetMultiplier);
        const recommendedBudget = currentBudget * multiplier;
        recommendations.push({
          userId,
          // @ts-ignore
          accountId: accountId ?? null,
          // @ts-ignore
          campaignId: campaign.campaignId,
          eventId: event.id,
          recommendationType: isEvent ? "event_increase" : "event_warmup",
          currentBudget: currentBudget.toString(),
          recommendedBudget: recommendedBudget.toString(),
          budgetMultiplier: multiplier.toString(),
          effectiveStartDate: isEvent ? event.startDate : event.warmupStartDate,
          effectiveEndDate: isEvent ? event.endDate : event.startDate,
          expectedSalesIncrease: ((multiplier - 1) * 80).toString(),
          // 预估销售增长
          reasoning: isEvent ? `${event.eventName}\u671F\u95F4\uFF0C\u5EFA\u8BAE\u5C06\u9884\u7B97\u63D0\u5347${((multiplier - 1) * 100).toFixed(0)}%\u4EE5\u628A\u63E1\u6D41\u91CF\u9AD8\u5CF0\u3002` : `${event.eventName}\u9884\u70ED\u671F\uFF0C\u5EFA\u8BAE\u9002\u5EA6\u63D0\u5347\u9884\u7B97${((multiplier - 1) * 100).toFixed(0)}%\u4E3A\u5927\u4FC3\u505A\u51C6\u5907\u3002`,
          confidenceScore: "85"
          // @ts-ignore
        });
      }
    }
    if (seasonalIndex > 1.2) {
      const multiplier = Math.min(seasonalIndex, 1.5);
      recommendations.push({
        userId,
        // @ts-ignore
        accountId: accountId ?? null,
        // @ts-ignore
        campaignId: campaign.campaignId,
        recommendationType: "seasonal_increase",
        currentBudget: currentBudget.toString(),
        // @ts-ignore
        recommendedBudget: (currentBudget * multiplier).toString(),
        // @ts-ignore
        budgetMultiplier: multiplier.toString(),
        effectiveStartDate: now.toISOString(),
        effectiveEndDate: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString(),
        reasoning: `\u5F53\u524D\u6708\u4EFD\u5386\u53F2\u8868\u73B0\u9AD8\u4E8E\u5E73\u5747\u6C34\u5E73\uFF08\u5B63\u8282\u6027\u6307\u6570${seasonalIndex.toFixed(2)}\uFF09\uFF0C\u5EFA\u8BAE\u63D0\u5347\u9884\u7B97\u4EE5\u628A\u63E1\u5B63\u8282\u6027\u673A\u4F1A\u3002`,
        confidenceScore: "70"
      });
    } else if (seasonalIndex < 0.8) {
      const multiplier = Math.max(seasonalIndex, 0.7);
      recommendations.push({
        userId,
        // @ts-ignore
        accountId: accountId ?? null,
        // @ts-ignore
        campaignId: campaign.campaignId,
        recommendationType: "seasonal_decrease",
        currentBudget: currentBudget.toString(),
        recommendedBudget: (currentBudget * multiplier).toString(),
        budgetMultiplier: multiplier.toString(),
        effectiveStartDate: now.toISOString(),
        effectiveEndDate: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString(),
        reasoning: `\u5F53\u524D\u6708\u4EFD\u5386\u53F2\u8868\u73B0\u4F4E\u4E8E\u5E73\u5747\u6C34\u5E73\uFF08\u5B63\u8282\u6027\u6307\u6570${seasonalIndex.toFixed(2)}\uFF09\uFF0C\u5EFA\u8BAE\u9002\u5EA6\u964D\u4F4E\u9884\u7B97\u4EE5\u4F18\u5316\u6295\u8D44\u56DE\u62A5\u3002`,
        confidenceScore: "65"
      });
    }
  }
  return recommendations;
}
async function saveRecommendations(recommendations) {
  const db = await getDb();
  if (!db || recommendations.length === 0) return 0;
  for (const rec of recommendations) {
    await db.insert(seasonalBudgetRecommendations).values(rec);
  }
  return recommendations.length;
}
async function getRecommendations(userId, options = {}) {
  const db = await getDb();
  if (!db) return { recommendations: [], total: 0 };
  const conditions = [eq(seasonalBudgetRecommendations.userId, userId)];
  if (options.accountId) conditions.push(eq(seasonalBudgetRecommendations.accountId, options.accountId));
  if (options.status) conditions.push(eq(seasonalBudgetRecommendations.status, options.status));
  const recs = await db.select().from(seasonalBudgetRecommendations).where(and(...conditions)).orderBy(desc(seasonalBudgetRecommendations.createdAt)).limit(options.limit || 50).offset(options.offset || 0);
  const countResult = await db.select({ count: sql`count(*)` }).from(seasonalBudgetRecommendations).where(and(...conditions));
  return { recommendations: recs, total: countResult[0]?.count || 0 };
}
async function applyRecommendation(recommendationId, userId) {
  const db = await getDb();
  if (!db) return false;
  await db.update(seasonalBudgetRecommendations).set({ status: "applied", appliedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ") }).where(and(eq(seasonalBudgetRecommendations.id, recommendationId), eq(seasonalBudgetRecommendations.userId, userId)));
  return true;
}
async function getEventPerformanceComparison(userId, options = {}) {
  const db = await getDb();
  if (!db) return { events: [], comparison: [] };
  const conditions = [];
  if (options.eventType) conditions.push(eq(promotionalEvents.eventType, options.eventType));
  const events = await db.select().from(promotionalEvents).where(conditions.length > 0 ? and(...conditions) : void 0).orderBy(desc(promotionalEvents.startDate));
  const comparison = [];
  for (const event of events) {
    const perfData = await db.select({
      totalSpend: sql`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
      totalSales: sql`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
      totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
      // @ts-ignore
      totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
      // @ts-ignore
      totalImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
      // @ts-ignore
      daysCount: sql`COUNT(DISTINCT DATE(${dailyPerformance.date}))`
      // @ts-ignore
    }).from(dailyPerformance).where(
      and(
        gte(dailyPerformance.date, event.startDate),
        lte(dailyPerformance.date, event.endDate)
      )
    );
    const data = perfData[0];
    const spend = Number(data?.totalSpend) || 0;
    const sales = Number(data?.totalSales) || 0;
    const orders = Number(data?.totalOrders) || 0;
    const clicks = Number(data?.totalClicks) || 0;
    const impressions = Number(data?.totalImpressions) || 0;
    const profit = sales - spend;
    const roi = spend > 0 ? profit / spend * 100 : 0;
    const profitMargin = sales > 0 ? profit / sales * 100 : 0;
    comparison.push({
      // @ts-ignore
      eventId: event.id,
      eventName: event.eventName,
      eventType: event.eventType,
      year: new Date(event.startDate).getFullYear(),
      startDate: new Date(event.startDate),
      endDate: new Date(event.endDate),
      totalSpend: spend,
      totalSales: sales,
      totalOrders: orders,
      totalClicks: clicks,
      totalImpressions: impressions,
      avgRoas: spend > 0 ? sales / spend : 0,
      avgAcos: sales > 0 ? spend / sales * 100 : 0,
      avgCtr: impressions > 0 ? clicks / impressions * 100 : 0,
      avgCvr: clicks > 0 ? orders / clicks * 100 : 0,
      roi,
      profit,
      profitMargin,
      // @ts-ignore
      daysCount: Number(data?.daysCount) || 0
    });
  }
  const groupedByType = {};
  for (const item of comparison) {
    if (!groupedByType[item.eventType]) {
      groupedByType[item.eventType] = [];
    }
    groupedByType[item.eventType].push(item);
  }
  const yearOverYearComparison = [];
  for (const [eventType, items] of Object.entries(groupedByType)) {
    const sortedByYear = items.sort((a, b) => b.year - a.year);
    for (let i = 0; i < sortedByYear.length - 1; i++) {
      const current = sortedByYear[i];
      const previous = sortedByYear[i + 1];
      yearOverYearComparison.push({
        eventType,
        eventName: current.eventName,
        currentYear: current.year,
        previousYear: previous.year,
        spendChange: previous.totalSpend > 0 ? (current.totalSpend - previous.totalSpend) / previous.totalSpend * 100 : 0,
        salesChange: previous.totalSales > 0 ? (current.totalSales - previous.totalSales) / previous.totalSales * 100 : 0,
        roasChange: previous.avgRoas > 0 ? (current.avgRoas - previous.avgRoas) / previous.avgRoas * 100 : 0,
        acosChange: previous.avgAcos > 0 ? (current.avgAcos - previous.avgAcos) / previous.avgAcos * 100 : 0,
        ordersChange: previous.totalOrders > 0 ? (current.totalOrders - previous.totalOrders) / previous.totalOrders * 100 : 0,
        roiChange: previous.roi > 0 ? (current.roi - previous.roi) / Math.abs(previous.roi) * 100 : 0,
        profitChange: previous.profit !== 0 ? (current.profit - previous.profit) / Math.abs(previous.profit) * 100 : 0
      });
    }
  }
  return {
    events,
    comparison,
    groupedByType,
    yearOverYearComparison
  };
}
async function getEventSummaryStats(userId, options = {}) {
  const db = await getDb();
  if (!db) return { stats: [], avgByType: {} };
  const { comparison } = await getEventPerformanceComparison(userId, options);
  const avgByType = {};
  for (const item of comparison) {
    if (!avgByType[item.eventType]) {
      avgByType[item.eventType] = {
        avgSpend: 0,
        avgSales: 0,
        avgRoas: 0,
        avgAcos: 0,
        avgOrders: 0,
        avgRoi: 0,
        avgProfit: 0,
        avgProfitMargin: 0,
        eventCount: 0
      };
    }
    const stats4 = avgByType[item.eventType];
    stats4.avgSpend += item.totalSpend;
    stats4.avgSales += item.totalSales;
    stats4.avgRoas += item.avgRoas;
    stats4.avgAcos += item.avgAcos;
    stats4.avgOrders += item.totalOrders;
    stats4.avgRoi += item.roi;
    stats4.avgProfit += item.profit;
    stats4.avgProfitMargin += item.profitMargin;
    stats4.eventCount++;
  }
  for (const type of Object.keys(avgByType)) {
    const stats4 = avgByType[type];
    if (stats4.eventCount > 0) {
      stats4.avgSpend /= stats4.eventCount;
      stats4.avgSales /= stats4.eventCount;
      stats4.avgRoas /= stats4.eventCount;
      stats4.avgAcos /= stats4.eventCount;
      stats4.avgOrders /= stats4.eventCount;
      stats4.avgRoi /= stats4.eventCount;
      stats4.avgProfit /= stats4.eventCount;
      stats4.avgProfitMargin /= stats4.eventCount;
    }
  }
  return {
    stats: comparison,
    avgByType
  };
}
var init_seasonalBudgetService = __esm({
  "server/budget/seasonalBudgetService.ts"() {
    "use strict";
    init_drizzle_orm();
    init_db2();
    init_schema2();
    __name(getPromotionalEvents, "getPromotionalEvents");
    __name(getSeasonalTrends, "getSeasonalTrends");
    __name(generateSeasonalRecommendations, "generateSeasonalRecommendations");
    __name(saveRecommendations, "saveRecommendations");
    __name(getRecommendations, "getRecommendations");
    __name(applyRecommendation, "applyRecommendation");
    __name(getEventPerformanceComparison, "getEventPerformanceComparison");
    __name(getEventSummaryStats, "getEventSummaryStats");
  }
});

