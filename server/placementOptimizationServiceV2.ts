/**
 * 广告位置智能倾斜服务 V2
 * 
 * 改进版本，包含以下优化：
 * 1. 提高数据置信度阈值（基于转化次数）
 * 2. 整合归因延迟补偿（排除近3天数据或应用权重系数）
 * 3. 添加调整冷却期（同一广告活动间隔至少7天）
 * 4. 动态竞价策略协同
 * 5. 动态归一化基准（基于账户历史数据）
 * 6. 效果追踪机制
 */

import { getDb } from "./db";
import { 
  placementPerformance, 
  placementSettings,
  campaigns,
  bidAdjustmentHistory
} from "../drizzle/schema";
import { eq, and, desc, gte, lte, sql, lt } from "drizzle-orm";

// ==================== 类型定义 ====================

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

// 位置效率评分结果
export interface PlacementEfficiencyScore {
  placementType: PlacementType;
  rawScore: number;           // 原始评分 (0-100)
  normalizedScore: number;    // 归一化评分 (0-1)
  confidence: number;         // 数据置信度 (0-1)
  isReliable: boolean;        // 数据是否可靠
  confidenceReason: string;   // 置信度原因
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
  isReliable: boolean;            // 数据是否可靠
  reason: string;                 // 调整原因
  cooldownStatus?: {              // 冷却期状态
    inCooldown: boolean;
    lastAdjustmentDate?: Date;
    daysRemaining?: number;
  };
}

// 调整历史记录
export interface PlacementAdjustmentRecord {
  id: number;
  campaignId: string;
  accountId: number;
  placementType: PlacementType;
  previousAdjustment: number;
  newAdjustment: number;
  adjustmentDelta: number;
  efficiencyScore: number;
  confidence: number;
  reason: string;
  appliedAt: Date;
  // 效果追踪
  metricsBeforeAdjustment?: {
    roas: number;
    acos: number;
    cvr: number;
    spend: number;
    sales: number;
  };
  metricsAfterAdjustment?: {
    roas: number;
    acos: number;
    cvr: number;
    spend: number;
    sales: number;
  };
}

// ==================== 默认配置 ====================

const DEFAULT_WEIGHTS: PlacementWeightConfig = {
  roasWeight: 0.35,
  acosWeight: 0.25,
  cvrWeight: 0.25,
  cpcWeight: 0.15
};

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

// 归因延迟权重系数
const ATTRIBUTION_DELAY_WEIGHT = 0.7;

// ==================== 专家建议新增：竞价归一化配置 ====================

/**
 * 竞价归一化接口
 * 专家建议：剔除位置溢价计算真实Base Bid表现
 */
export interface NormalizedBidMetrics {
  originalBid: number;           // 原始出价
  effectiveBid: number;          // 实际生效出价（含位置溢价）
  normalizedBid: number;         // 归一化后的基础出价
  placementMultiplier: number;   // 位置溢价倍数
  placementType: PlacementType;
}

/**
 * 竞价与位置协同调整结果
 * 专家建议：防止双重加价螺旋
 */
export interface CoordinatedAdjustmentResult {
  baseBidAdjustment: number;     // 基础出价调整百分比
  placementAdjustments: {        // 位置调整
    topOfSearch: number;
    productPage: number;
    restOfSearch: number;
  };
  totalEffectiveCpcChange: number; // 总有效CPC变化百分比
  warning?: string;              // 警告信息
}

// ==================== 核心算法函数 ====================

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
    console.error('[PlacementOptimizationV2] 计算动态基准失败:', error);
    return DEFAULT_BENCHMARKS;
  }
}

/**
 * 改进后的效率评分计算
 * 
 * 改进点：
 * 1. 使用改进的置信度计算
 * 2. 支持动态归一化基准
 */
export function calculateEfficiencyScoreV2(
  metrics: {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
  },
  weights: PlacementWeightConfig = DEFAULT_WEIGHTS,
  benchmarks: NormalizationBenchmarks = DEFAULT_BENCHMARKS
): { 
  score: number; 
  confidence: ConfidenceResult; 
  normalizedMetrics: any 
} {
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
 * 检查调整冷却期
 * 
 * 改进点：
 * 1. 同一广告活动的位置调整间隔至少7天
 * 2. 返回详细的冷却期状态
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
    console.error('[PlacementOptimizationV2] 检查冷却期失败:', error);
    return { inCooldown: false };
  }
}

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
    // 从campaigns表获取竞价策略
    // 注意：当前schema可能没有biddingStrategy字段，需要添加或从其他来源获取
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
    
    // 如果有biddingStrategy字段，返回它
    // 否则根据其他字段推断
    // 这里暂时返回默认值，实际应该从Amazon API同步
    return 'down_only';
  } catch (error) {
    console.error('[PlacementOptimizationV2] 获取竞价策略失败:', error);
    return 'fixed';
  }
}

