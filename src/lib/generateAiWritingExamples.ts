/**
 * AI Writing Assistant — Gemini-backed example prose (separate from Recommendation engine).
 *
 * Future improvements (not implemented):
 * - Cache AI results per URL (TTL / ETag).
 * - Regenerate button + idempotency key.
 * - Persist examples in DB (per analysis / user).
 * - Multi-language prompts and output (match page locale).
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  getAiWritingExamplesKeySource,
  getGeminiWritingExamplesApiKey,
  getGeminiWritingExamplesModel,
} from './geminiEnv';
import {
  extractRetryAfterSeconds,
  isQuotaError,
  setLlmCooldown,
} from './llmError';
import { normalizeWritingExamplesTitle } from './aiWritingExamplesFallback';
import { waitForGeminiRateLimitSlot } from './geminiGlobalRateLimiter';
import type {
  AiWritingExamplesData,
  AiWritingExamplesRequestBody,
  AiWritingGuideRulePromptDebug,
} from './aiWritingExamplesTypes';

/** Shown only when no Gemini key is configured (client may surface this). */
const NO_API_KEY_MSG =
  'AI writing examples are not available. Please check your API key in .env.local (GEMINI_WRITING_EXAMPLES_API_KEY or GOOGLE_GENAI_API_KEY) and billing if you use a paid key.';

/** Quota / 429 — do not mention API key or billing (handled separately from missing key). */
const QUOTA_MSG =
  'AI writing examples are temporarily unavailable due to API usage limits. Please try again later.';

const GENERATION_FAILED_MSG =
  'Could not generate writing examples. Please try again.';

/** Single retry after a rate limit (429) before giving up (route may apply template fallback). */
const RATE_LIMIT_RETRY_DELAY_MS = 4500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getGenerativeModelOrNull() {
  const apiKey = getGeminiWritingExamplesApiKey();
  if (!apiKey) return null;
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: getGeminiWritingExamplesModel(),
  });
}

function buildPrompt(input: AiWritingExamplesRequestBody): string {
  const displayTitle = normalizeWritingExamplesTitle(input.title, input.url);
  const locale = input.locale === 'en' ? 'en' : 'ko';
  const questionsBlock =
    input.questions.length > 0
      ? input.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')
      : '(none provided)';
  const sectionsBlock =
    input.recommendedSections.length > 0
      ? input.recommendedSections.map((s, i) => `${i + 1}. ${s}`).join('\n')
      : '(none provided)';

  const outputLanguage =
    locale === 'ko'
      ? `Output language: Write every user-facing string in this JSON in **natural Korean (한국어)** — summary, FAQ, pros/cons, verdict, and H2 lines.`
      : `Output language: Write every user-facing string in this JSON in **natural English**.`;

  const headingRules =
    locale === 'ko'
      ? `H2 heading suggestions (headingSuggestions):
- Produce **4 to 6** items. Each must be **one short sentence** (one line), as a **search question or user-intent phrase** specific to this page topic (제품명·주제·상황을 반영).
- Phrase them like real queries users type into search or AI (예: "사무실에서 쓰기에 무엇이 좋나요?", "A와 B 차이는 무엇인가요?", "구매 전에 꼭 확인할 것은?").
- **Do NOT** use generic section labels only, such as: FAQ, 장단점, 결론, 비교, 요약, 총평, Pros, Cons, Conclusion, Comparison (or English equivalents used as bare titles).
- Avoid duplicating the structural labels from "Recommended H2/H3 sections" above — instead, turn them into **concrete, topic-specific questions** readers would ask.`
      : `H2 heading suggestions (headingSuggestions):
- Produce **4 to 6** items. Each must be **one short sentence** (one line), as a **search question or user-intent phrase** tied to this page’s topic.
- Phrase them like real queries (e.g. "What is the difference between A and B?", "Is this suitable for office use?", "What should I check before buying?", "Which option is best for beginners?").
- **Do NOT** use bare generic section titles such as: FAQ, Pros, Cons, Conclusion, Comparison, Summary, Verdict.
- Do not merely mirror the structural "Recommended H2/H3 sections" list — make headings **specific** to the product/topic.`;

  return `You are a content editor helping improve an article.

Based on the article topic, search questions, and recommended sections,
generate example content that the writer can add to the article.

${outputLanguage}

Generate:
1. A short summary example (3–4 sentences)
2. 3 FAQ examples with answers
3. A pros and cons example
4. A short verdict / conclusion example
5. ${headingRules}

Keep the tone informative and neutral.
Do not mention SEO, scores, or optimization.
Write like an article editor giving example content.

Important: In the JSON strings, do NOT paste the raw page title repeatedly in every field. Prefer short references such as "this article", "the product", or "the topic". Keep each FAQ question to one concise line.

---

Page URL: ${input.url}
Page title (cleaned for editing; do not repeat verbatim in every field): ${displayTitle || '(untitled)'}
Page type: ${input.pageType}
Locale for output: ${locale}

Content snippet:
${input.contentSnippet || '(empty)'}

Search questions:
${questionsBlock}

Recommended H2/H3 sections (editorial structure hints — **do not copy verbatim as your headingSuggestions**; use them only as context for topic-specific question-style H2s):
${sectionsBlock}

---

Respond with ONLY valid JSON (no markdown fences). Use exactly this shape (headingSuggestions must have **4 to 6** strings):
{
  "summaryExample": "string",
  "faqExamples": [
    { "question": "string", "answer": "string" },
    { "question": "string", "answer": "string" },
    { "question": "string", "answer": "string" }
  ],
  "prosConsExample": "string",
  "verdictExample": "string",
  "headingSuggestions": ["string", "string", "string", "string"]
}`;
}

