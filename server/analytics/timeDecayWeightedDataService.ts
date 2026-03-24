/**
 * timeDecayWeightedDataService.ts - 时间衰减加权数据服务
 * 
 * v163: 替代简单的"过去30天汇总"，实现科学的多时间窗口加权数据系统
 * 
 * ==================== 核心设计理念 ====================
 * 
 * 1. 时间衰减权重：越近的数据对决策越有价值
 *    - 今天/昨天的数据：反映当前市场最新竞争态势
 *    - 7天内数据：反映近期产品竞争力和转化能力
 *    - 14天内数据：反映中短期趋势
 *    - 30天内数据：反映中期稳定表现
 *    - 60天内数据：反映长期基准
 *    - 90天内数据：提供历史参考
 * 
 * 2. 归因修正：Amazon广告有7-14天归因窗口
 *    - 最近1-3天的数据：订单归因极不完整，需要大幅修正
 *    - 最近4-7天的数据：订单归因部分完成，需要适度修正
 *    - 最近8-14天的数据：订单归因基本完成，轻微修正
 *    - 14天以上的数据：归因完整，无需修正
 * 
 * 3. 分层时间窗口权重（非简单指数衰减）：
 *    - 第1-3天（归因不完整期）：权重极低，仅用于花费/曝光参考
 *    - 第4-7天（近期高价值期）：权重最高，数据新鲜且归因较完整
 *    - 第8-14天（中期稳定期）：权重较高，数据完整可靠
 *    - 第15-30天（基准参考期）：权重中等，提供稳定基准
 *    - 第31-60天（历史参考期）：权重较低，用于趋势对比
 *    - 第61-90天（远期参考期）：权重很低，仅用于长期趋势
 * 
 * 4. 指标差异化处理：
 *    - 花费/曝光/点击：受归因影响小，近期数据权重可以更高
 *    - 销售/订单/ROAS/ACoS：受归因影响大，需要归因修正后再加权
 */

import * as db from '../db';

// ==================== 时间窗口配置 ====================

/**
 * 分层时间窗口定义
 * 每个窗口有不同的基础权重和归因修正系数
 */
export interface TimeWindow {
  name: string;
  startDaysAgo: number;  // 窗口起始（距今天数）
  endDaysAgo: number;    // 窗口结束（距今天数）
  baseWeight: number;    // 基础权重（0-1）
  attributionCompleteness: number; // 归因完整度（0-1，1=完全归因）
}

export const TIME_WINDOWS: TimeWindow[] = [
  {
    name: 'attribution_incomplete',  // 归因不完整期
    startDaysAgo: 0,
    endDaysAgo: 3,
    baseWeight: 0.05,               // 极低权重
    attributionCompleteness: 0.35,  // 仅35%的订单已归因
  },
  {
    name: 'recent_high_value',       // 近期高价值期
    startDaysAgo: 4,
    endDaysAgo: 7,
    baseWeight: 0.30,               // 最高权重
    attributionCompleteness: 0.75,  // 75%的订单已归因
  },
  {
    name: 'mid_term_stable',         // 中期稳定期
    startDaysAgo: 8,
    endDaysAgo: 14,
    baseWeight: 0.28,               // 较高权重
    attributionCompleteness: 0.92,  // 92%的订单已归因
  },
  {
    name: 'baseline_reference',      // 基准参考期
    startDaysAgo: 15,
    endDaysAgo: 30,
    baseWeight: 0.22,               // 中等权重
    attributionCompleteness: 1.0,   // 完全归因
  },
  {
    name: 'historical_reference',    // 历史参考期
    startDaysAgo: 31,
    endDaysAgo: 60,
    baseWeight: 0.10,               // 较低权重
    attributionCompleteness: 1.0,   // 完全归因
  },
  {
    name: 'long_term_reference',     // 远期参考期
    startDaysAgo: 61,
    endDaysAgo: 90,
    baseWeight: 0.05,               // 很低权重
    attributionCompleteness: 1.0,   // 完全归因
  },
];

// ==================== 数据结构定义 ====================

/** 单日原始数据 */
export interface DailyRawData {
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
}

/** 时间窗口聚合数据 */
export interface WindowAggregatedData {
  windowName: string;
  daysCount: number;       // 窗口内实际有数据的天数
  totalDays: number;       // 窗口总天数
  rawImpressions: number;
  rawClicks: number;
  rawSpend: number;
  rawSales: number;
  rawOrders: number;
  // 归因修正后的数据
  correctedSales: number;
  correctedOrders: number;
  // 日均数据
  dailyAvgSpend: number;
  dailyAvgSales: number;   // 归因修正后
  dailyAvgOrders: number;  // 归因修正后
  // 计算指标（归因修正后）
  acos: number;
  roas: number;
  ctr: number;
  cvr: number;
  cpc: number;
}

