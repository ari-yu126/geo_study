/**
 * Topic alignment for search-question pipeline: drop noisy SERP snippets so
 * questionMatch / canonical intents reflect real topical overlap with the page.
 */

import type { SearchQuestion, SearchSource } from './analysisTypes';

/** Marketing / trend one-liners often unrelated to a specific product how-to page */
const GENERIC_SERP_NOISE_PATTERNS: RegExp[] = [
  /\b(sustainability|carbon\s*neutral|net\s*zero|ESG|climate\s*action)\b/i,
  /지속가능|탄소중립|탄소\s*배출|친환경\s*경영|사회적\s*가치|그린\s*뉴딜/,
  /\b(keyboard\s*layout|QWERTY|DVORAK|colemak)\b/i,
  /키보드\s*배열|한영\s*전환\s*키|키\s*매크로|LED\s*커스텀|키보드\s*디스플레이/,
];

export function countEssentialTokenHits(text: string, essentialTokens: string[]): number {
  if (!essentialTokens.length) return 0;
  const lower = text.toLowerCase();
  let n = 0;
  for (const tok of essentialTokens) {
    const t = tok.toLowerCase().trim();
    if (t.length < 2) continue;
    if (lower.includes(t)) n++;
  }
  return n;
}

function looksLikeGenericSerpNoise(text: string, essentialHits: number): boolean {
  if (essentialHits >= 2) return false;
  for (const re of GENERIC_SERP_NOISE_PATTERNS) {
    if (re.test(text)) return true;
  }
  return false;
}

/**
 * True when the question text is plausibly about the same topic as primaryPhrase / essential tokens.
 */
export function isSearchQuestionAlignedWithTopic(
  text: string,
  primaryPhrase: string,
  essentialTokens: string[]
): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 8) return false;

  const phrase = primaryPhrase.trim();
  const lower = trimmed.toLowerCase();
  if (phrase.length >= 3 && lower.includes(phrase.toLowerCase())) return true;

  if (essentialTokens.length === 0) return true;

  const hits = countEssentialTokenHits(trimmed, essentialTokens);

  const minHits =
    essentialTokens.length >= 5
      ? Math.max(2, Math.ceil(essentialTokens.length * 0.4))
      : essentialTokens.length >= 3
        ? 2
        : 1;

  if (hits >= minHits) return true;
  if (looksLikeGenericSerpNoise(trimmed, hits)) return false;
  return false;
}

export function filterSearchQuestionsByTopicAlignment(
  questions: SearchQuestion[],
  primaryPhrase: string,
  essentialTokens: string[]
): SearchQuestion[] {
  return questions.filter((q) => isSearchQuestionAlignedWithTopic(q.text, primaryPhrase, essentialTokens));
}

const FALLBACK_SOURCE: SearchSource = 'google';

/**
 * Short intent-style questions anchored on primaryPhrase (used when evidence is too noisy).
 */
export function buildTopicIntentFallbackQuestions(primaryPhrase: string, isEnglish: boolean): SearchQuestion[] {
  const p = primaryPhrase.trim() || '이 주제';
  if (isEnglish) {
    return [
      { source: FALLBACK_SOURCE, text: `What types or options matter most when choosing ${p}?` },
      { source: FALLBACK_SOURCE, text: `When is ${p} the right choice for beginners vs advanced users?` },
      { source: FALLBACK_SOURCE, text: `What are the main differences or trade-offs for ${p}?` },
      { source: FALLBACK_SOURCE, text: `What practical questions do people ask most often about ${p}?` },
    ];
  }
  return [
    { source: FALLBACK_SOURCE, text: `${p}의 종류나 특징은 무엇인가요?` },
    { source: FALLBACK_SOURCE, text: `${p}를 고를 때 어떤 기준으로 비교하면 좋나요?` },
    { source: FALLBACK_SOURCE, text: `${p}는 어떤 상황이나 사용자에게 적합한가요?` },
    { source: FALLBACK_SOURCE, text: `입문자는 ${p}를 어떻게 시작하면 좋나요?` },
  ];
}
