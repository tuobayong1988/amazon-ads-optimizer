/**
 * v272 (修正版): 广告投放效率评估服务 (Ad Efficiency Estimation Service)
 * 
 * 设计原则：
 *   作为亚马逊广告优化系统，我们完全基于广告原生指标来评估投放效率，
 *   绝不要求卖家提供商品成本(COGS)或利润率等敏感商业数据。
 *   
 *   亚马逊卖家衡量广告效果的核心指标：
 *   - ACOS (Advertising Cost of Sales) — 广告花费占销售额比例
 *   - ROAS (Return on Ad Spend) — 广告投产比
 *   - Ad Spend — 广告花费
 *   - Ad Sales — 广告销售额
 *   - Orders — 广告订单数量
 *   - CTR (Click-Through Rate) — 点击率
 *   - CVR (Conversion Rate) — 转化率
 *   - CPC (Cost Per Click) — 单次点击成本
 * 
 * 评估模型：
 *   广告投放效率健康度 = f(ACOS表现, ROAS表现, 花费效率, 转化效率, 规模效益)
 *   其中每个维度的评估标准均来自亚马逊广告行业公认的基准值。
 */

import { getDb } from "./db";
import { performanceGroups } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { createModuleLogger } from './utils/logger';

const log = createModuleLogger('AdEfficiencyEstimation');

// ==================== 类型定义 ====================

export interface AdEfficiencyConfig {
  /** 目标ACOS百分比（用户在优化目标中设定的目标值） */
  targetAcosPercent: number;
  /** 策略模板类型（用于推断合理的ACOS基准） */
  strategyTemplateId: string;
  /** 评估模式 */
  mode: 'target_based' | 'strategy_inferred' | 'industry_benchmark';
}

export interface AdEfficiencyMetrics {
  /** ACOS健康度评分（0-100）：实际ACOS vs 目标ACOS */
  acosHealthScore: number;
  /** ROAS健康度评分（0-100）：基于行业基准的ROAS表现 */
  roasHealthScore: number;
  /** 花费效率评分（0-100）：CPC合理性和花费规模 */
  spendEfficiencyScore: number;
  /** 转化效率评分（0-100）：CVR和订单获取效率 */
  conversionEfficiencyScore: number;
  /** 规模效益评分（0-100）：花费规模和增长趋势 */
  scaleScore: number;
  /** 综合广告效率健康度评分（0-100） */
  overallEfficiencyScore: number;
  /** 评分详情说明 */
  detail: string;
  /** 投放效率趋势 */
  efficiencyTrend: 'improving' | 'stable' | 'declining' | 'unknown';
  /** 关键洞察和建议 */
  insights: string[];
}

/**
 * 兼容旧接口的ProfitMetrics类型（保持向后兼容）
 * 内部语义已从"利润"转变为"广告投放效率"
 */
export interface ProfitMetrics {
  /** 广告投产净值 = Sales - Spend（不涉及商品成本） */
  adProfit: number;
  /** ROAS = Sales / Spend */
  profitRoas: number;
  /** 目标ACOS（来自优化目标设定） */
  breakEvenAcos: number;
  /** 广告花费占比 */
  effectiveProfitMargin: number;
  /** 效率趋势方向 */
  profitTrend: 'improving' | 'stable' | 'declining' | 'unknown';
  /** 广告效率健康度评分（0-100） */
  profitHealthScore: number;
  /** 评分详情 */
  detail: string;
  /** 数据来源 */
  dataSource: string;
  /** 数据置信度 */
  dataConfidence: number;
}

/**
 * 兼容旧接口的ProfitConfig类型
 */
export interface ProfitConfig {
  /** 目标ACOS百分比 */
  profitMarginPercent: number | null;
  /** 已废弃：不再使用商品成本 */
  costOfGoods: null;
  /** 已废弃：不再使用平均售价 */
  averageSellingPrice: null;
  /** 评估模式 */
  mode: 'ad_efficiency' | 'industry_estimate';
  /** 数据来源 */
  dataSource: 'target_config' | 'strategy_inferred' | 'industry_benchmark';
  /** 数据置信度 */
  dataConfidence: number;
}

