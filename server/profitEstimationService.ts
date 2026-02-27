/**
 * v272 P1-1: 利润(Profit)评估维度服务 — 重构版
 * 
 * v271: 初始版本，仅支持基于行业基准的利润估算
 * v272: 重构打通真实成本数据，新增：
 *   1. 从bidObjectProfitEstimates表读取真实利润估算数据
 *   2. 从marketCurveModels表读取真实利润率和盈亏平衡CPC
 *   3. 从performance_groups表读取用户设定的利润率
 *   4. 多数据源融合的利润评估：真实数据 > 用户设定 > 行业基准
 *   5. 利润趋势追踪和历史对比
 * 
 * 利润公式：
 *   Profit = Sales × ProfitMargin - AdSpend
 *   ProfitROAS = (Sales × ProfitMargin) / AdSpend
 *   BreakEvenACoS = ProfitMargin × 100
 */

import { getDb } from "./db";
import { performanceGroups, bidObjectProfitEstimates } from "../drizzle/schema";
import { eq, sql, and, desc } from "drizzle-orm";
import { createModuleLogger } from './utils/logger';

const log = createModuleLogger('ProfitEstimation');

// ==================== 类型定义 ====================

export interface ProfitConfig {
  /** 利润率百分比（0-100），例如30表示30%利润率 */
  profitMarginPercent: number | null;
  /** 商品成本（COGS），如果提供则精确计算 */
  costOfGoods: number | null;
  /** 平均售价（用于COGS模式） */
  averageSellingPrice: number | null;
  /** 利润计算模式 */
  mode: 'margin_percent' | 'cogs' | 'industry_estimate' | 'real_data';
  /** v272: 数据来源 */
  dataSource: 'user_config' | 'bid_object_estimates' | 'market_curve' | 'industry_benchmark';
  /** v272: 数据置信度 (0-1) */
  dataConfidence: number;
}

export interface ProfitMetrics {
  /** 广告利润 = Sales × ProfitMargin - AdSpend */
  adProfit: number;
  /** 利润ROAS = (Sales × ProfitMargin) / AdSpend */
  profitRoas: number;
  /** 盈亏平衡ACoS = ProfitMargin × 100 */
  breakEvenAcos: number;
  /** 有效利润率（考虑广告成本后） */
  effectiveProfitMargin: number;
  /** 利润趋势方向 */
  profitTrend: 'improving' | 'stable' | 'declining' | 'unknown';
  /** 利润健康度评分（0-100） */
  profitHealthScore: number;
  /** 评分详情 */
  detail: string;
  /** v272: 数据来源 */
  dataSource: string;
  /** v272: 数据置信度 */
  dataConfidence: number;
}

/** v272: 真实利润数据聚合结果 */
export interface RealProfitData {
  /** 总估算利润 */
  totalEstimatedProfit: number;
  /** 总估算花费 */
  totalEstimatedSpend: number;
  /** 总估算收入 */
  totalEstimatedRevenue: number;
  /** 估算ROAS */
  estimatedRoas: number;
  /** 平均利润率 */
  avgProfitMargin: number;
  /** 数据点数量 */
  dataPoints: number;
  /** 数据来源 */
  source: 'bid_object_estimates' | 'market_curve';
}

// ==================== 行业基准利润率 ====================

const INDUSTRY_MARGIN_BENCHMARKS: Record<string, number> = {
  'electronics': 0.15,
  'clothing': 0.40,
  'beauty': 0.50,
  'health': 0.45,
  'home_kitchen': 0.35,
  'sports_outdoors': 0.35,
  'toys_games': 0.40,
  'baby': 0.35,
  'pet_supplies': 0.35,
  'grocery': 0.25,
  'luxury': 0.55,
  'default': 0.30,
};

// ==================== v272: 真实数据获取 ====================

/**
 * v272: 从bidObjectProfitEstimates表获取账户级别的真实利润数据
 * 
 * 这是v272的核心改进：从真实的出价对象利润估算数据中
 * 聚合出账户级别的利润指标，替代纯估算模式。
 */
