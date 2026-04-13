/**
 * UI-only "보강 기회" lines: deterministic, positive framing — not issue detection.
 * Skips lines when the same concern is already flagged as an issue (by issue id).
 */
import type { AnalysisResult, ContentQuality, PageType } from './analysisTypes';
import { buildPageFeaturesFromResult } from './geoExplain/buildPageFeatures';
import { evaluateCheck } from './checkEvaluator';

const MAX_OPPORTUNITIES = 3;

/** Minimum quotable sentences to treat as "already strong" for strengthening copy */
const QUOTABLE_STRONG_THRESHOLD = 6;

/**
 * When no issue ids and no “strong signal” lines matched — still show helpful strengthening hints (editorial/default).
 */
const EDITORIAL_FALLBACK_POOL: string[] = [
  '도입부에 핵심 결론 한 줄을 두면 즉답으로 인용되기 쉬워집니다',
  '질문형 소제목과 짧은 요약 블록을 더하면 검색 질문과의 매칭이 좋아집니다',
  '수치·근거가 드러나는 짧은 문장을 배치하면 AI 인용에 유리합니다',
];

const COMMERCE_FALLBACK_POOL: string[] = [
  '상단에 선택 기준을 한 줄로 제시하면 비교·구매 판단이 빨라집니다',
  '스펙·가격을 표나 목록으로 묶으면 인용·요약에 유리합니다',
  '대상 독자를 한 줄로 정하면 추천 답변에 잘 붙습니다',
];

function dedupePush(out: string[], line: string): void {
  const t = line.trim();
  if (!t || out.includes(t)) return;
  out.push(t);
}

function countYoutubeTimestampLines(description: string | null | undefined): number {
  if (!description?.trim()) return 0;
  const tsRe = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/;
  let n = 0;
  for (const line of description.split('\n')) {
    if (tsRe.test(line.trim())) n++;
  }
  return n;
}

function editorialOpportunities(result: AnalysisResult, issueIds: ReadonlySet<string>): string[] {
  const features = buildPageFeaturesFromResult(result);
  const out: string[] = [];

  const hasVerdict =
    evaluateCheck('clear_verdict_exists', features) && !issueIds.has('missing_clear_verdict');
  const hasComparison =
    evaluateCheck('comparison_logic_exists', features) && !issueIds.has('missing_comparison_logic');
  const cq = result.contentQuality;
  const quotable = cq?.quotableSentenceCount ?? 0;
  const quotableStrong =
    quotable >= QUOTABLE_STRONG_THRESHOLD &&
    !issueIds.has('quotable') &&
    (result.scores?.answerabilityScore ?? 0) >= 48;

  const hasUserContext =
    evaluateCheck('user_context_exists', features) && !issueIds.has('missing_user_context');

  if (hasVerdict) {
    dedupePush(
      out,
      '결론이 명확하므로 상단 요약으로 더 강조하면 즉답성이 좋아집니다'
    );
  }
  if (hasComparison) {
    dedupePush(
      out,
      '비교 기준이 잘 정리되어 있어 요약하면 선택이 더 쉬워집니다'
    );
  }
  if (quotableStrong) {
    dedupePush(
      out,
      '인용 가능한 문장이 많아 핵심 문장을 더 선명하게 하면 노출 가능성이 높아집니다'
    );
  }
  if (hasUserContext) {
    dedupePush(
      out,
      '사용자 상황 설명이 잘 되어 있어 대상별 요약을 추가하면 더 직관적입니다'
    );
  }

  if (out.length === 0 && issueIds.size === 0) {
    for (const line of EDITORIAL_FALLBACK_POOL) {
      dedupePush(out, line);
      if (out.length >= MAX_OPPORTUNITIES) break;
    }
  }

  return out.slice(0, MAX_OPPORTUNITIES);
}

function commerceProductSignals(cq: ContentQuality): boolean {
  return (
    (cq.productSpecBlockCount ?? 0) >= 1 ||
    cq.hasPriceInfo === true ||
    cq.hasJsonLdProduct === true ||
    cq.hasOgProductType === true ||
    (cq.commerceKeywordCount ?? 0) >= 3
  );
}

function commerceMultipleProducts(cq: ContentQuality): boolean {
  return (
    cq.hasJsonLdProductInListContext === true ||
    (cq.repeatedProductCardCount ?? 0) >= 2 ||
    (cq.jsonLdProductTypesFound?.length ?? 0) >= 2
  );
}

function commerceOpportunities(result: AnalysisResult, issueIds: ReadonlySet<string>): string[] {
  const cq = result.contentQuality ?? ({} as ContentQuality);
  const lines: string[] = [];
  const tableCount = cq.tableCount ?? 0;

  if (tableCount > 0 && !issueIds.has('no_tables')) {
    dedupePush(lines, '스펙 정보가 잘 정리되어 있어 상단 요약 표로 정리하면 비교가 더 쉬워집니다');
  }
  if (commerceProductSignals(cq)) {
    dedupePush(lines, '구매 기준을 먼저 제시하면 사용자 판단이 더 빨라집니다');
  }
  if (commerceMultipleProducts(cq)) {
    dedupePush(lines, '제품 간 차이를 한눈에 보이도록 정리하면 선택이 쉬워집니다');
  }

  if (lines.length === 0 && issueIds.size === 0) {
    for (const line of COMMERCE_FALLBACK_POOL) {
      dedupePush(lines, line);
      if (lines.length >= MAX_OPPORTUNITIES) break;
    }
  }

  return lines.slice(0, MAX_OPPORTUNITIES);
}

function videoOpportunities(result: AnalysisResult, issueIds: ReadonlySet<string>): string[] {
  const desc = result.meta?.description ?? result.meta?.ogDescription ?? '';
  const descLen = desc.trim().length;
  const chapters = countYoutubeTimestampLines(desc);

  const out: string[] = [];

  if (chapters >= 1 && !issueIds.has('yt_no_timestamp')) {
    dedupePush(out, '챕터가 잘 구성되어 있어 더 세분화하면 탐색이 쉬워집니다');
  }
  if (descLen > 0 && !issueIds.has('yt_desc_short')) {
    dedupePush(out, '설명란 요약을 보강하면 핵심 내용을 빠르게 전달할 수 있습니다');
  }
  if (out.length < MAX_OPPORTUNITIES) {
    dedupePush(out, '핵심 포인트를 더 명확히 정리하면 이해도가 높아집니다');
  }

  return out.slice(0, MAX_OPPORTUNITIES);
}

/**
 * Deterministic "더 강하게 만들기" lines for the audit panel.
 * Does not reuse issue-rule evaluation beyond shared `evaluateCheck` signals.
 */
export function generateOpportunities(
  result: AnalysisResult,
  pageType: PageType,
  issueIds: readonly string[]
): string[] {
  const idSet = new Set(issueIds);
  const pt = pageType === 'default' ? 'editorial' : pageType;

  let lines: string[] = [];
  if (pt === 'commerce') {
    lines = commerceOpportunities(result, idSet);
  } else if (pt === 'video') {
    lines = videoOpportunities(result, idSet);
  } else {
    lines = editorialOpportunities(result, idSet);
  }

  const deduped: string[] = [];
  for (const line of lines) {
    dedupePush(deduped, line);
    if (deduped.length >= MAX_OPPORTUNITIES) break;
  }
  return deduped;
}
