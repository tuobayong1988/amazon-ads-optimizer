/**
 * M1 知识图谱构建器服务
 * 
 * 本服务负责关键词知识图谱的高级分析功能：
 * 
 * 1. 图谱拓扑分析 — 计算节点中心度、社区检测、桥接词识别
 * 2. 蓝海验证 — 对机会词进行"CT扫描"，区分真蓝海和伪蓝海
 * 3. 竞品校准 — 用竞品数据校准关键词的商业价值评分
 * 4. 图谱导出 — 导出为D3.js/ECharts可视化格式和广告组映射
 * 5. 增量更新 — 支持新增关键词的增量图谱融合
 * 
 * 参考文档：《从词库到知识图谱：人工搭建"关系型词库"的实操指南》
 */
import { getDb } from '../../db';
import {
  prelaunchKeywords, prelaunchKeywordClusters,
  prelaunchKeywordRelations, prelaunchCosmoTriples,
  prelaunchKeywordSceneWeights, prelaunchGraphSnapshots,
  prelaunchCompetitors,
} from '../../../drizzle/schema';
import { eq, desc, and, sql, inArray } from 'drizzle-orm';
import { geminiChat, geminiStructuredOutput } from '../gemini';

// ============================================================
// 类型定义
// ============================================================

/** 图谱节点（用于可视化） */
interface GraphNode {
  id: number;
  label: string;
  group: string;       // 聚类标签
  size: number;        // 基于KVI评分的节点大小
  color: string;       // 基于商业价值的颜色
  x?: number;
  y?: number;
  metadata: {
    relevanceLayer: string;
    commercialValue: string;
    userIntent: string;
    purchaseStage: string;
    kviScore: number;
    searchVolume: number;
    scenarioCode: string;
  };
}

/** 图谱边（用于可视化） */
interface GraphEdge {
  id: number;
  source: number;
  target: number;
  label: string;
  relationType: string;
  width: number;       // 基于关系强度的边宽
  color: string;       // 基于关系类型的颜色
  dashed: boolean;     // 互补关系用虚线
}

/** 节点中心度分析结果 */
interface CentralityAnalysis {
  keywordId: number;
  keyword: string;
  degreeCentrality: number;      // 连接数
  weightedDegree: number;        // 加权连接度
  betweennessCentrality: number; // 桥接中心度（近似）
  isHub: boolean;                // 是否为枢纽词
  isBridge: boolean;             // 是否为桥接词
}

/** 蓝海验证结果 */
interface BlueOceanVerification {
  keywordId: number;
  keyword: string;
  isBlueOcean: boolean;
  evidence: string;
  competitorCount: number;
  avgReviewCount: number;
  avgRating: number;
  topBrandDominance: number;
  opportunityScore: number;
}

/** 广告组映射建议 */
interface AdGroupMapping {
  clusterId: number;
  clusterLabel: string;
  suggestedAdGroupName: string;
  matchTypes: Array<{
    keyword: string;
    matchType: 'exact' | 'phrase' | 'broad';
    suggestedBid: number;
    rationale: string;
  }>;
  estimatedDailyBudget: number;
  estimatedImpressions: number;
}

// ============================================================
// 知识图谱构建器服务
// ============================================================

export class M1KnowledgeGraphService {

  // ==================== 图谱拓扑分析 ====================

  /**
   * 计算图谱拓扑指标
   * 
   * 识别三类关键节点：
   * - 枢纽词（Hub）：连接最多的词，通常是核心大词
   * - 桥接词（Bridge）：连接不同聚类的词，是跨场景投放的关键
   * - 孤立词（Isolate）：几乎没有连接的词，可能是蓝海或无效词
   */
  async analyzeTopology(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, data: null };

