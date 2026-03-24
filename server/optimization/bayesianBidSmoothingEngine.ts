/**
 * v491: 贝叶斯平滑竞价推断引擎 (Bayesian Bid Smoothing Engine)
 * 
 * 核心目标：
 * 当某个投放词/ASIN/受众/分类没有Amazon suggestedBid时，
 * 通过贝叶斯平滑从同账户/同类型/同品类的历史竞价数据中推断出合理的基础竞价。
 * 
 * 贝叶斯原理：
 * - 先验分布 (Prior): 同账户下同类型实体的竞价分布（均值μ₀, 方差σ₀²）
 * - 似然 (Likelihood): 当前实体自身的出价历史和绩效数据
 * - 后验分布 (Posterior): 融合先验和似然后的竞价估计
 * 
 * 优先级链（在无suggestedBid时）：
 * 1. 贝叶斯平滑推断竞价（如果有足够的同类实体数据）
 * 2. 当前人为设定竞价 + 基础规则调整（fallback）
 * 
 * 数据来源：
 * - keywords表: 同账户下所有enabled关键词的bid, suggestedBid, matchType, keywordCpc等
 * - productTargets表: 同账户下所有enabled商品定向的bid, suggestedBid, targetType等
 * - autoTargetingSettings表: 自动广告匹配形式的bid, suggestedBid
 * - sdAudiences表: SD受众的bid
 */

import { getDb } from '../db';
import { keywords, productTargets, autoTargetingSettings, sdAudiences } from '../../drizzle/schema';
import { eq, and, gt, isNotNull, sql } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('BayesianBidSmoothing');

// ==================== 配置常量 ====================

const BAYESIAN_CONFIG = {
  /** 最少需要多少个同类实体才能构建有效先验 */
  MIN_PRIOR_SAMPLES: 5,
  /** 先验权重的最大值（即使有大量同类数据，先验权重也不超过此值） */
  MAX_PRIOR_WEIGHT: 0.60,
  /** 先验权重的最小值（低于此值认为先验不可靠） */
  MIN_PRIOR_WEIGHT: 0.15,
  /** 使用suggestedBid作为先验时的额外权重加成 */
  SUGGESTED_BID_WEIGHT_BONUS: 0.15,
  /** 先验分布的默认标准差系数（相对于均值的比例） */
  DEFAULT_CV: 0.40,
  /** 后验置信度的基础值 */
  BASE_CONFIDENCE: 0.40,
  /** 每增加一个先验样本，置信度增加的量 */
  CONFIDENCE_PER_SAMPLE: 0.008,
  /** 最大置信度 */
  MAX_CONFIDENCE: 0.70,
};

// ==================== 类型定义 ====================

/** 贝叶斯先验分布参数 */
interface BayesianPrior {
  /** 先验均值 */
  priorMean: number;
  /** 先验标准差 */
  priorStd: number;
  /** 先验样本数 */
  priorSampleCount: number;
  /** 先验中有suggestedBid的样本数 */
  suggestedBidCount: number;
  /** 先验中suggestedBid的均值（如果有） */
  suggestedBidMean: number | null;
  /** 先验来源描述 */
  source: string;
}

/** 贝叶斯平滑竞价推断结果 */
export interface BayesianBidEstimate {
  /** 是否成功推断 */
  success: boolean;
  /** 推断的基础竞价 */
  estimatedBid: number;
  /** 推断的竞价下界 */
  bidRangeLow: number;
  /** 推断的竞价上界 */
  bidRangeHigh: number;
  /** 置信度 (0-1) */
  confidence: number;
  /** 先验权重（先验在后验中的占比） */
  priorWeight: number;
  /** 先验分布参数 */
  prior: BayesianPrior;
  /** 推断方法说明 */
  method: string;
  /** 诊断信息 */
  diagnosis: string;
}

// ==================== 核心函数 ====================

/**
 * 为单个关键词推断贝叶斯平滑竞价
 * 
 * @param accountId 账户ID
 * @param currentBid 当前人为设定的出价
 * @param matchType 匹配类型 (broad/phrase/exact)
 * @param campaignType 广告活动类型 (sp_manual/sp_auto/sb/sd等)
 * @param entityPerformance 实体自身的绩效数据（如果有）
 */
