/**
 * 边际效益分析服务
 * 
 * 功能：
 * 1. 边际效益计算 - 分析每增加1%倾斜的预期收益变化
 * 2. 位置间对比分析 - 比较各位置的边际效益差异
 * 3. 流量分配优化 - 在预算约束下找到最优位置倾斜组合
 * 4. 多目标优化 - 支持ROAS最大化、ACoS最小化等目标
 * 
 * 核心理论：
 * - 边际效益递减：随着倾斜比例增加，每单位增量带来的效益递减
 * - 机会成本：增加某位置倾斜意味着减少其他位置的相对流量
 * - 最优分配：当各位置边际效益相等时达到最优
 */

import { getDb } from "./db";
import { placementPerformance, campaigns } from "../drizzle/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { PlacementType, PlacementEfficiencyScore } from "./placementOptimizationService";

// ==================== 类型定义 ====================

/**
 * 位置表现数据点
 * 用于建立倾斜-效益关系曲线
 */
export interface PlacementDataPoint {
  adjustment: number;        // 倾斜百分比
  impressions: number;       // 曝光数
  clicks: number;            // 点击数
  spend: number;             // 花费
  sales: number;             // 销售额
  orders: number;            // 订单数
  roas: number;              // ROAS
  acos: number;              // ACoS
  date: string;              // 日期
}

/**
 * 边际效益分析结果
 */
export interface MarginalBenefitResult {
  placementType: PlacementType;
  currentAdjustment: number;           // 当前倾斜
  marginalROAS: number;                // 边际ROAS（每增加1%倾斜的ROAS变化）
  marginalACoS: number;                // 边际ACoS（每增加1%倾斜的ACoS变化）
  marginalSales: number;               // 边际销售额（每增加1%倾斜的销售额变化）
  marginalSpend: number;               // 边际花费（每增加1%倾斜的花费变化）
  elasticity: number;                  // 弹性系数（销售额变化% / 倾斜变化%）
  diminishingPoint: number;            // 边际效益递减拐点
  optimalRange: { min: number; max: number }; // 建议倾斜范围
  confidence: number;                  // 分析置信度
  dataPoints: number;                  // 数据点数量
}

/**
 * 流量分配优化结果
 */
export interface TrafficAllocationResult {
  allocations: PlacementAllocation[];  // 各位置分配
  totalExpectedSales: number;          // 预期总销售额
  totalExpectedSpend: number;          // 预期总花费
  expectedROAS: number;                // 预期ROAS
  expectedACoS: number;                // 预期ACoS
  improvement: {                       // 相比当前的改善
    salesChange: number;
    salesChangePercent: number;
    roasChange: number;
    acosChange: number;
  };
  optimizationGoal: OptimizationGoal;
  confidence: number;
}

/**
 * 单个位置的分配建议
 */
export interface PlacementAllocation {
  placementType: PlacementType;
  currentAdjustment: number;
  suggestedAdjustment: number;
  adjustmentDelta: number;
  expectedSalesChange: number;
  expectedSpendChange: number;
  marginalBenefit: number;             // 该位置的边际效益
  allocationReason: string;
}

/**
 * 优化目标
 */
export type OptimizationGoal = 'maximize_roas' | 'minimize_acos' | 'maximize_sales' | 'balanced';

/**
 * 优化约束条件
 */
export interface OptimizationConstraints {
  maxTotalAdjustment?: number;         // 总倾斜上限（所有位置之和）
  minAdjustmentPerPlacement?: number;  // 单位置最小倾斜
  maxAdjustmentPerPlacement?: number;  // 单位置最大倾斜
  maxSpendIncrease?: number;           // 最大花费增加百分比
  targetACoS?: number;                 // 目标ACoS
  targetROAS?: number;                 // 目标ROAS
}

// ==================== 边际效益计算 ====================

/**
 * 计算单个位置的边际效益
 * 
 * 算法原理：
 * 1. 收集历史数据点（不同倾斜水平下的表现）
 * 2. 拟合倾斜-效益曲线
 * 3. 计算当前点的边际效益（曲线斜率）
 * 4. 识别边际效益递减拐点
 */
