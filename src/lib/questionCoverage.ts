import type { SearchQuestion } from './analysisTypes';
import type { CoverageMatchInput } from './coverageSurfaces';

/** 본문/질문 토큰 매칭 비율 — 50%: 질문의 과반 핵심어가 문서에 등장해야 답변 완료 인정 */
const TOKEN_MATCH_RATIO = 0.5;
/** H2 등과 교집합 최소 토큰 수 (짧은 질문(4토큰 이하)은 2토큰 허용) */
const MIN_INTERSECTION = 3;
const MIN_INTERSECTION_SHORT = 2;
const SHORT_QUESTION_TOKEN_THRESHOLD = 4;

/** Meaningful-token coverage fallback when pageQuestions is empty or token match is borderline */
const MEANINGFUL_COVERAGE_RATIO = 0.45;

function tokenizeForMatch(s: string, minLen: number): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= minLen);
}

const STOP_MEANINGFUL = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'are', 'was', 'were', 'has', 'have', 'had',
  'not', 'but', 'you', 'your', 'our', 'can', 'get', 'how', 'what', 'when', 'why', 'who', 'which',
  '그리고', '하지만', '그런데', '있는', '없는', '하는', '되는', '같은', '위한', '대한', '관련', '있나요',
]);

function meaningfulTokens(s: string): string[] {
  return tokenizeForMatch(s, 2).filter((t) => t.length >= 3 && !STOP_MEANINGFUL.has(t));
}

/** Top 8 검색 질문과 본문 토큰 매칭률 — 0~100. 질문 토큰의 50% 이상 포함 시 hit */
export function computeQuestionMatchScore(
  questions: SearchQuestion[],
  contentText: string
): number {
  if (!questions?.length || !contentText) return 0;
  const text = contentText.toLowerCase();
  const top = questions.slice(0, 8);
  let hit = 0;
  for (const q of top) {
    const tokens = q.text
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 3);
    const tokenHit =
      tokens.length ? tokens.filter((t) => text.includes(t)).length / tokens.length : 0;
    if (tokenHit >= 0.5) hit += 1;
  }
  return Math.round((hit / top.length) * 100);
}

/**
 * Compare canonical search question intents against page surfaces (title, headings, intro, FAQ, key lines, body).
 * Uses topic-token fallback when pageQuestions is empty so coverage does not collapse to zero.
 */
export function computeSearchQuestionCoverage(
  canonicalSearchQuestions: SearchQuestion[],
  input: CoverageMatchInput
): boolean[] {
  if (!canonicalSearchQuestions || canonicalSearchQuestions.length === 0) return [];

  const primaryLower = (
    input.pageTitle +
    '\n' +
    input.headingsText +
    '\n' +
    input.prioritySurface +
    '\n' +
    input.pageQuestions.join(' ')
  )
    .toLowerCase();

  const fullLower = input.fullContent.toLowerCase();
  const topicSet = new Set(input.topicTokens.filter((t) => t.length >= 2));
  const covered: boolean[] = [];

  for (const searchQ of canonicalSearchQuestions) {
    const searchTokens = tokenizeForMatch(searchQ.text, 2);
    if (searchTokens.length === 0) {
      covered.push(false);
      continue;
    }

    const minMatch = Math.max(1, Math.ceil(searchTokens.length * TOKEN_MATCH_RATIO));

    const countIn = (blob: string) => searchTokens.filter((t) => blob.includes(t)).length;

    if (countIn(primaryLower) >= minMatch) {
      covered.push(true);
      continue;
    }

    if (countIn(fullLower) >= minMatch) {
      covered.push(true);
      continue;
    }

    if (input.pageQuestions.length > 0) {
      const minIntersection =
        searchTokens.length <= SHORT_QUESTION_TOKEN_THRESHOLD ? MIN_INTERSECTION_SHORT : MIN_INTERSECTION;
      let coveredByPageQ = false;
      for (const pageQ of input.pageQuestions) {
        const pageTokens = tokenizeForMatch(pageQ, 2);
        const intersection = searchTokens.filter((t) => pageTokens.includes(t));
        if (intersection.length >= minIntersection) {
          coveredByPageQ = true;
          break;
        }
      }
      if (coveredByPageQ) {
        covered.push(true);
        continue;
      }
    }

    const mq = meaningfulTokens(searchQ.text);
    if (mq.length > 0) {
      const blob = `${primaryLower}\n${fullLower}`;
      let hits = 0;
      for (const t of mq) {
        if (blob.includes(t)) hits++;
      }
      if (hits / mq.length >= MEANINGFUL_COVERAGE_RATIO) {
        covered.push(true);
        continue;
      }
    }

    let topicChecks = 0;
    let topicHits = 0;
    for (const t of searchTokens) {
      const inTopic =
        topicSet.has(t) ||
        input.topicTokens.some((tt) => tt.includes(t) || (t.length >= 3 && tt.includes(t)));
      if (inTopic) {
        topicChecks++;
        if (primaryLower.includes(t) || fullLower.includes(t)) topicHits++;
      }
    }
    if (topicChecks >= 1 && topicHits >= Math.max(1, Math.ceil(topicChecks * 0.5))) {
      covered.push(true);
      continue;
    }

    covered.push(false);
  }

  return covered;
}
