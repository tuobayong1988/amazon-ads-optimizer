/**
 * 高级位置优化服务
 * 整合智能优化三大核心算法：市场曲线、决策树、利润最大化
 * 
 * 核心策略（来自智能优化）：
 * - 在竞价对象层面（关键词/ASIN）设置精确的基础出价
 * - 将展示位置调整设置为较低值（0-50%），以便更细致地控制
 * - 广告利润 = 收入 - 广告支出 = Clicks × (CVR × AOV - CPC)
 */

import { getDb } from "./db";
import { 
  bidObjectProfitEstimates,
  optimizationRecommendations,
  marketCurveModels,
  keywordPredictions,
  placementPerformance,
  placementSettings,
  keywords,
  campaigns
} from "../drizzle/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";

// 获取db实例的辅助函数
async function getDbInstance() {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  return db;
}

import {
  buildMarketCurveForKeyword,
  getMarketCurveModel,
  calculateProfit,
  generateProfitCurveData,
  type MarketCurveResult,
  type ImpressionCurveParams,
  type CTRCurveParams,
  type ConversionParams
} from "./marketCurveService";

import {
  predictKeywordPerformance,
  type KeywordFeatures,
  type PredictionResult
} from "./decisionTreeService";

import {
  calculateEfficiencyScore,
  type PlacementType,
  type PlacementEfficiencyScore
} from "./placementOptimizationService";

// ==================== 类型定义 ====================

export interface BidObjectProfitAnalysis {
  bidObjectType: 'keyword' | 'asin';
  bidObjectId: string;
  bidObjectText: string;
  
  // 当前状态
  currentBaseBid: number;
  currentTopAdjustment: number;
  currentProductAdjustment: number;
  
  // 各位置的有效出价
  effectiveBidTop: number;
  effectiveBidProduct: number;
  effectiveBidRest: number;
  
  // 各位置的利润估算
  estimatedProfitTop: number;
  estimatedProfitProduct: number;
  estimatedProfitRest: number;
  totalEstimatedProfit: number;
  
  // 推荐值
  recommendedBaseBid: number;
  recommendedTopAdjustment: number;
  recommendedProductAdjustment: number;
  
  // 优化潜力
  profitImprovementPotential: number;
  profitImprovementPercent: number;
  
  // 市场曲线数据
  marketCurve?: MarketCurveResult;
  
  // 预测数据
  prediction?: PredictionResult;
  
  // 置信度
  confidence: number;
}

export interface PlacementProfitOptimization {
  campaignId: string;
  campaignName?: string;
  
  // 汇总数据
  totalBidObjects: number;
  totalCurrentProfit: number;
  totalOptimizedProfit: number;
  totalProfitImprovement: number;
  
  // 各位置的汇总
  placementSummary: {
    topOfSearch: PlacementSummary;
    productPage: PlacementSummary;
    restOfSearch: PlacementSummary;
  };
  
  // 推荐的位置调整
  recommendedAdjustments: {
    topOfSearch: number;
    productPage: number;
  };
  
  // 详细的竞价对象分析
  bidObjectAnalyses: BidObjectProfitAnalysis[];
  
  // 优化建议
  recommendations: OptimizationRecommendation[];
}

interface PlacementSummary {
  totalSpend: number;
  totalRevenue: number;
  totalProfit: number;
  avgROAS: number;
  avgACoS: number;
  efficiency: number;
  recommendedWeight: number;
}

interface OptimizationRecommendation {
  type: 'bid_adjustment' | 'placement_adjustment' | 'budget_reallocation' | 'data_collection';
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  expectedImpact: string;
  currentValue: any;
  recommendedValue: any;
  expectedProfitChange: number;
}

// ==================== 核心算法实现 ====================

/**
 * 计算竞价对象在各位置的有效出价
 * 有效出价 = 基础出价 × (1 + 位置调整%)
 */
export function calculateEffectiveBids(
  baseBid: number,
  topAdjustment: number,
  productAdjustment: number
): { top: number; product: number; rest: number } {
  return {
    top: baseBid * (1 + topAdjustment / 100),
    product: baseBid * (1 + productAdjustment / 100),
    rest: baseBid // rest位置没有调整
  };
}

/**
 * 估算各位置的利润
 * Profit = Clicks × (CVR × AOV - CPC)
 */
