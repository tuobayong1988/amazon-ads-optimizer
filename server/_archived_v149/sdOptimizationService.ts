/**
 * SD展示广告优化服务
 * 
 * 支持展示广告的智能优化：
 * - 受众定向优化（浏览定向、购买定向、兴趣定向）
 * - 商品定向优化（ASIN定向、类目定向）
 * - 竞价策略优化
 * - 创意优化建议
 */

import { getDb } from "./db";
import { sql } from "drizzle-orm";

// 展示广告定向类型
export type SDAudienceType = 
  | 'views_remarketing'      // 浏览再营销
  | 'purchases_remarketing'  // 购买再营销
  | 'similar_products'       // 相似商品
  | 'category_targeting'     // 类目定向
  | 'asin_targeting'         // ASIN定向
  | 'audience_interests';    // 兴趣定向

// 展示广告计费方式
export type SDBillingType = 'CPC' | 'vCPM';

// 展示广告优化参数
export interface SDOptimizationParams {
  targetAcos: number;
  targetRoas: number;
  minBid: number;
  maxBid: number;
  minClicks: number;
  minImpressions: number;
  bidAdjustmentStep: number;
  maxBidAdjustment: number;
  viewThroughAttributionWindow: number; // 浏览归因窗口（天）
}

// 默认优化参数
export const DEFAULT_SD_OPTIMIZATION_PARAMS: SDOptimizationParams = {
  targetAcos: 0.35,             // 35% ACoS (展示广告通常ACoS更高)
  targetRoas: 2.5,              // 2.5x ROAS
  minBid: 0.15,                 // $0.15
  maxBid: 10.00,                // $10.00
  minClicks: 20,                // 20次点击
  minImpressions: 5000,         // 5000次展示
  bidAdjustmentStep: 0.10,      // 10%
  maxBidAdjustment: 0.40,       // 40%
  viewThroughAttributionWindow: 14 // 14天
};

// 展示广告绩效数据
export interface SDPerformanceData {
  campaignId: string;
  audienceType: SDAudienceType;
  billingType: SDBillingType;
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
  viewThroughSales: number;      // 浏览归因销售额
  viewThroughOrders: number;     // 浏览归因订单数
  totalAttributedSales: number;  // 总归因销售额
  dpvr: number;                  // 详情页浏览率
  reach: number;                 // 触达人数
  frequency: number;             // 频次
}

// 展示广告优化建议
export interface SDOptimizationSuggestion {
  campaignId: string;
  audienceType?: SDAudienceType;
  suggestionType: 'bid_adjustment' | 'audience_optimization' | 'creative_optimization' | 'targeting_expansion' | 'billing_change';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  currentValue?: number;
  suggestedValue?: number;
  expectedImpact: string;
  confidenceScore: number;
  actionItems: string[];
}

// 受众定向优化建议
export interface SDAudienceSuggestion {
  campaignId: string;
  audienceId?: string;
  audienceType: SDAudienceType;
  audienceName: string;
  suggestionType: 'add' | 'pause' | 'increase_bid' | 'decrease_bid';
  currentBid?: number;
  suggestedBid?: number;
  reason: string;
  performanceData?: {
    impressions: number;
    clicks: number;
    cost: number;
    sales: number;
    acos: number;
    viewThroughSales: number;
  };
}

/**
 * 获取展示广告绩效数据
 */
export async function getSDCampaignPerformance(
  accountId: string,
  startDate: string,
  endDate: string
): Promise<SDPerformanceData[]> {
  const dbInstance = await getDb();
  if (!dbInstance) return [];

  try {
    const results = await dbInstance.execute(sql`
      SELECT 
        c.amazon_campaign_id as campaignId,
        c.cost_type as billingType,
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
        AND c.ad_type = 'SD'
        AND dp.date BETWEEN ${startDate} AND ${endDate}
      GROUP BY c.amazon_campaign_id, c.cost_type
    `);

    return (results as any[]).map(row => ({
      campaignId: row.campaignId,
      audienceType: 'views_remarketing' as SDAudienceType, // 默认值
      billingType: (row.billingType || 'CPC') as SDBillingType,
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
      viewThroughSales: 0,
      viewThroughOrders: 0,
      totalAttributedSales: Number(row.sales) || 0,
      dpvr: 0,
      reach: 0,
      frequency: 0
    }));
  } catch (error) {
    console.error('[sdOptimization] Error getting performance:', error);
    return [];
  }
}

/**
 * 分析展示广告绩效并生成优化建议
 */
