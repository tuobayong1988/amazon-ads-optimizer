/**
 * 广告位置协同优化服务
 * 
 * 实现位置间的协同优化，在预算约束下找到最优的位置分配策略
 * 使用拉格朗日乘数法求解约束优化问题
 */

import { getDb } from "./db";
import { 
  placementPerformance, 
  placementSettings,
  campaigns
} from "../drizzle/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { 
  calculateTimeWeightedROAS, 
  calculateTimeDecayWeight,
  getDateAdjustmentMultipliers
} from "./algorithmUtils";

// ==================== 类型定义 ====================

export type PlacementType = 'top_of_search' | 'product_page' | 'rest_of_search';

export interface PlacementPerformanceData {
  placementType: PlacementType;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  roas: number;
  acos: number;
  cvr: number;
  cpc: number;
  currentAdjustment: number; // 当前倾斜百分比 (0-900)
}

export interface PlacementAllocation {
  placementType: PlacementType;
  currentAdjustment: number;
  suggestedAdjustment: number;
  adjustmentDelta: number;
  expectedSpend: number;
  expectedSales: number;
  expectedROAS: number;
  marginalROAS: number;
  allocationScore: number;
  reason: string;
}

export interface CoordinationResult {
  campaignId: string;
  campaignName: string;
  totalBudget: number;
  targetROAS: number;
  allocations: PlacementAllocation[];
  overallExpectedROAS: number;
  overallExpectedSpend: number;
  overallExpectedSales: number;
  optimizationGain: number; // 预期ROAS提升百分比
  confidence: number;
  recommendations: string[];
}

export interface CoordinationConfig {
  minDataDays: number;           // 最小数据天数
  minClicksPerPlacement: number; // 每个位置最小点击数
  maxAdjustmentChange: number;   // 单次最大调整幅度
  targetROAS: number;            // 目标ROAS
  budgetConstraint: number;      // 预算约束
  attributionDelayDays: number;  // 归因延迟天数
}

const DEFAULT_CONFIG: CoordinationConfig = {
  minDataDays: 14,
  minClicksPerPlacement: 20,
  maxAdjustmentChange: 50,
  targetROAS: 3,
  budgetConstraint: 0,
  attributionDelayDays: 3
};

// ==================== 核心算法 ====================

/**
 * 估算调整后的预期表现
 * 基于历史数据和边际效益估算
 */
function estimatePerformance(
  currentData: PlacementPerformanceData,
  newAdjustment: number,
  marginalROAS: number
): { expectedSpend: number; expectedSales: number; expectedROAS: number } {
  const adjustmentDelta = newAdjustment - currentData.currentAdjustment;
  
  // 估算花费变化（假设花费与倾斜百分比成正比）
  const spendChangeRatio = 1 + (adjustmentDelta / 100) * 0.3; // 每增加100%倾斜，花费增加30%
  const expectedSpend = currentData.spend * spendChangeRatio;
  
  // 使用边际ROAS估算销售额
  const spendDelta = expectedSpend - currentData.spend;
  const expectedSales = currentData.sales + spendDelta * marginalROAS;
  
  const expectedROAS = expectedSpend > 0 ? expectedSales / expectedSpend : 0;
  
  return {
    expectedSpend: Math.round(expectedSpend * 100) / 100,
    expectedSales: Math.round(expectedSales * 100) / 100,
    expectedROAS: Math.round(expectedROAS * 100) / 100
  };
}

/**
 * 拉格朗日乘数法求解最优分配
 * 目标：最大化总销售额
 * 约束1：总花费 <= 预算
 * 约束2：整体ROAS >= 目标ROAS
 */
