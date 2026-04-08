/**
 * In-process LRU-ish cache for full AnalysisResult by normalizedUrl.
 * Backs Supabase cache when DB is slow/unreachable; warms from Supabase hits.
 */

import type { AnalysisResult } from './analysisTypes';
import { isAnalysisCacheEntryValid } from './geoCacheTtl';

const MAX_ENTRIES = 200;

const store = new Map<string, { savedAt: number; result: AnalysisResult }>();

function pruneIfNeeded(): void {
  if (store.size <= MAX_ENTRIES) return;
  const entries = [...store.entries()].sort((a, b) => a[1].savedAt - b[1].savedAt);
  const toDrop = store.size - MAX_ENTRIES + 20;
  for (let i = 0; i < toDrop && i < entries.length; i++) {
    store.delete(entries[i]![0]);
  }
}

export function getMemoryCachedAnalysis(
  normalizedUrl: string,
  currentGeoConfigVersion: string | null
): AnalysisResult | null {
  const row = store.get(normalizedUrl);
  if (!row) return null;
  const savedAtIso = new Date(row.savedAt).toISOString();
  if (
    !isAnalysisCacheEntryValid({
      updatedAtIso: savedAtIso,
      cachedGeoConfigVersion: row.result.geoConfigVersion,
      currentActiveGeoConfigVersion: currentGeoConfigVersion,
    })
  ) {
    store.delete(normalizedUrl);
    return null;
  }
  return row.result;
}

export function setMemoryCachedAnalysis(normalizedUrl: string, result: AnalysisResult): void {
  store.set(normalizedUrl, { savedAt: Date.now(), result });
  pruneIfNeeded();
}
