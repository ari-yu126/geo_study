import type { ResearchBucket, ResearchBucketItem } from './types';
import { TREND_TAVILY_QUERIES } from './sourceLists';

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

async function tavilySearch(apiKey: string, query: string): Promise<TavilyResponse> {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'advanced',
        max_results: 5,
        include_answer: true,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return {};
    const data = (await res.json()) as TavilyResponse;
    return {
      answer: data.answer ?? '',
      results: data.results ?? [],
    };
  } catch {
    return {};
  }
}

function summarizeOrConcat(res: TavilyResponse, maxLength = 4000): string {
  const answer = res.answer ?? '';
  const snippets = (res.results ?? [])
    .slice(0, 5)
    .map((r) => `- ${r.title}: ${(r.content ?? '').slice(0, 500)}`)
    .join('\n');
  const combined = `[Answer]\n${answer}\n\n[Sources]\n${snippets}`;
  return combined.length > maxLength ? combined.slice(0, maxLength) + '…' : combined;
}

function pickSources(res: TavilyResponse): Array<{ title: string; url: string }> {
  return (res.results ?? []).slice(0, 5).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
  }));
}

/**
 * Optional [trend] bucket — recent GEO / AI-search discourse only.
 */
export async function fetchTavilyTrendBucket(apiKey: string): Promise<ResearchBucket> {
  const items: ResearchBucketItem[] = await Promise.all(
    TREND_TAVILY_QUERIES.map(async (q) => {
      const res = await tavilySearch(apiKey, q);
      return {
        query: q,
        resultsText: summarizeOrConcat(res),
        sources: pickSources(res),
      };
    })
  );

  return {
    provider: 'tavily',
    items: items.filter((i) => i.resultsText.trim().length > 0),
  };
}
