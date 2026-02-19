/**
 * SB品牌广告优化服务
 * 
 * 支持三种品牌广告类型的智能优化：
 * - product_collection: 商品集合广告
 * - store_spotlight: 品牌旗舰店聚焦广告
 * - video: 视频广告（基于搜索，应用市场曲线建模和边际分析）
 * 
 * 注意：视频广告虽然属于品牌广告，但其核心依旧是搜索广告类型，
 * 因此在优化算法中充分应用市场曲线建模、边际分析和决策树逻辑
 */

import { getDb } from "./db";
import { sql } from "drizzle-orm";
import {
  generateSBVideoOptimizationSuggestion,
  SBVideoPerformance,
  DEFAULT_SB_VIDEO_PARAMS,
  SearchAdOptimizationSuggestion
} from "./searchAdsOptimizationEngine";

// 品牌广告类型
export type SBCampaignType = 'product_collection' | 'store_spotlight' | 'video';

// 落地页类型
export type LandingPageType = 'store' | 'product_list' | 'custom_url';

// 品牌广告优化参数
export interface SBOptimizationParams {
  targetAcos: number;
  minBid: number;
  maxBid: number;
  minClicks: number;
  minImpressions: number;
  bidAdjustmentStep: number;
  maxBidAdjustment: number;
}

// 默认优化参数
export const DEFAULT_SB_OPTIMIZATION_PARAMS: SBOptimizationParams = {
  targetAcos: 0.30,             // 30% ACoS (品牌广告通常ACoS略高)
  minBid: 0.20,                 // $0.20
  maxBid: 15.00,                // $15.00
  minClicks: 15,                // 15次点击
  minImpressions: 2000,         // 2000次展示
  bidAdjustmentStep: 0.10,      // 10%
  maxBidAdjustment: 0.40        // 40%
};

// 品牌广告绩效数据
export interface SBPerformanceData {
  campaignId: string;
  campaignType: SBCampaignType;
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
  newToBrandOrders: number;      // 新客户订单
  newToBrandSales: number;       // 新客户销售额
  newToBrandOrdersPercent: number; // 新客户订单占比
  videoViews?: number;           // 视频观看次数
  videoViewRate?: number;        // 视频观看率
  videoCompleteViews?: number;   // 视频完整观看次数
}

// 品牌广告优化建议
export interface SBOptimizationSuggestion {
  campaignId: string;
  suggestionType: 'bid_adjustment' | 'keyword_optimization' | 'creative_optimization' | 'targeting_expansion' | 'budget_reallocation';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  currentValue?: number;
  suggestedValue?: number;
  expectedImpact: string;
  confidenceScore: number;
  actionItems: string[];
}

// 关键词优化建议
export interface SBKeywordSuggestion {
  campaignId: string;
  keywordId?: string;
  keyword: string;
  matchType: 'exact' | 'phrase' | 'broad';
  suggestionType: 'add' | 'pause' | 'increase_bid' | 'decrease_bid' | 'change_match_type';
  currentBid?: number;
  suggestedBid?: number;
  reason: string;
  performanceData?: {
    impressions: number;
    clicks: number;
    cost: number;
    sales: number;
    acos: number;
  };
}

/**
 * 获取品牌广告绩效数据
 */
