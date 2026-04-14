/**
 * Last-resort search-intent questions when Tavily + filters yield zero rows.
 * Topic labels are aggressively reduced to short search-query-style noun phrases (not page-title echoes).
 */

import type { PageType, QuestionCoverageDebug, SearchQuestion, SeedKeyword } from './analysisTypes';

export type TopicForQuestionFallback = {
  primary: string;
  secondary?: string;
};

/** Short Hangul product/class nouns — never treat as brand tails when trimming (generic commerce, not copy examples). */
const PRODUCT_CLASS_HANGUL = new Set([
  '마우스',
  '키보드',
  '모니터',
  '이어폰',
  '헤드셋',
  '노트북',
  '태블릿',
  '스마트폰',
  '충전기',
  '어댑터',
  '케이스',
  '스피커',
  '마이크',
  '웹캠',
  '프린터',
  '스캐너',
]);

/** Descriptors to keep with category head (not brand). */
const DESCRIPTOR_HANGUL = new Set([
  '무선',
  '유선',
  '사무용',
  '게이밍',
  '버티컬',
  '인체공학',
  '기계식',
  '저소음',
  '블루투스',
]);

const LEADING_TRAILER_PATTERNS: RegExp[] = [
  /^\s*\[[^\]]{0,48}\]\s*/u,
  /^\s*\([^)]{0,32}\)\s*/u,
  /^\d+[\.\)]\s*/,
  /\s*[\|｜]\s*.+$/u,
  /\s+[-–—]\s+(reddit|youtube|twitter|facebook|instagram|blog|medium|tistory|naver|velog)[^\s]*$/iu,
  /\s*\(\s*\d{4}\s*(-\s*\d{4})?\s*\)\s*$/u,
];

/** Inline / anywhere title-marketing fragments (repeat passes). */
const INLINE_MARKETING: RegExp[] = [
  /\d+일간\s*판매량?\s*베스트?/gi,
  /\d+일간\s*베스트?/gi,
  /판매량?\s*베스트/gi,
  /(?:^|\s)TOP\s*\d+(?:\s|$)/gi,
  /\s*#\s*\d+\s*위/gi,
  /\s*\d+\s*위\s*(?:안에|중|짜리)?/gi,
  /끝판왕|베스트셀러|인기\s*템|추천\s*템|필수\s*템/gu,
  /\bBEST\b|\bTOP\b/gi,
];

const HEADLINE_FLUFF: RegExp[] = [
  /^(?:top\s*\d+|#\s*\d+|탑\s*\d+)\s*/iu,
  /^(?:best|top\s+pick|ultimate|complete)\s+/iu,
  /^(?:최고의|베스트|탑\s*\d+)\s*/u,
  /\s+(?:리뷰|비교|추천|정리|총정리|완벽|필독|핵심|후기|실사용|가이드)\s*$/u,
];

/** Tokens removed anywhere (marketing / listicle noise). */
const MARKETING_TOKEN = new Set(
  [
    '추천',
    '리뷰',
    '비교',
    '총정리',
    '정리',
    '후기',
    '실사용',
    '가이드',
    '완벽',
    '필독',
    '핵심',
    '베스트',
    'best',
    'top',
    'BEST',
    'TOP',
    '끝판왕',
    '인기',
    '판매량',
    '베스트셀러',
  ].map((x) => x.toLowerCase())
);

function stripMarketingAndTitleNoise(s: string): string {
  let t = s.replace(/\s+/g, ' ').trim();
  for (let pass = 0; pass < 4; pass++) {
    for (const re of LEADING_TRAILER_PATTERNS) {
      t = t.replace(re, ' ').trim();
    }
    for (const re of INLINE_MARKETING) {
      t = t.replace(re, ' ').trim();
    }
    for (const re of HEADLINE_FLUFF) {
      t = t.replace(re, ' ').trim();
    }
  }
  return t.replace(/\s+/g, ' ').trim();
}

function tokenizeWords(s: string): string[] {
  return s
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isLikelyBrandOrListTailToken(t: string): boolean {
  const s = t.trim();
  if (/^[A-Za-z][A-Za-z0-9+\-]{1,}$/.test(s)) return true;
  if (PRODUCT_CLASS_HANGUL.has(s) || DESCRIPTOR_HANGUL.has(s)) return false;
  if (/^[가-힣]{2,5}$/.test(s)) {
    return !PRODUCT_CLASS_HANGUL.has(s);
  }
  return false;
}

/** Drop trailing tokens that look like brand / listicle tails until at most 3 tokens or non-brand tail. */
function trimTrailingBrandEnumeration(tokens: string[]): string[] {
  if (tokens.length <= 2) return tokens;
  const out = [...tokens];
  while (out.length > 2 && isLikelyBrandOrListTailToken(out[out.length - 1]!)) {
    out.pop();
  }
  if (out.length >= 4) {
    return out.slice(0, Math.min(3, out.length));
  }
  return out;
}

function removeMarketingTokens(tokens: string[]): string[] {
  return tokens.filter((tok) => {
    const low = tok.toLowerCase();
    if (MARKETING_TOKEN.has(low)) return false;
    if (/^\d{4}년?$/.test(tok)) return false;
    if (/^\d+일간?$/.test(tok)) return false;
    return true;
  });
}

/**
 * Reduce to a short search-query-style noun phrase (not a page title paraphrase).
 */
export function cleanTopicPhrase(raw: string, maxLen = 48): string {
  let stripped = stripMarketingAndTitleNoise(raw);
  if (stripped.length < 2) return '';

  let tokens = tokenizeWords(stripped);
  tokens = removeMarketingTokens(tokens);
  tokens = trimTrailingBrandEnumeration(tokens);

  let t = tokens.join(' ').trim();
  if (t.length < 2) return '';

  if (t.length > maxLen) {
    const slice = t.slice(0, maxLen);
    const sp = slice.lastIndexOf(' ');
    t = sp > 8 ? slice.slice(0, sp) : slice;
  }
  return t.replace(/\s+/g, ' ').trim();
}

function normKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isDistinctSecondary(primaryNorm: string, candidate: string): boolean {
  const n = normKey(candidate);
  if (n.length < 2 || n === primaryNorm) return false;
  if (n.includes(primaryNorm) || primaryNorm.includes(n)) {
    return Math.abs(n.length - primaryNorm.length) > 8;
  }
  return true;
}

export type TopicExtractionDebug = {
  rawTopicCandidates: string[];
  cleanedPrimaryTopic: string;
  cleanedSecondaryTopic: string | null;
};

function collectRawTopicCandidates(params: {
  primaryPhrase: string;
  essentialTokens: string[];
  seedKeywords: SeedKeyword[];
}): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const x = s.trim();
    if (x.length >= 2) out.push(x);
  };
  push(params.primaryPhrase);
  const seeds = [...params.seedKeywords].sort((a, b) => b.score - a.score);
  for (const sk of seeds) push(sk.value);
  for (const t of params.essentialTokens) push(t);
  return out;
}

