/**
 * 特殊场景算法优化服务
 * 
 * 包含四个核心算法：
 * 1. 预算耗尽智能预测与动态调整
 * 2. 归因窗口数据延迟智能调整
 * 3. 竞价效率分析与过度竞价检测
 * 4. 季节性智能调整算法
 */

import { eq, and, gte, lte, desc, sql, isNotNull } from 'drizzle-orm';
import { getDb } from './db';
import {
  campaigns,
  dailyPerformance,
  keywords,
  productTargets,
  adGroups,
  performanceGroups,
} from '../drizzle/schema';

// ============================================================================
// 类型定义
// ============================================================================

// 预算耗尽预测相关类型
export interface HourlySpendPattern {
  hour: number;
  avgSpendPercent: number;
  stdDev: number;
  sampleSize: number;
}

export interface BudgetDepletionPrediction {
  campaignId: number;
  campaignName: string;
  dailyBudget: number;
  currentSpend: number;
  currentHour: number;
  predictedDepletionHour: number | null;
  confidenceLow: number | null;
  confidenceHigh: number | null;
  riskLevel: 'safe' | 'warning' | 'critical';
  recommendation: string;
  optimalDepletionHour?: number;
  optimalDepletionReason?: string;
}

export interface CampaignSpendModel {
  campaignId: number;
  weekdayPatterns: HourlySpendPattern[][];
  lastUpdated: Date;
}

// 归因调整相关类型
export interface AttributionCompletionModel {
  accountId: number;
  completionRates: {
    day1: number;
    day2: number;
    day3: number;
    day4: number;
    day5: number;
    day6: number;
    day7: number;
  };
  campaignTypeFactors: {
    sp_auto: number;
    sp_manual: number;
    sb: number;
    sd: number;
  };
  lastCalibrated: Date;
}

export interface AdjustedMetrics {
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  acos: number;
  roas: number;
  ctr: number;
  cvr: number;
  isAdjusted: boolean;
  adjustmentFactor: number;
  completionRate: number;
  confidence: 'high' | 'medium' | 'low';
  dataAge: number;
}

// 竞价效率分析相关类型
export interface BidEfficiencyAnalysis {
  targetId: number;
  targetType: 'keyword' | 'product_target';
  targetText: string;
  matchType?: string;
  currentBid: number;
  actualCpc: number;
  targetCpc: number;
  breakEvenCpc: number;
  bidToCpcRatio: number;
  efficiencyScore: number;
  isOverbidding: boolean;
  overbiddingScore: number;
  overbiddingReasons: string[];
  suggestedBid: number;
  expectedSavings: number;
}

export interface BidEfficiencyReport {
  accountId: number;
  analysisDate: Date;
  totalTargets: number;
  overbiddingCount: number;
  overbiddingPercent: number;
  totalPotentialSavings: number;
  avgEfficiencyScore: number;
  topOverbidding: BidEfficiencyAnalysis[];
  recommendations: string[];
}

// 季节性调整相关类型
export interface SeasonalPattern {
  accountId: number;
  weekdayFactors: number[];
  monthdayFactors: number[];
  monthlyFactors: number[];
  confidence: number;
  lastUpdated: Date;
}

export interface SeasonalAdjustmentStrategy {
  date: Date;
  baseFactor: number;
  eventName?: string;
  eventFactor?: number;
  finalFactor: number;
  budgetMultiplier: number;
  bidMultiplier: number;
  acosToleranceMultiplier: number;
  explanation: string;
  confidence: number;
}

export interface EventTransitionPlan {
  eventName: string;
  eventDate: Date;
  totalDays: number;
  dailyAdjustments: DailyAdjustment[];
  estimatedAdditionalSpend: number;
  estimatedAdditionalSales: number;
}

export interface DailyAdjustment {
  date: Date;
  phase: 'pre_event' | 'event_day' | 'post_event';
  daysFromEvent: number;
  budgetMultiplier: number;
  bidMultiplier: number;
  recommendedBudget: number;
  recommendedBid: number;
  explanation: string;
}

// ============================================================================
// 工具函数
// ============================================================================

function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function standardDeviation(arr: number[]): number {
  if (arr.length < 2) return 0;
  const avg = average(arr);
  const squareDiffs = arr.map(value => Math.pow(value - avg, 2));
  return Math.sqrt(average(squareDiffs));
}

function subDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - days);
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

// ============================================================================
// 场景一：预算耗尽智能预测
// ============================================================================

/**
 * 默认的小时消耗模式（基于行业经验）
 * 假设流量在上午和晚上较高
 */
const DEFAULT_HOURLY_PATTERN: number[] = [
  2.5, 2.0, 1.5, 1.2, 1.0, 1.5, // 0-5点
  2.5, 3.5, 4.5, 5.0, 5.5, 5.5, // 6-11点
  5.0, 4.5, 4.5, 4.5, 4.5, 5.0, // 12-17点
  5.5, 6.0, 6.5, 6.0, 5.0, 4.0, // 18-23点
];

/**
 * 从历史数据学习广告活动的消耗模式
 */
