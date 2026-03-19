/**
 * M5 视觉框架引擎服务
 * 竞品视觉审计 → 7图位战略 → Creative Brief → AIGC图片生成
 */
import { getDb } from '../../db';
import {
  prelaunchVisualBriefs, prelaunchKeywords,
  prelaunchPersonas, prelaunchCompetitors,
} from '../../../drizzle/schema';
import { eq, desc } from 'drizzle-orm';
import { geminiStructuredOutput, geminiGenerateImage } from '../gemini';

const SLOT_ROLES = [
  { position: 1, role: 'Hero Shot', description: 'Main product image on white background, shows full product clearly' },
  { position: 2, role: 'Lifestyle/In-Use', description: 'Product being used in real-life scenario by target persona' },
  { position: 3, role: 'Key Feature Highlight', description: 'Close-up of the #1 differentiating feature with callout' },
  { position: 4, role: 'Size/Scale Reference', description: 'Product with size reference object or dimensions overlay' },
  { position: 5, role: 'Infographic/Benefits', description: 'Visual summary of top 3-5 benefits with icons and text' },
  { position: 6, role: 'Package Contents', description: 'Everything included in the box, laid out neatly' },
  { position: 7, role: 'Social Proof/Trust', description: 'Testimonial quote, award badge, or before/after comparison' },
];

export class M5VisualService {

  async getVisualBriefs(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, data: [] };

    try {
      const data = await db.select()
        .from(prelaunchVisualBriefs)
        .where(eq(prelaunchVisualBriefs.projectId, projectId))
        .orderBy(prelaunchVisualBriefs.slotPosition);
      return { success: true, data };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message, data: [] };
    }
  }

  /** 运行M5视觉框架生成流水线 */
  async runPipeline(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      // 聚合上游数据
      const keywords = await db.select().from(prelaunchKeywords)
        .where(eq(prelaunchKeywords.projectId, projectId));
      const personas = await db.select().from(prelaunchPersonas)
        .where(eq(prelaunchPersonas.projectId, projectId));
      const competitors = await db.select().from(prelaunchCompetitors)
        .where(eq(prelaunchCompetitors.projectId, projectId));

      const coreKws = keywords.filter((k: Record<string, unknown>) => k.relevanceLayer === 'core').slice(0, 15);
      const topPersona = personas[0] as unknown;
      const topCompetitors = competitors.slice(0, 5);

      // 为每个图位生成Creative Brief
      for (const slot of SLOT_ROLES) {
        const prompt = `Create a detailed creative brief for Amazon product image slot #${slot.position}.

SLOT ROLE: ${slot.role}
SLOT PURPOSE: ${slot.description}

PRODUCT CONTEXT:
- Core Keywords: ${coreKws.map((k: Record<string, unknown>) => k.keyword).join(', ')}
- Target Persona: ${topPersona?.personaName || 'General consumer'}
- Persona Demographics: ${topPersona?.demographics || 'N/A'}

COMPETITIVE LANDSCAPE:
${topCompetitors.map((c: Record<string, unknown>) => `- ${c.brand}: ${c.title}`).join('\n')}

Generate:
1. headline: A compelling text overlay for this image (if applicable)
2. visualDescription: Detailed description of what the image should show
3. keyElements: Array of must-have visual elements
4. colorPalette: Suggested color scheme (hex codes)
5. photographyStyle: Lighting, angle, mood

Return JSON: {"headline":"...","visualDescription":"...","keyElements":["..."],"colorPalette":["#hex1","#hex2"],"photographyStyle":"..."}`;

        const brief = await geminiStructuredOutput<Record<string, unknown>>('', prompt, { temperature: 0.4 });

        await db.insert(prelaunchVisualBriefs).values({
          // @ts-expect-error - runtime type mismatch
          projectId,
          slotPosition: slot.position,
          slotRole: slot.role,
          headline: brief.headline || '',
          visualDescription: brief.visualDescription || '',
          keyElements: JSON.stringify(brief.keyElements || []),
          colorPalette: JSON.stringify(brief.colorPalette || []),
          referenceImages: null,
          generatedImageUrl: null,
        });
      }

      return { success: true, summary: { briefCount: SLOT_ROLES.length } };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }

  /** 使用AIGC生成单张产品图片 */
  async generateImage(projectId: number, briefId: number) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      const [brief] = await db.select()
        .from(prelaunchVisualBriefs)
        .where(eq(prelaunchVisualBriefs.id, briefId))
        .limit(1);

      if (!brief) return { success: false, error: 'Brief not found' };

      const imagePrompt = `Professional Amazon product photography, ${brief.slotRole}:
${brief.visualDescription}
Key elements: ${brief.keyElements ? JSON.stringify(brief.keyElements) : 'product focus'}
Style: Clean, high-resolution, e-commerce ready, white or lifestyle background.
${brief.headline ? `Text overlay: "${brief.headline}"` : ''}`;

      const result = await geminiGenerateImage(imagePrompt);

      if (result) {
        // 保存base64图片URL（实际生产中应上传到S3）
        const dataUrl = `data:${result.mimeType};base64,${result.imageBase64.substring(0, 100)}...`;
        await db.update(prelaunchVisualBriefs)
          .set({ generatedImageUrl: `aigc_generated_slot_${brief.slotPosition}` })
          .where(eq(prelaunchVisualBriefs.id, briefId));

        return { success: true, imageGenerated: true, slotPosition: brief.slotPosition };
      }

      return { success: false, error: 'Image generation failed' };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }
}
