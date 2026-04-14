/**
 * One-off: confirms product-detail normalization, fetch-target host rewrite, and HTML retrieval.
 * Run: npx tsx scripts/verify-amoremall-fetch.ts
 */

import { fetchHtmlWithNaverFallback } from '../src/lib/fetchHtmlForAnalysis';
import { normalizeUrl } from '../src/lib/normalizeUrl';
import { resolveFetchTargetUrl } from '../src/lib/resolveFetchTargetUrl';

const SAMPLE =
  'https://www.amoremall.com/kr/ko/product/detail?onlineProdSn=31573&clickUrl=pc%3Dx&onlineProdCode=111070000890&ITEM_VALUE=111070000890&recommendId=r&planId=p';

async function main(): Promise<void> {
  const normalized = normalizeUrl(SAMPLE);
  const fetchTarget = resolveFetchTargetUrl(normalized);
  console.log('normalizedUrl (identity):', normalized);
  console.log('fetchTargetUrl (network): ', fetchTarget);
  console.log('hosts differ (expected www on fetch):', new URL(normalized).hostname !== new URL(fetchTarget).hostname);

  const { html, usedFetchUrl } = await fetchHtmlWithNaverFallback(SAMPLE, normalized);
  console.log('usedFetchUrl:', usedFetchUrl);
  console.log('html bytes:', html.length);
  if (html.length < 5000) {
    console.error('Unexpectedly short HTML — check bot blocking or URL.');
    process.exit(1);
  }
  const titleLike = /아모레|amoremall|product/i.test(html.slice(0, 80000));
  if (!titleLike) {
    console.warn('Heuristic: page may not look like Amoremall product HTML — verify manually.');
  } else {
    console.log('Heuristic: HTML looks like a real product page.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
