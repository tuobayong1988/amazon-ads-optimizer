/**
 * M1 搜索词库引擎服务
 * 关键词采集 → 四维分类 → 聚类 → 关系建模 → DR×AM校准 → COSMO图谱
 */
import { DbInstance, getDb } from '../../db';
import {
  prelaunchKeywords, prelaunchKeywordClusters,
  prelaunchKeywordRelations, prelaunchCosmoTriples, prelaunchProjects,
  prelaunchCompetitors,
} from '../../../drizzle/schema';
import { eq, desc, and, sql } from 'drizzle-orm';
import { geminiChat, geminiStructuredOutput } from '../gemini';

export class M1KeywordService {

  async getKeywords(input: {
    projectId: number;
    relevanceLayer?: string;
    scenarioCode?: string;
    clusterId?: number;
    sortBy?: string;
    page?: number;
    pageSize?: number;
  }) {
    const db = await getDb();
    if (!db) return { success: false, data: [], total: 0 };

    try {
      const conditions = [eq(prelaunchKeywords.projectId, input.projectId)];
      // @ts-ignore - type assertion
      if (input.relevanceLayer) conditions.push(eq(prelaunchKeywords.relevanceLayer, input.relevanceLayer as unknown));
      if (input.scenarioCode) conditions.push(eq(prelaunchKeywords.scenarioCode, input.scenarioCode));
      if (input.clusterId) conditions.push(eq(prelaunchKeywords.clusterId, input.clusterId));

      const page = input.page ?? 1;
      const pageSize = input.pageSize ?? 50;

      const data = await db.select()
        .from(prelaunchKeywords)
        .where(and(...conditions))
        .orderBy(desc(prelaunchKeywords.kviScore))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [countResult] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(prelaunchKeywords)
        .where(and(...conditions));

      return { success: true, data, total: countResult?.count ?? 0, page, pageSize };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message, data: [], total: 0 };
    }
  }

  async getClusters(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, data: [] };

    try {
      const data = await db.select()
        .from(prelaunchKeywordClusters)
        .where(eq(prelaunchKeywordClusters.projectId, projectId))
        .orderBy(desc(prelaunchKeywordClusters.avgKvi));
      return { success: true, data };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message, data: [] };
    }
  }

  async getRelations(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, data: [] };

    try {
      const data = await db.select()
        .from(prelaunchKeywordRelations)
        .where(eq(prelaunchKeywordRelations.projectId, projectId))
        .orderBy(desc(prelaunchKeywordRelations.strength));
      return { success: true, data };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message, data: [] };
    }
  }

  async getCosmoTriples(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, data: [] };

    try {
      const data = await db.select()
        .from(prelaunchCosmoTriples)
        .where(eq(prelaunchCosmoTriples.projectId, projectId))
        .orderBy(desc(prelaunchCosmoTriples.confidence));
      return { success: true, data };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message, data: [] };
    }
  }

  /** 运行M1完整流水线 */
  async runPipeline(projectId: number, seedKeywords: string[], marketplace: string) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      // Step 1: 使用Gemini扩展种子词
      const expandedKeywords = await this.expandKeywords(seedKeywords, marketplace);

      // Step 1.5: v26.5 优化1B — 构建动态品牌名称库
      const brandLibrary = await this.buildBrandLibrary(db, projectId);

      // Step 2: 四维分类（相关性层级 × 维度类型 × 场景编码 × 意图标签）+ 动态品牌词库
      const classifiedKeywords = await this.classifyKeywords(expandedKeywords, seedKeywords, brandLibrary);

      // Step 2.5: v26.5 优化2A — 获取产品售价和目标ACoS用于盈亏平衡计算
      let cpcContext: { productPrice: number; targetAcos: number } | undefined;
      let lifecycleStage: string | undefined;
      try {
        const [project] = await db.select()
          .from(prelaunchProjects)
          .where(eq(prelaunchProjects.id, projectId))
          .limit(1);
        if (project) {
          const projInfo = project as Record<string, unknown>;
          const price = parseFloat(String(projInfo.productPrice || projInfo.product_price || 0));
          // 目标 ACoS 默认 30%（新品期常见值）
          const targetAcos = parseFloat(String(projInfo.targetAcos || projInfo.target_acos || 0.30));
          if (price > 0) {
            cpcContext = { productPrice: price, targetAcos };
          }
          // v26.5 优化2B: 获取生命周期阶段（默认 launch）
          lifecycleStage = String(projInfo.lifecycleStage || projInfo.lifecycle_stage || 'launch');
        }
      } catch { /* 忽略，使用默认值 */ }

      // Step 3: 计算KVI评分（v26.5: 引入CPC效率+生命周期动态权重）
      const scoredKeywords = classifiedKeywords.map(kw => ({
        ...kw,
        kviScore: this.calculateKVI(kw, cpcContext, lifecycleStage),
      }));

      // Step 4: 批量写入数据库
      const insertData = scoredKeywords.map(kw => ({
        projectId,
        // @ts-ignore - runtime type mismatch
        keyword: kw.keyword,
        // @ts-ignore - runtime type mismatch
        searchVolume: kw.searchVolume || 0,
        // @ts-ignore - type assertion
        relevanceLayer: kw.relevanceLayer as unknown,
        // @ts-ignore - runtime type mismatch
        dimensionType: kw.dimensionType,
        // @ts-ignore - runtime type mismatch
        scenarioCode: kw.scenarioCode,
        // @ts-ignore - runtime type mismatch
        intentTag: kw.intentTag,
        kviScore: String(kw.kviScore),
        // @ts-ignore - runtime type mismatch
        kviVolume: String(kw.kviVolume || 0),
        // @ts-ignore - runtime type mismatch
        kviRelevance: String(kw.kviRelevance || 0),
        // @ts-ignore - runtime type mismatch
        kviOpportunity: String(kw.kviOpportunity || 0),
        dataSource: 'gemini_expansion',
      }));

      if (insertData.length > 0) {
        // 分批插入，每批100条
        for (let i = 0; i < insertData.length; i += 100) {
          const batch = insertData.slice(i, i + 100);
          // @ts-ignore - Drizzle query builder type
          await db.insert(prelaunchKeywords).values(batch);
        }
      }

      // Step 5: 运行聚类分析
      await this.runClustering(db, projectId);

      // Step 6: 生成COSMO三元组
      await this.generateCosmoTriples(db, projectId, scoredKeywords);

      // 更新项目状态
      await db.update(prelaunchProjects)
        .set({ status: 'running' })
        .where(eq(prelaunchProjects.id, projectId));

      return {
        success: true,
        summary: {
          totalKeywords: insertData.length,
          coreKeywords: insertData.filter(k => k.relevanceLayer === 'core').length,
          extendedKeywords: insertData.filter(k => k.relevanceLayer === 'extended').length,
          longTailKeywords: insertData.filter(k => k.relevanceLayer === 'long_tail').length,
        },
      };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }

  /** 使用Gemini扩展种子词 */
  private async expandKeywords(seedKeywords: string[], marketplace: string): Promise<Record<string, unknown>[]> {
    const prompt = `You are an Amazon keyword research expert. Given these seed keywords for the ${marketplace} marketplace:
${seedKeywords.join(', ')}

Generate a comprehensive keyword list of 80-150 keywords. For each keyword, provide:
- keyword: the search term
- searchVolume: estimated monthly search volume (integer)
- competitorDensity: number of competing products (integer, 1-999)
- avgPrice: average product price in USD

Include: core product keywords, long-tail variations, problem/pain-point keywords, benefit keywords, comparison keywords, use-case keywords, demographic keywords, seasonal keywords.

Return as JSON array: [{"keyword":"...","searchVolume":...,"competitorDensity":...,"avgPrice":...}]`;

    return geminiStructuredOutput<Record<string, unknown>[]>('', prompt, { temperature: 0.4 });
  }

  /**
   * v26.5 优化1B: 构建动态品牌名称库
   * 
   * 从 M2 竞品数据中提取已知品牌名，构建动态词库。
   * 将品牌名列表作为上下文注入到 classifyKeywords 的 LLM prompt 中，
   * 强制要求 LLM 依据此词库进行品牌词标注。
   */
  private async buildBrandLibrary(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, projectId: number): Promise<string[]> {
    try {
      const competitors = await db.select({ brand: prelaunchCompetitors.brand })
        .from(prelaunchCompetitors)
        .where(eq(prelaunchCompetitors.projectId, projectId));

      const brandSet = new Set<string>();
      for (const comp of competitors) {
        const brand = comp.brand?.trim();
        if (brand && brand.length > 1 && brand.toLowerCase() !== 'unknown' && brand.toLowerCase() !== 'generic') {
          brandSet.add(brand);
        }
      }

      return Array.from(brandSet).slice(0, 50); // 最多50个品牌名避免 prompt 过长
    } catch {
      return [];
    }
  }

  /** 四维分类（v26.5: 增强品牌词识别） */
  private async classifyKeywords(keywords: unknown[], seedKeywords: string[], brandLibrary: string[] = []): Promise<Record<string, unknown>[]> {
    const batchSize = 30;
    const results: unknown[] = [];

    // v26.5 优化1B: 构建品牌词库上下文
    const brandContext = brandLibrary.length > 0
      ? `\n\nKNOWN BRAND NAMES IN THIS CATEGORY (use this list to identify brand keywords):\n${brandLibrary.join(', ')}\n\nIMPORTANT: If a keyword contains any of the above brand names (exact match or close variation/misspelling), you MUST classify its dimensionType as "brand". Brand keywords include the brand name itself, brand + product combinations, and common misspellings of brand names.`
      : '';

    for (let i = 0; i < keywords.length; i += batchSize) {
      const batch = keywords.slice(i, i + batchSize);
      const prompt = `Classify these Amazon keywords relative to the product defined by seeds: [${seedKeywords.join(', ')}]

For each keyword, determine:
1. relevanceLayer: "core" (directly describes product), "extended" (related attributes/use-cases), "long_tail" (specific niche queries), "irrelevant"
2. dimensionType: one of "product_attribute", "audience", "scenario", "brand", "pain_point", "benefit", "comparison", "seasonal"
3. scenarioCode: S01-S24 scenario code (S01=daily_use, S02=first_purchase, S03=replacement, S04=gift, S05=bulk_buy, S06=premium, S07=budget, S08=comparison, S09=problem_solving, S10=seasonal, S11=trending, S12=niche, S13-S24=other)
4. intentTag: "informational", "navigational", "commercial", "transactional"${brandContext}

Keywords to classify:
// @ts-ignore Dynamic type assertion
${batch.map(((k: any) => k.keyword as any)).join('\n')}

Return JSON array: [{"keyword":"...","relevanceLayer":"...","dimensionType":"...","scenarioCode":"...","intentTag":"..."}]`;

      const classified = await geminiStructuredOutput<Record<string, unknown>[]>('', prompt, { temperature: 0.1 });

      // 合并分类结果与原始数据
      // @ts-ignore Legacy code type compatibility
      for (const cls of classified) {
        // @ts-ignore Dynamic property access
        const original = batch.find((k: Record<string, unknown>) => k.keyword === cls.keyword);
        if (original) {
          results.push({ ...original, ...cls });
        }
      }
    // @ts-ignore Legacy code type compatibility
    }

    // @ts-ignore Return type compatibility
    return results;
  }

  /**
   * 计算KVI评分
   * 
   * v26.5 优化2A: 引入 CPC 效率因子
   * - 计算盈亏平衡 CPC = productPrice × targetAcos × estimatedCVR
   * - 如果关键词的估算 CPC 超过盈亏平衡 CPC 的 1.5 倍，施加惩罚系数
   * 
   * v26.5 优化2B: 动态生命周期权重
   * - launch 期：long_tail 权重提高（低竞争快速起量）
   * - growth 期：extended 权重提高（扩大覆盖）
   * - mature 期：core 权重提高（精准防守）
   */
  // @ts-ignore Complex function parameter types
  private calculateKVI(kw: unknown, cpcContext?: { productPrice: number; targetAcos: number }, lifecycleStage?: string): number {
    // @ts-ignore Type inference limitation
    const volumeScore = Math.min(1, Math.log10(Math.max(1, kw.searchVolume || 1)) / 5);

    // v26.5 优化2B: 根据生命周期动态调整 relevanceLayer 权重
    let coreWeight = 1.0;
    let extendedWeight = 0.7;
    let longTailWeight = 0.4;

    if (lifecycleStage === 'launch') {
      // 新品期：提高 long_tail 权重（低竞争快速起量）
      coreWeight = 0.9;
      extendedWeight = 0.7;
      longTailWeight = 0.6;
    } else if (lifecycleStage === 'growth') {
      // 成长期：提高 extended 权重（扩大覆盖）
      coreWeight = 0.9;
      extendedWeight = 0.85;
      longTailWeight = 0.45;
    } else if (lifecycleStage === 'mature') {
      // 成熟期：提高 core 权重（精准防守）
      coreWeight = 1.0;
      extendedWeight = 0.55;
      longTailWeight = 0.3;
    }

    // @ts-ignore Dynamic property access
    const relevanceScore = kw.relevanceLayer === 'core' ? coreWeight
      // @ts-ignore Dynamic property access
      : kw.relevanceLayer === 'extended' ? extendedWeight
      // @ts-ignore Dynamic property access
      : kw.relevanceLayer === 'long_tail' ? longTailWeight
      : 0.1;
    // @ts-ignore Type inference limitation
    const opportunityScore = kw.competitorDensity
      // @ts-ignore Conditional type narrowing
      ? Math.max(0, 1 - (kw.competitorDensity / 1000))
      : 0.5;

    let kvi = (volumeScore * 0.35 + relevanceScore * 0.40 + opportunityScore * 0.25);

    // v26.5 优化2A: CPC 盈亏平衡过滤
    if (cpcContext && cpcContext.productPrice > 0 && cpcContext.targetAcos > 0) {
      // 估算转化率：根据相关性层级估算
      // @ts-ignore Dynamic property access
      const estimatedCVR = kw.relevanceLayer === 'core' ? 0.12
        // @ts-ignore Dynamic property access
        : kw.relevanceLayer === 'extended' ? 0.08
        // @ts-ignore Dynamic property access
        : kw.relevanceLayer === 'long_tail' ? 0.15
        : 0.05;

      // 盈亏平衡 CPC = 产品售价 × 目标ACoS × 估算转化率
      const breakEvenCPC = cpcContext.productPrice * cpcContext.targetAcos * estimatedCVR;

      // 估算关键词 CPC：从 avgPrice 和 competitorDensity 推算
      // @ts-ignore Type inference limitation
      const estimatedCPC = kw.avgPrice
        // @ts-ignore Conditional type narrowing
        ? Math.max(0.3, kw.avgPrice * 0.03 * (1 + (kw.competitorDensity || 100) / 500))
        : 0.75; // 默认 CPC

      if (breakEvenCPC > 0 && estimatedCPC > breakEvenCPC * 1.5) {
        // CPC 超过盈亏平衡点的 1.5 倍，施加惩罚系数
        const penaltyRatio = Math.min(estimatedCPC / breakEvenCPC, 3.0); // 最大惩罚 3 倍
        const penalty = Math.max(0.3, 1.0 - (penaltyRatio - 1.5) * 0.25); // 惩罚系数 0.3~1.0
        kvi *= penalty;
      } else if (breakEvenCPC > 0 && estimatedCPC < breakEvenCPC * 0.5) {
        // CPC 远低于盈亏平衡点，给予小幅加分
        kvi *= 1.05;
      }
    }

    return Math.round(kvi * 10000) / 10000;
  }

  /** 聚类分析 */
  private async runClustering(db: DbInstance, projectId: number) {
    // @ts-ignore - runtime type mismatch
    const allKeywords = await db.select()
      .from(prelaunchKeywords)
      .where(eq(prelaunchKeywords.projectId, projectId));

    if (allKeywords.length === 0) return;

    const kwList = allKeywords.map((k: Record<string, unknown>) => k.keyword).join('\n');
    const prompt = `Group these Amazon keywords into semantic clusters based on user intent. Each cluster should represent a distinct search intent or product need.

Keywords:
${kwList}

Return JSON: [{"clusterLabel":"descriptive label","intentSummary":"what users in this cluster want","members":["keyword1","keyword2",...]}]
Create 5-15 clusters. Every keyword must belong to exactly one cluster.`;

    const clusters = await geminiStructuredOutput<Record<string, unknown>[]>('', prompt, { temperature: 0.2 });

    for (const cluster of clusters) {
      // @ts-ignore - Drizzle query builder type
      const [result] = await db.insert(prelaunchKeywordClusters).values({
        // @ts-ignore Legacy code type compatibility
        projectId,
        clusterLabel: cluster.clusterLabel,
        intentSummary: cluster.intentSummary,
        // @ts-ignore Conditional type narrowing
        memberCount: cluster.members?.length || 0,
        avgKvi: '0',
        topScenario: 'S01',
      });

      // @ts-ignore - type assertion
      const clusterId = (result as Record<string, number>).insertId;

      // 更新关键词的clusterId
      if (cluster.members && clusterId) {
        // @ts-ignore Legacy code type compatibility
        for (const member of cluster.members) {
          // @ts-ignore - runtime type mismatch
          await db.update(prelaunchKeywords)
            .set({ clusterId })
            // @ts-ignore DB query type inference limitation
            .where(and(
              eq(prelaunchKeywords.projectId, projectId),
              eq(prelaunchKeywords.keyword, member),
            ));
        }
      }
    }
  // @ts-ignore Legacy code type compatibility
  }

  /** 生成COSMO因果链三元组 */
  private async generateCosmoTriples(db: DbInstance, projectId: number, keywords: unknown[]) {
    const coreKeywords = keywords
      // @ts-ignore Dynamic property access
      .filter(k => k.relevanceLayer === 'core' || k.relevanceLayer === 'extended')
      .slice(0, 50);

    if (coreKeywords.length === 0) return;

    const prompt = `Based on these Amazon product keywords, generate COSMO (Common Sense Model) cause-effect-outcome triples that represent the customer's decision-making logic.

// @ts-ignore Dynamic type assertion
Keywords: ${coreKeywords.map(k => (k as any).keyword).join(', ')}

For each triple:
// @ts-ignore Legacy code type compatibility
- causeNode: The trigger/pain point/need (e.g., "leaky water bottle lid")
- effectNode: The solution/action (e.g., "search for replacement lid")
- outcomeNode: The desired result (e.g., "no more spills, save money")
- relationLabel: The type of causal relationship
- confidence: 0.0-1.0

Generate 10-30 high-quality triples. Return JSON array:
[{"causeNode":"...","effectNode":"...","outcomeNode":"...","relationLabel":"...","confidence":0.85}]`;

    const triples = await geminiStructuredOutput<Record<string, unknown>[]>('', prompt, { temperature: 0.3 });

    for (const triple of triples) {
      // @ts-ignore - Drizzle query builder type
      await db.insert(prelaunchCosmoTriples).values({
        // @ts-ignore Legacy code type compatibility
        projectId,
        causeNode: triple.causeNode,
        effectNode: triple.effectNode,
        outcomeNode: triple.outcomeNode || '',
        relationLabel: triple.relationLabel || 'causes',
        confidence: String(triple.confidence || 0.5),
      });
    }
  }
}
