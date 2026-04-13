/**
 * v361: 目标进度分析
 * 从db.ts拆分的子模块
 */

import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { getDb } from './connection';
import { createModuleLogger } from '../utils/logger';
import { campaigns, dailyPerformance } from '../../drizzle/schema';

const log = createModuleLogger('DB:goalProgress');

/**
 * 获取优化目标的趋势对比数据（加入前 vs 加入后）
 * 用于科学计算目标达成度
 */
export async function getGoalProgressTrendData(performanceGroupId: number, groupCreatedAt: string) {
  const db = await getDb();
  if (!db) return { before: null, after: null };
  
  const createdDate = new Date(groupCreatedAt).toISOString().split('T')[0];
  
  try {
    // 获取该优化目标关联的所有广告活动的内部ID
    // v263: 修复关键Bug — 必须同时select campaignId字段，之前只select了id导致campaignIds全为undefined
    const groupCampaigns = await db.select({ id: campaigns.id, campaignId: campaigns.campaignId })
      .from(campaigns)
      .where(eq(campaigns.performanceGroupId, performanceGroupId));
    
    if (groupCampaigns.length === 0) return { before: null, after: null };
    
    const campaignIds = groupCampaigns.map(c => c.campaignId);
    
    // 加入前的数据（优化目标创建日期之前）
    const beforeData = await db.select({
      days: sql<number>`COUNT(DISTINCT ${dailyPerformance.date})`,
      totalSpend: sql<number>`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
      totalSales: sql<number>`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
      totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
      totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
      totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    })
    .from(dailyPerformance)
    .where(and(
      inArray(dailyPerformance.campaignId, campaignIds),
      sql`${dailyPerformance.date} < ${createdDate}`
    ));
    
    // 加入后的数据（优化目标创建日期及之后）
    const afterData = await db.select({
      days: sql<number>`COUNT(DISTINCT ${dailyPerformance.date})`,
      totalSpend: sql<number>`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
      totalSales: sql<number>`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
      totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
      totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
      totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    })
    .from(dailyPerformance)
    .where(and(
      inArray(dailyPerformance.campaignId, campaignIds),
      sql`${dailyPerformance.date} >= ${createdDate}`
    ));
    
    const before = beforeData[0] || null;
    const after = afterData[0] || null;
    
    return { before, after };
  } catch (error: any) {
    log.warn(`[getGoalProgressTrendData] Error for group ${performanceGroupId}:`, error);
    return { before: null, after: null };
  }
}


/**
 * v164: 获取多时间窗口趋势数据，用于渐进式优化进度评估
 * 返回7天、14天、30天、60天、90天以及优化前的分别汇总数据
 */

/**
 * v164: 获取多时间窗口趋势数据，用于渐进式优化进度评估
 * 返回7天、14天、30天、60天、90天以及优化前的分别汇总数据
 */
export async function getMultiWindowTrendData(performanceGroupId: number, groupCreatedAt: string) {
  const db = await getDb();
  if (!db) return null;
  
  try {
    // v263: 修复关键Bug — 必须同时select campaignId字段，之前只select了id导致campaignIds全为undefined
    const groupCampaigns = await db.select({ id: campaigns.id, campaignId: campaigns.campaignId })
      .from(campaigns)
      .where(eq(campaigns.performanceGroupId, performanceGroupId));
    
    if (groupCampaigns.length === 0) return null;
    
    const campaignIds = groupCampaigns.map(c => c.campaignId);
    const createdDate = new Date(groupCreatedAt).toISOString().split('T')[0];
    const now = new Date();
    
    const getWindowData = async (daysBack: number) => {
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - daysBack);
      const startStr = startDate.toISOString().split('T')[0];
      
      const result = await db.select({
        days: sql<number>`COUNT(DISTINCT ${dailyPerformance.date})`,
        totalSpend: sql<number>`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
        totalSales: sql<number>`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
        totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
        totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
        totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
      })
      .from(dailyPerformance)
      .where(and(
        inArray(dailyPerformance.campaignId, campaignIds),
        sql`${dailyPerformance.date} >= ${startStr}`
      ));
      
      return result[0] || null;
    };
    
    // 获取优化前数据
    const preOptData = await db.select({
      days: sql<number>`COUNT(DISTINCT ${dailyPerformance.date})`,
      totalSpend: sql<number>`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
      totalSales: sql<number>`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
      totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
      totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
      totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    })
    .from(dailyPerformance)
    .where(and(
      inArray(dailyPerformance.campaignId, campaignIds),
      sql`${dailyPerformance.date} < ${createdDate}`
    ));
    
    const [recent7d, recent14d, recent30d, recent60d, recent90d] = await Promise.all([
      getWindowData(7),
      getWindowData(14),
      getWindowData(30),
      getWindowData(60),
      getWindowData(90),
    ]);
    
    return {
      recent7d,
      recent14d,
      recent30d,
      recent60d,
      recent90d,
      preOptimization: preOptData[0] || null,
    };
  } catch (error: any) {
    log.warn(`[getMultiWindowTrendData] Error for group ${performanceGroupId}:`, error);
    return null;
  }
}

