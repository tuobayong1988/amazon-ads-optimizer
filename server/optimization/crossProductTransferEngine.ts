/**
 * 跨品迁移学习增强引擎 (Cross-Product Transfer Learning Engine)
 * 
 * v489: 将同类目老品的CVR、CPC、出价系数迁移给新品，加速冷启动。
 * 
 * 核心思路：
 * 1. 定义"产品相似度"：基于广告活动类型、绩效组、价格区间、竞争度等特征
 * 2. 找到同账户下最相似的成熟广告活动（有充足历史数据）
 * 3. 将成熟品的优化参数作为新品的初始先验值
 * 4. 随着新品数据积累，逐步降低迁移权重，过渡到自身数据驱动
 * 
 * 集成方式：
 * - 在 coldStartService.ts 的阶段2（历史数据优化）之前调用
 * - 在 suggestedBidColdStartEngine.ts 中作为无建议竞价时的fallback
 * - 在 nextGenBidOrchestrator.ts 中为冷启动期关键词提供先验参数
 */

import { getDb } from '../db';
import { campaigns, keywords, dailyPerformance } from '../../drizzle/schema';
import { eq, and, gte, lte, sql, desc, isNotNull } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('CrossProductTransfer');

// ==================== 配置常量 ====================

const TRANSFER_CONFIG = {
  /** 成熟广告活动的最低点击数阈值 */
  MATURE_MIN_CLICKS: 200,
  /** 成熟广告活动的最低运行天数 */
  MATURE_MIN_DAYS: 14,
  /** 新品广告活动的最大点击数（超过此值不再视为新品） */
  NEW_CAMPAIGN_MAX_CLICKS: 50,
  /** 新品广告活动的最大运行天数 */
  NEW_CAMPAIGN_MAX_DAYS: 14,
  /** 相似度阈值（低于此值不迁移） */
  SIMILARITY_THRESHOLD: 0.3,
  /** 迁移权重衰减系数（每天衰减的比例） */
  WEIGHT_DECAY_PER_DAY: 0.05,
  /** 最大迁移权重（第0天） */
  MAX_TRANSFER_WEIGHT: 0.7,
  /** 最小迁移权重（低于此值停止迁移） */
  MIN_TRANSFER_WEIGHT: 0.1,
  /** 最多匹配的相似广告活动数量 */
  MAX_SIMILAR_CAMPAIGNS: 5,
  /** 绩效数据回溯天数 */
  PERFORMANCE_LOOKBACK_DAYS: 30,
  /** 价格区间相似度的容差比例（±30%视为同价格区间） */
  PRICE_TOLERANCE_RATIO: 0.3,
};

// ==================== 类型定义 ====================

/** 广告活动特征向量 */
interface CampaignFeatures {
  campaignId: string;
  campaignName: string;
  campaignType: string;
  targetingType: string | null;
  performanceGroupId: number | null;
  dailyBudget: number;
  avgCpc: number;
  avgCvr: number;
  avgAcos: number;
  avgRoas: number;
  totalClicks: number;
  totalSpend: number;
  totalSales: number;
  totalOrders: number;
  totalImpressions: number;
  activeDays: number;
  avgBid: number;
  keywordCount: number;
  topSearchImpressionShare: number;
  createdAt: string;
}

/** 相似度匹配结果 */
interface SimilarityMatch {
  sourceCampaign: CampaignFeatures;
  targetCampaign: CampaignFeatures;
  similarityScore: number;
  similarityBreakdown: {
    typeScore: number;
    budgetScore: number;
    performanceGroupScore: number;
    namePatternScore: number;
    keywordOverlapScore: number;
  };
}

/** 迁移参数 */
export interface TransferParameters {
  /** 建议初始CPC */
  suggestedCpc: number;
  /** 建议初始出价 */
  suggestedBid: number;
  /** 预估CVR */
  estimatedCvr: number;
  /** 预估CTR */
  estimatedCtr: number;
  /** 参考ACoS */
  referenceAcos: number;
  /** 参考ROAS */
  referenceRoas: number;
  /** 建议日预算 */
  suggestedDailyBudget: number;
  /** 搜索结果顶部出价调整建议 */
  suggestedTopSearchAdjustment: number;
  /** 商品页面出价调整建议 */
  suggestedProductPageAdjustment: number;
  /** 迁移权重（0-1，随时间衰减） */
  transferWeight: number;
  /** 来源广告活动信息 */
  sourceInfo: {
    campaignIds: string[];
    campaignNames: string[];
    avgSimilarity: number;
    totalDataPoints: number;
  };
  /** 迁移置信度 */
  confidence: 'high' | 'medium' | 'low';
}

