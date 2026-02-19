/**
 * 语义聚类否词服务
 * 
 * 通过语义相似度聚类识别无效搜索词根，提升N-Gram否词效率
 * 支持基于词向量的语义相似度计算和聚类分析
 */

import { getDb } from "./db";
import { searchTerms } from "../drizzle/schema";
import { eq, and, gte, sql } from "drizzle-orm";

// ==================== 类型定义 ====================

export interface SemanticCluster {
  clusterId: string;
  seedTerm: string;
  relatedTerms: string[];
  semanticSimilarity: number;
  aggregatedMetrics: {
    totalSpend: number;
    totalClicks: number;
    totalOrders: number;
    avgAcos: number;
    avgRoas: number;
  };
  negationRecommendation: 'strong' | 'moderate' | 'weak' | 'none';
  confidence: number;
}

export interface SearchTermData {
  searchTerm: string;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  acos: number;
  roas: number;
}

export interface ClusteringConfig {
  minSimilarityThreshold: number;  // 最小相似度阈值
  minClusterSize: number;          // 最小聚类大小
  minSpendThreshold: number;       // 最小花费阈值
  minClicksThreshold: number;      // 最小点击阈值
  targetAcos: number;              // 目标ACoS
  lookbackDays: number;            // 回溯天数
}

const DEFAULT_CONFIG: ClusteringConfig = {
  minSimilarityThreshold: 0.6,
  minClusterSize: 3,
  minSpendThreshold: 10,
  minClicksThreshold: 5,
  targetAcos: 0.30,
  lookbackDays: 30
};

// ==================== 词向量和相似度计算 ====================

/**
 * 简化的词向量表示
 * 基于字符n-gram和词频特征
 */
function getTermVector(term: string): Map<string, number> {
  const vector = new Map<string, number>();
  const normalizedTerm = term.toLowerCase().trim();
  const words = normalizedTerm.split(/\s+/);
  
  // 添加单词特征
  for (const word of words) {
    vector.set(`word:${word}`, (vector.get(`word:${word}`) || 0) + 1);
    
    // 添加字符2-gram特征
    for (let i = 0; i < word.length - 1; i++) {
      const bigram = word.substring(i, i + 2);
      vector.set(`char2:${bigram}`, (vector.get(`char2:${bigram}`) || 0) + 1);
    }
    
    // 添加字符3-gram特征
    for (let i = 0; i < word.length - 2; i++) {
      const trigram = word.substring(i, i + 3);
      vector.set(`char3:${trigram}`, (vector.get(`char3:${trigram}`) || 0) + 1);
    }
  }
  
  // 添加词数特征
  vector.set(`len:${words.length}`, 1);
  
  return vector;
}

/**
 * 计算两个词向量的余弦相似度
 */