export async function getSBCampaignPerformance(
  accountId: string,
  startDate: string,
  endDate: string
): Promise<SBPerformanceData[]> {
  const dbInstance = await getDb();
  if (!dbInstance) return [];

  try {
    // 从campaigns表获取SB广告活动绩效
    const results = await dbInstance.execute(sql`
      SELECT 
        c.amazon_campaign_id as campaignId,
        c.campaign_type as campaignType,
        SUM(dp.impressions) as impressions,
        SUM(dp.clicks) as clicks,
        SUM(dp.cost) as cost,
        SUM(dp.sales) as sales,
        SUM(dp.orders) as orders,
        CASE WHEN SUM(dp.sales) > 0 THEN SUM(dp.cost) / SUM(dp.sales) ELSE NULL END as acos,
        CASE WHEN SUM(dp.cost) > 0 THEN SUM(dp.sales) / SUM(dp.cost) ELSE NULL END as roas,
        CASE WHEN SUM(dp.impressions) > 0 THEN SUM(dp.clicks) / SUM(dp.impressions) ELSE 0 END as ctr,
        CASE WHEN SUM(dp.clicks) > 0 THEN SUM(dp.orders) / SUM(dp.clicks) ELSE 0 END as cvr,
        CASE WHEN SUM(dp.clicks) > 0 THEN SUM(dp.cost) / SUM(dp.clicks) ELSE 0 END as cpc
      FROM campaigns c
      LEFT JOIN daily_performance dp ON c.id = dp.campaign_id
      WHERE c.account_id = ${accountId}
        AND c.ad_type = 'SB'
        AND dp.date BETWEEN ${startDate} AND ${endDate}
      GROUP BY c.amazon_campaign_id, c.campaign_type
    `);

    return (results as any[]).map(row => ({
      campaignId: row.campaignId,
      campaignType: (row.campaignType || 'product_collection') as SBCampaignType,
      impressions: Number(row.impressions) || 0,
      clicks: Number(row.clicks) || 0,
      cost: Number(row.cost) || 0,
      sales: Number(row.sales) || 0,
      orders: Number(row.orders) || 0,
      acos: Number(row.acos) || 0,
      roas: Number(row.roas) || 0,
      ctr: Number(row.ctr) || 0,
      cvr: Number(row.cvr) || 0,
      cpc: Number(row.cpc) || 0,
      newToBrandOrders: 0,
      newToBrandSales: 0,
      newToBrandOrdersPercent: 0
    }));
  } catch (error) {
    console.error('[sbOptimization] Error getting performance:', error);
    return [];
  }
}

/**
 * 分析品牌广告绩效并生成优化建议
 */
