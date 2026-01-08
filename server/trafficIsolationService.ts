/**
 * Traffic Isolation and N-Gram Noise Reduction Service
 * 
 * 实现流量隔离体系和N-Gram降噪算法：
 * 1. N-Gram词根分析 - 识别高频无效词根，批量降噪
 * 2. 流量隔离 - 检测跨广告活动的搜索词重叠，实现流量归属决策
 * 3. 漏斗模型 - 三层漏斗架构，确保流量在正确层级被捕获
 * 4. Exact First策略 - 高确定性词直接精准匹配
 */

import { getDb } from "./db";
import { searchTerms, campaigns, negativeKeywords, keywords, adGroups } from "../drizzle/schema";
import { eq, and, sql, gte, lte, desc, inArray, like } from "drizzle-orm";

// ==================== 类型定义 ====================

export interface NGramToken {
  token: string;
  tokenType: 'unigram' | 'bigram' | 'trigram';
  frequency: number;
  totalClicks: number;
  totalSpend: number;
  totalConversions: number;
  conversionRate: number;
  confidence: number;
  searchTerms: string[]; // 包含该词根的搜索词示例
  suggestedAction: 'negative_phrase' | 'negative_exact' | 'monitor' | 'ignore';
}

export interface NGramAnalysisResult {
  accountId: number;
  analysisDate: Date;
  totalSearchTermsAnalyzed: number;
  totalTokensExtracted: number;
  highRiskTokens: NGramToken[];
  mediumRiskTokens: NGramToken[];
  suggestedNegatives: {
    token: string;
    matchType: 'negative_phrase' | 'negative_exact';
    reason: string;
    estimatedSavings: number;
  }[];
}

export interface TrafficConflict {
  searchTerm: string;
  conflictingCampaigns: {
    campaignId: number;
    campaignName: string;
    matchType: string;
    clicks: number;
    conversions: number;
    spend: number;
    sales: number;
    cvr: number;
    aov: number;
    roas: number;
    score: number; // 综合得分
  }[];
  suggestedWinner: {
    campaignId: number;
    campaignName: string;
    reason: string;
  };
  totalWastedSpend: number; // 流量重叠导致的浪费
}

export interface TrafficConflictAnalysisResult {
  accountId: number;
  analysisDate: Date;
  totalConflicts: number;
  totalWastedSpend: number;
  conflicts: TrafficConflict[];
  resolutionSuggestions: {
    conflictId: number;
    searchTerm: string;
    winnerCampaignId: number;
    negativesToAdd: {
      campaignId: number;
      negativeText: string;
      matchType: 'negative_exact';
    }[];
  }[];
}

export interface FunnelTierConfig {
  campaignId: number;
  campaignName: string;
  tierLevel: 'tier1_exact' | 'tier2_longtail' | 'tier3_explore';
  matchType: string;
  autoNegativeSync: boolean;
}

export interface FunnelSyncResult {
  accountId: number;
  syncDate: Date;
  tier1Keywords: string[];
  tier2Keywords: string[];
  negativesToSync: {
    targetCampaignId: number;
    targetTier: string;
    negatives: {
      keyword: string;
      matchType: 'negative_phrase' | 'negative_exact';
      sourceTier: string;
    }[];
  }[];
  totalNegativesToAdd: number;
}

export interface KeywordMigrationSuggestion {
  searchTerm: string;
  sourceCampaignId: number;
  sourceCampaignName: string;
  sourceTier: string;
  targetTier: string;
  clicks: number;
  conversions: number;
  cvr: number;
  sales: number;
  reason: string;
}

// ==================== 配置参数 ====================

export const TRAFFIC_ISOLATION_CONFIG = {
  // N-Gram分析参数
  ngram: {
    minFrequency: 10,           // 词根最小出现频率
    highRiskFrequency: 50,      // 高风险词根频率阈值
    confidenceThreshold: 0.7,   // 建议否定的置信度阈值
    maxTokenLength: 3,          // 最大N-Gram长度
    stopWords: ['a', 'an', 'the', 'for', 'and', 'or', 'with', 'to', 'of', 'in', 'on', 'at', 'by'],
  },
  
  // 流量冲突检测参数
  conflict: {
    minOverlapDays: 3,          // 判定冲突的最小重叠天数
    minClicks: 5,               // 最小点击数
    cvrWeight: 0.4,             // CVR权重
    aovWeight: 0.3,             // AOV权重
    roasWeight: 0.2,            // ROAS权重
    dataVolumeWeight: 0.1,      // 数据量权重
  },
  
  // 漏斗模型参数
  funnel: {
    tier1MatchTypes: ['exact'],
    tier2MatchTypes: ['phrase', 'exact'],
    tier3MatchTypes: ['broad', 'phrase'],
  },
  
  // 关键词迁移参数
  migration: {
    minConversions: 3,          // 最小转化数
    minCVR: 0.05,               // 最小转化率 (5%)
    minClicks: 20,              // 最小点击数
  },
  
  // 安全边界
  safety: {
    maxNegativesPerBatch: 100,  // 单次最大否定词数
    maxNegativesPerDay: 500,    // 每日最大否定词数
    protectedKeywordTypes: ['brand', 'high_conversion'], // 保护的关键词类型
  },
};

