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

export interface AiWritingExamplesRequestBody {
  url: string;
  title: string;
  contentSnippet: string;
  pageType: AiWritingExamplesPageType;
  questions: string[];
  recommendedSections: string[];
  /** UI locale for template fallback copy */
  locale?: 'ko' | 'en';
  /** Skip server cache and call Gemini again */
  forceRefresh?: boolean;
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