export async function estimateKeywordBid(
  accountId: number,
  currentBid: number,
  matchType?: string,
  campaignType?: string,
  entityPerformance?: { impressions: number; clicks: number; spend: number; sales: number; orders: number },
  campaignId?: string,
): Promise<BayesianBidEstimate> {
  try {
    // v511: 优先使用活动级先验（更精确），回退到账户级先验
    let prior: BayesianPrior | null = null;
    
    // Step 1a: 尝试活动级先验
    if (campaignId) {
      prior = await buildCampaignLevelKeywordPrior(accountId, campaignId, matchType);
      if (prior) {
        log.info(`[BayesianBidSmoothing] 使用活动级先验: ${prior.source}`);
      }
    }
    
    // Step 1b: 活动级先验不足，回退到账户级先验
    if (!prior || prior.priorSampleCount < 3) {
      prior = await buildKeywordPrior(accountId, matchType);
    }
    
    if (!prior || prior.priorSampleCount < BAYESIAN_CONFIG.MIN_PRIOR_SAMPLES) {
      return createFailedEstimate(currentBid, '同类关键词数据不足，无法构建有效先验');
    }

    // Step 2: 计算后验分布
    const posterior = calculatePosterior(prior, currentBid, entityPerformance);
    
    return posterior;
  } catch (err: unknown) {
    log.warn(`[BayesianBidSmoothing] 关键词竞价推断异常: ${(err as Error).message}`);
    return createFailedEstimate(currentBid, `推断异常: ${(err as Error).message}`);
  }
}

/**
 * 为单个商品定向（ASIN/分类）推断贝叶斯平滑竞价
 */
export async function estimateProductTargetBid(
  accountId: number,
  currentBid: number,
  targetType?: string,
  entityPerformance?: { impressions: number; clicks: number; spend: number; sales: number; orders: number },
  campaignId?: string,
): Promise<BayesianBidEstimate> {
  try {
    // v511: 优先使用活动级先验，回退到账户级先验
    let prior: BayesianPrior | null = null;
    
    if (campaignId) {
      prior = await buildCampaignLevelTargetPrior(accountId, campaignId, targetType);
      if (prior) {
        log.info(`[BayesianBidSmoothing] 使用活动级先验: ${prior.source}`);
      }
    }
    
    if (!prior || prior.priorSampleCount < 3) {
      prior = await buildProductTargetPrior(accountId, targetType);
    }
    
    if (!prior || prior.priorSampleCount < BAYESIAN_CONFIG.MIN_PRIOR_SAMPLES) {
      return createFailedEstimate(currentBid, '同类商品定向数据不足，无法构建有效先验');
    }

    return calculatePosterior(prior, currentBid, entityPerformance);
  } catch (err: unknown) {
    log.warn(`[BayesianBidSmoothing] 商品定向竞价推断异常: ${(err as Error).message}`);
    return createFailedEstimate(currentBid, `推断异常: ${(err as Error).message}`);
  }
}

/**
 * 为自动广告匹配形式推断贝叶斯平滑竞价
 */
export async function estimateAutoTargetingBid(
  accountId: number,
  currentBid: number,
  targetingType?: string,
): Promise<BayesianBidEstimate> {
  try {
    const prior = await buildAutoTargetingPrior(accountId, targetingType);
    
    if (!prior || prior.priorSampleCount < BAYESIAN_CONFIG.MIN_PRIOR_SAMPLES) {
      return createFailedEstimate(currentBid, '同类自动匹配形式数据不足，无法构建有效先验');
    }

    return calculatePosterior(prior, currentBid, undefined);
  } catch (err: unknown) {
    log.warn(`[BayesianBidSmoothing] 自动匹配竞价推断异常: ${(err as Error).message}`);
    return createFailedEstimate(currentBid, `推断异常: ${(err as Error).message}`);
  }
}

/**
 * 为SD受众推断贝叶斯平滑竞价
 */
export async function estimateAudienceBid(
  accountId: number,
  currentBid: number,
  audienceType?: string,
): Promise<BayesianBidEstimate> {
  try {
    const prior = await buildAudiencePrior(accountId, audienceType);
    
    if (!prior || prior.priorSampleCount < BAYESIAN_CONFIG.MIN_PRIOR_SAMPLES) {
      return createFailedEstimate(currentBid, '同类受众数据不足，无法构建有效先验');
    }

    return calculatePosterior(prior, currentBid, undefined);
  } catch (err: unknown) {
    log.warn(`[BayesianBidSmoothing] 受众竞价推断异常: ${(err as Error).message}`);
    return createFailedEstimate(currentBid, `推断异常: ${(err as Error).message}`);
  }
}

