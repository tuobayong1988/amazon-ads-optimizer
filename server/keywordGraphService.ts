import { createModuleLogger } from './utils/logger';
const log = createModuleLogger('KeywordGraphService');
/**
 * 关键词语义图谱服务 (Keyword Semantic Graph)
 * 
 * 核心功能：
 * 1. 从搜索词报告构建关键词→搜索词→ASIN的有向图
 * 2. 使用LLM生成关键词的语义嵌入向量
 * 3. 基于余弦相似度发现语义相似的关键词簇
 * 4. 识别高价值扩展机会（高转化搜索词未被投放）
 * 5. 识别否定词候选（高花费低转化的搜索词）
 * 6. 跨Campaign的关键词去重和冲突检测
 */
import { getDb } from "./db";
import {
  keywordSemanticGraph,
  keywords,
  searchTerms,
  productTargets,
  campaigns,
  adGroups,
} from "../drizzle/schema";
import { eq, and, gte, sql, desc } from "drizzle-orm";
import OpenAI from "openai";

// ==================== 类型定义 ====================

export interface GraphNode {
  id: string;
  type: 'keyword' | 'search_term' | 'asin';
  text: string;
  embedding?: number[];
  metrics?: {
    impressions: number;
    clicks: number;
    orders: number;
    spend: number;
    sales: number;
  };
}

export interface GraphEdge {
  sourceId: string;
  targetId: string;
  edgeType: 'triggers' | 'semantic_similar' | 'co_purchased' | 'competes_with' | 'converts_to';
  weight: number;
  sharedImpressions: number;
  sharedClicks: number;
  sharedOrders: number;
}

export interface KeywordOpportunity {
  searchTerm: string;
  impressions: number;
  clicks: number;
  orders: number;
  cvr: number;
  acos: number;
  suggestedMatchType: 'exact' | 'phrase' | 'broad';
  suggestedBid: number;
  confidence: number;
  reason: string;
}

export interface NegativeCandidate {
  searchTerm: string;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  acos: number;
  suggestedLevel: 'campaign' | 'ad_group';
  suggestedMatchType: 'negative_exact' | 'negative_phrase';
  reason: string;
}

// ==================== 辅助函数 ====================

async function getDbInstance() {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  return db;
}

/**
 * 余弦相似度
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dotProduct / denom : 0;
}

// ==================== LLM嵌入生成 ====================

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI();
  }
  return openaiClient;
}

/**
 * 批量生成关键词的语义嵌入向量
 * 使用GPT-4.1-nano生成结构化语义表示
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  
  const client = getOpenAIClient();
  const embeddings: number[][] = [];
  
  // 分批处理（每批最多20个）
  const batchSize = 20;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    
    try {
      // 使用LLM生成语义特征向量（简化版embedding）
      const response = await client.chat.completions.create({
        model: 'gpt-4.1-nano',
        messages: [{
          role: 'system',
          content: `You are a keyword semantic analyzer for Amazon advertising. For each keyword, output a JSON array of 32 numbers between -1 and 1 representing semantic features:
[purchase_intent, brand_specificity, product_category_breadth, price_sensitivity, urgency, comparison_intent, informational_intent, seasonal_relevance, competition_level, long_tail_score, ...22 more semantic dimensions].
Output ONLY the JSON array, no explanation.`
        }, {
          role: 'user',
          content: `Generate semantic embeddings for these keywords:\n${batch.map((t, idx) => `${idx + 1}. "${t}"`).join('\n')}\n\nOutput a JSON array of arrays, one 32-dim vector per keyword.`
        }],
        temperature: 0,
        max_tokens: 2000,
      });
      
      const content = response.choices[0]?.message?.content || '[]';
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed) && parsed.length === batch.length) {
          embeddings.push(...parsed);
        } else if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'number') {
          // 单个向量
          embeddings.push(parsed);
          for (let j = 1; j < batch.length; j++) embeddings.push(Array(32).fill(0));
        } else {
          for (const _ of batch) embeddings.push(Array(32).fill(0));
        }
      } catch {
        for (const _ of batch) embeddings.push(Array(32).fill(0));
      }
    } catch (error) {
      log.error(`[KeywordGraph] Embedding generation error:`, error);
      for (const _ of batch) embeddings.push(Array(32).fill(0));
    }
  }
  
  return embeddings;
}

// ==================== 图谱构建 ====================

/**
 * 从搜索词报告构建关键词图谱
 */