function buildGuideRuleFirstPrompt(input: AiWritingExamplesRequestBody): string {
  const displayTitle = normalizeWritingExamplesTitle(input.title, input.url);
  const locale = input.locale === 'en' ? 'en' : 'ko';
  const guides = input.matchedGuideRules ?? [];
  const guidesBlock = guides
    .map((g, i) => {
      const pr = g.priority ? ` (priority: ${g.priority})` : '';
      return `${i + 1}. [id=${g.id}]${pr}\n   ${g.message || '(no message text)'}`;
    })
    .join('\n\n');

  const relatedIssues =
    input.relatedIssueIds && input.relatedIssueIds.length > 0
      ? input.relatedIssueIds.join(', ')
      : '(none — do not invent issues)';

  const platformLine = input.platform ? `Platform / hosting: ${input.platform}` : '';
  const guideLine = input.currentGuideText
    ? `Primary UI guide line (same analysis): ${input.currentGuideText}`
    : '';

  const questionsBlock =
    input.questions.length > 0
      ? input.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')
      : '(none)';

  const sectionsBlock =
    input.recommendedSections.length > 0
      ? input.recommendedSections.map((s, i) => `${i + 1}. ${s}`).join('\n')
      : '(none)';

  const outputLanguage =
    locale === 'ko'
      ? `Output language: every user-facing string in the JSON must be **natural Korean (한국어)**.`
      : `Output language: every user-facing string in the JSON must be **natural English**.`;

  const headingRules =
    locale === 'ko'
      ? `headingSuggestions: 4–6 short lines as **search-style questions** tied to this page topic (not bare labels like FAQ/결론).`
      : `headingSuggestions: 4–6 short lines as **search-style questions** tied to this page topic (not bare FAQ/Conclusion labels).`;

  return `You are generating **example rewrite text** for a writer (GEO-oriented pages). You are NOT a grader.

Hard rules:
- **Follow the matched guide rules below exactly.** They are the only optimization targets for this task.
- Do **not** invent new SEO goals, missing issues, or strengths. Do **not** score the page or say what is "wrong" in general.
- Do **not** output audit-style advice — only concrete example prose the author can paste or adapt.
- Map each guide to the JSON fields where it fits best: use faqExamples for Q&A-style guides, prosConsExample for comparison / trade-offs, summaryExample for a tight intro/takeaway, verdictExample for a closing stance, headingSuggestions for H2-style lines. If a guide fits multiple slots, prioritize the clearest match and keep examples consistent with the guide.

${outputLanguage}

---

Page URL: ${input.url}
Page title (for context; do not spam it in every field): ${displayTitle || '(untitled)'}
Page type: ${input.pageType}
${platformLine}
Locale: ${locale}

Content excerpt:
${input.contentSnippet || '(empty)'}

Reference search questions (context only):
${questionsBlock}

Recommended structural sections (context only — do not treat as commands):
${sectionsBlock}

Related issue ids from analysis (opaque labels only — **do not** diagnose or expand):
${relatedIssues}

${guideLine}

---

**Matched guide rules (required targets — implement these in your examples):**

${guidesBlock}

---

${headingRules}

Respond with ONLY valid JSON (no markdown fences). Same shape as the standard writing assistant:
{
  "summaryExample": "string",
  "faqExamples": [
    { "question": "string", "answer": "string" },
    { "question": "string", "answer": "string" },
    { "question": "string", "answer": "string" }
  ],
  "prosConsExample": "string",
  "verdictExample": "string",
  "headingSuggestions": ["string", "string", "string", "string"]
}`;
}