// ==================== 行业ACOS基准 ====================

/**
 * 亚马逊广告行业ACOS基准值
 * 来源：亚马逊广告行业报告和卖家社区公认标准
 * 
 * 对于大多数品类，ACOS在15%-30%之间被认为是健康的
 * ROAS在3x-7x之间被认为是良好的
 */
const STRATEGY_ACOS_BENCHMARKS: Record<string, { targetAcos: number; label: string }> = {
  'aggressive-growth': { targetAcos: 40, label: '激进增长（高ACOS容忍度）' },
  'balanced-growth': { targetAcos: 30, label: '平衡增长' },
  'profit-focused': { targetAcos: 20, label: '利润优先（低ACOS目标）' },
  'profit-protection': { targetAcos: 15, label: '利润保护（严格ACOS控制）' },
  'new-product-launch': { targetAcos: 50, label: '新品推广（高容忍度）' },
  'brand-defense': { targetAcos: 25, label: '品牌防御' },
  'ranking-boost': { targetAcos: 45, label: '排名冲刺' },
  'liquidation': { targetAcos: 60, label: '清仓促销' },
  'seasonal-push': { targetAcos: 35, label: '季节性推广' },
  'maintenance': { targetAcos: 20, label: '维稳模式' },
  'conservative': { targetAcos: 18, label: '保守模式' },
  'default': { targetAcos: 25, label: '默认基准' },
};

/**
 * ROAS行业基准（按品类）
 */
const ROAS_BENCHMARKS = {
  excellent: 7.0,   // 优秀
  good: 4.0,        // 良好
  average: 2.5,     // 一般
  belowAverage: 1.5, // 低于平均
  poor: 1.0,        // 差
};

// ==================== 核心评估函数 ====================

/**
 * 计算ACOS健康度评分（0-100）
 * 
 * 评分逻辑：
 * - 实际ACOS <= 目标ACOS × 0.5 → 满分区间（90-100）
 * - 实际ACOS <= 目标ACOS × 0.8 → 优秀区间（75-90）
 * - 实际ACOS <= 目标ACOS → 达标区间（60-75）
 * - 实际ACOS <= 目标ACOS × 1.2 → 警告区间（40-60）
 * - 实际ACOS <= 目标ACOS × 1.5 → 危险区间（20-40）
 * - 实际ACOS > 目标ACOS × 1.5 → 严重超标（0-20）
 */
function calculateAcosHealthScore(actualAcos: number, targetAcos: number): number {
  if (actualAcos <= 0 || targetAcos <= 0) return 0;
  
  const ratio = actualAcos / targetAcos;
  
  if (ratio <= 0.5) return 95 + (0.5 - ratio) * 10; // 90-100
  if (ratio <= 0.8) return 75 + (0.8 - ratio) / 0.3 * 15; // 75-90
  if (ratio <= 1.0) return 60 + (1.0 - ratio) / 0.2 * 15; // 60-75
  if (ratio <= 1.2) return 40 + (1.2 - ratio) / 0.2 * 20; // 40-60
  if (ratio <= 1.5) return 20 + (1.5 - ratio) / 0.3 * 20; // 20-40
  return Math.max(0, 20 - (ratio - 1.5) * 20); // 0-20
}

/**
 * 计算ROAS健康度评分（0-100）
 * 
 * 基于亚马逊广告行业ROAS基准：
 * - ROAS >= 7.0 → 优秀（90-100）
 * - ROAS >= 4.0 → 良好（70-90）
 * - ROAS >= 2.5 → 一般（50-70）
 * - ROAS >= 1.5 → 低于平均（30-50）
 * - ROAS >= 1.0 → 差（15-30）
 * - ROAS < 1.0 → 亏损（0-15）
 */