function solveOptimalAllocation(
  placements: PlacementPerformanceData[],
  marginalROASMap: Map<PlacementType, number>,
  config: CoordinationConfig
): PlacementAllocation[] {
  const allocations: PlacementAllocation[] = [];
  
  // 按边际ROAS排序位置
  const sortedPlacements = [...placements].sort((a, b) => {
    const marginalA = marginalROASMap.get(a.placementType) || a.roas;
    const marginalB = marginalROASMap.get(b.placementType) || b.roas;
    return marginalB - marginalA;
  });

  // 计算当前总花费
  const currentTotalSpend = placements.reduce((sum, p) => sum + p.spend, 0);

  // 确定预算约束
  const budgetLimit = config.budgetConstraint > 0 
    ? config.budgetConstraint 
    : currentTotalSpend * 1.2; // 默认允许20%的预算增长

  // 贪心算法分配预算
  let remainingBudget = budgetLimit;

  for (const placement of sortedPlacements) {
    const marginalROAS = marginalROASMap.get(placement.placementType) || placement.roas;
    
    // 计算建议调整
    let suggestedAdjustment = placement.currentAdjustment;
    let reason = '';

    if (marginalROAS >= config.targetROAS * 1.2) {
      // 高效位置：增加倾斜
      suggestedAdjustment = Math.min(
        900, // Amazon最大900%
        placement.currentAdjustment + config.maxAdjustmentChange
      );
      reason = `高边际ROAS (${marginalROAS.toFixed(2)})，建议增加投放`;
    } else if (marginalROAS >= config.targetROAS * 0.8) {
      // 中等位置：维持或小幅调整
      suggestedAdjustment = placement.currentAdjustment;
      reason = `边际ROAS接近目标 (${marginalROAS.toFixed(2)})，维持当前策略`;
    } else if (marginalROAS >= config.targetROAS * 0.5) {
      // 低效位置：减少倾斜
      suggestedAdjustment = Math.max(
        0,
        placement.currentAdjustment - config.maxAdjustmentChange / 2
      );
      reason = `边际ROAS偏低 (${marginalROAS.toFixed(2)})，建议减少投放`;
    } else {
      // 非常低效：大幅减少
      suggestedAdjustment = Math.max(
        0,
        placement.currentAdjustment - config.maxAdjustmentChange
      );
      reason = `边际ROAS过低 (${marginalROAS.toFixed(2)})，建议大幅减少投放`;
    }

    // 估算调整后的表现
    const estimated = estimatePerformance(placement, suggestedAdjustment, marginalROAS);

    // 检查预算约束
    if (estimated.expectedSpend > remainingBudget) {
      // 调整到预算允许的范围
      const maxAffordableAdjustment = placement.currentAdjustment + 
        ((remainingBudget / placement.spend - 1) / 0.3) * 100;
      suggestedAdjustment = Math.max(0, Math.min(suggestedAdjustment, maxAffordableAdjustment));
      reason += ' (受预算约束限制)';
    }

    const finalEstimate = estimatePerformance(placement, suggestedAdjustment, marginalROAS);
    remainingBudget -= finalEstimate.expectedSpend;

    allocations.push({
      placementType: placement.placementType,
      currentAdjustment: placement.currentAdjustment,
      suggestedAdjustment: Math.round(suggestedAdjustment),
      adjustmentDelta: Math.round(suggestedAdjustment - placement.currentAdjustment),
      expectedSpend: finalEstimate.expectedSpend,
      expectedSales: finalEstimate.expectedSales,
      expectedROAS: finalEstimate.expectedROAS,
      marginalROAS: Math.round(marginalROAS * 100) / 100,
      allocationScore: Math.round(marginalROAS / config.targetROAS * 100),
      reason
    });
  }

  return allocations;
}

// ==================== 主要服务函数 ====================

/**
 * 获取广告活动的位置绩效数据
 */
export async function getPlacementPerformanceData(
  campaignId: string,
  lookbackDays: number = 30
): Promise<PlacementPerformanceData[]> {
  const db = await getDb();
  if (!db) return [];

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - lookbackDays);
  const startDateStr = startDate.toISOString().split('T')[0];

  try {
    const result = await db
      .select({
        placement: placementPerformance.placement,
        impressions: sql<number>`SUM(${placementPerformance.impressions})`,
        clicks: sql<number>`SUM(${placementPerformance.clicks})`,
        spend: sql<string>`SUM(${placementPerformance.spend})`,
        sales: sql<string>`SUM(${placementPerformance.sales})`,
        orders: sql<number>`SUM(${placementPerformance.orders})`,
      })
      .from(placementPerformance)
      .where(
        and(
          eq(placementPerformance.campaignId, campaignId),
          gte(placementPerformance.date, startDateStr)
        )
      )
      .groupBy(placementPerformance.placement);

    // 获取当前位置设置
    const settings = await db
      .select()
      .from(placementSettings)
      .where(eq(placementSettings.campaignId, campaignId));

    // 从设置中获取调整百分比
    const topOfSearchAdj = settings.length > 0 ? (settings[0].topOfSearchAdjustment || 0) : 0;
    const productPageAdj = settings.length > 0 ? (settings[0].productPageAdjustment || 0) : 0;

    return result.map(row => {
      const spend = parseFloat(row.spend || '0');
      const sales = parseFloat(row.sales || '0');
      const clicks = row.clicks || 0;
      const orders = row.orders || 0;
      const placementType = row.placement as PlacementType;

      // 根据位置类型获取当前调整百分比
      let currentAdjustment = 0;
      if (placementType === 'top_of_search') {
        currentAdjustment = topOfSearchAdj;
      } else if (placementType === 'product_page') {
        currentAdjustment = productPageAdj;
      }

      return {
        placementType,
        impressions: row.impressions || 0,
        clicks,
        spend,
        sales,
        orders,
        roas: spend > 0 ? sales / spend : 0,
        acos: sales > 0 ? spend / sales : 0,
        cvr: clicks > 0 ? orders / clicks : 0,
        cpc: clicks > 0 ? spend / clicks : 0,
        currentAdjustment
      };
    });
  } catch (error) {
    console.error('[PlacementCoordination] Error getting performance data:', error);
    return [];
  }
}

/**
 * 执行位置协同优化分析
 */