/**
 * 通用入口：根据实体类型自动选择推断方法
 * 
 * @param accountId 账户ID
 * @param entityType 实体类型
 * @param currentBid 当前出价
 * @param subType 子类型（matchType/targetType/targetingType/audienceType）
 * @param entityPerformance 实体绩效数据
 */
export async function estimateBid(
  accountId: number,
  entityType: 'keyword' | 'product_target' | 'auto_targeting' | 'audience',
  currentBid: number,
  subType?: string,
  entityPerformance?: { impressions: number; clicks: number; spend: number; sales: number; orders: number },
): Promise<BayesianBidEstimate> {
  switch (entityType) {
    case 'keyword':
      return estimateKeywordBid(accountId, currentBid, subType, undefined, entityPerformance);
    case 'product_target':
      return estimateProductTargetBid(accountId, currentBid, subType, entityPerformance);
    case 'auto_targeting':
      return estimateAutoTargetingBid(accountId, currentBid, subType);
    case 'audience':
      return estimateAudienceBid(accountId, currentBid, subType);
    default:
      return createFailedEstimate(currentBid, `未知实体类型: ${entityType}`);
  }
}

// ==================== 先验构建函数 ====================

/**
 * v511: 从同Campaign内的关键词构建活动级先验分布
 * 比账户级先验更精确，因为同活动内的关键词竞争环境和客单价更接近
 */
async function buildCampaignLevelKeywordPrior(
  accountId: number,
  campaignId: string,
  matchType?: string,
): Promise<BayesianPrior | null> {
  const db = await getDb();
  if (!db) return null;

  const conditions: unknown[] = [
    eq(keywords.accountId, accountId),
    eq(keywords.campaignId, campaignId),
    eq(keywords.keywordStatus, 'enabled'),
    gt(keywords.bid, '0'),
  ];
  
  if (matchType) {
    conditions.push(eq(keywords.matchType, matchType as 'broad' | 'phrase' | 'exact'));
  }

  const [stats] = await db.select({
    count: sql<number>`COUNT(*)`,
    avgBid: sql<number>`AVG(CAST(${keywords.bid} AS DECIMAL(10,4)))`,
    stdBid: sql<number>`STDDEV(CAST(${keywords.bid} AS DECIMAL(10,4)))`,
    suggestedBidCount: sql<number>`SUM(CASE WHEN ${keywords.suggestedBid} IS NOT NULL AND ${keywords.suggestedBid} > 0 THEN 1 ELSE 0 END)`,
    avgSuggestedBid: sql<number>`AVG(CASE WHEN ${keywords.suggestedBid} IS NOT NULL AND ${keywords.suggestedBid} > 0 THEN CAST(${keywords.suggestedBid} AS DECIMAL(10,4)) ELSE NULL END)`,
    avgCpc: sql<number>`AVG(CASE WHEN ${keywords.keywordCpc} IS NOT NULL AND ${keywords.keywordCpc} > 0 THEN CAST(${keywords.keywordCpc} AS DECIMAL(10,4)) ELSE NULL END)`,
  })
  .from(keywords)
  .where(and(...(conditions as Parameters<typeof and>)));

  const count = Number(stats?.count || 0);
  // 活动级先验需要至少3个样本（比账户级的5个更宽松，因为同活动数据更精确）
  if (count < 3) {
    if (matchType) {
      return buildCampaignLevelKeywordPrior(accountId, campaignId, undefined);
    }
    return null;
  }

  const avgBid = Number(stats?.avgBid || 0);
  const stdBid = Number(stats?.stdBid || 0) || avgBid * BAYESIAN_CONFIG.DEFAULT_CV;
  const suggestedBidCount = Number(stats?.suggestedBidCount || 0);
  const avgSuggestedBid = stats?.avgSuggestedBid ? Number(stats.avgSuggestedBid) : null;
  const avgCpc = stats?.avgCpc ? Number(stats.avgCpc) : null;

  let priorMean: number;
  let source: string;
  
  if (avgSuggestedBid && suggestedBidCount >= 2) {
    priorMean = avgSuggestedBid * 0.6 + avgBid * 0.4;
    source = `活动级suggestedBid加权(${suggestedBidCount}个suggestedBid, ${count}个bid, campaign=${campaignId})`;
  } else if (avgCpc && avgCpc > 0) {
    priorMean = avgCpc * 0.5 + avgBid * 0.5;
    source = `活动级CPC加权(avgCpc=$${avgCpc.toFixed(2)}, ${count}个bid, campaign=${campaignId})`;
  } else {
    priorMean = avgBid;
    source = `活动级bid均值(${count}个${matchType || '全部'}关键词, campaign=${campaignId})`;
  }

  return {
    priorMean: Math.max(0.02, priorMean),
    priorStd: Math.max(0.01, stdBid),
    priorSampleCount: count,
    suggestedBidCount,
    suggestedBidMean: avgSuggestedBid,
    source,
  };
}

