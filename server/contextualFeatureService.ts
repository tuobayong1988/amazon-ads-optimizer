/**
 * 上下文特征管道服务 (Contextual Feature Pipeline)
 * 
 * 核心职责：
 * 1. 从多维数据源（绩效、竞争、产品、时间）提取上下文特征
 * 2. 计算时间衰减加权绩效指标（近期数据权重更高）
 * 3. 计算竞争环境特征（CPC波动率、展示份额估计）
 * 4. 计算绩效趋势特征（7天趋势斜率）
 * 5. 缓存Sigmoid曲线拟合参数
 * 6. 为LinUCB、因果推断、CQL提供标准化特征向量
 */
import { getDb } from "./db";
import {
  keywords,
  productTargets,
  dailyPerformance,
  hourlyPerformance,
  contextualFeatures,
  campaigns,
  adGroups,
} from "../drizzle/schema";
import { eq, and, gte, lte, desc, sql, isNotNull } from "drizzle-orm";

// ==================== 类型定义 ====================

export interface ContextFeatureVector {
  // 基础标识
  accountId: number;
  keywordId?: number;
  targetId?: number;
  campaignId?: string;
  adGroupId?: number;
  
  // 时间上下文 (维度 0-2)
  hourOfDay: number;
  dayOfWeek: number;
  isHoliday: number;
  
  // 竞争环境 (维度 3-7)
  estimatedCompetition: number;
  cpcVolatility7d: number;
  ctrVolatility7d: number;
  impressionShare: number;
  avgCpc7d: number;
  
  // 绩效指标 (维度 8-10)
  avgCtr7d: number;
  avgCvr7d: number;
  weightedAcos14d: number;
  
  // 趋势特征 (维度 11-14)
  impressionTrend7d: number;
  clickTrend7d: number;
  orderTrend7d: number;
  spendTrend7d: number;
  
  // 时间衰减加权 (维度 15-16)
  weightedCvr14d: number;
  weightedRoas14d: number;
}

// 标准化特征向量维度 = 17
export const FEATURE_DIM = 17;

// 时间衰减半衰期（天数）
const HALF_LIFE_DAYS = 7;

// ==================== 辅助函数 ====================

async function getDbInstance() {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  return db;
}

/**
 * 计算时间衰减权重
 * 使用指数衰减: w(t) = exp(-λ * t)，其中 λ = ln(2) / halfLife
 */
function timeDecayWeight(daysAgo: number, halfLife: number = HALF_LIFE_DAYS): number {
  const lambda = Math.LN2 / halfLife;
  return Math.exp(-lambda * daysAgo);
}

/**
 * 计算线性回归斜率（用于趋势特征）
 * 输入：按时间顺序排列的数值数组
 * 输出：归一化斜率（相对于均值的变化率）
 */
function calculateTrendSlope(values: number[]): number {
  if (values.length < 2) return 0;
  
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return 0;
  
  // 最小二乘法计算斜率
  let sumXY = 0, sumX2 = 0;
  const xMean = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    sumXY += (i - xMean) * (values[i] - mean);
    sumX2 += (i - xMean) * (i - xMean);
  }
  
  const slope = sumX2 === 0 ? 0 : sumXY / sumX2;
  // 归一化：斜率 / 均值，得到每天的相对变化率
  return slope / mean;
}

/**
 * 计算波动率（标准差 / 均值，即变异系数）
 */
function calculateVolatility(values: number[]): number {
  if (values.length < 2) return 0;
  
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance) / mean;
}

/**
 * 判断是否为美国主要购物假日
 */
function isUSShoppingHoliday(date: Date): boolean {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dayOfWeek = date.getDay();
  
  // Prime Day (7月中旬)
  if (month === 7 && day >= 11 && day <= 17) return true;
  // Black Friday (11月第4个周四后的周五)
  if (month === 11 && dayOfWeek === 5 && day >= 23 && day <= 29) return true;
  // Cyber Monday
  if (month === 12 && dayOfWeek === 1 && day >= 1 && day <= 3) return true;
  // Christmas shopping season
  if (month === 12 && day >= 15 && day <= 25) return true;
  // Valentine's Day
  if (month === 2 && day >= 10 && day <= 14) return true;
  // Mother's Day (5月第2个周日)
  if (month === 5 && dayOfWeek === 0 && day >= 8 && day <= 14) return true;
  
  return false;
}