export async function buildKeywordGraph(accountId: number): Promise<{
  nodes: number;
  edges: number;
  opportunities: number;
  negatives: number;
}> {
  const db = await getDbInstance();
  const result = { nodes: 0, edges: 0, opportunities: 0, negatives: 0 };
  
  try {
    // 获取搜索词数据
    const searchTermData = await db.select({
      id: searchTerms.id,
      keywordId: searchTerms.searchTermTargetId,
      keywordText: searchTerms.targetText,
      searchTerm: searchTerms.searchTerm,
      impressions: searchTerms.searchTermImpressions,
      clicks: searchTerms.searchTermClicks,
      orders: searchTerms.searchTermOrders,
      spend: searchTerms.searchTermSpend,
      sales: searchTerms.searchTermSales,
    }).from(searchTerms)
      .where(eq(searchTerms.accountId, accountId))
      .limit(5000);
    
    if (searchTermData.length === 0) return result;
    
    // 构建图的边
    const edges: GraphEdge[] = [];
    const uniqueSearchTerms = new Map<string, { impressions: number; clicks: number; orders: number; spend: number; sales: number }>();
    const keywordToSearchTerms = new Map<string, string[]>();
    
    for (const st of searchTermData) {
      const searchTerm = st.searchTerm || '';
      const keywordText = st.keywordText || '';
      
      // 关键词 → 搜索词 (triggers)
      edges.push({
        sourceId: keywordText,
        targetId: searchTerm,
        edgeType: 'triggers',
        weight: Number(st.clicks) || 0,
        sharedImpressions: Number(st.impressions) || 0,
        sharedClicks: Number(st.clicks) || 0,
        sharedOrders: Number(st.orders) || 0,
      });
      
      // 聚合搜索词数据
      const existing = uniqueSearchTerms.get(searchTerm) || { impressions: 0, clicks: 0, orders: 0, spend: 0, sales: 0 };
      existing.impressions += Number(st.impressions) || 0;
      existing.clicks += Number(st.clicks) || 0;
      existing.orders += Number(st.orders) || 0;
      existing.spend += Number(st.spend) || 0;
      existing.sales += Number(st.sales) || 0;
      uniqueSearchTerms.set(searchTerm, existing);
      
      // 关键词到搜索词的映射
      const stList = keywordToSearchTerms.get(keywordText) || [];
      stList.push(searchTerm);
      keywordToSearchTerms.set(keywordText, stList);
    }
    
    result.edges = edges.length;
    result.nodes = uniqueSearchTerms.size + keywordToSearchTerms.size;
    
    // 批量保存到数据库
    const batchSize = 100;
    const edgeValues = edges.slice(0, 2000); // 限制保存数量
    for (let i = 0; i < edgeValues.length; i += batchSize) {
      const batch = edgeValues.slice(i, i + batchSize);
      await db.insert(keywordSemanticGraph).values(
        batch.map(e => ({
          accountId,
          sourceNodeType: 'keyword' as const,
          sourceNodeId: e.sourceId,
          targetNodeType: 'search_term' as const,
          targetNodeId: e.targetId,
          edgeType: e.edgeType as any,
          edgeWeight: String(e.weight),
          sharedImpressions: e.sharedImpressions,
          sharedClicks: e.sharedClicks,
          sharedOrders: e.sharedOrders,
          isOpportunity: 0,
          isNegativeCandidate: 0,
        }))
      );
    }
    
    log.info(`[KeywordGraph] Built graph: ${result.nodes} nodes, ${result.edges} edges`);
    return result;
    
  } catch (error) {
    log.error(`[KeywordGraph] Error building graph:`, error);
    return result;
  }
}

// ==================== 机会发现 ====================

/**
 * 发现高价值关键词扩展机会
 * 条件：搜索词有转化但未被作为关键词投放
 */
