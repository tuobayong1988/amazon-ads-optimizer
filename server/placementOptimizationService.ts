/**
 * 广告位置智能倾斜服务
 * 
 * 功能：
 * 1. 位置数据同步 - 从Amazon API获取各位置表现数据
 * 2. 效率评分算法 - 计算每个位置的效率得分
 * 3. 最优倾斜比例计算 - 基于评分差异计算建议倾斜百分比
 * 4. 自动调整执行 - 按照2小时频率自动调整位置倾斜
 */

import { getDb } from "./db";
import { 
  placementPerformance, 
  placementSettings,
  campaigns 
} from "../drizzle/schema";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";

// 位置类型定义
export type PlacementType = 'top_of_search' | 'product_page' | 'rest_of_search';

// 位置效率评分权重配置
export interface PlacementWeightConfig {
  roasWeight: number;      // ROAS权重 (默认0.35)
  acosWeight: number;      // ACoS权重 (默认0.25)
  cvrWeight: number;       // 转化率权重 (默认0.25)
  cpcWeight: number;       // CPC权重 (默认0.15)
}

// 默认权重配置
const DEFAULT_WEIGHTS: PlacementWeightConfig = {
  roasWeight: 0.35,
  acosWeight: 0.25,
  cvrWeight: 0.25,
  cpcWeight: 0.15
};

// 位置效率评分结果
export interface PlacementEfficiencyScore {
  placementType: PlacementType;
  rawScore: number;           // 原始评分 (0-100)
  normalizedScore: number;    // 归一化评分 (0-1)
  confidence: number;         // 数据置信度 (0-1)
  metrics: {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
    roas: number;
    acos: number;
    cvr: number;
    cpc: number;
    ctr: number;
  };
}

// 倾斜建议结果
export interface PlacementAdjustmentSuggestion {
  placementType: PlacementType;
  currentAdjustment: number;      // 当前倾斜百分比
  suggestedAdjustment: number;    // 建议倾斜百分比
  adjustmentDelta: number;        // 调整幅度
  efficiencyScore: number;        // 效率评分
  confidence: number;             // 置信度
  reason: string;                 // 调整原因
}

/**
 * 计算位置效率评分
 * 
 * 评分公式：
 * Score = (ROAS_norm × W_roas) + ((1 - ACoS_norm) × W_acos) + (CVR_norm × W_cvr) + ((1 - CPC_norm) × W_cpc)
 * 
 * 其中：
 * - ROAS_norm = min(ROAS / 5, 1)  // ROAS归一化，5为基准值
 * - ACoS_norm = min(ACoS / 100, 1)  // ACoS归一化
 * - CVR_norm = min(CVR / 20, 1)  // CVR归一化，20%为基准值
 * - CPC_norm = min(CPC / 2, 1)  // CPC归一化，$2为基准值
 */
