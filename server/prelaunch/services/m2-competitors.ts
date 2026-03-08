/**
 * M2 竞品库引擎服务
 * 竞品发现 → TRS评分(白盒化) → 评论分析 → 场景矩阵 → 用户语言库
 */
import { DbInstance, getDb } from '../../db';
import {
  prelaunchCompetitors, prelaunchCompetitorUserLanguage,
  prelaunchCompetitorScenarioMatrix, prelaunchKeywords,
} from '../../../drizzle/schema';
import { eq, desc, and, sql } from 'drizzle-orm';
import { geminiStructuredOutput } from '../gemini';

export class M2CompetitorService {

  async getCompetitors(input: {
    projectId: number;
    tier?: string;
    page?: number;
    pageSize?: number;
  }) {
    const db = await getDb();
    if (!db) return { success: false, data: [], total: 0 };

    try {
      const conditions = [eq(prelaunchCompetitors.projectId, input.projectId)];
      // @ts-ignore
      if (input.tier) conditions.push(eq(prelaunchCompetitors.tier, input.tier as unknown));

      const page = input.page ?? 1;
      const pageSize = input.pageSize ?? 30;

      const data = await db.select()
        .from(prelaunchCompetitors)
        .where(and(...conditions))
        .orderBy(desc(prelaunchCompetitors.trsScore))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [countResult] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(prelaunchCompetitors)
        .where(and(...conditions));

      return { success: true, data, total: countResult?.count ?? 0 };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message, data: [], total: 0 };
    }
  }

  async getTrsDetail(competitorId: number) {
    const db = await getDb();
    if (!db) return { success: false };

    try {
      const [comp] = await db.select()
        .from(prelaunchCompetitors)
        .where(eq(prelaunchCompetitors.id, competitorId))
        .limit(1);

      if (!comp) return { success: false, error: 'Competitor not found' };

      return {
        success: true,
        data: {
          ...comp,
          trsBreakdown: comp.trsBreakdown ? (typeof comp.trsBreakdown === 'string' ? JSON.parse(comp.trsBreakdown) : comp.trsBreakdown) : null,
        },
      };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }

  async getScenarioMatrix(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, data: [] };

    try {
      const data = await db.select()
        .from(prelaunchCompetitorScenarioMatrix)
        .where(eq(prelaunchCompetitorScenarioMatrix.projectId, projectId));
      return { success: true, data };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message, data: [] };
    }
  }

  async getUserLanguage(projectId: number, competitorId?: number) {
    const db = await getDb();
    if (!db) return { success: false, data: [] };

    try {
      const conditions = [eq(prelaunchCompetitorUserLanguage.projectId, projectId)];
      if (competitorId) conditions.push(eq(prelaunchCompetitorUserLanguage.competitorId, competitorId));

      const data = await db.select()
        .from(prelaunchCompetitorUserLanguage)
        .where(and(...conditions))
        .orderBy(desc(prelaunchCompetitorUserLanguage.frequency));
      return { success: true, data };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message, data: [] };
    }
  }

  /** 运行M2完整流水线 */
  async runPipeline(projectId: number, competitorAsins?: string[], autoDiscover = true) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      let asins = competitorAsins || [];

      // Step 1: 自动发现竞品（如果启用）
      if (autoDiscover && asins.length === 0) {
        const keywords = await db.select()
          .from(prelaunchKeywords)
          .where(and(
            eq(prelaunchKeywords.projectId, projectId),
            eq(prelaunchKeywords.relevanceLayer, 'core'),
          ))
          .limit(10);

        if (keywords.length > 0) {
          const kwList = keywords.map((k: Record<string, any>) => k.keyword).join(', ');
          const discovered = await geminiStructuredOutput<Record<string, any>[]>('',
            `Given these Amazon search keywords: ${kwList}
            
Identify 15-25 competitor ASINs that would appear in search results. For each, provide:
- asin: Amazon ASIN (10-char alphanumeric, start with B0)
- title: product title
- brand: brand name
- estimatedPrice: price in USD
- estimatedRating: 1.0-5.0
- estimatedReviewCount: number of reviews
- estimatedBsr: best seller rank

Return JSON array.`, { temperature: 0.3 });

          asins = discovered.map((d: Record<string, any>) => d.asin);

          // 写入竞品基础数据
          for (const comp of (discovered as any[])) {
            await db.insert(prelaunchCompetitors).values({
              projectId,
              asin: comp.asin,
              title: comp.title,
              brand: comp.brand,
              price: String(comp.estimatedPrice || 0),
              rating: String(comp.estimatedRating || 0),
              reviewCount: comp.estimatedReviewCount || 0,
              bsr: comp.estimatedBsr || 0,
              dataSource: 'gemini_discovery',
            });
          }
        }
      }

      // Step 2: TRS评分（白盒化）
      const competitors = await db.select()
        .from(prelaunchCompetitors)
        .where(eq(prelaunchCompetitors.projectId, projectId));

      for (const comp of (competitors as any[])) {
        const trs = this.calculateTRS(comp);
        await db.update(prelaunchCompetitors)
          .set({
            trsScore: String(trs.total),
            trsRelevance: String(trs.relevance),
            trsBrandPower: String(trs.brandPower),
            trsMarketShare: String(trs.marketShare),
            trsBreakdown: JSON.stringify(trs),
            tier: trs.total >= 0.7 ? 'T1_head' : trs.total >= 0.4 ? 'T2_waist' : 'T3_niche',
          })
          .where(eq(prelaunchCompetitors.id, comp.id));
      }

      // Step 3: 竞品评论分析 → 用户语言库
      await this.analyzeCompetitorReviews(db, projectId, competitors);

      // Step 4: 竞品场景矩阵
      await this.buildScenarioMatrix(db, projectId, competitors);

      return {
        success: true,
        summary: {
          totalCompetitors: competitors.length,
          t1Count: competitors.filter((c: Record<string, any>) => c.tier === 'T1_head').length,
          t2Count: competitors.filter((c: Record<string, any>) => c.tier === 'T2_waist').length,
          t3Count: competitors.filter((c: Record<string, any>) => c.tier === 'T3_niche').length,
        },
      };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }

  /** TRS评分计算（白盒化） */
  private calculateTRS(comp: any) {
    const rating = parseFloat(comp.rating) || 0;
    const reviewCount = comp.reviewCount || 0;
    const bsr = comp.bsr || 999999;
    const price = parseFloat(comp.price) || 0;

    // 相关性分数（基于评分和评论数）
    const relevance = Math.min(1, (rating / 5) * 0.5 + Math.min(1, Math.log10(Math.max(1, reviewCount)) / 4) * 0.5);

    // 品牌实力（基于评论数和BSR）
    const brandPower = Math.min(1, Math.log10(Math.max(1, reviewCount)) / 5 * 0.6 + Math.max(0, 1 - Math.log10(Math.max(1, bsr)) / 7) * 0.4);

    // 市场份额（基于BSR）
    const marketShare = Math.max(0, 1 - Math.log10(Math.max(1, bsr)) / 7);

    // 总分
    const total = relevance * 0.35 + brandPower * 0.35 + marketShare * 0.30;

    return {
      total: Math.round(total * 10000) / 10000,
      relevance: Math.round(relevance * 10000) / 10000,
      brandPower: Math.round(brandPower * 10000) / 10000,
      marketShare: Math.round(marketShare * 10000) / 10000,
      formula: 'TRS = Relevance(0.35) × BrandPower(0.35) × MarketShare(0.30)',
      inputs: { rating, reviewCount, bsr, price },
    };
  }

  /** 竞品评论分析 */
  private async analyzeCompetitorReviews(db: DbInstance, projectId: number, competitors: unknown[]) {
    const topCompetitors = competitors.slice(0, 10);

    for (const comp of (topCompetitors as any[])) {
      const prompt = `Analyze the likely customer reviews for this Amazon product:
Title: ${comp.title || 'Unknown'}
Brand: ${comp.brand || 'Unknown'}
Rating: ${comp.rating || 'N/A'}
Reviews: ${comp.reviewCount || 0}

Generate realistic user language phrases that customers would use in reviews. For each phrase, provide:
- phraseType: one of "pain_point", "praise", "use_case", "comparison", "feature_request", "quality_concern", "value_perception"
- phrase: the actual user language (natural, conversational)
- sentiment: "positive", "negative", or "neutral"

Generate 10-20 diverse phrases. Return JSON array:
[{"phraseType":"...","phrase":"...","sentiment":"..."}]`;

      const phrases = await geminiStructuredOutput<Record<string, any>[]>('', prompt, { temperature: 0.4 });

      for (const p of phrases) {
        // @ts-ignore
        await db.insert(prelaunchCompetitorUserLanguage).values({
          projectId,
          competitorId: comp.id,
          phraseType: p.phraseType,
          phrase: p.phrase,
          sentiment: p.sentiment || 'neutral',
          frequency: 1,
          sourceReviewCount: comp.reviewCount || 0,
        });
      }
    }
  }

  /** 竞品场景矩阵 */
  private async buildScenarioMatrix(db: DbInstance, projectId: number, competitors: any[]) {
    const scenarios = [
      'S01', 'S02', 'S03', 'S04', 'S05', 'S06',
      'S07', 'S08', 'S09', 'S10', 'S11', 'S12',
    ];

    for (const comp of competitors.slice(0, 15)) {
      const prompt = `For this Amazon product, estimate its traffic distribution across shopping scenarios:
Title: ${comp.title || 'Unknown'}
Brand: ${comp.brand || 'Unknown'}
BSR: ${comp.bsr || 'N/A'}

Scenarios: S01=daily_use, S02=first_purchase, S03=replacement, S04=gift, S05=bulk_buy, S06=premium, S07=budget, S08=comparison, S09=problem_solving, S10=seasonal, S11=trending, S12=niche

For each scenario, estimate:
- trafficShare: 0.0-1.0 (all should sum to ~1.0)
- attackFeasibility: 0.0-1.0 (how easy to compete in this scenario)
- suggestedStrategy: brief strategy recommendation

Return JSON array: [{"scenarioCode":"S01","trafficShare":0.25,"attackFeasibility":0.6,"suggestedStrategy":"..."}]`;

      const matrix = await geminiStructuredOutput<Record<string, any>[]>('', prompt, { temperature: 0.2 });

      for (const entry of matrix) {
        if (scenarios.includes(entry.scenarioCode)) {
          // @ts-ignore
          await db.insert(prelaunchCompetitorScenarioMatrix).values({
            projectId,
            // @ts-ignore
            competitorId: comp.id,
            scenarioCode: entry.scenarioCode,
            trafficShare: String(entry.trafficShare || 0),
            attackFeasibility: String(entry.attackFeasibility || 0),
            suggestedStrategy: entry.suggestedStrategy || '',
          });
        }
      }
    }
  }
}