export async function discoverOpportunities(accountId: number): Promise<KeywordOpportunity[]> {
  const db = await getDbInstance();
  const opportunities: KeywordOpportunity[] = [];
  
  try {
    // 获取有转化的搜索词
    const convertingSearchTerms = await db.select({
      searchTerm: searchTerms.searchTerm,
      totalImpressions: sql<number>`SUM(search_term_impressions)`,
      totalClicks: sql<number>`SUM(search_term_clicks)`,
      totalOrders: sql<number>`SUM(search_term_orders)`,
      totalSpend: sql<number>`SUM(CAST(search_term_spend AS DECIMAL(10,2)))`,
      totalSales: sql<number>`SUM(CAST(search_term_sales AS DECIMAL(10,2)))`,
    }).from(searchTerms)
      .where(eq(searchTerms.accountId, accountId))
      .groupBy(searchTerms.searchTerm)
      .having(sql`SUM(search_term_orders) >= 2`)
      .orderBy(desc(sql`SUM(search_term_orders)`))
      .limit(200);
    
    // 获取已投放的关键词文本（通过JOIN获取accountId）
    const existingKeywords = await db.select({
      keywordText: keywords.keywordText,
    }).from(keywords)
      .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
      .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
      .where(and(
        eq(campaigns.accountId, accountId),
        eq(keywords.keywordStatus, 'enabled')
      ));
    
    const existingSet = new Set(existingKeywords.map(k => (k.keywordText || '').toLowerCase()));
    
    for (const st of convertingSearchTerms) {
      const term = (st.searchTerm || '').toLowerCase();
      if (existingSet.has(term)) continue;
      
      const clicks = Number(st.totalClicks) || 0;
      const orders = Number(st.totalOrders) || 0;
      const spend = Number(st.totalSpend) || 0;
      const sales = Number(st.totalSales) || 0;
      const cvr = clicks > 0 ? orders / clicks : 0;
      const acos = sales > 0 ? spend / sales : 1;
      
      // 只推荐ACOS < 40%的搜索词
      if (acos > 0.4) continue;
      
      const suggestedBid = clicks > 0 ? spend / clicks * 0.9 : 0.5;
      const wordCount = term.split(' ').length;
      
      opportunities.push({
        searchTerm: st.searchTerm || '',
        impressions: Number(st.totalImpressions) || 0,
        clicks,
        orders,
        cvr,
        acos,
        suggestedMatchType: wordCount >= 4 ? 'exact' : wordCount >= 2 ? 'phrase' : 'broad',
        suggestedBid: Math.round(suggestedBid * 100) / 100,
        confidence: Math.min(1, orders / 5),
        reason: `${orders}个转化, CVR=${(cvr * 100).toFixed(1)}%, ACOS=${(acos * 100).toFixed(1)}%`,
      });
    }
    
    // 标记机会
    for (const opp of opportunities.slice(0, 50)) {
      await db.update(keywordSemanticGraph)
        .set({ isOpportunity: 1 })
        .where(and(
          eq(keywordSemanticGraph.accountId, accountId),
          eq(keywordSemanticGraph.targetNodeId, opp.searchTerm)
        ));
    }
    
    return opportunities;
    
  } catch (error) {
    log.error(`[KeywordGraph] Error discovering opportunities:`, error);
    return opportunities;
  }
}

/**
 * 发现否定词候选
 * 条件：高花费低转化的搜索词
 */
export async function discoverNegativeCandidates(accountId: number): Promise<NegativeCandidate[]> {
  const db = await getDbInstance();
  const candidates: NegativeCandidate[] = [];
  
  try {
    const wastefulTerms = await db.select({
      searchTerm: searchTerms.searchTerm,
      totalImpressions: sql<number>`SUM(search_term_impressions)`,
      totalClicks: sql<number>`SUM(search_term_clicks)`,
      totalOrders: sql<number>`SUM(search_term_orders)`,
      totalSpend: sql<number>`SUM(CAST(search_term_spend AS DECIMAL(10,2)))`,
      totalSales: sql<number>`SUM(CAST(search_term_sales AS DECIMAL(10,2)))`,
    }).from(searchTerms)
      .where(eq(searchTerms.accountId, accountId))
      .groupBy(searchTerms.searchTerm)
      .having(sql`SUM(search_term_clicks) >= 10 AND SUM(search_term_orders) = 0`)
      .orderBy(desc(sql`SUM(CAST(search_term_spend AS DECIMAL(10,2)))`))
      .limit(100);
    
    for (const st of wastefulTerms) {
      const clicks = Number(st.totalClicks) || 0;
      const spend = Number(st.totalSpend) || 0;
      const term = st.searchTerm || '';
      const wordCount = term.split(' ').length;
      
      candidates.push({
        searchTerm: term,
        impressions: Number(st.totalImpressions) || 0,
        clicks,
        spend,
        orders: 0,
        acos: Infinity,
        suggestedLevel: wordCount <= 2 ? 'campaign' : 'ad_group',
        suggestedMatchType: wordCount >= 3 ? 'negative_exact' : 'negative_phrase',
        reason: `${clicks}次点击, $${spend.toFixed(2)}花费, 0转化`,
      });
    }
    
    // 标记否定词候选
    for (const neg of candidates.slice(0, 50)) {
      await db.update(keywordSemanticGraph)
        .set({ isNegativeCandidate: 1 })
        .where(and(
          eq(keywordSemanticGraph.accountId, accountId),
          eq(keywordSemanticGraph.targetNodeId, neg.searchTerm)
        ));
    }
    
    return candidates;
    
  } catch (error) {
    log.error(`[KeywordGraph] Error discovering negatives:`, error);
    return candidates;
  }
}