// ==================== N-Gram词根分析 ====================

/**
 * 分词函数 - 将搜索词拆分为tokens
 */
export function tokenize(text: string): string[] {
  // 转小写，移除特殊字符
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
  // 按空格分割
  const words = cleaned.split(/\s+/).filter(w => w.length > 1);
  // 过滤停用词
  return words.filter(w => !TRAFFIC_ISOLATION_CONFIG.ngram.stopWords.includes(w));
}

/**
 * 生成N-Gram
 */
export function generateNGrams(tokens: string[], n: number): string[] {
  const ngrams: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    ngrams.push(tokens.slice(i, i + n).join(' '));
  }
  return ngrams;
}

/**
 * 执行N-Gram分析
 * 分析"1点击0转化"的搜索词，识别高频无效词根
 */
export async function runNGramAnalysis(
  accountId: number,
  startDate: Date,
  endDate: Date,
  options?: {
    minFrequency?: number;
    includeConvertingTerms?: boolean;
  }
): Promise<NGramAnalysisResult> {
  const db = await getDb();
  if (!db) {
    return { accountId, analysisDate: new Date(), totalSearchTermsAnalyzed: 0, totalTokensExtracted: 0, highRiskTokens: [], mediumRiskTokens: [], suggestedNegatives: [] };
  }
  const minFrequency = options?.minFrequency || TRAFFIC_ISOLATION_CONFIG.ngram.minFrequency;
  
  // 获取搜索词数据
  const searchTermData = await db.select({
    searchTerm: searchTerms.searchTerm,
    clicks: searchTerms.searchTermClicks,
    conversions: searchTerms.searchTermOrders,
    spend: searchTerms.searchTermSpend,
    sales: searchTerms.searchTermSales,
  })
  .from(searchTerms)
  .where(and(
    eq(searchTerms.accountId, accountId),
    gte(searchTerms.reportStartDate, startDate.toISOString()),
    lte(searchTerms.reportEndDate, endDate.toISOString()),
    // 默认只分析有点击但无转化的搜索词
    options?.includeConvertingTerms ? sql`1=1` : sql`${searchTerms.searchTermClicks} > 0 AND ${searchTerms.searchTermOrders} = 0`
  ));
  
  // 统计词频
  const tokenStats: Map<string, {
    frequency: number;
    totalClicks: number;
    totalSpend: number;
    totalConversions: number;
    searchTerms: Set<string>;
  }> = new Map();
  
  for (const term of searchTermData) {
    const tokens = tokenize(term.searchTerm);
    
    // Unigram
    for (const token of tokens) {
      const stats = tokenStats.get(token) || {
        frequency: 0,
        totalClicks: 0,
        totalSpend: 0,
        totalConversions: 0,
        searchTerms: new Set(),
      };
      stats.frequency++;
      stats.totalClicks += term.clicks || 0;
      stats.totalSpend += Number(term.spend) || 0;
      stats.totalConversions += term.conversions || 0;
      stats.searchTerms.add(term.searchTerm);
      tokenStats.set(token, stats);
    }
    
    // Bigram
    const bigrams = generateNGrams(tokens, 2);
    for (const bigram of bigrams) {
      const stats = tokenStats.get(bigram) || {
        frequency: 0,
        totalClicks: 0,
        totalSpend: 0,
        totalConversions: 0,
        searchTerms: new Set(),
      };
      stats.frequency++;
      stats.totalClicks += term.clicks || 0;
      stats.totalSpend += Number(term.spend) || 0;
      stats.totalConversions += term.conversions || 0;
      stats.searchTerms.add(term.searchTerm);
      tokenStats.set(bigram, stats);
    }
  }
  
  // 转换为结果数组并计算置信度
  const allTokens: NGramToken[] = [];
  
  tokenStats.forEach((stats, token) => {
    if (stats.frequency < minFrequency) return;
    
    const cvr = stats.totalClicks > 0 ? stats.totalConversions / stats.totalClicks : 0;
    const isMultiWord = token.includes(' ');
    
    // 计算置信度：基于频率、点击数、转化率
    const frequencyScore = Math.min(stats.frequency / TRAFFIC_ISOLATION_CONFIG.ngram.highRiskFrequency, 1);
    const clickScore = Math.min(stats.totalClicks / 100, 1);
    const cvrPenalty = cvr > 0 ? 0.5 : 1; // 有转化的词根降低置信度
    const confidence = (frequencyScore * 0.4 + clickScore * 0.4 + 0.2) * cvrPenalty;
    
    // 确定建议操作
    let suggestedAction: NGramToken['suggestedAction'] = 'monitor';
    if (confidence >= TRAFFIC_ISOLATION_CONFIG.ngram.confidenceThreshold && cvr === 0) {
      suggestedAction = isMultiWord ? 'negative_phrase' : 'negative_phrase';
    } else if (confidence >= 0.5 && cvr < 0.01) {
      suggestedAction = 'monitor';
    }
    
    allTokens.push({
      token,
      tokenType: isMultiWord ? 'bigram' : 'unigram',
      frequency: stats.frequency,
      totalClicks: stats.totalClicks,
      totalSpend: stats.totalSpend,
      totalConversions: stats.totalConversions,
      conversionRate: cvr,
      confidence,
      searchTerms: Array.from(stats.searchTerms).slice(0, 10) as string[], // 最多保甹10个示例
      suggestedAction,
    });
  });
  
  // 按置信度排序
  allTokens.sort((a, b) => b.confidence - a.confidence);
  
  // 分类
  const highRiskTokens = allTokens.filter(t => t.confidence >= TRAFFIC_ISOLATION_CONFIG.ngram.confidenceThreshold);
  const mediumRiskTokens = allTokens.filter(t => t.confidence >= 0.5 && t.confidence < TRAFFIC_ISOLATION_CONFIG.ngram.confidenceThreshold);
  
  // 生成否定建议
  const suggestedNegatives = highRiskTokens
    .filter(t => t.suggestedAction !== 'ignore')
    .map(t => ({
      token: t.token,
      matchType: 'negative_phrase' as const,
      reason: `出现${t.frequency}次，${t.totalClicks}次点击，0转化，预计可节省$${t.totalSpend.toFixed(2)}`,
      estimatedSavings: t.totalSpend,
    }));
  
  return {
    accountId,
    analysisDate: new Date(),
    totalSearchTermsAnalyzed: searchTermData.length,
    totalTokensExtracted: allTokens.length,
    highRiskTokens,
    mediumRiskTokens,
    suggestedNegatives,
  };
}

