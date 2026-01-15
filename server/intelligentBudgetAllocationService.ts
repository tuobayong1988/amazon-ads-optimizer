/**
 * 智能预算分配服务 - 超越智能优化的创新算法
 * 
 * 核心创新点：
 * 1. 多时间窗口分析（7天趋势+14天稳定性+30天基准）
 * 2. 边际效益分析模型（找到最优预算点）
 * 3. 多维度评分引擎（转化效率、ROAS、增长潜力、稳定性、趋势）
 * 4. 风险控制和异常检测机制
 * 5. 智能决策解释系统
 */

import { getDb } from "./db";
import { calculateUCB, calculateMinExplorationBudget, needsReEvaluation } from "./algorithmUtils";
import { 
  campaigns, 
  performanceGroups, 
  dailyPerformance,
  budgetAllocationConfigs,
  budgetAllocationSuggestions,
  budgetAllocationHistory,
  campaignPerformanceSnapshots
} from "../drizzle/schema";
import { eq, and, gte, lte, desc, sql, inArray } from "drizzle-orm";

// ==================== 类型定义 ====================

/** 广告活动表现数据 */
interface CampaignPerformanceData {
  campaignId: number;
  campaignName: string;
  currentBudget: number;
  // 7天数据（趋势分析）
  spend7d: number;
  sales7d: number;
  conversions7d: number;
  clicks7d: number;
  impressions7d: number;
  // 14天数据（稳定性分析）
  spend14d: number;
  sales14d: number;
  conversions14d: number;
  clicks14d: number;
  impressions14d: number;
  // 30天数据（基准分析）
  spend30d: number;
  sales30d: number;
  conversions30d: number;
  clicks30d: number;
  impressions30d: number;
  // 计算指标
  roas7d: number;
  roas14d: number;
  roas30d: number;
  acos7d: number;
  acos14d: number;
  acos30d: number;
  ctr7d: number;
  cvr7d: number;
  cpc7d: number;
  // 预算利用率
  budgetUtilization: number;
  // 日均数据
  dailyAvgSpend: number;
  dailyAvgSales: number;
  dailyAvgConversions: number;
}

/** 多维度评分结果 */
interface MultiDimensionalScore {
  // 各维度得分（0-100）
  conversionEfficiencyScore: number;  // 转化效率得分
  roasScore: number;                   // ROAS得分
  growthPotentialScore: number;        // 增长潜力得分
  stabilityScore: number;              // 稳定性得分
  trendScore: number;                  // 趋势得分
  // 综合得分
  compositeScore: number;
  // 得分解释
  scoreExplanation: string[];
}

/** 边际效益分析结果 */
interface MarginalBenefitAnalysis {
  currentBudget: number;
  optimalBudget: number;
  marginalROAS: number;           // 边际ROAS（每增加1元预算带来的销售额）
  diminishingPoint: number;       // 边际效益递减点
  maxEfficiencyBudget: number;    // 最大效率预算点
  budgetEfficiencyCurve: Array<{ budget: number; expectedSales: number; marginalROAS: number }>;
}

/** 预算调整建议 */
interface BudgetAllocationSuggestion {
  campaignId: number;
  campaignName: string;
  currentBudget: number;
  suggestedBudget: number;
  adjustmentAmount: number;
  adjustmentPercent: number;
  scores: MultiDimensionalScore;
  marginalAnalysis: MarginalBenefitAnalysis;
  // 预测效果
  predictedSpend: number;
  predictedSales: number;
  predictedConversions: number;
  predictedROAS: number;
  // 风险评估
  riskLevel: 'low' | 'medium' | 'high';
  riskFactors: string[];
  // 建议理由
  reasons: string[];
  // 置信度（0-100）
  confidence: number;
}

/** 异常检测结果 */
interface AnomalyDetectionResult {
  hasAnomaly: boolean;
  anomalyType: 'spike' | 'drop' | 'outlier' | 'missing_data' | null;
  severity: 'low' | 'medium' | 'high' | null;
  affectedMetrics: string[];
  recommendation: string;
}

/** 配置参数 */
interface AllocationConfig {
  // 权重配置
  conversionEfficiencyWeight: number;
  roasWeight: number;
  growthPotentialWeight: number;
  stabilityWeight: number;
  trendWeight: number;
  // 约束配置
  maxAdjustmentPercent: number;
  minDailyBudget: number;
  cooldownDays: number;
  newCampaignProtectionDays: number;
  // 风险控制
  anomalyThreshold: number;
  minDataDays: number;
}

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: AllocationConfig = {
  conversionEfficiencyWeight: 0.25,
  roasWeight: 0.25,
  growthPotentialWeight: 0.20,
  stabilityWeight: 0.15,
  trendWeight: 0.15,
  maxAdjustmentPercent: 15,
  minDailyBudget: 5,
  cooldownDays: 3,
  newCampaignProtectionDays: 7,
  anomalyThreshold: 2.5,  // 标准差倍数
  minDataDays: 7
};

