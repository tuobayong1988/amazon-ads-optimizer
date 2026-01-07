/**
 * 市场曲线建模服务
 * 基于Adspert的市场曲线算法，建立CPC与各项指标的函数关系
 * 用于计算利润最大化出价点
 */

import { getDb } from "./db";
import { 
  keywords,
  placementPerformance,
  marketCurveModels,
  bidPerformanceHistory,
  adGroups
} from "../drizzle/schema";

import { eq, and, gte, lte, desc, sql } from "drizzle-orm";

// 获取db实例的辅助函数
async function getDbInstance() {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  return db;
}

// ==================== 类型定义 ====================

export interface BidPerformanceData {
  bid: number;
  effectiveCPC: number;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  ctr: number;
  cvr: number;
}

export interface ImpressionCurveParams {
  a: number;  // 对数系数
  b: number;  // 偏移量
  c: number;  // 基础展现
  r2: number; // 拟合优度
}

export interface CTRCurveParams {
  baseCTR: number;
  positionBonus: number;
  topSearchCTRBonus: number;
}

export interface ConversionParams {
  cvr: number;
  aov: number;
  conversionDelayDays: number;
}

export interface MarketCurveResult {
  impressionCurve: ImpressionCurveParams;
  ctrCurve: CTRCurveParams;
  conversion: ConversionParams;
  optimalBid: number;
  maxProfit: number;
  profitMargin: number;
  breakEvenCPC: number;
  dataPoints: number;
  confidence: number;
}

export interface OptimalBidResult {
  optimalBid: number;
  maxProfit: number;
  profitMargin: number;
  breakEvenCPC: number;
  profitCurve: Array<{ cpc: number; profit: number }>;
}

// ==================== 市场曲线建模服务 ====================

/**
 * 构建展现曲线
 * 使用对数回归: Impressions = a × ln(CPC + b) + c
 */
export function buildImpressionCurve(dataPoints: BidPerformanceData[]): ImpressionCurveParams {
  const validPoints = dataPoints.filter(p => p.impressions > 0 && p.bid > 0);
  
  if (validPoints.length < 5) {
    // 数据不足，返回默认曲线
    return {
      a: 1000,
      b: 0.1,
      c: 100,
      r2: 0
    };
  }
  
  // 对数回归拟合
  // y = a × ln(x + b) + c
  // 简化为: y = a × ln(x) + c (假设b很小)
  const n = validPoints.length;
  const lnX = validPoints.map(p => Math.log(p.bid + 0.01));
  const y = validPoints.map(p => p.impressions);
  
  // 计算线性回归参数
  const sumLnX = lnX.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumLnXY = lnX.reduce((sum, x, i) => sum + x * y[i], 0);
  const sumLnX2 = lnX.reduce((sum, x) => sum + x * x, 0);
  
  const a = (n * sumLnXY - sumLnX * sumY) / (n * sumLnX2 - sumLnX * sumLnX);
  const c = (sumY - a * sumLnX) / n;
  
  // 计算R²
  const meanY = sumY / n;
  const ssTotal = y.reduce((sum, yi) => sum + Math.pow(yi - meanY, 2), 0);
  const ssResidual = validPoints.reduce((sum, p, i) => {
    const predicted = a * lnX[i] + c;
    return sum + Math.pow(p.impressions - predicted, 2);
  }, 0);
  const r2 = 1 - ssResidual / ssTotal;
  
  return {
    a: Math.max(a, 0),
    b: 0.01,
    c: Math.max(c, 0),
    r2: Math.max(0, Math.min(1, r2))
  };
}

/**
 * 构建点击率曲线
 * CTR = baseCTR × (1 + positionBonus × positionScore)
 */