/** 时间衰减加权后的综合指标 */
export interface TimeWeightedMetrics {
  // 加权后的核心指标
  weightedAcos: number;
  weightedRoas: number;
  weightedCtr: number;
  weightedCvr: number;
  weightedCpc: number;
  // 加权后的日均数据
  weightedDailySpend: number;
  weightedDailySales: number;
  weightedDailyOrders: number;
  // 各窗口明细
  windowDetails: WindowAggregatedData[];
  // 数据质量评估
  dataQuality: {
    totalDaysWithData: number;
    coveragePercent: number;  // 数据覆盖率
    recentDataAvailable: boolean; // 近7天是否有数据
    confidenceLevel: 'high' | 'medium' | 'low' | 'insufficient';
  };
  // 趋势信号
  trendSignal: {
    direction: 'improving' | 'stable' | 'declining';
    strength: number;  // 0-1
    description: string;
  };
}

// ==================== 核心算法 ====================

/**
 * 将每日数据按时间窗口聚合
 */
function aggregateByTimeWindows(
  dailyData: DailyRawData[],
  windows: TimeWindow[] = TIME_WINDOWS
): WindowAggregatedData[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // @ts-ignore
  return windows.map(window => {
    // 筛选属于该窗口的数据
    const windowData = dailyData.filter(d => {
      const dataDate = new Date(d.date);
      dataDate.setHours(0, 0, 0, 0);
      const daysAgo = Math.floor((today.getTime() - dataDate.getTime()) / (1000 * 60 * 60 * 24));
      return daysAgo >= window.startDaysAgo && daysAgo <= window.endDaysAgo;
    });
    
    const totalDays = window.endDaysAgo - window.startDaysAgo + 1;
    const daysCount = windowData.length;
    
    // 原始汇总
    // @ts-ignore
    const rawImpressions = windowData.reduce((sum: number, d: Record<string, unknown>) => sum + d.impressions, 0);
    // @ts-ignore
    const rawClicks = windowData.reduce((sum: number, d: Record<string, unknown>) => sum + d.clicks, 0);
    // @ts-ignore
    const rawSpend = windowData.reduce((sum: number, d: Record<string, unknown>) => sum + d.spend, 0);
    // @ts-ignore
    const rawSales = windowData.reduce((sum: number, d: Record<string, unknown>) => sum + d.sales, 0);
    // @ts-ignore
    const rawOrders = windowData.reduce((sum: number, d: Record<string, unknown>) => sum + d.orders, 0);
    
    // 归因修正：对于归因不完整的窗口，按归因完整度反向修正
    // 例如：归因完整度35%意味着实际订单可能是报告值的 1/0.35 ≈ 2.86倍
    const attributionMultiplier = window.attributionCompleteness > 0 
      ? 1 / window.attributionCompleteness 
      : 1;
    
    // @ts-ignore
    const correctedSales = rawSales * attributionMultiplier;
    // @ts-ignore
    const correctedOrders = rawOrders * attributionMultiplier;
    
    // 计算日均（使用实际有数据的天数，避免除以0）
    // @ts-ignore
    const effectiveDays = Math.max(daysCount, 1);
    // @ts-ignore
    const dailyAvgSpend = rawSpend / effectiveDays;
    const dailyAvgSales = correctedSales / effectiveDays;
    const dailyAvgOrders = correctedOrders / effectiveDays;
    
    // 计算归因修正后的指标
    // @ts-ignore
    const acos = correctedSales > 0 ? (rawSpend / correctedSales) * 100 : 0;
    // @ts-ignore
    const roas = rawSpend > 0 ? correctedSales / rawSpend : 0;
    // @ts-ignore
    const ctr = rawImpressions > 0 ? (rawClicks / rawImpressions) * 100 : 0;
    // @ts-ignore
    const cvr = rawClicks > 0 ? (correctedOrders / rawClicks) * 100 : 0;
    // @ts-ignore
    const cpc = rawClicks > 0 ? rawSpend / rawClicks : 0;
    
    return {
      windowName: window.name,
      daysCount,
      totalDays,
      rawImpressions,
      rawClicks,
      rawSpend,
      rawSales,
      rawOrders,
      correctedSales,
      correctedOrders,
      dailyAvgSpend,
      dailyAvgSales,
      dailyAvgOrders,
      acos,
      roas,
      ctr,
      cvr,
      cpc,
    };
  });
}

/**
 * 计算时间衰减加权的综合指标
 * 
 * 核心逻辑：
 * 1. 对每个时间窗口的数据进行归因修正
 * 2. 按窗口的基础权重进行加权平均
 * 3. 无数据的窗口不参与加权（权重重新分配给有数据的窗口）
 * 4. 计算趋势信号（近期vs远期的变化方向）
 */
