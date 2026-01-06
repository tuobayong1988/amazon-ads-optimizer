/**
 * Seasonal Budget Service - 季节性预算调整建议服务
 * 基于历史数据识别季节性趋势，在大促期间自动建议预算调整策略
 */

import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  seasonalTrends,
  promotionalEvents,
  seasonalBudgetRecommendations,
  dailyPerformance,
  campaigns,
  InsertSeasonalTrend,
  InsertPromotionalEvent,
  InsertSeasonalBudgetRecommendation,
} from "../drizzle/schema";

export type EventType = "prime_day" | "black_friday" | "cyber_monday" | "christmas" | "new_year" | "valentines" | "mothers_day" | "fathers_day" | "back_to_school" | "halloween" | "custom";
export type RecommendationType = "event_increase" | "event_warmup" | "seasonal_increase" | "seasonal_decrease" | "trend_based";

// 预定义的大促活动
const PREDEFINED_EVENTS: Partial<InsertPromotionalEvent>[] = [
  { eventName: "Prime Day 2026", eventType: "prime_day", marketplace: "US", startDate: new Date("2026-07-15"), endDate: new Date("2026-07-16"), warmupStartDate: new Date("2026-07-08"), warmupEndDate: new Date("2026-07-14"), recommendedBudgetMultiplier: "2.0", warmupBudgetMultiplier: "1.3" },
  { eventName: "黑色星期五 2026", eventType: "black_friday", marketplace: "US", startDate: new Date("2026-11-27"), endDate: new Date("2026-11-27"), warmupStartDate: new Date("2026-11-20"), warmupEndDate: new Date("2026-11-26"), recommendedBudgetMultiplier: "2.5", warmupBudgetMultiplier: "1.5" },
  { eventName: "网络星期一 2026", eventType: "cyber_monday", marketplace: "US", startDate: new Date("2026-11-30"), endDate: new Date("2026-11-30"), warmupStartDate: new Date("2026-11-28"), warmupEndDate: new Date("2026-11-29"), recommendedBudgetMultiplier: "2.0", warmupBudgetMultiplier: "1.3" },
  { eventName: "圣诞节 2026", eventType: "christmas", marketplace: "US", startDate: new Date("2026-12-20"), endDate: new Date("2026-12-25"), warmupStartDate: new Date("2026-12-01"), warmupEndDate: new Date("2026-12-19"), recommendedBudgetMultiplier: "1.8", warmupBudgetMultiplier: "1.3" },
];

/**
 * 初始化预定义的大促活动
 */
export async function initializePredefinedEvents(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  let count = 0;
  for (const event of PREDEFINED_EVENTS) {
    const existing = await db.select().from(promotionalEvents).where(and(eq(promotionalEvents.eventName, event.eventName!), eq(promotionalEvents.eventType, event.eventType!))).limit(1);
    if (existing.length === 0) {
      await db.insert(promotionalEvents).values(event as InsertPromotionalEvent);
      count++;
    }
  }
  return count;
}

/**
 * 获取所有大促活动
 */
export async function getPromotionalEvents(options: { marketplace?: string; isActive?: boolean } = {}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (options.marketplace) conditions.push(eq(promotionalEvents.marketplace, options.marketplace));
  if (options.isActive !== undefined) conditions.push(eq(promotionalEvents.isActive, options.isActive));
  return db.select().from(promotionalEvents).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(promotionalEvents.startDate);
}

/**
 * 创建自定义大促活动
 */
export async function createPromotionalEvent(event: InsertPromotionalEvent): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(promotionalEvents).values(event);
  return result[0].insertId;
}

/**
 * 分析历史数据生成季节性趋势
 */
