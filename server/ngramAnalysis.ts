/**
 * N-Gram否词分析算法
 * 
 * 通过词根拆分和频率统计，批量识别无效词根
 * 支持核心词根排除，避免过度否词
 */

import { getDb } from "./db";
import { searchTerms, keywords, negativeKeywords } from "../drizzle/schema";
import { eq, and, gte, lte, sql, inArray } from "drizzle-orm";

// N-Gram分析配置
export const NGRAM_CONFIG = {
  // 频率阈值（减半后的值）
  MIN_FREQUENCY: 25,           // 词根最小出现频率
  MIN_SPEND: 12.5,             // 词根最小花费阈值（美元）
  
  // 分析参数
  MIN_NGRAM_LENGTH: 2,         // 最小N-Gram长度
  MAX_NGRAM_LENGTH: 3,         // 最大N-Gram长度（1=单词, 2=双词组合, 3=三词组合）
  
  // 停用词列表（不参与分析的常见词）
  STOP_WORDS: new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
    'used', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he',
    'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your',
    'his', 'her', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs',
  ]),
  
  // 常见无效词根（默认否定候选）
  COMMON_NEGATIVE_ROOTS: new Set([
    'free', 'cheap', 'discount', 'used', 'repair', 'fix', 'broken',
    'diy', 'homemade', 'alternative', 'substitute', 'knock off',
    'fake', 'counterfeit', 'replica', 'imitation', 'wholesale',
    'bulk', 'sample', 'trial', 'demo', 'test', 'review', 'comparison',
  ]),
};

// N-Gram分析结果类型
export interface NgramAnalysisResult {
  ngram: string;
  frequency: number;
  totalClicks: number;
  totalSpend: number;
  totalOrders: number;
  totalSales: number;
  avgCtr: number;
  avgCvr: number;
  acos: number;
  roas: number;
  searchTerms: string[];
  isNegativeCandidate: boolean;
  reason: string;
  matchType: 'phrase' | 'exact';
  priority: 'high' | 'medium' | 'low';
}

// 否词建议类型
export interface NegativeKeywordSuggestion {
  ngram: string;
  matchType: 'phrase' | 'exact';
  frequency: number;
  totalSpend: number;
  totalClicks: number;
  totalOrders: number;
  acos: number;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  affectedSearchTerms: string[];
  estimatedSavings: number;
}

/**
 * 词根拆分（Tokenization）
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 2 && !NGRAM_CONFIG.STOP_WORDS.has(word));
}

/**
 * 生成N-Gram
 */
export function generateNgrams(tokens: string[], n: number): string[] {
  const ngrams: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    ngrams.push(tokens.slice(i, i + n).join(' '));
  }
  return ngrams;
}

/**
 * 获取核心投放词根列表（用于排除）
 */
export async function getCoreKeywordRoots(
  accountId: number,
  campaignIds?: number[]
): Promise<Set<string>> {
  const db = await getDb();
  if (!db) return new Set();
  
  let query = `
    SELECT DISTINCT keyword_text 
    FROM keywords 
    WHERE account_id = ?
  `;
  const params: any[] = [accountId];
  
  if (campaignIds && campaignIds.length > 0) {
    query += ` AND campaign_id IN (${campaignIds.map(() => '?').join(',')})`;
    params.push(...campaignIds);
  }
  
  const result = await db.execute(sql.raw(query));
  const rows = (result as any[])[0] || [];
  
  const coreRoots = new Set<string>();
  for (const row of rows) {
    const tokens = tokenize(row.keyword_text || '');
    tokens.forEach(token => coreRoots.add(token));
  }
  
  return coreRoots;
}

/**
 * 分析搜索词的N-Gram
 */
