// Extracted from production dist/index.js
// Original module: server/prelaunch/gemini.ts
// Lines: 91

function getClient() {
  if (!genAI) {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  }
  return genAI;
}
async function geminiChat(systemPrompt, userPrompt, options) {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: options?.model || PRO_MODEL,
    generationConfig: {
      temperature: options?.temperature ?? 0.3,
      maxOutputTokens: options?.maxTokens ?? 8192
    }
  });
  const result = await model.generateContent([
    { text: `${systemPrompt}

${userPrompt}` }
  ]);
  return result.response.text();
}
async function geminiStructuredOutput(systemPrompt, userPrompt, options) {
  const fullPrompt = `${systemPrompt}

IMPORTANT: You MUST respond with valid JSON only. No markdown, no code blocks, no explanation.

${userPrompt}`;
  const text2 = await geminiChat(fullPrompt, "", {
    temperature: options?.temperature ?? 0.1,
    model: options?.model
  });
  let cleaned = text2.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();
  return JSON.parse(cleaned);
}
async function geminiGenerateImage(prompt, options) {
  try {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"]
        }
      })
    });
    if (!response.ok) {
      log201.warn(`Gemini Image API error: ${response.status} ${response.statusText}`);
      return null;
    }
    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!parts) return null;
    for (const part of parts) {
      if (part.inlineData) {
        return {
          imageBase64: part.inlineData.data,
          mimeType: part.inlineData.mimeType || "image/png"
        };
      }
    }
    return null;
  } catch (error48) {
    log201.warn("Gemini image generation failed:", error48);
    return null;
  }
}
var log201, GEMINI_API_KEY, PRO_MODEL, IMAGE_MODEL, genAI;
var init_gemini = __esm({
  "server/prelaunch/gemini.ts"() {
    "use strict";
    init_dist2();
    init_logger();
    log201 = createModuleLogger("Gemini");
    GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyCmBnQYBdNlaJ67U3nPkCGmP6S12KSH8Y4";
    PRO_MODEL = "gemini-3.1-pro-preview";
    IMAGE_MODEL = "gemini-2.0-flash-preview-image-generation";
    genAI = null;
    __name(getClient, "getClient");
    __name(geminiChat, "geminiChat");
    __name(geminiStructuredOutput, "geminiStructuredOutput");
    __name(geminiGenerateImage, "geminiGenerateImage");
  }
});