/**
 * v511: 从同Campaign内的商品定向构建活动级先验分布
 */
async function buildCampaignLevelTargetPrior(
  accountId: number,
  campaignId: string,
  targetType?: string,
): Promise<BayesianPrior | null> {
  const db = await getDb();
  if (!db) return null;

  const conditions: unknown[] = [
    eq(productTargets.accountId, accountId),
    eq(productTargets.campaignId, campaignId),
    eq(productTargets.targetStatus, 'enabled'),
    gt(productTargets.bid, '0'),
  ];
  
  if (targetType) {
    conditions.push(eq(productTargets.targetType, targetType as 'asin' | 'category'));
  }

  const [stats] = await db.select({
    count: sql<number>`COUNT(*)`,
    avgBid: sql<number>`AVG(CAST(${productTargets.bid} AS DECIMAL(10,4)))`,
    stdBid: sql<number>`STDDEV(CAST(${productTargets.bid} AS DECIMAL(10,4)))`,
    suggestedBidCount: sql<number>`SUM(CASE WHEN ${productTargets.suggestedBid} IS NOT NULL AND ${productTargets.suggestedBid} > 0 THEN 1 ELSE 0 END)`,
    avgSuggestedBid: sql<number>`AVG(CASE WHEN ${productTargets.suggestedBid} IS NOT NULL AND ${productTargets.suggestedBid} > 0 THEN CAST(${productTargets.suggestedBid} AS DECIMAL(10,4)) ELSE NULL END)`,
    avgCpc: sql<number>`AVG(CASE WHEN ${productTargets.targetCpc} IS NOT NULL AND ${productTargets.targetCpc} > 0 THEN CAST(${productTargets.targetCpc} AS DECIMAL(10,4)) ELSE NULL END)`,
  })
  .from(productTargets)
  .where(and(...(conditions as Parameters<typeof and>)));

  const count = Number(stats?.count || 0);
  if (count < 3) {
    if (targetType) {
      return buildCampaignLevelTargetPrior(accountId, campaignId, undefined);
    }
    return null;
  }

  const avgBid = Number(stats?.avgBid || 0);
  const stdBid = Number(stats?.stdBid || 0) || avgBid * BAYESIAN_CONFIG.DEFAULT_CV;
  const suggestedBidCount = Number(stats?.suggestedBidCount || 0);
  const avgSuggestedBid = stats?.avgSuggestedBid ? Number(stats.avgSuggestedBid) : null;
  const avgCpc = stats?.avgCpc ? Number(stats.avgCpc) : null;

  let priorMean: number;
  let source: string;
  
  if (avgSuggestedBid && suggestedBidCount >= 2) {
    priorMean = avgSuggestedBid * 0.6 + avgBid * 0.4;
    source = `活动级suggestedBid加权(${suggestedBidCount}个suggestedBid, ${count}个${targetType || '全部'}定向, campaign=${campaignId})`;
  } else if (avgCpc && avgCpc > 0) {
    priorMean = avgCpc * 0.5 + avgBid * 0.5;
    source = `活动级CPC加权(avgCpc=$${avgCpc.toFixed(2)}, ${count}个定向, campaign=${campaignId})`;
  } else {
    priorMean = avgBid;
    source = `活动级bid均值(${count}个${targetType || '全部'}定向, campaign=${campaignId})`;
  }

  return {
    priorMean: Math.max(0.02, priorMean),
    priorStd: Math.max(0.01, stdBid),
    priorSampleCount: count,
    suggestedBidCount,
    suggestedBidMean: avgSuggestedBid,
    source,
  };
}

/**
 * 从同账户同匹配类型的关键词中构建先验分布
 */