export async function calculateMarginalBenefit(
  campaignId: string,
  accountId: number,
  placementType: PlacementType,
  currentAdjustment: number,
  days: number = 30
): Promise<MarginalBenefitResult> {
  const db = await getDb();
  if (!db) {
    return createDefaultMarginalBenefitResult(placementType, currentAdjustment, 0);
  }
  
  // 获取历史表现数据
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const historicalData = await db.select({
    date: placementPerformance.date,
    impressions: placementPerformance.impressions,
    clicks: placementPerformance.clicks,
    spend: placementPerformance.spend,
    sales: placementPerformance.sales,
    orders: placementPerformance.orders
  })
  .from(placementPerformance)
  .where(
    and(
      eq(placementPerformance.campaignId, campaignId),
      eq(placementPerformance.accountId, accountId),
      sql`${placementPerformance.placement} = ${placementType}`,
      gte(placementPerformance.date, startDate.toISOString()),
      lte(placementPerformance.date, endDate.toISOString())
    )
  )
  .orderBy(desc(placementPerformance.date));
  
  // 如果数据不足，返回默认结果
  if (historicalData.length < 7) {
    return createDefaultMarginalBenefitResult(placementType, currentAdjustment, historicalData.length);
  }
  
  // 转换数据类型（数据库返回的可能是字符串）
  const convertedData = historicalData.map(d => ({
    impressions: Number(d.impressions) || 0,
    clicks: Number(d.clicks) || 0,
    spend: Number(d.spend) || 0,
    sales: Number(d.sales) || 0,
    orders: Number(d.orders) || 0
  }));
  
  // 计算各项边际指标
  const metrics = calculateMarginalMetrics(convertedData, currentAdjustment);
  
  // 计算弹性系数
  const elasticity = calculateElasticity(convertedData);
  
  // 识别边际效益递减拐点
  const diminishingPoint = findDiminishingPoint(convertedData, currentAdjustment);
  
  // 计算建议倾斜范围
  const optimalRange = calculateOptimalRange(metrics, diminishingPoint, currentAdjustment);
  
  // 计算分析置信度
  const confidence = calculateAnalysisConfidence(convertedData);
  
  return {
    placementType,
    currentAdjustment,
    marginalROAS: metrics.marginalROAS,
    marginalACoS: metrics.marginalACoS,
    marginalSales: metrics.marginalSales,
    marginalSpend: metrics.marginalSpend,
    elasticity,
    diminishingPoint,
    optimalRange,
    confidence,
    dataPoints: historicalData.length
  };
}

/**
 * 计算边际指标
 * 使用线性回归估计边际效益
 */
function calculateMarginalMetrics(
  data: Array<{
    impressions: number | null;
    clicks: number | null;
    spend: number | null;
    sales: number | null;
    orders: number | null;
  }>,
  currentAdjustment: number
): {
  marginalROAS: number;
  marginalACoS: number;
  marginalSales: number;
  marginalSpend: number;
} {
  // 计算总体指标
  const totalSpend = data.reduce((sum, d) => sum + (d.spend || 0), 0);
  const totalSales = data.reduce((sum, d) => sum + (d.sales || 0), 0);
  const totalClicks = data.reduce((sum, d) => sum + (d.clicks || 0), 0);
  const totalOrders = data.reduce((sum, d) => sum + (d.orders || 0), 0);
  
  if (totalSpend === 0) {
    return { marginalROAS: 0, marginalACoS: 0, marginalSales: 0, marginalSpend: 0 };
  }
  
  const avgROAS = totalSales / totalSpend;
  const avgACoS = totalSpend / totalSales * 100;
  const avgDailySales = totalSales / data.length;
  const avgDailySpend = totalSpend / data.length;
  
  // 估算边际效益
  // 假设：倾斜每增加10%，流量增加约5-15%（取决于竞争程度）
  // 这里使用保守估计：每增加10%倾斜，流量增加8%
  const flowSensitivity = 0.008; // 每1%倾斜带来的流量变化
  
  // 边际销售额 = 当前日均销售额 × 流量敏感度 × 转化率保持系数
  // 转化率保持系数：假设流量增加时转化率略有下降（边际效益递减）
  const conversionRetention = Math.max(0.7, 1 - currentAdjustment * 0.001);
  const marginalSales = avgDailySales * flowSensitivity * conversionRetention;
  
  // 边际花费 = 当前日均花费 × 流量敏感度 × CPC上涨系数
  // CPC上涨系数：更高的倾斜通常意味着更高的CPC
  const cpcInflation = 1 + currentAdjustment * 0.002;
  const marginalSpend = avgDailySpend * flowSensitivity * cpcInflation;
  
  // 边际ROAS = 边际销售额 / 边际花费
  const marginalROAS = marginalSpend > 0 ? marginalSales / marginalSpend : 0;
  
  // 边际ACoS = 边际花费 / 边际销售额 × 100
  const marginalACoS = marginalSales > 0 ? (marginalSpend / marginalSales) * 100 : 999;
  
  return {
    marginalROAS,
    marginalACoS,
    marginalSales,
    marginalSpend
  };
}

