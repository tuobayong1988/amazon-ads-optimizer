/**
 * 搜索词分析和优化服务
 * 
 * 功能：
 * - 搜索词绩效分析
 * - 高价值搜索词识别
 * - 低效搜索词识别
 * - 否定关键词建议
 * - 搜索词迁移建议（从自动广告到手动广告）
 * - N-Gram词根分析
 */

import { getDb } from "./db";
import { sql } from "drizzle-orm";

// 搜索词分析参数
export interface SearchTermAnalysisParams {
  targetAcos: number;
  minClicks: number;
  minImpressions: number;
  highValueAcosThreshold: number;   // 高价值搜索词ACoS阈值
  lowEfficiencyAcosThreshold: number; // 低效搜索词ACoS阈值
  minConversions: number;           // 最少转化数
  minCtr: number;                   // 最低点击率
}

// 默认分析参数
export const DEFAULT_SEARCH_TERM_PARAMS: SearchTermAnalysisParams = {
  targetAcos: 0.25,
  minClicks: 5,
  minImpressions: 500,
  highValueAcosThreshold: 0.20,     // ACoS < 20% 为高价值
  lowEfficiencyAcosThreshold: 0.50, // ACoS > 50% 为低效
  minConversions: 2,
  minCtr: 0.003                     // 0.3%
};