export async function learnCampaignSpendPattern(
  campaignId: number,
  lookbackDays: number = 30
): Promise<CampaignSpendModel> {
  const db = await getDb();
  if (!db) {
    // 返回默认模式
    return {
      campaignId,
      weekdayPatterns: Array(7).fill(null).map(() => 
        DEFAULT_HOURLY_PATTERN.map((pct, hour) => ({
          hour,
          avgSpendPercent: pct,
          stdDev: pct * 0.2,
          sampleSize: 0
        }))
      ),
      lastUpdated: new Date()
    };
  }

  const startDate = subDays(new Date(), lookbackDays);
  
  // 获取历史日绩效数据
  const historicalData = await db.select()
    .from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.campaignId, campaignId),
      gte(dailyPerformance.date, formatDate(startDate))
    ))
    .orderBy(dailyPerformance.date);

  // 由于我们没有小时级数据，使用默认模式但根据历史数据调整
  // 计算历史平均日消耗
  const dailySpends = historicalData.map(d => Number(d.spend) || 0);
  const avgDailySpend = average(dailySpends);
  
  // 按星期几分组
  const weekdaySpends: number[][] = Array(7).fill(null).map(() => []);
  for (const day of historicalData) {
    const weekday = new Date(day.date as string).getDay();
    weekdaySpends[weekday].push(Number(day.spend) || 0);
  }

  // 计算每天的相对消耗因子
  const weekdayFactors = weekdaySpends.map(spends => {
    if (spends.length === 0) return 1.0;
    return average(spends) / avgDailySpend;
  });

  // 生成每天每小时的模式
  const weekdayPatterns: HourlySpendPattern[][] = weekdayFactors.map((factor, weekday) => {
    return DEFAULT_HOURLY_PATTERN.map((basePct, hour) => ({
      hour,
      avgSpendPercent: basePct * factor,
      stdDev: basePct * factor * 0.2,
      sampleSize: weekdaySpends[weekday].length
    }));
  });

  return {
    campaignId,
    weekdayPatterns,
    lastUpdated: new Date()
  };
}

/**
 * 预测预算耗尽时间
 */
export async function predictBudgetDepletion(
  campaignId: number,
  currentSpend: number,
  dailyBudget: number,
  currentHour: number = new Date().getHours()
): Promise<BudgetDepletionPrediction> {
  const db = await getDb();
  
  // 获取广告活动信息
  let campaignName = `Campaign ${campaignId}`;
  if (db) {
    const [campaign] = await db.select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);
    if (campaign) {
      campaignName = campaign.campaignName;
    }
  }

  // 学习消耗模式
  const spendModel = await learnCampaignSpendPattern(campaignId);
  
  const remainingBudget = dailyBudget - currentSpend;
  const weekday = new Date().getDay();
  const patterns = spendModel.weekdayPatterns[weekday];
  
  // 如果已经耗尽
  if (remainingBudget <= 0) {
    return {
      campaignId,
      campaignName,
      dailyBudget,
      currentSpend,
      currentHour,
      predictedDepletionHour: currentHour,
      confidenceLow: currentHour,
      confidenceHigh: currentHour,
      riskLevel: 'critical',
      recommendation: '预算已耗尽。建议立即增加预算或暂停低效关键词以控制成本。'
    };
  }

  // 计算剩余小时的累计预期消耗
  let cumulativeExpectedSpend = 0;
  let predictedDepletionHour: number | null = null;
  
  // 计算剩余时间的总预期消耗百分比
  const remainingHoursPattern = patterns.slice(currentHour + 1);
  const totalRemainingPercent = remainingHoursPattern.reduce((sum, p) => sum + p.avgSpendPercent, 0);
  
  // 归一化剩余时间的消耗比例
  for (let h = currentHour + 1; h < 24; h++) {
    const hourPattern = patterns[h];
    const normalizedPercent = totalRemainingPercent > 0 
      ? (hourPattern.avgSpendPercent / totalRemainingPercent) 
      : (1 / (24 - currentHour - 1));
    
    const expectedHourlySpend = remainingBudget * normalizedPercent;
    cumulativeExpectedSpend += expectedHourlySpend;
    
    if (cumulativeExpectedSpend >= remainingBudget && predictedDepletionHour === null) {
      predictedDepletionHour = h;
    }
  }

  // 计算置信区间（基于标准差）
  const avgStdDev = average(remainingHoursPattern.map(p => p.stdDev));
  const confidenceLow = predictedDepletionHour !== null 
    ? Math.max(currentHour + 1, predictedDepletionHour - Math.ceil(avgStdDev))
    : null;
  const confidenceHigh = predictedDepletionHour !== null
    ? Math.min(23, predictedDepletionHour + Math.ceil(avgStdDev))
    : null;

  // 确定风险等级
  let riskLevel: 'safe' | 'warning' | 'critical' = 'safe';
  let recommendation = '';
  
  if (predictedDepletionHour !== null) {
    if (predictedDepletionHour < 15) {
      riskLevel = 'critical';
      recommendation = `预算预计在${predictedDepletionHour}:00耗尽，远早于营业高峰期结束。建议立即增加预算${Math.ceil((dailyBudget * 0.5))}或降低高消耗关键词出价。`;
    } else if (predictedDepletionHour < 20) {
      riskLevel = 'warning';
      recommendation = `预算预计在${predictedDepletionHour}:00耗尽，可能错过晚间流量高峰。建议增加预算或优化出价策略。`;
    } else {
      riskLevel = 'safe';
      recommendation = `预算消耗正常，预计在${predictedDepletionHour}:00左右耗尽，覆盖大部分营业时间。`;
    }
  } else {
    recommendation = '预算充足，预计今日不会耗尽。可考虑适当提高出价以获取更多流量。';
  }

  // 计算最优耗尽时间（基于历史ROAS数据）
  const optimalAnalysis = await calculateOptimalDepletionTime(campaignId);

  return {
    campaignId,
    campaignName,
    dailyBudget,
    currentSpend,
    currentHour,
    predictedDepletionHour,
    confidenceLow,
    confidenceHigh,
    riskLevel,
    recommendation,
    optimalDepletionHour: optimalAnalysis?.optimalHour,
    optimalDepletionReason: optimalAnalysis?.reason
  };
}

