/**
 * v271 P1-1: 利润(Profit)评估维度服务
 * 
 * 核心功能：
 * 1. 为优化目标引入利润评估维度，补全v270缺失的利润视角
 * 2. 支持多种利润计算模式：
 *    - 基于用户设定的利润率（profitMarginPercent）
 *    - 基于商品成本（COGS）的精确利润计算
 *    - 基于行业基准的估算利润
 * 3. 集成到goalProgressAlgorithm的第7维度
 * 4. 为出价决策提供利润约束
 * 
 * 利润公式：
 *   Profit = Sales × ProfitMargin - AdSpend
 *   ProfitROAS = (Sales × ProfitMargin) / AdSpend
 *   BreakEvenACoS = ProfitMargin × 100
 */

import { getDb } from "./db";
import { performanceGroups } from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";
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
  mode: 'margin_percent' | 'cogs' | 'industry_estimate';
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
  const detail = buildProfitDetail(adProfit, profitRoas, breakEvenAcos, effectiveProfitMargin, profitMargin, profitConfig.mode);
  
  return {
    adProfit: Math.round(adProfit * 100) / 100,
    profitRoas: Math.round(profitRoas * 100) / 100,
    breakEvenAcos: Math.round(breakEvenAcos * 100) / 100,
    effectiveProfitMargin: Math.round(effectiveProfitMargin * 100) / 100,
    profitTrend,
    profitHealthScore,
    detail,
  };
}

/**
 * 计算利润健康度评分（0-100）
 * 
 * 评分逻辑：
 * - 核心指标：ProfitROAS vs 1.0（盈亏平衡点）
 * - 辅助指标：实际ACoS vs 盈亏平衡ACoS
 * - 边际效益：每增加$1广告花费带来的利润增量
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
  // profitRoas > 1.0 表示盈利，> 2.0 表示优秀
  if (profitRoas >= 3.0) score += 60;
  else if (profitRoas >= 2.0) score += 50 + (profitRoas - 2.0) * 10;
  else if (profitRoas >= 1.5) score += 40 + (profitRoas - 1.5) * 20;
  else if (profitRoas >= 1.0) score += 25 + (profitRoas - 1.0) * 30;
  else if (profitRoas >= 0.5) score += 10 + (profitRoas - 0.5) * 30;
  else score += profitRoas * 20;
  
  // 2. ACoS vs 盈亏平衡ACoS评分（25%权重）
  const actualAcos = totalSpend > 0 ? (totalSpend / totalSales) * 100 : 0;
  if (actualAcos <= 0) {
    score += 0;
  } else if (actualAcos <= breakEvenAcos * 0.5) {
    score += 25; // ACoS远低于盈亏平衡点
  } else if (actualAcos <= breakEvenAcos * 0.8) {
    score += 20;
  } else if (actualAcos <= breakEvenAcos) {
    score += 15;
  } else if (actualAcos <= breakEvenAcos * 1.2) {
    score += 8; // 略超盈亏平衡点
  } else {
    score += Math.max(0, 5 - (actualAcos - breakEvenAcos * 1.2) / 10);
  }
  
  // 3. 规模效益评分（15%权重）
  // 有一定花费规模且保持盈利的给予加分
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
  mode: string
): string {
  const modeLabel = mode === 'margin_percent' ? '用户设定利润率' 
    : mode === 'cogs' ? '商品成本计算' 
    : '行业基准估算';
  
  const profitStatus = adProfit > 0 ? '盈利' : adProfit === 0 ? '盈亏平衡' : '亏损';
  
  return `${modeLabel}(${(profitMargin * 100).toFixed(0)}%): ` +
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
 * 即：每次点击的最大成本 = 平均订单价值 × 利润率 × 转化率
 */
export function calculateProfitConstrainedMaxBid(
  averageOrderValue: number,
  profitMargin: number,
  conversionRate: number,
  safetyFactor: number = 0.8 // 安全系数，默认80%
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

// ==================== 利润配置获取 ====================

/**
 * 获取优化目标的利润配置
 * 从performance_groups表读取利润率设置，如果未设置则使用行业基准
 */
export async function getProfitConfigForTarget(
  targetId: number,
  inferredCategory?: string
): Promise<ProfitConfig> {
  try {
    const db = await getDb();
    const groups = await db!.select().from(performanceGroups)
      .where(eq(performanceGroups.id, targetId))
      .limit(1);
    
    if (groups.length === 0) {
      return getDefaultProfitConfig(inferredCategory);
    }
    
    const group = groups[0];
    
    // 检查是否有用户设定的利润率（从strategyTemplateId推断）
    // 如果策略模板是profit-focused或profit-protection，尝试从配置中获取利润率
    if (group.strategyTemplateId === 'profit-focused' || group.strategyTemplateId === 'profit-protection') {
      // 利润导向策略默认使用较保守的利润率估算
      return {
        profitMarginPercent: 30,
        costOfGoods: null,
        averageSellingPrice: null,
        mode: 'margin_percent',
      };
    }
    
    // 默认使用行业基准
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
  };
}