export function calculateTimeWeightedMetrics(
  dailyData: DailyRawData[],
  windows: TimeWindow[] = TIME_WINDOWS
): TimeWeightedMetrics {
  const windowDetails = aggregateByTimeWindows(dailyData, windows);
  
  // 筛选有数据的窗口，重新分配权重
  const activeWindows: Array<{ detail: WindowAggregatedData; window: TimeWindow; effectiveWeight: number }> = [];
  let totalActiveWeight = 0;
  
  for (let i = 0; i < windowDetails.length; i++) {
    const detail = windowDetails[i];
    const window = windows[i];
    
    if (detail.daysCount > 0 && detail.rawSpend > 0) {
      activeWindows.push({ detail, window, effectiveWeight: window.baseWeight });
      totalActiveWeight += window.baseWeight;
    }
  }
  
  // 归一化权重
  if (totalActiveWeight > 0) {
    for (const aw of activeWindows) {
      aw.effectiveWeight = aw.effectiveWeight / totalActiveWeight;
    }
  }
  
  // 加权计算核心指标
  let weightedAcos = 0, weightedRoas = 0, weightedCtr = 0, weightedCvr = 0, weightedCpc = 0;
  let weightedDailySpend = 0, weightedDailySales = 0, weightedDailyOrders = 0;
  
  for (const aw of activeWindows) {
    // @ts-ignore
    const w = aw.effectiveWeight;
    const d = aw.detail;
    
    weightedAcos += d.acos * w;
    weightedRoas += d.roas * w;
    weightedCtr += d.ctr * w;
    // @ts-ignore
    weightedCvr += d.cvr * w;
    weightedCpc += d.cpc * w;
    // @ts-ignore
    weightedDailySpend += d.dailyAvgSpend * w;
    weightedDailySales += d.dailyAvgSales * w;
    // @ts-ignore
    weightedDailyOrders += d.dailyAvgOrders * w;
  }
  
  // 数据质量评估
  // @ts-ignore
  const totalDaysWithData = windowDetails.reduce((sum: number, d: Record<string, unknown>) => sum + d.daysCount, 0);
  const totalPossibleDays = 90;
  // @ts-ignore
  const coveragePercent = (totalDaysWithData / totalPossibleDays) * 100;
  const recentDataAvailable = windowDetails[0].daysCount > 0 || windowDetails[1].daysCount > 0;
  
  let confidenceLevel: 'high' | 'medium' | 'low' | 'insufficient';
  // @ts-ignore
  if (totalDaysWithData >= 21 && recentDataAvailable) {
    confidenceLevel = 'high';
  // @ts-ignore
  } else if (totalDaysWithData >= 10) {
    confidenceLevel = 'medium';
  // @ts-ignore
  } else if (totalDaysWithData >= 3) {
    confidenceLevel = 'low';
  } else {
    // @ts-ignore
    confidenceLevel = 'insufficient';
  // @ts-ignore
  }
  
  // 趋势信号：比较近期（4-14天）vs 远期（15-60天）的表现
  const recentWindows = activeWindows.filter(aw => 
    aw.window.name === 'recent_high_value' || aw.window.name === 'mid_term_stable'
  );
  const olderWindows = activeWindows.filter(aw => 
    aw.window.name === 'baseline_reference' || aw.window.name === 'historical_reference'
  );
  
  let trendSignal: TimeWeightedMetrics['trendSignal'] = {
    direction: 'stable',
    strength: 0,
    description: '数据不足，无法判断趋势',
  };
  
  if (recentWindows.length > 0 && olderWindows.length > 0) {
    // 计算近期和远期的平均ROAS
    // @ts-ignore
    const recentAvgRoas = recentWindows.reduce((sum: number, aw: Record<string, unknown>) => sum + aw.detail.roas, 0) / recentWindows.length;
    // @ts-ignore
    const olderAvgRoas = olderWindows.reduce((sum: number, aw: Record<string, unknown>) => sum + aw.detail.roas, 0) / olderWindows.length;
    
    if (olderAvgRoas > 0) {
      const roasChange = (recentAvgRoas - olderAvgRoas) / olderAvgRoas;
      
      if (roasChange > 0.10) {
        trendSignal = {
          direction: 'improving',
          strength: Math.min(1, roasChange),
          description: `ROAS近期提升${(roasChange * 100).toFixed(0)}%，表现改善中`,
        };
      } else if (roasChange < -0.10) {
        trendSignal = {
          direction: 'declining',
          strength: Math.min(1, Math.abs(roasChange)),
          description: `ROAS近期下降${(Math.abs(roasChange) * 100).toFixed(0)}%，需要关注`,
        };
      // @ts-ignore
      } else {
        trendSignal = {
          direction: 'stable',
          strength: Math.abs(roasChange),
          description: `ROAS近期变化${(roasChange * 100).toFixed(0)}%，表现稳定`,
        };
      }
    }
  }
  
  return {
    weightedAcos,
    weightedRoas,
    weightedCtr,
    weightedCvr,
    weightedCpc,
    weightedDailySpend,
    weightedDailySales,
    weightedDailyOrders,
    windowDetails,
    dataQuality: {
      // @ts-ignore
      totalDaysWithData,
      coveragePercent,
      recentDataAvailable,
      confidenceLevel,
    },
    trendSignal,
  };
}