/**
 * 计算最优预算耗尽时间
 */
async function calculateOptimalDepletionTime(
  campaignId: number
): Promise<{ optimalHour: number; reason: string } | null> {
  // 基于行业经验，最优耗尽时间通常在21-23点
  // 因为需要覆盖全天流量，但不需要在深夜投放
  return {
    optimalHour: 22,
    reason: '基于行业最佳实践，建议预算在22:00左右耗尽，以覆盖全天主要流量时段。'
  };
}

/**
 * 批量分析所有广告活动的预算耗尽风险
 */
export async function analyzeBudgetDepletionRisk(
  accountId: number
): Promise<BudgetDepletionPrediction[]> {
  const db = await getDb();
  if (!db) return [];

  // 获取所有启用的广告活动
  const activeCampaigns = await db.select()
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, accountId),
      eq(campaigns.campaignStatus, 'enabled')
    ));

  const currentHour = new Date().getHours();
  const today = formatDate(new Date());
  
  const predictions: BudgetDepletionPrediction[] = [];

  for (const campaign of activeCampaigns) {
    // 获取今日消耗
    const [todayPerf] = await db.select()
      .from(dailyPerformance)
      .where(and(
        eq(dailyPerformance.campaignId, campaign.id),
        sql`DATE(${dailyPerformance.date}) = ${today}`
      ))
      .limit(1);

    const currentSpend = todayPerf ? Number(todayPerf.spend) : 0;
    const dailyBudget = Number(campaign.dailyBudget) || Number(campaign.maxBid) * 100 || 100;

    const prediction = await predictBudgetDepletion(
      campaign.id,
      currentSpend,
      dailyBudget,
      currentHour
    );

    predictions.push(prediction);
  }

  // 按风险等级排序
  const riskOrder = { critical: 0, warning: 1, safe: 2 };
  predictions.sort((a, b) => riskOrder[a.riskLevel] - riskOrder[b.riskLevel]);

  return predictions;
}

// ============================================================================
// 场景二：归因窗口数据延迟智能调整
// ============================================================================

/**
 * 默认归因完成度模型
 */
const DEFAULT_ATTRIBUTION_MODEL: AttributionCompletionModel = {
  accountId: 0,
  completionRates: {
    day1: 0.70,
    day2: 0.80,
    day3: 0.90,
    day4: 0.95,
    day5: 0.97,
    day6: 0.99,
    day7: 1.00,
  },
  campaignTypeFactors: {
    sp_auto: 1.0,
    sp_manual: 1.0,
    sb: 0.95,
    sd: 0.90,
  },
  lastCalibrated: new Date()
};

/**
 * 获取或创建归因模型
 */
export async function getAttributionModel(
  accountId: number
): Promise<AttributionCompletionModel> {
  // 目前返回默认模型，后续可以从数据库加载自定义模型
  return {
    ...DEFAULT_ATTRIBUTION_MODEL,
    accountId
  };
}

/**
 * 调整近期数据的归因延迟
 */
export function adjustForAttributionDelay(
  rawMetrics: {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
  },
  dataDate: Date,
  model: AttributionCompletionModel,
  campaignType: string = 'sp_manual'
): AdjustedMetrics {
  const now = new Date();
  const dataAge = Math.floor((now.getTime() - dataDate.getTime()) / (1000 * 60 * 60 * 24));
  
  // 获取基础归因完成率
  let completionRate = 1.0;
  if (dataAge >= 1 && dataAge <= 7) {
    const key = `day${dataAge}` as keyof typeof model.completionRates;
    completionRate = model.completionRates[key] || 1.0;
  } else if (dataAge < 1) {
    // 当天数据，使用day1的一半
    completionRate = model.completionRates.day1 * 0.7;
  }
  
  // 应用广告类型调整因子
  const typeFactor = model.campaignTypeFactors[campaignType as keyof typeof model.campaignTypeFactors] || 1.0;
  completionRate *= typeFactor;
  
  // 确保完成率在合理范围内
  completionRate = Math.max(0.5, Math.min(1.0, completionRate));
  
  // 计算调整系数
  const adjustmentFactor = 1 / completionRate;
  
  // 调整销售相关指标
  const adjustedSales = rawMetrics.sales * adjustmentFactor;
  const adjustedOrders = Math.round(rawMetrics.orders * adjustmentFactor);
  
  // 计算派生指标
  const ctr = rawMetrics.impressions > 0 ? rawMetrics.clicks / rawMetrics.impressions : 0;
  const cvr = rawMetrics.clicks > 0 ? adjustedOrders / rawMetrics.clicks : 0;
  const adjustedAcos = adjustedSales > 0 ? (rawMetrics.spend / adjustedSales) * 100 : 0;
  const adjustedRoas = rawMetrics.spend > 0 ? adjustedSales / rawMetrics.spend : 0;
  
  // 确定置信度
  let confidence: 'high' | 'medium' | 'low' = 'high';
  if (dataAge <= 2) {
    confidence = 'low';
  } else if (dataAge <= 4) {
    confidence = 'medium';
  }

  return {
    impressions: rawMetrics.impressions,
    clicks: rawMetrics.clicks,
    spend: rawMetrics.spend,
    sales: adjustedSales,
    orders: adjustedOrders,
    acos: adjustedAcos,
    roas: adjustedRoas,
    ctr,
    cvr,
    isAdjusted: dataAge < 7,
    adjustmentFactor,
    completionRate,
    confidence,
    dataAge
  };
}