// ==================== 数据收集模块 ====================

/**
 * 收集广告活动的多时间窗口表现数据
 */
export async function collectCampaignPerformanceData(
  performanceGroupId: number,
  endDate: Date = new Date()
): Promise<CampaignPerformanceData[]> {
  const dbInstance = await getDb();
  if (!dbInstance) return [] as any;
  
  // 计算时间窗口
  const date7dAgo = new Date(endDate);
  date7dAgo.setDate(date7dAgo.getDate() - 7);
  const date14dAgo = new Date(endDate);
  date14dAgo.setDate(date14dAgo.getDate() - 14);
  const date30dAgo = new Date(endDate);
  date30dAgo.setDate(date30dAgo.getDate() - 30);
  
  // 获取绩效组内的广告活动
  const campaignList = await dbInstance.select()
    .from(campaigns)
    .where(eq(campaigns.performanceGroupId, performanceGroupId));
  
  const results: CampaignPerformanceData[] = [];
  
  for (const campaign of campaignList) {
    // 获取各时间窗口的数据
    const [data7d, data14d, data30d] = await Promise.all([
      aggregatePerformanceData(campaign.id, date7dAgo, endDate),
      aggregatePerformanceData(campaign.id, date14dAgo, endDate),
      aggregatePerformanceData(campaign.id, date30dAgo, endDate)
    ]);
    
    const currentBudget = Number(campaign.dailyBudget) || 0;
    const dailyAvgSpend = data30d.spend / 30;
    const budgetUtilization = currentBudget > 0 ? (dailyAvgSpend / currentBudget) * 100 : 0;
    
    results.push({
      campaignId: campaign.id,
      campaignName: campaign.campaignName,
      currentBudget,
      // 7天数据
      spend7d: data7d.spend,
      sales7d: data7d.sales,
      conversions7d: data7d.conversions,
      clicks7d: data7d.clicks,
      impressions7d: data7d.impressions,
      // 14天数据
      spend14d: data14d.spend,
      sales14d: data14d.sales,
      conversions14d: data14d.conversions,
      clicks14d: data14d.clicks,
      impressions14d: data14d.impressions,
      // 30天数据
      spend30d: data30d.spend,
      sales30d: data30d.sales,
      conversions30d: data30d.conversions,
      clicks30d: data30d.clicks,
      impressions30d: data30d.impressions,
      // 计算指标
      roas7d: data7d.spend > 0 ? data7d.sales / data7d.spend : 0,
      roas14d: data14d.spend > 0 ? data14d.sales / data14d.spend : 0,
      roas30d: data30d.spend > 0 ? data30d.sales / data30d.spend : 0,
      acos7d: data7d.sales > 0 ? (data7d.spend / data7d.sales) * 100 : 0,
      acos14d: data14d.sales > 0 ? (data14d.spend / data14d.sales) * 100 : 0,
      acos30d: data30d.sales > 0 ? (data30d.spend / data30d.sales) * 100 : 0,
      ctr7d: data7d.impressions > 0 ? (data7d.clicks / data7d.impressions) * 100 : 0,
      cvr7d: data7d.clicks > 0 ? (data7d.conversions / data7d.clicks) * 100 : 0,
      cpc7d: data7d.clicks > 0 ? data7d.spend / data7d.clicks : 0,
      budgetUtilization,
      dailyAvgSpend,
      dailyAvgSales: data30d.sales / 30,
      dailyAvgConversions: data30d.conversions / 30
    });
  }
  
  return results;
}

/**
 * 聚合指定时间范围的表现数据
 */