// ==================== 流量冲突检测 ====================

/**
 * 检测流量冲突
 * 识别相同搜索词出现在多个广告活动中的情况
 */
export async function detectTrafficConflicts(
  accountId: number,
  startDate: Date,
  endDate: Date
): Promise<TrafficConflictAnalysisResult> {
  const db = await getDb();
  if (!db) {
    return { accountId, analysisDate: new Date(), totalConflicts: 0, totalWastedSpend: 0, conflicts: [], resolutionSuggestions: [] };
  }
  // 获取搜索词数据，按搜索词分组
  const searchTermData = await db.select({
    searchTerm: searchTerms.searchTerm,
    campaignId: searchTerms.campaignId,
    clicks: searchTerms.searchTermClicks,
    conversions: searchTerms.searchTermOrders,
    spend: searchTerms.searchTermSpend,
    sales: searchTerms.searchTermSales,
    matchType: searchTerms.searchTermMatchType,
  })
  .from(searchTerms)
  .where(and(
    eq(searchTerms.accountId, accountId),
    gte(searchTerms.reportStartDate, startDate.toISOString()),
    lte(searchTerms.reportEndDate, endDate.toISOString()),
    gte(searchTerms.searchTermClicks, TRAFFIC_ISOLATION_CONFIG.conflict.minClicks)
  ));
  
  // 获取广告活动信息
  const campaignData = await db.select({
    id: campaigns.id,
    campaignName: campaigns.campaignName,
    targetingType: campaigns.targetingType,
  })
  .from(campaigns)
  .where(eq(campaigns.accountId, accountId));
  
  const campaignMap = new Map<number, typeof campaignData[0]>(campaignData.map((c: typeof campaignData[0]) => [c.id, c]));
  
  // 按搜索词分组
  const searchTermGroups: Map<string, typeof searchTermData> = new Map();
  for (const term of searchTermData) {
    const group = searchTermGroups.get(term.searchTerm) || [];
    group.push(term);
    searchTermGroups.set(term.searchTerm, group);
  }
  
  // 识别冲突（同一搜索词出现在多个广告活动）
  const conflicts: TrafficConflict[] = [];
  let totalWastedSpend = 0;
  
  searchTermGroups.forEach((terms, searchTerm) => {
    // 按广告活动去重
    const campaignIds = new Set(terms.map((t: typeof searchTermData[0]) => t.campaignId));
    if (campaignIds.size < 2) return; // 只有一个广告活动，无冲突
    
    // 聚合每个广告活动的数据
    const campaignStats: Map<number, {
      clicks: number;
      conversions: number;
      spend: number;
      sales: number;
      matchType: string;
    }> = new Map();
    
    for (const term of terms) {
      const stats = campaignStats.get(term.campaignId) || {
        clicks: 0,
        conversions: 0,
        spend: 0,
        sales: 0,
        matchType: term.matchType || 'unknown',
      };
      stats.clicks += term.clicks || 0;
      stats.conversions += term.conversions || 0;
      stats.spend += Number(term.spend) || 0;
      stats.sales += Number(term.sales) || 0;
      campaignStats.set(term.campaignId, stats);
    }
    
    // 计算每个广告活动的得分
    const conflictingCampaigns: TrafficConflict['conflictingCampaigns'] = [];
    
    campaignStats.forEach((stats, campaignId) => {
      const campaign = campaignMap.get(campaignId);
      if (!campaign) return;
      
      const cvr = stats.clicks > 0 ? stats.conversions / stats.clicks : 0;
      const aov = stats.conversions > 0 ? stats.sales / stats.conversions : 0;
      const roas = stats.spend > 0 ? stats.sales / stats.spend : 0;
      
      // 计算综合得分
      const { cvrWeight, aovWeight, roasWeight, dataVolumeWeight } = TRAFFIC_ISOLATION_CONFIG.conflict;
      const normalizedCVR = Math.min(cvr / 0.2, 1); // 假设20%是很好的CVR
      const normalizedAOV = Math.min(aov / 100, 1); // 假设$100是很好的AOV
      const normalizedROAS = Math.min(roas / 5, 1); // 假设5是很好的ROAS
      const normalizedVolume = Math.min(stats.clicks / 50, 1); // 假设50次点击是足够的数据
      
      const score = 
        normalizedCVR * cvrWeight +
        normalizedAOV * aovWeight +
        normalizedROAS * roasWeight +
        normalizedVolume * dataVolumeWeight;
      
      conflictingCampaigns.push({
        campaignId,
        campaignName: campaign.campaignName,
        matchType: stats.matchType,
        clicks: stats.clicks,
        conversions: stats.conversions,
        spend: stats.spend,
        sales: stats.sales,
        cvr,
        aov,
        roas,
        score,
      });
    });
    
    // 按得分排序，选出获胜者
    conflictingCampaigns.sort((a, b) => b.score - a.score);
    const winner = conflictingCampaigns[0];
    
    // 计算浪费的花费（非获胜者的花费）
    const wastedSpend = conflictingCampaigns
      .slice(1)
      .reduce((sum, c) => sum + c.spend, 0);
    totalWastedSpend += wastedSpend;
    
    // 确定获胜原因
    let winnerReason = '';
    if (winner.cvr > 0 && conflictingCampaigns.slice(1).every(c => c.cvr === 0)) {
      winnerReason = `唯一有转化的广告活动（CVR: ${(winner.cvr * 100).toFixed(1)}%）`;
    } else if (winner.roas > conflictingCampaigns[1]?.roas * 1.5) {
      winnerReason = `ROAS显著更高（${winner.roas.toFixed(2)} vs ${conflictingCampaigns[1]?.roas.toFixed(2)}）`;
    } else if (winner.cvr > conflictingCampaigns[1]?.cvr * 1.2) {
      winnerReason = `转化率更高（${(winner.cvr * 100).toFixed(1)}% vs ${(conflictingCampaigns[1]?.cvr * 100).toFixed(1)}%）`;
    } else {
      winnerReason = `综合得分最高（${winner.score.toFixed(3)}）`;
    }
    
    conflicts.push({
      searchTerm,
      conflictingCampaigns,
      suggestedWinner: {
        campaignId: winner.campaignId,
        campaignName: winner.campaignName,
        reason: winnerReason,
      },
      totalWastedSpend: wastedSpend,
    });
  });
  
  // 按浪费金额排序
  conflicts.sort((a, b) => b.totalWastedSpend - a.totalWastedSpend);
  
  // 生成解决建议
  const resolutionSuggestions = conflicts.map((conflict, index) => ({
    conflictId: index,
    searchTerm: conflict.searchTerm,
    winnerCampaignId: conflict.suggestedWinner.campaignId,
    negativesToAdd: conflict.conflictingCampaigns
      .filter(c => c.campaignId !== conflict.suggestedWinner.campaignId)
      .map(c => ({
        campaignId: c.campaignId,
        negativeText: conflict.searchTerm,
        matchType: 'negative_exact' as const,
      })),
  }));
  
  return {
    accountId,
    analysisDate: new Date(),
    totalConflicts: conflicts.length,
    totalWastedSpend,
    conflicts,
    resolutionSuggestions,
  };
}

