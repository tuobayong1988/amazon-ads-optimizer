/**
 * Budget Tracking Service - 预算分配效果追踪服务
 * 追踪预算分配方案应用后的效果，生成对比报告
 */

import { eq, and, desc, gte, lte, sql, InferInsertModel } from "drizzle-orm";
import { getDb } from "../db";
import {
  budgetAllocationTracking,
  budgetAllocations,
  dailyPerformance,
  campaigns,
} from "../../drizzle/schema";

type InsertBudgetAllocationTracking = InferInsertModel<typeof budgetAllocationTracking>;

export type TrackingPeriod = "7_days" | "14_days" | "30_days";
export type EffectRating = "excellent" | "good" | "neutral" | "poor" | "very_poor";

interface PerformanceMetrics {
  spend: number;
  sales: number;
  roas: number;
  acos: number;
  conversions: number;
  ctr: number;
  cpc: number;
}

interface TrackingReport {
  trackingId: number;
  allocationId: number;
  trackingPeriod: TrackingPeriod;
  startDate: Date;
  endDate: Date | null;
  baseline: PerformanceMetrics;
  current: PerformanceMetrics;
  changes: {
    roasChange: number;
    acosChange: number;
    salesChange: number;
    spendChange: number;
    roasChangePercent: number;
    acosChangePercent: number;
    salesChangePercent: number;
    spendChangePercent: number;
  };
  effectRating: EffectRating;
  effectSummary: string;
  status: string;
}

const TRACKING_DAYS: Record<TrackingPeriod, number> = {
  "7_days": 7,
  "14_days": 14,
  "30_days": 30,
};

/**
 * 创建效果追踪记录
 */
export async function createTracking(
  userId: number,
  allocationId: number,
  trackingPeriod: TrackingPeriod = "7_days",
  accountId?: number
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  const now = new Date();
  const baselineDays = TRACKING_DAYS[trackingPeriod];
  const baselineEndDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const baselineStartDate = new Date(baselineEndDate.getTime() - baselineDays * 24 * 60 * 60 * 1000);

  // 获取基准期指标
  const baselineMetrics = await calculatePeriodMetrics(userId, baselineStartDate, baselineEndDate, accountId);

  const trackingData: InsertBudgetAllocationTracking = {
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
    status: "tracking",
  };

  const result = await db.insert(budgetAllocationTracking).values(trackingData);
  return result[0].insertId;
}

/**
 * 计算指定时间段的绩效指标
 */
async function calculatePeriodMetrics(
  userId: number,
  startDate: Date,
  endDate: Date,
  accountId?: number
): Promise<PerformanceMetrics> {
  const db = await getDb();
  if (!db) return { spend: 0, sales: 0, roas: 0, acos: 0, conversions: 0, ctr: 0, cpc: 0 };

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  // v401: 优化WHERE条件 - 避免DATE()函数包裹以利用索引
  const conditions = [
    sql`${dailyPerformance.date} >= ${startDateStr}`,
    sql`${dailyPerformance.date} < DATE_ADD(${endDateStr}, INTERVAL 1 DAY)`,
  ];

  const performance = await db
    .select({
      totalSpend: sql<number>`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
      totalSales: sql<number>`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
      totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
      totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
      totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
    })
    .from(dailyPerformance)
    .where(and(...conditions));

  // @ts-ignore
  const data = performance[0] as unknown;
  // @ts-ignore
  const spend = Number(data?.totalSpend) || 0;
  // @ts-ignore
  const sales = Number(data?.totalSales) || 0;
  // @ts-ignore
  const impressions = Number(data?.totalImpressions) || 0;
  // @ts-ignore
  const clicks = Number(data?.totalClicks) || 0;
  // @ts-ignore
  const orders = Number(data?.totalOrders) || 0;

  return {
    spend,
    sales,
    roas: spend > 0 ? sales / spend : 0,
    acos: sales > 0 ? (spend / sales) * 100 : 0,
    conversions: orders,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
  };
}

/**
 * 更新追踪记录的当前指标
 */
