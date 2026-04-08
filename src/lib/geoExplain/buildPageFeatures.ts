import type {
  AnalysisResult,
  ContentQuality,
  PageFeatures,
  TrustSignals,
} from '../analysisTypes';

const DEFAULT_CONTENT_QUALITY: ContentQuality = {
  contentLength: 0,
  tableCount: 0,
  listCount: 0,
  h2Count: 0,
  h3Count: 0,
  imageCount: 0,
  hasStepStructure: false,
  quotableSentenceCount: 0,
  firstParagraphLength: 0,
  hasDefinitionPattern: false,
  hasPriceInfo: false,
};

const DEFAULT_TRUST_SIGNALS: TrustSignals = {
  hasAuthor: false,
  hasPublishDate: false,
  hasModifiedDate: false,
  hasContactLink: false,
  hasAboutLink: false,
};

function metaDescriptionSignals(meta: AnalysisResult['meta']) {
  const hasMetaDescription = !!(meta.description?.trim());
  const hasOgDescription = !!(meta.ogDescription?.trim());
  const descriptionLength = meta.description?.trim().length ?? 0;
  const effectiveDescriptionLength = hasMetaDescription
    ? descriptionLength
    : hasOgDescription
      ? meta.ogDescription!.trim().length
      : 0;
  return { hasMetaDescription, hasOgDescription, descriptionLength, effectiveDescriptionLength };
}

/** Shared PageFeatures builder for scoring / GEO explain rule evaluation */
export function buildPageFeaturesFromResult(result: AnalysisResult): PageFeatures {
  const sig = metaDescriptionSignals(result.meta);
  return {
    meta: result.meta,
    headings: result.headings ?? [],
    h1Count: result.h1Count ?? 0,
    pageQuestions: result.pageQuestions,
    seedKeywords: result.seedKeywords,
    questionCoverage: result.scores.questionCoverage,
    questionMatchScore: result.scores.questionMatchScore,
    structureScore: result.scores.structureScore,
    hasFaqSchema: result.hasFaqSchema ?? false,
    hasStructuredData: result.hasStructuredData ?? false,
    hasReviewSchema: result.hasReviewSchema ?? false,
    descriptionLength: sig.descriptionLength,
    hasMetaDescription: sig.hasMetaDescription,
    hasOgDescription: sig.hasOgDescription,
    effectiveDescriptionLength: sig.effectiveDescriptionLength,
    contentQuality: result.contentQuality ?? DEFAULT_CONTENT_QUALITY,
    trustSignals: result.trustSignals ?? DEFAULT_TRUST_SIGNALS,
  };
}