// ==================== 核心特征提取 ====================

/**
 * 为单个关键词/定位提取上下文特征向量
 */
export async function extractFeatureVector(
  accountId: number,
  keywordId?: number,
  targetId?: number,
  campaignId?: string,
  adGroupId?: number
): Promise<ContextFeatureVector> {
  const db = await getDbInstance();
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const days14Ago = new Date(now.getTime() - 14 * 86400000).toISOString().split('T')[0];
  const days7Ago = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
  
  // 查询最近14天的每日绩效数据
  let perfQuery = db.select({
    date: dailyPerformance.date,
    impressions: dailyPerformance.impressions,
    clicks: dailyPerformance.clicks,
    spend: dailyPerformance.spend,
    sales: dailyPerformance.sales,
    orders: dailyPerformance.orders,
    cpc: dailyPerformance.cpc,
    ctr: dailyPerformance.ctr,
    cvr: dailyPerformance.cvr,
  }).from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      campaignId ? eq(dailyPerformance.campaignId, campaignId) : sql`1=1`,
      gte(dailyPerformance.date, days14Ago),
      lte(dailyPerformance.date, today)
    ))
    .orderBy(dailyPerformance.date);
  
  const perfData = await perfQuery;
  
  // 计算时间衰减加权指标
  let weightedCvrNum = 0, weightedCvrDen = 0;
  let weightedRoasNum = 0, weightedRoasDen = 0;
  let weightedAcosNum = 0, weightedAcosDen = 0;
  
  const impressions7d: number[] = [];
  const clicks7d: number[] = [];
  const orders7d: number[] = [];
  const spend7d: number[] = [];
  const cpcValues: number[] = [];
  const ctrValues: number[] = [];
  
  for (const row of perfData) {
    const rowDate = new Date(row.date as string);
    const daysAgo = Math.floor((now.getTime() - rowDate.getTime()) / 86400000);
    const weight = timeDecayWeight(daysAgo);
    
    const clicks = Number(row.clicks) || 0;
    const orders = Number(row.orders) || 0;
    const spend = Number(row.spend) || 0;
    const sales = Number(row.sales) || 0;
    const impressions = Number(row.impressions) || 0;
    const cpc = Number(row.cpc) || 0;
    const ctr = Number(row.ctr) || 0;
    
    // 时间衰减加权CVR
    if (clicks > 0) {
      weightedCvrNum += weight * orders;
      weightedCvrDen += weight * clicks;
    }
    
    // 时间衰减加权ROAS
    if (spend > 0) {
      weightedRoasNum += weight * sales;
      weightedRoasDen += weight * spend;
      weightedAcosNum += weight * spend;
      weightedAcosDen += weight * sales;
    }
    
    // 最近7天的数据用于趋势计算
    if (daysAgo <= 7) {
      impressions7d.push(impressions);
      clicks7d.push(clicks);
      orders7d.push(orders);
      spend7d.push(spend);
    }
    
    if (cpc > 0) cpcValues.push(cpc);
    if (ctr > 0) ctrValues.push(ctr);
  }
  
  // 计算加权指标
  const weightedCvr14d = weightedCvrDen > 0 ? weightedCvrNum / weightedCvrDen : 0;
  const weightedRoas14d = weightedRoasDen > 0 ? weightedRoasNum / weightedRoasDen : 0;
  const weightedAcos14d = weightedAcosDen > 0 ? weightedAcosNum / weightedAcosDen : 0;
  
  // 计算7天均值
  const sum7d = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const avg7d = (arr: number[]) => arr.length > 0 ? sum7d(arr) / arr.length : 0;
  
  const totalImpressions7d = sum7d(impressions7d);
  const totalClicks7d = sum7d(clicks7d);
  const totalSpend7d = sum7d(spend7d);
  
  const avgCpc7d = totalClicks7d > 0 ? totalSpend7d / totalClicks7d : 0;
  const avgCtr7d = totalImpressions7d > 0 ? totalClicks7d / totalImpressions7d : 0;
  const avgCvr7d = totalClicks7d > 0 ? sum7d(orders7d) / totalClicks7d : 0;
  
  // 计算竞争环境特征
  const cpcVolatility7d = calculateVolatility(cpcValues.slice(-7));
  const ctrVolatility7d = calculateVolatility(ctrValues.slice(-7));
  
  // 估计展示份额（基于展示量变化率的代理指标）
  // 如果展示量在下降，说明竞争加剧，展示份额在降低
  const impressionShare = impressions7d.length >= 2 
    ? Math.min(1, Math.max(0, 0.5 + calculateTrendSlope(impressions7d) * 2))
    : 0.5;
  
  // 估计竞争强度（基于CPC波动率和CPC水平）
  const estimatedCompetition = Math.min(1, cpcVolatility7d * 0.5 + (avgCpc7d > 2 ? 0.3 : avgCpc7d > 1 ? 0.2 : 0.1));
  
  // 计算趋势特征
  const impressionTrend7d = calculateTrendSlope(impressions7d);
  const clickTrend7d = calculateTrendSlope(clicks7d);
  const orderTrend7d = calculateTrendSlope(orders7d);
  const spendTrend7d = calculateTrendSlope(spend7d);
  
  return {
    accountId,
    keywordId,
    targetId,
    campaignId,
    adGroupId,
    hourOfDay: now.getHours(),
    dayOfWeek: now.getDay(),
    isHoliday: isUSShoppingHoliday(now) ? 1 : 0,
    estimatedCompetition,
    cpcVolatility7d,
    ctrVolatility7d,
    impressionShare,
    avgCpc7d,
    avgCtr7d,
    avgCvr7d,
    weightedAcos14d,
    impressionTrend7d,
    clickTrend7d,
    orderTrend7d,
    spendTrend7d,
    weightedCvr14d,
    weightedRoas14d,
  };
}