export function buildCTRCurve(dataPoints: BidPerformanceData[]): CTRCurveParams {
  const validPoints = dataPoints.filter(p => p.clicks > 0 && p.impressions > 0);
  
  if (validPoints.length < 3) {
    return {
      baseCTR: 0.01,
      positionBonus: 0.5,
      topSearchCTRBonus: 0.3
    };
  }
  
  // 计算平均CTR
  const totalClicks = validPoints.reduce((sum, p) => sum + p.clicks, 0);
  const totalImpressions = validPoints.reduce((sum, p) => sum + p.impressions, 0);
  const baseCTR = totalClicks / totalImpressions;
  
  // 分析出价与CTR的关系（高出价通常获得更好位置，CTR更高）
  const sortedByBid = [...validPoints].sort((a, b) => b.bid - a.bid);
  const topHalf = sortedByBid.slice(0, Math.ceil(sortedByBid.length / 2));
  const bottomHalf = sortedByBid.slice(Math.ceil(sortedByBid.length / 2));
  
  const topCTR = topHalf.reduce((sum, p) => sum + p.ctr, 0) / topHalf.length;
  const bottomCTR = bottomHalf.reduce((sum, p) => sum + p.ctr, 0) / bottomHalf.length;
  
  const positionBonus = bottomCTR > 0 ? (topCTR - bottomCTR) / bottomCTR : 0.5;
  
  return {
    baseCTR,
    positionBonus: Math.max(0, Math.min(2, positionBonus)),
    topSearchCTRBonus: positionBonus * 0.6 // 搜索顶部额外加成
  };
}

/**
 * 计算转化参数
 */
export function calculateConversionParams(dataPoints: BidPerformanceData[]): ConversionParams {
  const validPoints = dataPoints.filter(p => p.clicks > 0);
  
  if (validPoints.length < 3) {
    return {
      cvr: 0.05,
      aov: 30,
      conversionDelayDays: 7
    };
  }
  
  const totalClicks = validPoints.reduce((sum, p) => sum + p.clicks, 0);
  const totalOrders = validPoints.reduce((sum, p) => sum + p.orders, 0);
  const totalSales = validPoints.reduce((sum, p) => sum + p.sales, 0);
  
  const cvr = totalOrders / Math.max(totalClicks, 1);
  const aov = totalOrders > 0 ? totalSales / totalOrders : 30;
  
  return {
    cvr,
    aov,
    conversionDelayDays: 7
  };
}

/**
 * 计算给定CPC下的展现量
 */
export function calculateImpressions(cpc: number, curve: ImpressionCurveParams): number {
  return Math.max(0, curve.a * Math.log(cpc + curve.b) + curve.c);
}

/**
 * 计算给定CPC下的CTR
 */
export function calculateCTR(cpc: number, curve: CTRCurveParams, maxCPC: number = 5): number {
  // 假设CPC越高，位置越好，CTR越高
  const positionScore = Math.min(cpc / maxCPC, 1);
  return curve.baseCTR * (1 + curve.positionBonus * positionScore);
}

/**
 * 计算给定CPC下的利润
 * Profit = Clicks × (CVR × AOV - CPC)
 */
export function calculateProfit(
  cpc: number,
  impressionCurve: ImpressionCurveParams,
  ctrCurve: CTRCurveParams,
  conversion: ConversionParams
): number {
  const impressions = calculateImpressions(cpc, impressionCurve);
  const ctr = calculateCTR(cpc, ctrCurve);
  const clicks = impressions * ctr;
  const { cvr, aov } = conversion;
  
  return clicks * (cvr * aov - cpc);
}

/**
 * 黄金分割搜索最优CPC
 */
function goldenSectionSearch(
  f: (x: number) => number,
  a: number,
  b: number,
  tolerance: number = 0.001
): number {
  const phi = (1 + Math.sqrt(5)) / 2;
  const resphi = 2 - phi;
  
  let x1 = a + resphi * (b - a);
  let x2 = b - resphi * (b - a);
  let f1 = f(x1);
  let f2 = f(x2);
  
  let iterations = 0;
  const maxIterations = 100;
  
  while (Math.abs(b - a) > tolerance && iterations < maxIterations) {
    if (f1 > f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = a + resphi * (b - a);
      f1 = f(x1);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = b - resphi * (b - a);
      f2 = f(x2);
    }
    iterations++;
  }
  
  return (a + b) / 2;
}

/**
 * 计算利润最大化出价点
 */