export function estimatePlacementProfit(
  effectiveBid: number,
  impressions: number,
  ctr: number,
  cvr: number,
  aov: number
): { clicks: number; spend: number; revenue: number; profit: number } {
  const clicks = impressions * ctr;
  const spend = clicks * effectiveBid;
  const orders = clicks * cvr;
  const revenue = orders * aov;
  const profit = revenue - spend;
  
  return {
    clicks: Math.round(clicks),
    spend: Math.round(spend * 100) / 100,
    revenue: Math.round(revenue * 100) / 100,
    profit: Math.round(profit * 100) / 100
  };
}

/**
 * 计算最优基础出价（基于市场曲线）
 * 使用利润最大化公式
 */
export function calculateOptimalBaseBid(
  cvr: number,
  aov: number,
  targetProfitMargin: number = 0.3
): number {
  // 盈亏平衡CPC = CVR × AOV
  const breakEvenCPC = cvr * aov;
  
  // 最优出价 = 盈亏平衡CPC × (1 - 目标利润率)
  const optimalBid = breakEvenCPC * (1 - targetProfitMargin);
  
  return Math.round(optimalBid * 100) / 100;
}

/**
 * 计算最优位置调整（智能优化策略：设置较低值）
 * 
 * 智能优化的核心洞察：
 * - 在竞价对象层面设置精确的基础出价
 * - 位置调整设置较低值（0-50%），让基础出价更精确地控制实际竞价
 */
export function calculateOptimalPlacementAdjustments(
  placementEfficiencies: {
    top: number;
    product: number;
    rest: number;
  },
  maxAdjustment: number = 50 // 智能优化策略：较低的最大调整值
): { topAdjustment: number; productAdjustment: number } {
  // 找出效率最高的位置
  const maxEfficiency = Math.max(
    placementEfficiencies.top,
    placementEfficiencies.product,
    placementEfficiencies.rest
  );
  
  // 归一化效率分数
  const topNorm = placementEfficiencies.top / maxEfficiency;
  const productNorm = placementEfficiencies.product / maxEfficiency;
  
  // 计算调整值
  // 效率越高，调整越大，但限制在较低范围内
  let topAdjustment = Math.round((topNorm - 0.5) * maxAdjustment * 2);
  let productAdjustment = Math.round((productNorm - 0.5) * maxAdjustment * 2);
  
  // 限制在0-50%范围内（智能优化策略）
  topAdjustment = Math.max(0, Math.min(maxAdjustment, topAdjustment));
  productAdjustment = Math.max(0, Math.min(maxAdjustment, productAdjustment));
  
  return { topAdjustment, productAdjustment };
}

/**
 * 分析单个竞价对象的利润
 */