// ==================== 漏斗模型 ====================

/**
 * 识别广告活动的漏斗层级
 * 基于匹配类型和投放策略
 */
export async function identifyFunnelTiers(
  accountId: number
): Promise<FunnelTierConfig[]> {
  const db = await getDb();
  if (!db) return [];
  const campaignData = await db.select({
    id: campaigns.id,
    campaignName: campaigns.campaignName,
    targetingType: campaigns.targetingType,
  })
  .from(campaigns)
  .where(and(
    eq(campaigns.accountId, accountId),
    eq(campaigns.campaignStatus, 'enabled')
  ));
  
  // 获取每个广告活动的关键词匹配类型分布（通过adGroups关联）
  const keywordData = await db.select({
    campaignId: adGroups.campaignId,
    matchType: keywords.matchType,
    count: sql<number>`COUNT(*)`,
  })
  .from(keywords)
  .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
  .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.id))
  .where(eq(campaigns.accountId, accountId))
  .groupBy(adGroups.campaignId, keywords.matchType);
  
  // 按广告活动聚合匹配类型
  const campaignMatchTypes: Map<number, Map<string, number>> = new Map();
  for (const kw of keywordData) {
    const matchTypes = campaignMatchTypes.get(kw.campaignId) || new Map();
    matchTypes.set(kw.matchType || 'unknown', kw.count);
    campaignMatchTypes.set(kw.campaignId, matchTypes);
  }
  
  // 确定每个广告活动的层级
  const tierConfigs: FunnelTierConfig[] = [];
  
  for (const campaign of campaignData) {
    const matchTypes = campaignMatchTypes.get(campaign.id);
    if (!matchTypes) continue;
    
    // 计算主要匹配类型
    let dominantMatchType = 'unknown';
    let maxCount = 0;
    matchTypes.forEach((count, matchType) => {
      if (count > maxCount) {
        maxCount = count;
        dominantMatchType = matchType;
      }
    });
    
    // 根据匹配类型确定层级
    let tierLevel: FunnelTierConfig['tierLevel'];
    if (dominantMatchType === 'exact') {
      // 检查是否是核心大词（Tier 1）还是长尾词（Tier 2）
      // 简化判断：如果广告活动名称包含"exact"或"精准"，认为是Tier 1
      if (campaign.campaignName.toLowerCase().includes('exact') || 
          campaign.campaignName.includes('精准') ||
          campaign.campaignName.includes('core') ||
          campaign.campaignName.includes('核心')) {
        tierLevel = 'tier1_exact';
      } else {
        tierLevel = 'tier2_longtail';
      }
    } else if (dominantMatchType === 'phrase') {
      tierLevel = 'tier2_longtail';
    } else {
      tierLevel = 'tier3_explore';
    }
    
    tierConfigs.push({
      campaignId: campaign.id,
      campaignName: campaign.campaignName,
      tierLevel,
      matchType: dominantMatchType,
      autoNegativeSync: true,
    });
  }
  
  return tierConfigs;
}

