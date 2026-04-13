import type {
  ContentQuality,
  EditorialSubtype,
  GeoAxisScores,
  GeoIssue,
  GeoOpportunity,
  PageType,
  QuestionDisplayRules,
  SearchQuestion,
} from '../analysisTypes';

export type RecommendationLocale = 'ko' | 'en';

/** Allowed review-related flags for recommendation rules (no LLM). */
export interface ReviewSignals {
  reviewLike: boolean;
  hasReviewSchema: boolean;
}

/**
 * Inputs for the recommendation rule engine (scores, issues, etc. are internal — user output is guide copy only).
 */
export interface RecommendationContext {
  pageType: PageType;
  locale: RecommendationLocale;
  editorialSubtype?: EditorialSubtype;
  axisScores: GeoAxisScores | null;
  geoIssues: GeoIssue[];
  geoOpportunities: GeoOpportunity[];
  uncoveredQuestions: SearchQuestion[];
  searchQuestions: SearchQuestion[];
  contentQuality: ContentQuality | null;
  reviewSignals: ReviewSignals;
  limitedAnalysis: boolean;
  /** Profile `questionRules` — display/ranking for gaps & predicted questions */
  questionRules?: QuestionDisplayRules | null;
}
