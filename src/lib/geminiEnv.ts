/**
 * Gemini API key routing (see `.env.example` for the canonical layout).
 *
 * Paid (Core AI): `GOOGLE_GENAI_API_KEY` + `GENERATIVE_MODEL` — analyze + geo-config.
 *   Optional extra keys (higher priority): `GEMINI_PAID_API_KEY`, `GEMINI_API_KEY`.
 *
 * Free (Writing): `GEMINI_WRITING_EXAMPLES_API_KEY` + `GEMINI_WRITING_EXAMPLES_MODEL` — ai-writing-examples only.
 *   Alias: `GEMINI_FREE_API_KEY`. If unset, falls back to paid key with a console warning.
 */

export function getGeminiPaidApiKey(): string {
  return (
    (process.env.GEMINI_PAID_API_KEY ?? '').trim() ||
    (process.env.GEMINI_API_KEY ?? '').trim() ||
    (process.env.GOOGLE_GENAI_API_KEY ?? '').trim() ||
    ''
  );
}

/** Model for analyze + geo-config (paid path). */
export function getGeminiPaidModel(): string {
  return (
    (process.env.GENERATIVE_MODEL ?? '').trim() ||
    'gemini-2.5-flash-lite'
  );
}

/**
 * API key used only by POST /api/ai-writing-examples.
 * Prefer a separate free-tier project key so paid quota is not consumed here.
 */
/** Whether writing-examples uses a dedicated key vs paid fallback vs missing. */
export type AiWritingExamplesKeySource = 'dedicated' | 'paid_fallback' | 'none';

export function getAiWritingExamplesKeySource(): AiWritingExamplesKeySource {
  const isolated =
    (process.env.GEMINI_WRITING_EXAMPLES_API_KEY ?? '').trim() ||
    (process.env.GEMINI_FREE_API_KEY ?? '').trim() ||
    '';
  if (isolated) return 'dedicated';
  if (getGeminiPaidApiKey()) return 'paid_fallback';
  return 'none';
}

export function getGeminiWritingExamplesApiKey(): string {
  const isolated =
    (process.env.GEMINI_WRITING_EXAMPLES_API_KEY ?? '').trim() ||
    (process.env.GEMINI_FREE_API_KEY ?? '').trim() ||
    '';
  if (isolated) return isolated;

  const paid = getGeminiPaidApiKey();
  if (paid) {
    console.warn(
      '[Gemini] GEMINI_WRITING_EXAMPLES_API_KEY (or GEMINI_FREE_API_KEY) unset — AI writing examples will use the paid Gemini key. Set GEMINI_WRITING_EXAMPLES_API_KEY to use a separate free-tier key.'
    );
  }
  return paid;
}

/** Model for writing-examples route (defaults to flash-lite; override for free-tier limits). */
export function getGeminiWritingExamplesModel(): string {
  return (
    (process.env.GEMINI_WRITING_EXAMPLES_MODEL ?? '').trim() ||
    (process.env.GENERATIVE_MODEL ?? '').trim() ||
    'gemini-2.5-flash-lite'
  );
}
