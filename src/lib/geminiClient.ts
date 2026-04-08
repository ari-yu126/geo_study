import { GoogleGenerativeAI } from '@google/generative-ai';
import type { GenerativeModel } from '@google/generative-ai';
import { waitForGeminiRateLimitSlot } from './geminiGlobalRateLimiter';
import { getGeminiPaidApiKey, getGeminiPaidModel } from './geminiEnv';
import { getGeminiTraceContext } from './geminiTraceContext';

const apiKey = getGeminiPaidApiKey();

console.log(
  '[GEMINI PAID KEY]',
  !!(process.env.GEMINI_PAID_API_KEY ?? '').trim(),
  !!process.env.GEMINI_API_KEY,
  !!process.env.GOOGLE_GENAI_API_KEY
);

/** Paid Gemini — page analysis when GEO_ANALYSIS_LLM=gemini. Null if no paid key (use Groq or set keys). */
export const geminiFlash: GenerativeModel | null = apiKey
  ? new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: getGeminiPaidModel(),
    })
  : null;

if (!apiKey) {
  console.warn(
    '[GEMINI] No paid Gemini API key — page analysis LLM will skip unless GEO_ANALYSIS_LLM=groq (+ GROQ_API_KEY).'
  );
}

/**
 * Log each generateContent from analyze pipeline modules. When AsyncLocalStorage has no store,
 * the call is outside runAnalysis (e.g. geo-config) — apiAnalyzeCache is n/a.
 */
export async function traceGeminiGenerateContent(
  moduleName: string,
  generateFn: () => ReturnType<GenerativeModel['generateContent']>
): ReturnType<GenerativeModel['generateContent']> {
  if (!geminiFlash) {
    throw new Error('traceGeminiGenerateContent called without Gemini API key');
  }
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
      globalRateLimit: 'wait_before_call',
    })
  );
  await waitForGeminiRateLimitSlot(`trace:${moduleName}`);
  return generateFn();
}