/** 迁移学习结果 */
export interface TransferLearningResult {
  accountId: number;
  newCampaignId: string;
  newCampaignName: string;
  parameters: TransferParameters | null;
  matchedCampaigns: number;
  reason: string;
}

// ==================== 核心函数 ====================

/**
 * 为新品广告活动生成迁移学习参数
 * 
 * @param accountId 账户ID
 * @param newCampaignId 新品广告活动ID
 * @returns 迁移参数或null（无法匹配时）
 */
export async function generateTransferParameters(
  accountId: number,
  newCampaignId: string
): Promise<TransferLearningResult> {
  const logPrefix = `[CrossProductTransfer] 账户=${accountId}, 新活动=${newCampaignId}`;
  
  try {
    // 1. 获取新品广告活动特征
    const newCampaign = await getCampaignFeatures(accountId, newCampaignId);
    if (!newCampaign) {
      return { accountId, newCampaignId, newCampaignName: '', parameters: null, matchedCampaigns: 0, reason: '新品广告活动不存在' };
    }
    
    // 2. 检查是否确实是新品（点击数少、运行时间短）
    if (newCampaign.totalClicks > TRANSFER_CONFIG.NEW_CAMPAIGN_MAX_CLICKS) {
      return { accountId, newCampaignId, newCampaignName: newCampaign.campaignName, parameters: null, matchedCampaigns: 0, reason: `已有${newCampaign.totalClicks}次点击，不需要迁移学习` };
    }
    
    // 3. 获取同账户下所有成熟广告活动
    const matureCampaigns = await getMatureCampaigns(accountId, newCampaignId);
    if (matureCampaigns.length === 0) {
      return { accountId, newCampaignId, newCampaignName: newCampaign.campaignName, parameters: null, matchedCampaigns: 0, reason: '账户中没有成熟的广告活动可供迁移' };
    }
    
    // 4. 计算相似度并排序
    const matches = matureCampaigns
      .map(mature => ({
        sourceCampaign: mature,
        targetCampaign: newCampaign,
        ...calculateSimilarity(newCampaign, mature),
      }))
      .filter(m => m.similarityScore >= TRANSFER_CONFIG.SIMILARITY_THRESHOLD)
      .sort((a, b) => b.similarityScore - a.similarityScore)
      .slice(0, TRANSFER_CONFIG.MAX_SIMILAR_CAMPAIGNS);
    
    if (matches.length === 0) {
      return { accountId, newCampaignId, newCampaignName: newCampaign.campaignName, parameters: null, matchedCampaigns: 0, reason: `找到${matureCampaigns.length}个成熟活动，但相似度均低于阈值${TRANSFER_CONFIG.SIMILARITY_THRESHOLD}` };
    }
    
    // 5. 加权聚合迁移参数
    const parameters = aggregateTransferParameters(matches, newCampaign);
    
    log.info(`${logPrefix} 迁移学习成功: 匹配${matches.length}个相似活动, 平均相似度=${parameters.sourceInfo.avgSimilarity.toFixed(3)}, 置信度=${parameters.confidence}, 建议CPC=${parameters.suggestedCpc.toFixed(2)}, 预估CVR=${(parameters.estimatedCvr * 100).toFixed(2)}%`);
    
    return {
      accountId,
      newCampaignId,
      newCampaignName: newCampaign.campaignName,
      parameters,
      matchedCampaigns: matches.length,
      reason: `成功匹配${matches.length}个相似广告活动`,
    };
    
  } catch (err: unknown) {
    log.warn(`${logPrefix} 迁移学习异常: ${(err as Error).message}`);
    return { accountId, newCampaignId, newCampaignName: '', parameters: null, matchedCampaigns: 0, reason: `异常: ${(err as Error).message}` };
  }
}

/**
 * 批量为账户下所有新品广告活动生成迁移参数
 */