export async function analyzeSeasonalTrends(userId: number, accountId?: number): Promise<InsertSeasonalTrend[]> {
  const db = await getDb();
  if (!db) return [];

  // 获取过去2年的月度数据
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

  const monthlyData = await db
    .select({
      year: sql<number>`YEAR(${dailyPerformance.date})`,
      month: sql<number>`MONTH(${dailyPerformance.date})`,
      avgDailySpend: sql<number>`AVG(${dailyPerformance.spend})`,
      avgDailySales: sql<number>`AVG(${dailyPerformance.sales})`,
      totalSpend: sql<number>`SUM(${dailyPerformance.spend})`,
      totalSales: sql<number>`SUM(${dailyPerformance.sales})`,
      totalOrders: sql<number>`SUM(${dailyPerformance.orders})`,
      dayCount: sql<number>`COUNT(DISTINCT DATE(${dailyPerformance.date}))`,
    })
    .from(dailyPerformance)
    .where(gte(dailyPerformance.date, twoYearsAgo))
    .groupBy(sql`YEAR(${dailyPerformance.date})`, sql`MONTH(${dailyPerformance.date})`)
    .orderBy(sql`YEAR(${dailyPerformance.date})`, sql`MONTH(${dailyPerformance.date})`);

  // 计算年平均值
  const yearlyAvg = monthlyData.reduce((acc, m) => {
    acc.spend += Number(m.avgDailySpend) || 0;
    acc.sales += Number(m.avgDailySales) || 0;
    acc.count++;
    return acc;
  }, { spend: 0, sales: 0, count: 0 });

  const avgSpend = yearlyAvg.count > 0 ? yearlyAvg.spend / yearlyAvg.count : 0;
  const avgSales = yearlyAvg.count > 0 ? yearlyAvg.sales / yearlyAvg.count : 0;

  // 生成季节性趋势记录
  const trends: InsertSeasonalTrend[] = [];
  for (const data of monthlyData) {
    const spend = Number(data.avgDailySpend) || 0;
    const sales = Number(data.avgDailySales) || 0;
    const seasonalIndex = avgSpend > 0 ? spend / avgSpend : 1;
    const roas = spend > 0 ? sales / spend : 0;
    const acos = sales > 0 ? (spend / sales) * 100 : 0;

    trends.push({
      userId,
      accountId: accountId ?? null,
      year: data.year,
      month: data.month,
      avgDailySpend: spend.toString(),
      avgDailySales: sales.toString(),
      avgRoas: roas.toString(),
      avgAcos: acos.toString(),
      seasonalIndex: seasonalIndex.toString(),
    });
  }

  return trends;
}

/**
 * 保存季节性趋势数据
 */
export async function saveSeasonalTrends(trends: InsertSeasonalTrend[]): Promise<number> {
  const db = await getDb();
  if (!db || trends.length === 0) return 0;

  for (const trend of trends) {
    const existing = await db.select().from(seasonalTrends).where(and(eq(seasonalTrends.userId, trend.userId), eq(seasonalTrends.year, trend.year!), eq(seasonalTrends.month, trend.month!))).limit(1);
    if (existing.length > 0) {
      await db.update(seasonalTrends).set({ ...trend, updatedAt: new Date() }).where(eq(seasonalTrends.id, existing[0].id));
    } else {
      await db.insert(seasonalTrends).values(trend);
    }
  }

  return trends.length;
}

/**
 * 获取季节性趋势数据
 */
export async function getSeasonalTrends(userId: number, accountId?: number) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(seasonalTrends.userId, userId)];
  if (accountId) conditions.push(eq(seasonalTrends.accountId, accountId));
  return db.select().from(seasonalTrends).where(and(...conditions)).orderBy(seasonalTrends.year, seasonalTrends.month);
}

/**
 * 生成季节性预算建议
 */