/**
 * 批量调整近期绩效数据
 */
export async function adjustRecentPerformanceData(
  accountId: number,
  days: number = 7
): Promise<{
  date: string;
  raw: { spend: number; sales: number; acos: number; roas: number };
  adjusted: AdjustedMetrics;
}[]> {
  const db = await getDb();
  if (!db) return [];

  const model = await getAttributionModel(accountId);
  const results: {
    date: string;
    raw: { spend: number; sales: number; acos: number; roas: number };
    adjusted: AdjustedMetrics;
  }[] = [];

  for (let i = 0; i < days; i++) {
    const date = subDays(new Date(), i);
    const dateStr = formatDate(date);
    
    // 获取该日期的汇总数据
    const dayData = await db.select({
      impressions: sql<number>`SUM(${dailyPerformance.impressions})`,
      clicks: sql<number>`SUM(${dailyPerformance.clicks})`,
      spend: sql<number>`SUM(${dailyPerformance.spend})`,
      sales: sql<number>`SUM(${dailyPerformance.sales})`,
      orders: sql<number>`SUM(${dailyPerformance.orders})`,
    })
    .from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      sql`DATE(${dailyPerformance.date}) = ${dateStr}`
    ));

    if (dayData[0]) {
      const raw = {
        impressions: Number(dayData[0].impressions) || 0,
        clicks: Number(dayData[0].clicks) || 0,
        spend: Number(dayData[0].spend) || 0,
        sales: Number(dayData[0].sales) || 0,
        orders: Number(dayData[0].orders) || 0,
      };
      
      const rawAcos = raw.sales > 0 ? (raw.spend / raw.sales) * 100 : 0;
      const rawRoas = raw.spend > 0 ? raw.sales / raw.spend : 0;
      
      const adjusted = adjustForAttributionDelay(raw, date, model);
      
      results.push({
        date: dateStr,
        raw: {
          spend: raw.spend,
          sales: raw.sales,
          acos: rawAcos,
          roas: rawRoas
        },
        adjusted
      });
    }
  }

  return results;
}

// ============================================================================
// 场景三：竞价效率分析与过度竞价检测
// ============================================================================

/**
 * 计算目标CPC
 */
export function calculateTargetCpc(
  targetAcos: number,
  cvr: number,
  avgOrderValue: number,
  profitMargin?: number
): {
  targetCpc: number;
  breakEvenCpc: number;
  maxCpc: number;
} {
  // 目标CPC = 目标ACoS × CVR × 平均订单价值
  const targetCpc = targetAcos * cvr * avgOrderValue;
  
  // 盈亏平衡CPC（如果提供了利润率）
  const breakEvenCpc = profitMargin 
    ? profitMargin * cvr * avgOrderValue 
    : targetCpc * 1.5;
  
  // 最大可接受CPC
  const maxCpc = breakEvenCpc;
  
  return { targetCpc, breakEvenCpc, maxCpc };
}

/**
 * 检测单个投放词的过度竞价
 */