export function calculateEfficiencyScore(
  metrics: {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
  },
  weights: PlacementWeightConfig = DEFAULT_WEIGHTS
): { score: number; confidence: number; normalizedMetrics: any } {
  // 计算派生指标
  const ctr = metrics.clicks > 0 ? (metrics.clicks / metrics.impressions) * 100 : 0;
  const cpc = metrics.clicks > 0 ? metrics.spend / metrics.clicks : 0;
  const cvr = metrics.clicks > 0 ? (metrics.orders / metrics.clicks) * 100 : 0;
  const acos = metrics.sales > 0 ? (metrics.spend / metrics.sales) * 100 : 100;
  const roas = metrics.spend > 0 ? metrics.sales / metrics.spend : 0;

  // 归一化指标 (0-1范围)
  const roasNorm = Math.min(roas / 5, 1);           // ROAS 5为满分基准
  const acosNorm = Math.min(acos / 100, 1);         // ACoS 100%为最差
  const cvrNorm = Math.min(cvr / 20, 1);            // CVR 20%为满分基准
  const cpcNorm = Math.min(cpc / 2, 1);             // CPC $2为最差基准

  // 计算加权评分 (0-100)
  const score = (
    (roasNorm * weights.roasWeight) +
    ((1 - acosNorm) * weights.acosWeight) +
    (cvrNorm * weights.cvrWeight) +
    ((1 - cpcNorm) * weights.cpcWeight)
  ) * 100;

  // 计算数据置信度
  // 基于点击量和花费判断数据可靠性
  let confidence = 0;
  if (metrics.clicks >= 100 && metrics.spend >= 50) {
    confidence = 1.0;  // 高置信度
  } else if (metrics.clicks >= 50 && metrics.spend >= 20) {
    confidence = 0.8;  // 中高置信度
  } else if (metrics.clicks >= 20 && metrics.spend >= 10) {
    confidence = 0.6;  // 中等置信度
  } else if (metrics.clicks >= 10) {
    confidence = 0.4;  // 低置信度
  } else {
    confidence = 0.2;  // 极低置信度
  }

  return {
    score: Math.round(score * 100) / 100,
    confidence,
    normalizedMetrics: {
      roas,
      acos,
      cvr,
      cpc,
      ctr,
      roasNorm,
      acosNorm,
      cvrNorm,
      cpcNorm
    }
  };
}

/**
 * 计算最优倾斜比例
 * 
 * 算法逻辑：
 * 1. 计算各位置的效率评分
 * 2. 找出最高评分位置作为基准
 * 3. 根据评分差异计算倾斜比例
 * 4. 应用置信度加权
 * 5. 限制在安全范围内 (0%-200%)
 */
export function calculateOptimalAdjustment(
  scores: PlacementEfficiencyScore[],
  currentAdjustments: { [key in PlacementType]?: number }
): PlacementAdjustmentSuggestion[] {
  if (scores.length === 0) return [];

  // 找出最高评分
  const maxScore = Math.max(...scores.map(s => s.rawScore));
  
  // 计算各位置的建议倾斜比例
  const suggestions: PlacementAdjustmentSuggestion[] = scores.map(score => {
    const currentAdj = currentAdjustments[score.placementType] || 0;
    
    // 基于评分差异计算建议倾斜
    // 评分越高，倾斜越大
    // 公式: adjustment = (score / maxScore - 0.5) * 200 * confidence
    let suggestedAdj = 0;
    
    if (maxScore > 0) {
      const relativeScore = score.rawScore / maxScore;
      
      if (relativeScore >= 0.9) {
        // 高效位置：增加倾斜 50-100%
        suggestedAdj = Math.round((relativeScore - 0.5) * 200 * score.confidence);
      } else if (relativeScore >= 0.7) {
        // 中等位置：小幅调整 0-50%
        suggestedAdj = Math.round((relativeScore - 0.5) * 100 * score.confidence);
      } else if (relativeScore >= 0.5) {
        // 较低位置：保持或小幅降低 -20% to 0%
        suggestedAdj = Math.round((relativeScore - 0.7) * 100 * score.confidence);
      } else {
        // 低效位置：降低倾斜 -50% to -20%
        suggestedAdj = Math.round((relativeScore - 0.8) * 100 * score.confidence);
      }
    }

    // 限制在安全范围内 (-50% to 200%)
    suggestedAdj = Math.max(-50, Math.min(200, suggestedAdj));

    // 渐进式调整：单次调整不超过当前值的30%或20个百分点
    const maxDelta = Math.max(Math.abs(currentAdj) * 0.3, 20);
    let delta = suggestedAdj - currentAdj;
    if (Math.abs(delta) > maxDelta) {
      delta = delta > 0 ? maxDelta : -maxDelta;
      suggestedAdj = currentAdj + delta;
    }

    // 生成调整原因
    let reason = '';
    if (delta > 10) {
      reason = `该位置效率评分${score.rawScore.toFixed(1)}分，高于平均水平，建议增加倾斜`;
    } else if (delta < -10) {
      reason = `该位置效率评分${score.rawScore.toFixed(1)}分，低于平均水平，建议降低倾斜`;
    } else {
      reason = `该位置效率评分${score.rawScore.toFixed(1)}分，表现稳定，建议保持当前设置`;
    }

    return {
      placementType: score.placementType,
      currentAdjustment: currentAdj,
      suggestedAdjustment: Math.round(suggestedAdj),
      adjustmentDelta: Math.round(delta),
      efficiencyScore: score.rawScore,
      confidence: score.confidence,
      reason
    };
  });

  return suggestions;
}