    try {
      const keywords = await db.select()
        .from(prelaunchKeywords)
        .where(eq(prelaunchKeywords.projectId, projectId));

      const relations = await db.select()
        .from(prelaunchKeywordRelations)
        .where(eq(prelaunchKeywordRelations.projectId, projectId));

      // 构建邻接表
      const adjacency = new Map<number, Array<{ targetId: number; strength: number; type: string }>>();
      for (const kw of keywords) {
        adjacency.set(kw.id, []);
      }
      for (const rel of relations) {
        const sourceAdj = adjacency.get(rel.sourceKeywordId) || [];
        sourceAdj.push({
          targetId: rel.targetKeywordId,
          strength: parseFloat(rel.strength || '0'),
          type: rel.relationType || 'related',
        });
        adjacency.set(rel.sourceKeywordId, sourceAdj);

        // 双向
        const targetAdj = adjacency.get(rel.targetKeywordId) || [];
        targetAdj.push({
          targetId: rel.sourceKeywordId,
          strength: parseFloat(rel.strength || '0'),
          type: rel.relationType || 'related',
        });
        adjacency.set(rel.targetKeywordId, targetAdj);
      }

      // 计算中心度
      const centralityResults: CentralityAnalysis[] = [];
      const avgDegree = relations.length * 2 / Math.max(1, keywords.length);

      for (const kw of keywords) {
        const neighbors = adjacency.get(kw.id) || [];
        const degreeCentrality = neighbors.length;
        const weightedDegree = neighbors.reduce((sum, n) => sum + n.strength, 0);

        // 近似桥接中心度：连接不同聚类的边数
        const neighborClusters = new Set(
          neighbors.map(n => {
            const targetKw = keywords.find(k => k.id === n.targetId);
            return targetKw?.clusterId;
          }).filter(Boolean)
        );
        const betweennessCentrality = neighborClusters.size / Math.max(1, degreeCentrality);

        centralityResults.push({
          keywordId: kw.id,
          keyword: kw.keyword,
          degreeCentrality,
          weightedDegree: Math.round(weightedDegree * 10000) / 10000,
          betweennessCentrality: Math.round(betweennessCentrality * 10000) / 10000,
          isHub: degreeCentrality > avgDegree * 2,
          isBridge: neighborClusters.size >= 3,
        });
      }

      // 排序
      centralityResults.sort((a, b) => b.weightedDegree - a.weightedDegree);

      const hubs = centralityResults.filter(c => c.isHub);
      const bridges = centralityResults.filter(c => c.isBridge);
      const isolates = centralityResults.filter(c => c.degreeCentrality === 0);

      return {
        success: true,
        data: {
          centrality: centralityResults.slice(0, 50),
          hubs: hubs.slice(0, 20),
          bridges: bridges.slice(0, 20),
          isolates: isolates.slice(0, 20),
          summary: {
            totalNodes: keywords.length,
            totalEdges: relations.length,
            avgDegree: Math.round(avgDegree * 100) / 100,
            hubCount: hubs.length,
            bridgeCount: bridges.length,
            isolateCount: isolates.length,
            density: keywords.length > 1
              ? Math.round((relations.length * 2) / (keywords.length * (keywords.length - 1)) * 10000) / 10000
              : 0,
          },
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message, data: null };
    }
  }

  // ==================== 蓝海验证 ====================

