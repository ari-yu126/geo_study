/**
 * Legacy entry: delegates to the same deterministic builder as recommendationEngine.
 *
 * AuditIssue → synthetic GeoIssue conversion happens **only** when `geoIssues` is omitted.
 * Main analyze path passes real `geoIssues` via recommendationEngine — do not merge AuditIssue there yet.
 */

import type {
  GeoRecommendations,
  SearchQuestion,
  AuditIssue,
  PageType,
  EditorialSubtype,
  GeoAxis,
  GeoIssue,
  GeoOpportunity,
} from './analysisTypes';
import { buildGeoRecommendationsFromSignals } from './recommendations/buildGeoRecommendations';
import { filterRecommendationsByPageType } from './recommendations/filterRecommendationsByPageType';
import { toRecommendationContext } from './recommendations/legacyAdapter';

function guessAuditAxis(a: AuditIssue): GeoAxis {
  const h = `${a.id} ${a.label}`.toLowerCase();
  if (/trust|author|date|pub|출처|신뢰|작성/.test(h)) return 'trust';
  if (/faq|question|coverage|질문/.test(h)) return 'questionCoverage';
  if (/citation|quote|인용|출처/.test(h)) return 'citation';
  if (/structure|heading|목차|h1|h2|구조/.test(h)) return 'structure';
  if (/answer|요약|summary|답변/.test(h)) return 'answerability';
  return 'structure';
}

function auditIssuesToGeoIssues(issues: AuditIssue[]): GeoIssue[] {
  return issues.slice(0, 8).map((a) => ({
    id: `audit:${a.id}`,
    category: 'weak_signals',
    axis: guessAuditAxis(a),
    severity: a.priority,
    label: a.label,
    description: a.description,
    fix: a.description,
    sourceRefs: {},
  }));
}

export interface GenerateTemplateRecommendationsParams {
  pageType: PageType | 'default';
  uncoveredQuestions: SearchQuestion[] | string[];
  issues: AuditIssue[];
  /**
   * When set (including `[]`), used as geoIssues for the rule engine.
   * When omitted, AuditIssue rows are converted to synthetic geoIssues (legacy only).
   */
  geoIssues?: GeoIssue[];
  geoOpportunities?: GeoOpportunity[];
  seedKeywords?: { value: string }[];
  metaTitle?: string | null;
  /** Editorial-only — template copy tone */
  editorialSubtype?: EditorialSubtype;
}

export function generateTemplateRecommendations(
  params: GenerateTemplateRecommendationsParams
): GeoRecommendations {
  const {
    pageType,
    uncoveredQuestions,
    issues,
    geoIssues: geoIssuesParam,
    geoOpportunities: geoOpportunitiesParam,
    seedKeywords = [],
    metaTitle,
    editorialSubtype,
  } = params;
  const mappedPageType: PageType = pageType === 'default' ? 'editorial' : pageType;
  const questions: SearchQuestion[] = uncoveredQuestions.map((q) =>
    typeof q === 'string' ? { source: 'google' as const, text: q } : q
  );
  const textSample = [metaTitle ?? '', ...questions.map((q) => q.text)].join('\n').slice(0, 3000);

  const ctx = toRecommendationContext({
    pageType: mappedPageType,
    editorialSubtype,
    meta: {
      title: metaTitle ?? null,
      description: null,
      ogTitle: null,
      ogDescription: null,
    },
    textSample,
    axisScores: null,
    geoIssues:
      geoIssuesParam !== undefined ? geoIssuesParam : auditIssuesToGeoIssues(issues),
    geoOpportunities: geoOpportunitiesParam ?? [],
    uncoveredQuestions: questions,
    searchQuestions: [],
    contentQuality: null,
    reviewLike: false,
    hasReviewSchema: false,
    limitedAnalysis: false,
  });
  const result = filterRecommendationsByPageType(buildGeoRecommendationsFromSignals(ctx), ctx.pageType);
  return { ...result, isTemplateFallback: true };
}