/**
 * 同步漏斗否定词
 * 确保下层广告活动否定掉上层的词
 */
export async function syncFunnelNegatives(
  accountId: number,
  tierConfigs: FunnelTierConfig[]
): Promise<FunnelSyncResult> {
  const db = await getDb();
  if (!db) {
    return { 
      accountId, 
      syncDate: new Date(), 
      tier1Keywords: [], 
      tier2Keywords: [], 
      negativesToSync: [], 
      totalNegativesToAdd: 0 
    };
  }
  // 获取各层级的关键词
  const tier1Campaigns = tierConfigs.filter(t => t.tierLevel === 'tier1_exact').map(t => t.campaignId);
  const tier2Campaigns = tierConfigs.filter(t => t.tierLevel === 'tier2_longtail').map(t => t.campaignId);
  const tier3Campaigns = tierConfigs.filter(t => t.tierLevel === 'tier3_explore').map(t => t.campaignId);
  
  // 获取Tier 1关键词（通过adGroups关联）
  const tier1Keywords = tier1Campaigns.length > 0 ? await db.select({
    keywordText: keywords.keywordText,
  })
  .from(keywords)
  .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
  .where(and(
    inArray(adGroups.campaignId, tier1Campaigns),
    eq(keywords.keywordStatus, 'enabled')
  )) : [];
  
  // 获取Tier 2关键词
  const tier2Keywords = tier2Campaigns.length > 0 ? await db.select({
    keywordText: keywords.keywordText,
  })
  .from(keywords)
  .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
  .where(and(
    inArray(adGroups.campaignId, tier2Campaigns),
    eq(keywords.keywordStatus, 'enabled')
  )) : [];
  
  // 获取现有否定词
  const existingNegatives = await db.select({
    campaignId: negativeKeywords.campaignId,
    negativeText: negativeKeywords.negativeText,
  })
  .from(negativeKeywords)
  .where(and(
    eq(negativeKeywords.accountId, accountId),
    eq(negativeKeywords.negativeStatus, 'active')
  ));
  
  const existingNegativeMap: Map<number, Set<string>> = new Map();
  for (const neg of existingNegatives) {
    const negSet = existingNegativeMap.get(neg.campaignId) || new Set();
    negSet.add(neg.negativeText.toLowerCase());
    existingNegativeMap.set(neg.campaignId, negSet);
  }
  
  // 生成需要同步的否定词
  const negativesToSync: FunnelSyncResult['negativesToSync'] = [];
  
  const tier1KeywordTexts = tier1Keywords.map((k: { keywordText: string }) => k.keywordText.toLowerCase());
  const tier2KeywordTexts = tier2Keywords.map((k: { keywordText: string }) => k.keywordText.toLowerCase());
  
  // Tier 2需要否定Tier 1的词（Negative Exact）
  for (const campaignId of tier2Campaigns) {
    const existingNegs = existingNegativeMap.get(campaignId) || new Set<string>();
    const negatives = tier1KeywordTexts
      .filter((kw: string) => !existingNegs.has(kw))
      .map((kw: string) => ({
        keyword: kw,
        matchType: 'negative_exact' as const,
        sourceTier: 'tier1',
      }));
    
    if (negatives.length > 0) {
      const config = tierConfigs.find(t => t.campaignId === campaignId);
      negativesToSync.push({
        targetCampaignId: campaignId,
        targetTier: config?.tierLevel || 'tier2_longtail',
        negatives,
      });
    }
  }
  
  // Tier 3需要否定Tier 1和Tier 2的词（Negative Phrase）
  const allUpperTierKeywords = Array.from(new Set([...tier1KeywordTexts, ...tier2KeywordTexts]));
  
  for (const campaignId of tier3Campaigns) {
    const existingNegs = existingNegativeMap.get(campaignId) || new Set<string>();
    const negatives = allUpperTierKeywords
      .filter((kw: string) => !existingNegs.has(kw))
      .map((kw: string) => ({
        keyword: kw,
        matchType: 'negative_phrase' as const,
        sourceTier: tier1KeywordTexts.includes(kw) ? 'tier1' : 'tier2',
      }));
    
    if (negatives.length > 0) {
      const config = tierConfigs.find(t => t.campaignId === campaignId);
      negativesToSync.push({
        targetCampaignId: campaignId,
        targetTier: config?.tierLevel || 'tier3_explore',
        negatives,
      });
    }
  }
  
  return {
    accountId,
    syncDate: new Date(),
    tier1Keywords: tier1KeywordTexts,
    tier2Keywords: tier2KeywordTexts,
    negativesToSync,
    totalNegativesToAdd: negativesToSync.reduce((sum, n) => sum + n.negatives.length, 0),
  };
}