/**
 * 将ContextFeatureVector转换为标准化数值数组（供LinUCB使用）
 * 所有特征归一化到 [0, 1] 范围
 */
export function featureVectorToArray(features: ContextFeatureVector): number[] {
  return [
    features.hourOfDay / 23,                                    // [0] 小时归一化
    features.dayOfWeek / 6,                                     // [1] 星期归一化
    features.isHoliday,                                         // [2] 假日标志
    Math.min(1, features.estimatedCompetition),                 // [3] 竞争强度
    Math.min(1, features.cpcVolatility7d),                      // [4] CPC波动率
    Math.min(1, features.ctrVolatility7d),                      // [5] CTR波动率
    Math.min(1, features.impressionShare),                      // [6] 展示份额
    Math.min(1, features.avgCpc7d / 5),                         // [7] 平均CPC（假设max=5）
    Math.min(1, features.avgCtr7d * 10),                        // [8] 平均CTR（假设max=10%）
    Math.min(1, features.avgCvr7d * 5),                         // [9] 平均CVR（假设max=20%）
    Math.min(1, Math.max(0, features.weightedAcos14d)),         // [10] 加权ACOS
    Math.min(1, Math.max(0, (features.impressionTrend7d + 1) / 2)),  // [11] 展示趋势归一化
    Math.min(1, Math.max(0, (features.clickTrend7d + 1) / 2)),      // [12] 点击趋势归一化
    Math.min(1, Math.max(0, (features.orderTrend7d + 1) / 2)),      // [13] 订单趋势归一化
    Math.min(1, Math.max(0, (features.spendTrend7d + 1) / 2)),      // [14] 花费趋势归一化
    Math.min(1, features.weightedCvr14d * 5),                   // [15] 加权CVR
    Math.min(1, features.weightedRoas14d / 10),                 // [16] 加权ROAS（假设max=10）
  ];
}