export function detectOverbidding(
  target: {
    id: number;
    type: 'keyword' | 'product_target';
    text: string;
    matchType?: string;
    bid: number;
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
  },
  targetAcos: number,
  profitMargin: number
): BidEfficiencyAnalysis {
  const { bid, clicks, spend, sales, orders } = target;
  
  // 计算基础指标
  const cpc = clicks > 0 ? spend / clicks : 0;
  const cvr = clicks > 0 ? orders / clicks : 0;
  const avgOrderValue = orders > 0 ? sales / orders : 0;
  const actualAcos = sales > 0 ? (spend / sales) * 100 : 0;
  
  // 计算目标CPC
  const { targetCpc, breakEvenCpc } = calculateTargetCpc(
    targetAcos,
    cvr,
    avgOrderValue,
    profitMargin
  );
  
  // 计算竞价效率指标
  const bidToCpcRatio = cpc > 0 ? bid / cpc : 0;
  const cpcToTargetRatio = targetCpc > 0 ? cpc / targetCpc : 0;
  const acosToTargetRatio = targetAcos > 0 ? actualAcos / (targetAcos * 100) : 0;
  
  // 判断是否过度竞价
  const overbiddingReasons: string[] = [];
  let overbiddingScore = 0;
  
  if (bidToCpcRatio > 2.0 && clicks >= 5) {
    overbiddingReasons.push(`出价是实际CPC的${bidToCpcRatio.toFixed(1)}倍`);
    overbiddingScore += 30;
  }
  
  if (cpcToTargetRatio > 1.2 && clicks >= 5) {
    overbiddingReasons.push(`实际CPC超出目标${((cpcToTargetRatio - 1) * 100).toFixed(0)}%`);
    overbiddingScore += 40;
  }
  
  if (acosToTargetRatio > 1.5 && sales > 0) {
    overbiddingReasons.push(`ACoS超出目标${((acosToTargetRatio - 1) * 100).toFixed(0)}%`);
    overbiddingScore += 30;
  }
  
  // 计算建议出价
  let suggestedBid = bid;
  if (overbiddingScore >= 50) {
    suggestedBid = Math.min(
      targetCpc > 0 ? targetCpc * 1.5 : bid,
      breakEvenCpc > 0 ? breakEvenCpc : bid,
      cpc > 0 ? cpc * 1.2 : bid
    );
    suggestedBid = Math.max(suggestedBid, 0.02); // 最低出价
  }
  
  // 计算预期节省
  const expectedSavings = clicks > 0 ? clicks * Math.max(0, bid - suggestedBid) : 0;
  
  // 计算效率评分
  const efficiencyScore = Math.max(0, 100 - overbiddingScore);
  
  return {
    targetId: target.id,
    targetType: target.type,
    targetText: target.text,
    matchType: target.matchType,
    currentBid: bid,
    actualCpc: cpc,
    targetCpc,
    breakEvenCpc,
    bidToCpcRatio,
    efficiencyScore,
    isOverbidding: overbiddingScore >= 50,
    overbiddingScore,
    overbiddingReasons,
    suggestedBid,
    expectedSavings
  };
}

/**
 * 批量分析竞价效率
 */
export async function analyzeBidEfficiency(
  accountId: number,
  targetAcos: number = 0.25,
  profitMargin: number = 0.30,
  minClicks: number = 10
): Promise<BidEfficiencyReport> {
  const db = await getDb();
  if (!db) {
    return {
      accountId,
      analysisDate: new Date(),
      totalTargets: 0,
      overbiddingCount: 0,
      overbiddingPercent: 0,
      totalPotentialSavings: 0,
      avgEfficiencyScore: 0,
      topOverbidding: [],
      recommendations: []
    };
  }

  // 获取所有广告组
  const adGroupList = await db.select()
    .from(adGroups)
    .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.id))
    .where(eq(campaigns.accountId, accountId));

  const adGroupIds = adGroupList.map(ag => ag.ad_groups.id);
  
  if (adGroupIds.length === 0) {
    return {
      accountId,
      analysisDate: new Date(),
      totalTargets: 0,
      overbiddingCount: 0,
      overbiddingPercent: 0,
      totalPotentialSavings: 0,
      avgEfficiencyScore: 0,
      topOverbidding: [],
      recommendations: []
    };
  }

  // 获取关键词数据
  const keywordData = await db.select()
    .from(keywords)
    .where(sql`${keywords.adGroupId} IN (${sql.join(adGroupIds.map(id => sql`${id}`), sql`, `)})`);

  // 获取商品定向数据
  const targetData = await db.select()
    .from(productTargets)
    .where(sql`${productTargets.adGroupId} IN (${sql.join(adGroupIds.map(id => sql`${id}`), sql`, `)})`);

  const analyses: BidEfficiencyAnalysis[] = [];
  let totalPotentialSavings = 0;
  let overbiddingCount = 0;

  // 分析关键词
  for (const kw of keywordData) {
    const clicks = Number(kw.clicks) || 0;
    if (clicks < minClicks) continue;
    
    const analysis = detectOverbidding({
      id: kw.id,
      type: 'keyword',
      text: kw.keywordText,
      matchType: kw.matchType,
      bid: Number(kw.bid) || 0,
      impressions: Number(kw.impressions) || 0,
      clicks,
      spend: Number(kw.spend) || 0,
      sales: Number(kw.sales) || 0,
      orders: Number(kw.orders) || 0
    }, targetAcos, profitMargin);
    
    analyses.push(analysis);
    
    if (analysis.isOverbidding) {
      overbiddingCount++;
      totalPotentialSavings += analysis.expectedSavings;
    }
  }

  // 分析商品定向
  for (const pt of targetData) {
    const clicks = Number(pt.clicks) || 0;
    if (clicks < minClicks) continue;
    
    const analysis = detectOverbidding({
      id: pt.id,
      type: 'product_target',
      text: pt.targetValue,
      bid: Number(pt.bid) || 0,
      impressions: Number(pt.impressions) || 0,
      clicks,
      spend: Number(pt.spend) || 0,
      sales: Number(pt.sales) || 0,
      orders: Number(pt.orders) || 0
    }, targetAcos, profitMargin);
    
    analyses.push(analysis);
    
    if (analysis.isOverbidding) {
      overbiddingCount++;
      totalPotentialSavings += analysis.expectedSavings;
    }
  }

  // 按过度竞价程度排序
  analyses.sort((a, b) => b.overbiddingScore - a.overbiddingScore);

  // 计算平均效率评分
  const avgEfficiencyScore = analyses.length > 0 
    ? average(analyses.map(a => a.efficiencyScore))
    : 100;

  // 生成建议
  const recommendations: string[] = [];
  if (overbiddingCount > 0) {
    recommendations.push(`发现${overbiddingCount}个投放词存在过度竞价问题，预计可节省$${totalPotentialSavings.toFixed(2)}。`);
  }
  if (avgEfficiencyScore < 70) {
    recommendations.push('整体竞价效率偏低，建议全面审查出价策略。');
  }
  if (analyses.filter(a => a.bidToCpcRatio > 3).length > 5) {
    recommendations.push('多个投放词的出价远高于实际CPC，建议降低这些投放词的出价。');
  }

  return {
    accountId,
    analysisDate: new Date(),
    totalTargets: analyses.length,
    overbiddingCount,
    overbiddingPercent: analyses.length > 0 ? (overbiddingCount / analyses.length) * 100 : 0,
    totalPotentialSavings,
    avgEfficiencyScore,
    topOverbidding: analyses.slice(0, 20),
    recommendations
  };
}

