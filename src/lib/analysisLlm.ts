/**
 * Analysis pipeline LLM routing (page analyze — not geo-config, not AI writing examples).
 *
 * Set GEO_ANALYSIS_LLM=groq and GROQ_API_KEY to use Groq's free tier instead of Gemini.
 * Default remains Gemini when GEMINI_API_KEY / GOOGLE_GENAI_API_KEY is set.
 */

import type { GenerativeModel } from '@google/generative-ai';
import { geminiFlash, traceGeminiGenerateContent } from './geminiClient';
import { getGeminiTraceContext } from './geminiTraceContext';

export type AnalysisLlmProvider = 'gemini' | 'groq';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export function getAnalysisLlmProvider(): AnalysisLlmProvider {
  const v = (process.env.GEO_ANALYSIS_LLM ?? 'gemini').toLowerCase().trim();
  if (v === 'groq') return 'groq';
  return 'gemini';
}

/** Pre-call delay for withGeminiRetry / manual sleeps — Gemini free tier RPM; Groq skips. */
export function getAnalysisLlmPreCallDelayMs(): number {
  return getAnalysisLlmProvider() === 'groq' ? 0 : 5000;
}

export function analysisLlmIsConfigured(): boolean {
  if (getAnalysisLlmProvider() === 'groq') {
    return Boolean((process.env.GROQ_API_KEY ?? '').trim());
  }
  return geminiFlash != null;
}

function logAnalysisLlmTrace(moduleName: string, provider: AnalysisLlmProvider) {
  const ctx = getGeminiTraceContext();
  const inRunAnalysis = !!ctx;
  console.log(
    '[ANALYSIS_LLM_TRACE]',
    JSON.stringify({
      module: moduleName,
      provider,
      normalizedUrl: ctx?.normalizedUrl ?? null,
      inRunAnalysisContext: inRunAnalysis,
      willInvokeLlm: true,
    })
  );
}

class GroqHttpError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GroqHttpError';
    this.status = status;
  }
}

async function groqChat(prompt: string): Promise<string> {
  const key = (process.env.GROQ_API_KEY ?? '').trim();
  if (!key) {
    throw new Error('GROQ_API_KEY is required when GEO_ANALYSIS_LLM=groq');
  }
  const model =
    (process.env.GROQ_MODEL ?? '').trim() || 'llama-3.1-8b-instant';

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.25,
    }),
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new GroqHttpError(`Groq ${res.status}: ${rawText.slice(0, 800)}`, res.status);
  }

  let data: {
    choices?: Array<{ message?: { content?: string } }>;
  };
  try {
    data = JSON.parse(rawText) as typeof data;
  } catch {
    throw new Error(`Groq invalid JSON: ${rawText.slice(0, 200)}`);
  }

  const text = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!text) {
    throw new Error('Groq returned empty content');
  }
  return text;
}

/**
 * Single entry for analyze-path LLM text generation (citations, question filter, video, actual citation check).
 */
export async function analysisLlmGenerateText(
  traceModule: string,
  prompt: string
): Promise<string> {
  const provider = getAnalysisLlmProvider();

  if (provider === 'groq') {
    logAnalysisLlmTrace(traceModule, 'groq');
    return groqChat(prompt);
  }

  if (!geminiFlash) {
    throw new Error(
      'Gemini API key missing. Set GEMINI_API_KEY / GOOGLE_GENAI_API_KEY or GEO_ANALYSIS_LLM=groq with GROQ_API_KEY.'
    );
  }

  logAnalysisLlmTrace(traceModule, 'gemini');
  const model = geminiFlash as GenerativeModel;
  const result = await traceGeminiGenerateContent(traceModule, () =>
    model.generateContent([{ text: prompt }])
  );
  return result.response.text().trim();
}
