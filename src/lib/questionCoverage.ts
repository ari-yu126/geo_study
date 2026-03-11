import type { SearchQuestion } from './analysisTypes';

/** 본문/질문 토큰 매칭 비율 — 50%: 질문의 과반 핵심어가 문서에 등장해야 답변 완료 인정 */
const TOKEN_MATCH_RATIO = 0.5;
/** H2 등과 교집합 최소 토큰 수 (짧은 질문(4토큰 이하)은 2토큰 허용) */
const MIN_INTERSECTION = 3;
const MIN_INTERSECTION_SHORT = 2;
const SHORT_QUESTION_TOKEN_THRESHOLD = 4;

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
    const tokens = q.text.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
    const tokenHit =
      tokens.length ? tokens.filter((t) => text.includes(t)).length / tokens.length : 0;
    if (tokenHit >= 0.5) hit += 1;
  }
  return Math.round((hit / top.length) * 100);
}

export function computeSearchQuestionCoverage(
  pageQuestions: string[],
  searchQuestions: SearchQuestion[],
  contentText: string
): boolean[] {
  if (!searchQuestions || searchQuestions.length === 0) return [];

  const questionText = pageQuestions.join(' ').toLowerCase();
  const fullText = contentText.toLowerCase();
  const covered: boolean[] = [];

  for (const searchQ of searchQuestions) {
    const searchTokens = searchQ.text.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
    if (searchTokens.length === 0) {
      covered.push(false);
      continue;
    }

    const minMatch = Math.max(1, Math.ceil(searchTokens.length * TOKEN_MATCH_RATIO));

    let fullTextMatches = 0;
    for (const token of searchTokens) {
      if (fullText.includes(token)) fullTextMatches++;
    }
    if (fullTextMatches >= minMatch) {
      covered.push(true);
      continue;
    }

    let questionMatches = 0;
    for (const token of searchTokens) {
      if (questionText.includes(token)) questionMatches++;
    }
    if (questionMatches >= minMatch) {
      covered.push(true);
      continue;
    }

    const minIntersection =
      searchTokens.length <= SHORT_QUESTION_TOKEN_THRESHOLD ? MIN_INTERSECTION_SHORT : MIN_INTERSECTION;
    let coveredByPageQ = false;
    for (const pageQ of pageQuestions) {
      const pageTokens = pageQ.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
      const intersection = searchTokens.filter((t) => pageTokens.includes(t));
      if (intersection.length >= minIntersection) {
        coveredByPageQ = true;
        break;
      }
    }
    covered.push(coveredByPageQ);
  }

  return covered;
}