// ==================== Campaign级别数据获取 ====================

/**
 * 获取campaign的90天每日数据并计算时间衰减加权指标
 */
export async function getCampaignTimeWeightedMetrics(
  accountId: number,
  campaignId: number
): Promise<TimeWeightedMetrics> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 90);
  
  const rawData = await db.getDailyPerformanceByDateRange(accountId, startDate, endDate, campaignId);
  
  const dailyData: DailyRawData[] = rawData.map(d => ({
    date: typeof d.date === 'string' ? d.date : new Date(d.date).toISOString(),
    impressions: d.impressions || 0,
    clicks: d.clicks || 0,
    spend: parseFloat(String(d.spend || '0')),
    sales: parseFloat(String(d.sales || '0')),
    orders: d.orders || 0,
  }));
  
  return calculateTimeWeightedMetrics(dailyData);
}

// ==================== 优化目标级别数据获取 ====================

/**
 * 获取优化目标（performanceGroup）下所有campaign的汇总时间衰减加权指标
 */
export async function getPerformanceGroupTimeWeightedMetrics(
  performanceGroupId: number,
  // @ts-ignore
  accountId: number
// @ts-ignore
): Promise<TimeWeightedMetrics> {
  // @ts-ignore
  const campaigns = await db.getCampaignsByPerformanceGroupId(performanceGroupId);
  
  // @ts-ignore
  if (campaigns.length === 0) {
    // @ts-ignore
    return createEmptyMetrics();
  }
  
  // 收集所有campaign的90天每日数据
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 90);
  
  const allDailyData: DailyRawData[] = [];
  
  for (const campaign of (campaigns as unknown[])) {
    // @ts-ignore
    try {
      // v206: getDailyPerformanceByDateRange需要Amazon campaignId
      // @ts-ignore
      const rawData = await db.getDailyPerformanceByDateRange(accountId, startDate, endDate, campaign.campaignId);
      
      // @ts-ignore
      for (const d of (rawData as unknown[])) {
        // @ts-ignore
        allDailyData.push({
          // @ts-ignore
          date: typeof d.date === 'string' ? d.date : new Date(d.date).toISOString(),
          // @ts-ignore
          impressions: d.impressions || 0,
          // @ts-ignore
          clicks: d.clicks || 0,
          // @ts-ignore
          spend: parseFloat(String(d.spend || '0')),
          // @ts-ignore
          sales: parseFloat(String(d.sales || '0')),
          // @ts-ignore
          orders: d.orders || 0,
        });
      }
    } catch (e: any) {
      // 跳过获取失败的campaign
    }
  }
  
  // 按日期汇总（同一天多个campaign的数据合并）
  const dailyMap = new Map<string, DailyRawData>();
  for (const d of (allDailyData as unknown[])) {
    // @ts-ignore
    const dateKey = d.date.split('T')[0];
    const existing = dailyMap.get(dateKey);
    if (existing) {
      // @ts-ignore
      existing.impressions += d.impressions;
      // @ts-ignore
      existing.clicks += d.clicks;
      // @ts-ignore
      existing.spend += d.spend;
      // @ts-ignore
      existing.sales += d.sales;
      // @ts-ignore
      existing.orders += d.orders;
    } else {
      // @ts-ignore
      dailyMap.set(dateKey, { ...d, date: dateKey });
    }
  }
  
  const mergedDailyData = Array.from(dailyMap.values());
  return calculateTimeWeightedMetrics(mergedDailyData);
}

// ==================== 投放词/商品定向级别数据 ====================

/**
 * 基于keyword的汇总数据（来自keywords表）和campaign级别的时间衰减指标，
 * 计算该keyword的时间衰减加权调整系数
 * 
 * 由于keyword级别没有每日数据，我们使用campaign级别的趋势信号
 * 来修正keyword的静态汇总数据
 */