export function analyzeSDPerformance(
  performance: SDPerformanceData,
  params: SDOptimizationParams = DEFAULT_SD_OPTIMIZATION_PARAMS
): SDOptimizationSuggestion[] {
  const suggestions: SDOptimizationSuggestion[] = [];
  const { targetAcos, targetRoas, minClicks, minImpressions } = params;

  // 数据不足
  if (performance.impressions < minImpressions) {
    suggestions.push({
      campaignId: performance.campaignId,
      suggestionType: 'targeting_expansion',
      priority: 'medium',
      title: '扩大受众定向范围',
      description: `当前广告活动展示量不足(${performance.impressions}次)，建议扩大受众定向范围`,
      expectedImpact: '预计展示量增加100%以上',
      confidenceScore: 0.7,
      actionItems: [
        '添加更多受众定向类型',
        '扩展商品定向范围',
        '考虑添加类目定向'
      ]
    });
    return suggestions;
  }

  // 考虑浏览归因的总销售额
  const totalSales = performance.totalAttributedSales || performance.sales;
  const effectiveAcos = performance.cost > 0 && totalSales > 0 ? performance.cost / totalSales : performance.acos;
  const effectiveRoas = performance.cost > 0 ? totalSales / performance.cost : performance.roas;

  // ACoS过高
  if (effectiveAcos > targetAcos * 1.5 && performance.clicks >= minClicks) {
    suggestions.push({
      campaignId: performance.campaignId,
      suggestionType: 'bid_adjustment',
      priority: 'high',
      title: '降低竞价以控制ACoS',
      description: `当前有效ACoS(${(effectiveAcos * 100).toFixed(1)}%)显著高于目标(${(targetAcos * 100).toFixed(1)}%)`,
      currentValue: performance.cpc,
      suggestedValue: performance.cpc * 0.8,
      expectedImpact: `预计ACoS降低20%`,
      confidenceScore: 0.85,
      actionItems: [
        '降低受众定向竞价10-20%',
        '暂停高花费低转化的受众',
        '优化否定商品定向列表'
      ]
    });
  }

  // CTR过低（展示广告CTR通常较低）
  if (performance.ctr < 0.001) { // 0.1%
    suggestions.push({
      campaignId: performance.campaignId,
      suggestionType: 'creative_optimization',
      priority: 'high',
      title: '优化广告创意提升点击率',
      description: `当前点击率(${(performance.ctr * 100).toFixed(3)}%)显著低于行业平均水平`,
      expectedImpact: '预计点击率提升100%以上',
      confidenceScore: 0.8,
      actionItems: [
        '使用更吸引眼球的商品图片',
        '添加促销信息或折扣标签',
        '测试不同的广告创意组合',
        '确保广告与目标受众相关'
      ]
    });
  }

  // 详情页浏览率过低
  if (performance.dpvr > 0 && performance.dpvr < 0.5) { // 50%
    suggestions.push({
      campaignId: performance.campaignId,
      suggestionType: 'creative_optimization',
      priority: 'medium',
      title: '优化落地页提升详情页浏览率',
      description: `详情页浏览率(${(performance.dpvr * 100).toFixed(1)}%)较低，用户点击后未查看商品详情`,
      expectedImpact: '预计详情页浏览率提升至70%以上',
      confidenceScore: 0.75,
      actionItems: [
        '确保广告商品与用户期望一致',
        '优化商品详情页内容',
        '检查商品价格竞争力'
      ]
    });
  }

  // 频次过高
  if (performance.frequency > 10) {
    suggestions.push({
      campaignId: performance.campaignId,
      suggestionType: 'audience_optimization',
      priority: 'medium',
      title: '控制广告频次避免用户疲劳',
      description: `当前广告频次(${performance.frequency.toFixed(1)})过高，可能导致用户疲劳`,
      expectedImpact: '预计广告效果提升，用户体验改善',
      confidenceScore: 0.7,
      actionItems: [
        '扩大受众范围降低频次',
        '设置频次上限',
        '轮换广告创意'
      ]
    });
  }

  // 绩效优秀，建议扩量
  if (effectiveRoas > targetRoas * 1.5 && performance.orders >= 5) {
    suggestions.push({
      campaignId: performance.campaignId,
      suggestionType: 'targeting_expansion',
      priority: 'high',
      title: '扩大优质受众定向',
      description: `当前广告活动ROAS(${effectiveRoas.toFixed(2)})表现优秀，建议扩大受众定向`,
      expectedImpact: '预计销售额增加40%以上',
      confidenceScore: 0.85,
      actionItems: [
        '增加相似受众定向',
        '扩展到更多相关商品定向',
        '提高高绩效受众的竞价'
      ]
    });
  }

  // 建议切换计费方式
  if (performance.billingType === 'CPC' && performance.ctr < 0.002 && performance.impressions > minImpressions * 2) {
    suggestions.push({
      campaignId: performance.campaignId,
      suggestionType: 'billing_change',
      priority: 'low',
      title: '考虑切换到vCPM计费',
      description: `当前点击率较低，使用vCPM计费可能更具成本效益`,
      expectedImpact: '预计每千次展示成本降低',
      confidenceScore: 0.6,
      actionItems: [
        '评估品牌曝光目标',
        '测试vCPM计费效果',
        '对比两种计费方式的ROI'
      ]
    });
  }

  return suggestions;
}

/**
 * 生成受众定向优化建议
 */
