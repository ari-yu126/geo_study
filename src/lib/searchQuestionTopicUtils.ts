/**
 * Topic alignment for search-question pipeline: drop noisy SERP snippets so
 * questionMatch / canonical intents reflect real topical overlap with the page.
 */

import type { SearchQuestion } from './analysisTypes';

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