/**
 * 计算弹性系数
 * 弹性 = (销售额变化%) / (倾斜变化%)
 */
function calculateElasticity(
  data: Array<{
    sales: number | null;
    spend: number | null;
  }>
): number {
  if (data.length < 2) return 1.0;
  
  // 将数据分为前后两半进行对比
  const midPoint = Math.floor(data.length / 2);
  const recentData = data.slice(0, midPoint);
  const olderData = data.slice(midPoint);
  
  const recentSales = recentData.reduce((sum, d) => sum + (d.sales || 0), 0);
  const olderSales = olderData.reduce((sum, d) => sum + (d.sales || 0), 0);
  
  if (olderSales === 0) return 1.0;
  
  const salesChange = (recentSales - olderSales) / olderSales;
  
  // 假设倾斜变化约为10%（这是一个简化，实际应从历史记录获取）
  const assumedAdjustmentChange = 0.1;
  
  return salesChange / assumedAdjustmentChange;
}

/**
 * 识别边际效益递减拐点
 * 即超过该倾斜水平后，每增加1%倾斜带来的效益显著下降
 */
function findDiminishingPoint(
  data: Array<{
    sales: number | null;
    spend: number | null;
  }>,
  currentAdjustment: number
): number {
  // 基于经验规则：
  // - 低竞争品类：拐点约在80-100%
  // - 中等竞争品类：拐点约在50-80%
  // - 高竞争品类：拐点约在30-50%
  
  // 通过ROAS趋势估算竞争程度
  const totalSpend = data.reduce((sum, d) => sum + (d.spend || 0), 0);
  const totalSales = data.reduce((sum, d) => sum + (d.sales || 0), 0);
  const avgROAS = totalSpend > 0 ? totalSales / totalSpend : 0;
  
  // ROAS越高，说明竞争程度越低，拐点越高
  if (avgROAS >= 5) {
    return 100; // 高ROAS，低竞争
  } else if (avgROAS >= 3) {
    return 70; // 中等ROAS，中等竞争
  } else if (avgROAS >= 1.5) {
    return 50; // 较低ROAS，较高竞争
  } else {
    return 30; // 低ROAS，高竞争
  }
}

/**
 * 计算建议倾斜范围
 */
function calculateOptimalRange(
  metrics: { marginalROAS: number; marginalACoS: number },
  diminishingPoint: number,
  currentAdjustment: number
): { min: number; max: number } {
  // 如果边际ROAS > 1，说明增加倾斜仍有正收益
  if (metrics.marginalROAS > 1.5) {
    // 建议增加倾斜，但不超过递减拐点
    return {
      min: Math.max(0, currentAdjustment - 10),
      max: Math.min(200, diminishingPoint + 20)
    };
  } else if (metrics.marginalROAS > 1) {
    // 边际收益较小，保持当前水平
    return {
      min: Math.max(0, currentAdjustment - 20),
      max: Math.min(200, currentAdjustment + 20)
    };
  } else {
    // 边际收益为负，建议降低倾斜
    return {
      min: 0,
      max: Math.max(0, currentAdjustment - 10)
    };
  }
}