export async function batchGenerateTransferParameters(
  accountId: number
): Promise<TransferLearningResult[]> {
  const logPrefix = `[CrossProductTransfer] 账户=${accountId}`;
  
  try {
    // 找到所有新品广告活动（点击数少、运行时间短）
    const newCampaigns = await getNewCampaigns(accountId);
    
    if (newCampaigns.length === 0) {
      log.info(`${logPrefix} 没有需要迁移学习的新品广告活动`);
      return [];
    }
    
    log.info(`${logPrefix} 发现${newCampaigns.length}个新品广告活动，开始批量迁移学习...`);
    
    const results: TransferLearningResult[] = [];
    for (const campaign of newCampaigns) {
      const result = await generateTransferParameters(accountId, campaign.campaignId);
      results.push(result);
    }
    
    const successCount = results.filter(r => r.parameters !== null).length;
    log.info(`${logPrefix} 批量迁移学习完成: ${successCount}/${newCampaigns.length}个活动成功匹配`);
    
    return results;
    
  } catch (err: unknown) {
    log.warn(`${logPrefix} 批量迁移学习异常: ${(err as Error).message}`);
    return [];
  }
}

/**
 * 计算迁移权重（随新品数据积累逐步衰减）
 * 
 * @param newCampaignClicks 新品已积累的点击数
 * @param newCampaignDays 新品已运行的天数
 * @returns 迁移权重 (0-1)
 */
export function calculateTransferWeight(
  newCampaignClicks: number,
  newCampaignDays: number
): number {
  // 基于时间的衰减
  const timeDecay = Math.max(0, 1 - newCampaignDays * TRANSFER_CONFIG.WEIGHT_DECAY_PER_DAY);
  
  // 基于数据量的衰减（点击数越多，越不需要迁移）
  const dataDecay = Math.max(0, 1 - newCampaignClicks / TRANSFER_CONFIG.NEW_CAMPAIGN_MAX_CLICKS);
  
  // 取两者的几何平均
  const weight = TRANSFER_CONFIG.MAX_TRANSFER_WEIGHT * Math.sqrt(timeDecay * dataDecay);
  
  return weight >= TRANSFER_CONFIG.MIN_TRANSFER_WEIGHT ? weight : 0;
}

/**
 * 将迁移参数与自身数据融合
 * 
 * @param transferValue 迁移的参数值
 * @param ownValue 自身数据计算的参数值
 * @param transferWeight 迁移权重
 * @returns 融合后的参数值
 */
export function blendTransferWithOwn(
  transferValue: number,
  ownValue: number,
  transferWeight: number
): number {
  if (transferWeight <= 0) return ownValue;
  if (ownValue <= 0) return transferValue * transferWeight;
  
  return transferValue * transferWeight + ownValue * (1 - transferWeight);
}

// ==================== 内部函数 ====================

/**
 * 获取单个广告活动的特征向量
 */