export async function generateSeasonalRecommendations(userId: number, accountId?: number): Promise<InsertSeasonalBudgetRecommendation[]> {
  const db = await getDb();
  if (!db) return [];

  const now = new Date();
  const recommendations: InsertSeasonalBudgetRecommendation[] = [];

  // 获取即将到来的大促活动（未来30天内）
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const upcomingEvents = await db.select().from(promotionalEvents).where(and(eq(promotionalEvents.isActive, true), gte(promotionalEvents.startDate, now), lte(promotionalEvents.startDate, thirtyDaysLater)));

  // 获取活跃的广告活动
  const conditions = [eq(campaigns.status, "enabled")];
  if (accountId) conditions.push(eq(campaigns.accountId, accountId));
  const activeCampaigns = await db.select().from(campaigns).where(and(...conditions));

  // 获取季节性趋势
  const trends = await getSeasonalTrends(userId, accountId);
  const currentMonth = now.getMonth() + 1;
  const currentTrend = trends.find(t => t.month === currentMonth);
  const seasonalIndex = currentTrend ? Number(currentTrend.seasonalIndex) : 1;

  for (const campaign of activeCampaigns) {
    const currentBudget = Number(campaign.maxBid) * 100 || 100;

    // 检查大促活动建议
    for (const event of upcomingEvents) {
      const isWarmup = event.warmupStartDate && now >= event.warmupStartDate && now < event.startDate;
      const isEvent = now >= event.startDate && now <= event.endDate;

      if (isWarmup || isEvent) {
        const multiplier = isEvent ? Number(event.recommendedBudgetMultiplier) : Number(event.warmupBudgetMultiplier);
        const recommendedBudget = currentBudget * multiplier;

        recommendations.push({
          userId,
          accountId: accountId ?? null,
          campaignId: campaign.id,
          eventId: event.id,
          recommendationType: isEvent ? "event_increase" : "event_warmup",
          currentBudget: currentBudget.toString(),
          recommendedBudget: recommendedBudget.toString(),
          budgetMultiplier: multiplier.toString(),
          effectiveStartDate: isEvent ? event.startDate : event.warmupStartDate!,
          effectiveEndDate: isEvent ? event.endDate : event.startDate,
          expectedSalesIncrease: ((multiplier - 1) * 80).toString(), // 预估销售增长
          reasoning: isEvent 
            ? `${event.eventName}期间，建议将预算提升${((multiplier - 1) * 100).toFixed(0)}%以把握流量高峰。`
            : `${event.eventName}预热期，建议适度提升预算${((multiplier - 1) * 100).toFixed(0)}%为大促做准备。`,
          confidenceScore: "85",
        });
      }
    }

    // 检查季节性趋势建议
    if (seasonalIndex > 1.2) {
      const multiplier = Math.min(seasonalIndex, 1.5);
      recommendations.push({
        userId,
        accountId: accountId ?? null,
        campaignId: campaign.id,
        recommendationType: "seasonal_increase",
        currentBudget: currentBudget.toString(),
        recommendedBudget: (currentBudget * multiplier).toString(),
        budgetMultiplier: multiplier.toString(),
        effectiveStartDate: now,
        effectiveEndDate: new Date(now.getFullYear(), now.getMonth() + 1, 0),
        reasoning: `当前月份历史表现高于平均水平（季节性指数${seasonalIndex.toFixed(2)}），建议提升预算以把握季节性机会。`,
        confidenceScore: "70",
      });
    } else if (seasonalIndex < 0.8) {
      const multiplier = Math.max(seasonalIndex, 0.7);
      recommendations.push({
        userId,
        accountId: accountId ?? null,
        campaignId: campaign.id,
        recommendationType: "seasonal_decrease",
        currentBudget: currentBudget.toString(),
        recommendedBudget: (currentBudget * multiplier).toString(),
        budgetMultiplier: multiplier.toString(),
        effectiveStartDate: now,
        effectiveEndDate: new Date(now.getFullYear(), now.getMonth() + 1, 0),
        reasoning: `当前月份历史表现低于平均水平（季节性指数${seasonalIndex.toFixed(2)}），建议适度降低预算以优化投资回报。`,
        confidenceScore: "65",
      });
    }
  }

  return recommendations;
}

/**
 * 保存季节性预算建议
 */