/**
 * v164: 获取时间衰减加权指标，用于目标达成度评估
 * 从dailyPerformance表获取90天数据，按时间衰减加权计算
 */

/**
 * v164: 获取时间衰减加权指标，用于目标达成度评估
 * 从dailyPerformance表获取90天数据，按时间衰减加权计算
 */
export async function getTimeWeightedMetricsForGoalProgress(performanceGroupId: number) {
  const db = await getDb();
  if (!db) return null;
  
  try {
    // v263: 修复关键Bug — 必须同时select campaignId字段，之前只select了id导致campaignIds全为undefined
    const groupCampaigns = await db.select({ id: campaigns.id, campaignId: campaigns.campaignId })
      .from(campaigns)
      .where(eq(campaigns.performanceGroupId, performanceGroupId));
    
    if (groupCampaigns.length === 0) return null;
    
    const campaignIds = groupCampaigns.map(c => c.campaignId);
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 90);
    const startStr = startDate.toISOString().split('T')[0];
    
    // 获取每日汇总数据
    const dailyData = await db.select({
      date: dailyPerformance.date,
      spend: sql<number>`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
      sales: sql<number>`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
      orders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
      clicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
      impressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    })
    .from(dailyPerformance)
    .where(and(
      inArray(dailyPerformance.campaignId, campaignIds),
      sql`${dailyPerformance.date} >= ${startStr}`
    ))
    .groupBy(dailyPerformance.date)
    .orderBy(dailyPerformance.date);
    
    if (dailyData.length === 0) return null;
    
    // 时间衰减权重计算
    const TIME_DECAY_WEIGHTS = [
      { maxDaysAgo: 3, weight: 1.0 },
      { maxDaysAgo: 7, weight: 0.85 },
      { maxDaysAgo: 14, weight: 0.65 },
      { maxDaysAgo: 30, weight: 0.40 },
      { maxDaysAgo: 60, weight: 0.20 },
      { maxDaysAgo: 90, weight: 0.08 },
    ];
    
    // 归因修正系数（最近7天数据可能不完整）
    const ATTRIBUTION_CORRECTION = [
      { daysAgo: 1, factor: 1.80 },
      { daysAgo: 2, factor: 1.50 },
      { daysAgo: 3, factor: 1.30 },
      { daysAgo: 4, factor: 1.20 },
      { daysAgo: 5, factor: 1.15 },
      { daysAgo: 6, factor: 1.10 },
      { daysAgo: 7, factor: 1.05 },
    ];
    
    let weightedSpend = 0;
    let weightedSales = 0;
    let weightedOrders = 0;
    let weightedClicks = 0;
    let weightedImpressions = 0;
    let totalWeight = 0;
    let effectiveDataDays = 0;
    let totalClicksRaw = 0;
    
    // 近7天和近30天分别汇总（用于趋势判断）
    let recent7dSpend = 0, recent7dSales = 0;
    let recent30dSpend = 0, recent30dSales = 0;
    
    for (const day of dailyData) {
      const dayDate = new Date(day.date as string);
      const daysAgo = Math.floor((now.getTime() - dayDate.getTime()) / (1000 * 60 * 60 * 24));
      
      // 确定时间衰减权重
      let weight = 0.08;
      for (const tw of TIME_DECAY_WEIGHTS) {
        if (daysAgo <= tw.maxDaysAgo) {
          weight = tw.weight;
          break;
        }
      }
      
      // 归因修正
      let attributionFactor = 1.0;
      for (const ac of ATTRIBUTION_CORRECTION) {
        if (daysAgo <= ac.daysAgo) {
          attributionFactor = ac.factor;
          break;
        }
      }
      
      const spend = Number(day.spend) || 0;
      const sales = (Number(day.sales) || 0) * attributionFactor;
      const orders = (Number(day.orders) || 0) * attributionFactor;
      const clicks = Number(day.clicks) || 0;
      const impressions = Number(day.impressions) || 0;
      
      weightedSpend += spend * weight;
      weightedSales += sales * weight;
      weightedOrders += orders * weight;
      weightedClicks += clicks * weight;
      weightedImpressions += impressions * weight;
      totalWeight += weight;
      totalClicksRaw += clicks;
      
      if (spend > 0 || clicks > 0) effectiveDataDays++;
      
      if (daysAgo <= 7) { recent7dSpend += spend; recent7dSales += sales; }
      if (daysAgo <= 30) { recent30dSpend += spend; recent30dSales += sales; }
    }
    
    if (totalWeight === 0) return null;
    
    const weightedDailySpend = weightedSpend / totalWeight;
    const weightedDailySales = weightedSales / totalWeight;
    const weightedDailyOrders = weightedOrders / totalWeight;
    const weightedAcos = weightedSales > 0 ? (weightedSpend / weightedSales) * 100 : 0;
    const weightedRoas = weightedSpend > 0 ? weightedSales / weightedSpend : 0;
    const weightedCvr = weightedClicks > 0 ? (weightedOrders / weightedClicks) * 100 : 0;
    const weightedCpc = weightedClicks > 0 ? weightedSpend / weightedClicks : 0;
    
    // 数据置信度
    let dataConfidence: 'high' | 'medium' | 'low' | 'very_low';
    if (effectiveDataDays >= 30 && totalClicksRaw >= 200) dataConfidence = 'high';
    else if (effectiveDataDays >= 14 && totalClicksRaw >= 50) dataConfidence = 'medium';
    else if (effectiveDataDays >= 7 && totalClicksRaw >= 10) dataConfidence = 'low';
    else dataConfidence = 'very_low';
    
    // 趋势方向
    let trendDirection: 'improving' | 'stable' | 'declining';
    const recent7dRoas = recent7dSpend > 0 ? recent7dSales / recent7dSpend : 0;
    const recent30dRoas = recent30dSpend > 0 ? recent30dSales / recent30dSpend : 0;
    
    if (recent30dRoas > 0) {
      const roasChange = (recent7dRoas - recent30dRoas) / recent30dRoas;
      if (roasChange > 0.05) trendDirection = 'improving';
      else if (roasChange < -0.05) trendDirection = 'declining';
      else trendDirection = 'stable';
    } else {
      trendDirection = recent7dRoas > 0 ? 'improving' : 'stable';
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
      effectiveDataDays,
    };
  } catch (error: any) {
    log.warn(`[getTimeWeightedMetricsForGoalProgress] Error for group ${performanceGroupId}:`, error);
    return null;
  }
}