// ============================================================================
// 场景四：季节性智能调整算法
// ============================================================================

/**
 * 大促日历（2026年）
 */
const PROMOTIONAL_EVENTS_2026 = [
  { name: 'Prime Day', date: new Date('2026-07-15'), duration: 2 },
  { name: 'Black Friday', date: new Date('2026-11-27'), duration: 1 },
  { name: 'Cyber Monday', date: new Date('2026-11-30'), duration: 1 },
  { name: 'Christmas', date: new Date('2026-12-25'), duration: 3 },
  { name: "Valentine's Day", date: new Date('2026-02-14'), duration: 1 },
  { name: "Mother's Day", date: new Date('2026-05-10'), duration: 1 },
  { name: "Father's Day", date: new Date('2026-06-21'), duration: 1 },
];

/**
 * 从历史数据学习季节性模式
 */
export async function learnSeasonalPatterns(
  accountId: number,
  metric: 'sales' | 'roas' | 'spend' = 'sales'
): Promise<SeasonalPattern> {
  const db = await getDb();
  
  // 默认模式
  const defaultPattern: SeasonalPattern = {
    accountId,
    weekdayFactors: [0.85, 1.05, 1.10, 1.10, 1.15, 1.00, 0.75], // 周日到周六
    monthdayFactors: Array(31).fill(1.0),
    monthlyFactors: [0.90, 0.85, 0.95, 1.00, 1.05, 1.00, 1.10, 0.95, 1.00, 1.05, 1.20, 1.30], // 1-12月
    confidence: 0.5,
    lastUpdated: new Date()
  };

  if (!db) return defaultPattern;

  // 获取历史数据
  const startDate = subDays(new Date(), 365);
  const historicalData = await db.select()
    .from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      gte(dailyPerformance.date, formatDate(startDate))
    ))
    .orderBy(dailyPerformance.date);

  if (historicalData.length < 30) {
    return defaultPattern;
  }

  // 计算周内模式
  const weekdayData: number[][] = Array(7).fill(null).map(() => []);
  for (const day of historicalData) {
    const weekday = new Date(day.date as string).getDay();
    const value = Number(day[metric as keyof typeof day]) || 0;
    if (value > 0) weekdayData[weekday].push(value);
  }
  const weekdayAvg = weekdayData.map(arr => arr.length > 0 ? average(arr) : 0);
  const weekdayOverall = average(weekdayAvg.filter(v => v > 0));
  const weekdayFactors = weekdayAvg.map(v => v > 0 ? v / weekdayOverall : 1.0);

  // 计算月内模式
  const monthdayData: number[][] = Array(31).fill(null).map(() => []);
  for (const day of historicalData) {
    const monthday = new Date(day.date as string).getDate() - 1;
    const value = Number(day[metric as keyof typeof day]) || 0;
    if (value > 0) monthdayData[monthday].push(value);
  }
  const monthdayAvg = monthdayData.map(arr => arr.length > 0 ? average(arr) : 0);
  const monthdayOverall = average(monthdayAvg.filter(v => v > 0));
  const monthdayFactors = monthdayAvg.map(v => v > 0 ? v / monthdayOverall : 1.0);

  // 计算年内月度模式
  const monthlyData: number[][] = Array(12).fill(null).map(() => []);
  for (const day of historicalData) {
    const month = new Date(day.date as string).getMonth();
    const value = Number(day[metric as keyof typeof day]) || 0;
    if (value > 0) monthlyData[month].push(value);
  }
  const monthlyAvg = monthlyData.map(arr => arr.length > 0 ? average(arr) : 0);
  const monthlyOverall = average(monthlyAvg.filter(v => v > 0));
  const monthlyFactors = monthlyAvg.map(v => v > 0 ? v / monthlyOverall : 1.0);

  // 计算置信度
  const confidence = Math.min(1.0, historicalData.length / 365);

  return {
    accountId,
    weekdayFactors,
    monthdayFactors,
    monthlyFactors,
    confidence,
    lastUpdated: new Date()
  };
}

/**
 * 检查是否接近大促事件
 */