export async function updateTrackingMetrics(trackingId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const tracking = await db
    .select()
    .from(budgetAllocationTracking)
    .where(eq(budgetAllocationTracking.id, trackingId))
    // @ts-ignore
    .limit(1);

  if (!tracking[0]) return false;

  const record = tracking[0] as unknown;
  const now = new Date();
  // @ts-ignore
  const trackingDays = TRACKING_DAYS[record.trackingPeriod as TrackingPeriod];
  // @ts-ignore
  const startDateObj = new Date(record.startDate);
  const expectedEndDate = new Date(startDateObj.getTime() + trackingDays * 24 * 60 * 60 * 1000);

  // 计算当前指标
  // @ts-ignore
  const currentMetrics = await calculatePeriodMetrics(
    // @ts-ignore
    record.userId,
    // @ts-ignore
    startDateObj,
    now,
    // @ts-ignore
    record.accountId ?? undefined
  );

  // 计算变化
  // @ts-ignore
  const baselineRoas = Number(record.baselineRoas) || 0;
  // @ts-ignore
  const baselineAcos = Number(record.baselineAcos) || 0;
  // @ts-ignore
  const baselineSales = Number(record.baselineSales) || 0;
  // @ts-ignore
  const baselineSpend = Number(record.baselineSpend) || 0;

  const roasChange = currentMetrics.roas - baselineRoas;
  const acosChange = currentMetrics.acos - baselineAcos;
  const salesChange = currentMetrics.sales - baselineSales;
  const spendChange = currentMetrics.spend - baselineSpend;

  // 评估效果
  const { rating, summary } = evaluateEffect(
    { roas: baselineRoas, acos: baselineAcos, sales: baselineSales, spend: baselineSpend },
    currentMetrics,
    { roasChange, acosChange, salesChange, spendChange }
  );

  // 检查是否完成追踪
  const isCompleted = now >= expectedEndDate;

  await db
    .update(budgetAllocationTracking)
    .set({
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
      updatedAt: now.toISOString(),
    })
    .where(eq(budgetAllocationTracking.id, trackingId));

  return true;
}

/**
 * 评估预算分配效果
 */
function evaluateEffect(
  baseline: { roas: number; acos: number; sales: number; spend: number },
  current: PerformanceMetrics,
  changes: { roasChange: number; acosChange: number; salesChange: number; spendChange: number }
): { rating: EffectRating; summary: string } {
  const roasChangePercent = baseline.roas > 0 ? (changes.roasChange / baseline.roas) * 100 : 0;
  const acosChangePercent = baseline.acos > 0 ? (changes.acosChange / baseline.acos) * 100 : 0;
  const salesChangePercent = baseline.sales > 0 ? (changes.salesChange / baseline.sales) * 100 : 0;

  let rating: EffectRating;
  let summary: string;

  // 评估逻辑：ROAS提升且ACoS下降为优秀，ROAS提升或ACoS下降为良好
  if (roasChangePercent >= 20 && acosChangePercent <= -10) {
    rating = "excellent";
    summary = `效果优秀！ROAS提升${roasChangePercent.toFixed(1)}%，ACoS下降${Math.abs(acosChangePercent).toFixed(1)}%，销售额增长${salesChangePercent.toFixed(1)}%。预算分配策略非常有效。`;
  } else if (roasChangePercent >= 10 || acosChangePercent <= -5) {
    rating = "good";
    summary = `效果良好。ROAS变化${roasChangePercent.toFixed(1)}%，ACoS变化${acosChangePercent.toFixed(1)}%。预算分配策略产生了正向效果。`;
  } else if (roasChangePercent >= -5 && acosChangePercent <= 5) {
    rating = "neutral";
    summary = `效果中性。ROAS变化${roasChangePercent.toFixed(1)}%，ACoS变化${acosChangePercent.toFixed(1)}%。预算分配策略影响有限，建议观察更长时间。`;
  } else if (roasChangePercent >= -15 || acosChangePercent <= 15) {
    rating = "poor";
    summary = `效果欠佳。ROAS下降${Math.abs(roasChangePercent).toFixed(1)}%，ACoS上升${acosChangePercent.toFixed(1)}%。建议检查分配策略或市场变化。`;
  } else {
    rating = "very_poor";
    summary = `效果很差。ROAS大幅下降${Math.abs(roasChangePercent).toFixed(1)}%，ACoS大幅上升${acosChangePercent.toFixed(1)}%。强烈建议回滚预算分配或重新评估策略。`;
  }

  return { rating, summary };
}

/**
 * 获取追踪报告
 */