export async function analyzeBidObjectProfit(
  accountId: number,
  campaignId: string,
  bidObjectType: 'keyword' | 'asin',
  bidObjectId: string,
  bidObjectText: string,
  currentBaseBid: number,
  currentTopAdjustment: number = 0,
  currentProductAdjustment: number = 0,
  placementData?: {
    top: { impressions: number; ctr: number };
    product: { impressions: number; ctr: number };
    rest: { impressions: number; ctr: number };
  }
): Promise<BidObjectProfitAnalysis> {
  // 1. 获取或构建市场曲线模型
  let marketCurve = await getMarketCurveModel(accountId, bidObjectType, bidObjectId);
  
  if (!marketCurve && bidObjectType === 'keyword') {
    // 尝试构建新模型
    marketCurve = await buildMarketCurveForKeyword(
      accountId,
      campaignId,
      parseInt(bidObjectId)
    );
  }
  
  // 2. 获取决策树预测
  let prediction: PredictionResult | undefined;
  if (bidObjectType === 'keyword') {
    const wordCount = bidObjectText.split(' ').length;
    let keywordType: 'brand' | 'competitor' | 'generic' | 'product' = 'generic';
    const text = bidObjectText.toLowerCase();
    if (text.includes('brand') || text.includes('official')) {
      keywordType = 'brand';
    } else if (wordCount >= 4) {
      keywordType = 'product';
    }
    
    const features: KeywordFeatures = {
      matchType: 'broad', // 默认
      wordCount,
      keywordType,
      avgBid: currentBaseBid
    };
    
    prediction = await predictKeywordPerformance(accountId, features);
  }
  
  // 3. 确定CVR和AOV
  const cvr = prediction?.predictedCR || marketCurve?.conversion.cvr || 0.05;
  const aov = prediction?.predictedCV || marketCurve?.conversion.aov || 30;
  
  // 4. 计算当前有效出价
  const currentEffectiveBids = calculateEffectiveBids(
    currentBaseBid,
    currentTopAdjustment,
    currentProductAdjustment
  );
  
  // 5. 使用默认位置数据或实际数据
  const defaultPlacementData = {
    top: { impressions: 1000, ctr: 0.03 },
    product: { impressions: 800, ctr: 0.02 },
    rest: { impressions: 500, ctr: 0.015 }
  };
  const placement = placementData || defaultPlacementData;
  
  // 6. 估算当前各位置利润
  const currentProfitTop = estimatePlacementProfit(
    currentEffectiveBids.top,
    placement.top.impressions,
    placement.top.ctr,
    cvr,
    aov
  );
  
  const currentProfitProduct = estimatePlacementProfit(
    currentEffectiveBids.product,
    placement.product.impressions,
    placement.product.ctr,
    cvr,
    aov
  );
  
  const currentProfitRest = estimatePlacementProfit(
    currentEffectiveBids.rest,
    placement.rest.impressions,
    placement.rest.ctr,
    cvr,
    aov
  );
  
  const totalCurrentProfit = 
    currentProfitTop.profit + 
    currentProfitProduct.profit + 
    currentProfitRest.profit;
  
  // 7. 计算最优基础出价
  const recommendedBaseBid = marketCurve?.optimalBid || calculateOptimalBaseBid(cvr, aov);
  
  // 8. 计算各位置效率
  const placementEfficiencies = {
    top: currentProfitTop.profit > 0 ? currentProfitTop.revenue / currentProfitTop.spend : 0,
    product: currentProfitProduct.profit > 0 ? currentProfitProduct.revenue / currentProfitProduct.spend : 0,
    rest: currentProfitRest.profit > 0 ? currentProfitRest.revenue / currentProfitRest.spend : 0
  };
  
  // 9. 计算最优位置调整（智能优化策略：较低值）
  const { topAdjustment: recommendedTopAdjustment, productAdjustment: recommendedProductAdjustment } = 
    calculateOptimalPlacementAdjustments(placementEfficiencies);
  
  // 10. 计算优化后的利润
  const optimizedEffectiveBids = calculateEffectiveBids(
    recommendedBaseBid,
    recommendedTopAdjustment,
    recommendedProductAdjustment
  );
  
  const optimizedProfitTop = estimatePlacementProfit(
    optimizedEffectiveBids.top,
    placement.top.impressions,
    placement.top.ctr,
    cvr,
    aov
  );
  
  const optimizedProfitProduct = estimatePlacementProfit(
    optimizedEffectiveBids.product,
    placement.product.impressions,
    placement.product.ctr,
    cvr,
    aov
  );
  
  const optimizedProfitRest = estimatePlacementProfit(
    optimizedEffectiveBids.rest,
    placement.rest.impressions,
    placement.rest.ctr,
    cvr,
    aov
  );
  
  const totalOptimizedProfit = 
    optimizedProfitTop.profit + 
    optimizedProfitProduct.profit + 
    optimizedProfitRest.profit;
  
  // 11. 计算优化潜力
  const profitImprovementPotential = totalOptimizedProfit - totalCurrentProfit;
  const profitImprovementPercent = totalCurrentProfit !== 0 
    ? profitImprovementPotential / Math.abs(totalCurrentProfit) 
    : 0;
  
  // 12. 计算置信度
  const confidence = Math.min(
    marketCurve?.confidence || 0.5,
    prediction?.confidence || 0.5
  );
  
  return {
    bidObjectType,
    bidObjectId,
    bidObjectText,
    currentBaseBid,
    currentTopAdjustment,
    currentProductAdjustment,
    effectiveBidTop: currentEffectiveBids.top,
    effectiveBidProduct: currentEffectiveBids.product,
    effectiveBidRest: currentEffectiveBids.rest,
    estimatedProfitTop: currentProfitTop.profit,
    estimatedProfitProduct: currentProfitProduct.profit,
    estimatedProfitRest: currentProfitRest.profit,
    totalEstimatedProfit: totalCurrentProfit,
    recommendedBaseBid,
    recommendedTopAdjustment,
    recommendedProductAdjustment,
    profitImprovementPotential,
    profitImprovementPercent,
    marketCurve: marketCurve || undefined,
    prediction,
    confidence
  };
}