/**
 * 获取广告活动的位置表现数据
 */
export async function getCampaignPlacementPerformance(
  campaignId: string,
  accountId: number,
  days: number = 7
): Promise<PlacementEfficiencyScore[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // 从数据库获取位置表现数据
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  const performanceData = await db.select()
    .from(placementPerformance)
    .where(
      and(
        eq(placementPerformance.campaignId, campaignId),
        eq(placementPerformance.accountId, accountId),
        gte(placementPerformance.date, startDate.toISOString())
      )
    );

  // 按位置类型聚合数据
  const aggregatedData: { [key in PlacementType]?: {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
  }} = {};

  for (const row of performanceData) {
    const placement = row.placement as PlacementType;
    if (!aggregatedData[placement]) {
      aggregatedData[placement] = {
        impressions: 0,
        clicks: 0,
        spend: 0,
        sales: 0,
        orders: 0
      };
    }
    aggregatedData[placement]!.impressions += row.impressions || 0;
    aggregatedData[placement]!.clicks += row.clicks || 0;
    aggregatedData[placement]!.spend += Number(row.spend) || 0;
    aggregatedData[placement]!.sales += Number(row.sales) || 0;
    aggregatedData[placement]!.orders += row.orders || 0;
  }

  // 计算各位置的效率评分
  const scores: PlacementEfficiencyScore[] = [];
  
  for (const [placement, metrics] of Object.entries(aggregatedData)) {
    const { score, confidence, normalizedMetrics } = calculateEfficiencyScore(metrics);
    
    scores.push({
      placementType: placement as PlacementType,
      rawScore: score,
      normalizedScore: score / 100,
      confidence,
      metrics: {
        ...metrics,
        roas: normalizedMetrics.roas,
        acos: normalizedMetrics.acos,
        cvr: normalizedMetrics.cvr,
        cpc: normalizedMetrics.cpc,
        ctr: normalizedMetrics.ctr
      }
    });
  }

  return scores;
}

/**
 * 获取广告活动当前的位置倾斜设置
 */
export async function getCampaignPlacementSettings(
  campaignId: string,
  accountId: number
): Promise<{ [key in PlacementType]?: number }> {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  const settings = await db.select()
    .from(placementSettings)
    .where(
      and(
        eq(placementSettings.campaignId, campaignId),
        eq(placementSettings.accountId, accountId)
      )
    ) as any[];

  const result: { [key in PlacementType]?: number } = {};
  for (const setting of settings) {
    if (setting.placementType) {
      result[setting.placementType as PlacementType] = setting.adjustmentPercent || 0;
    }
  }

  return result;
}

/**
 * 更新广告活动的位置倾斜设置
 */
