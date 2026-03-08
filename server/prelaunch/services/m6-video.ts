/**
 * M6 视频素材创意引擎服务
 * PAS脚本生成 → 分镜表 → AIGC分镜图 → SB Banner创意
 */
import { getDb } from '../../db';
import {
  prelaunchVideoScripts, prelaunchVisualBriefs,
  prelaunchKeywords, prelaunchPersonas, prelaunchCosmoTriples,
} from '../../../drizzle/schema';
import { eq, desc } from 'drizzle-orm';
import { geminiStructuredOutput, geminiGenerateImage } from '../gemini';

export class M6VideoService {

  async getVideoScripts(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, data: [] };

    try {
      const data = await db.select()
        .from(prelaunchVideoScripts)
        .where(eq(prelaunchVideoScripts.projectId, projectId))
        .orderBy(desc(prelaunchVideoScripts.createdAt));
      return { success: true, data };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message, data: [] };
    }
  }

  async getBannerCreatives(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, data: [] };

    try {
      const data = await db.select()
        .from(prelaunchVisualBriefs)
        .where(eq(prelaunchVisualBriefs.projectId, projectId));
      
      const banners = (data as unknown[]).filter((d: Record<string, unknown>) => d.slotRole?.startsWith('SB_Banner'));
      return { success: true, data: banners };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message, data: [] };
    }
  }

  /** 运行M6视频创意生成流水线 */
  async runPipeline(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      // 聚合上游数据
      const keywords = await db.select().from(prelaunchKeywords)
        .where(eq(prelaunchKeywords.projectId, projectId));
      const personas = await db.select().from(prelaunchPersonas)
        .where(eq(prelaunchPersonas.projectId, projectId));
      const cosmoTriples = await db.select().from(prelaunchCosmoTriples)
        .where(eq(prelaunchCosmoTriples.projectId, projectId));

      const coreKws = keywords.filter((k: Record<string, unknown>) => k.relevanceLayer === 'core').slice(0, 15);
      const topPersona = personas[0];

      // Step 1: 生成PAS视频脚本（3个变体：15s/30s/45s）
      const durations = [15, 30, 45];
      for (const duration of durations) {
        const prompt = `Create an Amazon Sponsored Brand Video script using the PAS (Problem-Agitate-Solution) framework.

DURATION: ${duration} seconds
TARGET PERSONA: ${topPersona?.personaName || 'General consumer'}
CORE KEYWORDS: ${coreKws.map((k: Record<string, unknown>) => k.keyword).join(', ')}

COSMO CAUSAL CHAINS (use for narrative):
${cosmoTriples.slice(0, 5).map((t: Record<string, unknown>) => `${t.causeNode} → ${t.effectNode} → ${t.outcomeNode}`).join('\n')}

Generate:
1. hook: opening 3-second hook (attention grabber)
2. body: main content (problem + agitate + solution combined)
3. cta: call to action
4. storyboard: array of frames, each with:
   - frameNumber: sequential number
   - timeStart: start time in seconds
   - timeEnd: end time in seconds
   - shotType: "close_up", "wide", "medium", "overhead", "pov"
   - visualDescription: what appears on screen
   - voiceover: narration text
   - textOverlay: on-screen text (if any)
   - emotionalTone: "tension", "curiosity", "relief", "joy", "trust"

Return JSON with all fields above.`;

        const script = await geminiStructuredOutput<Record<string, unknown>>('', prompt, { temperature: 0.5 });

        // 适配prelaunchVideoScripts表的实际字段：videoType, scriptFramework, hook, body, cta, duration, storyboard, generatedFrameUrls
        await db.insert(prelaunchVideoScripts).values({
          projectId,
          videoType: `PAS_${duration}s`,
          scriptFramework: 'PAS',
          hook: script.hook || '',
          body: script.body || '',
          cta: script.cta || '',
          duration,
          storyboard: script.storyboard || [],
          generatedFrameUrls: null,
        });
      }

      // Step 2: 生成SB Banner创意（5个变体）
      const bannerSizes = [
        { name: 'SB_Banner_Desktop', width: 1200, height: 628 },
        { name: 'SB_Banner_Mobile', width: 640, height: 100 },
        { name: 'SB_Banner_Store', width: 3000, height: 600 },
        { name: 'SB_Banner_Video_Thumb', width: 1280, height: 720 },
        { name: 'SB_Banner_Brand_Logo', width: 400, height: 400 },
      ];

      for (const banner of bannerSizes) {
        const prompt = `Create a creative brief for an Amazon Sponsored Brands banner ad.

BANNER TYPE: ${banner.name}
DIMENSIONS: ${banner.width}x${banner.height}px
PRODUCT KEYWORDS: ${coreKws.slice(0, 5).map((k: Record<string, unknown>) => k.keyword).join(', ')}
TARGET PERSONA: ${topPersona?.personaName || 'General consumer'}

Generate:
1. headline: compelling ad headline (max 50 chars)
2. visualDescription: detailed description of the banner layout and imagery
3. keyElements: must-have visual elements
4. colorPalette: brand-consistent color scheme

Return JSON: {"headline":"...","visualDescription":"...","keyElements":["..."],"colorPalette":["#hex1","#hex2"]}`;

        const brief = await geminiStructuredOutput<Record<string, unknown>>('', prompt, { temperature: 0.4 });

        await db.insert(prelaunchVisualBriefs).values({
          projectId,
          slotPosition: 100 + bannerSizes.indexOf(banner),
          slotRole: banner.name,
          headline: brief.headline || '',
          visualDescription: brief.visualDescription || '',
          keyElements: brief.keyElements || [],
          colorPalette: brief.colorPalette || [],
          referenceImages: null,
          generatedImageUrl: null,
        });
      }

      return {
        success: true,
        summary: {
          videoScripts: durations.length,
          bannerCreatives: bannerSizes.length,
        },
      };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }

  /** 使用AIGC生成视频分镜图 */
  async generateStoryboardFrames(projectId: number, scriptId: number) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      const [script] = await db.select()
        .from(prelaunchVideoScripts)
        .where(eq(prelaunchVideoScripts.id, scriptId))
        .limit(1);

      if (!script) return { success: false, error: 'Script not found' };

      const storyboard = script.storyboard ? 
        (typeof script.storyboard === 'string' ? JSON.parse(script.storyboard as string) : script.storyboard) : [];

      const generatedFrames: string[] = [];

      for (const frame of (storyboard as unknown[]).slice(0, 8)) {
        const emotionColorMap: Record<string, string> = {
          tension: 'dramatic lighting, dark tones, high contrast',
          curiosity: 'warm golden light, soft focus background',
          relief: 'bright, airy, natural daylight',
          joy: 'vibrant colors, warm tones, natural smile',
          trust: 'clean, professional, blue-white palette',
        };

        const styleGuide = emotionColorMap[frame.emotionalTone] || 'clean, professional lighting';

        const imagePrompt = `Amazon product video storyboard frame:
Shot type: ${frame.shotType}
Scene: ${frame.visualDescription}
Text overlay: ${frame.textOverlay || 'none'}
Style: ${styleGuide}
Aspect ratio: 16:9, cinematic, high quality, product photography style`;

        const result = await geminiGenerateImage(imagePrompt);
        if (result) {
          generatedFrames.push(`frame_${frame.frameNumber}_generated`);
        }
      }

      // 更新脚本记录 - 使用实际字段名 generatedFrameUrls
      await db.update(prelaunchVideoScripts)
        .set({ generatedFrameUrls: generatedFrames })
        .where(eq(prelaunchVideoScripts.id, scriptId));

      return { success: true, framesGenerated: generatedFrames.length };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }

  /** 使用AIGC生成SB Banner图片 */
  async generateBannerImage(projectId: number, bannerId: number) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      const [banner] = await db.select()
        .from(prelaunchVisualBriefs)
        .where(eq(prelaunchVisualBriefs.id, bannerId))
        .limit(1);

      if (!banner) return { success: false, error: 'Banner brief not found' };

      const imagePrompt = `Professional Amazon Sponsored Brands banner ad:
${banner.visualDescription}
Headline: "${banner.headline}"
Key elements: ${banner.keyElements ? JSON.stringify(banner.keyElements) : 'product focus'}
Style: Clean, modern, e-commerce advertising, brand-consistent.
High resolution, professional graphic design.`;

      const result = await geminiGenerateImage(imagePrompt);

      if (result) {
        await db.update(prelaunchVisualBriefs)
          .set({ generatedImageUrl: `aigc_banner_${banner.slotRole}` })
          .where(eq(prelaunchVisualBriefs.id, bannerId));

        return { success: true, imageGenerated: true };
      }

      return { success: false, error: 'Banner image generation failed' };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }
}