export function analyzeSBPerformance(
  performance: SBPerformanceData,
  params: SBOptimizationParams = DEFAULT_SB_OPTIMIZATION_PARAMS
): SBOptimizationSuggestion[] {
  const suggestions: SBOptimizationSuggestion[] = [];
  const { targetAcos, minClicks } = params;

  // 数据不足
  if (performance.clicks < minClicks) {
    suggestions.push({
      campaignId: performance.campaignId,
      suggestionType: 'targeting_expansion',
      priority: 'medium',
      title: '扩大定向范围',
      description: `当前广告活动点击量不足(${performance.clicks}次)，建议扩大关键词或商品定向范围以获取更多流量`,
      expectedImpact: '预计展示量增加50%以上',
      confidenceScore: 0.7,
      actionItems: [
        '添加更多相关关键词',
        '扩展商品定向范围',
        '考虑使用广泛匹配类型'
      ]
    });
    return suggestions;
  }

  const acosRatio = performance.acos / targetAcos;

  // ACoS过高
  if (acosRatio > 1.5) {
    suggestions.push({
      campaignId: performance.campaignId,
      suggestionType: 'bid_adjustment',
      priority: 'high',
      title: '降低竞价以控制ACoS',
      description: `当前ACoS(${(performance.acos * 100).toFixed(1)}%)显著高于目标(${(targetAcos * 100).toFixed(1)}%)`,
      currentValue: performance.cpc,
      suggestedValue: performance.cpc * 0.8,
      expectedImpact: `预计ACoS降低${((1 - 0.8) * 100).toFixed(0)}%`,
      confidenceScore: 0.85,
      actionItems: [
        '降低关键词竞价10-20%',
        '暂停高花费低转化的关键词',
        '优化否定关键词列表'
      ]
    });
  }

  // CTR过低
  if (performance.ctr < 0.003) { // 0.3%
    suggestions.push({
      campaignId: performance.campaignId,
      suggestionType: 'creative_optimization',
      priority: 'high',
      title: '优化广告创意提升点击率',
      description: `当前点击率(${(performance.ctr * 100).toFixed(2)}%)低于行业平均水平`,
      expectedImpact: '预计点击率提升50%以上',
      confidenceScore: 0.8,
      actionItems: [
        '优化广告标题文案，突出产品卖点',
        '更换更吸引眼球的商品图片',
        '测试不同的品牌Logo展示',
        '如果是视频广告，优化视频前3秒内容'
      ]
    });
  }

  // 转化率过低
  if (performance.cvr < 0.05 && performance.clicks >= minClicks * 2) { // 5%
    suggestions.push({
      campaignId: performance.campaignId,
      suggestionType: 'keyword_optimization',
      priority: 'medium',
      title: '优化关键词提升转化率',
      description: `当前转化率(${(performance.cvr * 100).toFixed(2)}%)较低，可能存在关键词与产品不匹配的问题`,
      expectedImpact: '预计转化率提升30%以上',
      confidenceScore: 0.75,
      actionItems: [
        '分析搜索词报告，添加否定关键词',
        '将高转化搜索词添加为精确匹配关键词',
        '检查落地页是否与广告内容一致'
      ]
    });
  }

  // 绩效优秀，建议扩量
  if (acosRatio < 0.7 && performance.roas > 4) {
    suggestions.push({
      campaignId: performance.campaignId,
      suggestionType: 'budget_reallocation',
      priority: 'high',
      title: '增加预算以扩大优质流量',
      description: `当前广告活动ROAS(${performance.roas.toFixed(2)})表现优秀，建议增加预算获取更多转化`,
      expectedImpact: '预计销售额增加30%以上',
      confidenceScore: 0.9,
      actionItems: [
        '增加每日预算20-50%',
        '提高高绩效关键词的竞价',
        '扩展到更多相关关键词'
      ]
    });
  }

  // 视频广告特定建议
  if (performance.campaignType === 'video' && performance.videoViewRate !== undefined) {
    if (performance.videoViewRate < 0.5) { // 50%
      suggestions.push({
        campaignId: performance.campaignId,
        suggestionType: 'creative_optimization',
        priority: 'medium',
        title: '优化视频内容提升观看率',
        description: `视频观看率(${(performance.videoViewRate * 100).toFixed(1)}%)较低，建议优化视频内容`,
        expectedImpact: '预计视频观看率提升至60%以上',
        confidenceScore: 0.7,
        actionItems: [
          '优化视频前3秒，快速抓住用户注意力',
          '确保视频内容与产品高度相关',
          '添加清晰的行动号召(CTA)',
          '测试不同时长的视频版本'
        ]
      });
    }
  }

  return suggestions;
}

/**
 * 生成品牌广告关键词优化建议
 */
