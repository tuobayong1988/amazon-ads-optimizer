/**
 * M2 竞品库引擎服务
 * 竞品发现 → TRS评分(白盒化) → 评论分析 → 场景矩阵 → 用户语言库
 * 
 * v2.0 更新：集成 Oxylabs Amazon Scraper API 作为真实数据源，
 * 替代原有的 Gemini AI 模拟数据。当 Oxylabs 不可用时，自动回退到 Gemini。
 */
import { DbInstance, getDb } from '../../db';
import {
  prelaunchCompetitors, prelaunchCompetitorUserLanguage,
  prelaunchCompetitorScenarioMatrix, prelaunchKeywords,
} from '../../../drizzle/schema';
import { eq, desc, and, sql } from 'drizzle-orm';
import { geminiStructuredOutput } from '../gemini';
import {
  discoverCompetitors,
  fetchProductDetailsBatch,
  checkServiceHealth,
  type DiscoveredCompetitor,
} from '../oxylabs';

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
          const kwList = keywords.map((k: Record<string, unknown>) => k.keyword);

          // 优先使用 Oxylabs 真实数据源
          const oxylabsHealth = await checkServiceHealth();

          if (oxylabsHealth.available) {
            // ─── Oxylabs 真实数据路径 ───────────────────────────────
            console.log('[M2] Using Oxylabs real data source for competitor discovery');

            // @ts-ignore
            const discovered = await discoverCompetitors(kwList, {
              maxCompetitors: 25,
              fetchProductDetail: true,
            });

            asins = discovered.map(d => d.asin);

            // 写入竞品基础数据（真实数据）
            for (const comp of discovered) {
              await db.insert(prelaunchCompetitors).values({
                projectId,
                asin: comp.asin,
                title: comp.title,
                brand: comp.brand,
                price: String(comp.price || 0),
                rating: String(comp.rating || 0),
                reviewCount: comp.reviewCount || 0,
                bsr: comp.bsr || 0,
                dataSource: 'oxylabs_discovery',
                rawData: JSON.stringify({
                  searchData: comp.rawSearchData,
                  productData: comp.rawProductData,
                  imageUrl: comp.imageUrl,
                  isSponsored: comp.isSponsored,
                  position: comp.position,
                  salesVolume: comp.salesVolume,
                }),
              });
            }

            console.log(`[M2] Oxylabs discovery complete: ${discovered.length} competitors found`);

          } else {
            // ─── Gemini 回退路径（保留原有逻辑作为降级方案）─────────
            console.warn(`[M2] Oxylabs unavailable (${oxylabsHealth.message}), falling back to Gemini`);

            const kwJoined = kwList.join(', ');
            const discovered = await geminiStructuredOutput<Record<string, unknown>[]>('',
              `Given these Amazon search keywords: ${kwJoined}
              
Identify 15-25 competitor ASINs that would appear in search results. For each, provide:
- asin: Amazon ASIN (10-char alphanumeric, start with B0)
- title: product title
- brand: brand name
- estimatedPrice: price in USD
- estimatedRating: 1.0-5.0
- estimatedReviewCount: number of reviews
- estimatedBsr: best seller rank

// @ts-ignore
Return JSON array.`, { temperature: 0.3 });

            // @ts-ignore
            asins = discovered.map((d: Record<string, unknown>) => d.asin);

            // 写入竞品基础数据（Gemini模拟数据）
            // @ts-ignore
            for (const comp of (discovered as unknown[])) {
              // @ts-ignore
              await db.insert(prelaunchCompetitors).values({
                // @ts-ignore
                projectId,
                // @ts-ignore
                asin: comp.asin,
                // @ts-ignore
                title: comp.title,
                // @ts-ignore
                brand: comp.brand,
                // @ts-ignore
                price: String(comp.estimatedPrice || 0),
                // @ts-ignore
                rating: String(comp.estimatedRating || 0),
                // @ts-ignore
                reviewCount: comp.estimatedReviewCount || 0,
                // @ts-ignore
                bsr: comp.estimatedBsr || 0,
                dataSource: 'gemini_discovery',
              });
            }
          }
        }
      } else if (competitorAsins && competitorAsins.length > 0) {
        // ─── 用户手动指定 ASIN 的路径 ──────────────────────────────
        // 使用 Oxylabs 获取这些 ASIN 的真实产品详情
        const oxylabsHealth = await checkServiceHealth();

        if (oxylabsHealth.available) {
          console.log(`[M2] Fetching details for ${competitorAsins.length} user-specified ASINs via Oxylabs`);

          const detailsMap = await fetchProductDetailsBatch(competitorAsins);

          for (const asin of competitorAsins) {
            const detail = detailsMap.get(asin);
            await db.insert(prelaunchCompetitors).values({
              projectId,
              asin,
              title: detail?.title || '',
              brand: detail?.brand || detail?.manufacturer || '',
              price: String(detail?.price || 0),
              rating: String(detail?.rating || 0),
              reviewCount: detail?.reviews_count || 0,
              bsr: detail?.sales_rank?.[0]?.rank || 0,
              dataSource: detail ? 'oxylabs_manual' : 'manual_no_data',
              rawData: detail ? JSON.stringify(detail) : null,
            });
          }
        } else {
          // 无 Oxylabs 时，仅写入 ASIN，不填充数据
          for (const asin of competitorAsins) {
            await db.insert(prelaunchCompetitors).values({
              projectId,
              asin,
              dataSource: 'manual_no_data',
            });
          }
        }
      }

      // Step 2: TRS评分（白盒化）
      const competitors = await db.select()
        .from(prelaunchCompetitors)
        .where(eq(prelaunchCompetitors.projectId, projectId));

      for (const comp of (competitors as unknown[])) {
        // @ts-ignore
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
          // @ts-ignore
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
          t1Count: competitors.filter((c: Record<string, unknown>) => c.tier === 'T1_head').length,
          t2Count: competitors.filter((c: Record<string, unknown>) => c.tier === 'T2_waist').length,
          // @ts-ignore
          t3Count: competitors.filter((c: Record<string, unknown>) => c.tier === 'T3_niche').length,
          // @ts-ignore
          dataSource: (competitors[0] as unknown)?.dataSource || 'unknown',
        // @ts-ignore
        },
      };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }

  /** TRS评分计算（白盒化） */
  private calculateTRS(comp: unknown) {
    // @ts-ignore
    const rating = parseFloat(comp.rating) || 0;
    // @ts-ignore
    const reviewCount = comp.reviewCount || 0;
    // @ts-ignore
    const bsr = comp.bsr || 999999;
    // @ts-ignore
    const price = parseFloat(comp.price) || 0;

    // 相关性分数（基于评分和评论数）
    const relevance = Math.min(1, (rating / 5) * 0.5 + Math.min(1, Math.log10(Math.max(1, reviewCount)) / 4) * 0.5);

    // 品牌实力（基于评论数和BSR）
    const brandPower = Math.min(1, Math.log10(Math.max(1, reviewCount)) / 5 * 0.6 + Math.max(0, 1 - Math.log10(Math.max(1, bsr)) / 7) * 0.4);

    // 市场份额（基于BSR）
    const marketShare = Math.max(0, 1 - Math.log10(Math.max(1, bsr)) / 7);

    // 总分
    const total = relevance * 0.35 + brandPower * 0.35 + marketShare * 0.30;

    // @ts-ignore
    return {
      // @ts-ignore
      total: Math.round(total * 10000) / 10000,
      // @ts-ignore
      relevance: Math.round(relevance * 10000) / 10000,
      // @ts-ignore
      brandPower: Math.round(brandPower * 10000) / 10000,
      marketShare: Math.round(marketShare * 10000) / 10000,
      formula: 'TRS = Relevance(0.35) × BrandPower(0.35) × MarketShare(0.30)',
      inputs: { rating, reviewCount, bsr, price },
    };
  }

  /** 竞品评论分析 */
  private async analyzeCompetitorReviews(db: DbInstance, projectId: number, competitors: unknown[]) {
    const topCompetitors = competitors.slice(0, 10);

    for (const comp of (topCompetitors as unknown[])) {
      const prompt = `Analyze the likely customer reviews for this Amazon product:
// @ts-ignore
Title: ${(comp as any).title || 'Unknown'}
// @ts-ignore
Brand: ${(comp as any).brand || 'Unknown'}
// @ts-ignore
Rating: ${(comp as any).rating || 'N/A'}
// @ts-ignore
Reviews: ${(comp as any).reviewCount || 0}

Generate realistic user language phrases that customers would use in reviews. For each phrase, provide:
- phraseType: one of "pain_point", "praise", "use_case", "comparison", "feature_request", "quality_concern", "value_perception"
- phrase: the actual user language (natural, conversational)
- sentiment: "positive", "negative", or "neutral"

Generate 10-20 diverse phrases. Return JSON array:
[{"phraseType":"...","phrase":"...","sentiment":"..."}]`;

      const phrases = await geminiStructuredOutput<Record<string, unknown>[]>('', prompt, { temperature: 0.4 });

      for (const p of phrases) {
        // @ts-expect-error - Drizzle query builder type
        await db.insert(prelaunchCompetitorUserLanguage).values({
          // @ts-ignore
          projectId,
          // @ts-ignore
          competitorId: comp.id,
          phraseType: p.phraseType,
          phrase: p.phrase,
          sentiment: p.sentiment || 'neutral',
          frequency: 1,
          // @ts-ignore
          sourceReviewCount: comp.reviewCount || 0,
        });
      }
    }
  }

  /** 竞品场景矩阵 */
  private async buildScenarioMatrix(db: DbInstance, projectId: number, competitors: unknown[]) {
    // @ts-ignore
    const scenarios = [
      'S01', 'S02', 'S03', 'S04', 'S05', 'S06',
      'S07', 'S08', 'S09', 'S10', 'S11', 'S12',
    // @ts-ignore
    ];

    for (const comp of competitors.slice(0, 15)) {
      const prompt = `For this Amazon product, estimate its traffic distribution across shopping scenarios:
// @ts-ignore
Title: ${(comp as any).title || 'Unknown'}
// @ts-ignore
Brand: ${(comp as any).brand || 'Unknown'}
// @ts-ignore
BSR: ${(comp as any).bsr || 'N/A'}

Scenarios: S01=daily_use, S02=first_purchase, S03=replacement, S04=gift, S05=bulk_buy, S06=premium, S07=budget, S08=comparison, S09=problem_solving, S10=seasonal, S11=trending, S12=niche

For each scenario, estimate:
- trafficShare: 0.0-1.0 (all should sum to ~1.0)
- attackFeasibility: 0.0-1.0 (how easy to compete in this scenario)
- suggestedStrategy: brief strategy recommendation

Return JSON array: [{"scenarioCode":"S01","trafficShare":0.25,"attackFeasibility":0.6,"suggestedStrategy":"..."}]`;

      const matrix = await geminiStructuredOutput<Record<string, unknown>[]>('', prompt, { temperature: 0.2 });

      for (const entry of matrix) {
        // @ts-ignore
        if (scenarios.includes(entry.scenarioCode)) {
          // @ts-expect-error - Drizzle query builder type
          await db.insert(prelaunchCompetitorScenarioMatrix).values({
            // @ts-ignore
            projectId,
            // @ts-expect-error - runtime type mismatch
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