export async function analyzeSearchTermNgrams(
  accountId: number,
  campaignIds?: number[],
  days: number = 30
): Promise<Map<string, NgramAnalysisResult>> {
  const db = await getDb();
  if (!db) return new Map();
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];
  
  // 获取核心词根（用于排除）
  const coreRoots = await getCoreKeywordRoots(accountId, campaignIds);
  
  // 查询搜索词数据
  let query = `
    SELECT 
      search_term,
      SUM(search_term_impressions) as impressions,
      SUM(search_term_clicks) as clicks,
      SUM(search_term_spend) as spend,
      SUM(search_term_sales) as sales,
      SUM(search_term_orders) as orders
    FROM search_terms
    WHERE account_id = ?
    AND report_start_date >= ?
  `;
  const params: any[] = [accountId, startDateStr];
  
  if (campaignIds && campaignIds.length > 0) {
    query += ` AND campaign_id IN (${campaignIds.map(() => '?').join(',')})`;
    params.push(...campaignIds);
  }
  
  query += ` GROUP BY search_term`;
  
  const result = await db.execute(sql.raw(query));
  const searchTermData = (result as any[])[0] || [];
  
  // 统计N-Gram
  const ngramStats = new Map<string, {
    frequency: number;
    totalClicks: number;
    totalSpend: number;
    totalOrders: number;
    totalSales: number;
    totalImpressions: number;
    searchTerms: Set<string>;
  }>();
  
  for (const row of searchTermData) {
    const tokens = tokenize(row.search_term || '');
    
    // 生成1-gram, 2-gram, 3-gram
    for (let n = 1; n <= NGRAM_CONFIG.MAX_NGRAM_LENGTH; n++) {
      const ngrams = generateNgrams(tokens, n);
      
      for (const ngram of ngrams) {
        // 跳过核心词根
        const ngramTokens = ngram.split(' ');
        if (ngramTokens.some(t => coreRoots.has(t))) {
          continue;
        }
        
        const existing = ngramStats.get(ngram) || {
          frequency: 0,
          totalClicks: 0,
          totalSpend: 0,
          totalOrders: 0,
          totalSales: 0,
          totalImpressions: 0,
          searchTerms: new Set<string>(),
        };
        
        existing.frequency++;
        existing.totalClicks += Number(row.clicks) || 0;
        existing.totalSpend += Number(row.spend) || 0;
        existing.totalOrders += Number(row.orders) || 0;
        existing.totalSales += Number(row.sales) || 0;
        existing.totalImpressions += Number(row.impressions) || 0;
        existing.searchTerms.add(row.search_term);
        
        ngramStats.set(ngram, existing);
      }
    }
  }
  
  // 转换为分析结果
  const analysisResults = new Map<string, NgramAnalysisResult>();
  
  for (const [ngram, stats] of Array.from(ngramStats.entries())) {
    // 过滤低频词根
    if (stats.frequency < NGRAM_CONFIG.MIN_FREQUENCY) continue;
    if (stats.totalSpend < NGRAM_CONFIG.MIN_SPEND) continue;
    
    const avgCtr = stats.totalImpressions > 0 
      ? (stats.totalClicks / stats.totalImpressions) * 100 
      : 0;
    const avgCvr = stats.totalClicks > 0 
      ? (stats.totalOrders / stats.totalClicks) * 100 
      : 0;
    const acos = stats.totalSales > 0 
      ? (stats.totalSpend / stats.totalSales) * 100 
      : Infinity;
    const roas = stats.totalSpend > 0 
      ? stats.totalSales / stats.totalSpend 
      : 0;
    
    // 判断是否为否定候选
    let isNegativeCandidate = false;
    let reason = '';
    let priority: 'high' | 'medium' | 'low' = 'low';
    
    // 高优先级：常见无效词根
    if (NGRAM_CONFIG.COMMON_NEGATIVE_ROOTS.has(ngram)) {
      isNegativeCandidate = true;
      reason = '常见无效词根';
      priority = 'high';
    }
    // 高优先级：高花费零转化
    else if (stats.totalOrders === 0 && stats.totalSpend >= NGRAM_CONFIG.MIN_SPEND * 2) {
      isNegativeCandidate = true;
      reason = `高花费零转化 (花费$${stats.totalSpend.toFixed(2)}, 0订单)`;
      priority = 'high';
    }
    // 中优先级：低转化高ACoS
    else if (avgCvr < 1 && acos > 100) {
      isNegativeCandidate = true;
      reason = `低转化高ACoS (CVR ${avgCvr.toFixed(2)}%, ACoS ${acos.toFixed(0)}%)`;
      priority = 'medium';
    }
    // 低优先级：一般表现不佳
    else if (acos > 50 && stats.totalOrders < 3) {
      isNegativeCandidate = true;
      reason = `表现不佳 (ACoS ${acos.toFixed(0)}%, ${stats.totalOrders}订单)`;
      priority = 'low';
    }
    
    // 确定匹配类型
    const matchType: 'phrase' | 'exact' = ngram.split(' ').length > 1 ? 'phrase' : 'exact';
    
    analysisResults.set(ngram, {
      ngram,
      frequency: stats.frequency,
      totalClicks: stats.totalClicks,
      totalSpend: stats.totalSpend,
      totalOrders: stats.totalOrders,
      totalSales: stats.totalSales,
      avgCtr,
      avgCvr,
      acos,
      roas,
      searchTerms: Array.from(stats.searchTerms),
      isNegativeCandidate,
      reason,
      matchType,
      priority,
    });
  }
  
  return analysisResults;
}

/**
 * 生成否词建议
 */
