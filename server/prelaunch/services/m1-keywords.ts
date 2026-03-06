/**
 * M1 搜索词库引擎服务 — v4.0 关系型词库 / 知识图谱版
 * 
 * 核心理念：从"二维列表"到"三维星系图"
 * 每个关键词不再是孤立的行，而是一颗拥有四维画像和多维关系的星球。
 * 
 * 完整流水线（7步）：
 *   Step 1: 种子词扩展 — 使用Gemini从种子词扩展出80-150个候选词
 *   Step 2: 四维画像构建 — 为每个词建立4D档案（商业价值/用户意图/购买阶段/产品属性）
 *   Step 3: KVI评分 — 计算关键词商业价值指数
 *   Step 4: 语义聚类 — 将词汇聚合成"意图簇"（未来广告组的雏形）
 *   Step 5: 关系建模 — 识别词间的六种语义关系（上位/下位/同义/相关/替代/互补）
 *   Step 6: 场景绑定 — 连接"词"与"人"，为意图簇打上场景标签
 *   Step 7: COSMO因果链 — 从竞品差评中提炼痛点→解决方案→价值的因果链
 * 
 * 参考文档：《从词库到知识图谱：人工搭建"关系型词库"的实操指南》
 */
import { getDb } from '../../db';
import {
  prelaunchKeywords, prelaunchKeywordClusters,
  prelaunchKeywordRelations, prelaunchCosmoTriples,
  prelaunchKeywordSceneWeights, prelaunchGraphSnapshots,
  prelaunchProjects,
} from '../../../drizzle/schema';
import { eq, desc, and, sql, inArray } from 'drizzle-orm';
import { geminiChat, geminiStructuredOutput } from '../gemini';

// ============================================================
// 类型定义
// ============================================================

/** 四维画像结构 */
interface FourDProfile {
  // 第一维：商业价值
  commercialValue: 'core_traffic' | 'core_conversion' | 'precision_longtail' | 'broad_traffic' | 'low_value';
  commercialScore: number;
  clickConcentration: number;
  ppcBidEstimate: number;
  purchaseRate: number;
  // 第二维：用户意图
  userIntent: 'informational' | 'navigational' | 'commercial_investigation' | 'transactional';
  intentConfidence: number;
  // 第三维：购买阶段
  purchaseStage: 'awareness' | 'interest' | 'consideration' | 'purchase' | 'loyalty';
  purchaseStageConfidence: number;
  // 第四维：产品属性标签
  productAttributes: Record<string, string[]>;
}

/** 关系类型枚举 */
type RelationType = 'hypernym' | 'hyponym' | 'synonym' | 'related' | 'alternative' | 'complementary';

/** 关系建模结果 */
interface KeywordRelation {
  sourceKeyword: string;
  targetKeyword: string;
  relationType: RelationType;
  strength: number;
  evidence: string;
  detectionMethod: string;
}

/** 场景权重 */
interface SceneWeight {
  scenarioCode: string;
  scenarioLabel: string;
  weight: number;
  confidence: number;
}

/** 图谱统计 */
interface GraphMetrics {
  nodeCount: number;
  edgeCount: number;
  clusterCount: number;
  cosmoTripleCount: number;
  avgClusterSize: number;
  avgRelationStrength: number;
  commercialValueDistribution: Record<string, number>;
  intentDistribution: Record<string, number>;
  purchaseStageDistribution: Record<string, number>;
  topScenarios: Array<{ code: string; label: string; keywordCount: number }>;
  relationTypeDistribution: Record<string, number>;
}

// ============================================================
// M1 关键词知识图谱服务
// ============================================================

export class M1KeywordService {

  // ==================== 查询接口 ====================

  /** 获取关键词列表（支持多维筛选） */
  async getKeywords(input: {
    projectId: number;
    relevanceLayer?: string;
    scenarioCode?: string;
    clusterId?: number;
    commercialValue?: string;
    userIntent?: string;
    purchaseStage?: string;
    sortBy?: string;
    page?: number;
    pageSize?: number;
  }) {
    const db = await getDb();
    if (!db) return { success: false, data: [], total: 0 };

    try {
      const conditions = [eq(prelaunchKeywords.projectId, input.projectId)];
      if (input.relevanceLayer) conditions.push(eq(prelaunchKeywords.relevanceLayer, input.relevanceLayer as any));
      if (input.scenarioCode) conditions.push(eq(prelaunchKeywords.scenarioCode, input.scenarioCode));
      if (input.clusterId) conditions.push(eq(prelaunchKeywords.clusterId, input.clusterId));
      if (input.commercialValue) conditions.push(eq(prelaunchKeywords.commercialValue, input.commercialValue as any));
      if (input.userIntent) conditions.push(eq(prelaunchKeywords.userIntent, input.userIntent as any));
      if (input.purchaseStage) conditions.push(eq(prelaunchKeywords.purchaseStage, input.purchaseStage as any));

      const page = input.page ?? 1;
      const pageSize = input.pageSize ?? 50;

      // 动态排序
      const orderField = input.sortBy === 'searchVolume' ? prelaunchKeywords.searchVolume
        : input.sortBy === 'drAmScore' ? prelaunchKeywords.drAmScore
        : input.sortBy === 'commercialScore' ? prelaunchKeywords.commercialScore
        : prelaunchKeywords.kviScore;

      const data = await db.select()
        .from(prelaunchKeywords)
        .where(and(...conditions))
        .orderBy(desc(orderField))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [countResult] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(prelaunchKeywords)
        .where(and(...conditions));

      return { success: true, data, total: countResult?.count ?? 0, page, pageSize };
    } catch (error: any) {
      return { success: false, error: error.message, data: [], total: 0 };
    }
  }