async function buildKeywordPrior(
  accountId: number,
  matchType?: string,
): Promise<BayesianPrior | null> {
  const db = await getDb();
  if (!db) return null;

  // 查询同账户下所有enabled关键词的出价统计
  // 如果指定了matchType，优先使用同匹配类型的数据；否则使用全部
  const conditions = [
    eq(keywords.accountId, accountId),
    eq(keywords.keywordStatus, 'enabled'),
    gt(keywords.bid, '0'),
  ];
  
  if (matchType) {
    conditions.push(eq(keywords.matchType, matchType as 'broad' | 'phrase' | 'exact'));
  }

  const [stats] = await db.select({
    count: sql<number>`COUNT(*)`,
    avgBid: sql<number>`AVG(CAST(${keywords.bid} AS DECIMAL(10,4)))`,
    stdBid: sql<number>`STDDEV(CAST(${keywords.bid} AS DECIMAL(10,4)))`,
    suggestedBidCount: sql<number>`SUM(CASE WHEN ${keywords.suggestedBid} IS NOT NULL AND ${keywords.suggestedBid} > 0 THEN 1 ELSE 0 END)`,
    avgSuggestedBid: sql<number>`AVG(CASE WHEN ${keywords.suggestedBid} IS NOT NULL AND ${keywords.suggestedBid} > 0 THEN CAST(${keywords.suggestedBid} AS DECIMAL(10,4)) ELSE NULL END)`,
    avgCpc: sql<number>`AVG(CASE WHEN ${keywords.keywordCpc} IS NOT NULL AND ${keywords.keywordCpc} > 0 THEN CAST(${keywords.keywordCpc} AS DECIMAL(10,4)) ELSE NULL END)`,
  })
  .from(keywords)
  .where(and(...conditions));

  const count = Number(stats?.count || 0);
  if (count < BAYESIAN_CONFIG.MIN_PRIOR_SAMPLES) {
    // 如果同匹配类型数据不足，尝试使用全部匹配类型
    if (matchType) {
      return buildKeywordPrior(accountId, undefined);
    }
    return null;
  }

  const avgBid = Number(stats?.avgBid || 0);
  const stdBid = Number(stats?.stdBid || 0) || avgBid * BAYESIAN_CONFIG.DEFAULT_CV;
  const suggestedBidCount = Number(stats?.suggestedBidCount || 0);
  const avgSuggestedBid = stats?.avgSuggestedBid ? Number(stats.avgSuggestedBid) : null;
  const avgCpc = stats?.avgCpc ? Number(stats.avgCpc) : null;

  // 先验均值：优先使用suggestedBid均值（如果有足够样本），其次使用实际CPC均值，最后使用bid均值
  let priorMean: number;
  let source: string;
  
  if (avgSuggestedBid && suggestedBidCount >= 3) {
    // 有足够的suggestedBid数据：使用suggestedBid和实际bid的加权平均
    priorMean = avgSuggestedBid * 0.6 + avgBid * 0.4;
    source = `suggestedBid加权(${suggestedBidCount}个suggestedBid, ${count}个bid)`;
  } else if (avgCpc && avgCpc > 0) {
    // 有CPC数据：使用CPC和bid的加权平均（CPC反映实际市场价格）
    priorMean = avgCpc * 0.5 + avgBid * 0.5;
    source = `CPC加权(avgCpc=$${avgCpc.toFixed(2)}, ${count}个bid)`;
  } else {
    priorMean = avgBid;
    source = `bid均值(${count}个${matchType || '全部'}关键词)`;
  }

  return {
    priorMean: Math.max(0.02, priorMean),
    priorStd: Math.max(0.01, stdBid),
    priorSampleCount: count,
    suggestedBidCount,
    suggestedBidMean: avgSuggestedBid,
    source,
  };
}

/**
 * 从同账户的商品定向中构建先验分布
 */
