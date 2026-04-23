/**
 * M2 竞品库引擎服务
 * 竞品发现 → 属性过滤 → TRS评分(白盒化) → 评论分析 → 场景矩阵 → 用户语言库
 * 
 * v2.0 更新：集成 Oxylabs Amazon Scraper API 作为真实数据源，
 * 替代原有的 Gemini AI 模拟数据。当 Oxylabs 不可用时，自动回退到 Gemini。
 * 
 * v3.0 更新：集成 M1B 属性维度过滤。在竞品发现后、TRS评分前，
 * 基于搜索行为属性分析结果对竞品进行动态过滤/降级。
 * 只有当用户搜索行为中某属性维度的携带率达到阈值时，
 * 该维度才会成为竞品过滤条件。
 * 
 * v3.1 优化：
 * - P0-2: 使用竞品自身数据（title + bullet_points + description）进行属性匹配，
 *         替代原来使用项目关键词的方式，大幅提高匹配准确率
 * - P1-1: 增加最小竞品保留数安全阀，防止属性过滤后竞品池过小导致广告覆盖面不足
 */
import { getDb, type DbInstanceNonNull } from '../../db';
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
import { M1BAttributeAnalysisService, type AttributeAnalysisResult, type AttributeDimension, type CompetitorOwnData } from './m1b-attribute-analysis';
import { createModuleLogger } from '../../utils/logger';

const log = createModuleLogger('M2-Competitors');

/**
 * v3.1 P1-1: 最小竞品保留数安全阀
 * 
 * 属性过滤后，至少保留此数量的竞品。
 * 如果过滤后剩余竞品数低于此值，将按 mismatch 严重程度从轻到重
 * 逐步恢复被过滤的竞品（标记为 demoted 而非 removed）。
 */