async function getCampaignFeatures(
  accountId: number,
  campaignId: string
): Promise<CampaignFeatures | null> {
  const db = await getDb();
  if (!db) return null;
  
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - TRANSFER_CONFIG.PERFORMANCE_LOOKBACK_DAYS);
  
  // 获取广告活动基本信息
  const [campaign] = await db.select()
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, accountId),
      eq(campaigns.campaignId, campaignId)
    ))
    .limit(1);
  
  if (!campaign) return null;
  
  // 获取绩效汇总
  const [perfSummary] = await db.select({
    totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    totalSpend: sql<number>`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
    totalSales: sql<number>`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
    totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
    activeDays: sql<number>`COUNT(DISTINCT DATE(${dailyPerformance.date}))`,
  })
  .from(dailyPerformance)
  .where(and(
    eq(dailyPerformance.accountId, accountId),
    eq(dailyPerformance.campaignId, campaignId),
    gte(dailyPerformance.date, lookbackDate.toISOString())
  ));
  
  // 获取关键词统计
  const [kwStats] = await db.select({
    keywordCount: sql<number>`COUNT(*)`,
    avgBid: sql<number>`COALESCE(AVG(${keywords.bid}), 0)`,
  })
  .from(keywords)
  .where(and(
    eq(keywords.accountId, accountId),
    eq(keywords.campaignId, campaignId),
    eq(keywords.keywordStatus, 'enabled')
  ));
  
  const totalClicks = Number(perfSummary?.totalClicks || 0);
  const totalSpend = Number(perfSummary?.totalSpend || 0);
  const totalSales = Number(perfSummary?.totalSales || 0);
  const totalOrders = Number(perfSummary?.totalOrders || 0);
  const totalImpressions = Number(perfSummary?.totalImpressions || 0);
  
  return {
    campaignId: campaign.campaignId,
    campaignName: campaign.campaignName,
    campaignType: campaign.campaignType,
    targetingType: campaign.targetingType,
    performanceGroupId: campaign.performanceGroupId,
    dailyBudget: Number(campaign.dailyBudget || 0),
    avgCpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
    avgCvr: totalClicks > 0 ? totalOrders / totalClicks : 0,
    avgAcos: totalSales > 0 ? (totalSpend / totalSales) * 100 : 0,
    avgRoas: totalSpend > 0 ? totalSales / totalSpend : 0,
    totalClicks,
    totalSpend,
    totalSales,
    totalOrders,
    totalImpressions,
    activeDays: Number(perfSummary?.activeDays || 0),
    avgBid: Number(kwStats?.avgBid || 0),
    keywordCount: Number(kwStats?.keywordCount || 0),
    topSearchImpressionShare: Number(campaign.topOfSearchImpressionShare || 0),
    createdAt: campaign.createdAt || '',
  };
}

/**
 * 获取账户下所有成熟广告活动
 */
async function getMatureCampaigns(
  accountId: number,
  excludeCampaignId: string
): Promise<CampaignFeatures[]> {
  const db = await getDb();
  if (!db) return [];
  
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - TRANSFER_CONFIG.PERFORMANCE_LOOKBACK_DAYS);
  
  // 查询有足够数据的广告活动
  const matureCampaignIds = await db.select({
    campaignId: dailyPerformance.campaignId,
    totalClicks: sql<number>`SUM(${dailyPerformance.clicks})`,
    activeDays: sql<number>`COUNT(DISTINCT DATE(${dailyPerformance.date}))`,
  })
  .from(dailyPerformance)
  .where(and(
    eq(dailyPerformance.accountId, accountId),
    gte(dailyPerformance.date, lookbackDate.toISOString()),
    isNotNull(dailyPerformance.campaignId)
  ))
  .groupBy(dailyPerformance.campaignId)
  .having(and(
    gte(sql`SUM(${dailyPerformance.clicks})`, TRANSFER_CONFIG.MATURE_MIN_CLICKS),
    gte(sql`COUNT(DISTINCT DATE(${dailyPerformance.date}))`, TRANSFER_CONFIG.MATURE_MIN_DAYS)
  ));
  
  const results: CampaignFeatures[] = [];
  
  for (const row of matureCampaignIds) {
    if (!row.campaignId || row.campaignId === excludeCampaignId) continue;
    
    const features = await getCampaignFeatures(accountId, row.campaignId);
    if (features) {
      results.push(features);
    }
  }
  
  return results;
}

/**
 * 获取账户下所有新品广告活动
 */
async function getNewCampaigns(accountId: number): Promise<{ campaignId: string }[]> {
  const db = await getDb();
  if (!db) return [];
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - TRANSFER_CONFIG.NEW_CAMPAIGN_MAX_DAYS);
  
  // 查询近期创建的、数据量少的广告活动
  const newCampaignRows = await db.select({
    campaignId: campaigns.campaignId,
    clicks: campaigns.clicks,
  })
  .from(campaigns)
  .where(and(
    eq(campaigns.accountId, accountId),
    eq(campaigns.campaignStatus, 'enabled'),
    eq(campaigns.optimizationStatus, 'managed'),
    lte(sql`COALESCE(${campaigns.clicks}, 0)`, TRANSFER_CONFIG.NEW_CAMPAIGN_MAX_CLICKS)
  ));
  
  return newCampaignRows.map(r => ({ campaignId: r.campaignId }));
}