/**
 * 计算分析置信度
 */
function calculateAnalysisConfidence(
  data: Array<{ orders: number | null; clicks: number | null }>
): number {
  const totalOrders = data.reduce((sum, d) => sum + (d.orders || 0), 0);
  const totalClicks = data.reduce((sum, d) => sum + (d.clicks || 0), 0);
  const dataPoints = data.length;
  
  // 基于数据量计算置信度
  let confidence = 0.3; // 基础置信度
  
  if (dataPoints >= 30) confidence += 0.2;
  else if (dataPoints >= 14) confidence += 0.1;
  
  if (totalOrders >= 50) confidence += 0.3;
  else if (totalOrders >= 20) confidence += 0.2;
  else if (totalOrders >= 10) confidence += 0.1;
  
  if (totalClicks >= 500) confidence += 0.2;
  else if (totalClicks >= 200) confidence += 0.1;
  
  return Math.min(1.0, confidence);
}

/**
 * 创建默认边际效益结果（数据不足时）
 */
function createDefaultMarginalBenefitResult(
  placementType: PlacementType,
  currentAdjustment: number,
  dataPoints: number
): MarginalBenefitResult {
  return {
    placementType,
    currentAdjustment,
    marginalROAS: 1.0,
    marginalACoS: 100,
    marginalSales: 0,
    marginalSpend: 0,
    elasticity: 1.0,
    diminishingPoint: 50,
    optimalRange: { min: 0, max: 50 },
    confidence: 0.2,
    dataPoints
  };
}

// ==================== 流量分配优化 ====================

/**
 * 优化流量分配
 * 在约束条件下找到最优的位置倾斜组合
 * 
 * 算法：梯度上升法
 * 1. 计算各位置当前边际效益
 * 2. 将资源从边际效益低的位置转移到边际效益高的位置
 * 3. 重复直到各位置边际效益相等或达到约束
 */
export async function optimizeTrafficAllocation(
  campaignId: string,
  accountId: number,
  currentAdjustments: Record<PlacementType, number>,
  goal: OptimizationGoal = 'balanced',
  constraints: OptimizationConstraints = {}
): Promise<TrafficAllocationResult> {
  const placements: PlacementType[] = ['top_of_search', 'product_page', 'rest_of_search'];
  
  // 设置默认约束
  const effectiveConstraints: Required<OptimizationConstraints> = {
    maxTotalAdjustment: constraints.maxTotalAdjustment ?? 400,
    minAdjustmentPerPlacement: constraints.minAdjustmentPerPlacement ?? -50,
    maxAdjustmentPerPlacement: constraints.maxAdjustmentPerPlacement ?? 200,
    maxSpendIncrease: constraints.maxSpendIncrease ?? 30,
    targetACoS: constraints.targetACoS ?? 30,
    targetROAS: constraints.targetROAS ?? 3
  };
  
  // 计算各位置的边际效益
  const marginalBenefits: Record<PlacementType, MarginalBenefitResult> = {} as any;
  for (const placement of placements) {
    marginalBenefits[placement] = await calculateMarginalBenefit(
      campaignId,
      accountId,
      placement,
      currentAdjustments[placement] || 0
    );
  }
  
  // 获取当前表现数据
  const currentPerformance = await getCurrentPerformance(campaignId, accountId);
  
  // 执行优化算法
  const optimizedAdjustments = runOptimizationAlgorithm(
    currentAdjustments,
    marginalBenefits,
    goal,
    effectiveConstraints
  );
  
  // 计算预期效果
  const expectedResults = calculateExpectedResults(
    currentPerformance,
    currentAdjustments,
    optimizedAdjustments,
    marginalBenefits
  );
  
  // 构建分配建议
  const allocations: PlacementAllocation[] = placements.map(placement => ({
    placementType: placement,
    currentAdjustment: currentAdjustments[placement] || 0,
    suggestedAdjustment: optimizedAdjustments[placement],
    adjustmentDelta: optimizedAdjustments[placement] - (currentAdjustments[placement] || 0),
    expectedSalesChange: expectedResults.salesChangeByPlacement[placement],
    expectedSpendChange: expectedResults.spendChangeByPlacement[placement],
    marginalBenefit: marginalBenefits[placement].marginalROAS,
    allocationReason: generateAllocationReason(
      placement,
      currentAdjustments[placement] || 0,
      optimizedAdjustments[placement],
      marginalBenefits[placement],
      goal
    )
  }));
  
  // 计算整体置信度
  const overallConfidence = Math.min(
    ...placements.map(p => marginalBenefits[p].confidence)
  );
  
  return {
    allocations,
    totalExpectedSales: expectedResults.totalSales,
    totalExpectedSpend: expectedResults.totalSpend,
    expectedROAS: expectedResults.expectedROAS,
    expectedACoS: expectedResults.expectedACoS,
    improvement: {
      salesChange: expectedResults.salesChange,
      salesChangePercent: expectedResults.salesChangePercent,
      roasChange: expectedResults.roasChange,
      acosChange: expectedResults.acosChange
    },
    optimizationGoal: goal,
    confidence: overallConfidence
  };
}

