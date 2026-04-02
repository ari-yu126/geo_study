/**
 * Per-page-type research source mix for monthly GEO `geo_scoring_config` generation.
 * "officialAuthority" = official documentation + authority industry URLs (split by raw length when budgeting).
 * "trend" = optional Tavily supplement.
 *
 * See `docs/geo-project-state/09-geo-research-policy.md` — these numbers operationalize profile-specific emphasis.
 */

export type GeoCriteriaResearchProfileKey = 'editorial' | 'video' | 'commerce' | 'default';

export interface GeoCriteriaPageTypeResearchWeights {
  /** IR / QA / RAG / ranking / citation theory (Semantic Scholar, etc.) */
  academic: number;
  /** Official docs + authority industry — combined budget, split between the two buckets */
  officialAuthority: number;
  /** Tavily trend supplement */
  trend: number;
}

/** Sums to 1.0 per key. */
export const GEO_CRITERIA_PAGE_TYPE_RESEARCH_WEIGHTS: Record<
  GeoCriteriaResearchProfileKey,
  GeoCriteriaPageTypeResearchWeights
> = {
  editorial: { academic: 0.6, officialAuthority: 0.3, trend: 0.1 },
  commerce: { academic: 0.5, officialAuthority: 0.4, trend: 0.1 },
  video: { academic: 0.5, officialAuthority: 0.4, trend: 0.1 },
  /** Align with editorial for fallback profile synthesis */
  default: { academic: 0.6, officialAuthority: 0.3, trend: 0.1 },
};

/** Max characters per profile-weighted research section (academic + official + industry + trend after truncation). */
export const GEO_CRITERIA_WEIGHTED_SECTION_CHAR_BUDGET = 12_000;
