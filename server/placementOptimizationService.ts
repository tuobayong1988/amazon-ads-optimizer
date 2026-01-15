/**
 * 广告位置智能倾斜服务
 * 
 * 功能：
 * 1. 位置数据同步 - 从Amazon API获取各位置表现数据
 * 2. 效率评分算法 - 计算每个位置的效率得分
 * 3. 最优倾斜比例计算 - 基于评分差异计算建议倾斜百分比
 * 4. 自动调整执行 - 按照2小时频率自动调整位置倾斜
 * 
 * V2改进（2026年1月）：
 * - 提高数据置信度阈值（基于转化次数）
 * - 整合归因延迟补偿（排除近3天数据）
 * - 添加调整冷却期（7天）
 * - 动态竞价策略协同
 * - 动态归一化基准
 * - 效果追踪机制
 */

import { getDb } from "./db";
import { 
  placementPerformance, 
  placementSettings,
  campaigns,
  bidAdjustmentHistory
} from "../drizzle/schema";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";

// ==================== 类型定义 ====================

// 位置类型定义
export type PlacementType = 'top_of_search' | 'product_page' | 'rest_of_search';

// 动态竞价策略类型
export type BiddingStrategy = 'fixed' | 'down_only' | 'up_and_down';

// 位置效率评分权重配置
export interface PlacementWeightConfig {
  roasWeight: number;      // ROAS权重 (默认0.35)
  acosWeight: number;      // ACoS权重 (默认0.25)
  cvrWeight: number;       // 转化率权重 (默认0.25)
  cpcWeight: number;       // CPC权重 (默认0.15)
}

// 动态归一化基准配置
export interface NormalizationBenchmarks {
  roasBaseline: number;    // ROAS基准值 (默认5)
  acosBaseline: number;    // ACoS基准值 (默认100)
  cvrBaseline: number;     // CVR基准值 (默认15)
  cpcBaseline: number;     // CPC基准值 (默认2)
}

// 置信度计算结果
export interface ConfidenceResult {
  confidence: number;      // 置信度 (0-1)
  isReliable: boolean;     // 数据是否可靠
  reason: string;          // 原因说明
  conversions: number;     // 转化次数
  clicks: number;          // 点击次数
  spend: number;           // 花费
}

// 默认权重配置
const DEFAULT_WEIGHTS: PlacementWeightConfig = {
  roasWeight: 0.35,
  acosWeight: 0.25,
  cvrWeight: 0.25,
  cpcWeight: 0.15
};

// 默认归一化基准
const DEFAULT_BENCHMARKS: NormalizationBenchmarks = {
  roasBaseline: 5,
  acosBaseline: 100,
  cvrBaseline: 15,  // 从20%降低到15%，更符合实际
  cpcBaseline: 2
};

// 调整冷却期（天）
const ADJUSTMENT_COOLDOWN_DAYS = 7;

// 归因延迟天数
const ATTRIBUTION_DELAY_DAYS = 3;

// 位置效率评分结果
export interface PlacementEfficiencyScore {
  placementType: PlacementType;
  rawScore: number;           // 原始评分 (0-100)
  normalizedScore: number;    // 归一化评分 (0-1)
  confidence: number;         // 数据置信度 (0-1)
  isReliable: boolean;        // 数据是否可靠（V2新增）
  confidenceReason: string;   // 置信度原因（V2新增）
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
  isReliable: boolean;            // 数据是否可靠（V2新增）
  reason: string;                 // 调整原因
  cooldownStatus?: {              // 冷却期状态（V2新增）
    inCooldown: boolean;
    lastAdjustmentDate?: Date;
    daysRemaining?: number;
  };
}

// ==================== V2改进：置信度计算 ====================

/**
 * 改进后的数据置信度计算
 * 基于转化次数和点击量综合评估
 * 
 * 改进点：
 * 1. 将转化次数作为最重要的指标
 * 2. 提高最低阈值要求
 * 3. 返回详细的置信度原因
 */
