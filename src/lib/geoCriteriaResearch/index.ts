/**
 * GEO monthly criteria research (`/api/geo-config/update`).
 * Source priority and ~60/30/10 weighting intent: `docs/geo-project-state/09-geo-research-policy.md`.
 */
export type { GeoResearchProviderId, ResearchBucket, ResearchBucketItem } from './types';
export {
  GEO_RESEARCH_PROMPT_TAG,
  providerToSourceType,
  researchHasContent,
} from './types';
export { fetchGeoCriteriaResearch } from './fetchGeoCriteriaResearch';
export {
  formatResearchBucketsForGemini,
  formatPageTypeWeightedResearchForGemini,
} from './formatResearchForPrompt';
export {
  GEO_CRITERIA_PAGE_TYPE_RESEARCH_WEIGHTS,
  GEO_CRITERIA_WEIGHTED_SECTION_CHAR_BUDGET,
} from './pageTypeResearchWeights';
export type {
  GeoCriteriaPageTypeResearchWeights,
  GeoCriteriaResearchProfileKey,
} from './pageTypeResearchWeights';
