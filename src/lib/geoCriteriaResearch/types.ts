/**
 * GEO monthly scoring-config research: source provenance for Gemini + reference_sources.
 * Tavily is optional (trend supplement only); primary inputs are official, academic, industry.
 */

export type GeoResearchProviderId = 'official' | 'academic' | 'industry' | 'tavily';

/** Human-readable tag for Gemini prompts ([academic], [official], [industry], [trend]). */
export const GEO_RESEARCH_PROMPT_TAG: Record<GeoResearchProviderId, string> = {
  official: 'official',
  academic: 'academic',
  industry: 'industry',
  tavily: 'trend',
};

/** Maps to reference_sources.source_type (existing DB vocabulary). */
export function providerToSourceType(provider: GeoResearchProviderId): string {
  switch (provider) {
    case 'official':
      return 'docs';
    case 'academic':
      return 'paper';
    case 'industry':
      return 'industry';
    case 'tavily':
      return 'blog';
    default:
      return 'industry';
  }
}

export interface ResearchBucketItem {
  query: string;
  resultsText: string;
  sources: Array<{ title: string; url: string }>;
}

export interface ResearchBucket {
  provider: GeoResearchProviderId;
  items: ResearchBucketItem[];
}

export function researchHasContent(buckets: ResearchBucket[]): boolean {
  return buckets.some((b) =>
    b.items.some((i) => (i.resultsText ?? '').trim().length > 0)
  );
}
