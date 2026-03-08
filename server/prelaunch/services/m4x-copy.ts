/**
 * M4X 文案动态进化引擎服务
 * 初始生成(Gen-0) → 反馈归因 → 变异 → 适应度排序 → 下一代
 */
import { getDb } from '../../db';
import {
  prelaunchCopyVersions, prelaunchCopyFeedback,
  prelaunchQnaSeeds, prelaunchKeywords,
  prelaunchPersonas, prelaunchCosmoTriples,
  prelaunchCompetitorUserLanguage,
} from '../../../drizzle/schema';
import { eq, desc, and } from 'drizzle-orm';
import { geminiChat, geminiStructuredOutput } from '../gemini';

export class M4XCopyService {

  async getCopyVersions(projectId: number, generation?: number) {
    const db = await getDb();
    if (!db) return { success: false, data: [] };

    try {
      const conditions = [eq(prelaunchCopyVersions.projectId, projectId)];
      if (generation !== undefined) conditions.push(eq(prelaunchCopyVersions.generation, generation));

      const data = await db.select()
        .from(prelaunchCopyVersions)
        .where(and(...conditions))
        .orderBy(desc(prelaunchCopyVersions.fitnessScore));
      return { success: true, data };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message, data: [] };
    }
  }

  async getQnaSeeds(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, data: [] };

    try {
      const data = await db.select()
        .from(prelaunchQnaSeeds)
        .where(eq(prelaunchQnaSeeds.projectId, projectId));
      return { success: true, data };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message, data: [] };
    }
  }

  /** 生成初始文案（Gen-0） */
  async generateInitialCopy(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      // 聚合所有上游数据
      const keywords = await db.select().from(prelaunchKeywords)
        .where(eq(prelaunchKeywords.projectId, projectId));
      const personas = await db.select().from(prelaunchPersonas)
        .where(eq(prelaunchPersonas.projectId, projectId));
      const cosmoTriples = await db.select().from(prelaunchCosmoTriples)
        .where(eq(prelaunchCosmoTriples.projectId, projectId));
      const userLanguage = await db.select().from(prelaunchCompetitorUserLanguage)
        .where(eq(prelaunchCompetitorUserLanguage.projectId, projectId));

      // 构建上下文
      const coreKws = keywords.filter((k: Record<string, unknown>) => k.relevanceLayer === 'core').slice(0, 20);
      const extKws = keywords.filter((k: Record<string, unknown>) => k.relevanceLayer === 'extended').slice(0, 15);
      const painPhrases = userLanguage.filter((u: Record<string, unknown>) => u.sentiment === 'negative').slice(0, 10);
      const praisePhrases = userLanguage.filter((u: Record<string, unknown>) => u.sentiment === 'positive').slice(0, 10);

      const copyTypes = ['title', 'bullet_points', 'description', 'backend_keywords', 'a_plus'];

      for (const copyType of copyTypes) {
        const prompt = this.buildCopyPrompt(copyType, {
          coreKeywords: coreKws.map((k: Record<string, unknown>) => k.keyword),
          extendedKeywords: extKws.map((k: Record<string, unknown>) => k.keyword),
          personas: personas.map((p: Record<string, unknown>) => ({ name: p.personaName, painPoints: p.painPoints })),
          cosmoTriples: cosmoTriples.slice(0, 10).map((t: Record<string, unknown>) => ({
            cause: t.causeNode, effect: t.effectNode, outcome: t.outcomeNode,
          })),
          painPhrases: painPhrases.map((p: Record<string, unknown>) => p.phrase),
          praisePhrases: praisePhrases.map((p: Record<string, unknown>) => p.phrase),
        });

        const result = await geminiStructuredOutput<any>('', prompt, { temperature: 0.5 });

        await db.insert(prelaunchCopyVersions).values({
          projectId,
          generation: 0,
          copyType,
          title: result.title || null,
          bulletPoints: result.bulletPoints ? JSON.stringify(result.bulletPoints) : null,
          description: result.description || null,
          backendKeywords: result.backendKeywords || null,
          aPlus: result.aPlus ? JSON.stringify(result.aPlus) : null,
          fitnessScore: '0.5',
          parentId: null,
          mutationLog: JSON.stringify({ source: 'gen0_initial', timestamp: new Date().toISOString() }),
        });
      }

      // 生成Rufus Q&A种子
      await this.generateQnaSeeds(db, projectId, cosmoTriples, keywords);

      return { success: true, generation: 0 };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }

  /** 触发文案进化（下一代） */
  async evolveNextGeneration(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      // 获取当前最高代数
      const currentVersions = await db.select()
        .from(prelaunchCopyVersions)
        .where(eq(prelaunchCopyVersions.projectId, projectId))
        .orderBy(desc(prelaunchCopyVersions.generation));

      if (currentVersions.length === 0) {
        return { success: false, error: 'No existing copy versions. Run initial generation first.' };
      }

      const currentGen = currentVersions[0].generation || 0;
      const nextGen = currentGen + 1;

      // 获取反馈信号
      const feedback = await db.select()
        .from(prelaunchCopyFeedback)
        .where(eq(prelaunchCopyFeedback.projectId, projectId));

      // 按copyType分组获取最佳版本
      const bestByType = new Map<string, unknown>();
      for (const v of currentVersions) {
        if (!bestByType.has(v.copyType)) {
          bestByType.set(v.copyType, v);
        }
      }

      // 为每种类型生成变异版本
      for (const [copyType, parent] of bestByType) {
        const feedbackSummary = feedback
          .filter((f: Record<string, unknown>) => f.copyVersionId === parent.id)
          .map((f: Record<string, unknown>) => `${f.signalType}: ${f.metricName}=${f.metricValue}`)
          .join(', ');

        const prompt = `You are an Amazon listing copywriting evolution engine.

PARENT COPY (Gen-${currentGen}, Fitness: ${parent.fitnessScore}):
Type: ${copyType}
Title: ${parent.title || 'N/A'}
Bullets: ${parent.bulletPoints || 'N/A'}
Description: ${parent.description || 'N/A'}

PERFORMANCE FEEDBACK:
${feedbackSummary || 'No feedback data yet - apply general optimization heuristics'}

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

        const evolved = await geminiStructuredOutput<any>('', prompt, { temperature: 0.6 });

        await db.insert(prelaunchCopyVersions).values({
          projectId,
          generation: nextGen,
          copyType,
          title: evolved.title || parent.title,
          bulletPoints: evolved.bulletPoints ? JSON.stringify(evolved.bulletPoints) : parent.bulletPoints,
          description: evolved.description || parent.description,
          backendKeywords: evolved.backendKeywords || parent.backendKeywords,
          aPlus: evolved.aPlus ? JSON.stringify(evolved.aPlus) : parent.aPlus,
          fitnessScore: String(parseFloat(parent.fitnessScore || '0.5') + 0.02),
          parentId: parent.id,
          mutationLog: JSON.stringify({
            strategy: evolved.mutationStrategy,
            reason: evolved.mutationReason,
            expectedImprovement: evolved.expectedImprovement,
            timestamp: new Date().toISOString(),
          }),
        });
      }

      return { success: true, generation: nextGen };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }

  /** 生成Rufus Q&A种子 */
  private async generateQnaSeeds(db: ReturnType<typeof getDb> | null, projectId: number, cosmoTriples: unknown[], keywords: unknown[]) {
    const prompt = `Generate Amazon Rufus-optimized Q&A pairs based on these COSMO cause-effect-outcome triples and keywords.

COSMO TRIPLES:
${cosmoTriples.slice(0, 15).map((t: Record<string, unknown>) => `${t.causeNode} → ${t.effectNode} → ${t.outcomeNode}`).join('\n')}

CORE KEYWORDS:
${keywords.filter((k: Record<string, unknown>) => k.relevanceLayer === 'core').slice(0, 20).map((k: Record<string, unknown>) => k.keyword).join(', ')}

Generate 10-20 Q&A pairs that:
1. Address common customer questions
2. Incorporate COSMO causal logic (pain → solution → benefit)
3. Use natural conversational language
4. Include relevant keywords naturally

Return JSON: [{"question":"...","answer":"...","sourceType":"cosmo_triple|keyword_faq|competitor_gap"}]`;

    const qnas = await geminiStructuredOutput<any[]>('', prompt, { temperature: 0.4 });

    for (const qna of qnas) {
      await db.insert(prelaunchQnaSeeds).values({
        projectId,
        question: qna.question,
        answer: qna.answer,
        sourceType: qna.sourceType || 'cosmo_triple',
      });
    }
  }

  /** 构建文案生成Prompt */
  private buildCopyPrompt(copyType: string, context: unknown): string {
    const base = `You are an expert Amazon listing copywriter. Use the following data to create optimized copy.

CORE KEYWORDS (must include): ${context.coreKeywords.join(', ')}
EXTENDED KEYWORDS (include where natural): ${context.extendedKeywords.join(', ')}

BUYER PERSONAS:
${context.personas.map((p: Record<string, unknown>) => `- ${p.name}: Pain points: ${JSON.stringify(p.painPoints)}`).join('\n')}

COSMO CAUSAL CHAINS (use for persuasion logic):
${context.cosmoTriples.map((t: Record<string, unknown>) => `${t.cause} → ${t.effect} → ${t.outcome}`).join('\n')}

REAL USER LANGUAGE (pain points): ${context.painPhrases.join('; ')}
REAL USER LANGUAGE (praises): ${context.praisePhrases.join('; ')}`;

    switch (copyType) {
      case 'title':
        return `${base}\n\nGenerate an Amazon product title (max 200 chars). Include the most important keywords naturally. Follow Amazon's title formula: Brand + Key Feature + Product Type + Size/Quantity + Color/Variant.\n\nReturn JSON: {"title":"..."}`;
      case 'bullet_points':
        return `${base}\n\nGenerate 5 Amazon bullet points. Each bullet should: start with a CAPITALIZED benefit header, address a specific pain point, include relevant keywords, use COSMO logic (problem→solution→benefit).\n\nReturn JSON: {"bulletPoints":["bullet1","bullet2","bullet3","bullet4","bullet5"]}`;
      case 'description':
        return `${base}\n\nGenerate an Amazon product description (500-1000 words). Use HTML formatting (<b>, <br>, <ul>). Structure: Hook → Problem → Solution → Benefits → Social Proof → CTA.\n\nReturn JSON: {"description":"..."}`;
      case 'backend_keywords':
        return `${base}\n\nGenerate Amazon backend search terms (max 249 bytes). Include: misspellings, synonyms, Spanish translations, related terms NOT in the listing. No commas, no repeated words.\n\nReturn JSON: {"backendKeywords":"..."}`;
      case 'a_plus':
        return `${base}\n\nDesign an A+ Content layout with 5-7 modules. For each module: type (hero_banner, comparison_chart, feature_highlight, brand_story, specs_table), headline, body text, image description.\n\nReturn JSON: {"aPlus":[{"type":"...","headline":"...","body":"...","imageDescription":"..."}]}`;
      default:
        return `${base}\n\nGenerate optimized Amazon listing copy.\n\nReturn JSON: {"title":"...","bulletPoints":[],"description":"..."}`;
    }
  }
}