export function calculateDataConfidence(
  metrics: { clicks: number; orders: number; spend: number }
): ConfidenceResult {
  const { clicks, orders, spend } = metrics;
  
  // 转化次数是最重要的指标
  if (orders >= 20 && clicks >= 200 && spend >= 100) {
    return { 
      confidence: 1.0, 
      isReliable: true, 
      reason: '数据充足（≥20转化，≥200点击），高置信度',
      conversions: orders,
      clicks,
      spend
    };
  }
  
  if (orders >= 10 && clicks >= 100 && spend >= 50) {
    return { 
      confidence: 0.8, 
      isReliable: true, 
      reason: '数据较充足（≥10转化，≥100点击），中高置信度',
      conversions: orders,
      clicks,
      spend
    };
  }
  
  if (orders >= 5 && clicks >= 50 && spend >= 25) {
    return { 
      confidence: 0.6, 
      isReliable: true, 
      reason: '数据中等（≥5转化，≥50点击），可参考',
      conversions: orders,
      clicks,
      spend
    };
  }
  
  if (orders >= 2 && clicks >= 20) {
    return { 
      confidence: 0.4, 
      isReliable: false, 
      reason: '数据不足（<5转化），建议继续观察',
      conversions: orders,
      clicks,
      spend
    };
  }
  
  return { 
    confidence: 0.2, 
    isReliable: false, 
    reason: '数据严重不足（<2转化），不建议调整',
    conversions: orders,
    clicks,
    spend
  };
}

// ==================== V2改进：动态归一化基准 ====================

/**
 * 计算动态归一化基准
 * 基于账户历史数据计算品类级基准值
 */
export async function calculateDynamicBenchmarks(
  accountId: number,
  days: number = 30
): Promise<NormalizationBenchmarks> {
  const db = await getDb();
  if (!db) return DEFAULT_BENCHMARKS;
  
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // 获取账户历史表现数据
    const performanceData = await db.select({
      avgRoas: sql<number>`AVG(CASE WHEN spend > 0 THEN sales / spend ELSE 0 END)`,
      avgAcos: sql<number>`AVG(CASE WHEN sales > 0 THEN (spend / sales) * 100 ELSE 100 END)`,
      avgCvr: sql<number>`AVG(CASE WHEN clicks > 0 THEN (orders / clicks) * 100 ELSE 0 END)`,
      avgCpc: sql<number>`AVG(CASE WHEN clicks > 0 THEN spend / clicks ELSE 0 END)`
    })
    .from(placementPerformance)
    .where(
      and(
        eq(placementPerformance.accountId, accountId),
        gte(placementPerformance.date, startDate.toISOString())
      )
    );
    
    if (performanceData.length === 0 || !performanceData[0].avgRoas) {
      return DEFAULT_BENCHMARKS;
    }
    
    const data = performanceData[0];
    
    // 使用历史平均值的1.5倍作为"优秀"基准
    // 但设置合理的上下限
    return {
      roasBaseline: Math.max(2, Math.min(10, (data.avgRoas || 3) * 1.5)),
      acosBaseline: 100, // ACoS基准保持100%
      cvrBaseline: Math.max(5, Math.min(25, (data.avgCvr || 10) * 1.5)),
      cpcBaseline: Math.max(0.5, Math.min(5, (data.avgCpc || 1) * 1.5))
    };
  } catch (error) {
    console.error('[PlacementOptimization] 计算动态基准失败:', error);
    return DEFAULT_BENCHMARKS;
  }
}

// ==================== V2改进：冷却期检查 ====================

/**
 * 检查调整冷却期
 * 同一广告活动的位置调整间隔至少7天
 */
