/**
 * 自动广告匹配类型优化服务
 * 
 * 支持四种匹配类型的智能优化：
 * - close_match (紧密匹配): 与商品高度相关的搜索词
 * - loose_match (宽泛匹配): 与商品松散相关的搜索词
 * - substitutes (同类商品): 浏览过类似商品的顾客
 * - complements (关联商品): 浏览过互补商品的顾客
 */

import { getDb } from "./db";
import { sql } from "drizzle-orm";

// 匹配类型定义
export type AutoTargetingType = 'close_match' | 'loose_match' | 'substitutes' | 'complements';

// 匹配类型中文名称
export const AUTO_TARGETING_TYPE_NAMES: Record<AutoTargetingType, string> = {
  close_match: '紧密匹配',
  loose_match: '宽泛匹配',
  substitutes: '同类商品',
  complements: '关联商品'
};

// 匹配类型优化参数
export interface AutoTargetingOptimizationParams {
  targetAcos: number;           // 目标ACoS
  minBid: number;               // 最低竞价
  maxBid: number;               // 最高竞价
  minClicks: number;            // 最少点击数（用于判断数据充足性）
  minImpressions: number;       // 最少展示数
  bidAdjustmentStep: number;    // 竞价调整步长（百分比）
  maxBidAdjustment: number;     // 最大竞价调整幅度（百分比）
}

// 默认优化参数
export const DEFAULT_OPTIMIZATION_PARAMS: AutoTargetingOptimizationParams = {
  targetAcos: 0.25,             // 25% ACoS
  minBid: 0.10,                 // $0.10
  maxBid: 10.00,                // $10.00
  minClicks: 10,                // 10次点击
  minImpressions: 1000,         // 1000次展示
  bidAdjustmentStep: 0.10,      // 10%
  maxBidAdjustment: 0.50        // 50%
};

// 匹配类型绩效数据
export interface AutoTargetingPerformance {
  targetingType: AutoTargetingType;
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  orders: number;
  acos: number;
  roas: number;
  ctr: number;
  cvr: number;
  cpc: number;
}

// 优化建议
export interface AutoTargetingOptimizationSuggestion {
  campaignId: string;
  adGroupId: string;
  targetingType: AutoTargetingType;
  suggestionType: 'increase_bid' | 'decrease_bid' | 'pause' | 'enable' | 'adjust_multiplier';
  currentBid: number;
  suggestedBid: number;
  changePercent: number;
  reason: string;
  confidenceScore: number;
  expectedImpact: string;
  performanceData: AutoTargetingPerformance;
}

/**
 * 获取自动广告匹配类型的绩效数据
 */
export async function getAutoTargetingPerformance(
  campaignId: string,
  adGroupId: string,
  startDate: string,
  endDate: string
): Promise<AutoTargetingPerformance[]> {
  const dbInstance = await getDb();
  if (!dbInstance) return [];

  try {
    const results = await dbInstance.execute(sql`
      SELECT 
        targeting_type as targetingType,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(cost) as cost,
        SUM(sales) as sales,
        SUM(orders) as orders,
        CASE WHEN SUM(sales) > 0 THEN SUM(cost) / SUM(sales) ELSE NULL END as acos,
        CASE WHEN SUM(cost) > 0 THEN SUM(sales) / SUM(cost) ELSE NULL END as roas,
        CASE WHEN SUM(impressions) > 0 THEN SUM(clicks) / SUM(impressions) ELSE 0 END as ctr,
        CASE WHEN SUM(clicks) > 0 THEN SUM(orders) / SUM(clicks) ELSE 0 END as cvr,
        CASE WHEN SUM(clicks) > 0 THEN SUM(cost) / SUM(clicks) ELSE 0 END as cpc
      FROM auto_targeting_performance
      WHERE campaign_id = ${campaignId}
        AND ad_group_id = ${adGroupId}
        AND date BETWEEN ${startDate} AND ${endDate}
      GROUP BY targeting_type
    `);

    return (results as any[]).map(row => ({
      targetingType: row.targetingType as AutoTargetingType,
      impressions: Number(row.impressions) || 0,
      clicks: Number(row.clicks) || 0,
      cost: Number(row.cost) || 0,
      sales: Number(row.sales) || 0,
      orders: Number(row.orders) || 0,
      acos: Number(row.acos) || 0,
      roas: Number(row.roas) || 0,
      ctr: Number(row.ctr) || 0,
      cvr: Number(row.cvr) || 0,
      cpc: Number(row.cpc) || 0
    }));
  } catch (error) {
    console.error('[autoTargetingOptimization] Error getting performance:', error);
    return [];
  }
}