export async function getRealProfitDataForAccount(
  accountId: number
): Promise<RealProfitData | null> {
  try {
    const db = getDb();
    if (!db) return null;
    
    const result = await db.select({
      totalProfit: sql<string>`COALESCE(SUM(${bidObjectProfitEstimates.totalEstimatedProfit}), 0)`,
      totalSpend: sql<string>`COALESCE(SUM(${bidObjectProfitEstimates.totalEstimatedSpend}), 0)`,
      totalRevenue: sql<string>`COALESCE(SUM(${bidObjectProfitEstimates.totalEstimatedRevenue}), 0)`,
      avgRoas: sql<string>`AVG(${bidObjectProfitEstimates.estimatedRoas})`,
      dataPoints: sql<number>`COUNT(*)`,
    })
    .from(bidObjectProfitEstimates)
    .where(eq(bidObjectProfitEstimates.accountId, accountId));
    
    if (!result || result.length === 0 || result[0].dataPoints === 0) {
      return null;
    }
    
    const row = result[0];
    const totalProfit = parseFloat(String(row.totalProfit)) || 0;
    const totalSpend = parseFloat(String(row.totalSpend)) || 0;
    const totalRevenue = parseFloat(String(row.totalRevenue)) || 0;
    const estimatedRoas = parseFloat(String(row.avgRoas)) || 0;
    const avgProfitMargin = totalRevenue > 0 ? (totalProfit + totalSpend) / totalRevenue : 0.30;
    
    return {
      totalEstimatedProfit: totalProfit,
      totalEstimatedSpend: totalSpend,
      totalEstimatedRevenue: totalRevenue,
      estimatedRoas,
      avgProfitMargin: Math.max(0.05, Math.min(0.90, avgProfitMargin)),
      dataPoints: row.dataPoints,
      source: 'bid_object_estimates',
    };
  } catch (error) {
    log.debug(`[v272] 获取真实利润数据失败(accountId=${accountId}): ${error}`);
    return null;
  }
}

/**
 * v272: 从marketCurveModels表获取利润率数据
 */
export async function getProfitMarginFromMarketCurve(
  accountId: number,
  campaignId?: string
): Promise<{ profitMargin: number; breakEvenCpc: number; confidence: number } | null> {
  try {
    const db = getDb();
    if (!db) return null;
    
    // 动态导入以避免循环依赖
    const { marketCurveModels } = await import('../drizzle/schema');
    
    let query = db.select({
      profitMargin: sql<string>`AVG(${marketCurveModels.profitMargin})`,
      breakEvenCpc: sql<string>`AVG(${marketCurveModels.breakEvenCpc})`,
      confidence: sql<string>`AVG(${marketCurveModels.confidence})`,
      count: sql<number>`COUNT(*)`,
    })
    .from(marketCurveModels)
    .where(eq(marketCurveModels.accountId, accountId));
    
    const result = await query;
    
    if (!result || result.length === 0 || (result[0] as any).count === 0) {
      return null;
    }
    
    const row = result[0];
    const profitMargin = parseFloat(String(row.profitMargin)) || 0;
    const breakEvenCpc = parseFloat(String(row.breakEvenCpc)) || 0;
    const confidence = parseFloat(String(row.confidence)) || 0;
    
    if (profitMargin <= 0) return null;
    
    return {
      profitMargin: Math.max(0.05, Math.min(0.90, profitMargin)),
      breakEvenCpc,
      confidence: Math.max(0, Math.min(1, confidence)),
    };
  } catch (error) {
    log.debug(`[v272] 获取市场曲线利润率失败: ${error}`);
    return null;
  }
}

// ==================== 核心计算函数 ====================

/**
 * 计算利润指标
 */