export function calculateOptimalBid(
  impressionCurve: ImpressionCurveParams,
  ctrCurve: CTRCurveParams,
  conversion: ConversionParams
): OptimalBidResult {
  const { cvr, aov } = conversion;
  
  // 盈亏平衡点
  const breakEvenCPC = cvr * aov;
  
  // 搜索范围
  const minCPC = 0.02;
  const maxCPC = Math.min(breakEvenCPC * 1.5, 10);
  
  // 粗略搜索找到利润最大化区域
  const step = 0.05;
  let bestCPC = minCPC;
  let maxProfit = -Infinity;
  
  for (let cpc = minCPC; cpc <= maxCPC; cpc += step) {
    const profit = calculateProfit(cpc, impressionCurve, ctrCurve, conversion);
    if (profit > maxProfit) {
      maxProfit = profit;
      bestCPC = cpc;
    }
  }
  
  // 使用黄金分割法精确搜索
  const optimalBid = goldenSectionSearch(
    (cpc) => calculateProfit(cpc, impressionCurve, ctrCurve, conversion),
    Math.max(minCPC, bestCPC - step * 2),
    Math.min(maxCPC, bestCPC + step * 2)
  );
  
  const finalProfit = calculateProfit(optimalBid, impressionCurve, ctrCurve, conversion);
  const profitMargin = (cvr * aov - optimalBid) / (cvr * aov);
  
  // 生成利润曲线数据点
  const profitCurve: Array<{ cpc: number; profit: number }> = [];
  for (let cpc = minCPC; cpc <= maxCPC; cpc += 0.1) {
    profitCurve.push({
      cpc,
      profit: calculateProfit(cpc, impressionCurve, ctrCurve, conversion)
    });
  }
  
  return {
    optimalBid: Math.round(optimalBid * 100) / 100,
    maxProfit: Math.round(finalProfit * 100) / 100,
    profitMargin: Math.round(profitMargin * 10000) / 10000,
    breakEvenCPC: Math.round(breakEvenCPC * 100) / 100,
    profitCurve
  };
}

/**
 * 为关键词构建完整的市场曲线模型
 */
export async function buildMarketCurveForKeyword(
  accountId: number,
  campaignId: string,
  keywordId: number,
  daysBack: number = 30
): Promise<MarketCurveResult | null> {
  const db = await getDbInstance();
  
  // 获取历史出价表现数据
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);
  
  const historyData = await db
    .select()
    .from(bidPerformanceHistory)
    .where(
      and(
        eq(bidPerformanceHistory.accountId, accountId),
        eq(bidPerformanceHistory.bidObjectType, 'keyword'),
        eq(bidPerformanceHistory.bidObjectId, String(keywordId)),
        gte(bidPerformanceHistory.date, startDate.toISOString().split('T')[0])
      )
    );
  
  if (historyData.length < 5) {
    // 数据不足，尝试从关键词表获取汇总数据
    const keywordData = await db
      .select()
      .from(keywords)
      .where(eq(keywords.id, keywordId))
      .limit(1);
    
    if (keywordData.length === 0) {
      return null;
    }
    
    const kw = keywordData[0];
    
    // 使用关键词汇总数据构建简化模型
    const dataPoints: BidPerformanceData[] = [{
      bid: Number(kw.bid) || 1,
      effectiveCPC: Number(kw.spend) / Math.max(Number(kw.clicks), 1),
      impressions: kw.impressions || 0,
      clicks: kw.clicks || 0,
      spend: Number(kw.spend) || 0,
      sales: Number(kw.sales) || 0,
      orders: kw.orders || 0,
      ctr: (kw.impressions && kw.clicks) ? (kw.clicks / kw.impressions) * 100 : 0.01,
      cvr: (kw.clicks && kw.orders) ? (kw.orders / kw.clicks) * 100 : 0.05
    }];
    
    const impressionCurve = buildImpressionCurve(dataPoints);
    const ctrCurve = buildCTRCurve(dataPoints);
    const conversion = calculateConversionParams(dataPoints);
    const optimal = calculateOptimalBid(impressionCurve, ctrCurve, conversion);
    
    return {
      impressionCurve,
      ctrCurve,
      conversion,
      ...optimal,
      dataPoints: 1,
      confidence: 0.3 // 低置信度
    };
  }
  
  // 转换数据格式
  const dataPoints: BidPerformanceData[] = historyData.map(h => ({
    bid: Number(h.bid),
    effectiveCPC: Number(h.effectiveCPC) || Number(h.bid),
    impressions: h.impressions || 0,
    clicks: h.clicks || 0,
    spend: Number(h.spend) || 0,
    sales: Number(h.sales) || 0,
    orders: h.orders || 0,
    ctr: Number(h.ctr) || 0,
    cvr: Number(h.cvr) || 0
  }));
  
  // 构建各曲线
  const impressionCurve = buildImpressionCurve(dataPoints);
  const ctrCurve = buildCTRCurve(dataPoints);
  const conversion = calculateConversionParams(dataPoints);
  
  // 计算最优出价
  const optimal = calculateOptimalBid(impressionCurve, ctrCurve, conversion);
  
  // 计算置信度
  const confidence = calculateModelConfidence(dataPoints, impressionCurve.r2);
  
  return {
    impressionCurve,
    ctrCurve,
    conversion,
    ...optimal,
    dataPoints: dataPoints.length,
    confidence
  };
}