async function buildProductTargetPrior(
  accountId: number,
  targetType?: string,
): Promise<BayesianPrior | null> {
  const db = await getDb();
  if (!db) return null;

  const conditions = [
    eq(productTargets.accountId, accountId),
    eq(productTargets.targetStatus, 'enabled'),
    gt(productTargets.bid, '0'),
  ];
  
  if (targetType) {
    conditions.push(eq(productTargets.targetType, targetType as 'asin' | 'category'));
  }

  const [stats] = await db.select({
    count: sql<number>`COUNT(*)`,
    avgBid: sql<number>`AVG(CAST(${productTargets.bid} AS DECIMAL(10,4)))`,
    stdBid: sql<number>`STDDEV(CAST(${productTargets.bid} AS DECIMAL(10,4)))`,
    suggestedBidCount: sql<number>`SUM(CASE WHEN ${productTargets.suggestedBid} IS NOT NULL AND ${productTargets.suggestedBid} > 0 THEN 1 ELSE 0 END)`,
    avgSuggestedBid: sql<number>`AVG(CASE WHEN ${productTargets.suggestedBid} IS NOT NULL AND ${productTargets.suggestedBid} > 0 THEN CAST(${productTargets.suggestedBid} AS DECIMAL(10,4)) ELSE NULL END)`,
    avgCpc: sql<number>`AVG(CASE WHEN ${productTargets.targetCpc} IS NOT NULL AND ${productTargets.targetCpc} > 0 THEN CAST(${productTargets.targetCpc} AS DECIMAL(10,4)) ELSE NULL END)`,
  })
  .from(productTargets)
  .where(and(...conditions));

  const count = Number(stats?.count || 0);
  if (count < BAYESIAN_CONFIG.MIN_PRIOR_SAMPLES) {
    if (targetType) {
      return buildProductTargetPrior(accountId, undefined);
    }
    return null;
  }

  const avgBid = Number(stats?.avgBid || 0);
  const stdBid = Number(stats?.stdBid || 0) || avgBid * BAYESIAN_CONFIG.DEFAULT_CV;
  const suggestedBidCount = Number(stats?.suggestedBidCount || 0);
  const avgSuggestedBid = stats?.avgSuggestedBid ? Number(stats.avgSuggestedBid) : null;
  const avgCpc = stats?.avgCpc ? Number(stats.avgCpc) : null;

  let priorMean: number;
  let source: string;
  
  if (avgSuggestedBid && suggestedBidCount >= 3) {
    priorMean = avgSuggestedBid * 0.6 + avgBid * 0.4;
    source = `suggestedBid加权(${suggestedBidCount}个suggestedBid, ${count}个${targetType || '全部'}定向)`;
  } else if (avgCpc && avgCpc > 0) {
    priorMean = avgCpc * 0.5 + avgBid * 0.5;
    source = `CPC加权(avgCpc=$${avgCpc.toFixed(2)}, ${count}个定向)`;
  } else {
    priorMean = avgBid;
    source = `bid均值(${count}个${targetType || '全部'}定向)`;
  }

  return {
    priorMean: Math.max(0.02, priorMean),
    priorStd: Math.max(0.01, stdBid),
    priorSampleCount: count,
    suggestedBidCount,
    suggestedBidMean: avgSuggestedBid,
    source,
  };
}

/**
 * 从同账户的自动广告匹配形式中构建先验分布
 */
async function buildAutoTargetingPrior(
  accountId: number,
  targetingType?: string,
): Promise<BayesianPrior | null> {
  const db = await getDb();
  if (!db) return null;

  // autoTargetingSettings表没有accountId字段，需要通过campaign关联
  // 简化处理：直接查询所有有bid的自动匹配设置
  const conditions: unknown[] = [
    eq(autoTargetingSettings.targetingStatus, 'enabled'),
  ];
  
  if (targetingType) {
    conditions.push(eq(autoTargetingSettings.targetingType, targetingType as 'close_match' | 'loose_match' | 'substitutes' | 'complements'));
  }

  const [stats] = await db.select({
    count: sql<number>`COUNT(*)`,
    avgBid: sql<number>`AVG(CASE WHEN ${autoTargetingSettings.bid} IS NOT NULL AND ${autoTargetingSettings.bid} > 0 THEN CAST(${autoTargetingSettings.bid} AS DECIMAL(10,4)) ELSE NULL END)`,
    stdBid: sql<number>`STDDEV(CASE WHEN ${autoTargetingSettings.bid} IS NOT NULL AND ${autoTargetingSettings.bid} > 0 THEN CAST(${autoTargetingSettings.bid} AS DECIMAL(10,4)) ELSE NULL END)`,
    suggestedBidCount: sql<number>`SUM(CASE WHEN ${autoTargetingSettings.suggestedBid} IS NOT NULL AND ${autoTargetingSettings.suggestedBid} > 0 THEN 1 ELSE 0 END)`,
    avgSuggestedBid: sql<number>`AVG(CASE WHEN ${autoTargetingSettings.suggestedBid} IS NOT NULL AND ${autoTargetingSettings.suggestedBid} > 0 THEN CAST(${autoTargetingSettings.suggestedBid} AS DECIMAL(10,4)) ELSE NULL END)`,
  })
  .from(autoTargetingSettings)
  .where(and(...(conditions as Parameters<typeof and>)));

  const count = Number(stats?.count || 0);
  if (count < BAYESIAN_CONFIG.MIN_PRIOR_SAMPLES) {
    if (targetingType) {
      return buildAutoTargetingPrior(accountId, undefined);
    }
    return null;
  }

  const avgBid = Number(stats?.avgBid || 0);
  const stdBid = Number(stats?.stdBid || 0) || avgBid * BAYESIAN_CONFIG.DEFAULT_CV;
  const suggestedBidCount = Number(stats?.suggestedBidCount || 0);
  const avgSuggestedBid = stats?.avgSuggestedBid ? Number(stats.avgSuggestedBid) : null;

  let priorMean: number;
  let source: string;
  
  if (avgSuggestedBid && suggestedBidCount >= 3) {
    priorMean = avgSuggestedBid * 0.6 + avgBid * 0.4;
    source = `suggestedBid加权(${suggestedBidCount}个suggestedBid, ${count}个${targetingType || '全部'}自动匹配)`;
  } else {
    priorMean = avgBid;
    source = `bid均值(${count}个${targetingType || '全部'}自动匹配)`;
  }

  return {
    priorMean: Math.max(0.02, priorMean),
    priorStd: Math.max(0.01, stdBid),
    priorSampleCount: count,
    suggestedBidCount,
    suggestedBidMean: avgSuggestedBid,
    source,
  };
}

