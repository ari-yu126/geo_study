import type {
  AnalysisMeta,
  AuditIssue,
  ContentQuality,
  EditorialSubtype,
  GeoAxisScores,
  GeoIssue,
  GeoOpportunity,
  GeoRecommendations,
  PageType,
  SearchQuestion,
} from './analysisTypes';
import { buildGeoRecommendationsFromSignals } from './recommendations/buildGeoRecommendations';
import { filterRecommendationsByPageType } from './recommendations/filterRecommendationsByPageType';
import { mergeGuideRulesIntoRecommendations } from './recommendations/guideRulesMerge';
import { toRecommendationContext, type LegacyRecommendationInput } from './recommendations/legacyAdapter';
import { getProfileForPageType, loadActiveScoringConfig } from './scoringConfigLoader';

export type GeoRecommendationsOptions = {
  searchQuestions?: SearchQuestion[];
  pageQuestions?: string[];
  pageType?: PageType;
  editorialSubtype?: EditorialSubtype;
  geoOpportunities?: GeoOpportunity[];
  geoIssues?: GeoIssue[];
  /** Strength (passed) item ids — optional triggers for guideRules `basedOn`. */
  geoPassedIds?: string[];
  axisScores?: GeoAxisScores;
  /** Meta + body sample for locale/category (required for best results) */
  meta?: Pick<AnalysisMeta, 'title' | 'description' | 'ogTitle' | 'ogDescription'>;
  textSample?: string;
  contentQuality?: ContentQuality | null;
  reviewLike?: boolean;
  hasReviewSchema?: boolean;
  limitedAnalysis?: boolean;
  seedKeywords?: { value: string }[];
};

/**
 * Deterministic, signal-grounded recommendations (no Gemini).
 * Grounded in geoIssues, geoOpportunities, axisScores, uncoveredQuestions (+ context).
 * Second argument (AuditIssue[]) is kept for API compatibility; not fed into the rule engine.
 */
export async function generateGeoRecommendations(
  uncoveredQuestions: SearchQuestion[],
  _auditIssues: AuditIssue[],
  options?: GeoRecommendationsOptions
): Promise<GeoRecommendations> {
  const pageType = options?.pageType ?? 'editorial';
  const meta = options?.meta ?? {
    title: null,
    description: null,
    ogTitle: null,
    ogDescription: null,
  };
  const legacy: LegacyRecommendationInput = {
    pageType,
    editorialSubtype: options?.editorialSubtype,
    meta,
    textSample: options?.textSample ?? '',
    axisScores: options?.axisScores ?? null,
    geoIssues: options?.geoIssues ?? [],
    geoOpportunities: options?.geoOpportunities ?? [],
    uncoveredQuestions,
    searchQuestions: options?.searchQuestions ?? [],
    contentQuality: options?.contentQuality ?? null,
    reviewLike: options?.reviewLike ?? false,
    hasReviewSchema: options?.hasReviewSchema ?? false,
    limitedAnalysis: options?.limitedAnalysis ?? false,
  };
  const base = buildGeoRecommendationsFromSignals(toRecommendationContext(legacy));
  const config = await loadActiveScoringConfig();
  const profile = getProfileForPageType(config, pageType);
  const issueIdSet = new Set((options?.geoIssues ?? []).map((i) => i.id));
  const passedIdSet = new Set(options?.geoPassedIds ?? []);
  const merged = mergeGuideRulesIntoRecommendations(base, {
    guideRules: profile?.guideRules,
    issueIdSet,
    passedIdSet,
    pageType,
  });
  return filterRecommendationsByPageType(merged, pageType);
}
