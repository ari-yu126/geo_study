import type { EditorialSubtype, EditorialSubtypeDebug, GeoExplain } from '../analysisTypes';

export function logGeoExplainDebug(
  url: string,
  pageType: string | undefined,
  geo: GeoExplain,
  editorial?: {
    editorialSubtype?: EditorialSubtype;
    editorialSubtypeDebug?: EditorialSubtypeDebug;
  }
): void {
  if (process.env.GEO_EXPLAIN_DEBUG !== '1' && process.env.GEO_SCORE_AXIS_DEBUG !== '1') return;
  const sub = editorial?.editorialSubtype;
  const subDbg = editorial?.editorialSubtypeDebug;
  console.log(
    '[GEO_EXPLAIN_DEBUG]',
    JSON.stringify({
      url,
      pageType: pageType ?? null,
      editorialSubtype: sub ?? null,
      editorialSubtypeConfidence: subDbg?.confidence ?? null,
      editorialSubtypeBlogScore: subDbg?.blogScore ?? null,
      editorialSubtypeSiteInfoScore: subDbg?.siteInfoScore ?? null,
      editorialSubtypeReasons: subDbg?.reasons ?? null,
      axisScores: geo.axisScores,
      issues: geo.issues.map((i) => i.id),
      passed: geo.passed.map((p) => p.id),
      opportunities: geo.opportunities.map((o) => o.id),
      issueCount: geo.issues.length,
      passedCount: geo.passed.length,
      opportunityCount: geo.opportunities.length,
    })
  );
}