/**
 * 从同账户的SD受众中构建先验分布
 */
async function buildAudiencePrior(
  accountId: number,
  audienceType?: string,
): Promise<BayesianPrior | null> {
  const db = await getDb();
  if (!db) return null;

  const conditions = [
    eq(sdAudiences.accountId, accountId),
    eq(sdAudiences.state, 'enabled'),
  ];
  
  if (audienceType) {
    conditions.push(eq(sdAudiences.audienceType, audienceType as 'views' | 'purchases' | 'inMarket' | 'lifestyle' | 'custom'));
  }

  const [stats] = await db.select({
    count: sql<number>`COUNT(*)`,
    avgBid: sql<number>`AVG(CASE WHEN ${sdAudiences.bid} IS NOT NULL AND ${sdAudiences.bid} > 0 THEN CAST(${sdAudiences.bid} AS DECIMAL(10,4)) ELSE NULL END)`,
    stdBid: sql<number>`STDDEV(CASE WHEN ${sdAudiences.bid} IS NOT NULL AND ${sdAudiences.bid} > 0 THEN CAST(${sdAudiences.bid} AS DECIMAL(10,4)) ELSE NULL END)`,
  })
  .from(sdAudiences)
  .where(and(...conditions));

  const count = Number(stats?.count || 0);
  if (count < BAYESIAN_CONFIG.MIN_PRIOR_SAMPLES) {
    if (audienceType) {
      return buildAudiencePrior(accountId, undefined);
    }
    return null;
  }

  const avgBid = Number(stats?.avgBid || 0);
  const stdBid = Number(stats?.stdBid || 0) || avgBid * BAYESIAN_CONFIG.DEFAULT_CV;

  return {
    priorMean: Math.max(0.02, avgBid),
    priorStd: Math.max(0.01, stdBid),
    priorSampleCount: count,
    suggestedBidCount: 0,
    suggestedBidMean: null,
    source: `bid均值(${count}个${audienceType || '全部'}受众)`,
  };
}

// ==================== 后验计算 ====================

/**
 * 计算贝叶斯后验分布
 * 
 * 使用正态-正态共轭先验模型：
 * - 先验: N(μ₀, σ₀²/n₀)  其中n₀是先验等效样本数
 * - 似然: 当前出价 x 视为单个观测
 * - 后验均值: (n₀ * μ₀ + x) / (n₀ + 1)
 * 
 * 但我们不是简单地做均值融合，而是：
 * 1. 如果实体有绩效数据（点击/转化），根据绩效调整先验权重
 * 2. 如果实体CPC远低于先验均值，说明可能有提价空间
 * 3. 如果实体ACOS过高，说明可能需要降价
 */