function resolveGuideRulePromptDebug(
  input: AiWritingExamplesRequestBody,
  source: AiWritingGuideRulePromptDebug['source']
): AiWritingGuideRulePromptDebug {
  const guides = input.matchedGuideRules ?? [];
  return {
    usedGuideRuleIds: guides.map((g) => g.id),
    usedGuideMessages: guides.map((g) => g.message).filter((m) => m.length > 0),
    source,
  };
}

/** Merge common wrapper keys (e.g. `{ data: { summaryExample: ... } }`) into one object. */
function flattenAiWritingPayload(parsed: unknown): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  let base: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
  for (const key of ['data', 'result', 'writingExamples', 'output', 'content', 'examples', 'response']) {
    const v = base[key];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      base = { ...base, ...(v as Record<string, unknown>) };
    }
  }
  return base;
}

function normalizeFaq(raw: unknown): { question: string; answer: string }[] {
  const out: { question: string; answer: string }[] = [];
  if (typeof raw === 'string' && raw.trim()) {
    return [
      { question: '', answer: raw.trim() },
      { question: '', answer: '' },
      { question: '', answer: '' },
    ];
  }
  if (!Array.isArray(raw)) return [{ question: '', answer: '' }, { question: '', answer: '' }, { question: '', answer: '' }];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const q = String(o.question ?? o.q ?? o.title ?? '').trim();
    const a = String(o.answer ?? o.a ?? o.text ?? '').trim();
    out.push({ question: q, answer: a });
  }
  while (out.length < 3) out.push({ question: '', answer: '' });
  return out.slice(0, 3);
}

const MAX_HEADING_SUGGESTIONS = 6;

/** AI returns 4–6 search-intent H2 lines; keep up to MAX, no padding to a fixed count. */
function normalizeHeadings(raw: unknown): string[] {
  if (typeof raw === 'string' && raw.trim()) {
    const lines = raw
      .split(/\n+/)
      .map((s) => s.replace(/^[-*•\d.)]+\s*/, '').trim())
      .filter(Boolean);
    return lines.slice(0, MAX_HEADING_SUGGESTIONS);
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x ?? '').trim())
    .filter((s) => s.length > 0)
    .slice(0, MAX_HEADING_SUGGESTIONS);
}

/** Extract first balanced `{ ... }` when the model wraps JSON in prose. */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Strip fenced ```json ... ``` anywhere in the string (multiline). */
function stripMarkdownCodeFences(text: string): string {
  return text
    .replace(/```(?:json)?\s*([\s\S]*?)```/gi, '$1')
    .trim();
}

/**
 * Try multiple strategies: direct parse, balanced braces, first greedy `{...}` match.
 */
function parseJsonFromLlmResponse(raw: string): { ok: true; value: unknown } | { ok: false } {
  const attempts: string[] = [];

  const unfenced = stripMarkdownCodeFences(raw);
  attempts.push(unfenced.trim());

  const trimmed = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (trimmed !== attempts[0]) attempts.push(trimmed);

  for (const candidate of attempts) {
    if (!candidate) continue;
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch {
      /* next */
    }
  }

  const balanced = extractJsonObject(raw);
  if (balanced) {
    try {
      return { ok: true, value: JSON.parse(balanced) };
    } catch {
      /* next */
    }
  }

  const greedy = raw.match(/\{[\s\S]*\}/);
  if (greedy?.[0]) {
    try {
      return { ok: true, value: JSON.parse(greedy[0]) };
    } catch {
      /* fail */
    }
  }

  return { ok: false };
}