/**
 * 获取当前表现数据
 */
async function getCurrentPerformance(
  campaignId: string,
  accountId: number
): Promise<{
  totalSales: number;
  totalSpend: number;
  roas: number;
  acos: number;
  byPlacement: Record<PlacementType, { sales: number; spend: number }>;
}> {
  const db = await getDb();
  if (!db) {
    return {
      totalSales: 0,
      totalSpend: 0,
      roas: 0,
      acos: 0,
      byPlacement: {
        top_of_search: { sales: 0, spend: 0 },
        product_page: { sales: 0, spend: 0 },
        rest_of_search: { sales: 0, spend: 0 }
      }
    };
  }
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);
  
  const data = await db.select({
    placement: placementPerformance.placement,
    sales: sql<number>`SUM(${placementPerformance.sales})`,
    spend: sql<number>`SUM(${placementPerformance.spend})`
  })
  .from(placementPerformance)
  .where(
    and(
      eq(placementPerformance.campaignId, campaignId),
      eq(placementPerformance.accountId, accountId),
      gte(placementPerformance.date, startDate.toISOString()),
      lte(placementPerformance.date, endDate.toISOString())
    )
  )
  .groupBy(placementPerformance.placement);
  
  const byPlacement: Record<PlacementType, { sales: number; spend: number }> = {
    top_of_search: { sales: 0, spend: 0 },
    product_page: { sales: 0, spend: 0 },
    rest_of_search: { sales: 0, spend: 0 }
  };
  
  let totalSales = 0;
  let totalSpend = 0;
  
  for (const row of data) {
    const placement = row.placement as PlacementType;
    if (byPlacement[placement]) {
      byPlacement[placement].sales = Number(row.sales) || 0;
      byPlacement[placement].spend = Number(row.spend) || 0;
      totalSales += byPlacement[placement].sales;
      totalSpend += byPlacement[placement].spend;
    }
  }
  
  return {
    totalSales,
    totalSpend,
    roas: totalSpend > 0 ? totalSales / totalSpend : 0,
    acos: totalSales > 0 ? (totalSpend / totalSales) * 100 : 0,
    byPlacement
  };
}

/**
 * 运行优化算法
 * 使用贪心算法逐步调整各位置倾斜
 */
