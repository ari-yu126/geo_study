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

/** Contiguous Hangul runs (Korean has no spaces between words; whitespace split misses lemmas). */
function hangulChunks(s: string): string[] {
  const m = s.match(/[\p{Script=Hangul}]{2,}/gu) ?? [];
  return m.map((x) => x.toLowerCase());
}

const HANGUL_CHUNK_STOP = new Set([
  '있나요',
  '되나요',
  '인가요',
  '무엇인가요',
  '어떻게',
  '무엇을',
  '알려주는',
  '알려주세요',
]);

/** Body may use noun stem while questions use noun+particle (e.g. 스위치 vs 스위치를). */
function hangulChunkAppearsInBody(chunk: string, body: string): boolean {
  const c = chunk.toLowerCase();
  if (c.length < 2) return false;
  if (body.includes(c)) return true;
  for (let len = c.length - 1; len >= 2; len--) {
    if (body.includes(c.slice(0, len))) return true;
  }
  return false;
}

/**
 * True when body text plausibly addresses the question intent without requiring exact phrasing.
 * Uses: whitespace/Latin tokens, meaningful tokens, Hangul substrings, and topic-token bridge.
 */
export function questionTextMatchesBody(
  questionText: string,
  contentText: string,
  topicTokens: string[] = []
): boolean {
  const body = contentText.toLowerCase();
  const q = questionText.trim();
  if (!q || !body) return false;

  const tokens = tokenizeForMatch(q, 2);
  if (tokens.length > 0) {
    const minTok = Math.max(1, Math.ceil(tokens.length * 0.4));
    const tokHits = tokens.filter((t) => body.includes(t)).length;
    if (tokHits >= minTok) return true;
  }

  const mq = meaningfulTokens(q);
  if (mq.length > 0) {
    const mh = mq.filter((t) => body.includes(t)).length;
    if (mh / mq.length >= 0.4) return true;
  }

  const chunks = hangulChunks(q).filter((h) => !HANGUL_CHUNK_STOP.has(h) && h.length >= 2);
  if (chunks.length > 0) {
    const ch = chunks.filter((h) => hangulChunkAppearsInBody(h, body)).length;
    const ratioNeed = chunks.length >= 6 ? 0.34 : 0.38;
    if (ch / chunks.length >= ratioNeed) return true;
  }

  const topics = topicTokens.map((t) => t.toLowerCase()).filter((t) => t.length >= 2);
  if (topics.length >= 2) {
    const ql = q.toLowerCase();
    const inQ = topics.filter((t) => ql.includes(t));
    const inBody = topics.filter((t) => body.includes(t));
    if (inBody.length >= 2 && inQ.length >= 1) return true;
    if (inQ.length >= 2 && inQ.every((t) => body.includes(t))) return true;
  }

  return false;
}

/**
 * Editorial blog: SERP-shaped canonical questions often diverge from on-page phrasing even when
 * questionCoverage already signals topical alignment. Blend in coverage so finalScore is not doubly
 * penalized. Only applies when coverage is at least moderate (avoids lifting irrelevant pages).
 */
export function softenQuestionMatchForEditorialBlog(
  questionMatchScore: number,
  questionCoverageScore: number
): number {
  if (questionCoverageScore < 48) return questionMatchScore;
  const blended = Math.round(0.72 * questionMatchScore + 0.28 * questionCoverageScore);
  return Math.min(100, Math.max(questionMatchScore, blended));
}

export interface QuestionMatchScoreOptions {
  /** Page essential topic tokens — enables topic bridge when question templates share wording with title */
  topicTokens?: string[];
}

/**
 * Top 8 canonical questions vs full body — 0~100.
 * Uses multilingual / Hangul-aware alignment (`questionTextMatchesBody`), not whitespace-only token hit.
 * Pass topicTokens when available so template questions that echo the page topic still score when body matches.
 */
export function computeQuestionMatchScore(
  questions: SearchQuestion[],
  contentText: string,
  options?: QuestionMatchScoreOptions
): number {
  if (!questions?.length || !contentText) return 0;
  const text = contentText.toLowerCase();
  const top = questions.slice(0, 8);
  const topicTokens = options?.topicTokens ?? [];
  let hit = 0;
  for (const q of top) {
    if (questionTextMatchesBody(q.text, text, topicTokens)) hit += 1;
  }
  return Math.round((hit / top.length) * 100);
}

/** Per-question coverage decision for debugging / tracing (same logic as boolean coverage). */
export type SearchQuestionCoverageRowDetail = {
  covered: boolean;
  branch:
    | 'no_search_tokens'
    | 'primary_surface_token_ratio'
    | 'full_body_token_ratio'
    | 'page_questions_intersection'
    | 'meaningful_token_ratio'
    | 'topic_token_bridge'
    | 'uncovered';
  reason: string;
  matchedTokens?: number;
  minTokensNeeded?: number;
};

