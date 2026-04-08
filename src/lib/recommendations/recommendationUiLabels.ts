/**
 * Locale-aware labels for the recommendation panel (content improvement guide).
 * Do not use scoring/diagnostic wording here — see `.cursor/rules/geo-recommendation-content-guide.mdc`.
 */

import type { AnalysisMeta, GeoAxis } from '../analysisTypes';
import { buildLocaleSample, detectPageLocale } from './pageLocale';

export type RecommendationLocale = 'ko' | 'en';

/** AI Writing Assistant layer (separate from deterministic recommendation) */
export const AI_WRITING_ASSISTANT_UI = {
  ko: {
    generateButton: '✨ AI로 이 글에 맞는 작성 예시 생성',
    sectionTitle: 'AI 작성 예시',
    loading: '작성 예시를 생성하는 중…',
    summaryLabel: '요약 예시',
    faqLabel: 'FAQ 예시',
    prosConsLabel: '장단점 예시',
    verdictLabel: '결론·요약 판단 예시',
    headingsLabel: '추천 H2 소제목',
    faqItem: (n: number) => `질문 ${n}`,
    /** Shown when session cache hits */
    cachedFromSession: '이전에 이 페이지에 대해 저장된 예시입니다.',
    /** Client rate limit between API calls */
    rateLimitWait: '잠시 후 다시 시도해 주세요. (연속 요청 간격)',
    /** Template row when API quota — server may send notice; this labels the badge */
    templateFallbackBadge: '기본 템플릿 예시',
  },
  en: {
    generateButton: '✨ Generate AI writing examples for this page',
    sectionTitle: 'AI Writing Examples',
    loading: 'Generating writing examples…',
    summaryLabel: 'Summary example',
    faqLabel: 'FAQ examples',
    prosConsLabel: 'Pros & cons example',
    verdictLabel: 'Verdict / conclusion example',
    headingsLabel: 'Suggested H2 headings',
    faqItem: (n: number) => `Q${n}`,
    cachedFromSession: 'Showing saved examples from this session.',
    rateLimitWait: 'Please wait a few seconds before requesting again.',
    templateFallbackBadge: 'Template examples',
  },
} as const;

/** Section titles for the structured recommendation card */
export const RECOMMENDATION_SECTION_LABELS = {
  ko: {
    /** One line under the main card title — sets expectation: editor guide, not scores */
    guidePurpose: '편집·구성 관점의 작성 안내입니다.',
    improvementSummary: '개선 요약',
    improvementSummaryVideo: '채널·설명란 개선 요약',
    improvementSummaryReview: '리뷰형 글 작성 가이드',
    contentGaps: '콘텐츠 보완 포인트',
    recommendedHeadings: '추천 H2/H3 소제목',
    recommendedBlocks: '추천 콘텐츠 블록',
    priorityActions: '우선 적용할 작업',
    videoBlocksHint: '고정 댓글·관련 링크는 설명란과 함께 정리하면 좋습니다.',
    templateFallback: '기본 안내 모드',
  },
  en: {
    guidePurpose: 'Editor-style structure and writing tips.',
    improvementSummary: 'Improvement summary',
    improvementSummaryVideo: 'Channel & description improvement summary',
    improvementSummaryReview: 'Review-style writing guide',
    contentGaps: 'Content gaps',
    recommendedHeadings: 'Recommended H2/H3 sections',
    recommendedBlocks: 'Recommended content blocks',
    priorityActions: 'Priority actions',
    videoBlocksHint: 'Pin a summary comment and link related resources alongside the description.',
    templateFallback: 'Preset guide mode',
  },
} as const;

/** Short focus labels (plain language for writers, not metric names) */
export const CONTENT_FOCUS_LABEL: Record<RecommendationLocale, Record<GeoAxis, string>> = {
  ko: {
    citation: '근거·출처',
    paragraph: '요약·가독성',
    answerability: '결론·답변',
    structure: '구조·목차',
    trust: '신뢰 정보',
    questionMatch: '검색 질문 표현',
    questionCoverage: '질문 대응',
    density: '정보 밀도',
    videoMetadata: '설명란',
  },
  en: {
    citation: 'Evidence & sources',
    paragraph: 'Summary & readability',
    answerability: 'Opening answer',
    structure: 'Structure & headings',
    trust: 'Credibility info',
    questionMatch: 'Search questions in headings',
    questionCoverage: 'FAQ & answers',
    density: 'Key facts',
    videoMetadata: 'Description text',
  },
};

export function getRecommendationLocale(
  traceLocale: RecommendationLocale | undefined,
  meta: AnalysisMeta,
  bodySnippet: string
): RecommendationLocale {
  if (traceLocale === 'ko' || traceLocale === 'en') return traceLocale;
  return detectPageLocale(buildLocaleSample(meta, bodySnippet));
}
