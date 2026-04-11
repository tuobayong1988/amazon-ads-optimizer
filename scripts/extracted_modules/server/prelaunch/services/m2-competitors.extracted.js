// Extracted from production dist/index.js
// Original module: server/prelaunch/services/m2-competitors.ts
// Lines: 334

var m2_competitors_exports = {};
__export(m2_competitors_exports, {
  M2CompetitorService: () => M2CompetitorService
});
var M2CompetitorService;
var init_m2_competitors = __esm({
  "server/prelaunch/services/m2-competitors.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_gemini();
    init_oxylabs();
    M2CompetitorService = class {
      static {
        __name(this, "M2CompetitorService");
      }
      async getCompetitors(input) {
        const db = await getDb();
        if (!db) return { success: false, data: [], total: 0 };
        try {
          const conditions = [eq(prelaunchCompetitors.projectId, input.projectId)];
          if (input.tier) conditions.push(eq(prelaunchCompetitors.tier, input.tier));
          const page = input.page ?? 1;
          const pageSize = input.pageSize ?? 30;
          const data = await db.select().from(prelaunchCompetitors).where(and(...conditions)).orderBy(desc(prelaunchCompetitors.trsScore)).limit(pageSize).offset((page - 1) * pageSize);
          const [countResult] = await db.select({ count: sql`COUNT(*)` }).from(prelaunchCompetitors).where(and(...conditions));
          return { success: true, data, total: countResult?.count ?? 0 };
        } catch (error48) {
          return { success: false, error: error48.message, data: [], total: 0 };
        }
      }
      async getTrsDetail(competitorId) {
        const db = await getDb();
        if (!db) return { success: false };
        try {
          const [comp] = await db.select().from(prelaunchCompetitors).where(eq(prelaunchCompetitors.id, competitorId)).limit(1);
          if (!comp) return { success: false, error: "Competitor not found" };
          return {
            success: true,
            data: {
              ...comp,
              trsBreakdown: comp.trsBreakdown ? typeof comp.trsBreakdown === "string" ? JSON.parse(comp.trsBreakdown) : comp.trsBreakdown : null
            }
          };
        } catch (error48) {
          return { success: false, error: error48.message };
        }
      }
      async getScenarioMatrix(projectId) {
        const db = await getDb();
        if (!db) return { success: false, data: [] };
        try {
          const data = await db.select().from(prelaunchCompetitorScenarioMatrix).where(eq(prelaunchCompetitorScenarioMatrix.projectId, projectId));
          return { success: true, data };
        } catch (error48) {
          return { success: false, error: error48.message, data: [] };
        }
      }
      async getUserLanguage(projectId, competitorId) {
        const db = await getDb();
        if (!db) return { success: false, data: [] };
        try {
          const conditions = [eq(prelaunchCompetitorUserLanguage.projectId, projectId)];
          if (competitorId) conditions.push(eq(prelaunchCompetitorUserLanguage.competitorId, competitorId));
          const data = await db.select().from(prelaunchCompetitorUserLanguage).where(and(...conditions)).orderBy(desc(prelaunchCompetitorUserLanguage.frequency));
          return { success: true, data };
        } catch (error48) {
          return { success: false, error: error48.message, data: [] };
        }
      }
      /** 运行M2完整流水线 */
      async runPipeline(projectId, competitorAsins, autoDiscover = true) {
        const db = await getDb();
        if (!db) return { success: false, error: "Database not available" };
        try {
          let asins = competitorAsins || [];
          if (autoDiscover && asins.length === 0) {
            const keywords10 = await db.select().from(prelaunchKeywords).where(and(
              eq(prelaunchKeywords.projectId, projectId),
              eq(prelaunchKeywords.relevanceLayer, "core")
            )).limit(10);
            if (keywords10.length > 0) {
              const kwList = keywords10.map((k) => k.keyword);
              const oxylabsHealth = await checkServiceHealth();
              if (oxylabsHealth.available) {
                console.log("[M2] Using Oxylabs real data source for competitor discovery");
                const discovered = await discoverCompetitors(kwList, {
                  maxCompetitors: 25,
                  fetchProductDetail: true
                });
                asins = discovered.map((d) => d.asin);
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
                    dataSource: "oxylabs_discovery",
                    rawData: JSON.stringify({
                      searchData: comp.rawSearchData,
                      productData: comp.rawProductData,
                      imageUrl: comp.imageUrl,
                      isSponsored: comp.isSponsored,
                      position: comp.position,
                      salesVolume: comp.salesVolume
                    })
                  });
                }
                console.log(`[M2] Oxylabs discovery complete: ${discovered.length} competitors found`);
              } else {
                console.warn(`[M2] Oxylabs unavailable (${oxylabsHealth.message}), falling back to Gemini`);
                const kwJoined = kwList.join(", ");
                const discovered = await geminiStructuredOutput(
                  "",
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
Return JSON array.`,
                  { temperature: 0.3 }
                );
                asins = discovered.map((d) => d.asin);
                for (const comp of discovered) {
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
                    dataSource: "gemini_discovery"
                  });
                }
              }
            }
          } else if (competitorAsins && competitorAsins.length > 0) {
            const oxylabsHealth = await checkServiceHealth();
            if (oxylabsHealth.available) {
              console.log(`[M2] Fetching details for ${competitorAsins.length} user-specified ASINs via Oxylabs`);
              const detailsMap = await fetchProductDetailsBatch(competitorAsins);
              for (const asin of competitorAsins) {
                const detail = detailsMap.get(asin);
                await db.insert(prelaunchCompetitors).values({
                  projectId,
                  asin,
                  title: detail?.title || "",
                  brand: detail?.brand || detail?.manufacturer || "",
                  price: String(detail?.price || 0),
                  rating: String(detail?.rating || 0),
                  reviewCount: detail?.reviews_count || 0,
                  bsr: detail?.sales_rank?.[0]?.rank || 0,
                  dataSource: detail ? "oxylabs_manual" : "manual_no_data",
                  rawData: detail ? JSON.stringify(detail) : null
                });
              }
            } else {
              for (const asin of competitorAsins) {
                await db.insert(prelaunchCompetitors).values({
                  projectId,
                  asin,
                  dataSource: "manual_no_data"
                });
              }
            }
          }
          const competitors = await db.select().from(prelaunchCompetitors).where(eq(prelaunchCompetitors.projectId, projectId));
          for (const comp of competitors) {
            const trs = this.calculateTRS(comp);
            await db.update(prelaunchCompetitors).set({
              trsScore: String(trs.total),
              trsRelevance: String(trs.relevance),
              trsBrandPower: String(trs.brandPower),
              trsMarketShare: String(trs.marketShare),
              trsBreakdown: JSON.stringify(trs),
              tier: trs.total >= 0.7 ? "T1_head" : trs.total >= 0.4 ? "T2_waist" : "T3_niche"
            }).where(eq(prelaunchCompetitors.id, comp.id));
          }
          await this.analyzeCompetitorReviews(db, projectId, competitors);
          await this.buildScenarioMatrix(db, projectId, competitors);
          return {
            success: true,
            summary: {
              totalCompetitors: competitors.length,
              t1Count: competitors.filter((c) => c.tier === "T1_head").length,
              t2Count: competitors.filter((c) => c.tier === "T2_waist").length,
              // @ts-ignore
              t3Count: competitors.filter((c) => c.tier === "T3_niche").length,
              // @ts-ignore
              dataSource: competitors[0]?.dataSource || "unknown"
              // @ts-ignore
            }
          };
        } catch (error48) {
          return { success: false, error: error48.message };
        }
      }
      /** TRS评分计算（白盒化） */
      calculateTRS(comp) {
        const rating = parseFloat(comp.rating) || 0;
        const reviewCount = comp.reviewCount || 0;
        const bsr = comp.bsr || 999999;
        const price = parseFloat(comp.price) || 0;
        const relevance = Math.min(1, rating / 5 * 0.5 + Math.min(1, Math.log10(Math.max(1, reviewCount)) / 4) * 0.5);
        const brandPower = Math.min(1, Math.log10(Math.max(1, reviewCount)) / 5 * 0.6 + Math.max(0, 1 - Math.log10(Math.max(1, bsr)) / 7) * 0.4);
        const marketShare = Math.max(0, 1 - Math.log10(Math.max(1, bsr)) / 7);
        const total = relevance * 0.35 + brandPower * 0.35 + marketShare * 0.3;
        return {
          // @ts-ignore
          total: Math.round(total * 1e4) / 1e4,
          // @ts-ignore
          relevance: Math.round(relevance * 1e4) / 1e4,
          // @ts-ignore
          brandPower: Math.round(brandPower * 1e4) / 1e4,
          marketShare: Math.round(marketShare * 1e4) / 1e4,
          formula: "TRS = Relevance(0.35) \xD7 BrandPower(0.35) \xD7 MarketShare(0.30)",
          inputs: { rating, reviewCount, bsr, price }
        };
      }
      /** 竞品评论分析 */
      async analyzeCompetitorReviews(db, projectId, competitors) {
        const topCompetitors = competitors.slice(0, 10);
        for (const comp of topCompetitors) {
          const prompt = `Analyze the likely customer reviews for this Amazon product:
// @ts-ignore
Title: ${comp.title || "Unknown"}
// @ts-ignore
Brand: ${comp.brand || "Unknown"}
// @ts-ignore
Rating: ${comp.rating || "N/A"}
// @ts-ignore
Reviews: ${comp.reviewCount || 0}

Generate realistic user language phrases that customers would use in reviews. For each phrase, provide:
- phraseType: one of "pain_point", "praise", "use_case", "comparison", "feature_request", "quality_concern", "value_perception"
- phrase: the actual user language (natural, conversational)
- sentiment: "positive", "negative", or "neutral"

Generate 10-20 diverse phrases. Return JSON array:
[{"phraseType":"...","phrase":"...","sentiment":"..."}]`;
          const phrases = await geminiStructuredOutput("", prompt, { temperature: 0.4 });
          for (const p of phrases) {
            await db.insert(prelaunchCompetitorUserLanguage).values({
              // @ts-ignore
              projectId,
              // @ts-ignore
              competitorId: comp.id,
              phraseType: p.phraseType,
              phrase: p.phrase,
              sentiment: p.sentiment || "neutral",
              frequency: 1,
              // @ts-ignore
              sourceReviewCount: comp.reviewCount || 0
            });
          }
        }
      }
      /** 竞品场景矩阵 */
      async buildScenarioMatrix(db, projectId, competitors) {
        const scenarios = [
          "S01",
          "S02",
          "S03",
          "S04",
          "S05",
          "S06",
          "S07",
          "S08",
          "S09",
          "S10",
          "S11",
          "S12"
          // @ts-ignore
        ];
        for (const comp of competitors.slice(0, 15)) {
          const prompt = `For this Amazon product, estimate its traffic distribution across shopping scenarios:
// @ts-ignore
Title: ${comp.title || "Unknown"}
// @ts-ignore
Brand: ${comp.brand || "Unknown"}
// @ts-ignore
BSR: ${comp.bsr || "N/A"}

Scenarios: S01=daily_use, S02=first_purchase, S03=replacement, S04=gift, S05=bulk_buy, S06=premium, S07=budget, S08=comparison, S09=problem_solving, S10=seasonal, S11=trending, S12=niche

For each scenario, estimate:
- trafficShare: 0.0-1.0 (all should sum to ~1.0)
- attackFeasibility: 0.0-1.0 (how easy to compete in this scenario)
- suggestedStrategy: brief strategy recommendation

Return JSON array: [{"scenarioCode":"S01","trafficShare":0.25,"attackFeasibility":0.6,"suggestedStrategy":"..."}]`;
          const matrix = await geminiStructuredOutput("", prompt, { temperature: 0.2 });
          for (const entry of matrix) {
            if (scenarios.includes(entry.scenarioCode)) {
              await db.insert(prelaunchCompetitorScenarioMatrix).values({
                // @ts-ignore
                projectId,
                // @ts-expect-error - runtime type mismatch
                competitorId: comp.id,
                scenarioCode: entry.scenarioCode,
                trafficShare: String(entry.trafficShare || 0),
                attackFeasibility: String(entry.attackFeasibility || 0),
                suggestedStrategy: entry.suggestedStrategy || ""
              });
            }
          }
        }
      }
    };
  }
});