function cosineSimilarity(vec1: Map<string, number>, vec2: Map<string, number>): number {
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  // 计算点积和第一个向量的范数
  for (const [key, val1] of vec1) {
    norm1 += val1 * val1;
    const val2 = vec2.get(key) || 0;
    dotProduct += val1 * val2;
  }
  
  // 计算第二个向量的范数
  for (const [, val2] of vec2) {
    norm2 += val2 * val2;
  }
  
  if (norm1 === 0 || norm2 === 0) return 0;
  
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * 计算两个搜索词的语义相似度
 */
export function calculateSemanticSimilarity(term1: string, term2: string): number {
  const vec1 = getTermVector(term1);
  const vec2 = getTermVector(term2);
  return cosineSimilarity(vec1, vec2);
}

/**
 * Jaccard相似度 - 基于词集合的相似度
 */
export function calculateJaccardSimilarity(term1: string, term2: string): number {
  const words1 = new Set(term1.toLowerCase().split(/\s+/));
  const words2 = new Set(term2.toLowerCase().split(/\s+/));
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * 综合相似度 - 结合语义相似度和Jaccard相似度
 */
export function calculateCombinedSimilarity(term1: string, term2: string): number {
  const semanticSim = calculateSemanticSimilarity(term1, term2);
  const jaccardSim = calculateJaccardSimilarity(term1, term2);
  
  // 加权平均，语义相似度权重更高
  return semanticSim * 0.7 + jaccardSim * 0.3;
}

// ==================== 聚类算法 ====================

/**
 * 基于相似度的层次聚类
 */
export function hierarchicalClustering(
  terms: SearchTermData[],
  config: ClusteringConfig
): SemanticCluster[] {
  if (terms.length === 0) return [];
  
  // 初始化：每个词作为一个单独的聚类
  const clusters: {
    terms: SearchTermData[];
    centroid: string;
  }[] = terms.map(t => ({
    terms: [t],
    centroid: t.searchTerm
  }));
  
  // 计算所有词对的相似度
  const similarities: { i: number; j: number; sim: number }[] = [];
  for (let i = 0; i < terms.length; i++) {
    for (let j = i + 1; j < terms.length; j++) {
      const sim = calculateCombinedSimilarity(terms[i].searchTerm, terms[j].searchTerm);
      if (sim >= config.minSimilarityThreshold) {
        similarities.push({ i, j, sim });
      }
    }
  }
  
  // 按相似度降序排序
  similarities.sort((a, b) => b.sim - a.sim);
  
  // 合并聚类
  const clusterAssignment = terms.map((_, i) => i);
  
  for (const { i, j } of similarities) {
    const clusterI = clusterAssignment[i];
    const clusterJ = clusterAssignment[j];
    
    if (clusterI !== clusterJ) {
      // 合并聚类
      const mergedTerms = [...clusters[clusterI].terms, ...clusters[clusterJ].terms];
      
      // 选择花费最高的词作为中心词
      const centroid = mergedTerms.reduce((max, t) => 
        t.spend > max.spend ? t : max
      ).searchTerm;
      
      clusters[clusterI] = { terms: mergedTerms, centroid };
      clusters[clusterJ] = { terms: [], centroid: '' };
      
      // 更新聚类分配
      for (let k = 0; k < clusterAssignment.length; k++) {
        if (clusterAssignment[k] === clusterJ) {
          clusterAssignment[k] = clusterI;
        }
      }
    }
  }
  
  // 过滤空聚类并转换为结果格式
  const result: SemanticCluster[] = [];
  const processedClusters = new Set<number>();
  
  for (let i = 0; i < clusters.length; i++) {
    if (processedClusters.has(clusterAssignment[i])) continue;
    processedClusters.add(clusterAssignment[i]);
    
    const cluster = clusters[clusterAssignment[i]];
    if (cluster.terms.length < config.minClusterSize) continue;
    
    // 计算聚合指标
    const totalSpend = cluster.terms.reduce((sum, t) => sum + t.spend, 0);
    const totalClicks = cluster.terms.reduce((sum, t) => sum + t.clicks, 0);
    const totalOrders = cluster.terms.reduce((sum, t) => sum + t.orders, 0);
    const totalSales = cluster.terms.reduce((sum, t) => sum + t.sales, 0);
    
    const avgAcos = totalSales > 0 ? totalSpend / totalSales : 0;
    const avgRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
    
    // 计算平均相似度
    let totalSim = 0;
    let simCount = 0;
    for (let j = 0; j < cluster.terms.length; j++) {
      for (let k = j + 1; k < cluster.terms.length; k++) {
        totalSim += calculateCombinedSimilarity(
          cluster.terms[j].searchTerm,
          cluster.terms[k].searchTerm
        );
        simCount++;
      }
    }
    const avgSimilarity = simCount > 0 ? totalSim / simCount : 1;
    
    // 确定否定建议
    let negationRecommendation: 'strong' | 'moderate' | 'weak' | 'none';
    if (avgAcos > config.targetAcos * 2 && totalOrders === 0) {
      negationRecommendation = 'strong';
    } else if (avgAcos > config.targetAcos * 1.5) {
      negationRecommendation = 'moderate';
    } else if (avgAcos > config.targetAcos) {
      negationRecommendation = 'weak';
    } else {
      negationRecommendation = 'none';
    }
    
    // 计算置信度
    const clickConfidence = Math.min(1, totalClicks / 100);
    const sizeConfidence = Math.min(1, cluster.terms.length / 10);
    const confidence = (clickConfidence * 0.6 + sizeConfidence * 0.4) * avgSimilarity;
    
    result.push({
      clusterId: `cluster_${i}`,
      seedTerm: cluster.centroid,
      relatedTerms: cluster.terms
        .filter(t => t.searchTerm !== cluster.centroid)
        .map(t => t.searchTerm),
      semanticSimilarity: Math.round(avgSimilarity * 100) / 100,
      aggregatedMetrics: {
        totalSpend: Math.round(totalSpend * 100) / 100,
        totalClicks,
        totalOrders,
        avgAcos: Math.round(avgAcos * 100) / 100,
        avgRoas: Math.round(avgRoas * 100) / 100
      },
      negationRecommendation,
      confidence: Math.round(confidence * 100) / 100
    });
  }
  
  // 按花费降序排序
  return result.sort((a, b) => b.aggregatedMetrics.totalSpend - a.aggregatedMetrics.totalSpend);
}

// ==================== 主要服务函数 ====================

/**
 * 获取搜索词数据
 */
export async function getSearchTermData(
  accountId: number,
  config: Partial<ClusteringConfig> = {}
): Promise<SearchTermData[]> {
  const db = await getDb();
  if (!db) return [];
  
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - finalConfig.lookbackDays);
  const startDateStr = startDate.toISOString();
  
  try {
    const result = await db
      .select({
        searchTerm: searchTerms.searchTerm,
        impressions: sql<number>`SUM(${searchTerms.searchTermImpressions})`,
        clicks: sql<number>`SUM(${searchTerms.searchTermClicks})`,
        spend: sql<string>`SUM(${searchTerms.searchTermSpend})`,
        sales: sql<string>`SUM(${searchTerms.searchTermSales})`,
        orders: sql<number>`SUM(${searchTerms.searchTermOrders})`,
      })
      .from(searchTerms)
      .where(
        and(
          eq(searchTerms.accountId, accountId),
          gte(searchTerms.reportStartDate, startDateStr)
        )
      )
      .groupBy(searchTerms.searchTerm)
      .having(
        and(
          sql`SUM(${searchTerms.searchTermClicks}) >= ${finalConfig.minClicksThreshold}`,
          sql`SUM(${searchTerms.searchTermSpend}) >= ${finalConfig.minSpendThreshold}`
        )
      );
    
    return result.map(row => {
      const spend = parseFloat(row.spend || '0');
      const sales = parseFloat(row.sales || '0');
      
      return {
        searchTerm: row.searchTerm,
        impressions: row.impressions || 0,
        clicks: row.clicks || 0,
        spend,
        sales,
        orders: row.orders || 0,
        acos: sales > 0 ? spend / sales : 0,
        roas: spend > 0 ? sales / spend : 0
      };
    });
  } catch (error) {
    console.error('[SemanticClustering] Error getting search term data:', error);
    return [];
  }
}

/**
 * 分析语义聚类并生成否词建议
 */
export async function analyzeSemanticClusters(
  accountId: number,
  config: Partial<ClusteringConfig> = {}
): Promise<{
  clusters: SemanticCluster[];
  summary: {
    totalClusters: number;
    strongNegationClusters: number;
    moderateNegationClusters: number;
    totalPotentialSavings: number;
  };
}> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  // 获取搜索词数据
  const searchTermData = await getSearchTermData(accountId, finalConfig);
  
  if (searchTermData.length === 0) {
    return {
      clusters: [],
      summary: {
        totalClusters: 0,
        strongNegationClusters: 0,
        moderateNegationClusters: 0,
        totalPotentialSavings: 0
      }
    };
  }
  
  // 执行聚类
  const clusters = hierarchicalClustering(searchTermData, finalConfig);
  
  // 计算汇总信息
  const strongNegationClusters = clusters.filter(c => c.negationRecommendation === 'strong');
  const moderateNegationClusters = clusters.filter(c => c.negationRecommendation === 'moderate');
  
  const totalPotentialSavings = [...strongNegationClusters, ...moderateNegationClusters]
    .reduce((sum, c) => sum + c.aggregatedMetrics.totalSpend, 0);
  
  return {
    clusters,
    summary: {
      totalClusters: clusters.length,
      strongNegationClusters: strongNegationClusters.length,
      moderateNegationClusters: moderateNegationClusters.length,
      totalPotentialSavings: Math.round(totalPotentialSavings * 100) / 100
    }
  };
}