/**
 * 批量提取并缓存上下文特征（定时任务调用）
 * 为所有活跃关键词和定位生成特征快照
 */
export async function batchExtractAndCacheFeatures(accountId: number): Promise<number> {
  const db = await getDbInstance();
  const today = new Date().toISOString().split('T')[0];
  let processedCount = 0;
  
  try {
    // 获取所有活跃关键词（keywords没有accountId，需要通过adGroups→campaigns JOIN）
    const activeKeywords = await db.select({
      id: keywords.id,
      adGroupId: keywords.adGroupId,
      campaignId: campaigns.campaignId,
    }).from(keywords)
      .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
      .innerJoin(campaigns, sql`${adGroups.campaignId} = CAST(${campaigns.id} AS CHAR)`)
      .where(and(
        eq(campaigns.accountId, accountId),
        eq(keywords.keywordStatus, 'enabled')
      ))
      .limit(5000);  // 批次限制
    
    // 获取所有活跃定位（productTargets没有accountId，需要通过adGroups→campaigns JOIN）
    const activeTargets = await db.select({
      id: productTargets.id,
      adGroupId: productTargets.adGroupId,
      campaignId: campaigns.campaignId,
    }).from(productTargets)
      .innerJoin(adGroups, eq(productTargets.adGroupId, adGroups.id))
      .innerJoin(campaigns, sql`${adGroups.campaignId} = CAST(${campaigns.id} AS CHAR)`)
      .where(and(
        eq(campaigns.accountId, accountId),
        eq(productTargets.targetStatus, 'enabled')
      ))
      .limit(5000);
    
    // 按Campaign聚合，减少重复查询
    const campaignIds = new Set<string>();
    for (const kw of activeKeywords) {
      if (kw.campaignId) campaignIds.add(String(kw.campaignId));
    }
    for (const tgt of activeTargets) {
      if (tgt.campaignId) campaignIds.add(String(tgt.campaignId));
    }
    
    // 为每个Campaign提取特征并缓存
    const campaignFeatureCache = new Map<string, ContextFeatureVector>();
    for (const cid of campaignIds) {
      const features = await extractFeatureVector(accountId, undefined, undefined, cid);
      campaignFeatureCache.set(cid, features);
    }
    
    // 批量插入关键词特征
    const batchSize = 100;
    const allItems = [
      ...activeKeywords.map(kw => ({ keywordId: kw.id, targetId: null, campaignId: String(kw.campaignId), adGroupId: kw.adGroupId })),
      ...activeTargets.map(tgt => ({ keywordId: null, targetId: tgt.id, campaignId: String(tgt.campaignId), adGroupId: tgt.adGroupId })),
    ];
    
    for (let i = 0; i < allItems.length; i += batchSize) {
      const batch = allItems.slice(i, i + batchSize);
      const insertValues = batch.map(item => {
        const features = campaignFeatureCache.get(item.campaignId || '') || {
          hourOfDay: new Date().getHours(),
          dayOfWeek: new Date().getDay(),
          isHoliday: 0,
          estimatedCompetition: 0,
          cpcVolatility7d: 0,
          ctrVolatility7d: 0,
          impressionShare: 0.5,
          avgCpc7d: 0,
          avgCtr7d: 0,
          avgCvr7d: 0,
          impressionTrend7d: 0,
          clickTrend7d: 0,
          orderTrend7d: 0,
          spendTrend7d: 0,
          weightedCvr14d: 0,
          weightedAcos14d: 0,
          weightedRoas14d: 0,
        };
        
        return {
          accountId,
          keywordId: item.keywordId,
          targetId: item.targetId,
          campaignId: item.campaignId,
          adGroupId: item.adGroupId,
          snapshotDate: today,
          hourOfDay: features.hourOfDay,
          dayOfWeek: features.dayOfWeek,
          isHoliday: features.isHoliday,
          estimatedCompetition: String(features.estimatedCompetition),
          cpcVolatility7d: String(features.cpcVolatility7d),
          ctrVolatility7d: String(features.ctrVolatility7d),
          impressionShare: String(features.impressionShare),
          avgCpc7d: String(features.avgCpc7d),
          avgCtr7d: String(features.avgCtr7d),
          avgCvr7d: String(features.avgCvr7d),
          impressionTrend7d: String(features.impressionTrend7d),
          clickTrend7d: String(features.clickTrend7d),
          orderTrend7d: String(features.orderTrend7d),
          spendTrend7d: String(features.spendTrend7d),
          weightedCvr14d: String(features.weightedCvr14d),
          weightedAcos14d: String(features.weightedAcos14d),
          weightedRoas14d: String(features.weightedRoas14d),
        };
      });
      
      if (insertValues.length > 0) {
        await db.insert(contextualFeatures).values(insertValues as any);
        processedCount += insertValues.length;
      }
    }
    
    console.log(`[ContextualFeatureService] Cached ${processedCount} feature vectors for account ${accountId}`);
    return processedCount;
    
  } catch (error) {
    console.error(`[ContextualFeatureService] Error extracting features for account ${accountId}:`, error);
    return processedCount;
  }
}