export async function saveRecommendations(recommendations: InsertSeasonalBudgetRecommendation[]): Promise<number> {
  const db = await getDb();
  if (!db || recommendations.length === 0) return 0;
  for (const rec of recommendations) {
    await db.insert(seasonalBudgetRecommendations).values(rec);
  }
  return recommendations.length;
}

/**
 * 获取季节性预算建议列表
 */
export async function getRecommendations(userId: number, options: { accountId?: number; status?: string; limit?: number; offset?: number } = {}) {
  const db = await getDb();
  if (!db) return { recommendations: [], total: 0 };
  const conditions = [eq(seasonalBudgetRecommendations.userId, userId)];
  if (options.accountId) conditions.push(eq(seasonalBudgetRecommendations.accountId, options.accountId));
  if (options.status) conditions.push(eq(seasonalBudgetRecommendations.status, options.status as any));
  const recs = await db.select().from(seasonalBudgetRecommendations).where(and(...conditions)).orderBy(desc(seasonalBudgetRecommendations.createdAt)).limit(options.limit || 50).offset(options.offset || 0);
  const countResult = await db.select({ count: sql<number>`count(*)` }).from(seasonalBudgetRecommendations).where(and(...conditions));
  return { recommendations: recs, total: countResult[0]?.count || 0 };
}

/**
 * 应用季节性预算建议
 */
export async function applyRecommendation(recommendationId: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(seasonalBudgetRecommendations).set({ status: "applied", appliedAt: new Date() }).where(and(eq(seasonalBudgetRecommendations.id, recommendationId), eq(seasonalBudgetRecommendations.userId, userId)));
  return true;
}

/**
 * 跳过季节性预算建议
 */
export async function skipRecommendation(recommendationId: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(seasonalBudgetRecommendations).set({ status: "skipped" }).where(and(eq(seasonalBudgetRecommendations.id, recommendationId), eq(seasonalBudgetRecommendations.userId, userId)));
  return true;
}


/**
 * 获取历史大促效果对比数据
 * 对比不同年份同一大促活动的表现
 */