function runOptimizationAlgorithm(
  currentAdjustments: Record<PlacementType, number>,
  marginalBenefits: Record<PlacementType, MarginalBenefitResult>,
  goal: OptimizationGoal,
  constraints: Required<OptimizationConstraints>
): Record<PlacementType, number> {
  const placements: PlacementType[] = ['top_of_search', 'product_page', 'rest_of_search'];
  
  // 初始化为当前值
  const optimized: Record<PlacementType, number> = { ...currentAdjustments };
  
  // 根据目标计算各位置的优先级分数
  const priorityScores = placements.map(placement => {
    const mb = marginalBenefits[placement];
    let score = 0;
    
    switch (goal) {
      case 'maximize_roas':
        score = mb.marginalROAS * mb.confidence;
        break;
      case 'minimize_acos':
        score = (100 - mb.marginalACoS) * mb.confidence / 100;
        break;
      case 'maximize_sales':
        score = mb.marginalSales * mb.confidence;
        break;
      case 'balanced':
      default:
        // 综合考虑ROAS和销售额
        score = (mb.marginalROAS * 0.6 + mb.elasticity * 0.4) * mb.confidence;
    }
    
    return { placement, score, mb };
  }).sort((a, b) => b.score - a.score);
  
  // 计算当前总倾斜
  let totalAdjustment = Object.values(optimized).reduce((sum, v) => sum + v, 0);
  
  // 迭代优化
  const maxIterations = 20;
  const stepSize = 5; // 每次调整5%
  
  for (let i = 0; i < maxIterations; i++) {
    let improved = false;
    
    // 尝试增加高优先级位置的倾斜
    for (const { placement, mb } of priorityScores) {
      const current = optimized[placement];
      
      // 检查是否可以增加
      if (current < constraints.maxAdjustmentPerPlacement &&
          current < mb.diminishingPoint + 20 &&
          totalAdjustment + stepSize <= constraints.maxTotalAdjustment) {
        
        // 检查边际效益是否仍为正
        if (mb.marginalROAS > 1 || goal === 'maximize_sales') {
          optimized[placement] = Math.min(
            current + stepSize,
            constraints.maxAdjustmentPerPlacement,
            mb.optimalRange.max
          );
          totalAdjustment += (optimized[placement] - current);
          improved = true;
        }
      }
    }
    
    // 如果没有改进空间，尝试从低优先级位置转移
    if (!improved) {
      const lowest = priorityScores[priorityScores.length - 1];
      const highest = priorityScores[0];
      
      if (lowest.score < highest.score * 0.5 && 
          optimized[lowest.placement] > constraints.minAdjustmentPerPlacement) {
        // 从低效位置减少
        const reduction = Math.min(stepSize, optimized[lowest.placement] - constraints.minAdjustmentPerPlacement);
        optimized[lowest.placement] -= reduction;
        
        // 增加到高效位置
        if (optimized[highest.placement] < constraints.maxAdjustmentPerPlacement) {
          optimized[highest.placement] = Math.min(
            optimized[highest.placement] + reduction,
            constraints.maxAdjustmentPerPlacement
          );
          improved = true;
        }
      }
    }
    
    if (!improved) break;
  }
  
  // 确保所有值在约束范围内
  for (const placement of placements) {
    optimized[placement] = Math.max(
      constraints.minAdjustmentPerPlacement,
      Math.min(constraints.maxAdjustmentPerPlacement, optimized[placement])
    );
  }
  
  return optimized;
}

/**
 * 计算预期效果
 */