function calculateRoasHealthScore(roas: number): number {
  if (roas <= 0) return 0;
  
  if (roas >= ROAS_BENCHMARKS.excellent) return 90 + Math.min(10, (roas - 7) * 2);
  if (roas >= ROAS_BENCHMARKS.good) return 70 + (roas - 4) / 3 * 20;
  if (roas >= ROAS_BENCHMARKS.average) return 50 + (roas - 2.5) / 1.5 * 20;
  if (roas >= ROAS_BENCHMARKS.belowAverage) return 30 + (roas - 1.5) / 1.0 * 20;
  if (roas >= ROAS_BENCHMARKS.poor) return 15 + (roas - 1.0) / 0.5 * 15;
  return Math.max(0, roas * 15);
}

/**
 * 计算花费效率评分（0-100）
 * 
 * 基于CPC合理性和花费产出比：
 * - CPC越低且转化率越高，花费效率越高
 * - 考虑每个订单的获客成本（CPA = Spend / Orders）
 */
function calculateSpendEfficiencyScore(
  totalSpend: number,
  totalSales: number,
  clicks: number,
  orders: number
): number {
  if (totalSpend <= 0 || clicks <= 0) return 0;
  
  let score = 0;
  
  // CPC合理性（40%权重）
  const cpc = totalSpend / clicks;
  if (cpc <= 0.3) score += 40;
  else if (cpc <= 0.5) score += 35;
  else if (cpc <= 0.8) score += 28;
  else if (cpc <= 1.2) score += 20;
  else if (cpc <= 2.0) score += 12;
  else score += Math.max(0, 10 - (cpc - 2.0) * 3);
  
  // 每订单获客成本CPA（35%权重）
  if (orders > 0) {
    const cpa = totalSpend / orders;
    const aov = totalSales / orders; // 平均订单价值
    const cpaRatio = aov > 0 ? cpa / aov : 1;
    
    if (cpaRatio <= 0.1) score += 35;
    else if (cpaRatio <= 0.2) score += 30;
    else if (cpaRatio <= 0.3) score += 24;
    else if (cpaRatio <= 0.5) score += 16;
    else score += Math.max(0, 12 - (cpaRatio - 0.5) * 20);
  }
  
  // 花费产出比（25%权重）
  const spendToSalesRatio = totalSales > 0 ? totalSpend / totalSales : 1;
  if (spendToSalesRatio <= 0.1) score += 25;
  else if (spendToSalesRatio <= 0.2) score += 22;
  else if (spendToSalesRatio <= 0.3) score += 18;
  else if (spendToSalesRatio <= 0.5) score += 12;
  else score += Math.max(0, 8 - (spendToSalesRatio - 0.5) * 10);
  
  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * 计算转化效率评分（0-100）
 * 
 * 基于CTR和CVR：
 * - 亚马逊SP广告平均CTR约0.3%-0.5%
 * - 亚马逊SP广告平均CVR约8%-15%
 */
function calculateConversionEfficiencyScore(
  impressions: number,
  clicks: number,
  orders: number
): number {
  if (impressions <= 0) return 0;
  
  let score = 0;
  
  // CTR评分（40%权重）
  const ctr = (clicks / impressions) * 100;
  if (ctr >= 1.0) score += 40;
  else if (ctr >= 0.5) score += 30 + (ctr - 0.5) / 0.5 * 10;
  else if (ctr >= 0.3) score += 20 + (ctr - 0.3) / 0.2 * 10;
  else if (ctr >= 0.1) score += 8 + (ctr - 0.1) / 0.2 * 12;
  else score += ctr * 80;
  
  // CVR评分（60%权重）
  if (clicks > 0) {
    const cvr = (orders / clicks) * 100;
    if (cvr >= 20) score += 60;
    else if (cvr >= 15) score += 50 + (cvr - 15) / 5 * 10;
    else if (cvr >= 10) score += 38 + (cvr - 10) / 5 * 12;
    else if (cvr >= 5) score += 22 + (cvr - 5) / 5 * 16;
    else if (cvr >= 1) score += 8 + (cvr - 1) / 4 * 14;
    else score += cvr * 8;
  }
  
  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * 计算规模效益评分（0-100）
 * 
 * 基于广告花费规模和订单数量：
 * - 花费越大且ROAS维持良好，说明规模效益越好
 * - 订单数量越多，数据越可靠
 */
function calculateScaleScore(
  totalSpend: number,
  totalSales: number,
  orders: number,
  roas: number
): number {
  let score = 0;
  
  // 花费规模评分（40%权重）— 有足够花费才有统计意义
  if (totalSpend >= 500) score += 40;
  else if (totalSpend >= 200) score += 32;
  else if (totalSpend >= 100) score += 24;
  else if (totalSpend >= 50) score += 16;
  else if (totalSpend >= 10) score += 8;
  else score += 2;
  
  // 订单数量评分（30%权重）— 订单越多数据越可靠
  if (orders >= 100) score += 30;
  else if (orders >= 50) score += 25;
  else if (orders >= 20) score += 20;
  else if (orders >= 10) score += 14;
  else if (orders >= 3) score += 8;
  else score += orders * 2;
  
  // 规模化ROAS维持能力（30%权重）
  if (totalSpend >= 100 && roas >= 4.0) score += 30;
  else if (totalSpend >= 100 && roas >= 2.5) score += 24;
  else if (totalSpend >= 50 && roas >= 2.5) score += 18;
  else if (totalSpend >= 50 && roas >= 1.5) score += 12;
  else if (roas >= 1.0) score += 6;
  else score += 2;
  
  return Math.min(100, Math.max(0, Math.round(score)));
}

// ==================== 综合评估函数 ====================

/**
 * 计算综合广告投放效率指标
 * 
 * 这是核心评估函数，完全基于广告原生指标，不涉及任何商品成本数据。
 * 
 * @param totalSales - 广告销售额
 * @param totalSpend - 广告花费
 * @param targetAcos - 目标ACOS（来自优化目标设定）
 * @param impressions - 曝光量
 * @param clicks - 点击量
 * @param orders - 订单数量
 * @param previousRoas - 上一周期的ROAS（用于趋势判断）
 */
export function calculateAdEfficiencyMetrics(
  totalSales: number,
  totalSpend: number,
  targetAcos: number,
  impressions: number = 0,
  clicks: number = 0,
  orders: number = 0,
  previousRoas?: number
): AdEfficiencyMetrics {
  // 计算基础广告指标
  const actualAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
  const roas = totalSpend > 0 ? totalSales / totalSpend : 0;
  
  // 计算五个维度的评分
  const acosHealthScore = calculateAcosHealthScore(actualAcos, targetAcos);
  const roasHealthScore = calculateRoasHealthScore(roas);
  const spendEfficiencyScore = calculateSpendEfficiencyScore(totalSpend, totalSales, clicks, orders);
  const conversionEfficiencyScore = calculateConversionEfficiencyScore(impressions, clicks, orders);
  const scaleScore = calculateScaleScore(totalSpend, totalSales, orders, roas);
  
  // 综合评分（加权平均）
  // ACOS达标是最重要的（35%），ROAS表现次之（25%），转化效率（20%），花费效率（10%），规模（10%）
  const overallEfficiencyScore = Math.round(
    acosHealthScore * 0.35 +
    roasHealthScore * 0.25 +
    conversionEfficiencyScore * 0.20 +
    spendEfficiencyScore * 0.10 +
    scaleScore * 0.10
  );
  
  // 趋势判断
  let efficiencyTrend: AdEfficiencyMetrics['efficiencyTrend'] = 'unknown';
  if (previousRoas !== undefined && previousRoas > 0) {
    const trendChange = (roas - previousRoas) / previousRoas;
    if (trendChange > 0.05) efficiencyTrend = 'improving';
    else if (trendChange < -0.05) efficiencyTrend = 'declining';
    else efficiencyTrend = 'stable';
  }
  
  // 生成关键洞察
  const insights = generateInsights(actualAcos, targetAcos, roas, clicks, orders, impressions, totalSpend);
  
  // 构建详情说明
  const detail = `广告效率评估: ACOS=${actualAcos.toFixed(1)}%(目标${targetAcos}%), ` +
    `ROAS=${roas.toFixed(2)}, 花费$${totalSpend.toFixed(2)}, ` +
    `销售$${totalSales.toFixed(2)}, ${orders}单`;
  
  return {
    acosHealthScore: Math.min(100, Math.max(0, acosHealthScore)),
    roasHealthScore: Math.min(100, Math.max(0, roasHealthScore)),
    spendEfficiencyScore: Math.min(100, Math.max(0, spendEfficiencyScore)),
    conversionEfficiencyScore: Math.min(100, Math.max(0, conversionEfficiencyScore)),
    scaleScore: Math.min(100, Math.max(0, scaleScore)),
    overallEfficiencyScore: Math.min(100, Math.max(0, overallEfficiencyScore)),
    detail,
    efficiencyTrend,
    insights,
  };
}

/**
 * 生成关键洞察和建议
 */
function generateInsights(
  actualAcos: number,
  targetAcos: number,
  roas: number,
  clicks: number,
  orders: number,
  impressions: number,
  totalSpend: number
): string[] {
  const insights: string[] = [];
  
  // ACOS洞察
  if (actualAcos > 0 && targetAcos > 0) {
    if (actualAcos <= targetAcos * 0.7) {
      insights.push(`ACOS表现优秀(${actualAcos.toFixed(1)}%)，远低于目标(${targetAcos}%)，可考虑适度提高出价以获取更多流量`);
    } else if (actualAcos <= targetAcos) {
      insights.push(`ACOS达标(${actualAcos.toFixed(1)}% vs 目标${targetAcos}%)，广告投放效率良好`);
    } else if (actualAcos <= targetAcos * 1.3) {
      insights.push(`ACOS略超目标(${actualAcos.toFixed(1)}% vs 目标${targetAcos}%)，建议优化低效关键词出价`);
    } else {
      insights.push(`ACOS严重超标(${actualAcos.toFixed(1)}% vs 目标${targetAcos}%)，需要紧急调整出价策略`);
    }
  }
  
  // ROAS洞察
  if (roas >= 5.0) {
    insights.push(`ROAS优秀(${roas.toFixed(2)}x)，广告投产比远超行业平均`);
  } else if (roas >= 3.0) {
    insights.push(`ROAS良好(${roas.toFixed(2)}x)，广告投产比表现健康`);
  } else if (roas >= 1.0) {
    insights.push(`ROAS一般(${roas.toFixed(2)}x)，广告收入覆盖了花费但仍有提升空间`);
  } else if (roas > 0) {
    insights.push(`ROAS偏低(${roas.toFixed(2)}x)，广告花费超过销售额，需要优化`);
  }
  
  // 转化效率洞察
  if (clicks > 0 && orders > 0) {
    const cvr = (orders / clicks) * 100;
    if (cvr < 5) {
      insights.push(`转化率偏低(${cvr.toFixed(1)}%)，建议优化商品详情页或调整投放关键词`);
    } else if (cvr >= 15) {
      insights.push(`转化率优秀(${cvr.toFixed(1)}%)，商品与流量匹配度高`);
    }
  }
  
  // 数据量洞察
  if (totalSpend < 10) {
    insights.push('广告花费较少，数据量不足以做出可靠判断，建议积累更多数据');
  }
  
  return insights;
}

// ==================== 兼容旧接口的函数 ====================

/**
 * 计算利润指标（兼容旧接口）
 * 
 * 注意：此函数的语义已从"利润计算"转变为"广告投放效率评估"
 * 不再涉及任何商品成本计算，完全基于广告原生指标
 */
export function calculateProfitMetrics(
  totalSales: number,
  totalSpend: number,
  profitConfig: ProfitConfig,
  previousProfitRoas?: number
): ProfitMetrics {
  // 广告投产净值（不涉及商品成本）
  const adNetValue = totalSales - totalSpend;
  const roas = totalSpend > 0 ? totalSales / totalSpend : 0;
  const actualAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
  const targetAcos = profitConfig.profitMarginPercent || 25;
  
  // 使用新的广告效率评估模型
  const efficiencyMetrics = calculateAdEfficiencyMetrics(
    totalSales, totalSpend, targetAcos
  );
  
  // 趋势判断
  let profitTrend: ProfitMetrics['profitTrend'] = 'unknown';
  if (previousProfitRoas !== undefined && previousProfitRoas > 0) {
    const trendChange = (roas - previousProfitRoas) / previousProfitRoas;
    if (trendChange > 0.05) profitTrend = 'improving';
    else if (trendChange < -0.05) profitTrend = 'declining';
    else profitTrend = 'stable';
  }
  
  const detail = `广告效率评估: ACOS=${actualAcos.toFixed(1)}%(目标${targetAcos}%), ` +
    `ROAS=${roas.toFixed(2)}, 花费$${totalSpend.toFixed(2)}, 销售$${totalSales.toFixed(2)}`;
  
  return {
    adProfit: Math.round(adNetValue * 100) / 100,
    profitRoas: Math.round(roas * 100) / 100,
    breakEvenAcos: targetAcos,
    effectiveProfitMargin: totalSales > 0 ? Math.round((adNetValue / totalSales) * 10000) / 100 : 0,
    profitTrend,
    profitHealthScore: efficiencyMetrics.overallEfficiencyScore,
    detail,
    dataSource: profitConfig.dataSource,
    dataConfidence: profitConfig.dataConfidence,
  };
}

/**
 * 获取优化目标的广告效率配置
 * 
 * 数据源优先级：
 * 1. 用户在优化目标中设定的目标ACOS — 最可靠
 * 2. 策略模板推断的合理ACOS — 次可靠
 * 3. 行业基准ACOS — 兜底
 */
export async function getProfitConfigForTarget(
  targetId: number,
  inferredCategory?: string
): Promise<ProfitConfig> {
  try {
    const db = getDb();
    if (!db) return getDefaultAdEfficiencyConfig();
    
    const groups = await db.select().from(performanceGroups)
      .where(eq(performanceGroups.id, targetId))
      .limit(1);
    
    if (groups.length === 0) {
      return getDefaultAdEfficiencyConfig();
    }
    
    const group = groups[0];
    
    // 数据源1: 用户在优化目标中设定的目标ACOS
    if (group.targetAcos && group.targetAcos > 0) {
      log.info(`使用用户设定的目标ACOS: targetId=${targetId}, targetAcos=${group.targetAcos}%`);
      return {
        profitMarginPercent: group.targetAcos,
        costOfGoods: null,
        averageSellingPrice: null,
        mode: 'ad_efficiency',
        dataSource: 'target_config',
        dataConfidence: 0.95,
      };
    }
    
    // 数据源2: 根据策略模板推断合理的ACOS目标
    const templateId = group.strategyTemplateId || 'default';
    const benchmark = STRATEGY_ACOS_BENCHMARKS[templateId] || STRATEGY_ACOS_BENCHMARKS['default'];
    
    log.info(`使用策略模板推断ACOS目标: targetId=${targetId}, template=${templateId}, targetAcos=${benchmark.targetAcos}%`);
    return {
      profitMarginPercent: benchmark.targetAcos,
      costOfGoods: null,
      averageSellingPrice: null,
      mode: 'ad_efficiency',
      dataSource: 'strategy_inferred',
      dataConfidence: 0.7,
    };
  } catch (error) {
    log.warn(`获取广告效率配置失败，使用默认值:`, error);
    return getDefaultAdEfficiencyConfig();
  }
}

/**
 * 获取默认广告效率配置（基于行业基准）
 */
function getDefaultAdEfficiencyConfig(): ProfitConfig {
  return {
    profitMarginPercent: STRATEGY_ACOS_BENCHMARKS['default'].targetAcos,
    costOfGoods: null,
    averageSellingPrice: null,
    mode: 'ad_efficiency',
    dataSource: 'industry_benchmark',
    dataConfidence: 0.4,
  };
}

// ==================== 出价约束函数 ====================

/**
 * 基于ACOS目标计算最大可接受出价
 * 
 * 公式：maxBid = AOV × targetAcosRatio × CVR × safetyFactor
 * 其中 targetAcosRatio = targetAcos / 100
 * 
 * 这完全基于广告数据：平均订单价值、目标ACOS和转化率
 */
export function calculateProfitConstrainedMaxBid(
  averageOrderValue: number,
  targetAcosRatio: number,
  conversionRate: number,
  safetyFactor: number = 0.8
): number {
  if (averageOrderValue <= 0 || targetAcosRatio <= 0 || conversionRate <= 0) return 0;
  
  const theoreticalMaxBid = averageOrderValue * targetAcosRatio * conversionRate;
  return Math.round(theoreticalMaxBid * safetyFactor * 100) / 100;
}

/**
 * 判断当前出价是否在ACOS目标安全范围内
 */
export function isBidProfitable(
  currentBid: number,
  averageOrderValue: number,
  targetAcosRatio: number,
  conversionRate: number
): { isProfitable: boolean; profitPerClick: number; maxSafeBid: number } {
  const revenuePerClick = averageOrderValue * conversionRate;
  const maxCostPerClick = revenuePerClick * targetAcosRatio;
  const profitPerClick = maxCostPerClick - currentBid;
  const maxSafeBid = calculateProfitConstrainedMaxBid(averageOrderValue, targetAcosRatio, conversionRate);
  
  return {
    isProfitable: profitPerClick > 0,
    profitPerClick: Math.round(profitPerClick * 100) / 100,
    maxSafeBid,
  };
}

// ==================== 趋势追踪 ====================

/** 效率历史缓冲区 */
const efficiencyHistoryBuffer = new Map<string, Array<{ timestamp: Date; roas: number; acos: number }>>();
const MAX_HISTORY_ENTRIES = 100;

/**
 * 记录广告效率快照用于趋势追踪
 */
export function recordProfitSnapshot(
  targetId: number,
  roas: number,
  adNetValue: number
): void {
  const key = `target_${targetId}`;
  if (!efficiencyHistoryBuffer.has(key)) {
    efficiencyHistoryBuffer.set(key, []);
  }
  
  const history = efficiencyHistoryBuffer.get(key)!;
  const acos = roas > 0 ? (1 / roas) * 100 : 0;
  history.push({ timestamp: new Date(), roas, acos });
  
  while (history.length > MAX_HISTORY_ENTRIES) {
    history.shift();
  }
}

/**
 * 获取广告效率趋势数据
 */
export function getProfitTrend(
  targetId: number,
  lookbackEntries: number = 10
): { trend: 'improving' | 'stable' | 'declining' | 'unknown'; avgProfitRoas: number; entries: number } {
  const key = `target_${targetId}`;
  const history = efficiencyHistoryBuffer.get(key);
  
  if (!history || history.length < 2) {
    return { trend: 'unknown', avgProfitRoas: 0, entries: 0 };
  }
  
  const recent = history.slice(-lookbackEntries);
  const avgRoas = recent.reduce((sum, h) => sum + h.roas, 0) / recent.length;
  
  // 比较前半和后半的平均值
  const mid = Math.floor(recent.length / 2);
  const firstHalf = recent.slice(0, mid);
  const secondHalf = recent.slice(mid);
  
  const firstAvg = firstHalf.reduce((sum, h) => sum + h.roas, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((sum, h) => sum + h.roas, 0) / secondHalf.length;
  
  const change = firstAvg > 0 ? (secondAvg - firstAvg) / firstAvg : 0;
  
  let trend: 'improving' | 'stable' | 'declining' | 'unknown';
  if (change > 0.05) trend = 'improving';
  else if (change < -0.05) trend = 'declining';
  else trend = 'stable';
  
  return { trend, avgProfitRoas: avgRoas, entries: recent.length };
}