/**
 * 计算模型置信度
 */
function calculateModelConfidence(dataPoints: BidPerformanceData[], r2: number): number {
  // 基于数据点数量的置信度
  const dataConfidence = Math.min(dataPoints.length / 30, 1);
  
  // 基于R²的置信度
  const r2Confidence = Math.max(0, r2);
  
  // 基于数据一致性的置信度
  const clicks = dataPoints.map(p => p.clicks);
  const avgClicks = clicks.reduce((a, b) => a + b, 0) / clicks.length;
  const variance = clicks.reduce((sum, c) => sum + Math.pow(c - avgClicks, 2), 0) / clicks.length;
  const cv = Math.sqrt(variance) / Math.max(avgClicks, 1); // 变异系数
  const consistencyConfidence = Math.max(0, 1 - cv);
  
  // 综合置信度
  return (dataConfidence * 0.4 + r2Confidence * 0.3 + consistencyConfidence * 0.3);
}

/**
 * 保存市场曲线模型到数据库
 */
export async function saveMarketCurveModel(
  accountId: number,
  campaignId: string,
  bidObjectType: 'keyword' | 'asin' | 'audience',
  bidObjectId: string,
  bidObjectText: string,
  model: MarketCurveResult,
  currentBid: number
): Promise<void> {
  const db = await getDbInstance();
  const bidGap = model.optimalBid - currentBid;
  const bidGapPercent = currentBid > 0 ? bidGap / currentBid : 0;
  
  // 检查是否已存在
  const existing = await db
    .select()
    .from(marketCurveModels)
    .where(
      and(
        eq(marketCurveModels.accountId, accountId),
        eq(marketCurveModels.bidObjectType, bidObjectType),
        eq(marketCurveModels.bidObjectId, bidObjectId)
      )
    )
    .limit(1);
  
  const modelData = {
    accountId,
    campaignId,
    bidObjectType,
    bidObjectId,
    bidObjectText,
    impressionCurveA: String(model.impressionCurve.a),
    impressionCurveB: String(model.impressionCurve.b),
    impressionCurveC: String(model.impressionCurve.c),
    impressionCurveR2: String(model.impressionCurve.r2),
    baseCTR: String(model.ctrCurve.baseCTR),
    positionBonus: String(model.ctrCurve.positionBonus),
    topSearchCTRBonus: String(model.ctrCurve.topSearchCTRBonus),
    cvr: String(model.conversion.cvr),
    aov: String(model.conversion.aov),
    conversionDelayDays: model.conversion.conversionDelayDays,
    cvrSource: 'historical' as const,
    optimalBid: String(model.optimalBid),
    maxProfit: String(model.maxProfit),
    profitMargin: String(model.profitMargin),
    breakEvenCPC: String(model.breakEvenCPC),
    currentBid: String(currentBid),
    bidGap: String(bidGap),
    bidGapPercent: String(bidGapPercent),
    dataPoints: model.dataPoints,
    confidence: String(model.confidence)
  };
  
  if (existing.length > 0) {
    await db
      .update(marketCurveModels)
      .set(modelData)
      .where(eq(marketCurveModels.id, existing[0].id));
  } else {
    await db.insert(marketCurveModels).values(modelData);
  }
}

/**
 * 获取关键词的市场曲线模型
 */
