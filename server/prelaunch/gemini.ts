/**
 * 预发布引擎 — Gemini AI 服务层
 * 使用 Google Gemini 3.1 Pro Preview 和 Nano Banana 2
 */
import { GoogleGenerativeAI, type GenerateContentResult } from '@google/generative-ai';
import { createModuleLogger } from '../utils/logger';
const log = createModuleLogger('Gemini');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyCmBnQYBdNlaJ67U3nPkCGmP6S12KSH8Y4';
const PRO_MODEL = 'gemini-3.1-pro-preview';
const FLASH_MODEL = 'gemini-2.0-flash';
const IMAGE_MODEL = 'gemini-2.0-flash-preview-image-generation';

let genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!genAI) {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  }
  return genAI;
}

/** 通用文本生成（使用Pro模型进行深度推理） */
export async function geminiChat(
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; maxTokens?: number; model?: string }
): Promise<string> {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: options?.model || PRO_MODEL,
    generationConfig: {
      temperature: options?.temperature ?? 0.3,
      maxOutputTokens: options?.maxTokens ?? 8192,
    },
  });

  const result: GenerateContentResult = await model.generateContent([
    { text: `${systemPrompt}\n\n${userPrompt}` },
  ]);
  return result.response.text();
}

/** 结构化JSON输出 */
export async function geminiStructuredOutput<T>(
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; model?: string }
): Promise<T> {
  const fullPrompt = `${systemPrompt}\n\nIMPORTANT: You MUST respond with valid JSON only. No markdown, no code blocks, no explanation.\n\n${userPrompt}`;
  const text = await geminiChat(fullPrompt, '', {
    temperature: options?.temperature ?? 0.1,
    model: options?.model,
  });

  // 清理可能的markdown代码块包裹
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  return JSON.parse(cleaned) as T;
}

/** 快速分类/轻量任务（使用Flash模型） */
export async function geminiFlash(
  prompt: string,
  options?: { temperature?: number }
): Promise<string> {
  return geminiChat('', prompt, {
    temperature: options?.temperature ?? 0.1,
    model: FLASH_MODEL,
  });
}

/** 图像生成（使用Nano Banana 2 / Gemini Flash Image Preview） */
export async function geminiGenerateImage(
  prompt: string,
  options?: { aspectRatio?: string }
): Promise<{ imageBase64: string; mimeType: string } | null> {
  try {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      }),
    });

    if (!response.ok) {
      log.error(`Gemini Image API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json() as unknown;
    // @ts-ignore
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!parts) return null;

    for (const part of parts) {
      if (part.inlineData) {
        return {
          imageBase64: part.inlineData.data,
          mimeType: part.inlineData.mimeType || 'image/png',
        };
      }
    }
    return null;
  } catch (error) {
    log.error('Gemini image generation failed:', error);
    return null;
  }
}

/** 批量图像生成 */
export async function geminiBatchGenerateImages(
  prompts: string[],
  options?: { concurrency?: number }
): Promise<Array<{ imageBase64: string; mimeType: string } | null>> {
  const concurrency = options?.concurrency ?? 2;
  const results: Array<{ imageBase64: string; mimeType: string } | null> = [];

  for (let i = 0; i < prompts.length; i += concurrency) {
    const batch = prompts.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(p => geminiGenerateImage(p))
    );
    results.push(...batchResults);
  }

  return results;
}
