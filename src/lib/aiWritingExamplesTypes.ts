/**
 * Shared types for POST /api/ai-writing-examples (AI Writing Assistant layer).
 * Safe to import from client components — no Gemini / server-only deps.
 */

export const AI_WRITING_EXAMPLES_PAGE_TYPES = [
  'editorial',
  'commerce',
  'video',
  'review',
  'site_info',
] as const;

export type AiWritingExamplesPageType = (typeof AI_WRITING_EXAMPLES_PAGE_TYPES)[number];

export function isAiWritingExamplesPageType(v: unknown): v is AiWritingExamplesPageType {
  return (
    typeof v === 'string' &&
    (AI_WRITING_EXAMPLES_PAGE_TYPES as readonly string[]).includes(v)
  );
}

/** Matched GEO guide rules from analysis (config-driven); drives guide-first example generation. */
export interface AiWritingMatchedGuideRule {
  id: string;
  message: string;
  priority?: string;
}

export interface AiWritingExamplesRequestBody {
  url: string;
  title: string;
  contentSnippet: string;
  /** Same as contentSnippet — optional alias for API clients. */
  contentText?: string;
  /** Same as title — optional alias. */
  pageTitle?: string;
  pageType: AiWritingExamplesPageType;
  questions: string[];
  recommendedSections: string[];
  /** Hosting surface from analysis (e.g. naver_blog) — context only. */
  platform?: string;
  /**
   * Rules that matched for this page (from recommendations.guideGenerationDebug.matchedGuideRules).
   * When non-empty, Gemini follows these as the primary writing instruction.
   */
  matchedGuideRules?: AiWritingMatchedGuideRule[];
  /** Issue ids from the same analysis run — context only; AI does not re-classify. */
  relatedIssueIds?: string[];
  /** Optional: first priority guide line shown in UI (same analysis). */
  currentGuideText?: string;
  /** UI locale for template fallback copy */
  locale?: 'ko' | 'en';
  /** Skip server cache and call Gemini again */
  forceRefresh?: boolean;
}

/** Stable key segment for AI writing caches — changes when matched guide rules change. */
export function getAiWritingGuideCacheSignature(
  body: Pick<AiWritingExamplesRequestBody, 'matchedGuideRules'>
): string {
  const m = body.matchedGuideRules;
  if (!m?.length) return 'noguide';
  return m
    .map((r) => r.id)
    .sort()
    .join('|');
}

export interface AiWritingExamplesFaqItem {
  question: string;
  answer: string;
}

export interface AiWritingExamplesData {
  summaryExample: string;
  faqExamples: AiWritingExamplesFaqItem[];
  prosConsExample: string;
  verdictExample: string;
  headingSuggestions: string[];
}

/** Non-breaking: how guide-first prompting was applied (server-side). */
export interface AiWritingGuideRulePromptDebug {
  usedGuideRuleIds: string[];
  usedGuideMessages: string[];
  source: 'guideRules' | 'fallback';
}

export type AiWritingExamplesApiResponse =
  | {
      aiAvailable: true;
      data: AiWritingExamplesData;
      /** Hit in-memory server cache (same process) */
      serverCached?: boolean;
      /** True when AI failed (e.g. quota) and templates were returned */
      degraded?: boolean;
      degradedReason?: 'quota';
      /** User-facing banner (quota message or template explanation) */
      notice?: string;
      /** Optional: which guide rules shaped the Gemini prompt (guide-first vs classic). */
      guideRulePromptDebug?: AiWritingGuideRulePromptDebug;
    }
  | {
      aiAvailable: false;
      message: string;
      /** Always set for failed generations — why it failed (safe to show in UI). */
      detail: string;
      keySource?: 'dedicated' | 'paid_fallback' | 'none';
      /** Pipeline stage for debugging. */
      reason?: 'no_api_key' | 'quota' | 'parse' | 'error';
    };