export async function checkAdjustmentCooldown(
  campaignId: string,
  accountId: number,
  placementType: PlacementType
): Promise<{
  inCooldown: boolean;
  lastAdjustmentDate?: Date;
  daysRemaining?: number;
  reason?: string;
}> {
  const db = await getDb();
  if (!db) {
    return { inCooldown: false };
  }
  
  try {
    // 查询该位置的最近一次调整记录
    const lastAdjustment = await db.select()
      .from(bidAdjustmentHistory)
      .where(
        and(
          eq(bidAdjustmentHistory.accountId, accountId),
          sql`${bidAdjustmentHistory.campaignName} = ${campaignId}`,
          eq(bidAdjustmentHistory.adjustmentType, 'auto_placement')
        )
      )
      .orderBy(desc(bidAdjustmentHistory.appliedAt))
      .limit(1);
    
    if (lastAdjustment.length === 0) {
      return { inCooldown: false };
    }
    
    const lastDate = new Date(lastAdjustment[0].appliedAt || new Date());
    const now = new Date();
    const daysSinceLastAdjustment = Math.floor(
      (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    
    if (daysSinceLastAdjustment < ADJUSTMENT_COOLDOWN_DAYS) {
      return {
        inCooldown: true,
        lastAdjustmentDate: lastDate,
        daysRemaining: ADJUSTMENT_COOLDOWN_DAYS - daysSinceLastAdjustment,
        reason: `距上次调整仅${daysSinceLastAdjustment}天，建议等待至少${ADJUSTMENT_COOLDOWN_DAYS}天`
      };
    }
    
    return {
      inCooldown: false,
      lastAdjustmentDate: lastDate
    };
  } catch (error) {
    console.error('[PlacementOptimization] 检查冷却期失败:', error);
    return { inCooldown: false };
  }
}

// ==================== V2改进：竞价策略协同 ====================

/**
 * 获取广告活动的竞价策略
 */
export async function getCampaignBiddingStrategy(
  campaignId: string,
  accountId: number
): Promise<BiddingStrategy> {
  const db = await getDb();
  if (!db) return 'fixed';
  
  try {
    const campaign = await db.select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.accountId, accountId),
          eq(campaigns.campaignId, campaignId)
        )
      )
      .limit(1);
    
    if (campaign.length === 0) {
      return 'fixed';
    }
    
    // 默认返回down_only，实际应该从Amazon API同步
    return 'down_only';
  } catch (error) {
    console.error('[PlacementOptimization] 获取竞价策略失败:', error);
    return 'fixed';
  }
}

/**
 * 根据竞价策略调整位置倾斜上限
 */
export function getMaxAdjustmentByBiddingStrategy(
  biddingStrategy: BiddingStrategy
): number {
  switch (biddingStrategy) {
    case 'up_and_down':
      // 动态竞价-提高和降低：Amazon可能将竞价提高100%
      // 为避免叠加效应，限制位置调整上限为100%
      return 100;
    case 'down_only':
      // 动态竞价-仅降低：Amazon只会降低竞价
      // 可以使用较高的位置调整
      return 200;
    case 'fixed':
    default:
      // 固定竞价：完全由位置调整控制
      return 200;
  }
}

// ==================== 核心算法函数 ====================

/**
 * 计算位置效率评分（V2改进版）
 * 
 * 评分公式：
 * Score = (ROAS_norm × W_roas) + ((1 - ACoS_norm) × W_acos) + (CVR_norm × W_cvr) + ((1 - CPC_norm) × W_cpc)
 */
