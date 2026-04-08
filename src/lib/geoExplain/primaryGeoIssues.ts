import type { AnalysisResult, GeoIssue } from '../analysisTypes';
import { dedupeGeoIssuesById } from './issueEngine';

/**
 * Single source of truth for GEO issue lists: prefer API/geoExplain when present,
 * otherwise use issues computed by the client issue engines.
 * Always dedupe by id so React keys and iframe markers stay stable (API payloads may repeat ids).
 */
export function resolvePrimaryGeoIssues(
  result: AnalysisResult,
  engineGeoIssues: GeoIssue[]
): { primary: GeoIssue[]; source: 'geoExplain' | 'engine' } {
  const explain = result.geoExplain?.issues;
  if (explain && explain.length > 0) {
    return { primary: dedupeGeoIssuesById(explain), source: 'geoExplain' };
  }
  return { primary: dedupeGeoIssuesById(engineGeoIssues), source: 'engine' };
}