/**
 * 分析广告活动的位置利润优化
 */
export async function analyzeCampaignPlacementProfit(
  accountId: number,
  campaignId: string
): Promise<PlacementProfitOptimization> {
  const db = await getDbInstance();
  // 1. 获取广告活动信息
  const campaignData = await db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.campaignId, campaignId),
        eq(campaigns.accountId, accountId)
      )
    )
    .limit(1);
  
  const campaignName = campaignData[0]?.campaignName || campaignId;
  
  // 2. 获取广告活动下的所有关键词
  const campaignKeywords = await db
    .select()
    .from(keywords)
    .where(eq(keywords.keywordStatus, 'enabled'))
    .limit(100);
  
  // 3. 获取位置表现数据
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);
  
  const placementData = await db
    .select()
    .from(placementPerformance)
    .where(
      and(
        eq(placementPerformance.campaignId, campaignId),
        eq(placementPerformance.accountId, accountId),
        gte(placementPerformance.date, startDate.toISOString().split('T')[0])
      )
    );
  
  // 4. 聚合位置数据
  const placementAggregates: Record<string, {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
  }> = {
    top_of_search: { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 },
    product_page: { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 },
    rest_of_search: { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 }
  };
  
  for (const row of placementData) {
    const placement = row.placement;
    if (placementAggregates[placement]) {
      placementAggregates[placement].impressions += row.impressions || 0;
      placementAggregates[placement].clicks += row.clicks || 0;
      placementAggregates[placement].spend += Number(row.spend) || 0;
      placementAggregates[placement].sales += Number(row.sales) || 0;
      placementAggregates[placement].orders += row.orders || 0;
    }
  }
  
  // 5. 分析每个关键词
  const bidObjectAnalyses: BidObjectProfitAnalysis[] = [];
  
  for (const kw of campaignKeywords.slice(0, 50)) { // 限制分析数量
    const analysis = await analyzeBidObjectProfit(
      accountId,
      campaignId,
      'keyword',
      String(kw.id),
      kw.keywordText,
      Number(kw.bid) || 1,
      0, // 当前位置调整（需要从设置中获取）
      0
    );
    bidObjectAnalyses.push(analysis);
  }
  
  // 6. 计算汇总数据
  const totalCurrentProfit = bidObjectAnalyses.reduce((sum, a) => sum + a.totalEstimatedProfit, 0);
  const totalOptimizedProfit = bidObjectAnalyses.reduce((sum, a) => 
    sum + a.totalEstimatedProfit + a.profitImprovementPotential, 0);
  
  // 7. 计算各位置汇总
  const calculatePlacementSummary = (data: typeof placementAggregates.top_of_search): PlacementSummary => {
    const revenue = data.sales;
    const spend = data.spend;
    const profit = revenue - spend;
    const roas = spend > 0 ? revenue / spend : 0;
    const acos = revenue > 0 ? spend / revenue : 1;
    const efficiency = roas;
    
    return {
      totalSpend: spend,
      totalRevenue: revenue,
      totalProfit: profit,
      avgROAS: roas,
      avgACoS: acos,
      efficiency,
      recommendedWeight: 0 // 将在后面计算
    };
  };
  
  const placementSummary = {
    topOfSearch: calculatePlacementSummary(placementAggregates.top_of_search),
    productPage: calculatePlacementSummary(placementAggregates.product_page),
    restOfSearch: calculatePlacementSummary(placementAggregates.rest_of_search)
  };
  
  // 计算推荐权重
  const totalEfficiency = 
    placementSummary.topOfSearch.efficiency + 
    placementSummary.productPage.efficiency + 
    placementSummary.restOfSearch.efficiency;
  
  if (totalEfficiency > 0) {
    placementSummary.topOfSearch.recommendedWeight = placementSummary.topOfSearch.efficiency / totalEfficiency;
    placementSummary.productPage.recommendedWeight = placementSummary.productPage.efficiency / totalEfficiency;
    placementSummary.restOfSearch.recommendedWeight = placementSummary.restOfSearch.efficiency / totalEfficiency;
  }
  
  // 8. 计算推荐的位置调整（智能优化策略）
  const placementEfficiencies = {
    top: placementSummary.topOfSearch.efficiency,
    product: placementSummary.productPage.efficiency,
    rest: placementSummary.restOfSearch.efficiency
  };
  
  const { topAdjustment, productAdjustment } = calculateOptimalPlacementAdjustments(placementEfficiencies);
  
  // 9. 生成优化建议
  const recommendations: OptimizationRecommendation[] = [];
  
  // 位置调整建议
  if (topAdjustment > 0 || productAdjustment > 0) {
    recommendations.push({
      type: 'placement_adjustment',
      priority: 'high',
      title: '优化展示位置调整',
      description: `基于智能优化策略，建议将搜索顶部调整设为${topAdjustment}%，商品详情页调整设为${productAdjustment}%。较低的位置调整值可以让基础出价更精确地控制实际竞价。`,
      expectedImpact: `预计提升利润${Math.round(totalOptimizedProfit - totalCurrentProfit)}美元`,
      currentValue: { topOfSearch: 0, productPage: 0 },
      recommendedValue: { topOfSearch: topAdjustment, productPage: productAdjustment },
      expectedProfitChange: totalOptimizedProfit - totalCurrentProfit
    });
  }
  
  // 出价调整建议
  const bidImprovements = bidObjectAnalyses.filter(a => a.profitImprovementPercent > 0.1);
  if (bidImprovements.length > 0) {
    recommendations.push({
      type: 'bid_adjustment',
      priority: 'medium',
      title: `优化${bidImprovements.length}个关键词的基础出价`,
      description: `发现${bidImprovements.length}个关键词的当前出价偏离最优值，调整后可提升利润。`,
      expectedImpact: `预计提升利润${Math.round(bidImprovements.reduce((sum, a) => sum + a.profitImprovementPotential, 0))}美元`,
      currentValue: bidImprovements.map(a => ({ id: a.bidObjectId, bid: a.currentBaseBid })),
      recommendedValue: bidImprovements.map(a => ({ id: a.bidObjectId, bid: a.recommendedBaseBid })),
      expectedProfitChange: bidImprovements.reduce((sum, a) => sum + a.profitImprovementPotential, 0)
    });
  }
  
  // 数据收集建议
  const lowConfidenceCount = bidObjectAnalyses.filter(a => a.confidence < 0.5).length;
  if (lowConfidenceCount > bidObjectAnalyses.length * 0.3) {
    recommendations.push({
      type: 'data_collection',
      priority: 'low',
      title: '收集更多数据以提高预测准确性',
      description: `${lowConfidenceCount}个关键词的数据置信度较低，建议保持当前出价一段时间以收集更多数据。`,
      expectedImpact: '提高后续优化建议的准确性',
      currentValue: { lowConfidenceCount },
      recommendedValue: { targetConfidence: 0.7 },
      expectedProfitChange: 0
    });
  }
  
  return {
    campaignId,
    campaignName,
    totalBidObjects: bidObjectAnalyses.length,
    totalCurrentProfit,
    totalOptimizedProfit,
    totalProfitImprovement: totalOptimizedProfit - totalCurrentProfit,
    placementSummary,
    recommendedAdjustments: {
      topOfSearch: topAdjustment,
      productPage: productAdjustment
    },
    bidObjectAnalyses,
    recommendations
  };
}