export async function getEventPerformanceComparison(userId: number, options: { accountId?: number; eventType?: string } = {}) {
  const db = await getDb();
  if (!db) return { events: [], comparison: [] };

  // 获取所有历史大促活动
  const conditions = [];
  if (options.eventType) conditions.push(eq(promotionalEvents.eventType, options.eventType as EventType));
  
  const events = await db.select().from(promotionalEvents)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(promotionalEvents.startDate));

  // 获取每个大促期间的绩效数据
  const comparison: {
    eventId: number;
    eventName: string;
    eventType: string;
    year: number;
    startDate: Date;
    endDate: Date;
    totalSpend: number;
    totalSales: number;
    totalOrders: number;
    totalClicks: number;
    totalImpressions: number;
    avgRoas: number;
    avgAcos: number;
    avgCtr: number;
    avgCvr: number;
    roi: number; // 投资回报率 = (sales - spend) / spend * 100
    profit: number; // 毛利润 = sales - spend
    profitMargin: number; // 利润率 = profit / sales * 100
    daysCount: number;
  }[] = [];

  for (const event of events) {
    const perfData = await db
      .select({
        totalSpend: sql<number>`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
        totalSales: sql<number>`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
        totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
        totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
        totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
        daysCount: sql<number>`COUNT(DISTINCT DATE(${dailyPerformance.date}))`,
      })
      .from(dailyPerformance)
      .where(
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
    const roi = spend > 0 ? (profit / spend) * 100 : 0;
    const profitMargin = sales > 0 ? (profit / sales) * 100 : 0;

    comparison.push({
      eventId: event.id,
      eventName: event.eventName,
      eventType: event.eventType,
      year: event.startDate.getFullYear(),
      startDate: event.startDate,
      endDate: event.endDate,
      totalSpend: spend,
      totalSales: sales,
      totalOrders: orders,
      totalClicks: clicks,
      totalImpressions: impressions,
      avgRoas: spend > 0 ? sales / spend : 0,
      avgAcos: sales > 0 ? (spend / sales) * 100 : 0,
      avgCtr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      avgCvr: clicks > 0 ? (orders / clicks) * 100 : 0,
      roi,
      profit,
      profitMargin,
      daysCount: Number(data?.daysCount) || 0,
    });
  }

  // 按事件类型分组，方便年度对比
  const groupedByType: Record<string, typeof comparison> = {};
  for (const item of comparison) {
    if (!groupedByType[item.eventType]) {
      groupedByType[item.eventType] = [];
    }
    groupedByType[item.eventType].push(item);
  }

  // 计算年度同比变化
  const yearOverYearComparison: {
    eventType: string;
    eventName: string;
    currentYear: number;
    previousYear: number;
    spendChange: number;
    salesChange: number;
    roasChange: number;
    acosChange: number;
    ordersChange: number;
    roiChange: number; // ROI变化
    profitChange: number; // 利润变化
  }[] = [];

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
        spendChange: previous.totalSpend > 0 ? ((current.totalSpend - previous.totalSpend) / previous.totalSpend) * 100 : 0,
        salesChange: previous.totalSales > 0 ? ((current.totalSales - previous.totalSales) / previous.totalSales) * 100 : 0,
        roasChange: previous.avgRoas > 0 ? ((current.avgRoas - previous.avgRoas) / previous.avgRoas) * 100 : 0,
        acosChange: previous.avgAcos > 0 ? ((current.avgAcos - previous.avgAcos) / previous.avgAcos) * 100 : 0,
        ordersChange: previous.totalOrders > 0 ? ((current.totalOrders - previous.totalOrders) / previous.totalOrders) * 100 : 0,
        roiChange: previous.roi > 0 ? ((current.roi - previous.roi) / Math.abs(previous.roi)) * 100 : 0,
        profitChange: previous.profit !== 0 ? ((current.profit - previous.profit) / Math.abs(previous.profit)) * 100 : 0,
      });
    }
  }

  return {
    events,
    comparison,
    groupedByType,
    yearOverYearComparison,
  };
}

/**
 * 获取大促活动效果汇总统计
 */
export async function getEventSummaryStats(userId: number, options: { accountId?: number; years?: number[] } = {}) {
  const db = await getDb();
  if (!db) return { stats: [], avgByType: {} };

  const { comparison } = await getEventPerformanceComparison(userId, options);

  // 按事件类型计算平均值
  const avgByType: Record<string, {
    avgSpend: number;
    avgSales: number;
    avgRoas: number;
    avgAcos: number;
    avgOrders: number;
    avgRoi: number;
    avgProfit: number;
    avgProfitMargin: number;
    eventCount: number;
  }> = {};

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
        eventCount: 0,
      };
    }
    const stats = avgByType[item.eventType];
    stats.avgSpend += item.totalSpend;
    stats.avgSales += item.totalSales;
    stats.avgRoas += item.avgRoas;
    stats.avgAcos += item.avgAcos;
    stats.avgOrders += item.totalOrders;
    stats.avgRoi += item.roi;
    stats.avgProfit += item.profit;
    stats.avgProfitMargin += item.profitMargin;
    stats.eventCount++;
  }

  // 计算平均值
  for (const type of Object.keys(avgByType)) {
    const stats = avgByType[type];
    if (stats.eventCount > 0) {
      stats.avgSpend /= stats.eventCount;
      stats.avgSales /= stats.eventCount;
      stats.avgRoas /= stats.eventCount;
      stats.avgAcos /= stats.eventCount;
      stats.avgOrders /= stats.eventCount;
      stats.avgRoi /= stats.eventCount;
      stats.avgProfit /= stats.eventCount;
      stats.avgProfitMargin /= stats.eventCount;
    }
  }

  return {
    stats: comparison,
    avgByType,
  };
}