export function extractTopicForFallback(params: {
  primaryPhrase: string;
  essentialTokens: string[];
  seedKeywords: SeedKeyword[];
}): TopicForQuestionFallback & { debug: TopicExtractionDebug } {
  const rawTopicCandidates = collectRawTopicCandidates(params);
  const cleanedList = rawTopicCandidates
    .map((r) => ({ raw: r, cleaned: cleanTopicPhrase(r) }))
    .filter((x) => x.cleaned.length >= 2);

  let primary = cleanedList[0]?.cleaned ?? '';
  if (!primary) {
    primary = '이 주제';
  }

  const primaryNorm = normKey(primary);
  let secondary: string | undefined;

  for (const { cleaned } of cleanedList.slice(1)) {
    if (isDistinctSecondary(primaryNorm, cleaned)) {
      secondary = cleaned;
      break;
    }
  }

  const debug: TopicExtractionDebug = {
    rawTopicCandidates,
    cleanedPrimaryTopic: primary,
    cleanedSecondaryTopic: secondary ?? null,
  };

  return { primary, secondary, debug };
}

function shuffleIndices(n: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

export function generateSearchIntentFallbackQuestions(
  topic: TopicForQuestionFallback,
  isEnglish: boolean
): SearchQuestion[] {
  const p = topic.primary.trim();
  const p2 = topic.secondary?.trim();
  const hasCompare = !!(p2 && p2.length >= 2);

  const ko: (() => string)[] = [
    () => `${p} 추천 기준은?`,
    () => `${p} 선택할 때 중요한 점은?`,
    () => `${p} 장단점은?`,
    () => `${p} 어떤 사람에게 적합한가요?`,
  ];
  if (hasCompare) {
    ko.push(() => `${p}와 ${p2} 차이는?`);
  }

  const en: (() => string)[] = [
    () => `What criteria matter when choosing ${p}?`,
    () => `What matters when selecting ${p}?`,
    () => `What are the pros and cons of ${p}?`,
    () => `Who is ${p} a good fit for?`,
  ];
  if (hasCompare) {
    en.push(() => `How do ${p} and ${p2} differ?`);
  }

  const pool = isEnglish ? en : ko;
  const order = shuffleIndices(pool.length).slice(0, 3);
  const texts = order.map((i) => pool[i]());
  return texts.map((text) => ({ source: 'google' as const, text }));
}

export type SearchQuestionFallbackContext = {
  normalizedUrl: string;
  pageType: PageType;
  primaryPhrase: string;
  essentialTokens: string[];
  seedKeywords: SeedKeyword[];
  isEnglishPage: boolean;
  /** Pipeline counts before fallback (for diagnosing over-use / empty canonical). */
  debugCounts?: {
    afterFetchTopicQuality?: number;
    afterPageRelevanceFilter?: number;
    afterCanonicalBeforeFallback?: number;
  };
};

function inferFallbackReason(d: SearchQuestionFallbackContext['debugCounts']): string {
  if (!d) return 'unknown';
  const a = d.afterFetchTopicQuality ?? 0;
  const b = d.afterPageRelevanceFilter ?? 0;
  const c = d.afterCanonicalBeforeFallback ?? 0;
  if (a === 0) return 'no_questions_after_fetch_tavily_and_internal_filters';
  if (b === 0 && a > 0) return 'page_relevance_filter_removed_all';
  if (c === 0 && b > 0) return 'canonical_step_dropped_all_evidence_topic_alignment_or_dedupe';
  if (c === 0) return 'empty_canonical_list';
  return 'unexpected';
}

/**
 * If `searchQuestions` is empty, fill with 3 randomized generic search-intent questions. Otherwise unchanged.
 */
export function applySearchQuestionsFallbackIfEmpty(
  searchQuestions: SearchQuestion[],
  ctx: SearchQuestionFallbackContext
): { searchQuestions: SearchQuestion[]; fallbackUsed: boolean } {
  const tavilyDerivedCountBeforeFallback = searchQuestions.length;

  if (searchQuestions.length > 0) {
    if (process.env.QUESTION_FALLBACK_DECISION_DEBUG === '1') {
      console.log(
        '[QUESTION_FALLBACK_DECISION]',
        JSON.stringify({
          normalizedUrl: ctx.normalizedUrl,
          pageType: ctx.pageType,
          tavilyDerivedQuestionCountBeforeFallback: tavilyDerivedCountBeforeFallback,
          pipelineCounts: ctx.debugCounts ?? null,
          fallbackUsed: false,
          fallbackReason: 'not_needed_canonical_has_questions',
        })
      );
    }
    return { searchQuestions, fallbackUsed: false };
  }

  const extracted = extractTopicForFallback({
    primaryPhrase: ctx.primaryPhrase,
    essentialTokens: ctx.essentialTokens,
    seedKeywords: ctx.seedKeywords,
  });
  const { primary, secondary, debug } = extracted;
  const topic: TopicForQuestionFallback = { primary, secondary };
  const generated = generateSearchIntentFallbackQuestions(topic, ctx.isEnglishPage);

  const reason = inferFallbackReason(ctx.debugCounts);

  if (process.env.QUESTION_FALLBACK_DECISION_DEBUG === '1') {
    console.log(
      '[QUESTION_FALLBACK_TOPIC]',
      JSON.stringify({
        normalizedUrl: ctx.normalizedUrl,
        pageType: ctx.pageType,
        rawTopicCandidates: debug.rawTopicCandidates,
        cleanedPrimaryTopic: debug.cleanedPrimaryTopic,
        cleanedSecondaryTopic: debug.cleanedSecondaryTopic,
        generatedFallbackQuestions: generated.map((q) => q.text),
      })
    );

    console.log(
      '[QUESTION_FALLBACK_DECISION]',
      JSON.stringify({
        normalizedUrl: ctx.normalizedUrl,
        pageType: ctx.pageType,
        tavilyDerivedQuestionCountBeforeFallback: tavilyDerivedCountBeforeFallback,
        pipelineCounts: ctx.debugCounts ?? null,
        fallbackUsed: true,
        fallbackReason: reason,
      })
    );

    console.log(
      '[QUESTION_FALLBACK_USED]',
      JSON.stringify({
        normalizedUrl: ctx.normalizedUrl,
        pageType: ctx.pageType,
        fallbackUsed: true,
      })
    );
  }

  return { searchQuestions: generated, fallbackUsed: true };
}

type QuestionDisplaySlice = {
  searchQuestions: SearchQuestion[];
  searchQuestionCovered: boolean[];
  uncoveredOrderedForRecommendations: SearchQuestion[];
  debug?: QuestionCoverageDebug;
};

export function whenDisplayEmptyUseCanonical(
  display: QuestionDisplaySlice,
  canonicalQs: SearchQuestion[],
  canonicalCovered: boolean[]
): QuestionDisplaySlice {
  if (display.searchQuestions.length > 0 || canonicalQs.length === 0) return display;
  return {
    searchQuestions: [...canonicalQs],
    searchQuestionCovered: [...canonicalCovered],
    uncoveredOrderedForRecommendations: canonicalQs.filter((_, i) => !(canonicalCovered[i] ?? false)),
    debug: undefined,
  };
}