  /** 获取聚类列表 */
  async getClusters(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, data: [] };

    try {
      const data = await db.select()
        .from(prelaunchKeywordClusters)
        .where(eq(prelaunchKeywordClusters.projectId, projectId))
        .orderBy(desc(prelaunchKeywordClusters.avgKvi));
      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  /** 获取关系网络 */
  async getRelations(projectId: number, relationType?: string) {
    const db = await getDb();
    if (!db) return { success: false, data: [] };

    try {
      const conditions = [eq(prelaunchKeywordRelations.projectId, projectId)];
      if (relationType) {
        conditions.push(eq(prelaunchKeywordRelations.relationType, relationType as any));
      }

      const data = await db.select()
        .from(prelaunchKeywordRelations)
        .where(and(...conditions))
        .orderBy(desc(prelaunchKeywordRelations.strength));
      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  /** 获取COSMO因果链三元组 */
  async getCosmoTriples(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, data: [] };

    try {
      const data = await db.select()
        .from(prelaunchCosmoTriples)
        .where(eq(prelaunchCosmoTriples.projectId, projectId))
        .orderBy(desc(prelaunchCosmoTriples.confidence));
      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  /** 获取场景权重分布 */
  async getSceneWeights(projectId: number, keywordId?: number) {
    const db = await getDb();
    if (!db) return { success: false, data: [] };

    try {
      const conditions = [eq(prelaunchKeywordSceneWeights.projectId, projectId)];
      if (keywordId) {
        conditions.push(eq(prelaunchKeywordSceneWeights.keywordId, keywordId));
      }

      const data = await db.select()
        .from(prelaunchKeywordSceneWeights)
        .where(and(...conditions))
        .orderBy(desc(prelaunchKeywordSceneWeights.weight));
      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  /** 获取知识图谱完整数据（用于前端可视化） */
  async getKnowledgeGraph(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, data: null };

    try {
      // 获取所有关键词节点
      const keywords = await db.select()
        .from(prelaunchKeywords)
        .where(eq(prelaunchKeywords.projectId, projectId));

      // 获取所有关系边
      const relations = await db.select()
        .from(prelaunchKeywordRelations)
        .where(eq(prelaunchKeywordRelations.projectId, projectId));

      // 获取所有聚类
      const clusters = await db.select()
        .from(prelaunchKeywordClusters)
        .where(eq(prelaunchKeywordClusters.projectId, projectId));

      // 获取COSMO三元组
      const cosmoTriples = await db.select()
        .from(prelaunchCosmoTriples)
        .where(eq(prelaunchCosmoTriples.projectId, projectId));

      // 获取场景权重
      const sceneWeights = await db.select()
        .from(prelaunchKeywordSceneWeights)
        .where(eq(prelaunchKeywordSceneWeights.projectId, projectId));

      // 构建图谱节点
      const nodes = keywords.map((kw: any) => ({
        id: kw.id,
        label: kw.keyword,
        type: 'keyword',
        relevanceLayer: kw.relevanceLayer,
        commercialValue: kw.commercialValue,
        userIntent: kw.userIntent,
        purchaseStage: kw.purchaseStage,
        kviScore: kw.kviScore,
        commercialScore: kw.commercialScore,
        searchVolume: kw.searchVolume,
        clusterId: kw.clusterId,
        scenarioCode: kw.scenarioCode,
        productAttributes: kw.productAttributes,
        sceneDistribution: kw.sceneDistribution,
      }));

      // 构建图谱边
      const edges = relations.map((rel: any) => ({
        id: rel.id,
        source: rel.sourceKeywordId,
        target: rel.targetKeywordId,
        sourceLabel: rel.sourceKeyword,
        targetLabel: rel.targetKeyword,
        relationType: rel.relationType,
        strength: rel.strength,
        evidence: rel.evidence,
      }));

      // 构建聚类组
      const clusterGroups = clusters.map((c: any) => ({
        id: c.id,
        label: c.clusterLabel,
        intentSummary: c.intentSummary,
        memberCount: c.memberCount,
        avgKvi: c.avgKvi,
        scenarioTags: c.scenarioTags,
        dominantIntent: c.dominantIntent,
        dominantPurchaseStage: c.dominantPurchaseStage,
        adGroupMapping: c.adGroupMapping,
      }));

      // 计算图谱统计
      const metrics = this.calculateGraphMetrics(keywords, relations, clusters, cosmoTriples);

      return {
        success: true,
        data: {
          nodes,
          edges,
          clusters: clusterGroups,
          cosmoTriples,
          sceneWeights,
          metrics,
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message, data: null };
    }
  }

  /** 获取图谱快照历史 */
  async getGraphSnapshots(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, data: [] };

    try {
      const data = await db.select()
        .from(prelaunchGraphSnapshots)
        .where(eq(prelaunchGraphSnapshots.projectId, projectId))
        .orderBy(desc(prelaunchGraphSnapshots.version));
      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  // ==================== 核心流水线 ====================

  /**
   * 运行M1完整知识图谱构建流水线
   * 
   * 流程：种子词扩展 → 四维画像 → KVI评分 → 语义聚类 → 关系建模 → 场景绑定 → COSMO因果链
   */
  async runPipeline(projectId: number, seedKeywords: string[], marketplace: string) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    const pipelineLog: Array<{ step: string; status: string; count: number; duration: number }> = [];

    try {
      // 创建图谱快照记录
      const [snapshotResult] = await db.insert(prelaunchGraphSnapshots).values({
        projectId,
        status: 'building' as any,
      });
      const snapshotId = (snapshotResult as any).insertId;

      // ============ Step 1: 种子词扩展 ============
      const t1 = Date.now();
      const expandedKeywords = await this.expandKeywords(seedKeywords, marketplace);
      pipelineLog.push({
        step: 'seed_expansion', status: 'done',
        count: expandedKeywords.length, duration: Date.now() - t1,
      });

      // ============ Step 2: 四维画像构建 ============
      const t2 = Date.now();
      const profiledKeywords = await this.buildFourDProfiles(expandedKeywords, seedKeywords, marketplace);
      pipelineLog.push({
        step: 'four_d_profiling', status: 'done',
        count: profiledKeywords.length, duration: Date.now() - t2,
      });

      // ============ Step 3: KVI评分计算 ============
      const t3 = Date.now();
      const scoredKeywords = profiledKeywords.map(kw => ({
        ...kw,
        kviScore: this.calculateKVI(kw),
        kviVolume: this.calculateKVIComponent(kw, 'volume'),
        kviRelevance: this.calculateKVIComponent(kw, 'relevance'),
        kviOpportunity: this.calculateKVIComponent(kw, 'opportunity'),
      }));
      pipelineLog.push({
        step: 'kvi_scoring', status: 'done',
        count: scoredKeywords.length, duration: Date.now() - t3,
      });

      // ============ Step 4: 批量写入数据库 ============
      const t4 = Date.now();
      const insertedIds = await this.batchInsertKeywords(db, projectId, scoredKeywords);
      pipelineLog.push({
        step: 'db_insert', status: 'done',
        count: insertedIds.length, duration: Date.now() - t4,
      });

      // 构建keyword→id映射
      const keywordIdMap = new Map<string, number>();
      const allKws = await db.select({ id: prelaunchKeywords.id, keyword: prelaunchKeywords.keyword })
        .from(prelaunchKeywords)
        .where(eq(prelaunchKeywords.projectId, projectId));
      for (const kw of allKws) {
        keywordIdMap.set(kw.keyword, kw.id);
      }

      // ============ Step 5: 语义聚类 ============
      const t5 = Date.now();
      const clusterCount = await this.runSemanticClustering(db, projectId, scoredKeywords, keywordIdMap);
      pipelineLog.push({
        step: 'semantic_clustering', status: 'done',
        count: clusterCount, duration: Date.now() - t5,
      });

      // ============ Step 6: 关系建模 ============
      const t6 = Date.now();
      const relationCount = await this.buildRelationNetwork(db, projectId, scoredKeywords, keywordIdMap);
      pipelineLog.push({
        step: 'relation_modeling', status: 'done',
        count: relationCount, duration: Date.now() - t6,
      });

      // ============ Step 7: 场景绑定 ============
      const t7 = Date.now();
      const sceneCount = await this.bindScenarios(db, projectId, scoredKeywords, keywordIdMap);
      pipelineLog.push({
        step: 'scene_binding', status: 'done',
        count: sceneCount, duration: Date.now() - t7,
      });

      // ============ Step 8: COSMO因果链 ============
      const t8 = Date.now();
      const tripleCount = await this.generateCosmoTriples(db, projectId, scoredKeywords);
      pipelineLog.push({
        step: 'cosmo_triples', status: 'done',
        count: tripleCount, duration: Date.now() - t8,
      });

      // 更新图谱快照
      const finalKeywords = await db.select()
        .from(prelaunchKeywords)
        .where(eq(prelaunchKeywords.projectId, projectId));
      const finalRelations = await db.select()
        .from(prelaunchKeywordRelations)
        .where(eq(prelaunchKeywordRelations.projectId, projectId));
      const finalClusters = await db.select()
        .from(prelaunchKeywordClusters)
        .where(eq(prelaunchKeywordClusters.projectId, projectId));
      const finalTriples = await db.select()
        .from(prelaunchCosmoTriples)
        .where(eq(prelaunchCosmoTriples.projectId, projectId));

      const metrics = this.calculateGraphMetrics(finalKeywords, finalRelations, finalClusters, finalTriples);

      await db.update(prelaunchGraphSnapshots)
        .set({
          totalNodes: finalKeywords.length,
          totalEdges: finalRelations.length,
          totalClusters: finalClusters.length,
          totalCosmoTriples: finalTriples.length,
          graphMetrics: metrics,
          pipelineLog,
          status: 'completed' as any,
        })
        .where(eq(prelaunchGraphSnapshots.id, snapshotId));

      // 更新项目状态
      await db.update(prelaunchProjects)
        .set({ status: 'running' })
        .where(eq(prelaunchProjects.id, projectId));

      return {
        success: true,
        snapshotId,
        summary: {
          totalKeywords: finalKeywords.length,
          totalRelations: finalRelations.length,
          totalClusters: finalClusters.length,
          totalCosmoTriples: finalTriples.length,
          commercialValueDistribution: metrics.commercialValueDistribution,
          intentDistribution: metrics.intentDistribution,
          purchaseStageDistribution: metrics.purchaseStageDistribution,
          relationTypeDistribution: metrics.relationTypeDistribution,
        },
        pipelineLog,
      };
    } catch (error: any) {
      pipelineLog.push({ step: 'error', status: 'failed', count: 0, duration: 0 });
      return { success: false, error: error.message, pipelineLog };
    }
  }

  // ==================== Step 1: 种子词扩展 ====================

  /** 使用Gemini从种子词扩展出全面的候选词列表 */
  private async expandKeywords(seedKeywords: string[], marketplace: string): Promise<any[]> {
    const prompt = `You are an Amazon keyword research expert specializing in the ${marketplace} marketplace.

Given these seed keywords: ${seedKeywords.join(', ')}

Generate a comprehensive keyword list of 80-150 keywords covering ALL of these categories:
1. Core product keywords (direct product descriptions)
2. Long-tail variations (3-5 word specific queries)
3. Problem/pain-point keywords (what problems does the product solve?)
4. Benefit keywords (what benefits does the product provide?)
5. Comparison keywords (vs, alternative, compare)
6. Use-case/scenario keywords (for travel, for office, for kids, etc.)
7. Demographic keywords (for women, for seniors, for athletes, etc.)
8. Material/feature keywords (specific materials, features, specs)
9. Seasonal keywords (summer, winter, holiday, back-to-school)
10. Brand-adjacent keywords (competitor brand + category)

For each keyword, provide:
- keyword: the search term (string)
- searchVolume: estimated monthly search volume (integer, 100-500000)
- competitorDensity: number of competing products (integer, 1-999)
- avgPrice: average product price in USD (number)

Return as JSON array: [{"keyword":"...","searchVolume":...,"competitorDensity":...,"avgPrice":...}]`;

    return geminiStructuredOutput<any[]>('', prompt, { temperature: 0.4 });
  }

  // ==================== Step 2: 四维画像构建 ====================

  /**
   * 为每个关键词构建四维画像（4D Profile）
   * 
   * 维度1 - 商业价值：搜索量 × 点击集中度 × PPC竞价 × 购买率 → 商业价值分
   * 维度2 - 用户意图：信息型 / 导航型 / 商业调查型 / 交易型
   * 维度3 - 购买阶段：认知 → 兴趣 → 考虑 → 购买 → 忠诚
   * 维度4 - 产品属性：功能、场景、材质、颜色、尺寸、兼容性、人群标签
   */
  private async buildFourDProfiles(keywords: any[], seedKeywords: string[], marketplace: string): Promise<any[]> {
    const batchSize = 25;
    const results: any[] = [];

    for (let i = 0; i < keywords.length; i += batchSize) {
      const batch = keywords.slice(i, i + batchSize);

      const prompt = `You are an Amazon keyword analyst. Analyze these keywords relative to the product defined by seeds: [${seedKeywords.join(', ')}] in the ${marketplace} marketplace.

For EACH keyword, build a complete 4D profile:

**Dimension 1 - Commercial Value:**
- commercialValue: classify as one of:
  * "core_traffic" — high search volume, high relevance (e.g., "memory foam pillow")
  * "core_conversion" — moderate volume but very high purchase intent (e.g., "buy cervical pillow for neck pain")
  * "precision_longtail" — low volume but extremely precise match (e.g., "contour memory foam pillow for side sleepers with neck pain")
  * "broad_traffic" — high volume but lower relevance (e.g., "pillow")
  * "low_value" — low volume AND low relevance
- commercialScore: 0.0-1.0 weighted score
- clickConcentration: 0.0-1.0 (how concentrated are clicks on top 3 results?)
- ppcBidEstimate: estimated PPC bid in USD
- purchaseRate: 0.0-1.0 (likelihood of purchase after search)

**Dimension 2 - User Intent:**
- userIntent: "informational" (how to/what is), "navigational" (brand search), "commercial_investigation" (best/top/vs), "transactional" (buy/price/deal)
- intentConfidence: 0.0-1.0

**Dimension 3 - Purchase Stage:**
- purchaseStage: "awareness" (generic category), "interest" (specific type), "consideration" (comparing options), "purchase" (ready to buy), "loyalty" (brand-specific repurchase)
- purchaseStageConfidence: 0.0-1.0

**Dimension 4 - Product Attributes:**
- productAttributes: object with arrays of tags, e.g.:
  {"function":["support","cooling"],"scenario":["sleep","travel"],"material":["memory_foam"],"audience":["side_sleepers"]}

**Also classify:**
- relevanceLayer: "core", "extended", "long_tail", "irrelevant"
- dimensionType: "product_attribute", "audience", "scenario", "brand", "pain_point", "benefit", "comparison", "seasonal"
- scenarioCode: S01-S12 (S01=daily_use, S02=first_purchase, S03=replacement, S04=gift, S05=bulk_buy, S06=premium, S07=budget, S08=comparison, S09=problem_solving, S10=seasonal, S11=trending, S12=niche)
- intentTag: "informational", "navigational", "commercial", "transactional"

Keywords to analyze:
${batch.map((k: any) => `- ${k.keyword} (vol: ${k.searchVolume}, density: ${k.competitorDensity})`).join('\n')}

Return JSON array with ALL fields for each keyword.`;

      const classified = await geminiStructuredOutput<any[]>('', prompt, { temperature: 0.1 });

      for (const cls of classified) {
        const original = batch.find((k: any) =>
          k.keyword.toLowerCase() === (cls.keyword || '').toLowerCase()
        );
        if (original) {
          results.push({ ...original, ...cls });
        }
      }
    }

    return results;
  }

  // ==================== Step 3: KVI评分 ====================

  /** 计算关键词商业价值指数（KVI） */
  private calculateKVI(kw: any): number {
    const volumeScore = Math.min(1, Math.log10(Math.max(1, kw.searchVolume || 1)) / 5);
    const relevanceScore = kw.relevanceLayer === 'core' ? 1.0
      : kw.relevanceLayer === 'extended' ? 0.7
      : kw.relevanceLayer === 'long_tail' ? 0.4
      : 0.1;
    const opportunityScore = kw.competitorDensity
      ? Math.max(0, 1 - (kw.competitorDensity / 1000))
      : 0.5;
    const commercialBoost = (kw.commercialScore || 0.5) * 0.15;
    const intentBoost = kw.userIntent === 'transactional' ? 0.1
      : kw.userIntent === 'commercial_investigation' ? 0.05
      : 0;

    const kvi = (volumeScore * 0.30 + relevanceScore * 0.30 + opportunityScore * 0.15 + commercialBoost + intentBoost);
    return Math.round(Math.min(1, kvi) * 10000) / 10000;
  }

  /** 计算KVI子分数 */
  private calculateKVIComponent(kw: any, component: 'volume' | 'relevance' | 'opportunity'): number {
    switch (component) {
      case 'volume':
        return Math.round(Math.min(1, Math.log10(Math.max(1, kw.searchVolume || 1)) / 5) * 10000) / 10000;
      case 'relevance': {
        const score = kw.relevanceLayer === 'core' ? 1.0
          : kw.relevanceLayer === 'extended' ? 0.7
          : kw.relevanceLayer === 'long_tail' ? 0.4 : 0.1;
        return score;
      }
      case 'opportunity':
        return kw.competitorDensity
          ? Math.round(Math.max(0, 1 - (kw.competitorDensity / 1000)) * 10000) / 10000
          : 0.5;
    }
  }

  // ==================== Step 4: 批量写入 ====================

  /** 批量插入关键词到数据库 */
  private async batchInsertKeywords(db: any, projectId: number, keywords: any[]): Promise<number[]> {
    const ids: number[] = [];
    const batchSize = 50;

    for (let i = 0; i < keywords.length; i += batchSize) {
      const batch = keywords.slice(i, i + batchSize);
      const insertData = batch.map(kw => ({
        projectId,
        keyword: kw.keyword,
        searchVolume: kw.searchVolume || 0,
        searchVolumeGrowth: '0',
        competitorDensity: kw.competitorDensity || 0,
        avgPrice: String(kw.avgPrice || 0),
        relevanceLayer: (kw.relevanceLayer || 'extended') as any,
        dimensionType: kw.dimensionType || 'product_attribute',
        scenarioCode: kw.scenarioCode || 'S01',
        intentTag: kw.intentTag || 'commercial',
        kviScore: String(kw.kviScore || 0),
        kviVolume: String(kw.kviVolume || 0),
        kviRelevance: String(kw.kviRelevance || 0),
        kviOpportunity: String(kw.kviOpportunity || 0),
        dataSource: 'gemini_graph_pipeline',
        // 四维画像
        commercialValue: (kw.commercialValue || 'broad_traffic') as any,
        commercialScore: String(kw.commercialScore || 0),
        clickConcentration: String(kw.clickConcentration || 0),
        ppcBidEstimate: String(kw.ppcBidEstimate || 0),
        purchaseRate: String(kw.purchaseRate || 0),
        userIntent: (kw.userIntent || 'commercial_investigation') as any,
        intentConfidence: String(kw.intentConfidence || 0),
        purchaseStage: (kw.purchaseStage || 'consideration') as any,
        purchaseStageConfidence: String(kw.purchaseStageConfidence || 0),
        productAttributes: kw.productAttributes || {},
      }));

      const [result] = await db.insert(prelaunchKeywords).values(insertData);
      const firstId = (result as any).insertId;
      for (let j = 0; j < batch.length; j++) {
        ids.push(firstId + j);
      }
    }

    return ids;
  }

  // ==================== Step 5: 语义聚类 ====================

  /**
   * 语义聚类：将词汇聚合成"意图簇"
   * 
   * 这些意图簇就是未来广告组的雏形。
   * 每个簇内的关键词表达相似的底层购买需求。
   */
  private async runSemanticClustering(
    db: any,
    projectId: number,
    keywords: any[],
    keywordIdMap: Map<string, number>
  ): Promise<number> {
    if (keywords.length === 0) return 0;

    const kwSummary = keywords.map(k =>
      `${k.keyword} [${k.relevanceLayer}|${k.userIntent}|${k.purchaseStage}|vol:${k.searchVolume}]`
    ).join('\n');

    const prompt = `You are an Amazon advertising strategist. Group these keywords into semantic intent clusters.

IMPORTANT RULES:
- Each cluster represents a DISTINCT user search intent or product need
- Clusters will become ad groups, so they must be actionable
- Create 5-15 clusters based on the keyword count
- Every keyword MUST belong to exactly ONE cluster
- For each cluster, identify the dominant purchase stage and user intent

Keywords (with metadata):
${kwSummary}

Return JSON array:
[{
  "clusterLabel": "descriptive label for the cluster",
  "intentSummary": "what users in this cluster are looking for",
  "members": ["keyword1", "keyword2", ...],
  "dominantIntent": "informational|navigational|commercial_investigation|transactional",
  "dominantPurchaseStage": "awareness|interest|consideration|purchase|loyalty",
  "scenarioTags": ["S01", "S09"],
  "suggestedAdGroupName": "SP-Manual-ClusterName"
}]`;

    const clusters = await geminiStructuredOutput<any[]>('', prompt, { temperature: 0.2 });

    for (const cluster of clusters) {
      const memberKws = (cluster.members || []).map((m: string) => {
        const found = keywords.find(k => k.keyword.toLowerCase() === m.toLowerCase());
        return found;
      }).filter(Boolean);

      const avgKvi = memberKws.length > 0
        ? memberKws.reduce((sum: number, k: any) => sum + (k.kviScore || 0), 0) / memberKws.length
        : 0;

      const topScenario = cluster.scenarioTags?.[0] || 'S01';

      const [result] = await db.insert(prelaunchKeywordClusters).values({
        projectId,
        clusterLabel: cluster.clusterLabel,
        intentSummary: cluster.intentSummary,
        memberCount: cluster.members?.length || 0,
        avgKvi: String(Math.round(avgKvi * 10000) / 10000),
        topScenario,
        scenarioTags: cluster.scenarioTags || [],
        dominantIntent: cluster.dominantIntent || 'commercial_investigation',
        dominantPurchaseStage: cluster.dominantPurchaseStage || 'consideration',
        adGroupMapping: cluster.suggestedAdGroupName || '',
        clusterStrength: String(Math.round(avgKvi * 10000) / 10000),
      });

      const clusterId = (result as any).insertId;

      // 更新关键词的clusterId
      if (cluster.members && clusterId) {
        for (const member of cluster.members) {
          const kwId = keywordIdMap.get(member) || keywordIdMap.get(member.toLowerCase());
          if (kwId) {
            await db.update(prelaunchKeywords)
              .set({ clusterId })
              .where(eq(prelaunchKeywords.id, kwId));
          } else {
            // 按关键词文本匹配
            await db.update(prelaunchKeywords)
              .set({ clusterId })
              .where(and(
                eq(prelaunchKeywords.projectId, projectId),
                eq(prelaunchKeywords.keyword, member),
              ));
          }
        }
      }
    }

    return clusters.length;
  }

  // ==================== Step 6: 关系建模 ====================

  /**
   * 关系建模：识别关键词间的六种语义关系
   * 
   * 关系类型：
   * - hypernym（上位词）：pillow → memory foam pillow
   * - hyponym（下位词）：memory foam pillow → pillow
   * - synonym（同义词）：neck pillow ≈ cervical pillow
   * - related（相关词）：pillow ~ pillowcase
   * - alternative（替代词）：travel pillow ↔ neck pillow for airplane
   * - complementary（互补词）：camera → camera case
   * 
   * 检测方法：
   * - SERP重叠度分析（替代关系）
   * - 共现分析（互补关系）
   * - 语义包含分析（上下位关系）
   */
  private async buildRelationNetwork(
    db: any,
    projectId: number,
    keywords: any[],
    keywordIdMap: Map<string, number>
  ): Promise<number> {
    if (keywords.length < 2) return 0;

    // 只对核心和扩展词建立关系，避免组合爆炸
    const relevantKws = keywords
      .filter(k => k.relevanceLayer === 'core' || k.relevanceLayer === 'extended')
      .slice(0, 80);

    if (relevantKws.length < 2) return 0;

    const batchSize = 40;
    let totalRelations = 0;

    for (let i = 0; i < relevantKws.length; i += batchSize) {
      const batch = relevantKws.slice(i, i + batchSize);

      const prompt = `You are an Amazon keyword relationship analyst. Analyze the semantic relationships between these keywords.

RELATIONSHIP TYPES (use exactly these values):
1. "hypernym" — A is a broader category of B (e.g., "pillow" is hypernym of "memory foam pillow")
2. "hyponym" — A is a specific type of B (e.g., "memory foam pillow" is hyponym of "pillow")
3. "synonym" — A and B mean essentially the same thing (e.g., "neck pillow" ≈ "cervical pillow")
4. "related" — A and B are topically related but distinct (e.g., "pillow" ~ "pillowcase")
5. "alternative" — A and B are substitutes; searching one often shows same products as the other (e.g., "travel pillow" ↔ "neck pillow for airplane")
6. "complementary" — A and B are frequently bought together (e.g., "camera" + "camera case")

DETECTION LOGIC:
- If two keywords would show highly overlapping search results on Amazon → "alternative"
- If one keyword's products are in "Frequently Bought Together" of the other → "complementary"
- If one keyword contains the other as a substring → likely "hypernym"/"hyponym"
- If two keywords describe the same product differently → "synonym"

Keywords to analyze:
${batch.map(k => k.keyword).join('\n')}

Find ALL meaningful relationships (aim for 20-60 pairs). For each:
- sourceKeyword: first keyword
- targetKeyword: second keyword
- relationType: one of the 6 types above
- strength: 0.0-1.0 (how strong is this relationship?)
- evidence: brief explanation of why this relationship exists
- detectionMethod: "serp_overlap", "co_occurrence", "semantic_inclusion", "attribute_match", "ai_inference"

Return JSON array: [{"sourceKeyword":"...","targetKeyword":"...","relationType":"...","strength":0.85,"evidence":"...","detectionMethod":"..."}]`;

      const relations = await geminiStructuredOutput<KeywordRelation[]>('', prompt, { temperature: 0.15 });

      for (const rel of relations) {
        const sourceId = keywordIdMap.get(rel.sourceKeyword) || keywordIdMap.get(rel.sourceKeyword?.toLowerCase());
        const targetId = keywordIdMap.get(rel.targetKeyword) || keywordIdMap.get(rel.targetKeyword?.toLowerCase());

        if (sourceId && targetId && sourceId !== targetId) {
          await db.insert(prelaunchKeywordRelations).values({
            projectId,
            sourceKeywordId: sourceId,
            targetKeywordId: targetId,
            sourceKeyword: rel.sourceKeyword,
            targetKeyword: rel.targetKeyword,
            relationType: rel.relationType as any,
            strength: String(rel.strength || 0.5),
            evidence: rel.evidence || '',
            detectionMethod: rel.detectionMethod || 'ai_inference',
            coOccurrenceScore: '0',
            serpOverlap: '0',
          });
          totalRelations++;
        }
      }
    }

    return totalRelations;
  }

  // ==================== Step 7: 场景绑定 ====================

  /**
   * 场景绑定：连接"词"与"人"
   * 
   * 为产品定义5-8个核心使用场景，然后为每个关键词分配场景权重。
   * 这一步让词库从"搜索数据"升级为"用户行为模型"。
   */
  private async bindScenarios(
    db: any,
    projectId: number,
    keywords: any[],
    keywordIdMap: Map<string, number>
  ): Promise<number> {
    if (keywords.length === 0) return 0;

    // 先让AI定义产品的核心使用场景
    const seedKws = keywords.filter(k => k.relevanceLayer === 'core').slice(0, 10).map(k => k.keyword);

    const scenarioPrompt = `Based on these core product keywords: ${seedKws.join(', ')}

Define 5-8 core usage scenarios for this product. Each scenario should represent a distinct real-life situation where a customer would use this product.

Return JSON array:
[{
  "scenarioCode": "S01",
  "scenarioLabel": "Daily Home Use",
  "description": "Customer uses the product in their daily home routine"
}]

Use codes S01-S12 (S01=daily_use, S02=first_purchase, S03=replacement, S04=gift, S05=bulk_buy, S06=premium, S07=budget, S08=comparison, S09=problem_solving, S10=seasonal, S11=trending, S12=niche).`;

    const scenarios = await geminiStructuredOutput<any[]>('', scenarioPrompt, { temperature: 0.2 });

    // 为每个关键词分配场景权重
    const batchSize = 30;
    let totalWeights = 0;

    for (let i = 0; i < keywords.length; i += batchSize) {
      const batch = keywords.slice(i, i + batchSize);

      const weightPrompt = `Given these product usage scenarios:
${scenarios.map((s: any) => `${s.scenarioCode}: ${s.scenarioLabel} — ${s.description}`).join('\n')}

For each keyword below, assign weights (0.0-1.0) to the most relevant scenarios. Each keyword should have 1-3 scenario weights that sum to approximately 1.0.

Keywords:
${batch.map(k => k.keyword).join('\n')}

Return JSON array:
[{
  "keyword": "...",
  "sceneWeights": [
    {"scenarioCode": "S01", "weight": 0.6, "confidence": 0.9},
    {"scenarioCode": "S09", "weight": 0.4, "confidence": 0.8}
  ]
}]`;

      const weightResults = await geminiStructuredOutput<any[]>('', weightPrompt, { temperature: 0.1 });

      for (const result of weightResults) {
        const kwId = keywordIdMap.get(result.keyword) || keywordIdMap.get(result.keyword?.toLowerCase());
        if (!kwId) continue;

        const sceneDistribution: Record<string, number> = {};

        for (const sw of (result.sceneWeights || [])) {
          const scenario = scenarios.find((s: any) => s.scenarioCode === sw.scenarioCode);

          await db.insert(prelaunchKeywordSceneWeights).values({
            projectId,
            keywordId: kwId,
            scenarioCode: sw.scenarioCode,
            scenarioLabel: scenario?.scenarioLabel || sw.scenarioCode,
            weight: String(sw.weight || 0),
            confidence: String(sw.confidence || 0.5),
          });

          sceneDistribution[sw.scenarioCode] = sw.weight;
          totalWeights++;
        }

        // 更新关键词的场景分布
        await db.update(prelaunchKeywords)
          .set({ sceneDistribution })
          .where(eq(prelaunchKeywords.id, kwId));
      }
    }

    return totalWeights;
  }

  // ==================== Step 8: COSMO因果链 ====================

  /**
   * COSMO因果链：从竞品差评中提炼黄金
   * 
   * 生成"因为(场景/问题)…所以(负面感受/后果)…"的因果链
   * 这些因果链是内容创作和文案优化的核心素材。
   */
  private async generateCosmoTriples(db: any, projectId: number, keywords: any[]): Promise<number> {
    const coreKeywords = keywords
      .filter(k => k.relevanceLayer === 'core' || k.relevanceLayer === 'extended')
      .slice(0, 50);

    if (coreKeywords.length === 0) return 0;

    const prompt = `Based on these Amazon product keywords, generate COSMO (Common Sense Model) cause-effect-outcome triples.

These triples represent the customer's REAL decision-making logic, especially pain points discovered from competitor reviews.

Keywords: ${coreKeywords.map(k => k.keyword).join(', ')}

For each triple, provide:
- causeNode: The trigger/pain point/need (e.g., "waking up with neck stiffness every morning")
- effectNode: The search/action (e.g., "searching for ergonomic cervical pillow")
- outcomeNode: The desired result (e.g., "pain-free mornings, better sleep quality")
- relationLabel: Type of causal relationship ("pain_drives_search", "need_motivates_purchase", "experience_triggers_replacement", "recommendation_influences_choice")
- confidence: 0.0-1.0
- scenarioCode: Most relevant scenario (S01-S12)
- painPointCategory: Category of pain point ("comfort", "durability", "value", "functionality", "aesthetics", "health", "convenience")
- solutionCategory: Category of solution ("material_upgrade", "design_innovation", "price_optimization", "feature_addition", "quality_improvement")
- valueProposition: One-sentence value proposition derived from this causal chain

Generate 15-30 high-quality triples covering diverse pain points and scenarios.

Return JSON array:
[{"causeNode":"...","effectNode":"...","outcomeNode":"...","relationLabel":"...","confidence":0.85,"scenarioCode":"S01","painPointCategory":"...","solutionCategory":"...","valueProposition":"..."}]`;

    const triples = await geminiStructuredOutput<any[]>('', prompt, { temperature: 0.3 });
    let count = 0;

    for (const triple of triples) {
      await db.insert(prelaunchCosmoTriples).values({
        projectId,
        causeNode: triple.causeNode,
        effectNode: triple.effectNode,
        outcomeNode: triple.outcomeNode || '',
        relationLabel: triple.relationLabel || 'causes',
        confidence: String(triple.confidence || 0.5),
        sourceType: 'ai_inference',
        scenarioCode: triple.scenarioCode || 'S01',
        painPointCategory: triple.painPointCategory || '',
        solutionCategory: triple.solutionCategory || '',
        valueProposition: triple.valueProposition || '',
      });
      count++;
    }

    return count;
  }

  // ==================== 图谱统计 ====================

  /** 计算图谱统计指标 */
  private calculateGraphMetrics(
    keywords: any[],
    relations: any[],
    clusters: any[],
    cosmoTriples: any[]
  ): GraphMetrics {
    // 商业价值分布
    const commercialValueDistribution: Record<string, number> = {};
    for (const kw of keywords) {
      const cv = kw.commercialValue || 'unknown';
      commercialValueDistribution[cv] = (commercialValueDistribution[cv] || 0) + 1;
    }

    // 意图分布
    const intentDistribution: Record<string, number> = {};
    for (const kw of keywords) {
      const intent = kw.userIntent || 'unknown';
      intentDistribution[intent] = (intentDistribution[intent] || 0) + 1;
    }

    // 购买阶段分布
    const purchaseStageDistribution: Record<string, number> = {};
    for (const kw of keywords) {
      const stage = kw.purchaseStage || 'unknown';
      purchaseStageDistribution[stage] = (purchaseStageDistribution[stage] || 0) + 1;
    }

    // 关系类型分布
    const relationTypeDistribution: Record<string, number> = {};
    for (const rel of relations) {
      const type = rel.relationType || 'unknown';
      relationTypeDistribution[type] = (relationTypeDistribution[type] || 0) + 1;
    }

    // 场景统计
    const scenarioMap = new Map<string, number>();
    for (const kw of keywords) {
      const sc = kw.scenarioCode || 'S01';
      scenarioMap.set(sc, (scenarioMap.get(sc) || 0) + 1);
    }
    const topScenarios = Array.from(scenarioMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([code, count]) => ({ code, label: code, keywordCount: count }));

    // 平均值
    const avgClusterSize = clusters.length > 0
      ? keywords.length / clusters.length
      : 0;
    const avgRelationStrength = relations.length > 0
      ? relations.reduce((sum: number, r: any) => sum + parseFloat(r.strength || '0'), 0) / relations.length
      : 0;

    return {
      nodeCount: keywords.length,
      edgeCount: relations.length,
      clusterCount: clusters.length,
      cosmoTripleCount: cosmoTriples.length,
      avgClusterSize: Math.round(avgClusterSize * 100) / 100,
      avgRelationStrength: Math.round(avgRelationStrength * 10000) / 10000,
      commercialValueDistribution,
      intentDistribution,
      purchaseStageDistribution,
      topScenarios,
      relationTypeDistribution,
    };
  }
}