export async function generateSDAudienceSuggestions(
  campaignId: string,
  params: SDOptimizationParams = DEFAULT_SD_OPTIMIZATION_PARAMS
): Promise<SDAudienceSuggestion[]> {
  const dbInstance = await getDb();
  if (!dbInstance) return [];

  const suggestions: SDAudienceSuggestion[] = [];
  const { targetAcos, minClicks, minBid, maxBid, bidAdjustmentStep } = params;

  try {
    // 获取受众定向绩效数据
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const audiencePerf = await dbInstance.execute(sql`
      SELECT 
        sa.id,
        sa.audience_type as audienceType,
        sa.audience_name as audienceName,
        sa.bid,
        SUM(ap.impressions) as impressions,
        SUM(ap.clicks) as clicks,
        SUM(ap.cost) as cost,
        SUM(ap.sales) as sales,
        SUM(ap.orders) as orders,
        SUM(ap.view_through_sales) as viewThroughSales
      FROM sd_audience_settings sa
      LEFT JOIN sd_audience_performance ap ON sa.id = ap.audience_id
      WHERE sa.campaign_id = (SELECT id FROM campaigns WHERE amazon_campaign_id = ${campaignId})
        AND ap.date BETWEEN ${startDate} AND ${endDate}
      GROUP BY sa.id, sa.audience_type, sa.audience_name, sa.bid
      HAVING SUM(ap.impressions) >= ${params.minImpressions / 2}
    `);

    for (const aud of audiencePerf as any[]) {
      const totalSales = Number(aud.sales) + Number(aud.viewThroughSales || 0);
      const acos = totalSales > 0 ? Number(aud.cost) / totalSales : Infinity;
      const currentBid = Number(aud.bid) || 0.5;

      if (aud.orders === 0 && aud.clicks >= minClicks) {
        // 无转化，建议暂停
        suggestions.push({
          campaignId,
          audienceId: String(aud.id),
          audienceType: aud.audienceType as SDAudienceType,
          audienceName: aud.audienceName,
          suggestionType: 'pause',
          currentBid,
          reason: `受众"${aud.audienceName}"在${aud.clicks}次点击后仍无转化，建议暂停`,
          performanceData: {
            impressions: Number(aud.impressions),
            clicks: Number(aud.clicks),
            cost: Number(aud.cost),
            sales: Number(aud.sales),
            acos,
            viewThroughSales: Number(aud.viewThroughSales || 0)
          }
        });
      } else if (acos > targetAcos * 1.5) {
        // ACoS过高，降低竞价
        const suggestedBid = Math.max(currentBid * (1 - bidAdjustmentStep), minBid);
        suggestions.push({
          campaignId,
          audienceId: String(aud.id),
          audienceType: aud.audienceType as SDAudienceType,
          audienceName: aud.audienceName,
          suggestionType: 'decrease_bid',
          currentBid,
          suggestedBid,
          reason: `受众ACoS(${(acos * 100).toFixed(1)}%)过高，建议降低竞价`,
          performanceData: {
            impressions: Number(aud.impressions),
            clicks: Number(aud.clicks),
            cost: Number(aud.cost),
            sales: Number(aud.sales),
            acos,
            viewThroughSales: Number(aud.viewThroughSales || 0)
          }
        });
      } else if (acos < targetAcos * 0.6 && aud.orders >= 3) {
        // ACoS很低，提高竞价
        const suggestedBid = Math.min(currentBid * (1 + bidAdjustmentStep), maxBid);
        suggestions.push({
          campaignId,
          audienceId: String(aud.id),
          audienceType: aud.audienceType as SDAudienceType,
          audienceName: aud.audienceName,
          suggestionType: 'increase_bid',
          currentBid,
          suggestedBid,
          reason: `受众绩效优秀(ACoS ${(acos * 100).toFixed(1)}%)，建议提高竞价获取更多流量`,
          performanceData: {
            impressions: Number(aud.impressions),
            clicks: Number(aud.clicks),
            cost: Number(aud.cost),
            sales: Number(aud.sales),
            acos,
            viewThroughSales: Number(aud.viewThroughSales || 0)
          }
        });
      }
    }

    return suggestions;
  } catch (error) {
    console.error('[sdOptimization] Error generating audience suggestions:', error);
    return [];
  }
}

/**
 * 为账户生成所有展示广告优化建议
 */
export async function generateAllSDOptimizations(
  accountId: string,
  params: SDOptimizationParams = DEFAULT_SD_OPTIMIZATION_PARAMS
): Promise<{
  campaignSuggestions: SDOptimizationSuggestion[];
  audienceSuggestions: SDAudienceSuggestion[];
}> {
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // 获取所有SD广告活动绩效
  const performanceData = await getSDCampaignPerformance(accountId, startDate, endDate);

  const campaignSuggestions: SDOptimizationSuggestion[] = [];
  const audienceSuggestions: SDAudienceSuggestion[] = [];

  for (const perf of performanceData) {
    // 生成广告活动级别建议
    const suggestions = analyzeSDPerformance(perf, params);
    campaignSuggestions.push(...suggestions);

    // 生成受众级别建议
    const audSuggestions = await generateSDAudienceSuggestions(perf.campaignId, params);
    audienceSuggestions.push(...audSuggestions);
  }

  return { campaignSuggestions, audienceSuggestions };
}