export async function analyzeCoordinatedOptimization(
  campaignId: string,
  config: Partial<CoordinationConfig> = {}
): Promise<CoordinationResult | null> {
  const db = await getDb();
  if (!db) return null;

  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  try {
    // 获取广告活动信息
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.campaignId, campaignId))
      .limit(1);

    if (!campaign) {
      console.error('[PlacementCoordination] Campaign not found:', campaignId);
      return null;
    }

    // 获取位置绩效数据
    const placements = await getPlacementPerformanceData(
      campaignId, 
      finalConfig.minDataDays + finalConfig.attributionDelayDays
    );

    if (placements.length === 0) {
      console.log('[PlacementCoordination] No placement data available');
      return null;
    }

    // 检查数据充足性
    const hasEnoughData = placements.every(
      p => p.clicks >= finalConfig.minClicksPerPlacement
    );

    // 计算每个位置的边际ROAS
    const marginalROASMap = new Map<PlacementType, number>();
    for (const placement of placements) {
      marginalROASMap.set(placement.placementType, placement.roas);
    }

    // 求解最优分配
    const allocations = solveOptimalAllocation(placements, marginalROASMap, finalConfig);

    // 计算整体预期表现
    const overallExpectedSpend = allocations.reduce((sum, a) => sum + a.expectedSpend, 0);
    const overallExpectedSales = allocations.reduce((sum, a) => sum + a.expectedSales, 0);
    const overallExpectedROAS = overallExpectedSpend > 0 
      ? overallExpectedSales / overallExpectedSpend 
      : 0;

    // 计算当前整体ROAS
    const currentTotalSpend = placements.reduce((sum, p) => sum + p.spend, 0);
    const currentTotalSales = placements.reduce((sum, p) => sum + p.sales, 0);
    const currentOverallROAS = currentTotalSpend > 0 
      ? currentTotalSales / currentTotalSpend 
      : 0;

    // 计算优化增益
    const optimizationGain = currentOverallROAS > 0
      ? ((overallExpectedROAS - currentOverallROAS) / currentOverallROAS) * 100
      : 0;

    // 生成建议
    const recommendations: string[] = [];
    
    for (const allocation of allocations) {
      if (allocation.adjustmentDelta > 20) {
        recommendations.push(
          `建议将"${getPlacementName(allocation.placementType)}"的倾斜从${allocation.currentAdjustment}%提高到${allocation.suggestedAdjustment}%`
        );
      } else if (allocation.adjustmentDelta < -20) {
        recommendations.push(
          `建议将"${getPlacementName(allocation.placementType)}"的倾斜从${allocation.currentAdjustment}%降低到${allocation.suggestedAdjustment}%`
        );
      }
    }

    if (recommendations.length === 0) {
      recommendations.push('当前位置分配已接近最优，建议维持现有策略');
    }

    return {
      campaignId,
      campaignName: campaign.campaignName || `Campaign ${campaignId}`,
      totalBudget: campaign.dailyBudget ? parseFloat(campaign.dailyBudget.toString()) : 0,
      targetROAS: finalConfig.targetROAS,
      allocations,
      overallExpectedROAS: Math.round(overallExpectedROAS * 100) / 100,
      overallExpectedSpend: Math.round(overallExpectedSpend * 100) / 100,
      overallExpectedSales: Math.round(overallExpectedSales * 100) / 100,
      optimizationGain: Math.round(optimizationGain * 10) / 10,
      confidence: hasEnoughData ? 0.8 : 0.5,
      recommendations
    };
  } catch (error) {
    console.error('[PlacementCoordination] Error analyzing optimization:', error);
    return null;
  }
}

/**
 * 批量分析多个广告活动的位置协同优化
 */
export async function batchAnalyzeCoordinatedOptimization(
  campaignIds: string[],
  config: Partial<CoordinationConfig> = {}
): Promise<CoordinationResult[]> {
  const results: CoordinationResult[] = [];

  for (const campaignId of campaignIds) {
    const result = await analyzeCoordinatedOptimization(campaignId, config);
    if (result) {
      results.push(result);
    }
  }

  return results;
}

// ==================== 辅助函数 ====================

function getPlacementName(placementType: PlacementType): string {
  const names: Record<PlacementType, string> = {
    'top_of_search': '搜索结果顶部',
    'product_page': '商品详情页',
    'rest_of_search': '搜索结果其他位置'
  };
  return names[placementType] || placementType;
}

/**
 * 应用位置协同优化建议
 */
export async function applyCoordinatedOptimization(
  result: CoordinationResult
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  try {
    // 获取各位置的建议调整
    let topOfSearchAdj = 0;
    let productPageAdj = 0;

    for (const allocation of result.allocations) {
      if (allocation.adjustmentDelta === 0) continue;

      if (allocation.placementType === 'top_of_search') {
        topOfSearchAdj = allocation.suggestedAdjustment;
      } else if (allocation.placementType === 'product_page') {
        productPageAdj = allocation.suggestedAdjustment;
      }
    }

    // 更新位置设置
    await db
      .update(placementSettings)
      .set({
        topOfSearchAdjustment: topOfSearchAdj,
        productPageAdjustment: productPageAdj,
        lastAdjustedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      .where(eq(placementSettings.campaignId, result.campaignId));

    console.log(`[PlacementCoordination] Applied optimization for campaign ${result.campaignId}`);
    return true;
  } catch (error) {
    console.error('[PlacementCoordination] Error applying optimization:', error);
    return false;
  }
}