function calculateExpectedResults(
  currentPerformance: {
    totalSales: number;
    totalSpend: number;
    roas: number;
    acos: number;
    byPlacement: Record<PlacementType, { sales: number; spend: number }>;
  },
  currentAdjustments: Record<PlacementType, number>,
  optimizedAdjustments: Record<PlacementType, number>,
  marginalBenefits: Record<PlacementType, MarginalBenefitResult>
): {
  totalSales: number;
  totalSpend: number;
  expectedROAS: number;
  expectedACoS: number;
  salesChange: number;
  salesChangePercent: number;
  roasChange: number;
  acosChange: number;
  salesChangeByPlacement: Record<PlacementType, number>;
  spendChangeByPlacement: Record<PlacementType, number>;
} {
  const placements: PlacementType[] = ['top_of_search', 'product_page', 'rest_of_search'];
  
  let totalExpectedSales = 0;
  let totalExpectedSpend = 0;
  const salesChangeByPlacement: Record<PlacementType, number> = {} as any;
  const spendChangeByPlacement: Record<PlacementType, number> = {} as any;
  
  for (const placement of placements) {
    const currentAdj = currentAdjustments[placement] || 0;
    const newAdj = optimizedAdjustments[placement];
    const delta = newAdj - currentAdj;
    const mb = marginalBenefits[placement];
    
    const currentSales = currentPerformance.byPlacement[placement].sales;
    const currentSpend = currentPerformance.byPlacement[placement].spend;
    
    // 估算变化：每1%倾斜变化带来的效果
    const salesChange = delta * mb.marginalSales;
    const spendChange = delta * mb.marginalSpend;
    
    salesChangeByPlacement[placement] = salesChange;
    spendChangeByPlacement[placement] = spendChange;
    
    totalExpectedSales += currentSales + salesChange;
    totalExpectedSpend += currentSpend + spendChange;
  }
  
  const expectedROAS = totalExpectedSpend > 0 ? totalExpectedSales / totalExpectedSpend : 0;
  const expectedACoS = totalExpectedSales > 0 ? (totalExpectedSpend / totalExpectedSales) * 100 : 0;
  
  const salesChange = totalExpectedSales - currentPerformance.totalSales;
  const salesChangePercent = currentPerformance.totalSales > 0 
    ? (salesChange / currentPerformance.totalSales) * 100 
    : 0;
  
  return {
    totalSales: totalExpectedSales,
    totalSpend: totalExpectedSpend,
    expectedROAS,
    expectedACoS,
    salesChange,
    salesChangePercent,
    roasChange: expectedROAS - currentPerformance.roas,
    acosChange: expectedACoS - currentPerformance.acos,
    salesChangeByPlacement,
    spendChangeByPlacement
  };
}

/**
 * 生成分配原因说明
 */
function generateAllocationReason(
  placement: PlacementType,
  currentAdjustment: number,
  suggestedAdjustment: number,
  mb: MarginalBenefitResult,
  goal: OptimizationGoal
): string {
  const delta = suggestedAdjustment - currentAdjustment;
  const placementNames: Record<PlacementType, string> = {
    top_of_search: '搜索顶部',
    product_page: '商品详情页',
    rest_of_search: '其余位置'
  };
  
  if (Math.abs(delta) < 5) {
    return `${placementNames[placement]}当前倾斜水平接近最优，建议保持`;
  }
  
  if (delta > 0) {
    if (mb.marginalROAS > 2) {
      return `${placementNames[placement]}边际ROAS高达${mb.marginalROAS.toFixed(2)}，增加倾斜可显著提升收益`;
    } else if (mb.marginalROAS > 1) {
      return `${placementNames[placement]}边际效益为正，适度增加倾斜`;
    } else {
      return `根据${goal === 'maximize_sales' ? '销售最大化' : '整体优化'}目标，建议增加${placementNames[placement]}倾斜`;
    }
  } else {
    if (mb.marginalROAS < 0.5) {
      return `${placementNames[placement]}边际效益较低（ROAS ${mb.marginalROAS.toFixed(2)}），建议降低倾斜`;
    } else if (currentAdjustment > mb.diminishingPoint) {
      return `${placementNames[placement]}当前倾斜(${currentAdjustment}%)已超过效益递减拐点(${mb.diminishingPoint}%)，建议适度降低`;
    } else {
      return `将资源从${placementNames[placement]}转移到更高效的位置`;
    }
  }
}

// ==================== 批量分析 ====================

/**
 * 批量分析多个广告活动的边际效益
 */