function normalizeParsed(parsed: unknown): AiWritingExamplesData | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;

  // Canonical keys + common Gemini alternates (summary vs summaryExample, etc.)
  const summaryExample = String(
    o.summaryExample ?? o.summary ?? o.summary_example ?? o.summaryText ?? ''
  ).trim();

  const prosConsExample = String(
    o.prosConsExample ?? o.prosCons ?? o.pros_cons ?? o.prosAndCons ?? o.pros_and_cons ?? ''
  ).trim();

  const verdictExample = String(
    o.verdictExample ?? o.verdict ?? o.conclusion ?? o.verdict_section ?? o.closing ?? ''
  ).trim();

  const faqRaw = o.faqExamples ?? o.faq ?? o.faq_examples ?? o.FAQ ?? o.faqs;
  const faqExamples = normalizeFaq(faqRaw);

  const headingSuggestions = normalizeHeadings(
    o.headingSuggestions ??
      o.headings ??
      o.suggestedHeadings ??
      o.h2Suggestions ??
      o.h2_headings ??
      o.suggested_h2 ??
      o.h2Titles
  );

  const hasAny =
    summaryExample.length > 0 ||
    prosConsExample.length > 0 ||
    verdictExample.length > 0 ||
    faqExamples.some((f) => f.question.length > 0 || f.answer.length > 0) ||
    headingSuggestions.some((h) => h.length > 0);

  if (!hasAny) return null;

  return {
    summaryExample,
    faqExamples,
    prosConsExample,
    verdictExample,
    headingSuggestions,
  };
}

/** Try flat payload, then nested wrappers, before giving up. */
function normalizeWithFallbacks(parsed: unknown): AiWritingExamplesData | null {
  let data = normalizeParsed(parsed);
  if (data) return data;
  const flat = flattenAiWritingPayload(parsed);
  if (flat) {
    data = normalizeParsed(flat);
    if (data) return data;
  }
  return null;
}

export type GenerateAiWritingExamplesResult =
  | { ok: true; data: AiWritingExamplesData; guideRulePromptDebug?: AiWritingGuideRulePromptDebug }
  | {
      ok: false;
      message: string;
      reason: 'no_api_key' | 'quota' | 'parse' | 'error';
      detail: string;
    };

/**
 * Calls Gemini to produce editor-style example blocks. Does not use the Recommendation pipeline.
 */
