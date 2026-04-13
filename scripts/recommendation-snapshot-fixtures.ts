/**
 * Static RecommendationContext samples for regression checks (no network).
 * Mirrors hypothetical URL analysis outputs — not live URL fetches.
 */

import type {
  ContentQuality,
  GeoAxis,
  GeoAxisScores,
  GeoIssue,
  GeoOpportunity,
  SearchQuestion,
} from '../src/lib/analysisTypes';
import type { RecommendationContext } from '../src/lib/recommendations/recommendationContext';

function gi(
  id: string,
  axis: GeoAxis,
  label: string,
  fix: string,
  severity: 'high' | 'medium' | 'low' = 'medium'
): GeoIssue {
  return {
    id,
    category: 'weak_signals',
    axis,
    severity,
    label,
    description: label,
    fix,
    sourceRefs: {},
  };
}

function opp(id: string, axis: GeoAxis, title: string): GeoOpportunity {
  return {
    id,
    improvesAxis: axis,
    impact: 'high',
    title,
    rationale: title,
    sourceRefs: { fromAxis: axis },
  };
}

const sq = (text: string): SearchQuestion => ({ source: 'google', text });

export interface RecommendationSnapshotFixture {
  id: string;
  /** Human-readable — which URL class this approximates */
  approximatesUrl: string;
  context: RecommendationContext;
  /** trendSummary or contentGap must include each substring (locale-aware) */
  expectTrendOrGapSubstrings: string[];
  /** At least one heading must match */
  expectHeadingSubstring?: string;
  /** Trace must reference at least one of these source prefixes */
  expectTraceSourcePrefixes: string[];
}

const axisAll = (v: number): GeoAxisScores => ({
  citation: v,
  paragraph: v,
  answerability: v,
  structure: v,
  trust: v,
  questionMatch: v,
  questionCoverage: v,
});