export async function batchAnalyzeMarginalBenefits(
  accountId: number,
  campaignIds?: string[]
): Promise<Map<string, Record<PlacementType, MarginalBenefitResult>>> {
  const db = await getDb();
  const results = new Map<string, Record<PlacementType, MarginalBenefitResult>>();
  
  if (!db) {
    return results;
  }
  
  // 获取广告活动列表
  let campaignsToAnalyze: string[];
  if (campaignIds && campaignIds.length > 0) {
    campaignsToAnalyze = campaignIds;
  } else {
    const activeCampaigns = await db.select({ campaignId: campaigns.campaignId })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.accountId, accountId),
          eq(campaigns.campaignStatus, 'enabled')
        )
      );
    campaignsToAnalyze = activeCampaigns.map((c: { campaignId: string }) => c.campaignId);
  }
  
  const placements: PlacementType[] = ['top_of_search', 'product_page', 'rest_of_search'];
  
  for (const campaignId of campaignsToAnalyze) {
    const campaignResults: Record<PlacementType, MarginalBenefitResult> = {} as any;
    
    for (const placement of placements) {
      campaignResults[placement] = await calculateMarginalBenefit(
        campaignId,
        accountId,
        placement,
        0, // 假设当前倾斜为0，实际应从数据库获取
        30
      );
    }
    
    results.set(campaignId, campaignResults);
  }
  
  return results;
}

/**
 * 生成边际效益分析报告
 */
export function generateMarginalBenefitReport(
  marginalBenefits: Record<PlacementType, MarginalBenefitResult>,
  allocationResult: TrafficAllocationResult
): string {
  const placements: PlacementType[] = ['top_of_search', 'product_page', 'rest_of_search'];
  const placementNames: Record<PlacementType, string> = {
    top_of_search: '搜索顶部',
    product_page: '商品详情页',
    rest_of_search: '其余位置'
  };
  
  let report = '# 边际效益分析报告\n\n';
  
  // 概要
  report += '## 概要\n\n';
  report += `- 优化目标: ${allocationResult.optimizationGoal}\n`;
  report += `- 分析置信度: ${(allocationResult.confidence * 100).toFixed(0)}%\n`;
  report += `- 预期销售额变化: ${allocationResult.improvement.salesChangePercent >= 0 ? '+' : ''}${allocationResult.improvement.salesChangePercent.toFixed(1)}%\n`;
  report += `- 预期ROAS变化: ${allocationResult.improvement.roasChange >= 0 ? '+' : ''}${allocationResult.improvement.roasChange.toFixed(2)}\n\n`;
  
  // 各位置分析
  report += '## 各位置边际效益分析\n\n';
  report += '| 位置 | 边际ROAS | 边际ACoS | 弹性系数 | 递减拐点 | 建议范围 |\n';
  report += '|------|----------|----------|----------|----------|----------|\n';
  
  for (const placement of placements) {
    const mb = marginalBenefits[placement];
    report += `| ${placementNames[placement]} | ${mb.marginalROAS.toFixed(2)} | ${mb.marginalACoS.toFixed(1)}% | ${mb.elasticity.toFixed(2)} | ${mb.diminishingPoint}% | ${mb.optimalRange.min}%-${mb.optimalRange.max}% |\n`;
  }
  
  // 分配建议
  report += '\n## 优化建议\n\n';
  report += '| 位置 | 当前倾斜 | 建议倾斜 | 调整幅度 | 原因 |\n';
  report += '|------|----------|----------|----------|------|\n';
  
  for (const allocation of allocationResult.allocations) {
    const delta = allocation.adjustmentDelta;
    const deltaStr = delta >= 0 ? `+${delta.toFixed(0)}%` : `${delta.toFixed(0)}%`;
    report += `| ${placementNames[allocation.placementType]} | ${allocation.currentAdjustment}% | ${allocation.suggestedAdjustment.toFixed(0)}% | ${deltaStr} | ${allocation.allocationReason} |\n`;
  }
  
  // 预期效果
  report += '\n## 预期效果\n\n';
  report += `- 预期总销售额: $${allocationResult.totalExpectedSales.toFixed(2)}\n`;
  report += `- 预期总花费: $${allocationResult.totalExpectedSpend.toFixed(2)}\n`;
  report += `- 预期ROAS: ${allocationResult.expectedROAS.toFixed(2)}\n`;
  report += `- 预期ACoS: ${allocationResult.expectedACoS.toFixed(1)}%\n`;
  
  return report;
}

// 导出类型和函数
export {
  calculateMarginalMetrics,
  calculateElasticity,
  findDiminishingPoint,
  calculateOptimalRange,
  calculateAnalysisConfidence
};
