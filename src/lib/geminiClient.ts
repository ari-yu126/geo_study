import { GoogleGenerativeAI } from '@google/generative-ai';
import type { GenerativeModel } from '@google/generative-ai';
import { getGeminiTraceContext } from './geminiTraceContext';

const apiKey =
  process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENAI_API_KEY ?? '';

if (!apiKey) {
  throw new Error('Gemini API Key is missing. Set GOOGLE_GENAI_API_KEY or GEMINI_API_KEY in .env.local');
}

console.log('[GEMINI KEY]', !!process.env.GOOGLE_GENAI_API_KEY, !!process.env.GEMINI_API_KEY);

const genAI = new GoogleGenerativeAI(apiKey);

// Use a supported model for newer projects/users. Change if your project has access to other models.
export const geminiFlash = genAI.getGenerativeModel({ model: process.env.GENERATIVE_MODEL ?? 'gemini-2.5-flash-lite' });

/**
 * Log each generateContent from analyze pipeline modules. When AsyncLocalStorage has no store,
 * the call is outside runAnalysis (e.g. geo-config) — apiAnalyzeCache is n/a.
 */
export async function traceGeminiGenerateContent(
  moduleName: string,
  generateFn: () => ReturnType<GenerativeModel['generateContent']>
): ReturnType<GenerativeModel['generateContent']> {
  const ctx = getGeminiTraceContext();
  const inRunAnalysis = !!ctx;
  // apiAnalyzeCacheHit: false in runAnalysis path (API did not return cached row); null = call outside runAnalysis (e.g. geo-config).
  console.log(
    '[GEMINI_TRACE]',
    JSON.stringify({
      module: moduleName,
      normalizedUrl: ctx?.normalizedUrl ?? null,
      inRunAnalysisContext: inRunAnalysis,
      apiAnalyzeCacheHit: inRunAnalysis ? false : null,
      skippedDueToCachedAnalysis: false,
      willInvokeGenerateContent: true,
    })
  );
  return generateFn();
}
