// Extracted from production dist/index.js
// Original module: server/prelaunch/services/m4x-copy.ts
// Lines: 266

var m4x_copy_exports = {};
__export(m4x_copy_exports, {
  M4XCopyService: () => M4XCopyService
});
var M4XCopyService;
var init_m4x_copy = __esm({
  "server/prelaunch/services/m4x-copy.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_gemini();
    M4XCopyService = class {
      static {
        __name(this, "M4XCopyService");
      }
      async getCopyVersions(projectId, generation) {
        const db = await getDb();
        if (!db) return { success: false, data: [] };
        try {
          const conditions = [eq(prelaunchCopyVersions.projectId, projectId)];
          if (generation !== void 0) conditions.push(eq(prelaunchCopyVersions.generation, generation));
          const data = await db.select().from(prelaunchCopyVersions).where(and(...conditions)).orderBy(desc(prelaunchCopyVersions.fitnessScore));
          return { success: true, data };
        } catch (error48) {
          return { success: false, error: error48.message, data: [] };
        }
      }
      async getQnaSeeds(projectId) {
        const db = await getDb();
        if (!db) return { success: false, data: [] };
        try {
          const data = await db.select().from(prelaunchQnaSeeds).where(eq(prelaunchQnaSeeds.projectId, projectId));
          return { success: true, data };
        } catch (error48) {
          return { success: false, error: error48.message, data: [] };
        }
      }
      /** 生成初始文案（Gen-0） */
      async generateInitialCopy(projectId) {
        const db = await getDb();
        if (!db) return { success: false, error: "Database not available" };
        try {
          const keywords10 = await db.select().from(prelaunchKeywords).where(eq(prelaunchKeywords.projectId, projectId));
          const personas = await db.select().from(prelaunchPersonas).where(eq(prelaunchPersonas.projectId, projectId));
          const cosmoTriples = await db.select().from(prelaunchCosmoTriples).where(eq(prelaunchCosmoTriples.projectId, projectId));
          const userLanguage = await db.select().from(prelaunchCompetitorUserLanguage).where(eq(prelaunchCompetitorUserLanguage.projectId, projectId));
          const coreKws = keywords10.filter((k) => k.relevanceLayer === "core").slice(0, 20);
          const extKws = keywords10.filter((k) => k.relevanceLayer === "extended").slice(0, 15);
          const painPhrases = userLanguage.filter((u) => u.sentiment === "negative").slice(0, 10);
          const praisePhrases = userLanguage.filter((u) => u.sentiment === "positive").slice(0, 10);
          const copyTypes = ["title", "bullet_points", "description", "backend_keywords", "a_plus"];
          for (const copyType of copyTypes) {
            const prompt = this.buildCopyPrompt(copyType, {
              coreKeywords: coreKws.map((k) => k.keyword),
              extendedKeywords: extKws.map((k) => k.keyword),
              personas: personas.map((p) => ({ name: p.personaName, painPoints: p.painPoints })),
              cosmoTriples: cosmoTriples.slice(0, 10).map((t2) => ({
                cause: t2.causeNode,
                effect: t2.effectNode,
                outcome: t2.outcomeNode
              })),
              painPhrases: painPhrases.map((p) => p.phrase),
              praisePhrases: praisePhrases.map((p) => p.phrase)
            });
            const result = await geminiStructuredOutput("", prompt, { temperature: 0.5 });
            await db.insert(prelaunchCopyVersions).values({
              // @ts-expect-error - runtime type mismatch
              projectId,
              generation: 0,
              copyType,
              title: result.title || null,
              bulletPoints: result.bulletPoints ? JSON.stringify(result.bulletPoints) : null,
              description: result.description || null,
              backendKeywords: result.backendKeywords || null,
              aPlus: result.aPlus ? JSON.stringify(result.aPlus) : null,
              fitnessScore: "0.5",
              parentId: null,
              mutationLog: JSON.stringify({ source: "gen0_initial", timestamp: (/* @__PURE__ */ new Date()).toISOString() })
            });
          }
          await this.generateQnaSeeds(db, projectId, cosmoTriples, keywords10);
          return { success: true, generation: 0 };
        } catch (error48) {
          return { success: false, error: error48.message };
        }
      }
      /** 触发文案进化（下一代） */
      async evolveNextGeneration(projectId) {
        const db = await getDb();
        if (!db) return { success: false, error: "Database not available" };
        try {
          const currentVersions = await db.select().from(prelaunchCopyVersions).where(eq(prelaunchCopyVersions.projectId, projectId)).orderBy(desc(prelaunchCopyVersions.generation));
          if (currentVersions.length === 0) {
            return { success: false, error: "No existing copy versions. Run initial generation first." };
          }
          const currentGen = currentVersions[0].generation || 0;
          const nextGen = currentGen + 1;
          const feedback = await db.select().from(prelaunchCopyFeedback).where(eq(prelaunchCopyFeedback.projectId, projectId));
          const bestByType = /* @__PURE__ */ new Map();
          for (const v of currentVersions) {
            if (!bestByType.has(v.copyType)) {
              bestByType.set(v.copyType, v);
            }
          }
          for (const [copyType, parent] of bestByType) {
            const feedbackSummary = feedback.filter((f) => f.copyVersionId === parent.id).map((f) => `${f.signalType}: ${f.metricName}=${f.metricValue}`).join(", ");
            const prompt = `You are an Amazon listing copywriting evolution engine.

// @ts-ignore
PARENT COPY (Gen-${currentGen}, Fitness: ${parent.fitnessScore}):
// @ts-ignore
Type: ${copyType}
// @ts-ignore
Title: ${parent.title || "N/A"}
// @ts-ignore
Bullets: ${parent.bulletPoints || "N/A"}
// @ts-ignore
Description: ${parent.description || "N/A"}

PERFORMANCE FEEDBACK:
${feedbackSummary || "No feedback data yet - apply general optimization heuristics"}

MUTATION INSTRUCTIONS:
1. Identify the weakest elements based on feedback
2. Apply ONE of these mutation strategies: keyword_injection, emotional_amplification, benefit_reframing, structure_reorganization, specificity_boost
3. Keep the strongest elements unchanged
4. Ensure all core keywords are preserved

Return the evolved copy as JSON with the same structure as the parent, plus:
- mutationStrategy: which strategy was applied
- mutationReason: why this mutation was chosen
- expectedImprovement: what metric should improve

Return JSON: {"title":"...","bulletPoints":[...],"description":"...","backendKeywords":"...","aPlus":null,"mutationStrategy":"...","mutationReason":"...","expectedImprovement":"..."}`;
            const evolved = await geminiStructuredOutput("", prompt, { temperature: 0.6 });
            await db.insert(prelaunchCopyVersions).values({
              // @ts-ignore
              projectId,
              // @ts-ignore
              generation: nextGen,
              // @ts-ignore
              copyType,
              // @ts-ignore
              title: evolved.title || parent.title,
              // @ts-ignore
              bulletPoints: evolved.bulletPoints ? JSON.stringify(evolved.bulletPoints) : parent.bulletPoints,
              // @ts-ignore
              description: evolved.description || parent.description,
              // @ts-ignore
              backendKeywords: evolved.backendKeywords || parent.backendKeywords,
              // @ts-ignore
              aPlus: evolved.aPlus ? JSON.stringify(evolved.aPlus) : parent.aPlus,
              // @ts-ignore
              fitnessScore: String(parseFloat(parent.fitnessScore || "0.5") + 0.02),
              // @ts-ignore
              parentId: parent.id,
              mutationLog: JSON.stringify({
                strategy: evolved.mutationStrategy,
                reason: evolved.mutationReason,
                expectedImprovement: evolved.expectedImprovement,
                timestamp: (/* @__PURE__ */ new Date()).toISOString()
              })
            });
          }
          return { success: true, generation: nextGen };
        } catch (error48) {
          return { success: false, error: error48.message };
        }
      }
      /** 生成Rufus Q&A种子 */
      async generateQnaSeeds(db, projectId, cosmoTriples, keywords10) {
        const prompt = `Generate Amazon Rufus-optimized Q&A pairs based on these COSMO cause-effect-outcome triples and keywords.

COSMO TRIPLES:
// @ts-ignore
${cosmoTriples.slice(0, 15).map(((t2) => `${t2.causeNode} \u2192 ${t2.effectNode} \u2192 ${t2.outcomeNode}`)).join("\n")}

CORE KEYWORDS:
// @ts-ignore
${keywords10.filter(((k) => k.relevanceLayer === "core")).slice(0, 20).map(((k) => k.keyword)).join(", ")}

Generate 10-20 Q&A pairs that:
1. Address common customer questions
2. Incorporate COSMO causal logic (pain \u2192 solution \u2192 benefit)
3. Use natural conversational language
4. Include relevant keywords naturally

Return JSON: [{"question":"...","answer":"...","sourceType":"cosmo_triple|keyword_faq|competitor_gap"}]`;
        const qnas = await geminiStructuredOutput("", prompt, { temperature: 0.4 });
        for (const qna of qnas) {
          await db.insert(prelaunchQnaSeeds).values({
            // @ts-ignore
            projectId,
            // @ts-ignore
            question: qna.question,
            answer: qna.answer,
            sourceType: qna.sourceType || "cosmo_triple"
            // @ts-ignore
          });
        }
      }
      /** 构建文案生成Prompt */
      buildCopyPrompt(copyType, context) {
        const base = `You are an expert Amazon listing copywriter. Use the following data to create optimized copy.

// @ts-ignore
CORE KEYWORDS (must include): ${context.coreKeywords.join(", ")}
// @ts-ignore
EXTENDED KEYWORDS (include where natural): ${context.extendedKeywords.join(", ")}

BUYER PERSONAS:
// @ts-ignore
${context.personas.map((p) => `- ${p.name}: Pain points: ${JSON.stringify(p.painPoints)}`).join("\n")}

COSMO CAUSAL CHAINS (use for persuasion logic):
// @ts-ignore
${context.cosmoTriples.map((t2) => `${t2.cause} \u2192 ${t2.effect} \u2192 ${t2.outcome}`).join("\n")}

// @ts-ignore
REAL USER LANGUAGE (pain points): ${context.painPhrases.join("; ")}
// @ts-ignore
REAL USER LANGUAGE (praises): ${context.praisePhrases.join("; ")}`;
        switch (copyType) {
          case "title":
            return `${base}

Generate an Amazon product title (max 200 chars). Include the most important keywords naturally. Follow Amazon's title formula: Brand + Key Feature + Product Type + Size/Quantity + Color/Variant.

Return JSON: {"title":"..."}`;
          case "bullet_points":
            return `${base}

Generate 5 Amazon bullet points. Each bullet should: start with a CAPITALIZED benefit header, address a specific pain point, include relevant keywords, use COSMO logic (problem\u2192solution\u2192benefit).

Return JSON: {"bulletPoints":["bullet1","bullet2","bullet3","bullet4","bullet5"]}`;
          case "description":
            return `${base}

Generate an Amazon product description (500-1000 words). Use HTML formatting (<b>, <br>, <ul>). Structure: Hook \u2192 Problem \u2192 Solution \u2192 Benefits \u2192 Social Proof \u2192 CTA.

Return JSON: {"description":"..."}`;
          case "backend_keywords":
            return `${base}

Generate Amazon backend search terms (max 249 bytes). Include: misspellings, synonyms, Spanish translations, related terms NOT in the listing. No commas, no repeated words.

Return JSON: {"backendKeywords":"..."}`;
          case "a_plus":
            return `${base}

Design an A+ Content layout with 5-7 modules. For each module: type (hero_banner, comparison_chart, feature_highlight, brand_story, specs_table), headline, body text, image description.

Return JSON: {"aPlus":[{"type":"...","headline":"...","body":"...","imageDescription":"..."}]}`;
          default:
            return `${base}

Generate optimized Amazon listing copy.

Return JSON: {"title":"...","bulletPoints":[],"description":"..."}`;
        }
      }
    };
  }
});

