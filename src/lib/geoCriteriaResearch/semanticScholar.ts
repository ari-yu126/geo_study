import type { ResearchBucketItem } from './types';

const SS_TIMEOUT_MS = 20_000;
const SS_ENDPOINT = 'https://api.semanticscholar.org/graph/v1/paper/search';

export async function semanticScholarSearchToItem(
  query: string,
  limit = 4
): Promise<ResearchBucketItem> {
  const params = new URLSearchParams({
    query,
    limit: String(limit),
    fields: 'title,abstract,year,url',
  });

  try {
    const res = await fetch(`${SS_ENDPOINT}?${params}`, {
      signal: AbortSignal.timeout(SS_TIMEOUT_MS),
      headers: { 'User-Agent': 'GEO-CriteriaResearch/1.0' },
    });
    if (!res.ok) {
      return {
        query,
        resultsText: '',
        sources: [],
      };
    }
    const json = (await res.json()) as {
      data?: Array<{ title?: string; abstract?: string; year?: number; url?: string }>;
    };
    const papers = json.data ?? [];
    const lines: string[] = [];
    const sources: Array<{ title: string; url: string }> = [];

    for (const p of papers) {
      const title = (p.title ?? 'Untitled').trim();
      const abs = (p.abstract ?? '').trim().slice(0, 900);
      const yr = p.year != null ? ` (${p.year})` : '';
      lines.push(`- ${title}${yr}${abs ? `\n  ${abs}` : ''}`);
      const u = p.url?.trim() || `https://www.semanticscholar.org/search?q=${encodeURIComponent(title)}`;
      sources.push({ title, url: u });
    }

    return {
      query,
      resultsText: lines.join('\n\n'),
      sources,
    };
  } catch {
    return { query, resultsText: '', sources: [] };
  }
}