// ==================== 关键词迁移建议 ====================

/**
 * 获取关键词迁移建议
 * 识别探索层中表现好的词，建议迁移到精准层
 */
export async function getKeywordMigrationSuggestions(
  accountId: number,
  tierConfigs: FunnelTierConfig[],
  startDate: Date,
  endDate: Date
): Promise<KeywordMigrationSuggestion[]> {
  const db = await getDb();
  if (!db) return [];
  const { minConversions, minCVR, minClicks } = TRAFFIC_ISOLATION_CONFIG.migration;
  
  // 获取Tier 3（探索层）的广告活动
  const tier3Campaigns = tierConfigs.filter(t => t.tierLevel === 'tier3_explore');
  if (tier3Campaigns.length === 0) return [];
  
  const tier3CampaignIds = tier3Campaigns.map(t => t.campaignId);
  
  // 获取探索层的搜索词数据
  const searchTermData = await db.select({
    searchTerm: searchTerms.searchTerm,
    campaignId: searchTerms.campaignId,
    clicks: searchTerms.searchTermClicks,
    conversions: searchTerms.searchTermOrders,
    spend: searchTerms.searchTermSpend,
    sales: searchTerms.searchTermSales,
  })
  .from(searchTerms)
  .where(and(
    eq(searchTerms.accountId, accountId),
    inArray(searchTerms.campaignId, tier3CampaignIds),
    gte(searchTerms.reportStartDate, startDate.toISOString()),
    lte(searchTerms.reportEndDate, endDate.toISOString()),
    gte(searchTerms.searchTermClicks, minClicks),
    gte(searchTerms.searchTermOrders, minConversions)
  ));
  
  // 获取已有的精准层关键词（避免重复建议）
  const tier1Campaigns = tierConfigs.filter(t => t.tierLevel === 'tier1_exact');
  const tier1CampaignIds = tier1Campaigns.map(t => t.campaignId);
  
  const existingExactKeywords = tier1CampaignIds.length > 0 ? await db.select({
    keywordText: keywords.keywordText,
  })
  .from(keywords)
  .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
  .where(inArray(adGroups.campaignId, tier1CampaignIds)) : [];
  
  const existingKeywordSet = new Set(existingExactKeywords.map((k: { keywordText: string }) => k.keywordText.toLowerCase()));
  
  // 生成迁移建议
  const suggestions: KeywordMigrationSuggestion[] = [];
  const campaignMap = new Map(tierConfigs.map(t => [t.campaignId, t]));
  
  for (const term of searchTermData) {
    const clicks = term.clicks || 0;
    const cvr = clicks > 0 ? (term.conversions || 0) / clicks : 0;
    
    // 检查是否满足迁移条件
    if (cvr < minCVR) continue;
    if (existingKeywordSet.has(term.searchTerm.toLowerCase())) continue;
    
    const sourceCampaign = campaignMap.get(term.campaignId);
    
    suggestions.push({
      searchTerm: term.searchTerm,
      sourceCampaignId: term.campaignId,
      sourceCampaignName: sourceCampaign?.campaignName || 'Unknown',
      sourceTier: 'tier3_explore',
      targetTier: 'tier1_exact',
      clicks: term.clicks || 0,
      conversions: term.conversions || 0,
      cvr,
      sales: Number(term.sales) || 0,
      reason: `在探索层表现优异：${term.conversions}次转化，CVR ${(cvr * 100).toFixed(1)}%，建议迁移到精准层`,
    });
  }
  
  // 按转化数排序
  suggestions.sort((a, b) => b.conversions - a.conversions);
  
  return suggestions;
}