/**
 * 计算两个广告活动之间的相似度
 * 
 * 相似度由以下维度加权组成：
 * 1. 类型匹配（30%）：campaignType和targetingType是否一致
 * 2. 预算区间（20%）：dailyBudget是否在相近范围
 * 3. 绩效组匹配（20%）：是否属于同一绩效组
 * 4. 名称模式（15%）：广告活动名称的模式相似度
 * 5. 关键词重叠（15%）：共享关键词的比例
 */
function calculateSimilarity(
  newCampaign: CampaignFeatures,
  matureCampaign: CampaignFeatures
): { similarityScore: number; similarityBreakdown: SimilarityMatch['similarityBreakdown'] } {
  
  // 1. 类型匹配 (30%)
  let typeScore = 0;
  if (newCampaign.campaignType === matureCampaign.campaignType) {
    typeScore = 1.0;
  } else if (
    (newCampaign.campaignType === 'sp_auto' && matureCampaign.campaignType === 'sp_manual') ||
    (newCampaign.campaignType === 'sp_manual' && matureCampaign.campaignType === 'sp_auto')
  ) {
    // SP自动和SP手动之间有一定相似度
    typeScore = 0.6;
  } else {
    typeScore = 0.1; // 完全不同类型
  }
  
  // 2. 预算区间 (20%)
  let budgetScore = 0;
  if (newCampaign.dailyBudget > 0 && matureCampaign.dailyBudget > 0) {
    const ratio = Math.min(newCampaign.dailyBudget, matureCampaign.dailyBudget) /
                  Math.max(newCampaign.dailyBudget, matureCampaign.dailyBudget);
    budgetScore = ratio; // 预算越接近，分数越高
  } else if (newCampaign.dailyBudget === 0 && matureCampaign.dailyBudget === 0) {
    budgetScore = 0.5; // 都没有设置预算
  }
  
  // 3. 绩效组匹配 (20%)
  let performanceGroupScore = 0;
  if (newCampaign.performanceGroupId && matureCampaign.performanceGroupId) {
    performanceGroupScore = newCampaign.performanceGroupId === matureCampaign.performanceGroupId ? 1.0 : 0.0;
  } else {
    performanceGroupScore = 0.3; // 没有绩效组信息时给予中等分数
  }
  
  // 4. 名称模式相似度 (15%)
  const namePatternScore = calculateNameSimilarity(newCampaign.campaignName, matureCampaign.campaignName);
  
  // 5. 关键词重叠（简化版：基于关键词数量的相似度）(15%)
  let keywordOverlapScore = 0;
  if (newCampaign.keywordCount > 0 && matureCampaign.keywordCount > 0) {
    const ratio = Math.min(newCampaign.keywordCount, matureCampaign.keywordCount) /
                  Math.max(newCampaign.keywordCount, matureCampaign.keywordCount);
    keywordOverlapScore = ratio * 0.8; // 关键词数量相近说明结构相似
  }
  
  // 加权汇总
  const similarityScore = 
    typeScore * 0.30 +
    budgetScore * 0.20 +
    performanceGroupScore * 0.20 +
    namePatternScore * 0.15 +
    keywordOverlapScore * 0.15;
  
  return {
    similarityScore,
    similarityBreakdown: {
      typeScore,
      budgetScore,
      performanceGroupScore,
      namePatternScore,
      keywordOverlapScore,
    },
  };
}

/**
 * 计算广告活动名称的模式相似度
 * 
 * 亚马逊广告活动命名通常有规律：
 * - "品牌名-产品线-SP-Auto-Broad"
 * - "品牌名-新品A-SP-Manual-Exact"
 * 
 * 提取结构化部分进行匹配
 */
function calculateNameSimilarity(name1: string, name2: string): number {
  // 将名称分割为token
  const tokens1 = name1.toLowerCase().split(/[-_\s|]+/).filter(t => t.length > 0);
  const tokens2 = name2.toLowerCase().split(/[-_\s|]+/).filter(t => t.length > 0);
  
  if (tokens1.length === 0 || tokens2.length === 0) return 0;
  
  // 计算Jaccard相似度
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
}

/**
 * 加权聚合多个相似广告活动的参数
 */