export function calculateKeywordAdjustmentFactor(
  // @ts-ignore
  keywordMetrics: {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
  },
  campaignTimeWeighted: TimeWeightedMetrics
): {
  adjustedRoas: number;
  adjustedAcos: number;
  trendMultiplier: number;
  confidenceLevel: string;
} {
  const keywordRoas = keywordMetrics.spend > 0 ? keywordMetrics.sales / keywordMetrics.spend : 0;
  const keywordAcos = keywordMetrics.sales > 0 ? (keywordMetrics.spend / keywordMetrics.sales) * 100 : 0;
  
  // 趋势修正系数：如果campaign近期趋势向好，keyword的ROAS可能被低估（因为keyword数据包含了更多旧数据）
  let trendMultiplier = 1.0;
  
  if (campaignTimeWeighted.trendSignal.direction === 'improving') {
    // 近期改善：keyword的实际ROAS可能比汇总值更好
    trendMultiplier = 1 + campaignTimeWeighted.trendSignal.strength * 0.15;
  } else if (campaignTimeWeighted.trendSignal.direction === 'declining') {
    // 近期下降：keyword的实际ROAS可能比汇总值更差
    trendMultiplier = 1 - campaignTimeWeighted.trendSignal.strength * 0.15;
  }
  
  // 归因修正：keyword的汇总数据可能包含近期未完全归因的数据
  // 使用campaign级别的归因修正比例
  const recentWindow = campaignTimeWeighted.windowDetails.find(w => w.windowName === 'attribution_incomplete');
  // @ts-ignore
  const totalWindow = campaignTimeWeighted.windowDetails.reduce((sum: number, w: Record<string, unknown>) => sum + w.rawSpend, 0);
  
  let attributionAdjustment = 1.0;
  // @ts-ignore
  if (recentWindow && totalWindow > 0) {
    // 如果近期（归因不完整期）的花费占比较高，需要更大的归因修正
    // @ts-ignore
    const recentSpendRatio = recentWindow.rawSpend / totalWindow;
    if (recentSpendRatio > 0.1) {
      attributionAdjustment = 1 + recentSpendRatio * 0.3; // 最多修正30%
    }
  }
  
  const adjustedRoas = keywordRoas * trendMultiplier * attributionAdjustment;
  const adjustedAcos = adjustedRoas > 0 ? (1 / adjustedRoas) * 100 : keywordAcos;
  
  return {
    adjustedRoas,
    adjustedAcos,
    trendMultiplier,
    confidenceLevel: campaignTimeWeighted.dataQuality.confidenceLevel,
  };
}

// ==================== 渐进式预算目标计算 ====================

/**
 * 计算渐进式预算调整目标
 * 
 * 核心原则：
 * - 如果当前日均花费远高于目标，不能一步到位降低
 * - 每次调整最多缩小当前值与目标值之间差距的20-30%
 * - 确保订单和销量不会断崖式下跌
 * 
 * @param currentDailySpend - 当前日均花费（基于时间衰减加权）
 * @param targetDailyBudget - 用户设定的目标日预算
 * @param currentDailySales - 当前日均销售额
 * @param currentDailyOrders - 当前日均订单数
 * @returns 本次调整的目标预算
 */
export function calculateGradualBudgetTarget(
  currentDailySpend: number,
  targetDailyBudget: number,
  currentDailySales: number,
  currentDailyOrders: number
): {
  suggestedBudget: number;
  adjustmentPercent: number;
  stepsRemaining: number;
  reason: string;
} {
  if (targetDailyBudget <= 0 || currentDailySpend <= 0) {
    return {
      suggestedBudget: targetDailyBudget || currentDailySpend,
      adjustmentPercent: 0,
      stepsRemaining: 0,
      reason: '目标或当前花费无效',
    };
  }
  
  const gap = currentDailySpend - targetDailyBudget;
  const gapPercent = gap / currentDailySpend;
  
  // 如果当前花费已经在目标范围内（±10%），不需要调整
  if (Math.abs(gapPercent) <= 0.10) {
    return {
      suggestedBudget: targetDailyBudget,
      adjustmentPercent: 0,
      stepsRemaining: 0,
      reason: '当前花费已接近目标',
    };
  }
  
  // 渐进式调整：每次缩小差距的25%
  const GRADUAL_STEP_RATIO = 0.25;
  // 但单次调整不超过当前值的15%
  const MAX_SINGLE_CHANGE_PERCENT = 0.15;
  
  let stepAdjustment = gap * GRADUAL_STEP_RATIO;
  const maxAdjustment = currentDailySpend * MAX_SINGLE_CHANGE_PERCENT;
  
  if (Math.abs(stepAdjustment) > maxAdjustment) {
    stepAdjustment = stepAdjustment > 0 ? maxAdjustment : -maxAdjustment;
  }
  
  const suggestedBudget = Math.round((currentDailySpend - stepAdjustment) * 100) / 100;
  const adjustmentPercent = (stepAdjustment / currentDailySpend) * 100;
  
  // 估算还需要多少步才能达到目标
  const remainingGap = Math.abs(suggestedBudget - targetDailyBudget);
  const avgStepSize = Math.abs(stepAdjustment);
  const stepsRemaining = avgStepSize > 0 ? Math.ceil(remainingGap / avgStepSize) : 0;
  
  let reason: string;
  if (gap > 0) {
    reason = `当前日均花费$${currentDailySpend.toFixed(0)}超出目标$${targetDailyBudget.toFixed(0)}，渐进降低${adjustmentPercent.toFixed(1)}%（预计${stepsRemaining}步达成）`;
  } else {
    reason = `当前日均花费$${currentDailySpend.toFixed(0)}低于目标$${targetDailyBudget.toFixed(0)}，渐进提升${Math.abs(adjustmentPercent).toFixed(1)}%`;
  }
  
  return {
    suggestedBudget: Math.max(1, suggestedBudget),
    adjustmentPercent,
    stepsRemaining,
    reason,
  };
}