/**
 * 分析匹配类型绩效并生成优化建议
 */
export function analyzeAutoTargetingPerformance(
  performance: AutoTargetingPerformance,
  currentBid: number,
  params: AutoTargetingOptimizationParams = DEFAULT_OPTIMIZATION_PARAMS
): AutoTargetingOptimizationSuggestion | null {
  const { targetAcos, minBid, maxBid, minClicks, bidAdjustmentStep, maxBidAdjustment } = params;

  // 数据不足，无法生成建议
  if (performance.clicks < minClicks) {
    return null;
  }

  let suggestionType: AutoTargetingOptimizationSuggestion['suggestionType'];
  let suggestedBid: number;
  let reason: string;
  let confidenceScore: number;
  let expectedImpact: string;

  // 计算绩效评分
  const acosRatio = performance.acos / targetAcos;
  const hasConversions = performance.orders > 0;

  if (!hasConversions && performance.clicks >= minClicks * 2) {
    // 无转化且点击数较多，建议暂停
    suggestionType = 'pause';
    suggestedBid = 0;
    reason = `该匹配类型在${performance.clicks}次点击后仍无转化，建议暂停以节省预算`;
    confidenceScore = 0.85;
    expectedImpact = `预计每天节省$${(performance.cost / 30).toFixed(2)}`;
  } else if (acosRatio > 1.5) {
    // ACoS过高，降低竞价
    const reduction = Math.min(
      (acosRatio - 1) * bidAdjustmentStep,
      maxBidAdjustment
    );
    suggestedBid = Math.max(currentBid * (1 - reduction), minBid);
    suggestionType = 'decrease_bid';
    reason = `当前ACoS(${(performance.acos * 100).toFixed(1)}%)高于目标(${(targetAcos * 100).toFixed(1)}%)，建议降低竞价`;
    confidenceScore = Math.min(0.9, 0.5 + (performance.clicks / 100) * 0.4);
    expectedImpact = `预计ACoS降低${((1 - suggestedBid / currentBid) * 100).toFixed(0)}%`;
  } else if (acosRatio < 0.7 && performance.roas > 3) {
    // ACoS很低，ROAS很高，可以提高竞价获取更多流量
    const increase = Math.min(
      (1 - acosRatio) * bidAdjustmentStep,
      maxBidAdjustment
    );
    suggestedBid = Math.min(currentBid * (1 + increase), maxBid);
    suggestionType = 'increase_bid';
    reason = `当前ACoS(${(performance.acos * 100).toFixed(1)}%)低于目标，ROAS(${performance.roas.toFixed(2)})表现优秀，建议提高竞价获取更多流量`;
    confidenceScore = Math.min(0.85, 0.5 + (performance.orders / 20) * 0.35);
    expectedImpact = `预计展示量增加${((suggestedBid / currentBid - 1) * 50).toFixed(0)}%`;
  } else {
    // 绩效正常，无需调整
    return null;
  }

  const changePercent = currentBid > 0 ? ((suggestedBid - currentBid) / currentBid) * 100 : 0;

  return {
    campaignId: '',
    adGroupId: '',
    targetingType: performance.targetingType,
    suggestionType,
    currentBid,
    suggestedBid,
    changePercent,
    reason,
    confidenceScore,
    expectedImpact,
    performanceData: performance
  };
}

/**
 * 为广告活动生成自动广告优化建议
 */
export async function generateAutoTargetingOptimizations(
  campaignId: string,
  adGroupId: string,
  params: AutoTargetingOptimizationParams = DEFAULT_OPTIMIZATION_PARAMS
): Promise<AutoTargetingOptimizationSuggestion[]> {
  const dbInstance = await getDb();
  if (!dbInstance) return [];

  // 获取过去30天的绩效数据
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const performanceData = await getAutoTargetingPerformance(
    campaignId,
    adGroupId,
    startDate,
    endDate
  );

  // 获取当前竞价设置
  const settings = await dbInstance.execute(sql`
    SELECT targeting_type, bid
    FROM auto_targeting_settings
    WHERE campaign_id = ${campaignId} AND ad_group_id = ${adGroupId}
  `);

  const bidMap = new Map<string, number>();
  (settings as any[]).forEach(s => {
    bidMap.set(s.targeting_type, Number(s.bid) || 0.5);
  });

  const suggestions: AutoTargetingOptimizationSuggestion[] = [];

  for (const perf of performanceData) {
    const currentBid = bidMap.get(perf.targetingType) || 0.5;
    const suggestion = analyzeAutoTargetingPerformance(perf, currentBid, params);
    
    if (suggestion) {
      suggestion.campaignId = campaignId;
      suggestion.adGroupId = adGroupId;
      suggestions.push(suggestion);
    }
  }

  return suggestions;
}