function aggregateTransferParameters(
  matches: (SimilarityMatch & { sourceCampaign: CampaignFeatures })[],
  newCampaign: CampaignFeatures
): TransferParameters {
  // 计算每个匹配的权重（基于相似度）
  const totalSimilarity = matches.reduce((sum, m) => sum + m.similarityScore, 0);
  
  let weightedCpc = 0;
  let weightedCvr = 0;
  let weightedCtr = 0;
  let weightedAcos = 0;
  let weightedRoas = 0;
  let weightedBid = 0;
  let weightedBudget = 0;
  let totalDataPoints = 0;
  
  for (const match of matches) {
    const weight = match.similarityScore / totalSimilarity;
    const src = match.sourceCampaign;
    
    weightedCpc += src.avgCpc * weight;
    weightedCvr += src.avgCvr * weight;
    weightedAcos += src.avgAcos * weight;
    weightedRoas += src.avgRoas * weight;
    weightedBid += src.avgBid * weight;
    weightedBudget += src.dailyBudget * weight;
    totalDataPoints += src.totalClicks;
    
    // CTR计算
    const ctr = src.totalImpressions > 0 ? src.totalClicks / src.totalImpressions : 0;
    weightedCtr += ctr * weight;
  }
  
  // 计算迁移权重（基于新品当前数据量）
  const transferWeight = calculateTransferWeight(newCampaign.totalClicks, newCampaign.activeDays);
  
  // 计算广告位调整建议（取最佳表现的成熟活动的广告位设置）
  const bestMatch = matches[0].sourceCampaign;
  
  // 确定置信度
  const avgSimilarity = totalSimilarity / matches.length;
  let confidence: 'high' | 'medium' | 'low';
  if (avgSimilarity >= 0.7 && matches.length >= 3) {
    confidence = 'high';
  } else if (avgSimilarity >= 0.5 || matches.length >= 2) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }
  
  return {
    suggestedCpc: Math.max(0.02, weightedCpc),
    suggestedBid: Math.max(0.02, weightedBid),
    estimatedCvr: Math.max(0, weightedCvr),
    estimatedCtr: Math.max(0, weightedCtr),
    referenceAcos: weightedAcos,
    referenceRoas: weightedRoas,
    suggestedDailyBudget: Math.max(1, weightedBudget),
    suggestedTopSearchAdjustment: 0, // 保守起见，不迁移广告位调整
    suggestedProductPageAdjustment: 0,
    transferWeight,
    sourceInfo: {
      campaignIds: matches.map(m => m.sourceCampaign.campaignId),
      campaignNames: matches.map(m => m.sourceCampaign.campaignName),
      avgSimilarity,
      totalDataPoints,
    },
    confidence,
  };
}

/**
 * 获取指定广告活动的迁移参数（如果存在）
 * 用于在出价计算时查询是否有可用的迁移先验
 */
export async function getTransferPriorForCampaign(
  accountId: number,
  campaignId: string
): Promise<TransferParameters | null> {
  try {
    const result = await generateTransferParameters(accountId, campaignId);
    return result.parameters;
  } catch {
    return null;
  }
}

/**
 * 获取指定广告活动中关键词的迁移出价建议
 * 
 * @param accountId 账户ID
 * @param campaignId 广告活动ID
 * @param keywordText 关键词文本
 * @param matchType 匹配类型
 * @returns 建议出价或null
 */
export async function getTransferBidForKeyword(
  accountId: number,
  campaignId: string,
  keywordText: string,
  matchType: string
): Promise<{ bid: number; weight: number; source: string } | null> {
  try {
    const transferParams = await getTransferPriorForCampaign(accountId, campaignId);
    if (!transferParams || transferParams.transferWeight <= 0) return null;
    
    // 基于匹配类型调整出价
    let matchTypeMultiplier = 1.0;
    switch (matchType) {
      case 'exact': matchTypeMultiplier = 1.1; break;
      case 'phrase': matchTypeMultiplier = 0.95; break;
      case 'broad': matchTypeMultiplier = 0.8; break;
    }
    
    const suggestedBid = transferParams.suggestedBid * matchTypeMultiplier;
    
    return {
      bid: Math.max(0.02, Math.round(suggestedBid * 100) / 100),
      weight: transferParams.transferWeight,
      source: `跨品迁移(${transferParams.sourceInfo.campaignNames.slice(0, 2).join(', ')})`,
    };
    
  } catch {
    return null;
  }
}