export async function getTrackingReport(trackingId: number): Promise<TrackingReport | null> {
  // @ts-ignore
  const db = await getDb();
  // @ts-ignore
  if (!db) return null;

  // @ts-ignore
  const tracking = await db
    // @ts-ignore
    .select()
    .from(budgetAllocationTracking)
    // @ts-ignore
    .where(eq(budgetAllocationTracking.id, trackingId))
    // @ts-ignore
    .limit(1);

  // @ts-ignore
  if (!tracking[0]) return null;

  // @ts-ignore
  const record = tracking[0] as unknown;

  return {
    // @ts-ignore
    trackingId: record.id,
    // @ts-ignore
    allocationId: record.allocationId,
    // @ts-ignore
    trackingPeriod: record.trackingPeriod as TrackingPeriod,
    // @ts-ignore
    startDate: new Date(record.startDate),
    // @ts-ignore
    endDate: record.endDate ? new Date(record.endDate) : null,
    // @ts-ignore
    baseline: {
      // @ts-ignore
      spend: Number(record.baselineSpend) || 0,
      // @ts-ignore
      sales: Number(record.baselineSales) || 0,
      // @ts-ignore
      roas: Number(record.baselineRoas) || 0,
      // @ts-ignore
      acos: Number(record.baselineAcos) || 0,
      // @ts-ignore
      conversions: record.baselineConversions || 0,
      // @ts-ignore
      ctr: Number(record.baselineCtr) || 0,
      // @ts-ignore
      cpc: Number(record.baselineCpc) || 0,
    },
    current: {
      // @ts-ignore
      spend: Number(record.currentSpend) || 0,
      // @ts-ignore
      sales: Number(record.currentSales) || 0,
      // @ts-ignore
      roas: Number(record.currentRoas) || 0,
      // @ts-ignore
      acos: Number(record.currentAcos) || 0,
      // @ts-ignore
      conversions: record.currentConversions || 0,
      // @ts-ignore
      ctr: Number(record.currentCtr) || 0,
      // @ts-ignore
      cpc: Number(record.currentCpc) || 0,
    },
    changes: {
      // @ts-ignore
      roasChange: Number(record.roasChange) || 0,
      // @ts-ignore
      acosChange: Number(record.acosChange) || 0,
      // @ts-ignore
      salesChange: Number(record.salesChange) || 0,
      // @ts-ignore
      spendChange: Number(record.spendChange) || 0,
      // @ts-ignore
      roasChangePercent: Number(record.baselineRoas) > 0 ? (Number(record.roasChange) / Number(record.baselineRoas)) * 100 : 0,
      // @ts-ignore
      acosChangePercent: Number(record.baselineAcos) > 0 ? (Number(record.acosChange) / Number(record.baselineAcos)) * 100 : 0,
      // @ts-ignore
      salesChangePercent: Number(record.baselineSales) > 0 ? (Number(record.salesChange) / Number(record.baselineSales)) * 100 : 0,
      // @ts-ignore
      spendChangePercent: Number(record.baselineSpend) > 0 ? (Number(record.spendChange) / Number(record.baselineSpend)) * 100 : 0,
    },
    // @ts-ignore
    effectRating: (record.effectRating as EffectRating) || "neutral",
    // @ts-ignore
    effectSummary: record.effectSummary || "",
    // @ts-ignore
    status: record.status || "tracking",
  };
}

/**
 * 获取用户的所有追踪记录
 */
export async function getTrackingList(
  userId: number,
  options: { accountId?: number; status?: string; limit?: number; offset?: number } = {}
) {
  const db = await getDb();
  if (!db) return { trackings: [], total: 0 };

  const conditions = [eq(budgetAllocationTracking.userId, userId)];
  if (options.accountId) conditions.push(eq(budgetAllocationTracking.accountId, options.accountId));
  // @ts-expect-error - string type assertion
  if (options.status) conditions.push(eq(budgetAllocationTracking.status, options.status as string));

  const trackings = await db
    .select()
    .from(budgetAllocationTracking)
    .where(and(...conditions))
    .orderBy(desc(budgetAllocationTracking.createdAt))
    .limit(options.limit || 50)
    .offset(options.offset || 0);

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(budgetAllocationTracking)
    .where(and(...conditions));

  return { trackings, total: countResult[0]?.count || 0 };
}

/**
 * 取消追踪
 */
export async function cancelTracking(trackingId: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  await db
    .update(budgetAllocationTracking)
    .set({ status: "cancelled", updatedAt: new Date().toISOString() })
    .where(and(eq(budgetAllocationTracking.id, trackingId), eq(budgetAllocationTracking.userId, userId)));

  return true;
}

/**
 * 批量更新所有进行中的追踪记录
 */
export async function updateAllActiveTrackings(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const activeTrackings = await db
    .select()
    .from(budgetAllocationTracking)
    .where(eq(budgetAllocationTracking.status, "tracking"));

  let updatedCount = 0;
  for (const tracking of activeTrackings) {
    const success = await updateTrackingMetrics(tracking.id);
    if (success) updatedCount++;
  }

  return updatedCount;
}