export async function updatePlacementSettings(
  campaignId: string,
  accountId: number,
  adjustments: PlacementAdjustmentSuggestion[]
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  for (const adj of adjustments) {
    // 检查是否存在设置记录
    const existing = await db.select()
      .from(placementSettings)
      .where(
        and(
          eq(placementSettings.campaignId, campaignId),
          eq(placementSettings.accountId, accountId),
          sql`${placementSettings}.placement_type = ${adj.placementType}`
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // 更新现有记录 - 根据位置类型更新对应字段
      const updateData: any = {
        lastAdjustedAt: new Date()
      };
      if (adj.placementType === 'top_of_search') {
        updateData.topOfSearchAdjustment = adj.suggestedAdjustment;
      } else if (adj.placementType === 'product_page') {
        updateData.productPageAdjustment = adj.suggestedAdjustment;
      }
      await db.update(placementSettings)
        .set(updateData)
        .where(eq(placementSettings.id, existing[0].id));
    } else {
      // 创建新记录
      const insertData: any = {
        campaignId,
        accountId,
        autoOptimize: true
      };
      if (adj.placementType === 'top_of_search') {
        insertData.topOfSearchAdjustment = adj.suggestedAdjustment;
      } else if (adj.placementType === 'product_page') {
        insertData.productPageAdjustment = adj.suggestedAdjustment;
      }
      await db.insert(placementSettings).values(insertData);
    }
  }
}

/**
 * 执行位置倾斜自动优化
 * 
 * 完整流程：
 * 1. 获取位置表现数据
 * 2. 计算效率评分
 * 3. 计算最优倾斜比例
 * 4. 检查调整频率限制（2小时冷却期）
 * 5. 执行调整并记录日志
 */
export async function executeAutomaticPlacementOptimization(
  campaignId: string,
  accountId: number,
  weights?: PlacementWeightConfig
): Promise<{
  success: boolean;
  message: string;
  suggestions: PlacementAdjustmentSuggestion[];
}> {
  try {
    // 1. 获取位置表现数据
    const scores = await getCampaignPlacementPerformance(campaignId, accountId, 7);
    
    if (scores.length === 0) {
      return {
        success: false,
        message: '没有足够的位置表现数据进行优化',
        suggestions: []
      };
    }

    // 2. 获取当前倾斜设置
    const currentSettings = await getCampaignPlacementSettings(campaignId, accountId);

    // 3. 计算最优倾斜比例
    const suggestions = calculateOptimalAdjustment(scores, currentSettings);

    // 4. 检查是否有需要调整的项目
    const needsAdjustment = suggestions.some(s => Math.abs(s.adjustmentDelta) >= 5);
    
    if (!needsAdjustment) {
      return {
        success: true,
        message: '当前位置倾斜设置已接近最优，无需调整',
        suggestions
      };
    }

    // 5. 更新位置倾斜设置
    await updatePlacementSettings(campaignId, accountId, suggestions);

    return {
      success: true,
      message: `成功更新${suggestions.length}个位置的倾斜设置`,
      suggestions
    };
  } catch (error) {
    console.error('位置倾斜优化执行失败:', error);
    return {
      success: false,
      message: `优化执行失败: ${error instanceof Error ? error.message : '未知错误'}`,
      suggestions: []
    };
  }
}

/**
 * 批量执行多个广告活动的位置倾斜优化
 */
export async function batchExecutePlacementOptimization(
  accountId: number,
  campaignIds?: string[]
): Promise<{
  total: number;
  success: number;
  failed: number;
  results: Array<{
    campaignId: string;
    success: boolean;
    message: string;
  }>;
}> {
  // 获取需要优化的广告活动列表
  let campaignsToOptimize: { amazonCampaignId: string }[] = [];
  
  if (campaignIds && campaignIds.length > 0) {
    campaignsToOptimize = campaignIds.map(id => ({ amazonCampaignId: id }));
  } else {
    // 获取所有启用的广告活动
    const db = await getDb();
    if (!db) throw new Error('Database connection failed');
    const allCampaigns = await db.select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.accountId, accountId),
          eq(campaigns.campaignStatus, 'enabled')
        )
      ) as any[];
    campaignsToOptimize = allCampaigns
      .filter((c: any) => c.amazonCampaignId)
      .map((c: any) => ({ amazonCampaignId: c.amazonCampaignId }));
  }

  const results: Array<{
    campaignId: string;
    success: boolean;
    message: string;
  }> = [];

  let successCount = 0;
  let failedCount = 0;

  for (const campaign of campaignsToOptimize) {
    if (!campaign.amazonCampaignId) continue;
    
    const result = await executeAutomaticPlacementOptimization(
      campaign.amazonCampaignId,
      accountId
    );

    results.push({
      campaignId: campaign.amazonCampaignId,
      success: result.success,
      message: result.message
    });

    if (result.success) {
      successCount++;
    } else {
      failedCount++;
    }
  }

  return {
    total: campaignsToOptimize.length,
    success: successCount,
    failed: failedCount,
    results
  };
}