/**
 * 获取缓存的特征向量（优先从缓存读取，缓存不存在则实时计算）
 */
export async function getCachedFeatureVector(
  accountId: number,
  keywordId?: number,
  targetId?: number,
  campaignId?: string
): Promise<ContextFeatureVector> {
  const db = await getDbInstance();
  const today = new Date().toISOString().split('T')[0];
  
  // 尝试从缓存读取
  let cached;
  if (keywordId) {
    cached = await db.select().from(contextualFeatures)
      .where(and(
        eq(contextualFeatures.accountId, accountId),
        eq(contextualFeatures.keywordId, keywordId),
        eq(contextualFeatures.snapshotDate, today)
      ))
      .limit(1);
  } else if (targetId) {
    cached = await db.select().from(contextualFeatures)
      .where(and(
        eq(contextualFeatures.accountId, accountId),
        eq(contextualFeatures.targetId, targetId),
        eq(contextualFeatures.snapshotDate, today)
      ))
      .limit(1);
  }
  
  if (cached && cached.length > 0) {
    const c = cached[0];
    return {
      accountId: c.accountId,
      keywordId: c.keywordId ?? undefined,
      targetId: c.targetId ?? undefined,
      campaignId: c.campaignId ?? undefined,
      adGroupId: c.adGroupId ?? undefined,
      hourOfDay: c.hourOfDay ?? new Date().getHours(),
      dayOfWeek: c.dayOfWeek ?? new Date().getDay(),
      isHoliday: c.isHoliday ?? 0,
      estimatedCompetition: Number(c.estimatedCompetition) || 0,
      cpcVolatility7d: Number(c.cpcVolatility7d) || 0,
      ctrVolatility7d: Number(c.ctrVolatility7d) || 0,
      impressionShare: Number(c.impressionShare) || 0.5,
      avgCpc7d: Number(c.avgCpc7d) || 0,
      avgCtr7d: Number(c.avgCtr7d) || 0,
      avgCvr7d: Number(c.avgCvr7d) || 0,
      weightedAcos14d: Number(c.weightedAcos14d) || 0,
      impressionTrend7d: Number(c.impressionTrend7d) || 0,
      clickTrend7d: Number(c.clickTrend7d) || 0,
      orderTrend7d: Number(c.orderTrend7d) || 0,
      spendTrend7d: Number(c.spendTrend7d) || 0,
      weightedCvr14d: Number(c.weightedCvr14d) || 0,
      weightedRoas14d: Number(c.weightedRoas14d) || 0,
    };
  }
  
  // 缓存不存在，实时计算
  return extractFeatureVector(accountId, keywordId, targetId, campaignId);
}