/**
 * 保存优化建议到数据库
 */
export async function saveOptimizationRecommendations(
  accountId: number,
  campaignId: string,
  recommendations: OptimizationRecommendation[]
): Promise<void> {
  const db = await getDbInstance();
  for (const rec of recommendations) {
    await db.insert(optimizationRecommendations).values({
      accountId,
      campaignId,
      recommendationType: rec.type,
      priority: rec.priority,
      title: rec.title,
      description: rec.description,
      expectedImpact: rec.expectedImpact,
      currentValue: rec.currentValue,
      recommendedValue: rec.recommendedValue,
      expectedProfitChange: String(rec.expectedProfitChange),
      status: 'pending',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ') // 7天后过期
    });
  }
}

/**
 * 应用优化建议
 */
export async function applyOptimizationRecommendation(
  recommendationId: number,
  userId: number
): Promise<{ success: boolean; message: string }> {
  const db = await getDbInstance();
  const recommendation = await db
    .select()
    .from(optimizationRecommendations)
    .where(eq(optimizationRecommendations.id, recommendationId))
    .limit(1);
  
  if (recommendation.length === 0) {
    return { success: false, message: '未找到优化建议' };
  }
  
  const rec = recommendation[0];
  
  if (rec.status !== 'pending') {
    return { success: false, message: '该建议已被处理' };
  }
  
  try {
    // 根据建议类型执行不同的操作
    switch (rec.recommendationType) {
      case 'placement_adjustment':
        // 更新位置调整设置
        const adjustmentValues = rec.recommendedValue as { topOfSearch: number; productPage: number };
        await db
          .update(placementSettings)
          .set({
            topOfSearchAdjustment: adjustmentValues.topOfSearch,
            productPageAdjustment: adjustmentValues.productPage,
            lastAdjustedAt: new Date().toISOString().slice(0, 19).replace('T', ' ')
          })
          .where(
            and(
              eq(placementSettings.campaignId, rec.campaignId!),
              eq(placementSettings.accountId, rec.accountId)
            )
          );
        break;
      
      case 'bid_adjustment':
        // 更新关键词出价
        const bidValues = rec.recommendedValue as Array<{ id: string; bid: number }>;
        for (const bv of bidValues) {
          await db
            .update(keywords)
            .set({ bid: String(bv.bid) })
            .where(eq(keywords.id, parseInt(bv.id)));
        }
        break;
      
      default:
        // 其他类型暂不自动执行
        break;
    }
    
    // 更新建议状态
    await db
      .update(optimizationRecommendations)
      .set({
        status: 'applied',
        appliedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        appliedBy: userId
      })
      .where(eq(optimizationRecommendations.id, recommendationId));
    
    return { success: true, message: '优化建议已成功应用' };
  } catch (error) {
    return { 
      success: false, 
      message: `应用失败: ${error instanceof Error ? error.message : '未知错误'}` 
    };
  }
}