type CoverageSurfaces = {
  primaryLower: string;
  fullLower: string;
  topicSet: Set<string>;
};

function buildCoverageSurfaces(input: CoverageMatchInput): CoverageSurfaces {
  const primaryLower = (
    input.pageTitle +
    '\n' +
    input.headingsText +
    '\n' +
    input.prioritySurface +
    '\n' +
    input.pageQuestions.join(' ')
  ).toLowerCase();
  const fullLower = input.fullContent.toLowerCase();
  const topicSet = new Set(input.topicTokens.filter((t) => t.length >= 2));
  return { primaryLower, fullLower, topicSet };
}

function evaluateSearchQuestionCoverageRow(
  searchQ: SearchQuestion,
  input: CoverageMatchInput,
  surfaces: CoverageSurfaces
): SearchQuestionCoverageRowDetail {
  const { primaryLower, fullLower, topicSet } = surfaces;

  const searchTokens = tokenizeForMatch(searchQ.text, 2);
  if (searchTokens.length === 0) {
    return {
      covered: false,
      branch: 'no_search_tokens',
      reason: 'No tokenizable content in question text',
    };
  }

  const minMatch = Math.max(1, Math.ceil(searchTokens.length * TOKEN_MATCH_RATIO));
  const countIn = (blob: string) => searchTokens.filter((t) => blob.includes(t)).length;

  const inPrimary = countIn(primaryLower);
  if (inPrimary >= minMatch) {
    return {
      covered: true,
      branch: 'primary_surface_token_ratio',
      reason: `primary+headings+FAQ surface: ${inPrimary}/${searchTokens.length} tokens >= min ${minMatch}`,
      matchedTokens: inPrimary,
      minTokensNeeded: minMatch,
    };
  }

  const inFull = countIn(fullLower);
  if (inFull >= minMatch) {
    return {
      covered: true,
      branch: 'full_body_token_ratio',
      reason: `full body: ${inFull}/${searchTokens.length} tokens >= min ${minMatch}`,
      matchedTokens: inFull,
      minTokensNeeded: minMatch,
    };
  }

  if (input.pageQuestions.length > 0) {
    const minIntersection =
      searchTokens.length <= SHORT_QUESTION_TOKEN_THRESHOLD ? MIN_INTERSECTION_SHORT : MIN_INTERSECTION;
    let best = 0;
    for (const pageQ of input.pageQuestions) {
      const pageTokens = tokenizeForMatch(pageQ, 2);
      const intersection = searchTokens.filter((t) => pageTokens.includes(t));
      if (intersection.length > best) best = intersection.length;
      if (intersection.length >= minIntersection) {
        return {
          covered: true,
          branch: 'page_questions_intersection',
          reason: `intersection with pageQuestions >= ${minIntersection} (best ${best})`,
        };
      }
    }
  }

  const mq = meaningfulTokens(searchQ.text);
  if (mq.length > 0) {
    const blob = `${primaryLower}\n${fullLower}`;
    let hits = 0;
    for (const t of mq) {
      if (blob.includes(t)) hits++;
    }
    const ratio = hits / mq.length;
    if (ratio >= MEANINGFUL_COVERAGE_RATIO) {
      return {
        covered: true,
        branch: 'meaningful_token_ratio',
        reason: `meaningful tokens: ${hits}/${mq.length} >= ${MEANINGFUL_COVERAGE_RATIO}`,
      };
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
  const needBridge = Math.max(1, Math.ceil(topicChecks * 0.5));
  if (topicChecks >= 1 && topicHits >= needBridge) {
    return {
      covered: true,
      branch: 'topic_token_bridge',
      reason: `topic-token bridge: ${topicHits}/${topicChecks} topic-linked tokens in body (need >= ${needBridge})`,
    };
  }

  return {
    covered: false,
    branch: 'uncovered',
    reason: `no match: primary=${inPrimary}, full=${inFull}, minTokens=${minMatch}; topic bridge ${topicHits}/${topicChecks}`,
    matchedTokens: inFull,
    minTokensNeeded: minMatch,
  };
}

/**
 * Same as computeSearchQuestionCoverage but returns per-row branch/reason for tracing.
 */
export function computeSearchQuestionCoverageDetails(
  canonicalSearchQuestions: SearchQuestion[],
  input: CoverageMatchInput
): SearchQuestionCoverageRowDetail[] {
  if (!canonicalSearchQuestions || canonicalSearchQuestions.length === 0) return [];
  const surfaces = buildCoverageSurfaces(input);
  return canonicalSearchQuestions.map((q) => evaluateSearchQuestionCoverageRow(q, input, surfaces));
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
  const surfaces = buildCoverageSurfaces(input);
  return canonicalSearchQuestions.map((q) => evaluateSearchQuestionCoverageRow(q, input, surfaces).covered);
}