export const RECOMMENDATION_SNAPSHOT_FIXTURES: RecommendationSnapshotFixture[] = [
  {
    id: 'editorial-ko-uncovered-questions',
    approximatesUrl: 'Korean blog / article with community questions not answered on page',
    context: {
      pageType: 'editorial',
      locale: 'ko',
      editorialSubtype: 'blog',
      axisScores: { ...axisAll(55), questionCoverage: 35, questionMatch: 40 },
      geoIssues: [gi('iss_cov', 'questionCoverage', 'FAQ 부족', '미답변 질문에 대한 Q/A 블록 추가')],
      geoOpportunities: [opp('opp_cite', 'citation', '인용 가능 문장 보강')],
      uncoveredQuestions: [
        sq('이 제품 배터리 수명은 얼마나 되나요?'),
        sq('방수 등급 IP 몇인가요?'),
      ],
      searchQuestions: [],
      contentQuality: {
        contentLength: 4000,
        tableCount: 0,
        listCount: 2,
        h2Count: 3,
        h3Count: 1,
        imageCount: 2,
        hasStepStructure: false,
        quotableSentenceCount: 5,
        firstParagraphLength: 120,
        hasDefinitionPattern: true,
        hasPriceInfo: false,
      },
      reviewSignals: { reviewLike: false, hasReviewSchema: false },
      limitedAnalysis: false,
    },
    expectTrendOrGapSubstrings: ['자주 묻는 질문'],
    expectHeadingSubstring: 'FAQ',
    expectTraceSourcePrefixes: ['signal:uncovered_questions', 'axis:questionCoverage'],
  },
  {
    id: 'editorial-en-low-citation-trust',
    approximatesUrl: 'English help doc — thin citable facts & trust cues',
    context: {
      pageType: 'editorial',
      locale: 'en',
      editorialSubtype: 'site_info',
      axisScores: { ...axisAll(60), citation: 32, trust: 38 },
      geoIssues: [],
      geoOpportunities: [],
      uncoveredQuestions: [],
      searchQuestions: [],
      contentQuality: {
        contentLength: 2000,
        tableCount: 0,
        listCount: 1,
        h2Count: 2,
        h3Count: 0,
        imageCount: 0,
        hasStepStructure: true,
        quotableSentenceCount: 2,
        firstParagraphLength: 80,
        hasDefinitionPattern: false,
        hasPriceInfo: false,
      },
      reviewSignals: { reviewLike: false, hasReviewSchema: false },
      limitedAnalysis: false,
    },
    expectTrendOrGapSubstrings: ['No hard blockers', 'numbers, units'],
    expectHeadingSubstring: 'Caveats',
    expectTraceSourcePrefixes: ['axis:citation', 'axis:trust', 'rule:neutral'],
  },
  {
    id: 'commerce-ko-trust-signal',
    approximatesUrl: 'Korean PDP — policy / trust axis weak',
    context: {
      pageType: 'commerce',
      locale: 'ko',
      axisScores: { ...axisAll(58), trust: 36, citation: 42 },
      geoIssues: [gi('iss_trust', 'trust', '정책 노출 부족', '배송·반품·AS 요약 블록 추가')],
      geoOpportunities: [],
      uncoveredQuestions: [],
      searchQuestions: [],
      contentQuality: {
        contentLength: 3500,
        tableCount: 1,
        listCount: 2,
        h2Count: 4,
        h3Count: 2,
        imageCount: 6,
        hasStepStructure: false,
        quotableSentenceCount: 4,
        firstParagraphLength: 90,
        hasDefinitionPattern: false,
        hasPriceInfo: true,
        productSpecBlockCount: 1,
      },
      reviewSignals: { reviewLike: false, hasReviewSchema: false },
      limitedAnalysis: false,
    },
    expectTrendOrGapSubstrings: ['우선 손볼 곳', '한 블록에 모읍니다'],
    expectHeadingSubstring: '배송',
    expectTraceSourcePrefixes: ['issue:iss_trust', 'axis:trust', 'rule:commerce_policy'],
  },
  {
    id: 'video-en-metadata-faq',
    approximatesUrl: 'YouTube — weak description metadata + uncovered Qs',
    context: {
      pageType: 'video',
      locale: 'en',
      axisScores: {
        ...axisAll(55),
        videoMetadata: 30,
        questionCoverage: 40,
      },
      geoIssues: [],
      geoOpportunities: [opp('opp_vm', 'videoMetadata', 'Chapters and pinned summary')],
      uncoveredQuestions: [sq('What charger is included?')],
      searchQuestions: [],
      contentQuality: null,
      reviewSignals: { reviewLike: false, hasReviewSchema: false },
      limitedAnalysis: false,
    },
    expectTrendOrGapSubstrings: ['still missing', 'chapters'],
    /** Headings cleared for video in filterRecommendationsByPageType */
    expectTraceSourcePrefixes: ['signal:uncovered_questions', 'axis:videoMetadata'],
  },
  {
    id: 'editorial-ko-review-like-no-uncovered',
    approximatesUrl: 'Korean review-style page — Pros/Cons only when reviewLike',
    context: {
      pageType: 'editorial',
      locale: 'ko',
      axisScores: axisAll(62),
      geoIssues: [],
      geoOpportunities: [opp('opp_para', 'paragraph', '문단 정보 밀도')],
      uncoveredQuestions: [],
      searchQuestions: [],
      contentQuality: {
        contentLength: 5000,
        tableCount: 0,
        listCount: 4,
        h2Count: 5,
        h3Count: 2,
        imageCount: 8,
        hasStepStructure: false,
        quotableSentenceCount: 10,
        firstParagraphLength: 200,
        hasDefinitionPattern: true,
        hasPriceInfo: false,
      },
      reviewSignals: { reviewLike: true, hasReviewSchema: false },
      limitedAnalysis: false,
    },
    expectTrendOrGapSubstrings: ['눈에 띄는 포인트'],
    expectHeadingSubstring: '장점',
    expectTraceSourcePrefixes: ['opportunity:opp_para', 'signal:reviewLike'],
  },
];
