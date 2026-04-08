/**
 * GEO criteria research aggregation for `/api/geo-config/update`.
 *
 * Research weighting policy (see `docs/geo-project-state/09-geo-research-policy.md`):
 * - ~60% emphasis: academic (Semantic Scholar / IR–RAG–ranking theory foundation)
 * - ~30% emphasis: official documentation (structured data, platform guidelines)
 * - ~10% emphasis: authority industry + optional trend/web (Tavily only when GEO_CONFIG_TAVILY_SUPPLEMENT=true)
 *
 * Bucket order passed to Gemini is: academic → official → industry → [trend]. Tavily trend research is
 * appended last and must not replace primary sources.
 *
 * Page-type-specific **truncation budgets** for criteria generation: `pageTypeResearchWeights.ts` +
 * `formatPageTypeWeightedResearchForGemini` (editorial / video / commerce each get distinct academic vs
 * official+authority vs trend ratios).
 */
import type { ResearchBucket, ResearchBucketItem } from './types';
import {
  ACADEMIC_SEARCH_QUERIES,
  INDUSTRY_ARTICLE_URLS,
  OFFICIAL_DOC_URLS,
} from './sourceLists';
import { semanticScholarSearchToItem } from './semanticScholar';
import { fetchUrlPlainText } from './httpText';
import { fetchTavilyTrendBucket } from './tavilyTrend';

async function buildUrlBucket(
  provider: 'official' | 'industry',
  entries: ReadonlyArray<{ url: string; title: string }>
): Promise<ResearchBucket> {
  const items: ResearchBucketItem[] = [];

  for (const e of entries) {
    const text = await fetchUrlPlainText(e.url);
    const resultsText =
      text.trim().length > 0
        ? text
        : `[${provider}] Page text could not be extracted automatically. Canonical reference URL for criteria design: ${e.title} — ${e.url}`;

    items.push({
      query: e.url,
      resultsText,
      sources: [{ title: e.title, url: e.url }],
    });
  }

  return { provider, items };
}

async function buildAcademicBucket(): Promise<ResearchBucket> {
  const items: ResearchBucketItem[] = [];

  for (const q of ACADEMIC_SEARCH_QUERIES) {
    const item = await semanticScholarSearchToItem(q, 4);
    if (item.resultsText.trim().length > 0) {
      items.push(item);
    }
  }

  return { provider: 'academic', items };
}

function tavilySupplementEnabled(): boolean {
  return process.env.GEO_CONFIG_TAVILY_SUPPLEMENT === 'true';
}

/**
 * Aggregates research buckets per `09-geo-research-policy.md`: academic, official, and industry first;
 * optional Tavily [trend] last. Does not require TAVILY_API_KEY unless supplement is enabled.
 */
export async function fetchGeoCriteriaResearch(): Promise<ResearchBucket[]> {
  const [academic, official, industry] = await Promise.all([
    buildAcademicBucket(),
    buildUrlBucket('official', OFFICIAL_DOC_URLS),
    buildUrlBucket('industry', INDUSTRY_ARTICLE_URLS),
  ]);

  const buckets: ResearchBucket[] = [academic, official, industry].filter(
    (b) => b.items.length > 0
  );

  const key = process.env.TAVILY_API_KEY ?? '';
  if (tavilySupplementEnabled() && key) {
    const trend = await fetchTavilyTrendBucket(key);
    if (trend.items.length > 0) {
      buckets.push(trend);
    }
  }

  return buckets;
}