export async function getMarketCurveModel(
  accountId: number,
  bidObjectType: 'keyword' | 'asin' | 'audience',
  bidObjectId: string
): Promise<MarketCurveResult | null> {
  const db = await getDbInstance();
  const models = await db
    .select()
    .from(marketCurveModels)
    .where(
      and(
        eq(marketCurveModels.accountId, accountId),
        eq(marketCurveModels.bidObjectType, bidObjectType),
        eq(marketCurveModels.bidObjectId, bidObjectId)
      )
    )
    .limit(1);
  
  if (models.length === 0) {
    return null;
  }
  
  const m = models[0];
  
  return {
    impressionCurve: {
      a: Number(m.impressionCurveA) || 0,
      b: Number(m.impressionCurveB) || 0,
      c: Number(m.impressionCurveC) || 0,
      r2: Number(m.impressionCurveR2) || 0
    },
    ctrCurve: {
      baseCTR: Number(m.baseCTR) || 0,
      positionBonus: Number(m.positionBonus) || 0,
      topSearchCTRBonus: Number(m.topSearchCTRBonus) || 0
    },
    conversion: {
      cvr: Number(m.cvr) || 0,
      aov: Number(m.aov) || 0,
      conversionDelayDays: m.conversionDelayDays || 7
    },
    optimalBid: Number(m.optimalBid) || 0,
    maxProfit: Number(m.maxProfit) || 0,
    profitMargin: Number(m.profitMargin) || 0,
    breakEvenCPC: Number(m.breakEvenCPC) || 0,
    dataPoints: m.dataPoints || 0,
    confidence: Number(m.confidence) || 0
  };
}

/**
 * 批量更新账号下所有关键词的市场曲线模型
 */
export async function updateAllMarketCurveModels(accountId: number): Promise<{
  updated: number;
  failed: number;
  errors: string[];
}> {
  const db = await getDbInstance();
  const result = {
    updated: 0,
    failed: 0,
    errors: [] as string[]
  };
  
  // 获取账号下所有活跃关键词
  const allKeywords = await db
    .select({
      id: keywords.id,
      adGroupId: keywords.adGroupId,
      keywordText: keywords.keywordText,
      bid: keywords.bid
    })
    .from(keywords)
    .where(eq(keywords.keywordStatus, 'enabled'))
    .limit(1000);
  
  for (const kw of allKeywords) {
    try {
      // 获取关键词所属的广告活动
      const adGroupData = await db
        .select()
        .from(keywords)
        .where(eq(keywords.id, kw.id))
        .limit(1);
      
      if (adGroupData.length === 0) continue;
      
      // 构建市场曲线
      const model = await buildMarketCurveForKeyword(
        accountId,
        String(kw.adGroupId), // 使用adGroupId作为campaignId的代理
        kw.id
      );
      
      if (model) {
        await saveMarketCurveModel(
          accountId,
          String(kw.adGroupId),
          'keyword',
          String(kw.id),
          kw.keywordText,
          model,
          Number(kw.bid)
        );
        result.updated++;
      }
    } catch (error) {
      result.failed++;
      result.errors.push(`关键词 ${kw.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  return result;
}

/**
 * 生成利润曲线数据（用于前端可视化）
 */
export function generateProfitCurveData(
  impressionCurve: ImpressionCurveParams,
  ctrCurve: CTRCurveParams,
  conversion: ConversionParams,
  minCPC: number = 0.1,
  maxCPC: number = 5,
  points: number = 50
): Array<{
  cpc: number;
  impressions: number;
  clicks: number;
  spend: number;
  revenue: number;
  profit: number;
  roas: number;
  acos: number;
}> {
  const step = (maxCPC - minCPC) / points;
  const data = [];
  
  for (let cpc = minCPC; cpc <= maxCPC; cpc += step) {
    const impressions = calculateImpressions(cpc, impressionCurve);
    const ctr = calculateCTR(cpc, ctrCurve);
    const clicks = impressions * ctr;
    const spend = clicks * cpc;
    const revenue = clicks * conversion.cvr * conversion.aov;
    const profit = revenue - spend;
    const roas = spend > 0 ? revenue / spend : 0;
    const acos = revenue > 0 ? spend / revenue : 0;
    
    data.push({
      cpc: Math.round(cpc * 100) / 100,
      impressions: Math.round(impressions),
      clicks: Math.round(clicks),
      spend: Math.round(spend * 100) / 100,
      revenue: Math.round(revenue * 100) / 100,
      profit: Math.round(profit * 100) / 100,
      roas: Math.round(roas * 100) / 100,
      acos: Math.round(acos * 10000) / 10000
    });
  }
  
  return data;
}
