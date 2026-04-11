// Extracted from production dist/index.js
// Original module: server/prelaunch/services/m1-keywords.ts
// Lines: 244

var m1_keywords_exports = {};
__export(m1_keywords_exports, {
  M1KeywordService: () => M1KeywordService
});
var M1KeywordService;
var init_m1_keywords = __esm({
  "server/prelaunch/services/m1-keywords.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_gemini();
    M1KeywordService = class {
      static {
        __name(this, "M1KeywordService");
      }
      async getKeywords(input) {
        const db = await getDb();
        if (!db) return { success: false, data: [], total: 0 };
        try {
          const conditions = [eq(prelaunchKeywords.projectId, input.projectId)];
          if (input.relevanceLayer) conditions.push(eq(prelaunchKeywords.relevanceLayer, input.relevanceLayer));
          if (input.scenarioCode) conditions.push(eq(prelaunchKeywords.scenarioCode, input.scenarioCode));
          if (input.clusterId) conditions.push(eq(prelaunchKeywords.clusterId, input.clusterId));
          const page = input.page ?? 1;
          const pageSize = input.pageSize ?? 50;
          const data = await db.select().from(prelaunchKeywords).where(and(...conditions)).orderBy(desc(prelaunchKeywords.kviScore)).limit(pageSize).offset((page - 1) * pageSize);
          const [countResult] = await db.select({ count: sql`COUNT(*)` }).from(prelaunchKeywords).where(and(...conditions));
          return { success: true, data, total: countResult?.count ?? 0, page, pageSize };
        } catch (error48) {
          return { success: false, error: error48.message, data: [], total: 0 };
        }
      }
      async getClusters(projectId) {
        const db = await getDb();
        if (!db) return { success: false, data: [] };
        try {
          const data = await db.select().from(prelaunchKeywordClusters).where(eq(prelaunchKeywordClusters.projectId, projectId)).orderBy(desc(prelaunchKeywordClusters.avgKvi));
          return { success: true, data };
        } catch (error48) {
          return { success: false, error: error48.message, data: [] };
        }
      }
      async getRelations(projectId) {
        const db = await getDb();
        if (!db) return { success: false, data: [] };
        try {
          const data = await db.select().from(prelaunchKeywordRelations).where(eq(prelaunchKeywordRelations.projectId, projectId)).orderBy(desc(prelaunchKeywordRelations.strength));
          return { success: true, data };
        } catch (error48) {
          return { success: false, error: error48.message, data: [] };
        }
      }
      async getCosmoTriples(projectId) {
        const db = await getDb();
        if (!db) return { success: false, data: [] };
        try {
          const data = await db.select().from(prelaunchCosmoTriples).where(eq(prelaunchCosmoTriples.projectId, projectId)).orderBy(desc(prelaunchCosmoTriples.confidence));
          return { success: true, data };
        } catch (error48) {
          return { success: false, error: error48.message, data: [] };
        }
      }
      /** 运行M1完整流水线 */
      async runPipeline(projectId, seedKeywords, marketplace) {
        const db = await getDb();
        if (!db) return { success: false, error: "Database not available" };
        try {
          const expandedKeywords = await this.expandKeywords(seedKeywords, marketplace);
          const classifiedKeywords = await this.classifyKeywords(expandedKeywords, seedKeywords);
          const scoredKeywords = classifiedKeywords.map((kw) => ({
            ...kw,
            kviScore: this.calculateKVI(kw)
          }));
          const insertData = scoredKeywords.map((kw) => ({
            projectId,
            // @ts-expect-error - runtime type mismatch
            keyword: kw.keyword,
            // @ts-expect-error - runtime type mismatch
            searchVolume: kw.searchVolume || 0,
            // @ts-expect-error - type assertion
            relevanceLayer: kw.relevanceLayer,
            // @ts-expect-error - runtime type mismatch
            dimensionType: kw.dimensionType,
            // @ts-expect-error - runtime type mismatch
            scenarioCode: kw.scenarioCode,
            // @ts-expect-error - runtime type mismatch
            intentTag: kw.intentTag,
            kviScore: String(kw.kviScore),
            // @ts-expect-error - runtime type mismatch
            kviVolume: String(kw.kviVolume || 0),
            // @ts-expect-error - runtime type mismatch
            kviRelevance: String(kw.kviRelevance || 0),
            // @ts-expect-error - runtime type mismatch
            kviOpportunity: String(kw.kviOpportunity || 0),
            dataSource: "gemini_expansion"
          }));
          if (insertData.length > 0) {
            for (let i = 0; i < insertData.length; i += 100) {
              const batch = insertData.slice(i, i + 100);
              await db.insert(prelaunchKeywords).values(batch);
            }
          }
          await this.runClustering(db, projectId);
          await this.generateCosmoTriples(db, projectId, scoredKeywords);
          await db.update(prelaunchProjects).set({ status: "running" }).where(eq(prelaunchProjects.id, projectId));
          return {
            success: true,
            summary: {
              totalKeywords: insertData.length,
              coreKeywords: insertData.filter((k) => k.relevanceLayer === "core").length,
              extendedKeywords: insertData.filter((k) => k.relevanceLayer === "extended").length,
              longTailKeywords: insertData.filter((k) => k.relevanceLayer === "long_tail").length
            }
          };
        } catch (error48) {
          return { success: false, error: error48.message };
        }
      }
      /** 使用Gemini扩展种子词 */
      async expandKeywords(seedKeywords, marketplace) {
        const prompt = `You are an Amazon keyword research expert. Given these seed keywords for the ${marketplace} marketplace:
${seedKeywords.join(", ")}

Generate a comprehensive keyword list of 80-150 keywords. For each keyword, provide:
- keyword: the search term
- searchVolume: estimated monthly search volume (integer)
- competitorDensity: number of competing products (integer, 1-999)
- avgPrice: average product price in USD

Include: core product keywords, long-tail variations, problem/pain-point keywords, benefit keywords, comparison keywords, use-case keywords, demographic keywords, seasonal keywords.

Return as JSON array: [{"keyword":"...","searchVolume":...,"competitorDensity":...,"avgPrice":...}]`;
        return geminiStructuredOutput("", prompt, { temperature: 0.4 });
      }
      /** 四维分类 */
      async classifyKeywords(keywords10, seedKeywords) {
        const batchSize = 30;
        const results = [];
        for (let i = 0; i < keywords10.length; i += batchSize) {
          const batch = keywords10.slice(i, i + batchSize);
          const prompt = `Classify these Amazon keywords relative to the product defined by seeds: [${seedKeywords.join(", ")}]

For each keyword, determine:
1. relevanceLayer: "core" (directly describes product), "extended" (related attributes/use-cases), "long_tail" (specific niche queries), "irrelevant"
2. dimensionType: one of "product_attribute", "audience", "scenario", "brand", "pain_point", "benefit", "comparison", "seasonal"
3. scenarioCode: S01-S24 scenario code (S01=daily_use, S02=first_purchase, S03=replacement, S04=gift, S05=bulk_buy, S06=premium, S07=budget, S08=comparison, S09=problem_solving, S10=seasonal, S11=trending, S12=niche, S13-S24=other)
4. intentTag: "informational", "navigational", "commercial", "transactional"

Keywords to classify:
// @ts-ignore
${batch.map(((k) => k.keyword)).join("\n")}

Return JSON array: [{"keyword":"...","relevanceLayer":"...","dimensionType":"...","scenarioCode":"...","intentTag":"..."}]`;
          const classified = await geminiStructuredOutput("", prompt, { temperature: 0.1 });
          for (const cls of classified) {
            const original = batch.find((k) => k.keyword === cls.keyword);
            if (original) {
              results.push({ ...original, ...cls });
            }
          }
        }
        return results;
      }
      /** 计算KVI评分 */
      // @ts-ignore
      calculateKVI(kw) {
        const volumeScore = Math.min(1, Math.log10(Math.max(1, kw.searchVolume || 1)) / 5);
        const relevanceScore = kw.relevanceLayer === "core" ? 1 : kw.relevanceLayer === "extended" ? 0.7 : kw.relevanceLayer === "long_tail" ? 0.4 : 0.1;
        const opportunityScore = kw.competitorDensity ? Math.max(0, 1 - kw.competitorDensity / 1e3) : 0.5;
        const kvi = volumeScore * 0.35 + relevanceScore * 0.4 + opportunityScore * 0.25;
        return Math.round(kvi * 1e4) / 1e4;
      }
      /** 聚类分析 */
      async runClustering(db, projectId) {
        const allKeywords = await db.select().from(prelaunchKeywords).where(eq(prelaunchKeywords.projectId, projectId));
        if (allKeywords.length === 0) return;
        const kwList = allKeywords.map((k) => k.keyword).join("\n");
        const prompt = `Group these Amazon keywords into semantic clusters based on user intent. Each cluster should represent a distinct search intent or product need.

Keywords:
${kwList}

Return JSON: [{"clusterLabel":"descriptive label","intentSummary":"what users in this cluster want","members":["keyword1","keyword2",...]}]
Create 5-15 clusters. Every keyword must belong to exactly one cluster.`;
        const clusters = await geminiStructuredOutput("", prompt, { temperature: 0.2 });
        for (const cluster of clusters) {
          const [result] = await db.insert(prelaunchKeywordClusters).values({
            // @ts-ignore
            projectId,
            clusterLabel: cluster.clusterLabel,
            intentSummary: cluster.intentSummary,
            // @ts-ignore
            memberCount: cluster.members?.length || 0,
            avgKvi: "0",
            topScenario: "S01"
          });
          const clusterId = result.insertId;
          if (cluster.members && clusterId) {
            for (const member of cluster.members) {
              await db.update(prelaunchKeywords).set({ clusterId }).where(and(
                eq(prelaunchKeywords.projectId, projectId),
                eq(prelaunchKeywords.keyword, member)
              ));
            }
          }
        }
      }
      /** 生成COSMO因果链三元组 */
      async generateCosmoTriples(db, projectId, keywords10) {
        const coreKeywords = keywords10.filter((k) => k.relevanceLayer === "core" || k.relevanceLayer === "extended").slice(0, 50);
        if (coreKeywords.length === 0) return;
        const prompt = `Based on these Amazon product keywords, generate COSMO (Common Sense Model) cause-effect-outcome triples that represent the customer's decision-making logic.

// @ts-ignore
Keywords: ${coreKeywords.map((k) => k.keyword).join(", ")}

For each triple:
// @ts-ignore
- causeNode: The trigger/pain point/need (e.g., "leaky water bottle lid")
- effectNode: The solution/action (e.g., "search for replacement lid")
- outcomeNode: The desired result (e.g., "no more spills, save money")
- relationLabel: The type of causal relationship
- confidence: 0.0-1.0

Generate 10-30 high-quality triples. Return JSON array:
[{"causeNode":"...","effectNode":"...","outcomeNode":"...","relationLabel":"...","confidence":0.85}]`;
        const triples = await geminiStructuredOutput("", prompt, { temperature: 0.3 });
        for (const triple of triples) {
          await db.insert(prelaunchCosmoTriples).values({
            // @ts-ignore
            projectId,
            causeNode: triple.causeNode,
            effectNode: triple.effectNode,
            outcomeNode: triple.outcomeNode || "",
            relationLabel: triple.relationLabel || "causes",
            confidence: String(triple.confidence || 0.5)
          });
        }
      }
    };
  }
});