// ==================== 综合分析 ====================

/**
 * 执行完整的流量隔离分析
 */
export async function runFullTrafficIsolationAnalysis(
  accountId: number,
  startDate: Date,
  endDate: Date
): Promise<{
  ngramAnalysis: NGramAnalysisResult;
  conflictAnalysis: TrafficConflictAnalysisResult;
  funnelConfig: FunnelTierConfig[];
  funnelSync: FunnelSyncResult;
  migrationSuggestions: KeywordMigrationSuggestion[];
  summary: {
    totalIssuesFound: number;
    estimatedSavings: number;
    priorityActions: string[];
  };
}> {
  // 1. N-Gram分析
  const ngramAnalysis = await runNGramAnalysis(accountId, startDate, endDate);
  
  // 2. 流量冲突检测
  const conflictAnalysis = await detectTrafficConflicts(accountId, startDate, endDate);
  
  // 3. 漏斗层级识别
  const funnelConfig = await identifyFunnelTiers(accountId);
  
  // 4. 漏斗否定词同步
  const funnelSync = await syncFunnelNegatives(accountId, funnelConfig);
  
  // 5. 关键词迁移建议
  const migrationSuggestions = await getKeywordMigrationSuggestions(
    accountId, 
    funnelConfig, 
    startDate, 
    endDate
  );
  
  // 6. 生成摘要
  const totalIssuesFound = 
    ngramAnalysis.highRiskTokens.length +
    conflictAnalysis.totalConflicts +
    funnelSync.totalNegativesToAdd;
  
  const estimatedSavings = 
    ngramAnalysis.suggestedNegatives.reduce((sum, n) => sum + n.estimatedSavings, 0) +
    conflictAnalysis.totalWastedSpend;
  
  const priorityActions: string[] = [];
  
  if (ngramAnalysis.highRiskTokens.length > 0) {
    priorityActions.push(`添加${ngramAnalysis.suggestedNegatives.length}个高频无效词根为否定词，预计节省$${ngramAnalysis.suggestedNegatives.reduce((sum, n) => sum + n.estimatedSavings, 0).toFixed(2)}`);
  }
  
  if (conflictAnalysis.totalConflicts > 0) {
    priorityActions.push(`解决${conflictAnalysis.totalConflicts}个流量冲突，预计减少浪费$${conflictAnalysis.totalWastedSpend.toFixed(2)}`);
  }
  
  if (funnelSync.totalNegativesToAdd > 0) {
    priorityActions.push(`同步${funnelSync.totalNegativesToAdd}个漏斗否定词，实现流量层级隔离`);
  }
  
  if (migrationSuggestions.length > 0) {
    priorityActions.push(`将${migrationSuggestions.length}个高转化词从探索层迁移到精准层`);
  }
  
  return {
    ngramAnalysis,
    conflictAnalysis,
    funnelConfig,
    funnelSync,
    migrationSuggestions,
    summary: {
      totalIssuesFound,
      estimatedSavings,
      priorityActions,
    },
  };
}