// ==================== 渐进式竞价调整计算 ====================

/**
 * 计算渐进式竞价调整
 * 
 * 核心原则：
 * - 基于时间衰减加权的ROAS/ACoS来判断调整方向
 * - 数据置信度越高，允许的调整幅度越大
 * - 趋势向好时可以稍微激进，趋势向差时更加保守
 * - 单次调整幅度根据数据质量动态限制
 */
export function calculateGradualBidAdjustment(
  currentBid: number,
  targetBid: number,
  dataConfidence: 'high' | 'medium' | 'low' | 'insufficient',
  trendDirection: 'improving' | 'stable' | 'declining'
): {
  adjustedBid: number;
  maxAllowedChange: number;
  reason: string;
} {
  // 根据数据置信度确定最大调整幅度
  const confidenceMaxChange: Record<string, number> = {
    high: 0.20,         // 高置信度：最多调整20%
    medium: 0.12,       // 中置信度：最多调整12%
    low: 0.07,          // 低置信度：最多调整7%
    insufficient: 0.03, // 数据不足：最多调整3%
  };
  
  let maxChange = confidenceMaxChange[dataConfidence] || 0.10;
  
  // 趋势修正：趋势向好时允许稍大的提价幅度
  if (trendDirection === 'improving' && targetBid > currentBid) {
    maxChange *= 1.15; // 提价时允许多15%
  } else if (trendDirection === 'declining' && targetBid < currentBid) {
    maxChange *= 1.10; // 降价时允许多10%
  } else if (trendDirection === 'declining' && targetBid > currentBid) {
    maxChange *= 0.60; // 趋势下降时限制提价
  }
  
  const bidDiff = targetBid - currentBid;
  const maxAbsChange = currentBid * maxChange;
  
  let adjustedBid: number;
  if (Math.abs(bidDiff) <= maxAbsChange) {
    adjustedBid = targetBid;
  } else {
    adjustedBid = currentBid + (bidDiff > 0 ? maxAbsChange : -maxAbsChange);
  }
  
  // 确保最低出价
  adjustedBid = Math.max(0.02, Math.round(adjustedBid * 100) / 100);
  
  const actualChange = Math.abs(adjustedBid - currentBid) / currentBid;
  const reason = `渐进调整: $${currentBid.toFixed(2)}→$${adjustedBid.toFixed(2)} (${(actualChange * 100).toFixed(1)}%, 置信度=${dataConfidence}, 趋势=${trendDirection})`;
  
  return {
    adjustedBid,
    maxAllowedChange: maxChange,
    reason,
  };
}

// ==================== 辅助函数 ====================

function createEmptyMetrics(): TimeWeightedMetrics {
  return {
    weightedAcos: 0,
    weightedRoas: 0,
    weightedCtr: 0,
    weightedCvr: 0,
    weightedCpc: 0,
    weightedDailySpend: 0,
    weightedDailySales: 0,
    weightedDailyOrders: 0,
    windowDetails: [],
    dataQuality: {
      totalDaysWithData: 0,
      coveragePercent: 0,
      recentDataAvailable: false,
      confidenceLevel: 'insufficient',
    },
    trendSignal: {
      direction: 'stable',
      strength: 0,
      description: '无数据',
    },
  };
}

// ==================== v491: 数据悬崖检测 ====================

/**
 * v491: 数据悬崖检测结果
 * 
 * 检测近期数据是否出现断崖式下跌，这通常是由于：
 * 1. 错误的优化操作（出价大幅降低导致曝光/点击骤降）
 * 2. 预算耗尽导致广告暂停
 * 3. 竞争环境突变
 * 
 * 当检测到数据悬崖时，系统应使用更长时间窗口的数据作为决策基础，
 * 避免被近期异常数据误导。
 */
export interface DataCliffDetectionResult {
  /** 是否检测到数据悬崖 */
  cliffDetected: boolean;
  /** 悬崖类型 */
  cliffType: 'none' | 'impression_cliff' | 'click_cliff' | 'spend_cliff' | 'sales_cliff';
  /** 下跌幅度 (0-1) */
  dropMagnitude: number;
  /** 悬崖发生的大致时间（距今天数） */
  cliffDaysAgo: number;
  /** 推荐使用的最小时间窗口（天数） */
  recommendedMinWindowDays: number;
  /** 是否可能由优化操作引起 */
  likelyOptimizationCaused: boolean;
  /** 诊断说明 */
  diagnosis: string;
}

/**
 * v491: 检测数据悬崖
 * 
 * 算法：
 * 1. 将90天数据按周分组，计算每周的关键指标均值
 * 2. 比较相邻周的指标变化，检测是否存在超过阈值的突然下跌
 * 3. 如果检测到悬崖，推荐使用悬崖前的更长时间窗口数据
 * 
 * @param dailyData 90天每日数据
 * @param recentOptimizationEvents 近期优化事件（用于判断悬崖是否由优化引起）
 */