// 搜索词绩效数据
export interface SearchTermPerformance {
  searchTerm: string;
  campaignId: string;
  adGroupId: string;
  matchType: string;
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

// 搜索词分类
export type SearchTermCategory = 
  | 'high_value'           // 高价值（低ACoS高转化）
  | 'potential'            // 潜力词（有转化但ACoS略高）
  | 'low_efficiency'       // 低效词（高ACoS或无转化）
  | 'insufficient_data'    // 数据不足
  | 'brand_term'           // 品牌词
  | 'competitor_term';     // 竞品词

// 搜索词分析结果
export interface SearchTermAnalysisResult {
  searchTerm: string;
  category: SearchTermCategory;
  performance: SearchTermPerformance;
  suggestions: SearchTermSuggestion[];
  ngramAnalysis?: NGramAnalysisResult;
}

// 搜索词优化建议
export interface SearchTermSuggestion {
  type: 'add_as_keyword' | 'add_negative' | 'migrate_to_manual' | 'increase_bid' | 'decrease_bid';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  suggestedMatchType?: 'exact' | 'phrase' | 'broad';
  suggestedBid?: number;
  expectedImpact: string;
  confidenceScore: number;
}

// N-Gram分析结果
export interface NGramAnalysisResult {
  unigrams: NGramData[];
  bigrams: NGramData[];
  trigrams: NGramData[];
}

// N-Gram数据
export interface NGramData {
  ngram: string;
  frequency: number;
  totalImpressions: number;
  totalClicks: number;
  totalCost: number;
  totalSales: number;
  totalOrders: number;
  avgAcos: number;
  avgCtr: number;
  avgCvr: number;
  searchTerms: string[];
}

/**
 * 获取搜索词绩效数据
 */
export async function getSearchTermPerformance(
  campaignId: string,
  startDate: string,
  endDate: string
): Promise<SearchTermPerformance[]> {
  const dbInstance = await getDb();
  if (!dbInstance) return [];

  try {
    const results = await dbInstance.execute(sql`
      SELECT 
        st.search_term as searchTerm,
        st.campaign_id as campaignId,
        st.ad_group_id as adGroupId,
        st.match_type as matchType,
        SUM(st.impressions) as impressions,
        SUM(st.clicks) as clicks,
        SUM(st.cost) as cost,
        SUM(st.sales) as sales,
        SUM(st.orders) as orders,
        CASE WHEN SUM(st.sales) > 0 THEN SUM(st.cost) / SUM(st.sales) ELSE NULL END as acos,
        CASE WHEN SUM(st.cost) > 0 THEN SUM(st.sales) / SUM(st.cost) ELSE NULL END as roas,
        CASE WHEN SUM(st.impressions) > 0 THEN SUM(st.clicks) / SUM(st.impressions) ELSE 0 END as ctr,
        CASE WHEN SUM(st.clicks) > 0 THEN SUM(st.orders) / SUM(st.clicks) ELSE 0 END as cvr,
        CASE WHEN SUM(st.clicks) > 0 THEN SUM(st.cost) / SUM(st.clicks) ELSE 0 END as cpc
      FROM search_terms st
      WHERE st.campaign_id = ${campaignId}
        AND st.date BETWEEN ${startDate} AND ${endDate}
      GROUP BY st.search_term, st.campaign_id, st.ad_group_id, st.match_type
      ORDER BY SUM(st.cost) DESC
    `);

    return (results as any[]).map(row => ({
      searchTerm: row.searchTerm,
      campaignId: row.campaignId,
      adGroupId: row.adGroupId,
      matchType: row.matchType,
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
    console.error('[searchTermAnalysis] Error getting performance:', error);
    return [];
  }
}

/**
 * 分类搜索词
 */
export function categorizeSearchTerm(
  performance: SearchTermPerformance,
  params: SearchTermAnalysisParams = DEFAULT_SEARCH_TERM_PARAMS,
  brandTerms: string[] = []
): SearchTermCategory {
  const { highValueAcosThreshold, lowEfficiencyAcosThreshold, minClicks, minConversions } = params;

  // 检查是否为品牌词
  const lowerSearchTerm = performance.searchTerm.toLowerCase();
  if (brandTerms.some(brand => lowerSearchTerm.includes(brand.toLowerCase()))) {
    return 'brand_term';
  }

  // 数据不足
  if (performance.clicks < minClicks) {
    return 'insufficient_data';
  }

  // 无转化
  if (performance.orders === 0) {
    return 'low_efficiency';
  }

  // 高价值词
  if (performance.acos <= highValueAcosThreshold && performance.orders >= minConversions) {
    return 'high_value';
  }

  // 低效词
  if (performance.acos >= lowEfficiencyAcosThreshold) {
    return 'low_efficiency';
  }

  // 潜力词
  return 'potential';
}

/**
 * 生成搜索词优化建议
 */
export function generateSearchTermSuggestions(
  performance: SearchTermPerformance,
  category: SearchTermCategory,
  params: SearchTermAnalysisParams = DEFAULT_SEARCH_TERM_PARAMS
): SearchTermSuggestion[] {
  const suggestions: SearchTermSuggestion[] = [];
  const { targetAcos } = params;

  switch (category) {
    case 'high_value':
      // 高价值词：建议添加为精确匹配关键词
      suggestions.push({
        type: 'add_as_keyword',
        priority: 'high',
        title: '添加为精确匹配关键词',
        description: `搜索词"${performance.searchTerm}"表现优秀(ACoS ${(performance.acos * 100).toFixed(1)}%)，建议添加为精确匹配关键词以获得更好的控制`,
        suggestedMatchType: 'exact',
        suggestedBid: performance.cpc * 1.1,
        expectedImpact: '预计转化率提升10%，广告位置更稳定',
        confidenceScore: 0.9
      });

      // 如果是自动广告，建议迁移到手动广告
      if (performance.matchType === 'auto') {
        suggestions.push({
          type: 'migrate_to_manual',
          priority: 'high',
          title: '迁移到手动广告活动',
          description: `将高价值搜索词"${performance.searchTerm}"迁移到手动广告活动，可以更精细地控制竞价和预算`,
          suggestedMatchType: 'exact',
          suggestedBid: performance.cpc * 1.15,
          expectedImpact: '预计ROAS提升15%',
          confidenceScore: 0.85
        });
      }
      break;

    case 'potential':
      // 潜力词：建议优化竞价
      if (performance.acos > targetAcos) {
        suggestions.push({
          type: 'decrease_bid',
          priority: 'medium',
          title: '降低竞价优化ACoS',
          description: `搜索词"${performance.searchTerm}"有转化但ACoS(${(performance.acos * 100).toFixed(1)}%)略高，建议降低竞价`,
          suggestedBid: performance.cpc * 0.85,
          expectedImpact: `预计ACoS降低至${(performance.acos * 0.85 * 100).toFixed(1)}%`,
          confidenceScore: 0.75
        });
      } else {
        suggestions.push({
          type: 'increase_bid',
          priority: 'medium',
          title: '提高竞价获取更多流量',
          description: `搜索词"${performance.searchTerm}"ACoS(${(performance.acos * 100).toFixed(1)}%)低于目标，可以提高竞价获取更多流量`,
          suggestedBid: performance.cpc * 1.15,
          expectedImpact: '预计展示量增加20%',
          confidenceScore: 0.7
        });
      }
      break;

    case 'low_efficiency':
      // 低效词：建议添加为否定关键词
      if (performance.orders === 0 && performance.clicks >= params.minClicks * 2) {
        suggestions.push({
          type: 'add_negative',
          priority: 'high',
          title: '添加为否定关键词',
          description: `搜索词"${performance.searchTerm}"在${performance.clicks}次点击后无转化，花费$${performance.cost.toFixed(2)}，建议添加为否定关键词`,
          suggestedMatchType: 'phrase',
          expectedImpact: `预计每月节省$${(performance.cost * 30 / 30).toFixed(2)}`,
          confidenceScore: 0.9
        });
      } else if (performance.acos > params.lowEfficiencyAcosThreshold * 1.5) {
        suggestions.push({
          type: 'add_negative',
          priority: 'medium',
          title: '考虑添加为否定关键词',
          description: `搜索词"${performance.searchTerm}"ACoS(${(performance.acos * 100).toFixed(1)}%)过高，ROI为负`,
          suggestedMatchType: 'phrase',
          expectedImpact: '预计整体ACoS降低',
          confidenceScore: 0.75
        });
      }
      break;

    case 'brand_term':
      // 品牌词：建议单独管理
      suggestions.push({
        type: 'add_as_keyword',
        priority: 'medium',
        title: '创建品牌词专属广告组',
        description: `品牌搜索词"${performance.searchTerm}"建议放入专属广告组单独管理和监控`,
        suggestedMatchType: 'exact',
        expectedImpact: '更好地监控品牌词表现',
        confidenceScore: 0.8
      });
      break;

    default:
      break;
  }

  return suggestions;
}

/**
 * N-Gram分析
 */
export function performNGramAnalysis(
  searchTerms: SearchTermPerformance[]
): NGramAnalysisResult {
  const unigramMap = new Map<string, NGramData>();
  const bigramMap = new Map<string, NGramData>();
  const trigramMap = new Map<string, NGramData>();

  for (const st of searchTerms) {
    const words = st.searchTerm.toLowerCase().split(/\s+/).filter(w => w.length > 1);

    // Unigrams
    for (const word of words) {
      updateNGramData(unigramMap, word, st);
    }

    // Bigrams
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      updateNGramData(bigramMap, bigram, st);
    }

    // Trigrams
    for (let i = 0; i < words.length - 2; i++) {
      const trigram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      updateNGramData(trigramMap, trigram, st);
    }
  }

  // 计算平均值并排序
  const processNGrams = (map: Map<string, NGramData>): NGramData[] => {
    const result: NGramData[] = [];
    const entries = Array.from(map.entries());
    for (let i = 0; i < entries.length; i++) {
      const [, data] = entries[i];
      if (data.frequency >= 2) { // 至少出现2次
        data.avgAcos = data.totalSales > 0 ? data.totalCost / data.totalSales : 0;
        data.avgCtr = data.totalImpressions > 0 ? data.totalClicks / data.totalImpressions : 0;
        data.avgCvr = data.totalClicks > 0 ? data.totalOrders / data.totalClicks : 0;
        result.push(data);
      }
    }
    return result.sort((a, b) => b.totalCost - a.totalCost);
  };

  return {
    unigrams: processNGrams(unigramMap),
    bigrams: processNGrams(bigramMap),
    trigrams: processNGrams(trigramMap)
  };
}

function updateNGramData(
  map: Map<string, NGramData>,
  ngram: string,
  st: SearchTermPerformance
): void {
  const existing = map.get(ngram);
  if (existing) {
    existing.frequency++;
    existing.totalImpressions += st.impressions;
    existing.totalClicks += st.clicks;
    existing.totalCost += st.cost;
    existing.totalSales += st.sales;
    existing.totalOrders += st.orders;
    existing.searchTerms.push(st.searchTerm);
  } else {
    map.set(ngram, {
      ngram,
      frequency: 1,
      totalImpressions: st.impressions,
      totalClicks: st.clicks,
      totalCost: st.cost,
      totalSales: st.sales,
      totalOrders: st.orders,
      avgAcos: 0,
      avgCtr: 0,
      avgCvr: 0,
      searchTerms: [st.searchTerm]
    });
  }
}

/**
 * 识别需要否定的N-Gram
 */
export function identifyNegativeNGrams(
  ngramAnalysis: NGramAnalysisResult,
  params: SearchTermAnalysisParams = DEFAULT_SEARCH_TERM_PARAMS
): NGramData[] {
  const negativeNGrams: NGramData[] = [];
  const { lowEfficiencyAcosThreshold, minClicks } = params;

  const checkNGram = (ngram: NGramData) => {
    // 高花费无转化
    if (ngram.totalOrders === 0 && ngram.totalClicks >= minClicks * 2) {
      return true;
    }
    // ACoS过高
    if (ngram.avgAcos > lowEfficiencyAcosThreshold * 1.5 && ngram.totalClicks >= minClicks) {
      return true;
    }
    return false;
  };

  // 优先检查trigrams（更精确）
  for (const trigram of ngramAnalysis.trigrams) {
    if (checkNGram(trigram)) {
      negativeNGrams.push(trigram);
    }
  }

  // 然后检查bigrams
  for (const bigram of ngramAnalysis.bigrams) {
    if (checkNGram(bigram)) {
      // 确保没有被trigram覆盖
      const coveredByTrigram = negativeNGrams.some(
        ng => ng.ngram.includes(bigram.ngram)
      );
      if (!coveredByTrigram) {
        negativeNGrams.push(bigram);
      }
    }
  }

  // 最后检查unigrams
  for (const unigram of ngramAnalysis.unigrams) {
    if (checkNGram(unigram)) {
      // 确保没有被bigram或trigram覆盖
      const covered = negativeNGrams.some(
        ng => ng.ngram.includes(unigram.ngram)
      );
      if (!covered) {
        negativeNGrams.push(unigram);
      }
    }
  }

  return negativeNGrams;
}

/**
 * 完整的搜索词分析
 */
export async function analyzeSearchTerms(
  campaignId: string,
  params: SearchTermAnalysisParams = DEFAULT_SEARCH_TERM_PARAMS,
  brandTerms: string[] = []
): Promise<{
  results: SearchTermAnalysisResult[];
  ngramAnalysis: NGramAnalysisResult;
  negativeNGrams: NGramData[];
  summary: {
    totalSearchTerms: number;
    highValueCount: number;
    potentialCount: number;
    lowEfficiencyCount: number;
    insufficientDataCount: number;
    totalSuggestions: number;
  };
}> {
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const searchTerms = await getSearchTermPerformance(campaignId, startDate, endDate);

  const results: SearchTermAnalysisResult[] = [];
  let highValueCount = 0;
  let potentialCount = 0;
  let lowEfficiencyCount = 0;
  let insufficientDataCount = 0;
  let totalSuggestions = 0;

  for (const st of searchTerms) {
    const category = categorizeSearchTerm(st, params, brandTerms);
    const suggestions = generateSearchTermSuggestions(st, category, params);

    results.push({
      searchTerm: st.searchTerm,
      category,
      performance: st,
      suggestions
    });

    totalSuggestions += suggestions.length;

    switch (category) {
      case 'high_value':
        highValueCount++;
        break;
      case 'potential':
        potentialCount++;
        break;
      case 'low_efficiency':
        lowEfficiencyCount++;
        break;
      case 'insufficient_data':
        insufficientDataCount++;
        break;
    }
  }

  // N-Gram分析
  const ngramAnalysis = performNGramAnalysis(searchTerms);
  const negativeNGrams = identifyNegativeNGrams(ngramAnalysis, params);

  return {
    results,
    ngramAnalysis,
    negativeNGrams,
    summary: {
      totalSearchTerms: searchTerms.length,
      highValueCount,
      potentialCount,
      lowEfficiencyCount,
      insufficientDataCount,
      totalSuggestions
    }
  };
}

/**
 * 生成搜索词迁移计划
 */
export async function generateMigrationPlan(
  sourceCampaignId: string,
  targetCampaignId: string,
  params: SearchTermAnalysisParams = DEFAULT_SEARCH_TERM_PARAMS
): Promise<{
  searchTermsToMigrate: SearchTermPerformance[];
  suggestedBids: Map<string, number>;
  suggestedMatchTypes: Map<string, 'exact' | 'phrase' | 'broad'>;
  estimatedImpact: {
    additionalSales: number;
    additionalCost: number;
    expectedRoas: number;
  };
}> {
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const searchTerms = await getSearchTermPerformance(sourceCampaignId, startDate, endDate);

  const searchTermsToMigrate: SearchTermPerformance[] = [];
  const suggestedBids = new Map<string, number>();
  const suggestedMatchTypes = new Map<string, 'exact' | 'phrase' | 'broad'>();

  let additionalSales = 0;
  let additionalCost = 0;

  for (const st of searchTerms) {
    const category = categorizeSearchTerm(st, params);

    // 只迁移高价值和潜力词
    if (category === 'high_value' || category === 'potential') {
      searchTermsToMigrate.push(st);

      // 高价值词使用精确匹配，潜力词使用词组匹配
      const matchType = category === 'high_value' ? 'exact' : 'phrase';
      suggestedMatchTypes.set(st.searchTerm, matchType);

      // 建议竞价：高价值词提高10%，潜力词保持不变
      const bidMultiplier = category === 'high_value' ? 1.1 : 1.0;
      suggestedBids.set(st.searchTerm, st.cpc * bidMultiplier);

      // 估算影响
      additionalSales += st.sales * 0.15; // 预计提升15%
      additionalCost += st.cost * 0.1;    // 成本增加10%
    }
  }

  const expectedRoas = additionalCost > 0 ? additionalSales / additionalCost : 0;

  return {
    searchTermsToMigrate,
    suggestedBids,
    suggestedMatchTypes,
    estimatedImpact: {
      additionalSales,
      additionalCost,
      expectedRoas
    }
  };
}
