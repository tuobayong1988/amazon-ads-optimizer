// Extracted from production dist/index.js
// Original module: server/prelaunch/services/m3-persona.ts
// Lines: 103

var m3_persona_exports = {};
__export(m3_persona_exports, {
  M3PersonaService: () => M3PersonaService
});
var M3PersonaService;
var init_m3_persona = __esm({
  "server/prelaunch/services/m3-persona.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_gemini();
    M3PersonaService = class {
      static {
        __name(this, "M3PersonaService");
      }
      async getPersonas(projectId) {
        const db = await getDb();
        if (!db) return { success: false, data: [] };
        try {
          const data = await db.select().from(prelaunchPersonas).where(eq(prelaunchPersonas.projectId, projectId)).orderBy(desc(prelaunchPersonas.confidence));
          return { success: true, data };
        } catch (error48) {
          return { success: false, error: error48.message, data: [] };
        }
      }
      /** 运行M3用户画像生成流水线 */
      async runPipeline(projectId) {
        const db = await getDb();
        if (!db) return { success: false, error: "Database not available" };
        try {
          const keywords10 = await db.select().from(prelaunchKeywords).where(eq(prelaunchKeywords.projectId, projectId));
          const competitors = await db.select().from(prelaunchCompetitors).where(eq(prelaunchCompetitors.projectId, projectId));
          const userLanguage = await db.select().from(prelaunchCompetitorUserLanguage).where(eq(prelaunchCompetitorUserLanguage.projectId, projectId));
          const kwSummary = keywords10.slice(0, 50).map((k) => `${k.keyword} (${k.dimensionType}, ${k.scenarioCode})`).join("\n");
          const painPoints = userLanguage.filter((u) => u.phraseType === "pain_point").map((u) => u.phrase).slice(0, 20).join("\n");
          const praises = userLanguage.filter((u) => u.phraseType === "praise").map((u) => u.phrase).slice(0, 20).join("\n");
          const prompt = `Based on Amazon product keyword data and customer review analysis, create 3-5 distinct buyer personas.

KEYWORD DATA (top 50):
${kwSummary}

CUSTOMER PAIN POINTS:
${painPoints || "No data available"}

CUSTOMER PRAISES:
${praises || "No data available"}

COMPETITOR LANDSCAPE:
${competitors.slice(0, 10).map((c) => `${c.brand}: ${c.title} ($${c.price}, ${c.rating}\u2605, ${c.reviewCount} reviews)`).join("\n")}

For each persona, provide:
- personaName: descriptive name (e.g., "Budget-Conscious Mom")
- demographics: {ageRange, gender, income, location, education}
- psychographics: {values, lifestyle, personality}
- buyingBehavior: {priceRange, purchaseFrequency, researchDepth, decisionFactors}
- painPoints: [list of specific pain points]
- motivations: [list of purchase motivations]
- preferredChannels: [where they discover products]
- confidence: 0.0-1.0

Return JSON array of personas.`;
          const personas = await geminiStructuredOutput("", prompt, { temperature: 0.4 });
          for (const persona of personas) {
            const narrativePrompt = `Write a 150-word narrative profile for this Amazon buyer persona:
Name: ${persona.personaName}
Demographics: ${JSON.stringify(persona.demographics)}
Pain Points: ${JSON.stringify(persona.painPoints)}
Motivations: ${JSON.stringify(persona.motivations)}

Write in first person, as if this persona is describing their shopping experience and needs. Make it vivid and actionable for copywriters.`;
            const narrative = await geminiStructuredOutput(
              "",
              `${narrativePrompt}

Return JSON: {"narrative":"..."}`,
              { temperature: 0.6 }
            );
            await db.insert(prelaunchPersonas).values({
              projectId,
              personaName: persona.personaName,
              demographics: JSON.stringify(persona.demographics),
              psychographics: JSON.stringify(persona.psychographics),
              buyingBehavior: JSON.stringify(persona.buyingBehavior),
              painPoints: JSON.stringify(persona.painPoints),
              motivations: JSON.stringify(persona.motivations),
              preferredChannels: JSON.stringify(persona.preferredChannels),
              narrativeProfile: narrative?.narrative || "",
              confidence: String(persona.confidence || 0.7)
            });
          }
          return {
            success: true,
            summary: { personaCount: personas.length }
          };
        } catch (error48) {
          return { success: false, error: error48.message };
        }
      }
    };
  }
});

