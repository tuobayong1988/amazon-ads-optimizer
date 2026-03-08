/**
 * M3 用户画像引擎服务
 * 数据聚合 → Persona维度构建 → LLM叙事生成 → 交叉验证
 */
import { getDb } from '../../db';
import {
  prelaunchPersonas, prelaunchKeywords,
  prelaunchCompetitors, prelaunchCompetitorUserLanguage,
} from '../../../drizzle/schema';
import { eq, desc, and } from 'drizzle-orm';
import { geminiStructuredOutput } from '../gemini';

export class M3PersonaService {

  async getPersonas(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, data: [] };

    try {
      const data = await db.select()
        .from(prelaunchPersonas)
        .where(eq(prelaunchPersonas.projectId, projectId))
        .orderBy(desc(prelaunchPersonas.confidence));
      return { success: true, data };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message, data: [] };
    }
  }

  /** 运行M3用户画像生成流水线 */
  async runPipeline(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      // Step 1: 聚合M1关键词数据
      const keywords = await db.select()
        .from(prelaunchKeywords)
        .where(eq(prelaunchKeywords.projectId, projectId));

      // Step 2: 聚合M2竞品和用户语言数据
      const competitors = await db.select()
        .from(prelaunchCompetitors)
        .where(eq(prelaunchCompetitors.projectId, projectId));

      const userLanguage = await db.select()
        .from(prelaunchCompetitorUserLanguage)
        .where(eq(prelaunchCompetitorUserLanguage.projectId, projectId));

      // Step 3: 使用Gemini生成用户画像
      const kwSummary = keywords.slice(0, 50).map((k: Record<string, any>) => `${k.keyword} (${k.dimensionType}, ${k.scenarioCode})`).join('\n');
      const painPoints = userLanguage.filter((u: Record<string, any>) => u.phraseType === 'pain_point').map((u: Record<string, any>) => u.phrase).slice(0, 20).join('\n');
      const praises = userLanguage.filter((u: Record<string, any>) => u.phraseType === 'praise').map((u: Record<string, any>) => u.phrase).slice(0, 20).join('\n');

      const prompt = `Based on Amazon product keyword data and customer review analysis, create 3-5 distinct buyer personas.

KEYWORD DATA (top 50):
${kwSummary}

CUSTOMER PAIN POINTS:
${painPoints || 'No data available'}

CUSTOMER PRAISES:
${praises || 'No data available'}

COMPETITOR LANDSCAPE:
${competitors.slice(0, 10).map((c: Record<string, any>) => `${c.brand}: ${c.title} ($${c.price}, ${c.rating}★, ${c.reviewCount} reviews)`).join('\n')}

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

      const personas = await geminiStructuredOutput<Record<string, any>[]>('', prompt, { temperature: 0.4 });

      // Step 4: 为每个画像生成叙事描述
      for (const persona of personas) {
        const narrativePrompt = `Write a 150-word narrative profile for this Amazon buyer persona:
Name: ${persona.personaName}
Demographics: ${JSON.stringify(persona.demographics)}
Pain Points: ${JSON.stringify(persona.painPoints)}
Motivations: ${JSON.stringify(persona.motivations)}

Write in first person, as if this persona is describing their shopping experience and needs. Make it vivid and actionable for copywriters.`;

        const narrative = await geminiStructuredOutput<{ narrative: string }>('', 
          `${narrativePrompt}\n\nReturn JSON: {"narrative":"..."}`, { temperature: 0.6 });

        await db.insert(prelaunchPersonas).values({
          projectId,
          personaName: persona.personaName,
          demographics: JSON.stringify(persona.demographics),
          psychographics: JSON.stringify(persona.psychographics),
          buyingBehavior: JSON.stringify(persona.buyingBehavior),
          painPoints: JSON.stringify(persona.painPoints),
          motivations: JSON.stringify(persona.motivations),
          preferredChannels: JSON.stringify(persona.preferredChannels),
          narrativeProfile: narrative?.narrative || '',
          confidence: String(persona.confidence || 0.7),
        });
      }

      return {
        success: true,
        summary: { personaCount: personas.length },
      };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }
}