/**
 * v330: 冷启动出价优化 R-02第二步 — 获取账户级别平均指标
 * 计算过去30天该账户下所有营销活动的总订单数和总点击数，
 * 得出一个真实的账户级别平均CVR，比固定的全局默认值更具代表性。
 */

/**
 * v330: 冷启动出价优化 R-02第二步 — 获取账户级别平均指标
 * 计算过去30天该账户下所有营销活动的总订单数和总点击数，
 * 得出一个真实的账户级别平均CVR，比固定的全局默认值更具代表性。
 */
export async function getAccountLevelMetrics(accountId: number): Promise<{
  totalClicks: number;
  totalOrders: number;
  totalSpend: number;
  totalSales: number;
  accountAvgCvr: number;
  accountAvgCpc: number;
  accountAvgAov: number;
} | null> {
  try {
    const dbConn = await getDb();
    if (!dbConn) return null;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const result = await dbConn
      .select({
        totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
        totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
        totalSpend: sql<string>`COALESCE(SUM(${dailyPerformance.spend}), '0')`,
        totalSales: sql<string>`COALESCE(SUM(${dailyPerformance.sales}), '0')`,
      })
      .from(dailyPerformance)
      .where(
        and(
          eq(dailyPerformance.accountId, accountId),
          gte(dailyPerformance.date, thirtyDaysAgo.toISOString().split('T')[0])
        )
      );
    
    const row = result[0] as unknown;
    // @ts-expect-error Dynamic property access
    if (!row || row.totalClicks === 0) return null;
    
    // @ts-expect-error Type inference limitation
    const totalClicks = Number(row.totalClicks);
    // @ts-expect-error Type inference limitation
    const totalOrders = Number(row.totalOrders);
    // @ts-expect-error Type inference limitation
    const totalSpend = parseFloat(row.totalSpend as string);
    // @ts-expect-error Type inference limitation
    const totalSales = parseFloat(row.totalSales as string);
    
    return {
      totalClicks,
      totalOrders,
      totalSpend,
      totalSales,
      accountAvgCvr: totalClicks > 0 ? totalOrders / totalClicks : 0,
      accountAvgCpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
      accountAvgAov: totalOrders > 0 ? totalSales / totalOrders : 0,
    };
  } catch (error: any) {
    log.warn(`[getAccountLevelMetrics] Error for account ${accountId}:`, error);
    return null;
  }
}