export async function generateNegativeKeywordSuggestions(
  accountId: number,
  campaignIds?: number[],
  days: number = 30
): Promise<NegativeKeywordSuggestion[]> {
  const analysisResults = await analyzeSearchTermNgrams(accountId, campaignIds, days);
  
  const suggestions: NegativeKeywordSuggestion[] = [];
  
  for (const [ngram, result] of Array.from(analysisResults.entries())) {
    if (!result.isNegativeCandidate) continue;
    
    suggestions.push({
      ngram: result.ngram,
      matchType: result.matchType,
      frequency: result.frequency,
      totalSpend: result.totalSpend,
      totalClicks: result.totalClicks,
      totalOrders: result.totalOrders,
      acos: result.acos,
      reason: result.reason,
      priority: result.priority,
      affectedSearchTerms: result.searchTerms.slice(0, 10), // 最多显示10个
      estimatedSavings: result.totalSpend * 0.8, // 预估节省80%花费
    });
  }
  
  // 按优先级和花费排序
  suggestions.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return b.totalSpend - a.totalSpend;
  });
  
  return suggestions;
}

/**
 * 执行否词（添加到否定词列表）
 */
export async function executeNegativeKeywords(
  accountId: number,
  campaignId: number,
  adGroupId: number | null,
  negatives: Array<{ keyword: string; matchType: 'phrase' | 'exact' }>
): Promise<{ success: boolean; addedCount: number; errors: string[] }> {
  const db = await getDb();
  if (!db) return { success: false, addedCount: 0, errors: ['Database not available'] };
  
  const errors: string[] = [];
  let addedCount = 0;
  
  for (const negative of negatives) {
    try {
      await db.insert(negativeKeywords).values({
        accountId,
        campaignId,
        adGroupId,
        negativeLevel: adGroupId ? 'ad_group' : 'campaign',
        negativeType: 'keyword',
        negativeText: negative.keyword,
        negativeMatchType: negative.matchType === 'phrase' ? 'negative_phrase' : 'negative_exact',
        negativeSource: 'ngram_analysis',
        negativeStatus: 'active',
      });
      addedCount++;
    } catch (error: any) {
      if (!error.message?.includes('Duplicate')) {
        errors.push(`添加否定词 "${negative.keyword}" 失败: ${error.message}`);
      }
    }
  }
  
  return {
    success: errors.length === 0,
    addedCount,
    errors,
  };
}

/**
 * 获取N-Gram分析摘要
 */
export async function getNgramAnalysisSummary(
  accountId: number,
  campaignIds?: number[],
  days: number = 30
): Promise<{
  totalSearchTerms: number;
  totalNgrams: number;
  negativeCandidates: number;
  highPriority: number;
  mediumPriority: number;
  lowPriority: number;
  estimatedSavings: number;
}> {
  const analysisResults = await analyzeSearchTermNgrams(accountId, campaignIds, days);
  
  let totalSearchTerms = 0;
  let negativeCandidates = 0;
  let highPriority = 0;
  let mediumPriority = 0;
  let lowPriority = 0;
  let estimatedSavings = 0;
  
  const allSearchTerms = new Set<string>();
  
  for (const [_, result] of Array.from(analysisResults.entries())) {
    result.searchTerms.forEach(st => allSearchTerms.add(st));
    
    if (result.isNegativeCandidate) {
      negativeCandidates++;
      estimatedSavings += result.totalSpend * 0.8;
      
      switch (result.priority) {
        case 'high': highPriority++; break;
        case 'medium': mediumPriority++; break;
        case 'low': lowPriority++; break;
      }
    }
  }
  
  return {
    totalSearchTerms: allSearchTerms.size,
    totalNgrams: analysisResults.size,
    negativeCandidates,
    highPriority,
    mediumPriority,
    lowPriority,
    estimatedSavings,
  };
}

/**
 * 生成N-Gram分析报告
 */
export async function generateNgramAnalysisReport(
  accountId: number,
  campaignIds?: number[],
  days: number = 30
): Promise<{
  summary: Awaited<ReturnType<typeof getNgramAnalysisSummary>>;
  suggestions: NegativeKeywordSuggestion[];
  topWastefulNgrams: NgramAnalysisResult[];
  coreRootsExcluded: string[];
}> {
  const summary = await getNgramAnalysisSummary(accountId, campaignIds, days);
  const suggestions = await generateNegativeKeywordSuggestions(accountId, campaignIds, days);
  const analysisResults = await analyzeSearchTermNgrams(accountId, campaignIds, days);
  const coreRoots = await getCoreKeywordRoots(accountId, campaignIds);
  
  // 获取花费最高的N-Gram（无论是否为否定候选）
  const topWastefulNgrams = Array.from(analysisResults.values())
    .filter(r => r.totalOrders === 0 || r.acos > 50)
    .sort((a, b) => b.totalSpend - a.totalSpend)
    .slice(0, 20);
  
  return {
    summary,
    suggestions: suggestions.slice(0, 50), // 最多50条建议
    topWastefulNgrams,
    coreRootsExcluded: Array.from(coreRoots).slice(0, 100), // 最多显示100个核心词根
  };
}
