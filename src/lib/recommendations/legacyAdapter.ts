import type {
  AnalysisMeta,
  ContentQuality,
  EditorialSubtype,
  GeoAxisScores,
  GeoIssue,
  GeoOpportunity,
  PageType,
  SearchQuestion,
} from '../analysisTypes';
import type { RecommendationContext } from './recommendationContext';
import { buildLocaleSample, detectPageLocale } from './pageLocale';

/** Bridge from runAnalysis / template callers to RecommendationContext. */
export interface LegacyRecommendationInput {
  pageType: PageType;
  editorialSubtype?: EditorialSubtype;
  meta: Pick<AnalysisMeta, 'title' | 'description' | 'ogTitle' | 'ogDescription'>;
  textSample: string;
  axisScores?: GeoAxisScores | null;
  geoIssues: GeoIssue[];
  geoOpportunities: GeoOpportunity[];
  uncoveredQuestions: SearchQuestion[];
  searchQuestions: SearchQuestion[];
  contentQuality?: ContentQuality | null;
  reviewLike?: boolean;
  hasReviewSchema?: boolean;
  limitedAnalysis?: boolean;
}

export function toRecommendationContext(input: LegacyRecommendationInput): RecommendationContext {
  const sample = buildLocaleSample(input.meta, input.textSample);
  const locale = detectPageLocale(sample);
  return {
    pageType: input.pageType,
    locale,
    editorialSubtype: input.editorialSubtype,
    axisScores: input.axisScores ?? null,
    geoIssues: input.geoIssues,
    geoOpportunities: input.geoOpportunities,
    uncoveredQuestions: input.uncoveredQuestions,
    searchQuestions: input.searchQuestions,
    contentQuality: input.contentQuality ?? null,
    reviewSignals: {
      reviewLike: input.reviewLike ?? false,
      hasReviewSchema: input.hasReviewSchema ?? false,
    },
    limitedAnalysis: input.limitedAnalysis ?? false,
  };
}