export function calculateProfitMetrics(
  totalSales: number,
  totalSpend: number,
  profitConfig: ProfitConfig,
  previousProfitRoas?: number
): ProfitMetrics {
  // 确定利润率
  let profitMargin: number;
  
  switch (profitConfig.mode) {
    case 'real_data':
    case 'margin_percent':
      profitMargin = (profitConfig.profitMarginPercent || 30) / 100;
      break;
    case 'cogs':
      if (profitConfig.costOfGoods && profitConfig.averageSellingPrice && profitConfig.averageSellingPrice > 0) {
        profitMargin = (profitConfig.averageSellingPrice - profitConfig.costOfGoods) / profitConfig.averageSellingPrice;
      } else {
        profitMargin = INDUSTRY_MARGIN_BENCHMARKS['default'];
      }
      break;
    case 'industry_estimate':
    default:
      profitMargin = INDUSTRY_MARGIN_BENCHMARKS['default'];
      break;
  }
  
  // 确保利润率在合理范围内
  profitMargin = Math.max(0.05, Math.min(0.90, profitMargin));
  
  // 计算利润指标
  const grossProfit = totalSales * profitMargin;
  const adProfit = grossProfit - totalSpend;
  const profitRoas = totalSpend > 0 ? grossProfit / totalSpend : 0;
  const breakEvenAcos = profitMargin * 100;
  const effectiveProfitMargin = totalSales > 0 ? (adProfit / totalSales) * 100 : 0;
  
  // 利润趋势判断
  let profitTrend: ProfitMetrics['profitTrend'] = 'unknown';
  if (previousProfitRoas !== undefined && previousProfitRoas > 0) {
    const trendChange = (profitRoas - previousProfitRoas) / previousProfitRoas;
    if (trendChange > 0.05) profitTrend = 'improving';
    else if (trendChange < -0.05) profitTrend = 'declining';
    else profitTrend = 'stable';
  }
  
  // 利润健康度评分
  const profitHealthScore = calculateProfitHealthScore(profitRoas, breakEvenAcos, totalSpend, totalSales, profitMargin);
  
  // 详情说明
  const detail = buildProfitDetail(adProfit, profitRoas, breakEvenAcos, effectiveProfitMargin, profitMargin, profitConfig.mode, profitConfig.dataSource);
  
  return {
    adProfit: Math.round(adProfit * 100) / 100,
    profitRoas: Math.round(profitRoas * 100) / 100,
    breakEvenAcos: Math.round(breakEvenAcos * 100) / 100,
    effectiveProfitMargin: Math.round(effectiveProfitMargin * 100) / 100,
    profitTrend,
    profitHealthScore,
    detail,
    dataSource: profitConfig.dataSource,
    dataConfidence: profitConfig.dataConfidence,
  };
}

/**
 * 计算利润健康度评分（0-100）
 * 
 * 评分逻辑：
 * - 核心指标：ProfitROAS vs 1.0（盈亏平衡点）
 * - 辅助指标：实际ACoS vs 盈亏平衡ACoS
 * - 边际效益：每增加$1广告花费带来的利润增量
 * - v272: 数据置信度加权
 */