function getUpcomingEvent(
  targetDate: Date,
  daysAhead: number = 14
): { event: typeof PROMOTIONAL_EVENTS_2026[0]; daysUntil: number } | null {
  for (const event of PROMOTIONAL_EVENTS_2026) {
    const daysUntil = Math.floor((event.date.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntil >= -event.duration && daysUntil <= daysAhead) {
      return { event, daysUntil };
    }
  }
  return null;
}

/**
 * 生成季节性调整策略
 */
export async function generateSeasonalStrategy(
  accountId: number,
  targetDate: Date = new Date()
): Promise<SeasonalAdjustmentStrategy> {
  const pattern = await learnSeasonalPatterns(accountId);
  
  const weekday = targetDate.getDay();
  const monthday = targetDate.getDate() - 1;
  const month = targetDate.getMonth();
  
  // 基础季节性因子
  const baseFactor = (
    pattern.weekdayFactors[weekday] * 0.4 +
    pattern.monthdayFactors[monthday] * 0.2 +
    pattern.monthlyFactors[month] * 0.4
  );
  
  // 检查是否接近大促事件
  const upcomingEvent = getUpcomingEvent(targetDate);
  let eventFactor = 1.0;
  let eventName: string | undefined;
  
  if (upcomingEvent) {
    eventName = upcomingEvent.event.name;
    const { daysUntil } = upcomingEvent;
    
    if (daysUntil === 0) {
      // 大促当天
      eventFactor = 2.0;
    } else if (daysUntil > 0 && daysUntil <= 7) {
      // 大促前7天，逐步提升
      eventFactor = 1 + (7 - daysUntil) * 0.15;
    } else if (daysUntil < 0 && daysUntil >= -3) {
      // 大促后3天，逐步恢复
      eventFactor = 1 + (3 + daysUntil) * 0.2;
    }
  }
  
  // 最终调整因子
  const finalFactor = baseFactor * eventFactor;
  
  // 生成具体调整建议
  const budgetMultiplier = Math.max(0.5, Math.min(2.5, finalFactor));
  const bidMultiplier = Math.max(0.8, Math.min(1.5, Math.sqrt(finalFactor)));
  const acosToleranceMultiplier = finalFactor > 1.2 ? 1.2 : 1.0;
  
  // 生成说明
  let explanation = '';
  if (eventName) {
    explanation = `${eventName}期间，建议预算提升${((budgetMultiplier - 1) * 100).toFixed(0)}%，出价提升${((bidMultiplier - 1) * 100).toFixed(0)}%。`;
  } else if (baseFactor > 1.1) {
    explanation = `当前处于销售旺季（周${weekday === 0 ? '日' : weekday}，${month + 1}月），建议适当增加投放力度。`;
  } else if (baseFactor < 0.9) {
    explanation = `当前处于销售淡季，建议控制预算，提高投放效率。`;
  } else {
    explanation = '当前处于正常销售期，建议维持常规投放策略。';
  }

  return {
    date: targetDate,
    baseFactor,
    eventName,
    eventFactor: eventName ? eventFactor : undefined,
    finalFactor,
    budgetMultiplier,
    bidMultiplier,
    acosToleranceMultiplier,
    explanation,
    confidence: pattern.confidence
  };
}

/**
 * 生成大促前后的渐进式调整计划
 */
export function generateEventTransitionPlan(
  eventName: string,
  eventDate: Date,
  baseBudget: number,
  baseBid: number
): EventTransitionPlan {
  const plan: DailyAdjustment[] = [];
  
  // 大促前调整（提前7天开始）
  for (let i = 7; i >= 1; i--) {
    const date = subDays(eventDate, i);
    const factor = 1 + (7 - i) * 0.15;
    
    plan.push({
      date,
      phase: 'pre_event',
      daysFromEvent: -i,
      budgetMultiplier: factor,
      bidMultiplier: Math.sqrt(factor),
      recommendedBudget: baseBudget * factor,
      recommendedBid: baseBid * Math.sqrt(factor),
      explanation: `${eventName}前${i}天，建议预算提升${((factor - 1) * 100).toFixed(0)}%`
    });
  }
  
  // 大促当天
  const eventDayFactor = 2.0;
  plan.push({
    date: eventDate,
    phase: 'event_day',
    daysFromEvent: 0,
    budgetMultiplier: eventDayFactor,
    bidMultiplier: Math.sqrt(eventDayFactor),
    recommendedBudget: baseBudget * eventDayFactor,
    recommendedBid: baseBid * Math.sqrt(eventDayFactor),
    explanation: `${eventName}当天，建议预算提升${((eventDayFactor - 1) * 100).toFixed(0)}%`
  });
  
  // 大促后调整（持续3天）
  for (let i = 1; i <= 3; i++) {
    const date = addDays(eventDate, i);
    const factor = 1 + (3 - i) * 0.2;
    
    plan.push({
      date,
      phase: 'post_event',
      daysFromEvent: i,
      budgetMultiplier: factor,
      bidMultiplier: Math.sqrt(factor),
      recommendedBudget: baseBudget * factor,
      recommendedBid: baseBid * Math.sqrt(factor),
      explanation: `${eventName}后${i}天，建议预算维持提升${((factor - 1) * 100).toFixed(0)}%`
    });
  }
  
  // 计算预估额外花费和销售
  const estimatedAdditionalSpend = plan.reduce((sum, day) => {
    return sum + (day.recommendedBudget - baseBudget);
  }, 0);
  
  // 假设大促期间ROAS提升20%
  const estimatedAdditionalSales = estimatedAdditionalSpend * 3.5;

  return {
    eventName,
    eventDate,
    totalDays: plan.length,
    dailyAdjustments: plan,
    estimatedAdditionalSpend,
    estimatedAdditionalSales
  };
}

/**
 * 获取即将到来的大促事件
 */
export function getUpcomingPromotionalEvents(
  daysAhead: number = 30
): { event: typeof PROMOTIONAL_EVENTS_2026[0]; daysUntil: number }[] {
  const today = new Date();
  const events: { event: typeof PROMOTIONAL_EVENTS_2026[0]; daysUntil: number }[] = [];
  
  for (const event of PROMOTIONAL_EVENTS_2026) {
    const daysUntil = Math.floor((event.date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntil >= 0 && daysUntil <= daysAhead) {
      events.push({ event, daysUntil });
    }
  }
  
  return events.sort((a, b) => a.daysUntil - b.daysUntil);
}

// ============================================================================
// 综合分析接口
// ============================================================================

export interface SpecialScenarioAnalysisResult {
  budgetDepletion: BudgetDepletionPrediction[];
  attributionAdjustment: {
    date: string;
    raw: { spend: number; sales: number; acos: number; roas: number };
    adjusted: AdjustedMetrics;
  }[];
  bidEfficiency: BidEfficiencyReport;
  seasonalStrategy: SeasonalAdjustmentStrategy;
  upcomingEvents: { event: typeof PROMOTIONAL_EVENTS_2026[0]; daysUntil: number }[];
  summary: {
    criticalIssues: string[];
    recommendations: string[];
    potentialSavings: number;
    potentialRevenueGain: number;
  };
}

/**
 * 运行所有特殊场景分析
 */
export async function runSpecialScenarioAnalysis(
  accountId: number,
  options: {
    targetAcos?: number;
    profitMargin?: number;
    minClicks?: number;
  } = {}
): Promise<SpecialScenarioAnalysisResult> {
  const { targetAcos = 0.25, profitMargin = 0.30, minClicks = 10 } = options;
  
  // 并行执行所有分析
  const [
    budgetDepletion,
    attributionAdjustment,
    bidEfficiency,
    seasonalStrategy,
  ] = await Promise.all([
    analyzeBudgetDepletionRisk(accountId),
    adjustRecentPerformanceData(accountId, 7),
    analyzeBidEfficiency(accountId, targetAcos, profitMargin, minClicks),
    generateSeasonalStrategy(accountId),
  ]);
  
  const upcomingEvents = getUpcomingPromotionalEvents(30);
  
  // 生成综合摘要
  const criticalIssues: string[] = [];
  const recommendations: string[] = [];
  let potentialSavings = 0;
  let potentialRevenueGain = 0;
  
  // 分析预算耗尽风险
  const criticalBudgetCampaigns = budgetDepletion.filter(p => p.riskLevel === 'critical');
  if (criticalBudgetCampaigns.length > 0) {
    criticalIssues.push(`${criticalBudgetCampaigns.length}个广告活动预算即将过早耗尽`);
    recommendations.push('建议立即检查并增加高风险广告活动的预算');
  }
  
  // 分析归因调整影响
  const recentAdjusted = attributionAdjustment.filter(a => a.adjusted.dataAge <= 3);
  if (recentAdjusted.length > 0) {
    const avgAdjustment = average(recentAdjusted.map(a => a.adjusted.adjustmentFactor));
    if (avgAdjustment > 1.2) {
      recommendations.push(`近期数据归因尚未完成，实际销售额可能比显示高${((avgAdjustment - 1) * 100).toFixed(0)}%`);
    }
  }
  
  // 分析竞价效率
  if (bidEfficiency.overbiddingCount > 0) {
    criticalIssues.push(`${bidEfficiency.overbiddingCount}个投放词存在过度竞价问题`);
    potentialSavings += bidEfficiency.totalPotentialSavings;
    recommendations.push(...bidEfficiency.recommendations);
  }
  
  // 分析季节性调整
  if (seasonalStrategy.eventName) {
    recommendations.push(seasonalStrategy.explanation);
    potentialRevenueGain += seasonalStrategy.budgetMultiplier > 1 
      ? (seasonalStrategy.budgetMultiplier - 1) * 1000 // 假设基础日销售$1000
      : 0;
  }
  
  // 分析即将到来的大促
  if (upcomingEvents.length > 0) {
    const nearestEvent = upcomingEvents[0];
    if (nearestEvent.daysUntil <= 7) {
      criticalIssues.push(`${nearestEvent.event.name}即将在${nearestEvent.daysUntil}天后到来`);
      recommendations.push(`建议立即准备${nearestEvent.event.name}的预算和出价调整计划`);
    }
  }

  return {
    budgetDepletion,
    attributionAdjustment,
    bidEfficiency,
    seasonalStrategy,
    upcomingEvents,
    summary: {
      criticalIssues,
      recommendations,
      potentialSavings,
      potentialRevenueGain
    }
  };
}