/**
 * 查找与给定词语义相似的搜索词
 */
export async function findSimilarTerms(
  accountId: number,
  targetTerm: string,
  minSimilarity: number = 0.5,
  limit: number = 20
): Promise<{
  term: string;
  similarity: number;
  metrics: SearchTermData;
}[]> {
  const searchTermData = await getSearchTermData(accountId);
  
  const similarities = searchTermData
    .map(data => ({
      term: data.searchTerm,
      similarity: calculateCombinedSimilarity(targetTerm, data.searchTerm),
      metrics: data
    }))
    .filter(item => item.similarity >= minSimilarity && item.term !== targetTerm)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
  
  return similarities.map(s => ({
    ...s,
    similarity: Math.round(s.similarity * 100) / 100
  }));
}

/**
 * 生成否词建议
 */
export async function generateNegationSuggestions(
  accountId: number,
  config: Partial<ClusteringConfig> = {}
): Promise<{
  suggestions: {
    term: string;
    matchType: 'exact' | 'phrase' | 'broad';
    reason: string;
    potentialSavings: number;
    confidence: number;
    relatedTerms: string[];
  }[];
  totalPotentialSavings: number;
}> {
  const { clusters, summary } = await analyzeSemanticClusters(accountId, config);
  
  const suggestions: {
    term: string;
    matchType: 'exact' | 'phrase' | 'broad';
    reason: string;
    potentialSavings: number;
    confidence: number;
    relatedTerms: string[];
  }[] = [];
  
  for (const cluster of clusters) {
    if (cluster.negationRecommendation === 'none') continue;
    
    // 确定匹配类型
    let matchType: 'exact' | 'phrase' | 'broad';
    if (cluster.negationRecommendation === 'strong' && cluster.confidence >= 0.7) {
      matchType = 'phrase'; // 高置信度强建议使用词组匹配
    } else if (cluster.relatedTerms.length >= 5) {
      matchType = 'broad'; // 大聚类使用广泛匹配
    } else {
      matchType = 'exact'; // 默认使用精确匹配
    }
    
    // 生成原因说明
    let reason = '';
    if (cluster.aggregatedMetrics.totalOrders === 0) {
      reason = `无转化，花费$${cluster.aggregatedMetrics.totalSpend}，包含${cluster.relatedTerms.length + 1}个相似词`;
    } else {
      reason = `ACoS ${(cluster.aggregatedMetrics.avgAcos * 100).toFixed(1)}%超过目标，包含${cluster.relatedTerms.length + 1}个相似词`;
    }
    
    suggestions.push({
      term: cluster.seedTerm,
      matchType,
      reason,
      potentialSavings: cluster.aggregatedMetrics.totalSpend,
      confidence: cluster.confidence,
      relatedTerms: cluster.relatedTerms.slice(0, 5) // 只显示前5个相关词
    });
  }
  
  return {
    suggestions: suggestions.sort((a, b) => b.potentialSavings - a.potentialSavings),
    totalPotentialSavings: summary.totalPotentialSavings
  };
}
