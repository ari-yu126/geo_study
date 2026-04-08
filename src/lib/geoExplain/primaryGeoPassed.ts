import type { AnalysisResult, GeoPassedItem } from '../analysisTypes';

/** Keep first occurrence when ids collide (stable React keys / iframe markers). */
export function dedupeGeoPassedById(items: GeoPassedItem[]): GeoPassedItem[] {
  const seen = new Set<string>();
  const out: GeoPassedItem[] = [];
  for (const p of items) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/**
 * Single source of truth for GEO strengths (passed signals): prefer API/geoExplain when present,
 * otherwise use items from the client passed engines.
 */
export function resolvePrimaryGeoPassed(
  result: AnalysisResult,
  engineGeoPassed: GeoPassedItem[]
): { primary: GeoPassedItem[]; source: 'geoExplain' | 'engine' } {
  const explain = result.geoExplain?.passed;
  if (explain && explain.length > 0) {
    return { primary: dedupeGeoPassedById(explain), source: 'geoExplain' };
  }
  return { primary: dedupeGeoPassedById(engineGeoPassed), source: 'engine' };
}