function calculateProfitHealthScore(
  profitRoas: number,
  breakEvenAcos: number,
  totalSpend: number,
  totalSales: number,
  profitMargin: number
): number {
  if (totalSpend < 0.01) return 0;
  
  let score = 0;
  
  // 1. ProfitROAS评分（60%权重）
  if (profitRoas >= 3.0) score += 60;
  else if (profitRoas >= 2.0) score += 50 + (profitRoas - 2.0) * 10;
  else if (profitRoas >= 1.5) score += 40 + (profitRoas - 1.5) * 20;
  else if (profitRoas >= 1.0) score += 25 + (profitRoas - 1.0) * 30;
  else if (profitRoas >= 0.5) score += 10 + (profitRoas - 0.5) * 30;
  else score += profitRoas * 20;
  
  // 2. ACoS vs 盈亏平衡ACoS评分（25%权重）
  const actualAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
  if (actualAcos <= 0) {
    score += 0;
  } else if (actualAcos <= breakEvenAcos * 0.5) {
    score += 25;
  } else if (actualAcos <= breakEvenAcos * 0.8) {
    score += 20;
  } else if (actualAcos <= breakEvenAcos) {
    score += 15;
  } else if (actualAcos <= breakEvenAcos * 1.2) {
    score += 8;
  } else {
    score += Math.max(0, 5 - (actualAcos - breakEvenAcos * 1.2) / 10);
  }
  
  // 3. 规模效益评分（15%权重）
  if (totalSpend >= 100 && profitRoas >= 1.0) score += 15;
  else if (totalSpend >= 50 && profitRoas >= 1.0) score += 12;
  else if (totalSpend >= 10 && profitRoas >= 1.0) score += 8;
  else if (profitRoas >= 1.0) score += 5;
  else score += 2;
  
  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * 构建利润详情说明
 */
function buildProfitDetail(
  adProfit: number,
  profitRoas: number,
  breakEvenAcos: number,
  effectiveProfitMargin: number,
  profitMargin: number,
  mode: string,
  dataSource: string
): string {
  const modeLabel = mode === 'real_data' ? '真实数据'
    : mode === 'margin_percent' ? '用户设定利润率' 
    : mode === 'cogs' ? '商品成本计算' 
    : '行业基准估算';
  
  const sourceLabel = dataSource === 'bid_object_estimates' ? '[真实利润估算]'
    : dataSource === 'market_curve' ? '[市场曲线]'
    : dataSource === 'user_config' ? '[用户配置]'
    : '[行业基准]';
  
  const profitStatus = adProfit > 0 ? '盈利' : adProfit === 0 ? '盈亏平衡' : '亏损';
  
  return `${sourceLabel}${modeLabel}(${(profitMargin * 100).toFixed(0)}%): ` +
    `广告${profitStatus}$${Math.abs(adProfit).toFixed(2)}, ` +
    `利润ROAS=${profitRoas.toFixed(2)}, ` +
    `盈亏平衡ACoS=${breakEvenAcos.toFixed(0)}%, ` +
    `有效利润率=${effectiveProfitMargin.toFixed(1)}%`;
}

// ==================== 出价利润约束 ====================

/**
 * 基于利润约束计算最大可接受出价
 * 
 * maxBid = AOV × ProfitMargin × CVR
 */
export function calculateProfitConstrainedMaxBid(
  averageOrderValue: number,
  profitMargin: number,
  conversionRate: number,
  safetyFactor: number = 0.8
): number {
  if (averageOrderValue <= 0 || profitMargin <= 0 || conversionRate <= 0) return 0;
  
  const theoreticalMaxBid = averageOrderValue * profitMargin * conversionRate;
  return Math.round(theoreticalMaxBid * safetyFactor * 100) / 100;
}

/**
 * 判断当前出价是否在利润安全范围内
 */
export function isBidProfitable(
  currentBid: number,
  averageOrderValue: number,
  profitMargin: number,
  conversionRate: number
): { isProfitable: boolean; profitPerClick: number; maxSafeBid: number } {
  const revenuePerClick = averageOrderValue * conversionRate;
  const profitPerClick = revenuePerClick * profitMargin - currentBid;
  const maxSafeBid = calculateProfitConstrainedMaxBid(averageOrderValue, profitMargin, conversionRate);
  
  return {
    isProfitable: profitPerClick > 0,
    profitPerClick: Math.round(profitPerClick * 100) / 100,
    maxSafeBid,
  };
}

// ==================== v272: 多数据源融合利润配置获取 ====================

/**
 * v272: 获取优化目标的利润配置 — 多数据源融合版
 * 
 * 数据源优先级：
 * 1. 真实利润估算数据（bidObjectProfitEstimates） — 置信度最高
 * 2. 市场曲线利润率（marketCurveModels） — 置信度次高
 * 3. 用户设定的利润率 — 置信度中等
 * 4. 行业基准估算 — 置信度最低
 */
export async function getProfitConfigForTarget(
  targetId: number,
  inferredCategory?: string
): Promise<ProfitConfig> {
  try {
    const db = getDb();
    if (!db) return getDefaultProfitConfig(inferredCategory);
    
    const groups = await db.select().from(performanceGroups)
      .where(eq(performanceGroups.id, targetId))
      .limit(1);
    
    if (groups.length === 0) {
      return getDefaultProfitConfig(inferredCategory);
    }
    
    const group = groups[0];
    const accountId = group.accountId;
    
    // v272 数据源1: 尝试从bidObjectProfitEstimates获取真实利润数据
    const realProfitData = await getRealProfitDataForAccount(accountId);
    if (realProfitData && realProfitData.dataPoints >= 5 && realProfitData.avgProfitMargin > 0) {
      log.info(`[v272] 使用真实利润数据: accountId=${accountId}, dataPoints=${realProfitData.dataPoints}, margin=${(realProfitData.avgProfitMargin * 100).toFixed(1)}%`);
      return {
        profitMarginPercent: realProfitData.avgProfitMargin * 100,
        costOfGoods: null,
        averageSellingPrice: null,
        mode: 'real_data',
        dataSource: 'bid_object_estimates',
        dataConfidence: Math.min(1.0, realProfitData.dataPoints / 50), // 50个数据点达到满置信度
      };
    }
    
    // v272 数据源2: 尝试从marketCurveModels获取利润率
    const marketCurveData = await getProfitMarginFromMarketCurve(accountId);
    if (marketCurveData && marketCurveData.profitMargin > 0) {
      log.info(`[v272] 使用市场曲线利润率: accountId=${accountId}, margin=${(marketCurveData.profitMargin * 100).toFixed(1)}%`);
      return {
        profitMarginPercent: marketCurveData.profitMargin * 100,
        costOfGoods: null,
        averageSellingPrice: null,
        mode: 'real_data',
        dataSource: 'market_curve',
        dataConfidence: marketCurveData.confidence,
      };
    }
    
    // 数据源3: 用户设定的利润率（通过策略模板推断）
    if (group.strategyTemplateId === 'profit-focused' || group.strategyTemplateId === 'profit-protection') {
      return {
        profitMarginPercent: 30,
        costOfGoods: null,
        averageSellingPrice: null,
        mode: 'margin_percent',
        dataSource: 'user_config',
        dataConfidence: 0.6,
      };
    }
    
    // 数据源4: 行业基准
    return getDefaultProfitConfig(inferredCategory);
  } catch (error) {
    log.warn(`[ProfitEstimation] 获取利润配置失败，使用默认值:`, error);
    return getDefaultProfitConfig(inferredCategory);
  }
}

/**
 * 获取默认利润配置（基于行业基准）
 */
function getDefaultProfitConfig(category?: string): ProfitConfig {
  const margin = INDUSTRY_MARGIN_BENCHMARKS[category || 'default'] || INDUSTRY_MARGIN_BENCHMARKS['default'];
  return {
    profitMarginPercent: margin * 100,
    costOfGoods: null,
    averageSellingPrice: null,
    mode: 'industry_estimate',
    dataSource: 'industry_benchmark',
    dataConfidence: 0.3,
  };
}

// ==================== v272: 利润趋势追踪 ====================

/** 利润历史缓冲区 */
const profitHistoryBuffer = new Map<string, Array<{ timestamp: Date; profitRoas: number; adProfit: number }>>();
const MAX_HISTORY_ENTRIES = 100;

/**
 * v272: 记录利润快照用于趋势追踪
 */
export function recordProfitSnapshot(
  targetId: number,
  profitRoas: number,
  adProfit: number
): void {
  const key = `target_${targetId}`;
  if (!profitHistoryBuffer.has(key)) {
    profitHistoryBuffer.set(key, []);
  }
  
  const history = profitHistoryBuffer.get(key)!;
  history.push({ timestamp: new Date(), profitRoas, adProfit });
  
  while (history.length > MAX_HISTORY_ENTRIES) {
    history.shift();
  }
}

/**
 * v272: 获取利润趋势数据
 */
export function getProfitTrend(
  targetId: number,
  lookbackEntries: number = 10
): { trend: 'improving' | 'stable' | 'declining' | 'unknown'; avgProfitRoas: number; entries: number } {
  const key = `target_${targetId}`;
  const history = profitHistoryBuffer.get(key);
  
  if (!history || history.length < 2) {
    return { trend: 'unknown', avgProfitRoas: 0, entries: 0 };
  }
  
  const recent = history.slice(-lookbackEntries);
  const avgProfitRoas = recent.reduce((sum, h) => sum + h.profitRoas, 0) / recent.length;
  
  // 比较前半和后半的平均值
  const mid = Math.floor(recent.length / 2);
  const firstHalf = recent.slice(0, mid);
  const secondHalf = recent.slice(mid);
  
  const firstAvg = firstHalf.reduce((sum, h) => sum + h.profitRoas, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((sum, h) => sum + h.profitRoas, 0) / secondHalf.length;
  
  const change = firstAvg > 0 ? (secondAvg - firstAvg) / firstAvg : 0;
  
  let trend: 'improving' | 'stable' | 'declining' | 'unknown';
  if (change > 0.05) trend = 'improving';
  else if (change < -0.05) trend = 'declining';
  else trend = 'stable';
  
  return { trend, avgProfitRoas, entries: recent.length };
}