const MIN_COMPETITORS_AFTER_FILTER = 8;

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
      // @ts-expect-error Dynamic type assertion
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
    const dbRaw = await getDb();
    if (!dbRaw) return { success: false, error: 'Database not available' };
    const db = dbRaw!;

    try {
      let asins = competitorAsins || [];

      // ─── Step 0: 加载 M1B 属性分析结果 ──────────────────────────
      const m1bService = new M1BAttributeAnalysisService();
      const attributeAnalysis = await m1bService.getAnalysisResult(projectId);
      const hasAttributeFilter = attributeAnalysis && attributeAnalysis.activeFilterDimensions.length > 0;

      if (hasAttributeFilter) {
        log.info(`[M2] Attribute filter active. Dimensions: [${attributeAnalysis!.activeFilterDimensions.join(', ')}]`);
      } else {
        log.info(`[M2] No attribute filter active — all competitors will be accepted by default`);
      }

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

            // @ts-expect-error Complex function parameter types
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

// @ts-expect-error Legacy code type compatibility
Return JSON array.`, { temperature: 0.3 });

            // @ts-expect-error Array method type inference
            asins = discovered.map((d: Record<string, unknown>) => d.asin);

            // 写入竞品基础数据（Gemini模拟数据）
            // @ts-expect-error Dynamic type assertion
            for (const comp of (discovered as unknown[])) {
              // @ts-expect-error DB query type inference limitation
              await db.insert(prelaunchCompetitors).values({
                // @ts-expect-error Legacy code type compatibility
                projectId,
                // @ts-expect-error Legacy code type compatibility
                asin: comp.asin,
                // @ts-expect-error Legacy code type compatibility
                title: comp.title,
                // @ts-expect-error Legacy code type compatibility
                brand: comp.brand,
                // @ts-expect-error Legacy code type compatibility
                price: String(comp.estimatedPrice || 0),
                // @ts-expect-error Legacy code type compatibility
                rating: String(comp.estimatedRating || 0),
                // @ts-expect-error Legacy code type compatibility
                reviewCount: comp.estimatedReviewCount || 0,
                // @ts-expect-error Legacy code type compatibility
                bsr: comp.estimatedBsr || 0,
                dataSource: 'gemini_discovery',
              });
            }
          }
        }
      } else if (competitorAsins && competitorAsins.length > 0) {
        // ─── 用户手动指定 ASIN 的路径 ──────────────────────────────
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
          for (const asin of competitorAsins) {
            await db.insert(prelaunchCompetitors).values({
              projectId,
              asin,
              dataSource: 'manual_no_data',
            });
          }
        }
      }

      // ─── Step 1.5: 属性维度过滤（v3.0 新增，v3.1 优化）──────────
      let competitors = await db.select()
        .from(prelaunchCompetitors)
        .where(eq(prelaunchCompetitors.projectId, projectId));

      let attributeFilterSummary = {
        totalBefore: competitors.length,
        filtered: 0,
        demoted: 0,
        passed: 0,
        restored: 0,
        activeFilters: [] as string[],
      };

      if (hasAttributeFilter && competitors.length > 0) {
        const filterResult = await this.applyAttributeFilter(
          db, projectId, competitors, attributeAnalysis!
        );
        attributeFilterSummary = filterResult.summary;

        // 重新加载竞品列表（过滤后的）
        competitors = await db.select()
          .from(prelaunchCompetitors)
          .where(eq(prelaunchCompetitors.projectId, projectId));

        log.info(`[M2] Attribute filter result: ${attributeFilterSummary.filtered} removed, ${attributeFilterSummary.demoted} demoted, ${attributeFilterSummary.passed} passed, ${attributeFilterSummary.restored} restored by safety valve`);
      }

      // Step 2: TRS评分（白盒化）
      for (const comp of (competitors as unknown[])) {
        // @ts-expect-error Type inference limitation
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
          // @ts-expect-error DB query type inference limitation
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
          // @ts-expect-error Dynamic property access
          t1Count: competitors.filter((c: Record<string, unknown>) => c.tier === 'T1_head').length,
          t2Count: competitors.filter((c: Record<string, unknown>) => c.tier === 'T2_waist').length,
          // @ts-expect-error Dynamic property access
          t3Count: competitors.filter((c: Record<string, unknown>) => c.tier === 'T3_niche').length,
          // @ts-expect-error Dynamic type assertion
          dataSource: (competitors[0] as unknown)?.dataSource || 'unknown',
          // v3.0: 属性过滤摘要
          attributeFilter: attributeFilterSummary,
        // @ts-expect-error Legacy code type compatibility
        },
      };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * v3.0 新增，v3.1 重构：应用属性维度过滤
   * 
   * v3.1 P0-2: 使用竞品自身数据（rawData 中的 title, bullet_points, description, product_overview）
   *            替代原来使用项目关键词的方式
   * v3.1 P1-1: 增加最小竞品保留数安全阀
   * 
   * 对每个竞品：
   * - major mismatch → 从竞品列表中移除（删除记录）
   * - minor mismatch → 降级 TRS 评分（通过 raw_data 标记）
   * - 匹配 → 正常保留
   * 
   * 安全阀：如果过滤后剩余竞品数 < MIN_COMPETITORS_AFTER_FILTER，
   * 将按 mismatch 严重程度从轻到重逐步恢复被过滤的竞品。
   */
  private async applyAttributeFilter(
    db: DbInstanceNonNull,
    projectId: number,
    competitors: unknown[],
    analysis: AttributeAnalysisResult
  ): Promise<{
    summary: {
      totalBefore: number;
      filtered: number;
      demoted: number;
      passed: number;
      restored: number;
      activeFilters: string[];
    };
  }> {
    const m1bService = new M1BAttributeAnalysisService();
    const { ownProductAttributes, activeFilterDimensions } = analysis;

    // v3.1 P1-1: 收集所有过滤结果，延迟执行删除，以便安全阀判断
    interface FilterDecision {
      compId: number;
      compAsin: string;
      compTitle: string;
      action: 'remove' | 'demote' | 'pass';
      matchResult: {
        passed: boolean;
        matchDetails: Record<string, unknown>;
        scoreAdjustment: number;
        overallReason: string;
      };
    }

    const decisions: FilterDecision[] = [];

    for (const comp of competitors) {
      const c = comp as Record<string, unknown>;
      const compTitle = String(c.title || '');
      const compAsin = String(c.asin || '');
      const compId = c.id as number;

      // v3.1 P0-2: 从竞品的 rawData 中提取竞品自身信息
      const competitorOwnData = m1bService.extractCompetitorOwnData(c.rawData);

      // v3.1 P0-2: 使用竞品自身数据进行属性匹配检查
      const matchResult = await m1bService.checkCompetitorAttributeMatch(
        compTitle,
        competitorOwnData,
        ownProductAttributes,
        activeFilterDimensions
      );

      if (!matchResult.passed) {
        decisions.push({ compId, compAsin, compTitle, action: 'remove', matchResult });
      } else if (matchResult.scoreAdjustment < 0) {
        decisions.push({ compId, compAsin, compTitle, action: 'demote', matchResult });
      } else {
        decisions.push({ compId, compAsin, compTitle, action: 'pass', matchResult });
      }
    }

    // v3.1 P1-1: 安全阀检查
    const passCount = decisions.filter(d => d.action === 'pass').length;
    const demoteCount = decisions.filter(d => d.action === 'demote').length;
    const removeDecisions = decisions.filter(d => d.action === 'remove');
    const survivorCount = passCount + demoteCount;
    let restored = 0;

    if (survivorCount < MIN_COMPETITORS_AFTER_FILTER && removeDecisions.length > 0) {
      // 需要恢复一些被标记为 remove 的竞品
      const deficit = MIN_COMPETITORS_AFTER_FILTER - survivorCount;
      log.warn(`[M2] Safety valve triggered: only ${survivorCount} competitors survive, need to restore ${deficit} from ${removeDecisions.length} removed`);

      // 按 scoreAdjustment 从高到低排序（即 mismatch 最轻的优先恢复）
      removeDecisions.sort((a, b) => b.matchResult.scoreAdjustment - a.matchResult.scoreAdjustment);

      for (let i = 0; i < Math.min(deficit, removeDecisions.length); i++) {
        removeDecisions[i].action = 'demote';
        // 给恢复的竞品一个更大的降级惩罚
        removeDecisions[i].matchResult.scoreAdjustment = Math.max(-0.8, removeDecisions[i].matchResult.scoreAdjustment - 0.2);
        removeDecisions[i].matchResult.overallReason += ' [RESTORED by safety valve — demoted instead of removed]';
        restored++;
        log.info(`[M2] Safety valve: restored ${removeDecisions[i].compAsin} as demoted (adj=${removeDecisions[i].matchResult.scoreAdjustment})`);
      }
    }

    // 执行过滤决策
    let filtered = 0;
    let demoted = 0;
    let passed = 0;

    for (const decision of decisions) {
      const { compId, compAsin, action, matchResult } = decision;

      if (action === 'remove') {
        // major mismatch → 移除竞品
        await db.delete(prelaunchCompetitors)
          .where(eq(prelaunchCompetitors.id, compId));
        filtered++;
        log.info(`[M2] Competitor ${compAsin} REMOVED: ${matchResult.overallReason}`);

      } else if (action === 'demote') {
        // minor mismatch 或安全阀恢复 → 标记降级
        try {
          await db.execute(sql.raw(`
            UPDATE prelaunch_competitors 
            SET raw_data = JSON_SET(
              COALESCE(raw_data, '{}'),
              '$.attributeFilter', CAST('${JSON.stringify({
                passed: true,
                demoted: true,
                scoreAdjustment: matchResult.scoreAdjustment,
                matchDetails: matchResult.matchDetails,
                reason: matchResult.overallReason,
              }).replace(/'/g, "\\'")}' AS JSON)
            )
            WHERE id = ${compId}
          `));
        } catch {
          // 如果 JSON_SET 失败，使用简单更新
          const existingComp = competitors.find((c: unknown) => (c as Record<string, unknown>).id === compId) as Record<string, unknown> | undefined;
          const existingRaw = typeof existingComp?.rawData === 'string' ? JSON.parse(existingComp.rawData || '{}') : (existingComp?.rawData || {});
          (existingRaw as Record<string, unknown>).attributeFilter = {
            passed: true,
            demoted: true,
            scoreAdjustment: matchResult.scoreAdjustment,
            matchDetails: matchResult.matchDetails,
            reason: matchResult.overallReason,
          };
          await db.update(prelaunchCompetitors)
            .set({ rawData: JSON.stringify(existingRaw) })
            .where(eq(prelaunchCompetitors.id, compId));
        }
        demoted++;
        log.info(`[M2] Competitor ${compAsin} DEMOTED (${matchResult.scoreAdjustment}): ${matchResult.overallReason}`);

      } else {
        // 完全匹配 → 正常保留
        try {
          await db.execute(sql.raw(`
            UPDATE prelaunch_competitors 
            SET raw_data = JSON_SET(
              COALESCE(raw_data, '{}'),
              '$.attributeFilter', CAST('${JSON.stringify({
                passed: true,
                demoted: false,
                scoreAdjustment: 0,
                reason: matchResult.overallReason,
              }).replace(/'/g, "\\'")}' AS JSON)
            )
            WHERE id = ${compId}
          `));
        } catch {
          // 静默忽略标记失败
        }
        passed++;
      }
    }

    return {
      summary: {
        totalBefore: competitors.length,
        filtered,
        demoted,
        passed,
        restored,
        activeFilters: activeFilterDimensions,
      },
    };
  }

  /** TRS评分计算（白盒化）— v3.0 增加属性过滤降级因子 */
  private calculateTRS(comp: unknown) {
    // @ts-expect-error Type inference limitation
    const rating = parseFloat(comp.rating) || 0;
    // @ts-expect-error Type inference limitation
    const reviewCount = comp.reviewCount || 0;
    // @ts-expect-error Type inference limitation
    const bsr = comp.bsr || 999999;
    // @ts-expect-error Type inference limitation
    const price = parseFloat(comp.price) || 0;

    // 相关性分数（基于评分和评论数）
    const relevance = Math.min(1, (rating / 5) * 0.5 + Math.min(1, Math.log10(Math.max(1, reviewCount)) / 4) * 0.5);

    // 品牌实力（基于评论数和BSR）
    const brandPower = Math.min(1, Math.log10(Math.max(1, reviewCount)) / 5 * 0.6 + Math.max(0, 1 - Math.log10(Math.max(1, bsr)) / 7) * 0.4);

    // 市场份额（基于BSR）
    const marketShare = Math.max(0, 1 - Math.log10(Math.max(1, bsr)) / 7);

    // 基础总分
    let total = relevance * 0.35 + brandPower * 0.35 + marketShare * 0.30;

    // v3.0: 应用属性过滤降级因子
    let attributeAdjustment = 0;
    try {
      // @ts-expect-error Type inference limitation
      const rawData = typeof comp.rawData === 'string' ? JSON.parse(comp.rawData || '{}') : (comp.rawData || {});
      if (rawData.attributeFilter?.demoted && rawData.attributeFilter?.scoreAdjustment) {
        attributeAdjustment = rawData.attributeFilter.scoreAdjustment;
        total = Math.max(0, total + attributeAdjustment);
      }
    } catch {
      // 忽略 JSON 解析错误
    }

    // @ts-expect-error Return type compatibility
    return {
      // @ts-expect-error Legacy code type compatibility
      total: Math.round(total * 10000) / 10000,
      // @ts-expect-error Legacy code type compatibility
      relevance: Math.round(relevance * 10000) / 10000,
      // @ts-expect-error Legacy code type compatibility
      brandPower: Math.round(brandPower * 10000) / 10000,
      marketShare: Math.round(marketShare * 10000) / 10000,
      attributeAdjustment,
      formula: 'TRS = Relevance(0.35) × BrandPower(0.35) × MarketShare(0.30) + AttributeAdj',
      inputs: { rating, reviewCount, bsr, price, attributeAdjustment },
    };
  }

  /** 竞品评论分析 */
  private async analyzeCompetitorReviews(db: DbInstanceNonNull, projectId: number, competitors: unknown[]) {
    const topCompetitors = competitors.slice(0, 10);

    for (const comp of (topCompetitors as unknown[])) {
      const prompt = `Analyze the likely customer reviews for this Amazon product:
// @ts-expect-error Dynamic type assertion
Title: ${(comp as any).title || 'Unknown'}
// @ts-expect-error Dynamic type assertion
Brand: ${(comp as any).brand || 'Unknown'}
// @ts-expect-error Dynamic type assertion
Rating: ${(comp as any).rating || 'N/A'}
// @ts-expect-error Dynamic type assertion
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
          // @ts-expect-error Legacy code type compatibility
          projectId,
          // @ts-expect-error Legacy code type compatibility
          competitorId: comp.id,
          phraseType: p.phraseType,
          phrase: p.phrase,
          sentiment: p.sentiment || 'neutral',
          frequency: 1,
          // @ts-expect-error Legacy code type compatibility
          sourceReviewCount: comp.reviewCount || 0,
        });
      }
    }
  }

  /** 竞品场景矩阵 */
  private async buildScenarioMatrix(db: DbInstanceNonNull, projectId: number, competitors: unknown[]) {
    // @ts-expect-error Type inference limitation
    const scenarios = [
      'S01', 'S02', 'S03', 'S04', 'S05', 'S06',
      'S07', 'S08', 'S09', 'S10', 'S11', 'S12',
    // @ts-expect-error Legacy code type compatibility
    ];

    for (const comp of competitors.slice(0, 15)) {
      const prompt = `For this Amazon product, estimate its traffic distribution across shopping scenarios:
// @ts-expect-error Dynamic type assertion
Title: ${(comp as any).title || 'Unknown'}
// @ts-expect-error Dynamic type assertion
Brand: ${(comp as any).brand || 'Unknown'}
// @ts-expect-error Dynamic type assertion
BSR: ${(comp as any).bsr || 'N/A'}

Scenarios: S01=daily_use, S02=first_purchase, S03=replacement, S04=gift, S05=bulk_buy, S06=premium, S07=budget, S08=comparison, S09=problem_solving, S10=seasonal, S11=trending, S12=niche

For each scenario, estimate:
- trafficShare: 0.0-1.0 (all should sum to ~1.0)
- attackFeasibility: 0.0-1.0 (how easy to compete in this scenario)
- suggestedStrategy: brief strategy recommendation

Return JSON array: [{"scenarioCode":"S01","trafficShare":0.25,"attackFeasibility":0.6,"suggestedStrategy":"..."}]`;

      const matrix = await geminiStructuredOutput<Record<string, unknown>[]>('', prompt, { temperature: 0.2 });

      for (const entry of matrix) {
        // @ts-expect-error Complex function parameter types
        if (scenarios.includes(entry.scenarioCode)) {
          // @ts-expect-error - Drizzle query builder type
          await db.insert(prelaunchCompetitorScenarioMatrix).values({
            // @ts-expect-error Legacy code type compatibility
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