/**
 * 保存优化建议到数据库
 */
export async function saveAutoTargetingOptimizationSuggestions(
  suggestions: AutoTargetingOptimizationSuggestion[]
): Promise<void> {
  const dbInstance = await getDb();
  if (!dbInstance || suggestions.length === 0) return;

  try {
    for (const suggestion of suggestions) {
      await dbInstance.execute(sql`
        INSERT INTO auto_targeting_optimization_suggestions (
          campaign_id, ad_group_id, match_type, suggestion_type,
          current_value, suggested_value, change_percent, reason,
          confidence_score, expected_impact, performance_data, suggestion_status
        ) VALUES (
          ${suggestion.campaignId},
          ${suggestion.adGroupId},
          ${suggestion.targetingType},
          ${suggestion.suggestionType},
          ${suggestion.currentBid},
          ${suggestion.suggestedBid},
          ${suggestion.changePercent},
          ${suggestion.reason},
          ${suggestion.confidenceScore},
          ${suggestion.expectedImpact},
          ${JSON.stringify(suggestion.performanceData)},
          'pending'
        )
      `);
    }
  } catch (error) {
    console.error('[autoTargetingOptimization] Error saving suggestions:', error);
  }
}

/**
 * 应用优化建议
 */
export async function applyAutoTargetingOptimization(
  suggestionId: number,
  userId: number
): Promise<boolean> {
  const dbInstance = await getDb();
  if (!dbInstance) return false;

  try {
    // 获取建议详情
    const [suggestion] = await dbInstance.execute(sql`
      SELECT * FROM auto_targeting_optimization_suggestions WHERE id = ${suggestionId}
    `) as any[];

    if (!suggestion || suggestion.suggestion_status !== 'pending') {
      return false;
    }

    // 更新竞价设置
    if (suggestion.suggestion_type === 'pause') {
      await dbInstance.execute(sql`
        UPDATE auto_targeting_settings
        SET targeting_status = 'paused', updated_at = NOW()
        WHERE campaign_id = ${suggestion.campaign_id}
          AND ad_group_id = ${suggestion.ad_group_id}
          AND targeting_type = ${suggestion.match_type}
      `);
    } else if (suggestion.suggestion_type === 'enable') {
      await dbInstance.execute(sql`
        UPDATE auto_targeting_settings
        SET targeting_status = 'enabled', updated_at = NOW()
        WHERE campaign_id = ${suggestion.campaign_id}
          AND ad_group_id = ${suggestion.ad_group_id}
          AND targeting_type = ${suggestion.match_type}
      `);
    } else {
      await dbInstance.execute(sql`
        UPDATE auto_targeting_settings
        SET bid = ${suggestion.suggested_value}, updated_at = NOW()
        WHERE campaign_id = ${suggestion.campaign_id}
          AND ad_group_id = ${suggestion.ad_group_id}
          AND targeting_type = ${suggestion.match_type}
      `);
    }

    // 更新建议状态
    await dbInstance.execute(sql`
      UPDATE auto_targeting_optimization_suggestions
      SET suggestion_status = 'applied', applied_at = NOW(), applied_by = ${userId}
      WHERE id = ${suggestionId}
    `);

    return true;
  } catch (error) {
    console.error('[autoTargetingOptimization] Error applying suggestion:', error);
    return false;
  }
}

/**
 * 获取匹配类型优化建议列表
 */
export async function getAutoTargetingOptimizationSuggestions(
  campaignId?: string,
  status?: string
): Promise<any[]> {
  const dbInstance = await getDb();
  if (!dbInstance) return [];

  try {
    let query = sql`
      SELECT * FROM auto_targeting_optimization_suggestions
      WHERE 1=1
    `;

    if (campaignId) {
      query = sql`${query} AND campaign_id = ${campaignId}`;
    }

    if (status) {
      query = sql`${query} AND suggestion_status = ${status}`;
    }

    query = sql`${query} ORDER BY created_at DESC LIMIT 100`;

    const results = await dbInstance.execute(query);
    return results as any[];
  } catch (error) {
    console.error('[autoTargetingOptimization] Error getting suggestions:', error);
    return [];
  }
}