export async function generateSBKeywordSuggestions(
  campaignId: string,
  params: SBOptimizationParams = DEFAULT_SB_OPTIMIZATION_PARAMS
): Promise<SBKeywordSuggestion[]> {
  const dbInstance = await getDb();
  if (!dbInstance) return [];

  const suggestions: SBKeywordSuggestion[] = [];
  const { targetAcos, minClicks, minBid, maxBid, bidAdjustmentStep } = params;

  try {
    // 获取关键词绩效数据
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const keywordPerf = await dbInstance.execute(sql`
      SELECT 
        k.id,
        k.amazon_keyword_id as keywordId,
        k.keyword_text as keyword,
        k.match_type as matchType,
        k.bid,
        SUM(kp.impressions) as impressions,
        SUM(kp.clicks) as clicks,
        SUM(kp.cost) as cost,
        SUM(kp.sales) as sales,
        SUM(kp.orders) as orders
      FROM keywords k
      LEFT JOIN keyword_performance kp ON k.id = kp.keyword_id
      WHERE k.campaign_id = (SELECT id FROM campaigns WHERE amazon_campaign_id = ${campaignId})
        AND kp.date BETWEEN ${startDate} AND ${endDate}
      GROUP BY k.id, k.amazon_keyword_id, k.keyword_text, k.match_type, k.bid
      HAVING SUM(kp.clicks) >= ${minClicks / 2}
    `);

    for (const kw of keywordPerf as any[]) {
      const acos = kw.sales > 0 ? kw.cost / kw.sales : Infinity;
      const currentBid = Number(kw.bid) || 0.5;

      if (kw.orders === 0 && kw.clicks >= minClicks) {
        // 无转化，建议暂停
        suggestions.push({
          campaignId,
          keywordId: kw.keywordId,
          keyword: kw.keyword,
          matchType: kw.matchType,
          suggestionType: 'pause',
          currentBid,
          reason: `关键词"${kw.keyword}"在${kw.clicks}次点击后仍无转化，建议暂停`,
          performanceData: {
            impressions: Number(kw.impressions),
            clicks: Number(kw.clicks),
            cost: Number(kw.cost),
            sales: Number(kw.sales),
            acos
          }
        });
      } else if (acos > targetAcos * 1.5) {
        // ACoS过高，降低竞价
        const suggestedBid = Math.max(currentBid * (1 - bidAdjustmentStep), minBid);
        suggestions.push({
          campaignId,
          keywordId: kw.keywordId,
          keyword: kw.keyword,
          matchType: kw.matchType,
          suggestionType: 'decrease_bid',
          currentBid,
          suggestedBid,
          reason: `关键词ACoS(${(acos * 100).toFixed(1)}%)过高，建议降低竞价`,
          performanceData: {
            impressions: Number(kw.impressions),
            clicks: Number(kw.clicks),
            cost: Number(kw.cost),
            sales: Number(kw.sales),
            acos
          }
        });
      } else if (acos < targetAcos * 0.6 && kw.orders >= 3) {
        // ACoS很低，提高竞价
        const suggestedBid = Math.min(currentBid * (1 + bidAdjustmentStep), maxBid);
        suggestions.push({
          campaignId,
          keywordId: kw.keywordId,
          keyword: kw.keyword,
          matchType: kw.matchType,
          suggestionType: 'increase_bid',
          currentBid,
          suggestedBid,
          reason: `关键词绩效优秀(ACoS ${(acos * 100).toFixed(1)}%)，建议提高竞价获取更多流量`,
          performanceData: {
            impressions: Number(kw.impressions),
            clicks: Number(kw.clicks),
            cost: Number(kw.cost),
            sales: Number(kw.sales),
            acos
          }
        });
      }
    }

    return suggestions;
  } catch (error) {
    console.error('[sbOptimization] Error generating keyword suggestions:', error);
    return [];
  }
}

/**
 * 为账户生成所有品牌广告优化建议
 */
export async function generateAllSBOptimizations(
  accountId: string,
  params: SBOptimizationParams = DEFAULT_SB_OPTIMIZATION_PARAMS
): Promise<{
  campaignSuggestions: SBOptimizationSuggestion[];
  keywordSuggestions: SBKeywordSuggestion[];
}> {
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // 获取所有SB广告活动绩效
  const performanceData = await getSBCampaignPerformance(accountId, startDate, endDate);

  const campaignSuggestions: SBOptimizationSuggestion[] = [];
  const keywordSuggestions: SBKeywordSuggestion[] = [];

  for (const perf of performanceData) {
    // 生成广告活动级别建议
    const suggestions = analyzeSBPerformance(perf, params);
    campaignSuggestions.push(...suggestions);

    // 生成关键词级别建议
    const kwSuggestions = await generateSBKeywordSuggestions(perf.campaignId, params);
    keywordSuggestions.push(...kwSuggestions);
  }

  return { campaignSuggestions, keywordSuggestions };
}