function calculatePosterior(
  prior: BayesianPrior,
  currentBid: number,
  entityPerformance?: { impressions: number; clicks: number; spend: number; sales: number; orders: number },
): BayesianBidEstimate {
  // 计算先验权重：基于样本数的对数函数，避免过度依赖先验
  // n₀ = log2(priorSampleCount) * scaleFactor
  const logSamples = Math.log2(Math.max(1, prior.priorSampleCount));
  let priorWeight = Math.min(
    BAYESIAN_CONFIG.MAX_PRIOR_WEIGHT,
    Math.max(BAYESIAN_CONFIG.MIN_PRIOR_WEIGHT, logSamples * 0.10)
  );

  // 如果先验中有suggestedBid数据，增加先验权重（因为suggestedBid反映市场竞争）
  if (prior.suggestedBidCount > 0 && prior.suggestedBidMean) {
    priorWeight = Math.min(BAYESIAN_CONFIG.MAX_PRIOR_WEIGHT, priorWeight + BAYESIAN_CONFIG.SUGGESTED_BID_WEIGHT_BONUS);
  }

  // 绩效调整：如果实体有自身绩效数据，降低先验权重（让自身数据说话）
  let performanceAdjustment = 1.0;
  if (entityPerformance) {
    if (entityPerformance.clicks >= 20) {
      // 有足够点击数据：大幅降低先验权重
      performanceAdjustment = 0.40;
    } else if (entityPerformance.clicks >= 5) {
      // 有一些点击数据：适度降低先验权重
      performanceAdjustment = 0.65;
    } else if (entityPerformance.impressions >= 100) {
      // 有曝光但点击少：轻微降低先验权重
      performanceAdjustment = 0.85;
    }
  }
  priorWeight *= performanceAdjustment;

  // 后验均值计算
  // posteriorMean = priorWeight * priorMean + (1 - priorWeight) * currentBid
  const posteriorMean = priorWeight * prior.priorMean + (1 - priorWeight) * currentBid;

  // 后验标准差（用于计算置信区间）
  // 融合先验标准差和当前出价与先验均值的偏差
  const bidDeviation = Math.abs(currentBid - prior.priorMean);
  const posteriorStd = Math.sqrt(
    priorWeight * prior.priorStd * prior.priorStd +
    (1 - priorWeight) * bidDeviation * bidDeviation
  );

  // 计算竞价区间（95%置信区间的近似）
  const bidRangeLow = Math.max(0.02, posteriorMean - 1.5 * posteriorStd);
  const bidRangeHigh = posteriorMean + 1.5 * posteriorStd;

  // 计算置信度
  let confidence = BAYESIAN_CONFIG.BASE_CONFIDENCE +
    Math.min(0.20, prior.priorSampleCount * BAYESIAN_CONFIG.CONFIDENCE_PER_SAMPLE);
  
  // suggestedBid数据增加置信度
  if (prior.suggestedBidCount >= 3) {
    confidence += 0.08;
  }
  
  // 当前出价与先验均值接近时增加置信度（一致性加成）
  const relativeDiff = Math.abs(currentBid - prior.priorMean) / prior.priorMean;
  if (relativeDiff < 0.20) {
    confidence += 0.05;
  } else if (relativeDiff > 0.80) {
    confidence -= 0.05; // 偏差过大，降低置信度
  }

  confidence = Math.min(BAYESIAN_CONFIG.MAX_CONFIDENCE, Math.max(0.20, confidence));

  const estimatedBid = Math.max(0.02, Math.round(posteriorMean * 100) / 100);

  const method = `贝叶斯平滑(先验=${prior.source}, 权重=${(priorWeight * 100).toFixed(0)}%, ` +
    `先验均值=$${prior.priorMean.toFixed(2)}, 当前出价=$${currentBid.toFixed(2)})`;

  const diagnosis = `后验竞价=$${estimatedBid.toFixed(2)} ` +
    `(先验$${prior.priorMean.toFixed(2)}×${(priorWeight * 100).toFixed(0)}% + 当前$${currentBid.toFixed(2)}×${((1 - priorWeight) * 100).toFixed(0)}%), ` +
    `区间=[$${bidRangeLow.toFixed(2)}-$${bidRangeHigh.toFixed(2)}], ` +
    `置信度=${(confidence * 100).toFixed(0)}%, 样本数=${prior.priorSampleCount}`;

  log.info(`[BayesianBidSmoothing] ${diagnosis}`);

  return {
    success: true,
    estimatedBid,
    bidRangeLow: Math.round(bidRangeLow * 100) / 100,
    bidRangeHigh: Math.round(bidRangeHigh * 100) / 100,
    confidence,
    priorWeight,
    prior,
    method,
    diagnosis,
  };
}

// ==================== 辅助函数 ====================

function createFailedEstimate(currentBid: number, reason: string): BayesianBidEstimate {
  return {
    success: false,
    estimatedBid: currentBid,
    bidRangeLow: currentBid * 0.70,
    bidRangeHigh: currentBid * 1.30,
    confidence: 0,
    priorWeight: 0,
    prior: {
      priorMean: 0,
      priorStd: 0,
      priorSampleCount: 0,
      suggestedBidCount: 0,
      suggestedBidMean: null,
      source: 'none',
    },
    method: 'failed',
    diagnosis: reason,
  };
}