/**
 * 根据竞价策略调整位置倾斜上限
 * 
 * 改进点：
 * 1. 考虑动态竞价策略的叠加效应
 * 2. 防止实际竞价过高
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

/**
 * 改进后的调整幅度计算
 * 
 * 改进点：
 * 1. 基于置信度的差异化调整幅度
 * 2. 考虑冷却期
 * 3. 更保守的调整策略
 */
export function calculateAdjustmentDeltaV2(
  currentAdjustment: number,
  suggestedAdjustment: number,
  confidence: number,
  isReliable: boolean,
  biddingStrategy: BiddingStrategy
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
 * 获取广告活动的位置表现数据（带归因延迟补偿）
 * 
 * 改进点：
 * 1. 排除最近3天的数据或应用权重系数
 * 2. 使用加权移动平均
 */
export async function getCampaignPlacementPerformanceV2(
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
    
    // 计算数据的时间权重（可选：近期数据权重略低）
    const rowDate = new Date(row.date);
    const daysAgo = Math.floor((endDate.getTime() - rowDate.getTime()) / (1000 * 60 * 60 * 24));
    
    // 如果不排除近期数据，对近期数据应用权重系数
    let weight = 1.0;
    if (!excludeRecentDays && daysAgo < ATTRIBUTION_DELAY_DAYS) {
      weight = ATTRIBUTION_DELAY_WEIGHT;
    }
    
    aggregatedData[placement]!.impressions += (row.impressions || 0) * weight;
    aggregatedData[placement]!.clicks += (row.clicks || 0) * weight;
    aggregatedData[placement]!.spend += Number(row.spend || 0) * weight;
    aggregatedData[placement]!.sales += Number(row.sales || 0) * weight;
    aggregatedData[placement]!.orders += (row.orders || 0) * weight;
  }

  // 获取动态基准
  const benchmarks = await calculateDynamicBenchmarks(accountId);

  // 计算各位置的效率评分
  const scores: PlacementEfficiencyScore[] = [];
  
  for (const [placement, metrics] of Object.entries(aggregatedData)) {
    const { score, confidence, normalizedMetrics } = calculateEfficiencyScoreV2(
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
 * 计算最优倾斜比例（改进版）
 * 
 * 改进点：
 * 1. 考虑数据可靠性
 * 2. 应用冷却期检查
 * 3. 考虑竞价策略
 */
export async function calculateOptimalAdjustmentV2(
  scores: PlacementEfficiencyScore[],
  currentAdjustments: { [key in PlacementType]?: number },
  campaignId: string,
  accountId: number
): Promise<PlacementAdjustmentSuggestion[]> {
  if (scores.length === 0) return [];

  // 获取竞价策略
  const biddingStrategy = await getCampaignBiddingStrategy(campaignId, accountId);
  
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
    const cooldownStatus = await checkAdjustmentCooldown(
      campaignId, 
      accountId, 
      score.placementType
    );
    
    // 基于评分差异计算建议倾斜
    let suggestedAdj = 0;
    
    if (maxScore > 0 && score.isReliable) {
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
    } else if (!score.isReliable) {
      // 数据不可靠，保持当前设置
      suggestedAdj = currentAdj;
    }

    // 应用调整幅度限制
    const adjustmentResult = calculateAdjustmentDeltaV2(
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
      reason = cooldownStatus.reason || '在冷却期内，暂不调整';
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
 * 记录位置调整历史（用于效果追踪）
 */
export async function recordPlacementAdjustment(
  campaignId: string,
  accountId: number,
  adjustment: PlacementAdjustmentSuggestion,
  metricsBeforeAdjustment?: any
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
    console.error('[PlacementOptimizationV2] 记录调整历史失败:', error);
  }
}

/**
 * 执行位置倾斜自动优化（改进版）
 */
export async function executeAutomaticPlacementOptimizationV2(
  campaignId: string,
  accountId: number,
  options?: {
    weights?: PlacementWeightConfig;
    forceAdjust?: boolean;  // 强制调整（忽略冷却期）
    dryRun?: boolean;       // 模拟运行（不实际应用）
  }
): Promise<{
  success: boolean;
  message: string;
  suggestions: PlacementAdjustmentSuggestion[];
  benchmarksUsed: NormalizationBenchmarks;
  biddingStrategy: BiddingStrategy;
}> {
  try {
    // 1. 获取动态基准
    const benchmarks = await calculateDynamicBenchmarks(accountId);
    
    // 2. 获取竞价策略
    const biddingStrategy = await getCampaignBiddingStrategy(campaignId, accountId);
    
    // 3. 获取位置表现数据（带归因延迟补偿）
    const scores = await getCampaignPlacementPerformanceV2(campaignId, accountId, 14, true);
    
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
    const currentSettings = await getCampaignPlacementSettingsV2(campaignId, accountId);

    // 5. 计算最优倾斜比例
    const suggestions = await calculateOptimalAdjustmentV2(
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
      await updatePlacementSettingsV2(campaignId, accountId, suggestions);
      
      // 记录调整历史
      for (const suggestion of suggestions) {
        if (Math.abs(suggestion.adjustmentDelta) >= 5 && 
            suggestion.isReliable && 
            !suggestion.cooldownStatus?.inCooldown) {
          await recordPlacementAdjustment(campaignId, accountId, suggestion);
        }
      }
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
    console.error('[PlacementOptimizationV2] 位置倾斜优化执行失败:', error);
    return {
      success: false,
      message: `优化执行失败: ${error instanceof Error ? error.message : '未知错误'}`,
      suggestions: [],
      benchmarksUsed: DEFAULT_BENCHMARKS,
      biddingStrategy: 'fixed'
    };
  }
}

/**
 * 获取广告活动当前的位置倾斜设置
 */
export async function getCampaignPlacementSettingsV2(
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
    result.rest_of_search = 0; // 默认值
  }

  return result;
}

/**
 * 更新广告活动的位置倾斜设置
 */
export async function updatePlacementSettingsV2(
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
    
    // 这里需要基线数据进行对比，暂时返回简化分析
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

// ==================== 专家建议新增：竞价归一化和协同调整 ====================

/**
 * 计算归一化的基础出价
 * 专家建议：剔除位置溢价计算真实Base Bid表现
 * 
 * 例如：如果基础出价$1，搜索顶部溢价50%，则实际出价$1.5
 * 归一化后的基础出价 = $1.5 / 1.5 = $1
 * 
 * @param actualCpc - 实际CPC
 * @param placementAdjustment - 位置溢价百分比（如50表示50%）
 */
export function normalizeBaseBid(
  actualCpc: number,
  placementAdjustment: number
): NormalizedBidMetrics {
  const multiplier = 1 + (placementAdjustment / 100);
  const normalizedBid = actualCpc / multiplier;
  
  return {
    originalBid: normalizedBid,
    effectiveBid: actualCpc,
    normalizedBid,
    placementMultiplier: multiplier,
    placementType: 'top_of_search' // 默认，实际使用时需指定
  };
}

/**
 * 计算协同调整方案
 * 专家建议：防止双重加价螺旋
 * 
 * 核心逻辑：
 * 1. 当位置溢价增加时，同步降低基础出价
 * 2. 保持总有效CPC在可控范围内
 * 3. 监控并防止指数级增长
 * 
 * @param currentBaseBid - 当前基础出价
 * @param currentPlacements - 当前位置调整
 * @param suggestedPlacements - 建议的位置调整
 * @param targetMaxCpcIncrease - 目标最大CPC增幅百分比（默认30%）
 */
export function calculateCoordinatedAdjustment(
  currentBaseBid: number,
  currentPlacements: {
    topOfSearch: number;
    productPage: number;
    restOfSearch: number;
  },
  suggestedPlacements: {
    topOfSearch: number;
    productPage: number;
    restOfSearch: number;
  },
  targetMaxCpcIncrease: number = 30
): CoordinatedAdjustmentResult {
  // 计算当前最高有效CPC（以搜索顶部为例）
  const currentMaxEffectiveCpc = currentBaseBid * (1 + currentPlacements.topOfSearch / 100);
  
  // 计算建议后的最高有效CPC
  const suggestedMaxEffectiveCpc = currentBaseBid * (1 + suggestedPlacements.topOfSearch / 100);
  
  // 计算CPC变化百分比
  const cpcChangePercent = ((suggestedMaxEffectiveCpc - currentMaxEffectiveCpc) / currentMaxEffectiveCpc) * 100;
  
  let baseBidAdjustment = 0;
  let finalPlacements = { ...suggestedPlacements };
  let warning: string | undefined;
  
  // 专家建议：如果CPC增幅超过目标，需要协同调整
  if (cpcChangePercent > targetMaxCpcIncrease) {
    // 计算需要降低的基础出价比例
    // 目标：保持总有效CPC增幅在targetMaxCpcIncrease以内
    const targetMaxCpc = currentMaxEffectiveCpc * (1 + targetMaxCpcIncrease / 100);
    const requiredBaseBid = targetMaxCpc / (1 + suggestedPlacements.topOfSearch / 100);
    baseBidAdjustment = ((requiredBaseBid - currentBaseBid) / currentBaseBid) * 100;
    
    warning = `位置溢价增加将导致CPC增幅${cpcChangePercent.toFixed(1)}%，超过目标${targetMaxCpcIncrease}%。建议同步降低基础出价${Math.abs(baseBidAdjustment).toFixed(1)}%以控制总成本。`;
  } else if (cpcChangePercent < -targetMaxCpcIncrease) {
    // CPC降幅过大，可以适当提高基础出价以保持竞争力
    const targetMinCpc = currentMaxEffectiveCpc * (1 - targetMaxCpcIncrease / 100);
    const requiredBaseBid = targetMinCpc / (1 + suggestedPlacements.topOfSearch / 100);
    baseBidAdjustment = ((requiredBaseBid - currentBaseBid) / currentBaseBid) * 100;
    
    warning = `位置溢价降低将导致CPC降幅${Math.abs(cpcChangePercent).toFixed(1)}%。可考虑适当提高基础出价${baseBidAdjustment.toFixed(1)}%以保持竞争力。`;
  }
  
  // 计算最终有效CPC变化
  const finalBaseBid = currentBaseBid * (1 + baseBidAdjustment / 100);
  const finalMaxEffectiveCpc = finalBaseBid * (1 + finalPlacements.topOfSearch / 100);
  const totalEffectiveCpcChange = ((finalMaxEffectiveCpc - currentMaxEffectiveCpc) / currentMaxEffectiveCpc) * 100;
  
  return {
    baseBidAdjustment: Math.round(baseBidAdjustment * 100) / 100,
    placementAdjustments: finalPlacements,
    totalEffectiveCpcChange: Math.round(totalEffectiveCpcChange * 100) / 100,
    warning
  };
}

/**
 * 监控总有效CPC是否超过安全阈值
 * 专家建议：防止指数级暴涨
 * 
 * @param baseBid - 基础出价
 * @param placementAdjustment - 位置溢价百分比
 * @param biddingStrategy - 竞价策略
 * @param maxSafeEffectiveCpc - 最大安全有效CPC（默认$10）
 */
export function checkEffectiveCpcSafety(
  baseBid: number,
  placementAdjustment: number,
  biddingStrategy: BiddingStrategy,
  maxSafeEffectiveCpc: number = 10
): {
  isSafe: boolean;
  effectiveCpc: number;
  maxPossibleCpc: number;
  warning?: string;
} {
  // 计算有效CPC
  const effectiveCpc = baseBid * (1 + placementAdjustment / 100);
  
  // 计算最大可能的CPC（考虑动态竞价策略）
  let maxPossibleCpc = effectiveCpc;
  if (biddingStrategy === 'up_and_down') {
    // 动态竞价-提高和降低：Amazon可能将竞价提高100%
    maxPossibleCpc = effectiveCpc * 2;
  }
  
  const isSafe = maxPossibleCpc <= maxSafeEffectiveCpc;
  
  return {
    isSafe,
    effectiveCpc,
    maxPossibleCpc,
    warning: !isSafe 
      ? `警告：最大可能CPC ($${maxPossibleCpc.toFixed(2)}) 超过安全阈值 ($${maxSafeEffectiveCpc})。建议降低基础出价或位置溢价。`
      : undefined
  };
}

// ==================== 导出 ====================

export default {
  // 核心函数
  calculateDataConfidence,
  calculateDynamicBenchmarks,
  calculateEfficiencyScoreV2,
  checkAdjustmentCooldown,
  getCampaignBiddingStrategy,
  getMaxAdjustmentByBiddingStrategy,
  calculateAdjustmentDeltaV2,
  
  // 数据获取
  getCampaignPlacementPerformanceV2,
  getCampaignPlacementSettingsV2,
  
  // 优化执行
  calculateOptimalAdjustmentV2,
  executeAutomaticPlacementOptimizationV2,
  updatePlacementSettingsV2,
  
  // 效果追踪
  recordPlacementAdjustment,
  getPlacementAdjustmentEffectAnalysis,
  
  // 专家建议新增：竞价归一化和协同调整
  normalizeBaseBid,
  calculateCoordinatedAdjustment,
  checkEffectiveCpcSafety,
  
  // 常量
  ADJUSTMENT_COOLDOWN_DAYS,
  ATTRIBUTION_DELAY_DAYS,
  DEFAULT_WEIGHTS,
  DEFAULT_BENCHMARKS
};