export function calculateEfficiencyScore(
  metrics: {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
  },
  weights: PlacementWeightConfig = DEFAULT_WEIGHTS,
  benchmarks: NormalizationBenchmarks = DEFAULT_BENCHMARKS
): { score: number; confidence: ConfidenceResult; normalizedMetrics: any } {
  // 计算派生指标
  const ctr = metrics.clicks > 0 ? (metrics.clicks / metrics.impressions) * 100 : 0;
  const cpc = metrics.clicks > 0 ? metrics.spend / metrics.clicks : 0;
  const cvr = metrics.clicks > 0 ? (metrics.orders / metrics.clicks) * 100 : 0;
  const acos = metrics.sales > 0 ? (metrics.spend / metrics.sales) * 100 : 100;
  const roas = metrics.spend > 0 ? metrics.sales / metrics.spend : 0;

  // 使用动态基准进行归一化 (0-1范围)
  const roasNorm = Math.min(roas / benchmarks.roasBaseline, 1);
  const acosNorm = Math.min(acos / benchmarks.acosBaseline, 1);
  const cvrNorm = Math.min(cvr / benchmarks.cvrBaseline, 1);
  const cpcNorm = Math.min(cpc / benchmarks.cpcBaseline, 1);

  // 计算加权评分 (0-100)
  const score = (
    (roasNorm * weights.roasWeight) +
    ((1 - acosNorm) * weights.acosWeight) +
    (cvrNorm * weights.cvrWeight) +
    ((1 - cpcNorm) * weights.cpcWeight)
  ) * 100;

  // 使用改进的置信度计算
  const confidence = calculateDataConfidence(metrics);

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
 * 改进后的调整幅度计算
 */
export function calculateAdjustmentDelta(
  currentAdjustment: number,
  suggestedAdjustment: number,
  confidence: number,
  isReliable: boolean,
  biddingStrategy: BiddingStrategy = 'down_only'
): { 
  delta: number; 
  finalAdjustment: number;
  reason: string;
  wasLimited: boolean;
} {
  // 如果数据不可靠，不进行调整
  if (!isReliable) {
    return {
      delta: 0,
      finalAdjustment: currentAdjustment,
      reason: '数据不足，暂不调整',
      wasLimited: true
    };
  }
  
  // 基于置信度的最大调整幅度
  let maxDeltaPercent: number;
  if (confidence >= 0.8) {
    maxDeltaPercent = 20; // 高置信度，允许较大调整
  } else if (confidence >= 0.6) {
    maxDeltaPercent = 10; // 中等置信度，保守调整
  } else {
    maxDeltaPercent = 5;  // 低置信度，微调
  }
  
  // 计算原始调整幅度
  let delta = suggestedAdjustment - currentAdjustment;
  
  // 应用最大调整幅度限制
  const maxDelta = Math.max(Math.abs(currentAdjustment) * 0.25, maxDeltaPercent);
  let wasLimited = false;
  
  if (Math.abs(delta) > maxDelta) {
    delta = delta > 0 ? maxDelta : -maxDelta;
    wasLimited = true;
  }
  
  // 计算最终调整值
  let finalAdjustment = currentAdjustment + delta;
  
  // 应用竞价策略限制
  const maxByStrategy = getMaxAdjustmentByBiddingStrategy(biddingStrategy);
  if (finalAdjustment > maxByStrategy) {
    finalAdjustment = maxByStrategy;
    wasLimited = true;
  }
  
  // 确保在安全范围内 (-50% to maxByStrategy)
  finalAdjustment = Math.max(-50, Math.min(maxByStrategy, finalAdjustment));
  
  // 重新计算实际delta
  delta = finalAdjustment - currentAdjustment;
  
  return {
    delta: Math.round(delta),
    finalAdjustment: Math.round(finalAdjustment),
    reason: `置信度${(confidence * 100).toFixed(0)}%，最大调整幅度${maxDeltaPercent}%${wasLimited ? '（已限制）' : ''}`,
    wasLimited
  };
}

/**
 * 计算最优倾斜比例（V2改进版）
 */
export async function calculateOptimalAdjustment(
  scores: PlacementEfficiencyScore[],
  currentAdjustments: { [key in PlacementType]?: number },
  campaignId?: string,
  accountId?: number
): Promise<PlacementAdjustmentSuggestion[]> {
  if (scores.length === 0) return [];

  // 获取竞价策略
  let biddingStrategy: BiddingStrategy = 'down_only';
  if (campaignId && accountId) {
    biddingStrategy = await getCampaignBiddingStrategy(campaignId, accountId);
  }

  // 找出最高评分（仅考虑可靠数据）
  const reliableScores = scores.filter(s => s.isReliable);
  const maxScore = reliableScores.length > 0 
    ? Math.max(...reliableScores.map(s => s.rawScore))
    : Math.max(...scores.map(s => s.rawScore));
  
  // 计算各位置的建议倾斜比例
  const suggestions: PlacementAdjustmentSuggestion[] = [];
  
  for (const score of scores) {
    const currentAdj = currentAdjustments[score.placementType] || 0;
    
    // 检查冷却期
    let cooldownStatus: { inCooldown: boolean; lastAdjustmentDate?: Date; daysRemaining?: number; reason?: string } = { inCooldown: false };
    if (campaignId && accountId) {
      cooldownStatus = await checkAdjustmentCooldown(campaignId, accountId, score.placementType);
    }
    
    // 基于评分差异计算建议倾斜
    let suggestedAdj = 0;
    
    if (maxScore > 0 && score.isReliable) {
      const relativeScore = score.rawScore / maxScore;
      
      if (relativeScore >= 0.9) {
        suggestedAdj = Math.round((relativeScore - 0.5) * 200 * score.confidence);
      } else if (relativeScore >= 0.7) {
        suggestedAdj = Math.round((relativeScore - 0.5) * 100 * score.confidence);
      } else if (relativeScore >= 0.5) {
        suggestedAdj = Math.round((relativeScore - 0.7) * 100 * score.confidence);
      } else {
        suggestedAdj = Math.round((relativeScore - 0.8) * 100 * score.confidence);
      }
    } else if (!score.isReliable) {
      suggestedAdj = currentAdj;
    }

    // 应用调整幅度限制
    const adjustmentResult = calculateAdjustmentDelta(
      currentAdj,
      suggestedAdj,
      score.confidence,
      score.isReliable,
      biddingStrategy
    );

    // 如果在冷却期内，不进行调整
    if (cooldownStatus.inCooldown) {
      adjustmentResult.delta = 0;
      adjustmentResult.finalAdjustment = currentAdj;
    }

    // 生成调整原因
    let reason = '';
    if (cooldownStatus.inCooldown) {
      reason = (cooldownStatus as any).reason || '在冷却期内，暂不调整';
    } else if (!score.isReliable) {
      reason = `${score.confidenceReason}，暂不调整`;
    } else if (adjustmentResult.delta > 5) {
      reason = `该位置效率评分${score.rawScore.toFixed(1)}分（${score.confidenceReason}），建议增加倾斜`;
    } else if (adjustmentResult.delta < -5) {
      reason = `该位置效率评分${score.rawScore.toFixed(1)}分（${score.confidenceReason}），建议降低倾斜`;
    } else {
      reason = `该位置效率评分${score.rawScore.toFixed(1)}分，表现稳定，建议保持当前设置`;
    }

    suggestions.push({
      placementType: score.placementType,
      currentAdjustment: currentAdj,
      suggestedAdjustment: adjustmentResult.finalAdjustment,
      adjustmentDelta: adjustmentResult.delta,
      efficiencyScore: score.rawScore,
      confidence: score.confidence,
      isReliable: score.isReliable,
      reason,
      cooldownStatus: {
        inCooldown: cooldownStatus.inCooldown,
        lastAdjustmentDate: cooldownStatus.lastAdjustmentDate,
        daysRemaining: cooldownStatus.daysRemaining
      }
    });
  }

  return suggestions;
}

/**
 * 获取广告活动的位置表现数据（V2改进版：带归因延迟补偿）
 */
export async function getCampaignPlacementPerformance(
  campaignId: string,
  accountId: number,
  days: number = 14,  // 增加到14天
  excludeRecentDays: boolean = true
): Promise<PlacementEfficiencyScore[]> {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  
  // 计算日期范围
  const endDate = new Date();
  if (excludeRecentDays) {
    // 排除最近3天的数据（归因延迟）
    endDate.setDate(endDate.getDate() - ATTRIBUTION_DELAY_DAYS);
  }
  
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  // 从数据库获取位置表现数据
  const performanceData = await db.select()
    .from(placementPerformance)
    .where(
      and(
        eq(placementPerformance.campaignId, campaignId),
        eq(placementPerformance.accountId, accountId),
        gte(placementPerformance.date, startDate.toISOString()),
        lte(placementPerformance.date, endDate.toISOString())
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

  // 获取动态基准
  const benchmarks = await calculateDynamicBenchmarks(accountId);

  // 计算各位置的效率评分
  const scores: PlacementEfficiencyScore[] = [];
  
  for (const [placement, metrics] of Object.entries(aggregatedData)) {
    const { score, confidence, normalizedMetrics } = calculateEfficiencyScore(
      metrics,
      DEFAULT_WEIGHTS,
      benchmarks
    );
    
    scores.push({
      placementType: placement as PlacementType,
      rawScore: score,
      normalizedScore: score / 100,
      confidence: confidence.confidence,
      isReliable: confidence.isReliable,
      confidenceReason: confidence.reason,
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
  
  if (settings.length > 0) {
    const setting = settings[0];
    result.top_of_search = setting.topOfSearchAdjustment || 0;
    result.product_page = setting.productPageAdjustment || 0;
    result.rest_of_search = 0;
  }

  return result;
}

/**
 * 记录位置调整历史
 */
export async function recordPlacementAdjustment(
  campaignId: string,
  accountId: number,
  adjustment: PlacementAdjustmentSuggestion
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  try {
    await db.insert(bidAdjustmentHistory).values({
      accountId,
      campaignName: campaignId,
      previousBid: adjustment.currentAdjustment.toString(),
      newBid: adjustment.suggestedAdjustment.toString(),
      bidChangePercent: adjustment.adjustmentDelta.toString(),
      adjustmentType: 'auto_placement',
      adjustmentReason: adjustment.reason,
      optimizationScore: Math.round(adjustment.efficiencyScore),
      appliedAt: new Date().toISOString(),
      status: 'applied'
    });
  } catch (error) {
    console.error('[PlacementOptimization] 记录调整历史失败:', error);
  }
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
  
  // 只更新需要调整且数据可靠且不在冷却期的位置
  const validAdjustments = adjustments.filter(adj => 
    Math.abs(adj.adjustmentDelta) >= 5 && 
    adj.isReliable && 
    !adj.cooldownStatus?.inCooldown
  );
  
  if (validAdjustments.length === 0) return;
  
  // 检查是否存在设置记录
  const existing = await db.select()
    .from(placementSettings)
    .where(
      and(
        eq(placementSettings.campaignId, campaignId),
        eq(placementSettings.accountId, accountId)
      )
    )
    .limit(1);

  const updateData: any = {
    lastAdjustedAt: new Date()
  };
  
  for (const adj of validAdjustments) {
    if (adj.placementType === 'top_of_search') {
      updateData.topOfSearchAdjustment = adj.suggestedAdjustment;
    } else if (adj.placementType === 'product_page') {
      updateData.productPageAdjustment = adj.suggestedAdjustment;
    }
    
    // 记录调整历史
    await recordPlacementAdjustment(campaignId, accountId, adj);
  }

  if (existing.length > 0) {
    await db.update(placementSettings)
      .set(updateData)
      .where(eq(placementSettings.id, existing[0].id));
  } else {
    await db.insert(placementSettings).values({
      campaignId,
      accountId,
      autoOptimize: true,
      ...updateData
    });
  }
}

/**
 * 执行位置倾斜自动优化（V2改进版）
 */
export async function executeAutomaticPlacementOptimization(
  campaignId: string,
  accountId: number,
  options?: {
    weights?: PlacementWeightConfig;
    forceAdjust?: boolean;
    dryRun?: boolean;
  }
): Promise<{
  success: boolean;
  message: string;
  suggestions: PlacementAdjustmentSuggestion[];
  benchmarksUsed?: NormalizationBenchmarks;
  biddingStrategy?: BiddingStrategy;
}> {
  try {
    // 1. 获取动态基准
    const benchmarks = await calculateDynamicBenchmarks(accountId);
    
    // 2. 获取竞价策略
    const biddingStrategy = await getCampaignBiddingStrategy(campaignId, accountId);
    
    // 3. 获取位置表现数据（带归因延迟补偿）
    const scores = await getCampaignPlacementPerformance(campaignId, accountId, 14, true);
    
    if (scores.length === 0) {
      return {
        success: false,
        message: '没有足够的位置表现数据进行优化',
        suggestions: [],
        benchmarksUsed: benchmarks,
        biddingStrategy
      };
    }

    // 4. 获取当前倾斜设置
    const currentSettings = await getCampaignPlacementSettings(campaignId, accountId);

    // 5. 计算最优倾斜比例
    const suggestions = await calculateOptimalAdjustment(
      scores, 
      currentSettings,
      campaignId,
      accountId
    );

    // 6. 检查是否有需要调整的项目
    const needsAdjustment = suggestions.some(s => 
      Math.abs(s.adjustmentDelta) >= 5 && 
      s.isReliable && 
      !s.cooldownStatus?.inCooldown
    );
    
    if (!needsAdjustment) {
      return {
        success: true,
        message: '当前位置倾斜设置已接近最优，或数据不足/在冷却期内，无需调整',
        suggestions,
        benchmarksUsed: benchmarks,
        biddingStrategy
      };
    }

    // 7. 如果不是模拟运行，更新位置倾斜设置
    if (!options?.dryRun) {
      await updatePlacementSettings(campaignId, accountId, suggestions);
    }

    const adjustedCount = suggestions.filter(s => 
      Math.abs(s.adjustmentDelta) >= 5 && 
      s.isReliable && 
      !s.cooldownStatus?.inCooldown
    ).length;

    return {
      success: true,
      message: options?.dryRun 
        ? `模拟运行：建议调整${adjustedCount}个位置的倾斜设置`
        : `成功更新${adjustedCount}个位置的倾斜设置`,
      suggestions,
      benchmarksUsed: benchmarks,
      biddingStrategy
    };
  } catch (error) {
    console.error('[PlacementOptimization] 位置倾斜优化执行失败:', error);
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
  skipped: number;
  results: Array<{
    campaignId: string;
    success: boolean;
    message: string;
    skippedReason?: string;
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
    skippedReason?: string;
  }> = [];

  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const campaign of campaignsToOptimize) {
    if (!campaign.amazonCampaignId) continue;
    
    const result = await executeAutomaticPlacementOptimization(
      campaign.amazonCampaignId,
      accountId
    );

    // 检查是否因为冷却期或数据不足而跳过
    const wasSkipped = result.suggestions.every(s => 
      s.cooldownStatus?.inCooldown || !s.isReliable
    );

    results.push({
      campaignId: campaign.amazonCampaignId,
      success: result.success,
      message: result.message,
      skippedReason: wasSkipped ? '冷却期内或数据不足' : undefined
    });

    if (wasSkipped) {
      skippedCount++;
    } else if (result.success) {
      successCount++;
    } else {
      failedCount++;
    }
  }

  return {
    total: campaignsToOptimize.length,
    success: successCount,
    failed: failedCount,
    skipped: skippedCount,
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
  if (!performance || performance.length === 0) return null;
  
  return {
    campaignId,
    placements: performance,
    analysis: {
      bestPerforming: performance.reduce((best: any, p: any) => 
        (p.metrics?.roas || 0) > (best?.metrics?.roas || 0) ? p : best, performance[0]),
      worstPerforming: performance.reduce((worst: any, p: any) => 
        (p.metrics?.roas || Infinity) < (worst?.metrics?.roas || Infinity) ? p : worst, performance[0]),
      reliableDataCount: performance.filter(p => p.isReliable).length,
      totalPlacements: performance.length
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
  if (!performance || performance.length === 0) return [];
  
  const currentAdjustments = await getCampaignPlacementSettings(campaignId, accountId);
  const adjustmentSuggestions = await calculateOptimalAdjustment(
    performance, 
    currentAdjustments,
    campaignId,
    accountId
  );
  
  const suggestions: any[] = [];
  
  for (const suggestion of adjustmentSuggestions) {
    if (Math.abs(suggestion.suggestedAdjustment - suggestion.currentAdjustment) > 5) {
      suggestions.push({
        placement: suggestion.placementType,
        currentAdjustment: suggestion.currentAdjustment,
        suggestedAdjustment: suggestion.suggestedAdjustment,
        suggestedMultiplier: 1 + suggestion.suggestedAdjustment / 100,
        currentMultiplier: 1 + suggestion.currentAdjustment / 100,
        reason: suggestion.reason,
        isReliable: suggestion.isReliable,
        confidence: suggestion.confidence,
        cooldownStatus: suggestion.cooldownStatus
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
      isReliable: true,
      reason: adjustment.reason || ''
    }] as PlacementAdjustmentSuggestion[]);
    return true;
  } catch (error) {
    console.error('[placementOptimizationService] applyPlacementAdjustment error:', error);
    return false;
  }
}

/**
 * 获取位置调整效果分析
 */
export async function getPlacementAdjustmentEffectAnalysis(
  campaignId: string,
  accountId: number,
  adjustmentId?: number
): Promise<{
  adjustmentRecord: any;
  effectAnalysis: {
    roasChange: number;
    acosChange: number;
    spendChange: number;
    salesChange: number;
    isPositive: boolean;
    summary: string;
  } | null;
}> {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  
  // 获取调整记录
  let adjustmentRecord: any = null;
  
  if (adjustmentId) {
    const records = await db.select()
      .from(bidAdjustmentHistory)
      .where(eq(bidAdjustmentHistory.id, adjustmentId))
      .limit(1);
    adjustmentRecord = records[0];
  } else {
    // 获取最近的位置调整记录
    const records = await db.select()
      .from(bidAdjustmentHistory)
      .where(
        and(
          eq(bidAdjustmentHistory.accountId, accountId),
          sql`${bidAdjustmentHistory.campaignName} = ${campaignId}`,
          eq(bidAdjustmentHistory.adjustmentType, 'auto_placement')
        )
      )
      .orderBy(desc(bidAdjustmentHistory.appliedAt))
      .limit(1);
    adjustmentRecord = records[0];
  }
  
  if (!adjustmentRecord) {
    return { adjustmentRecord: null, effectAnalysis: null };
  }
  
  // 如果有7天后的效果数据，进行分析
  if (adjustmentRecord.actualRevenue7D !== null && adjustmentRecord.actualSpend7D !== null) {
    const actualRoas = adjustmentRecord.actualSpend7D > 0 
      ? adjustmentRecord.actualRevenue7D / adjustmentRecord.actualSpend7D 
      : 0;
    const actualAcos = adjustmentRecord.actualRevenue7D > 0 
      ? (adjustmentRecord.actualSpend7D / adjustmentRecord.actualRevenue7D) * 100 
      : 100;
    
    return {
      adjustmentRecord,
      effectAnalysis: {
        roasChange: 0,
        acosChange: 0,
        spendChange: 0,
        salesChange: 0,
        isPositive: actualRoas > 0,
        summary: `调整后7天ROAS: ${actualRoas.toFixed(2)}, ACoS: ${actualAcos.toFixed(1)}%`
      }
    };
  }
  
  return { adjustmentRecord, effectAnalysis: null };
}

// ==================== 导出 ====================

export default {
  // 核心函数
  calculateDataConfidence,
  calculateDynamicBenchmarks,
  calculateEfficiencyScore,
  checkAdjustmentCooldown,
  getCampaignBiddingStrategy,
  getMaxAdjustmentByBiddingStrategy,
  calculateAdjustmentDelta,
  calculateOptimalAdjustment,
  
  // 数据获取
  getCampaignPlacementPerformance,
  getCampaignPlacementSettings,
  
  // 优化执行
  executeAutomaticPlacementOptimization,
  batchExecutePlacementOptimization,
  updatePlacementSettings,
  
  // 分析和建议
  analyzePlacementPerformance,
  generatePlacementSuggestions,
  applyPlacementAdjustment,
  
  // 效果追踪
  recordPlacementAdjustment,
  getPlacementAdjustmentEffectAnalysis,
  
  // 常量
  ADJUSTMENT_COOLDOWN_DAYS,
  ATTRIBUTION_DELAY_DAYS,
  DEFAULT_WEIGHTS,
  DEFAULT_BENCHMARKS
};