export function detectDataCliff(
  dailyData: DailyRawData[],
  recentOptimizationEvents?: Array<{ date: string; actionType: string; bidChange: number }>
): DataCliffDetectionResult {
  const noCliff: DataCliffDetectionResult = {
    cliffDetected: false,
    cliffType: 'none',
    dropMagnitude: 0,
    cliffDaysAgo: 0,
    recommendedMinWindowDays: 7,
    likelyOptimizationCaused: false,
    diagnosis: '未检测到数据悬崖',
  };

  if (dailyData.length < 14) {
    return { ...noCliff, diagnosis: '数据不足14天，无法进行悬崖检测' };
  }

  // 按日期排序（从旧到新）
  const sorted = [...dailyData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 将数据按周分组（最多13周 = 90天）
  interface WeeklyBucket {
    weekIndex: number;  // 0 = 最近一周
    avgImpressions: number;
    avgClicks: number;
    avgSpend: number;
    avgSales: number;
    daysWithData: number;
  }

  const weekBuckets: WeeklyBucket[] = [];
  for (let w = 0; w < 13; w++) {
    const weekStart = w * 7;
    const weekEnd = (w + 1) * 7 - 1;
    const weekData = sorted.filter(d => {
      const dataDate = new Date(d.date);
      dataDate.setHours(0, 0, 0, 0);
      const daysAgo = Math.floor((today.getTime() - dataDate.getTime()) / (1000 * 60 * 60 * 24));
      return daysAgo >= weekStart && daysAgo <= weekEnd;
    });

    if (weekData.length > 0) {
      weekBuckets.push({
        weekIndex: w,
        avgImpressions: weekData.reduce((s, d) => s + d.impressions, 0) / weekData.length,
        avgClicks: weekData.reduce((s, d) => s + d.clicks, 0) / weekData.length,
        avgSpend: weekData.reduce((s, d) => s + d.spend, 0) / weekData.length,
        avgSales: weekData.reduce((s, d) => s + d.sales, 0) / weekData.length,
        daysWithData: weekData.length,
      });
    }
  }

  if (weekBuckets.length < 3) {
    return { ...noCliff, diagnosis: '有效周数据不足3周，无法进行悬崖检测' };
  }

  // 检测各指标的悬崖
  // 悬崖定义：相邻周之间某指标下降超过50%，且之前的周数据相对稳定
  const CLIFF_THRESHOLD = 0.50; // 50%下跌视为悬崖
  const STABILITY_THRESHOLD = 0.30; // 30%以内波动视为稳定

  interface CliffCandidate {
    type: 'impression_cliff' | 'click_cliff' | 'spend_cliff' | 'sales_cliff';
    weekIndex: number;
    dropMagnitude: number;
    beforeAvg: number;
    afterAvg: number;
  }

  const cliffCandidates: CliffCandidate[] = [];

  // 从最近的周向过去扫描，寻找悬崖点
  for (let i = 0; i < weekBuckets.length - 1; i++) {
    const recentWeek = weekBuckets[i];
    const olderWeek = weekBuckets[i + 1];

    // 检查曝光悬崖
    if (olderWeek.avgImpressions > 50) { // 基线至少50曝光/天
      const impressionDrop = (olderWeek.avgImpressions - recentWeek.avgImpressions) / olderWeek.avgImpressions;
      if (impressionDrop > CLIFF_THRESHOLD) {
        cliffCandidates.push({
          type: 'impression_cliff',
          weekIndex: i,
          dropMagnitude: impressionDrop,
          beforeAvg: olderWeek.avgImpressions,
          afterAvg: recentWeek.avgImpressions,
        });
      }
    }

    // 检查点击悬崖
    if (olderWeek.avgClicks > 2) { // 基线至少2点击/天
      const clickDrop = (olderWeek.avgClicks - recentWeek.avgClicks) / olderWeek.avgClicks;
      if (clickDrop > CLIFF_THRESHOLD) {
        cliffCandidates.push({
          type: 'click_cliff',
          weekIndex: i,
          dropMagnitude: clickDrop,
          beforeAvg: olderWeek.avgClicks,
          afterAvg: recentWeek.avgClicks,
        });
      }
    }

    // 检查花费悬崖
    if (olderWeek.avgSpend > 1) { // 基线至少$1/天
      const spendDrop = (olderWeek.avgSpend - recentWeek.avgSpend) / olderWeek.avgSpend;
      if (spendDrop > CLIFF_THRESHOLD) {
        cliffCandidates.push({
          type: 'spend_cliff',
          weekIndex: i,
          dropMagnitude: spendDrop,
          beforeAvg: olderWeek.avgSpend,
          afterAvg: recentWeek.avgSpend,
        });
      }
    }
  }

  if (cliffCandidates.length === 0) {
    return noCliff;
  }

  // 选择最严重的悬崖
  cliffCandidates.sort((a, b) => b.dropMagnitude - a.dropMagnitude);
  const worstCliff = cliffCandidates[0];

  // 计算悬崖发生的大致天数
  const cliffDaysAgo = (worstCliff.weekIndex + 1) * 7;

  // 推荐的最小时间窗口：悬崖前至少2周的数据
  const recommendedMinWindowDays = Math.min(90, cliffDaysAgo + 14);

  // 判断是否可能由优化操作引起
  let likelyOptimizationCaused = false;
  if (recentOptimizationEvents && recentOptimizationEvents.length > 0) {
    // 检查悬崖前后7天内是否有大幅降价操作
    const cliffDate = new Date(today);
    cliffDate.setDate(cliffDate.getDate() - cliffDaysAgo);
    const cliffWindowStart = new Date(cliffDate.getTime() - 7 * 24 * 3600000);
    const cliffWindowEnd = new Date(cliffDate.getTime() + 3 * 24 * 3600000);

    const nearbyBidDecreases = recentOptimizationEvents.filter(evt => {
      const evtDate = new Date(evt.date);
      return evtDate >= cliffWindowStart && evtDate <= cliffWindowEnd
        && evt.actionType === 'bid_decrease'
        && evt.bidChange < -0.15; // 降幅超过15%
    });

    likelyOptimizationCaused = nearbyBidDecreases.length > 0;
  }

  const diagnosis = likelyOptimizationCaused
    ? `检测到${worstCliff.type}：日均${worstCliff.beforeAvg.toFixed(1)}→${worstCliff.afterAvg.toFixed(1)}（下降${(worstCliff.dropMagnitude * 100).toFixed(0)}%），` +
      `约${cliffDaysAgo}天前发生，可能由近期出价调整引起。建议使用${recommendedMinWindowDays}天以上的数据窗口。`
    : `检测到${worstCliff.type}：日均${worstCliff.beforeAvg.toFixed(1)}→${worstCliff.afterAvg.toFixed(1)}（下降${(worstCliff.dropMagnitude * 100).toFixed(0)}%），` +
      `约${cliffDaysAgo}天前发生。建议使用${recommendedMinWindowDays}天以上的数据窗口。`;

  return {
    cliffDetected: true,
    cliffType: worstCliff.type,
    dropMagnitude: worstCliff.dropMagnitude,
    cliffDaysAgo,
    recommendedMinWindowDays,
    likelyOptimizationCaused,
    diagnosis,
  };
}

/**
 * v491: 数据悬崖感知的时间衰减加权指标计算
 * 
 * 增强版的calculateTimeWeightedMetrics：
 * 1. 先检测数据悬崖
 * 2. 如果检测到悬崖，动态调整时间窗口权重：
 *    - 降低悬崖后（受影响期间）的数据权重
 *    - 提高悬崖前（正常期间）的数据权重
 * 3. 返回增强的指标，包含悬崖检测信息
 */
export function calculateCliffAwareTimeWeightedMetrics(
  dailyData: DailyRawData[],
  recentOptimizationEvents?: Array<{ date: string; actionType: string; bidChange: number }>
): TimeWeightedMetrics & { cliffDetection: DataCliffDetectionResult } {
  // 先进行悬崖检测
  const cliffResult = detectDataCliff(dailyData, recentOptimizationEvents);

  if (!cliffResult.cliffDetected) {
    // 无悬崖，使用标准时间衰减加权
    const metrics = calculateTimeWeightedMetrics(dailyData);
    return { ...metrics, cliffDetection: cliffResult };
  }

  // 检测到悬崖：动态调整窗口权重
  // 核心思路：悬崖后的数据权重大幅降低，悬崖前的数据权重提高
  const adjustedWindows: TimeWindow[] = TIME_WINDOWS.map(w => {
    const windowMidpoint = (w.startDaysAgo + w.endDaysAgo) / 2;

    if (windowMidpoint < cliffResult.cliffDaysAgo) {
      // 悬崖后的窗口（受影响的近期数据）：大幅降低权重
      // 如果是优化操作引起的，权重降得更低（因为数据不代表真实市场表现）
      const reductionFactor = cliffResult.likelyOptimizationCaused ? 0.15 : 0.30;
      return { ...w, baseWeight: w.baseWeight * reductionFactor };
    } else {
      // 悬崖前的窗口（正常数据）：提高权重
      return { ...w, baseWeight: w.baseWeight * 1.5 };
    }
  });

  const metrics = calculateTimeWeightedMetrics(dailyData, adjustedWindows);

  // 更新趋势信号：如果悬崖是优化引起的，趋势信号应标记为declining
  if (cliffResult.likelyOptimizationCaused && metrics.trendSignal.direction !== 'declining') {
    metrics.trendSignal = {
      direction: 'declining',
      strength: cliffResult.dropMagnitude,
      description: `[v491悬崖检测] ${cliffResult.diagnosis}`,
    };
  }

  return { ...metrics, cliffDetection: cliffResult };
}