/**
 * 获取待处理的优化建议
 */
export async function getPendingRecommendations(
  accountId: number,
  campaignId?: string
): Promise<Array<{
  id: number;
  type: string;
  priority: string;
  title: string;
  description: string;
  expectedProfitChange: number;
  createdAt: string;
}>> {
  const db = await getDbInstance();
  let query = db
    .select()
    .from(optimizationRecommendations)
    .where(
      and(
        eq(optimizationRecommendations.accountId, accountId),
        eq(optimizationRecommendations.status, 'pending')
      )
    )
    .orderBy(desc(optimizationRecommendations.createdAt));
  
  const results = await query;
  
  return results
    .filter(r => !campaignId || r.campaignId === campaignId)
    .map(r => ({
      id: r.id,
      type: r.recommendationType,
      priority: r.priority || 'medium',
      title: r.title || '',
      description: r.description || '',
      expectedProfitChange: Number(r.expectedProfitChange) || 0,
      createdAt: r.createdAt
    }));
}

/**
 * 生成利润曲线可视化数据
 */
export async function generateProfitVisualizationData(
  accountId: number,
  bidObjectType: 'keyword' | 'asin',
  bidObjectId: string
): Promise<{
  profitCurve: Array<{ cpc: number; profit: number; roas: number; acos: number }>;
  optimalPoint: { cpc: number; profit: number };
  currentPoint: { cpc: number; profit: number };
  breakEvenPoint: { cpc: number };
} | null> {
  const model = await getMarketCurveModel(accountId, bidObjectType, bidObjectId);
  
  if (!model) {
    return null;
  }
  
  const curveData = generateProfitCurveData(
    model.impressionCurve,
    model.ctrCurve,
    model.conversion,
    0.1,
    model.breakEvenCPC * 1.5,
    50
  );
  
  return {
    profitCurve: curveData.map(d => ({
      cpc: d.cpc,
      profit: d.profit,
      roas: d.roas,
      acos: d.acos
    })),
    optimalPoint: {
      cpc: model.optimalBid,
      profit: model.maxProfit
    },
    currentPoint: {
      cpc: 0, // 需要从外部传入
      profit: 0
    },
    breakEvenPoint: {
      cpc: model.breakEvenCPC
    }
  };
}