// ==================== 否定词应用 ====================

/**
 * 批量应用否定词
 */
export async function applyNegativeKeywords(
  accountId: number,
  negatives: {
    campaignId: number;
    adGroupId?: number;
    negativeText: string;
    matchType: 'negative_phrase' | 'negative_exact';
    source: 'ngram_analysis' | 'traffic_conflict' | 'funnel_migration' | 'manual';
    reason?: string;
  }[]
): Promise<{
  applied: number;
  skipped: number;
  errors: string[];
}> {
  const db = await getDb();
  if (!db) {
    return { applied: 0, skipped: negatives.length, errors: ['数据库连接不可用'] };
  }
  const { maxNegativesPerBatch } = TRAFFIC_ISOLATION_CONFIG.safety;
  
  if (negatives.length > maxNegativesPerBatch) {
    return {
      applied: 0,
      skipped: negatives.length,
      errors: [`超过单次最大否定词数限制（${maxNegativesPerBatch}）`],
    };
  }
  
  let applied = 0;
  let skipped = 0;
  const errors: string[] = [];
  
  for (const neg of negatives) {
    try {
      // 检查是否已存在
      const existing = await db.select()
        .from(negativeKeywords)
        .where(and(
          eq(negativeKeywords.accountId, accountId),
          eq(negativeKeywords.campaignId, neg.campaignId),
          eq(negativeKeywords.negativeText, neg.negativeText),
          eq(negativeKeywords.negativeStatus, 'active')
        ))
        .limit(1);
      
      if (existing.length > 0) {
        skipped++;
        continue;
      }
      
      // 插入否定词
      await db.insert(negativeKeywords).values({
        accountId,
        campaignId: neg.campaignId,
        adGroupId: neg.adGroupId || null,
        negativeLevel: neg.adGroupId ? 'ad_group' : 'campaign',
        negativeType: 'keyword',
        negativeText: neg.negativeText,
        negativeMatchType: neg.matchType,
        negativeSource: neg.source,
        sourceReason: neg.reason,
        negativeStatus: 'active',
      });
      
      applied++;
    } catch (error) {
      errors.push(`添加否定词"${neg.negativeText}"失败: ${error}`);
    }
  }
  
  return { applied, skipped, errors };
}