/**
 * v330: 冷启动出价优化 R-03 — 获取跨活动品类平均CVR
 * 查询该账户下所有属于同一品类的其他营销活动的近期(过去30天)表现，
 * 使用这些活动的聚合数据来计算一个"跨活动品类平均CVR"作为先验值。
 */

/**
 * v330: 冷启动出价优化 R-03 — 获取跨活动品类平均CVR
 * 查询该账户下所有属于同一品类的其他营销活动的近期(过去30天)表现，
 * 使用这些活动的聚合数据来计算一个"跨活动品类平均CVR"作为先验值。
 */
export async function getCrossCampaignCategoryMetrics(
  accountId: number,
  excludePerformanceGroupId?: number
): Promise<{
  totalClicks: number;
  totalOrders: number;
  crossCampaignCvr: number;
} | null> {
  try {
    const dbConn = await getDb();
    if (!dbConn) return null;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    // 查询该账户下所有营销活动的近30天聚合表现
    const result = await dbConn
      .select({
        totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
        totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
      })
      .from(dailyPerformance)
      .where(
        and(
          eq(dailyPerformance.accountId, accountId),
          gte(dailyPerformance.date, thirtyDaysAgo.toISOString().split('T')[0]),
          // 排除当前优化目标的数据，避免自引用
          excludePerformanceGroupId
            ? sql`${dailyPerformance.performanceGroupId} != ${excludePerformanceGroupId}`
            // @ts-expect-error DB query type inference limitation
            : sql`1=1`
        )
      // @ts-expect-error Legacy code type compatibility
      );
    
    const row = result[0] as unknown;
    // @ts-expect-error Conditional type narrowing
    if (!row || Number(row.totalClicks) === 0) return null;
    
    // @ts-expect-error Type inference limitation
    const totalClicks = Number(row.totalClicks);
    // @ts-expect-error Type inference limitation
    const totalOrders = Number(row.totalOrders);
    
    return {
      totalClicks,
      totalOrders,
      crossCampaignCvr: totalClicks > 0 ? totalOrders / totalClicks : 0,
    };
  } catch (error: any) {
    log.warn(`[getCrossCampaignCategoryMetrics] Error for account ${accountId}:`, error);
    return null;
  }
}