/**
 * 分析广告位置表现
 */
export async function analyzePlacementPerformance(
  campaignId: string,
  accountId: number
): Promise<any> {
  const performance = await getCampaignPlacementPerformance(campaignId, accountId);
  if (!performance) return null;
  
  return {
    campaignId,
    placements: performance,
    analysis: {
      bestPerforming: performance.reduce((best: any, p: any) => 
        (p.roas || 0) > (best?.roas || 0) ? p : best, null),
      worstPerforming: performance.reduce((worst: any, p: any) => 
        (p.roas || Infinity) < (worst?.roas || Infinity) ? p : worst, null),
    }
  };
}

/**
 * 生成广告位置优化建议
 */
export async function generatePlacementSuggestions(
  campaignId: string,
  accountId: number
): Promise<any[]> {
  const performance = await getCampaignPlacementPerformance(campaignId, accountId);
  if (!performance) return [];
  
  const suggestions: any[] = [];
  
  // 将performance转换为PlacementEfficiencyScore格式
  const scores: PlacementEfficiencyScore[] = performance.map((p: any) => ({
    placementType: p.placement || p.placementType || 'top_of_search',
    rawScore: p.roas || 0,
    normalizedScore: Math.min(1, (p.roas || 0) / 5),
    confidence: Math.min(1, (p.clicks || 0) / 100),
    metrics: {
      impressions: p.impressions || 0,
      clicks: p.clicks || 0,
      spend: p.spend || 0,
      sales: p.sales || 0,
      orders: p.orders || 0,
      acos: p.acos || 0,
      roas: p.roas || 0,
      ctr: p.ctr || 0,
      cvr: p.cvr || 0,
      cpc: p.cpc || 0
    }
  }));
  
  const currentAdjustments: { [key: string]: number } = {};
  performance.forEach((p: any) => {
    currentAdjustments[p.placement || p.placementType] = p.currentAdjustment || 0;
  });
  
  const adjustmentSuggestions = calculateOptimalAdjustment(scores, currentAdjustments as any);
  
  for (const suggestion of adjustmentSuggestions) {
    if (Math.abs(suggestion.suggestedAdjustment - suggestion.currentAdjustment) > 5) {
      suggestions.push({
        placement: suggestion.placementType,
        currentAdjustment: suggestion.currentAdjustment,
        suggestedAdjustment: suggestion.suggestedAdjustment,
        suggestedMultiplier: 1 + suggestion.suggestedAdjustment / 100,
        currentMultiplier: 1 + suggestion.currentAdjustment / 100,
        reason: suggestion.reason
      });
    }
  }
  
  return suggestions;
}

/**
 * 应用广告位置调整
 */
export async function applyPlacementAdjustment(
  campaignId: string,
  accountId: number,
  adjustment: any
): Promise<boolean> {
  try {
    await updatePlacementSettings(campaignId, accountId, [{
      placementType: adjustment.placement,
      currentAdjustment: adjustment.currentAdjustment || 0,
      suggestedAdjustment: adjustment.suggestedAdjustment,
      adjustmentDelta: adjustment.suggestedAdjustment - (adjustment.currentAdjustment || 0),
      efficiencyScore: 0,
      confidence: 1,
      reason: adjustment.reason || ''
    }] as PlacementAdjustmentSuggestion[]);
    return true;
  } catch (error) {
    console.error('[placementOptimizationService] applyPlacementAdjustment error:', error);
    return false;
  }
}

export default {
  calculateEfficiencyScore,
  calculateOptimalAdjustment,
  getCampaignPlacementPerformance,
  getCampaignPlacementSettings,
  updatePlacementSettings,
  executeAutomaticPlacementOptimization,
  batchExecutePlacementOptimization,
  analyzePlacementPerformance,
  generatePlacementSuggestions,
  applyPlacementAdjustment
};