export async function generateAiWritingExamples(
  input: AiWritingExamplesRequestBody
): Promise<GenerateAiWritingExamplesResult> {
  const keySource = getAiWritingExamplesKeySource();
  const modelId = getGeminiWritingExamplesModel();
  console.info('[ai-writing-examples]', {
    keySource,
    model: modelId,
    hint:
      keySource === 'dedicated'
        ? 'using GEMINI_WRITING_EXAMPLES_API_KEY'
        : keySource === 'paid_fallback'
          ? 'GEMINI_WRITING_EXAMPLES_API_KEY unset — using paid GOOGLE_GENAI_API_KEY'
          : 'no Gemini key configured',
  });

  const model = getGenerativeModelOrNull();
  if (!model) {
    return {
      ok: false,
      message: NO_API_KEY_MSG,
      reason: 'no_api_key',
      detail: 'Set GEMINI_WRITING_EXAMPLES_API_KEY (free) or GOOGLE_GENAI_API_KEY (paid fallback).',
    };
  }

  const useGuideFirst = Boolean(input.matchedGuideRules && input.matchedGuideRules.length > 0);
  const prompt = useGuideFirst ? buildGuideRuleFirstPrompt(input) : buildPrompt(input);
  const promptDebug = resolveGuideRulePromptDebug(input, useGuideFirst ? 'guideRules' : 'fallback');

  const callGeminiOnce = async () => {
    console.log('[AI WRITING] Gemini call start');
    try {
      await waitForGeminiRateLimitSlot('aiWritingExamples');
      const result = await model.generateContent([{ text: prompt }]);
      console.log('[AI WRITING] Gemini call success');
      return result;
    } catch (err) {
      console.log('[AI WRITING] Gemini call failed', err);
      throw err;
    }
  };

  try {
    let result: Awaited<ReturnType<typeof callGeminiOnce>>;
    try {
      result = await callGeminiOnce();
    } catch (e1) {
      if (!isQuotaError(e1)) throw e1;
      console.warn('[AI WRITING] retrying after rate limit...');
      await delay(RATE_LIMIT_RETRY_DELAY_MS);
      result = await callGeminiOnce();
    }

    let raw: string;
    try {
      raw = result.response.text().trim();
    } catch (textErr) {
      const msg = textErr instanceof Error ? textErr.message : String(textErr);
      const stack = textErr instanceof Error ? textErr.stack : undefined;
      console.error('[generateAiWritingExamples] response.text() failed', { message: msg, stack });
      return {
        ok: false,
        message: GENERATION_FAILED_MSG,
        reason: 'error',
        detail: stack ? `${msg.slice(0, 300)} | ${stack.slice(0, 400)}` : msg.slice(0, 500),
      };
    }

    console.log('[AI WRITING RAW RESPONSE]', raw);

    const parsedJson = parseJsonFromLlmResponse(raw);
    if (!parsedJson.ok) {
      console.error('[AI WRITING PARSE FAILED]', raw);
      return {
        ok: false,
        message: GENERATION_FAILED_MSG,
        reason: 'parse',
        detail:
          'JSON parse failed after all extractors. See server log [AI WRITING PARSE FAILED] for full raw.',
      };
    }

    try {
      const serialized = JSON.stringify(parsedJson.value, null, 2);
      console.log(
        '[AI WRITING PARSED JSON]',
        serialized.length > 16000 ? `${serialized.slice(0, 16000)}… (${serialized.length} chars)` : serialized
      );
    } catch {
      console.log('[AI WRITING PARSED JSON] (non-serializable)', String(parsedJson.value).slice(0, 2000));
    }

    const data = normalizeWithFallbacks(parsedJson.value);
    if (!data) {
      const parsedObj =
        parsedJson.value && typeof parsedJson.value === 'object'
          ? (parsedJson.value as Record<string, unknown>)
          : null;
      const keys = parsedObj ? Object.keys(parsedObj) : [];
      console.error('[AI WRITING NORMALIZE FAILED]', keys);
      console.error(
        '[AI WRITING NORMALIZE FAILED] raw:',
        raw.length > 6000 ? `${raw.slice(0, 6000)}…` : raw
      );
      return {
        ok: false,
        message: GENERATION_FAILED_MSG,
        reason: 'parse',
        detail: `normalizeParsed: no usable fields (top-level keys: ${keys.length ? keys.slice(0, 20).join(', ') : 'n/a'}). Try nested wrappers or alternate key names.`,
      };
    }

    try {
      const out = JSON.stringify(data, null, 2);
      console.log(
        '[AI WRITING NORMALIZED RESULT]',
        out.length > 12000 ? `${out.slice(0, 12000)}…` : out
      );
    } catch {
      console.log('[AI WRITING NORMALIZED RESULT] (log truncated)');
    }

    return { ok: true, data, guideRulePromptDebug: promptDebug };
  } catch (err) {
    if (isQuotaError(err)) {
      const sec = extractRetryAfterSeconds(err);
      if (sec != null) setLlmCooldown(sec);
      return {
        ok: false,
        message: QUOTA_MSG,
        reason: 'quota',
        detail: 'Gemini quota or rate limit (429). See server logs.',
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('[generateAiWritingExamples] exception', { message: msg, stack });
    return {
      ok: false,
      message: GENERATION_FAILED_MSG,
      reason: 'error',
      detail: stack ? `${msg.slice(0, 300)} | stack: ${stack.slice(0, 400)}` : msg.slice(0, 500),
    };
  }
}