  /**
   * 蓝海验证（CT扫描）
   * 
   * 对高KVI但低竞争度的"机会词"进行深度验证：
   * - 搜索结果分析：前3页是否被大品牌垄断？
   * - 评论数分析：Top10产品的平均评论数是否过高？
   * - 评分分析：是否存在大量低评分产品（说明市场有改进空间）？
   * - 品牌集中度：是否被少数品牌垄断？
   */
  async verifyBlueOcean(projectId: number, keywordIds?: number[]) {
    const db = await getDb();
    if (!db) return { success: false, data: [] };

    try {
      // 获取候选蓝海词
      let candidates;
      if (keywordIds && keywordIds.length > 0) {
        candidates = await db.select()
          .from(prelaunchKeywords)
          .where(and(
            eq(prelaunchKeywords.projectId, projectId),
            inArray(prelaunchKeywords.id, keywordIds),
          ));
      } else {
        // 自动选择：高KVI + 低竞争度的词
        candidates = await db.select()
          .from(prelaunchKeywords)
          .where(and(
            eq(prelaunchKeywords.projectId, projectId),
            sql`${prelaunchKeywords.kviScore} > 0.5`,
            sql`${prelaunchKeywords.competitorDensity} < 300`,
          ))
          .orderBy(desc(prelaunchKeywords.kviScore))
          .limit(20);
      }

      if (candidates.length === 0) return { success: true, data: [] };

      // 获取竞品数据用于校准
      const competitors = await db.select()
        .from(prelaunchCompetitors)
        .where(eq(prelaunchCompetitors.projectId, projectId));

      const kwList = candidates.map((k: any) =>
        `${k.keyword} (vol: ${k.searchVolume}, density: ${k.competitorDensity}, kvi: ${k.kviScore})`
      ).join('\n');

      const prompt = `You are an Amazon market analyst. Perform a "Blue Ocean CT Scan" on these potential opportunity keywords.

For each keyword, evaluate:
1. Is this a TRUE blue ocean (real opportunity) or a FALSE blue ocean (trap)?
2. Why? Consider:
   - Would the search results be dominated by big brands with 10000+ reviews?
   - Is the low competition because there's no real demand?
   - Are there quality gaps in existing products that a new entrant could exploit?

Known competitors in this niche: ${competitors.map((c: any) => `${c.brand} (${c.asin})`).join(', ') || 'none specified'}

Keywords to verify:
${kwList}

Return JSON array:
[{
  "keyword": "...",
  "isBlueOcean": true/false,
  "evidence": "detailed explanation",
  "competitorCount": 150,
  "avgReviewCount": 500,
  "avgRating": 4.2,
  "topBrandDominance": 0.3,
  "opportunityScore": 0.75
}]`;

      const results = await geminiStructuredOutput<BlueOceanVerification[]>('', prompt, { temperature: 0.2 });

      // 更新数据库
      for (const result of results) {
        const kw = candidates.find((c: any) =>
          c.keyword.toLowerCase() === result.keyword?.toLowerCase()
        );
        if (kw) {
          await db.update(prelaunchKeywords)
            .set({
              blueOceanVerified: result.isBlueOcean ? 1 : 0,
              blueOceanEvidence: result.evidence,
            })
            .where(eq(prelaunchKeywords.id, kw.id));
        }
      }

      return { success: true, data: results };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  // ==================== 竞品校准 ====================

  /**
   * 竞品校准：用竞品数据调整DR×AM评分
   * 
   * 将M2竞品库的数据反馈到M1词库，校准关键词的真实商业价值。
   */
  async calibrateWithCompetitors(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      const keywords = await db.select()
        .from(prelaunchKeywords)
        .where(eq(prelaunchKeywords.projectId, projectId));

      const competitors = await db.select()
        .from(prelaunchCompetitors)
        .where(eq(prelaunchCompetitors.projectId, projectId));

      if (competitors.length === 0) {
        return { success: true, message: 'No competitors found, skipping calibration', calibrated: 0 };
      }

      const kwList = keywords.slice(0, 80).map((k: any) => k.keyword).join(', ');
      const compList = competitors.map((c: any) =>
        `${c.brand || 'Unknown'} (${c.asin}) - BSR:${c.bsr || 'N/A'}, Reviews:${c.reviewCount || 'N/A'}, Rating:${c.rating || 'N/A'}`
      ).join('\n');

      const prompt = `Given these Amazon competitors:
${compList}

And these keywords: ${kwList}

For each keyword, estimate a DR×AM (Demand-Relevance × Addressable-Market) score from 0.0-1.0 that reflects:
- How much real demand exists (based on competitor sales signals)
- How addressable the market is for a new entrant
- Whether the keyword aligns with gaps in competitor coverage

Return JSON array: [{"keyword":"...","drAmScore":0.75,"rationale":"brief explanation"}]`;

      const scores = await geminiStructuredOutput<any[]>('', prompt, { temperature: 0.2 });
      let calibrated = 0;

      for (const score of scores) {
        const kw = keywords.find((k: any) =>
          k.keyword.toLowerCase() === score.keyword?.toLowerCase()
        );
        if (kw) {
          await db.update(prelaunchKeywords)
            .set({ drAmScore: String(score.drAmScore || 0) })
            .where(eq(prelaunchKeywords.id, kw.id));
          calibrated++;
        }
      }

      return { success: true, calibrated, message: `Calibrated ${calibrated} keywords with competitor data` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ==================== 图谱导出（可视化格式） ====================

  /**
   * 导出图谱为D3.js / ECharts可视化格式
   * 
   * 节点颜色编码：
   * - core_traffic: #FF6B6B (红)
   * - core_conversion: #4ECDC4 (青)
   * - precision_longtail: #45B7D1 (蓝)
   * - broad_traffic: #96CEB4 (绿)
   * - low_value: #CCCCCC (灰)
   * 
   * 边类型编码：
   * - hypernym/hyponym: 实线箭头
   * - synonym: 双向实线
   * - alternative: 橙色虚线
   * - complementary: 紫色虚线
   * - related: 灰色细线
   */
  async exportForVisualization(projectId: number, format: 'echarts' | 'd3' = 'echarts') {
    const db = await getDb();
    if (!db) return { success: false, data: null };

    try {
      const keywords = await db.select()
        .from(prelaunchKeywords)
        .where(eq(prelaunchKeywords.projectId, projectId));

      const relations = await db.select()
        .from(prelaunchKeywordRelations)
        .where(eq(prelaunchKeywordRelations.projectId, projectId));

      const clusters = await db.select()
        .from(prelaunchKeywordClusters)
        .where(eq(prelaunchKeywordClusters.projectId, projectId));

      // 颜色映射
      const colorMap: Record<string, string> = {
        core_traffic: '#FF6B6B',
        core_conversion: '#4ECDC4',
        precision_longtail: '#45B7D1',
        broad_traffic: '#96CEB4',
        low_value: '#CCCCCC',
      };

      const relationColorMap: Record<string, string> = {
        hypernym: '#333333',
        hyponym: '#333333',
        synonym: '#2196F3',
        related: '#999999',
        alternative: '#FF9800',
        complementary: '#9C27B0',
      };

      // 构建节点
      const nodes: GraphNode[] = keywords.map((kw: any) => {
        const cluster = clusters.find((c: any) => c.id === kw.clusterId);
        return {
          id: kw.id,
          label: kw.keyword,
          group: cluster?.clusterLabel || 'Unclustered',
          size: Math.max(10, Math.min(60, (parseFloat(kw.kviScore || '0') * 50) + 10)),
          color: colorMap[kw.commercialValue || 'low_value'] || '#CCCCCC',
          metadata: {
            relevanceLayer: kw.relevanceLayer || 'extended',
            commercialValue: kw.commercialValue || 'unknown',
            userIntent: kw.userIntent || 'unknown',
            purchaseStage: kw.purchaseStage || 'unknown',
            kviScore: parseFloat(kw.kviScore || '0'),
            searchVolume: kw.searchVolume || 0,
            scenarioCode: kw.scenarioCode || 'S01',
          },
        };
      });

      // 构建边
      const edges: GraphEdge[] = relations.map((rel: any) => ({
        id: rel.id,
        source: rel.sourceKeywordId,
        target: rel.targetKeywordId,
        label: rel.relationType || 'related',
        relationType: rel.relationType || 'related',
        width: Math.max(1, Math.min(5, parseFloat(rel.strength || '0') * 5)),
        color: relationColorMap[rel.relationType || 'related'] || '#999999',
        dashed: rel.relationType === 'complementary' || rel.relationType === 'alternative',
      }));

      // 聚类分组
      const categories = clusters.map((c: any) => ({
        name: c.clusterLabel,
        memberCount: c.memberCount,
        avgKvi: c.avgKvi,
        dominantIntent: c.dominantIntent,
      }));

      if (format === 'echarts') {
        return {
          success: true,
          data: {
            format: 'echarts',
            graph: {
              nodes: nodes.map(n => ({
                id: String(n.id),
                name: n.label,
                symbolSize: n.size,
                category: categories.findIndex(c => c.name === n.group),
                itemStyle: { color: n.color },
                value: n.metadata.kviScore,
                ...n.metadata,
              })),
              links: edges.map(e => ({
                source: String(e.source),
                target: String(e.target),
                value: e.width,
                lineStyle: {
                  color: e.color,
                  width: e.width,
                  type: e.dashed ? 'dashed' : 'solid',
                },
                label: { show: false, formatter: e.label },
              })),
              categories: categories.map(c => ({ name: c.name })),
            },
            legend: {
              colorMap,
              relationColorMap,
            },
          },
        };
      }

      // D3.js格式
      return {
        success: true,
        data: {
          format: 'd3',
          nodes,
          links: edges.map(e => ({
            ...e,
            source: e.source,
            target: e.target,
            value: e.width,
          })),
          groups: categories,
          legend: { colorMap, relationColorMap },
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message, data: null };
    }
  }

  // ==================== 广告组映射建议 ====================

  /**
   * 基于知识图谱生成广告组映射建议
   * 
   * 将意图簇转化为具体的广告组结构：
   * - 每个意图簇 → 一个广告组
   * - 簇内关键词 → 广告组的投放词
   * - 根据商业价值和购买阶段推荐匹配类型
   */
  async generateAdGroupMappings(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, data: [] };

    try {
      const clusters = await db.select()
        .from(prelaunchKeywordClusters)
        .where(eq(prelaunchKeywordClusters.projectId, projectId));

      const keywords = await db.select()
        .from(prelaunchKeywords)
        .where(eq(prelaunchKeywords.projectId, projectId));

      const mappings: AdGroupMapping[] = [];

      for (const cluster of clusters) {
        const clusterKws = keywords.filter((k: any) => k.clusterId === cluster.id);
        if (clusterKws.length === 0) continue;

        const matchTypes = clusterKws.map((kw: any) => {
          // 匹配类型推荐逻辑
          let matchType: 'exact' | 'phrase' | 'broad' = 'phrase';
          let suggestedBid = parseFloat(kw.ppcBidEstimate || '0.75');

          if (kw.commercialValue === 'core_conversion' || kw.userIntent === 'transactional') {
            matchType = 'exact';
            suggestedBid *= 1.3; // 高转化词加价30%
          } else if (kw.commercialValue === 'core_traffic') {
            matchType = 'phrase';
          } else if (kw.commercialValue === 'precision_longtail') {
            matchType = 'exact';
            suggestedBid *= 0.8; // 长尾词降价20%
          } else if (kw.commercialValue === 'broad_traffic') {
            matchType = 'broad';
            suggestedBid *= 0.6;
          }

          return {
            keyword: kw.keyword,
            matchType,
            suggestedBid: Math.round(suggestedBid * 100) / 100,
            rationale: `${kw.commercialValue}/${kw.userIntent}/${kw.purchaseStage}`,
          };
        });

        const totalVolume = clusterKws.reduce((sum: number, k: any) => sum + (k.searchVolume || 0), 0);
        const estimatedImpressions = Math.round(totalVolume * 0.1); // 假设10%展示份额
        const avgBid = matchTypes.reduce((sum, m) => sum + m.suggestedBid, 0) / matchTypes.length;
        const estimatedDailyBudget = Math.round(avgBid * estimatedImpressions / 30 * 0.05 * 100) / 100;

        mappings.push({
          clusterId: cluster.id,
          clusterLabel: cluster.clusterLabel,
          suggestedAdGroupName: cluster.adGroupMapping || `AG-${cluster.clusterLabel.replace(/\s+/g, '-')}`,
          matchTypes,
          estimatedDailyBudget: Math.max(5, Math.min(100, estimatedDailyBudget)),
          estimatedImpressions,
        });
      }

      return { success: true, data: mappings };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  // ==================== 增量更新 ====================

  /**
   * 增量添加关键词并融合到现有图谱
   * 
   * 新增关键词会：
   * 1. 自动进行四维画像
   * 2. 自动分配到最合适的现有聚类
   * 3. 自动与现有关键词建立关系
   */
  async addKeywordsIncremental(projectId: number, newKeywords: string[]) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      // 获取现有关键词
      const existingKws = await db.select()
        .from(prelaunchKeywords)
        .where(eq(prelaunchKeywords.projectId, projectId));

      const existingClusters = await db.select()
        .from(prelaunchKeywordClusters)
        .where(eq(prelaunchKeywordClusters.projectId, projectId));

      // 过滤已存在的关键词
      const existingSet = new Set(existingKws.map((k: any) => k.keyword.toLowerCase()));
      const trulyNew = newKeywords.filter(kw => !existingSet.has(kw.toLowerCase()));

      if (trulyNew.length === 0) {
        return { success: true, message: 'All keywords already exist', added: 0 };
      }

      // 获取种子词用于分类
      const project = await db.select()
        .from(prelaunchKeywords)
        .where(and(
          eq(prelaunchKeywords.projectId, projectId),
          eq(prelaunchKeywords.relevanceLayer, 'core' as any),
        ))
        .limit(5);
      const seedKws = project.map((p: any) => p.keyword);

      // 四维画像
      const prompt = `Analyze these NEW Amazon keywords relative to the product defined by existing core keywords: [${seedKws.join(', ')}]

For each keyword, provide the complete 4D profile:
- keyword, searchVolume (estimated), competitorDensity (estimated), avgPrice (estimated)
- relevanceLayer: "core"/"extended"/"long_tail"/"irrelevant"
- dimensionType, scenarioCode (S01-S12), intentTag
- commercialValue: "core_traffic"/"core_conversion"/"precision_longtail"/"broad_traffic"/"low_value"
- commercialScore (0-1), clickConcentration (0-1), ppcBidEstimate (USD), purchaseRate (0-1)
- userIntent: "informational"/"navigational"/"commercial_investigation"/"transactional"
- intentConfidence (0-1)
- purchaseStage: "awareness"/"interest"/"consideration"/"purchase"/"loyalty"
- purchaseStageConfidence (0-1)
- productAttributes: {function:[], scenario:[], material:[], audience:[]}
- bestCluster: which existing cluster does this keyword best fit? (use cluster label)

Existing clusters: ${existingClusters.map((c: any) => `"${c.clusterLabel}": ${c.intentSummary}`).join('; ')}

New keywords: ${trulyNew.join(', ')}

Return JSON array with all fields.`;

      const profiles = await geminiStructuredOutput<any[]>('', prompt, { temperature: 0.15 });

      // 插入新关键词
      let addedCount = 0;
      for (const profile of profiles) {
        // 找到最佳聚类
        const bestCluster = existingClusters.find((c: any) =>
          c.clusterLabel.toLowerCase() === (profile.bestCluster || '').toLowerCase()
        );

        const [result] = await db.insert(prelaunchKeywords).values({
          projectId,
          keyword: profile.keyword,
          searchVolume: profile.searchVolume || 0,
          competitorDensity: profile.competitorDensity || 0,
          avgPrice: String(profile.avgPrice || 0),
          relevanceLayer: (profile.relevanceLayer || 'extended') as any,
          dimensionType: profile.dimensionType || 'product_attribute',
          scenarioCode: profile.scenarioCode || 'S01',
          intentTag: profile.intentTag || 'commercial',
          kviScore: '0',
          kviVolume: '0',
          kviRelevance: '0',
          kviOpportunity: '0',
          dataSource: 'incremental_add',
          commercialValue: (profile.commercialValue || 'broad_traffic') as any,
          commercialScore: String(profile.commercialScore || 0),
          clickConcentration: String(profile.clickConcentration || 0),
          ppcBidEstimate: String(profile.ppcBidEstimate || 0),
          purchaseRate: String(profile.purchaseRate || 0),
          userIntent: (profile.userIntent || 'commercial_investigation') as any,
          intentConfidence: String(profile.intentConfidence || 0),
          purchaseStage: (profile.purchaseStage || 'consideration') as any,
          purchaseStageConfidence: String(profile.purchaseStageConfidence || 0),
          productAttributes: profile.productAttributes || {},
          clusterId: bestCluster?.id || null,
        });

        const newId = (result as any).insertId;

        // 与现有关键词建立关系
        const relatedExisting = existingKws
          .filter((k: any) => k.clusterId === bestCluster?.id)
          .slice(0, 5);

        for (const existing of relatedExisting) {
          await db.insert(prelaunchKeywordRelations).values({
            projectId,
            sourceKeywordId: newId,
            targetKeywordId: existing.id,
            sourceKeyword: profile.keyword,
            targetKeyword: existing.keyword,
            relationType: 'related' as any,
            strength: '0.5',
            evidence: 'Auto-linked via incremental cluster assignment',
            detectionMethod: 'cluster_proximity',
          });
        }

        addedCount++;
      }

      // 更新聚类成员数
      for (const cluster of existingClusters) {
        const [countResult] = await db.select({ count: sql<number>`COUNT(*)` })
          .from(prelaunchKeywords)
          .where(and(
            eq(prelaunchKeywords.projectId, projectId),
            eq(prelaunchKeywords.clusterId, cluster.id),
          ));
        await db.update(prelaunchKeywordClusters)
          .set({ memberCount: countResult?.count || 0 })
          .where(eq(prelaunchKeywordClusters.id, cluster.id));
      }

      return {
        success: true,
        added: addedCount,
        message: `Added ${addedCount} new keywords and linked to existing graph`,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}