async function aggregatePerformanceData(
  campaignId: number,
  startDate: Date,
  endDate: Date
): Promise<{ spend: number; sales: number; conversions: number; clicks: number; impressions: number }> {
  const dbInstance = await getDb();
  if (!dbInstance) return { spend: 0, sales: 0, conversions: 0, clicks: 0, impressions: 0 };
  
  const result = await dbInstance.select({
    spend: sql<number>`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
    sales: sql<number>`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
    conversions: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
    clicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    impressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`
  })
  .from(dailyPerformance)
  .where(and(
    eq(dailyPerformance.campaignId, campaignId),
    sql`DATE(${dailyPerformance.date}) >= ${startDate.toISOString().split('T')[0]}`,
    sql`DATE(${dailyPerformance.date}) <= ${endDate.toISOString().split('T')[0]}`
  ));
  
  return result[0] || { spend: 0, sales: 0, conversions: 0, clicks: 0, impressions: 0 };
}

// ==================== 多维度评分引擎 ====================

/**
 * 计算广告活动的多维度得分
 */
export function calculateMultiDimensionalScore(
  campaign: CampaignPerformanceData,
  groupAverage: {
    avgROAS: number;
    avgConversionEfficiency: number;
    avgBudgetUtilization: number;
  },
  config: AllocationConfig = DEFAULT_CONFIG
): MultiDimensionalScore {
  const explanations: string[] = [];
  
  // 1. 转化效率得分（转化数/花费，相对于组平均）
  const conversionEfficiency = campaign.spend30d > 0 
    ? campaign.conversions30d / campaign.spend30d 
    : 0;
  const conversionEfficiencyRatio = groupAverage.avgConversionEfficiency > 0
    ? conversionEfficiency / groupAverage.avgConversionEfficiency
    : 1;
  const conversionEfficiencyScore = Math.min(100, Math.max(0, conversionEfficiencyRatio * 50));
  
  if (conversionEfficiencyRatio > 1.2) {
    explanations.push(`转化效率高于组平均${((conversionEfficiencyRatio - 1) * 100).toFixed(0)}%`);
  } else if (conversionEfficiencyRatio < 0.8) {
    explanations.push(`转化效率低于组平均${((1 - conversionEfficiencyRatio) * 100).toFixed(0)}%`);
  }
  
  // 2. ROAS得分（相对于组平均）
  const roasRatio = groupAverage.avgROAS > 0 ? campaign.roas30d / groupAverage.avgROAS : 1;
  const roasScore = Math.min(100, Math.max(0, roasRatio * 50));
  
  if (roasRatio > 1.2) {
    explanations.push(`ROAS高于组平均${((roasRatio - 1) * 100).toFixed(0)}%`);
  } else if (roasRatio < 0.8) {
    explanations.push(`ROAS低于组平均${((1 - roasRatio) * 100).toFixed(0)}%`);
  }
  
  // 3. 增长潜力得分（基于预算利用率和边际效益）
  // 预算利用率高但表现好 = 有增长潜力
  // 预算利用率低但表现差 = 无增长潜力
  let growthPotentialScore = 50;
  if (campaign.budgetUtilization > 80 && roasRatio > 1) {
    growthPotentialScore = 80 + (roasRatio - 1) * 20;
    explanations.push('预算利用率高且表现优秀，增长潜力大');
  } else if (campaign.budgetUtilization < 50 && roasRatio < 0.8) {
    growthPotentialScore = 30;
    explanations.push('预算利用率低且表现欠佳，增长潜力有限');
  } else if (campaign.budgetUtilization > 90) {
    growthPotentialScore = 70;
    explanations.push('预算接近饱和，可能需要增加预算');
  }
  growthPotentialScore = Math.min(100, Math.max(0, growthPotentialScore));
  
  // 4. 稳定性得分（7天vs14天vs30天数据的一致性）
  const roas7dTo30dRatio = campaign.roas30d > 0 ? campaign.roas7d / campaign.roas30d : 1;
  const roas14dTo30dRatio = campaign.roas30d > 0 ? campaign.roas14d / campaign.roas30d : 1;
  const roasVariance = Math.abs(roas7dTo30dRatio - 1) + Math.abs(roas14dTo30dRatio - 1);
  const stabilityScore = Math.max(0, 100 - roasVariance * 50);
  
  if (roasVariance < 0.2) {
    explanations.push('表现稳定，数据波动小');
  } else if (roasVariance > 0.5) {
    explanations.push('表现波动较大，需要关注');
  }
  
  // 5. 趋势得分（近期表现趋势）
  // 7天表现 > 30天平均 = 上升趋势
  let trendScore = 50;
  if (campaign.roas7d > campaign.roas30d * 1.1) {
    trendScore = 70 + Math.min(30, (campaign.roas7d / campaign.roas30d - 1) * 100);
    explanations.push('近期表现呈上升趋势');
  } else if (campaign.roas7d < campaign.roas30d * 0.9) {
    trendScore = 30 - Math.min(30, (1 - campaign.roas7d / campaign.roas30d) * 100);
    explanations.push('近期表现呈下降趋势');
  }
  trendScore = Math.min(100, Math.max(0, trendScore));
  
  // 计算综合得分
  const compositeScore = 
    conversionEfficiencyScore * config.conversionEfficiencyWeight +
    roasScore * config.roasWeight +
    growthPotentialScore * config.growthPotentialWeight +
    stabilityScore * config.stabilityWeight +
    trendScore * config.trendWeight;
  
  return {
    conversionEfficiencyScore,
    roasScore,
    growthPotentialScore,
    stabilityScore,
    trendScore,
    compositeScore,
    scoreExplanation: explanations
  };
}

// ==================== 边际效益分析模块 ====================

/**
 * 分析广告活动的边际效益
 * 基于历史数据建模，找到最优预算点
 */
export function analyzeMarginalBenefit(
  campaign: CampaignPerformanceData
): MarginalBenefitAnalysis {
  const currentBudget = campaign.currentBudget;
  const dailyAvgSpend = campaign.dailyAvgSpend;
  const dailyAvgSales = campaign.dailyAvgSales;
  
  // 计算当前边际ROAS
  const currentROAS = dailyAvgSpend > 0 ? dailyAvgSales / dailyAvgSpend : 0;
  
  // 基于预算利用率估算边际效益曲线
  // 假设边际效益递减模型：Sales = a * Budget^b，其中 b < 1
  // 简化模型：使用对数函数近似
  const budgetEfficiencyCurve: Array<{ budget: number; expectedSales: number; marginalROAS: number }> = [];
  
  // 估算参数
  const baseEfficiency = currentROAS;
  const diminishingFactor = 0.8; // 边际递减因子
  
  // 生成预算-效果曲线
  const budgetSteps = [0.5, 0.7, 0.85, 1.0, 1.15, 1.3, 1.5, 1.75, 2.0];
  let previousSales = 0;
  
  for (const multiplier of budgetSteps) {
    const testBudget = currentBudget * multiplier;
    // 使用对数模型估算销售额
    // expectedSales = baseEfficiency * testBudget * (1 - diminishingFactor * ln(testBudget/currentBudget))
    const logFactor = multiplier > 0 ? Math.log(multiplier) : 0;
    const efficiencyAdjustment = 1 - diminishingFactor * Math.abs(logFactor) * 0.3;
    const expectedSales = baseEfficiency * testBudget * Math.max(0.5, efficiencyAdjustment);
    
    const marginalROAS = testBudget > previousSales 
      ? (expectedSales - previousSales) / (testBudget - (budgetEfficiencyCurve.length > 0 ? budgetEfficiencyCurve[budgetEfficiencyCurve.length - 1].budget : 0))
      : 0;
    
    budgetEfficiencyCurve.push({
      budget: testBudget,
      expectedSales,
      marginalROAS: Math.max(0, marginalROAS)
    });
    
    previousSales = expectedSales;
  }
  
  // 找到边际效益递减点（边际ROAS开始低于平均ROAS的点）
  let diminishingPoint = currentBudget;
  let maxEfficiencyBudget = currentBudget;
  let maxEfficiency = 0;
  
  for (const point of budgetEfficiencyCurve) {
    const efficiency = point.expectedSales / point.budget;
    if (efficiency > maxEfficiency) {
      maxEfficiency = efficiency;
      maxEfficiencyBudget = point.budget;
    }
    if (point.marginalROAS < currentROAS * 0.7 && point.budget > currentBudget) {
      diminishingPoint = point.budget;
      break;
    }
  }
  
  // 确定最优预算
  // 如果预算利用率高且表现好，建议增加预算
  // 如果预算利用率低或表现差，建议减少预算
  let optimalBudget = currentBudget;
  if (campaign.budgetUtilization > 85 && currentROAS > 1.5) {
    // 高利用率+好表现 = 可以增加预算
    optimalBudget = Math.min(currentBudget * 1.15, diminishingPoint);
  } else if (campaign.budgetUtilization < 50 || currentROAS < 0.8) {
    // 低利用率或差表现 = 减少预算
    optimalBudget = currentBudget * 0.9;
  }
  
  return {
    currentBudget,
    optimalBudget,
    marginalROAS: currentROAS,
    diminishingPoint,
    maxEfficiencyBudget,
    budgetEfficiencyCurve
  };
}

// ==================== 异常检测模块 ====================

/**
 * 检测广告活动数据中的异常
 */
export function detectAnomalies(
  campaign: CampaignPerformanceData,
  config: AllocationConfig = DEFAULT_CONFIG
): AnomalyDetectionResult {
  const anomalies: string[] = [];
  let hasAnomaly = false;
  let anomalyType: AnomalyDetectionResult['anomalyType'] = null;
  let severity: AnomalyDetectionResult['severity'] = null;
  
  // 1. 检测数据缺失
  if (campaign.spend30d === 0 && campaign.currentBudget > 0) {
    hasAnomaly = true;
    anomalyType = 'missing_data';
    severity = 'high';
    anomalies.push('30天内无花费数据，可能存在数据同步问题');
  }
  
  // 2. 检测异常波动（7天vs30天）
  if (campaign.spend30d > 0) {
    const dailyAvg30d = campaign.spend30d / 30;
    const dailyAvg7d = campaign.spend7d / 7;
    const spendVariation = Math.abs(dailyAvg7d - dailyAvg30d) / dailyAvg30d;
    
    if (spendVariation > config.anomalyThreshold) {
      hasAnomaly = true;
      if (dailyAvg7d > dailyAvg30d) {
        anomalyType = 'spike';
        anomalies.push(`近7天日均花费异常增加${(spendVariation * 100).toFixed(0)}%`);
      } else {
        anomalyType = 'drop';
        anomalies.push(`近7天日均花费异常下降${(spendVariation * 100).toFixed(0)}%`);
      }
      severity = spendVariation > config.anomalyThreshold * 2 ? 'high' : 'medium';
    }
  }
  
  // 3. 检测ROAS异常
  if (campaign.roas30d > 0) {
    const roasVariation = Math.abs(campaign.roas7d - campaign.roas30d) / campaign.roas30d;
    if (roasVariation > config.anomalyThreshold) {
      hasAnomaly = true;
      anomalyType = 'outlier';
      anomalies.push(`ROAS波动异常：7天ROAS为${campaign.roas7d.toFixed(2)}，30天平均为${campaign.roas30d.toFixed(2)}`);
      severity = severity === 'high' ? 'high' : 'medium';
    }
  }
  
  // 4. 检测转化率异常
  if (campaign.cvr7d > 50 || campaign.cvr7d < 0.1) {
    hasAnomaly = true;
    anomalyType = 'outlier';
    anomalies.push(`转化率异常：${campaign.cvr7d.toFixed(2)}%`);
    severity = 'medium';
  }
  
  // 生成建议
  let recommendation = '';
  if (hasAnomaly) {
    switch (anomalyType) {
      case 'missing_data':
        recommendation = '建议检查数据同步状态，确保广告数据正常更新';
        break;
      case 'spike':
        recommendation = '建议暂缓预算调整，观察数据是否恢复正常';
        break;
      case 'drop':
        recommendation = '建议检查广告活动状态，确认是否有异常暂停或竞争加剧';
        break;
      case 'outlier':
        recommendation = '建议排查异常原因后再进行预算调整';
        break;
    }
  }
  
  return {
    hasAnomaly,
    anomalyType,
    severity,
    affectedMetrics: anomalies,
    recommendation
  };
}

// ==================== 预算分配建议生成 ====================

/**
 * 生成智能预算分配建议
 */
export async function generateBudgetAllocationSuggestions(
  performanceGroupId: number,
  config: AllocationConfig = DEFAULT_CONFIG
): Promise<{
  suggestions: BudgetAllocationSuggestion[];
  groupSummary: {
    totalCurrentBudget: number;
    totalSuggestedBudget: number;
    avgScore: number;
    campaignsToIncrease: number;
    campaignsToDecrease: number;
    campaignsUnchanged: number;
  };
  warnings: string[];
}> {
  // 1. 收集数据
  const campaignData = await collectCampaignPerformanceData(performanceGroupId);
  
  if (campaignData.length === 0) {
    return {
      suggestions: [],
      groupSummary: {
        totalCurrentBudget: 0,
        totalSuggestedBudget: 0,
        avgScore: 0,
        campaignsToIncrease: 0,
        campaignsToDecrease: 0,
        campaignsUnchanged: 0
      },
      warnings: ['绩效组内没有广告活动']
    };
  }
  
  // 2. 计算组平均指标
  const totalSpend = campaignData.reduce((sum, c) => sum + c.spend30d, 0);
  const totalSales = campaignData.reduce((sum, c) => sum + c.sales30d, 0);
  const totalConversions = campaignData.reduce((sum, c) => sum + c.conversions30d, 0);
  
  const groupAverage = {
    avgROAS: totalSpend > 0 ? totalSales / totalSpend : 0,
    avgConversionEfficiency: totalSpend > 0 ? totalConversions / totalSpend : 0,
    avgBudgetUtilization: campaignData.reduce((sum, c) => sum + c.budgetUtilization, 0) / campaignData.length
  };
  
  // 3. 为每个广告活动生成建议
  const suggestions: BudgetAllocationSuggestion[] = [];
  const warnings: string[] = [];
  
  for (const campaign of campaignData) {
    // 异常检测
    const anomalyResult = detectAnomalies(campaign, config);
    if (anomalyResult.hasAnomaly && anomalyResult.severity === 'high') {
      warnings.push(`${campaign.campaignName}: ${anomalyResult.recommendation}`);
    }
    
    // 计算多维度得分
    const scores = calculateMultiDimensionalScore(campaign, groupAverage, config);
    
    // 边际效益分析
    const marginalAnalysis = analyzeMarginalBenefit(campaign);
    
    // 确定建议预算
    let suggestedBudget = campaign.currentBudget;
    const reasons: string[] = [];
    const riskFactors: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    
    // 基于综合得分确定调整方向和幅度
    const scoreDeviation = (scores.compositeScore - 50) / 50; // -1 到 1
    let adjustmentPercent = 0;
    
    if (scores.compositeScore > 65) {
      // 高分广告活动：增加预算
      adjustmentPercent = Math.min(config.maxAdjustmentPercent, scoreDeviation * 20);
      reasons.push(`综合得分${scores.compositeScore.toFixed(0)}分，表现优于平均水平`);
      reasons.push(...scores.scoreExplanation);
    } else if (scores.compositeScore < 35) {
      // 低分广告活动：减少预算
      adjustmentPercent = Math.max(-config.maxAdjustmentPercent, scoreDeviation * 20);
      reasons.push(`综合得分${scores.compositeScore.toFixed(0)}分，表现低于平均水平`);
      reasons.push(...scores.scoreExplanation);
    } else {
      // 中等表现：小幅调整或保持
      adjustmentPercent = scoreDeviation * 5;
      reasons.push(`综合得分${scores.compositeScore.toFixed(0)}分，表现接近平均水平`);
    }
    
    // 考虑边际效益分析结果
    if (marginalAnalysis.optimalBudget > campaign.currentBudget * 1.1) {
      adjustmentPercent = Math.min(adjustmentPercent + 5, config.maxAdjustmentPercent);
      reasons.push('边际效益分析显示有增长空间');
    } else if (marginalAnalysis.optimalBudget < campaign.currentBudget * 0.9) {
      adjustmentPercent = Math.max(adjustmentPercent - 5, -config.maxAdjustmentPercent);
      reasons.push('边际效益分析显示预算可能过高');
    }
    
    // 应用约束
    suggestedBudget = campaign.currentBudget * (1 + adjustmentPercent / 100);
    suggestedBudget = Math.max(config.minDailyBudget, suggestedBudget);
    
    // 风险评估
    if (anomalyResult.hasAnomaly) {
      riskFactors.push(anomalyResult.recommendation);
      riskLevel = anomalyResult.severity || 'low';
    }
    if (Math.abs(adjustmentPercent) > 10) {
      riskFactors.push('调整幅度较大，建议密切关注效果');
      riskLevel = riskLevel === 'high' ? 'high' : 'medium';
    }
    if (scores.stabilityScore < 40) {
      riskFactors.push('数据波动较大，预测准确性可能受影响');
      riskLevel = riskLevel === 'high' ? 'high' : 'medium';
    }
    
    // 计算预测效果
    const budgetChangeRatio = suggestedBudget / campaign.currentBudget;
    const efficiencyAdjustment = 1 - 0.1 * Math.abs(Math.log(budgetChangeRatio)); // 边际递减
    const predictedSpend = suggestedBudget * campaign.budgetUtilization / 100;
    const predictedSales = predictedSpend * campaign.roas30d * efficiencyAdjustment;
    const predictedConversions = campaign.dailyAvgConversions * budgetChangeRatio * efficiencyAdjustment;
    const predictedROAS = predictedSpend > 0 ? predictedSales / predictedSpend : 0;
    
    // 计算置信度
    let confidence = 70;
    if (scores.stabilityScore > 70) confidence += 15;
    if (scores.stabilityScore < 40) confidence -= 20;
    if (anomalyResult.hasAnomaly) confidence -= 15;
    if (campaign.spend30d < 100) confidence -= 10; // 数据量少
    confidence = Math.min(95, Math.max(30, confidence));
    
    suggestions.push({
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
      currentBudget: campaign.currentBudget,
      suggestedBudget,
      adjustmentAmount: suggestedBudget - campaign.currentBudget,
      adjustmentPercent,
      scores,
      marginalAnalysis,
      predictedSpend,
      predictedSales,
      predictedConversions,
      predictedROAS,
      riskLevel,
      riskFactors,
      reasons,
      confidence
    });
  }
  
  // 4. 预算守恒调整（确保总预算不变）
  const totalCurrentBudget = suggestions.reduce((sum, s) => sum + s.currentBudget, 0);
  const totalSuggestedBudget = suggestions.reduce((sum, s) => sum + s.suggestedBudget, 0);
  
  if (Math.abs(totalSuggestedBudget - totalCurrentBudget) > 1) {
    // 按比例调整，保持总预算不变
    const adjustmentRatio = totalCurrentBudget / totalSuggestedBudget;
    for (const suggestion of suggestions) {
      suggestion.suggestedBudget *= adjustmentRatio;
      suggestion.adjustmentAmount = suggestion.suggestedBudget - suggestion.currentBudget;
      suggestion.adjustmentPercent = (suggestion.adjustmentAmount / suggestion.currentBudget) * 100;
    }
  }
  
  // 5. 生成汇总
  const groupSummary = {
    totalCurrentBudget,
    totalSuggestedBudget: suggestions.reduce((sum, s) => sum + s.suggestedBudget, 0),
    avgScore: suggestions.reduce((sum, s) => sum + s.scores.compositeScore, 0) / suggestions.length,
    campaignsToIncrease: suggestions.filter(s => s.adjustmentAmount > 0.5).length,
    campaignsToDecrease: suggestions.filter(s => s.adjustmentAmount < -0.5).length,
    campaignsUnchanged: suggestions.filter(s => Math.abs(s.adjustmentAmount) <= 0.5).length
  };
  
  return { suggestions, groupSummary, warnings };
}

// ==================== 场景模拟 ====================

/**
 * 模拟不同预算分配方案的效果
 */
export function simulateBudgetScenario(
  campaign: CampaignPerformanceData,
  newBudget: number
): {
  predictedSpend: number;
  predictedSales: number;
  predictedConversions: number;
  predictedROAS: number;
  predictedACoS: number;
  budgetUtilization: number;
  confidence: number;
} {
  const budgetChangeRatio = newBudget / campaign.currentBudget;
  
  // 边际效益递减模型
  const efficiencyAdjustment = budgetChangeRatio <= 1 
    ? 1 + 0.05 * (1 - budgetChangeRatio) // 减少预算时效率略微提升
    : 1 - 0.1 * Math.log(budgetChangeRatio); // 增加预算时效率递减
  
  // 预测预算利用率
  let predictedUtilization = campaign.budgetUtilization;
  if (budgetChangeRatio > 1) {
    // 增加预算时，利用率可能下降
    predictedUtilization = Math.max(50, campaign.budgetUtilization - (budgetChangeRatio - 1) * 20);
  } else {
    // 减少预算时，利用率可能上升
    predictedUtilization = Math.min(100, campaign.budgetUtilization + (1 - budgetChangeRatio) * 30);
  }
  
  const predictedSpend = newBudget * predictedUtilization / 100;
  const predictedSales = predictedSpend * campaign.roas30d * efficiencyAdjustment;
  const predictedConversions = campaign.dailyAvgConversions * budgetChangeRatio * efficiencyAdjustment;
  const predictedROAS = predictedSpend > 0 ? predictedSales / predictedSpend : 0;
  const predictedACoS = predictedSales > 0 ? (predictedSpend / predictedSales) * 100 : 0;
  
  // 置信度基于预算变化幅度
  let confidence = 80;
  if (Math.abs(budgetChangeRatio - 1) > 0.3) confidence -= 20;
  if (Math.abs(budgetChangeRatio - 1) > 0.5) confidence -= 20;
  
  return {
    predictedSpend,
    predictedSales,
    predictedConversions,
    predictedROAS,
    predictedACoS,
    budgetUtilization: predictedUtilization,
    confidence: Math.max(30, confidence)
  };
}

// ==================== 应用建议 ====================

/**
 * 应用预算分配建议
 */
export async function applyBudgetAllocationSuggestions(
  suggestionIds: number[],
  userId: number
): Promise<{
  success: boolean;
  appliedCount: number;
  failedCount: number;
  errors: string[];
}> {
  const dbInstance = await getDb();
  if (!dbInstance) return [] as any;
  const errors: string[] = [];
  let appliedCount = 0;
  let failedCount = 0;
  
  for (const suggestionId of suggestionIds) {
    try {
      // 获取建议详情
      const [suggestion] = await dbInstance.select()
        .from(budgetAllocationSuggestions)
        .where(eq(budgetAllocationSuggestions.id, suggestionId));
      
      if (!suggestion) {
        errors.push(`建议ID ${suggestionId} 不存在`);
        failedCount++;
        continue;
      }
      
      if (suggestion.status !== 'pending' && suggestion.status !== 'approved') {
        errors.push(`建议ID ${suggestionId} 状态不允许应用`);
        failedCount++;
        continue;
      }
      
      // 获取广告活动当前预算
      const [campaign] = await dbInstance.select()
        .from(campaigns)
        .where(eq(campaigns.id, suggestion.campaignId));
      
      if (!campaign) {
        errors.push(`广告活动ID ${suggestion.campaignId} 不存在`);
        failedCount++;
        continue;
      }
      
      // 更新广告活动预算
      await dbInstance.update(campaigns)
        .set({ dailyBudget: suggestion.suggestedBudget?.toString() })
        .where(eq(campaigns.id, suggestion.campaignId));
      
      // 记录历史
      await dbInstance.insert(budgetAllocationHistory).values({
        configId: suggestion.configId,
        campaignId: suggestion.campaignId,
        previousBudget: suggestion.currentBudget?.toString(),
        newBudget: suggestion.suggestedBudget?.toString(),
        changeReason: suggestion.reason || 'auto',
        appliedBy: userId
      });
      
      // 更新建议状态
      await dbInstance.update(budgetAllocationSuggestions)
        .set({ 
          status: 'applied',
          appliedAt: new Date().toISOString()
        })
        .where(eq(budgetAllocationSuggestions.id, suggestionId));
      
      appliedCount++;
    } catch (error) {
      errors.push(`应用建议ID ${suggestionId} 失败: ${error}`);
      failedCount++;
    }
  }
  
  return {
    success: failedCount === 0,
    appliedCount,
    failedCount,
    errors
  };
}

// ==================== 导出配置获取/更新函数 ====================

/**
 * 获取绩效组的预算分配配置
 */
export async function getBudgetAllocationConfig(
  performanceGroupId: number
): Promise<AllocationConfig> {
  const dbInstance = await getDb();
  if (!dbInstance) return [] as any;
  
  const [config] = await dbInstance.select()
    .from(budgetAllocationConfigs)
    .where(eq(budgetAllocationConfigs.performanceGroupId, performanceGroupId));
  
  if (!config) {
    return DEFAULT_CONFIG;
  }
  
  return {
    conversionEfficiencyWeight: Number(config.conversionEfficiencyWeight) || DEFAULT_CONFIG.conversionEfficiencyWeight,
    roasWeight: DEFAULT_CONFIG.roasWeight,
    growthPotentialWeight: Number(config.growthPotentialWeight) || DEFAULT_CONFIG.growthPotentialWeight,
    stabilityWeight: DEFAULT_CONFIG.stabilityWeight,
    trendWeight: DEFAULT_CONFIG.trendWeight,
    maxAdjustmentPercent: Number(config.maxAdjustmentPercent) || DEFAULT_CONFIG.maxAdjustmentPercent,
    minDailyBudget: Number(config.minDailyBudget) || DEFAULT_CONFIG.minDailyBudget,
    cooldownDays: config.cooldownDays || DEFAULT_CONFIG.cooldownDays,
    newCampaignProtectionDays: config.newCampaignProtectionDays || DEFAULT_CONFIG.newCampaignProtectionDays,
    anomalyThreshold: DEFAULT_CONFIG.anomalyThreshold,
    minDataDays: DEFAULT_CONFIG.minDataDays
  };
}

/**
 * 更新绩效组的预算分配配置
 */
export async function updateBudgetAllocationConfig(
  performanceGroupId: number,
  userId: number,
  updates: Partial<AllocationConfig>
): Promise<void> {
  const dbInstance = await getDb();
  if (!dbInstance) return [] as any;
  
  const [existing] = await dbInstance.select()
    .from(budgetAllocationConfigs)
    .where(eq(budgetAllocationConfigs.performanceGroupId, performanceGroupId));
  
  if (existing) {
    await dbInstance.update(budgetAllocationConfigs)
      .set({
        conversionEfficiencyWeight: updates.conversionEfficiencyWeight?.toString(),

        growthPotentialWeight: updates.growthPotentialWeight?.toString(),
        maxAdjustmentPercent: updates.maxAdjustmentPercent?.toString(),
        minDailyBudget: updates.minDailyBudget?.toString(),
        cooldownDays: updates.cooldownDays,
        newCampaignProtectionDays: updates.newCampaignProtectionDays
      })
      .where(eq(budgetAllocationConfigs.performanceGroupId, performanceGroupId));
  } else {
    await dbInstance.insert(budgetAllocationConfigs).values({
      accountId: 0, // 需要从上下文获取
      performanceGroupId,
      totalDailyBudget: '0',
      conversionEfficiencyWeight: (updates.conversionEfficiencyWeight || DEFAULT_CONFIG.conversionEfficiencyWeight).toString(),
      growthPotentialWeight: (updates.growthPotentialWeight || DEFAULT_CONFIG.growthPotentialWeight).toString(),
      maxAdjustmentPercent: (updates.maxAdjustmentPercent || DEFAULT_CONFIG.maxAdjustmentPercent).toString(),
      minDailyBudget: (updates.minDailyBudget || DEFAULT_CONFIG.minDailyBudget).toString(),
      cooldownDays: updates.cooldownDays || DEFAULT_CONFIG.cooldownDays,
      newCampaignProtectionDays: updates.newCampaignProtectionDays || DEFAULT_CONFIG.newCampaignProtectionDays
    });
  }
}
