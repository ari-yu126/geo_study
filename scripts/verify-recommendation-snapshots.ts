/**
 * Verifies deterministic recommendation output against static fixtures (no API keys).
 * Run: npx tsx scripts/verify-recommendation-snapshots.ts
 */

import { buildGeoRecommendationsFromSignals } from '../src/lib/recommendations/buildGeoRecommendations';
import { RECOMMENDATION_SNAPSHOT_FIXTURES } from './recommendation-snapshot-fixtures';

function flattenTraceSources(rec: { trace?: { entries?: { sources: string[] }[] } }): string[] {
  const entries = rec.trace?.entries ?? [];
  return entries.flatMap((e) => e.sources);
}

let failed = false;

for (const fx of RECOMMENDATION_SNAPSHOT_FIXTURES) {
  const out = buildGeoRecommendationsFromSignals(fx.context);
  const combined = `${out.trendSummary} ${out.contentGapSummary}`;
  for (const sub of fx.expectTrendOrGapSubstrings) {
    if (!combined.includes(sub)) {
      console.error(`[FAIL] ${fx.id}: expected substring not found: "${sub}"`);
      console.error('  trendSummary:', out.trendSummary);
      console.error('  contentGapSummary:', out.contentGapSummary);
      failed = true;
    }
  }
  if (fx.expectHeadingSubstring) {
    const heads = out.actionPlan.suggestedHeadings.join(' | ');
    if (!heads.includes(fx.expectHeadingSubstring)) {
      console.error(`[FAIL] ${fx.id}: expected heading containing "${fx.expectHeadingSubstring}"`);
      console.error('  headings:', out.actionPlan.suggestedHeadings);
      failed = true;
    }
  }
  const flat = flattenTraceSources(out);
  for (const prefix of fx.expectTraceSourcePrefixes) {
    const ok = flat.some((s) => s.startsWith(prefix) || s === prefix);
    if (!ok) {
      console.error(`[FAIL] ${fx.id}: trace missing source matching "${prefix}"`);
      console.error('  trace sources:', [...new Set(flat)].slice(0, 40));
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}

console.log(
  `OK — ${RECOMMENDATION_SNAPSHOT_FIXTURES.length} recommendation snapshot fixtures passed.`
);
