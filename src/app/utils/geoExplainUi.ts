import type {
  AnalysisResult,
  EditorialSubtype,
  GeoIssue,
  GeoIssueCategory,
  PageType,
  PassedCheck,
} from "@/lib/analysisTypes";

/** Short UI label for editorialSubtype (Korean) */
export const EDITORIAL_SUBTYPE_LABEL: Record<EditorialSubtype, string> = {
  blog: "블로그·기사형",
  site_info: "사이트·안내형",
  mixed: "일반정보형",
};

export function editorialSubtypeTooltip(result: AnalysisResult): string | null {
  if (result.pageType !== "editorial" || !result.editorialSubtype) return null;
  const dbg = result.editorialSubtypeDebug;
  const conf = dbg?.confidence != null ? `신뢰도 약 ${Math.round(dbg.confidence * 100)}%. ` : "";
  const reasons = dbg?.reasons?.length ? ` ${dbg.reasons.slice(0, 5).join(" · ")}` : "";
  return `${conf}내부 힌트:${reasons}`.trim();
}

/** Prefer structured explain layer when API included it */
export function hasGeoExplain(result: AnalysisResult): boolean {
  return Boolean(result.geoExplain);
}

export const GEO_ISSUE_CATEGORY_LABEL: Record<GeoIssueCategory, string> = {
  missing_signals: "부족 신호",
  weak_signals: "약한 신호",
  structural: "구조·메타",
  trust: "신뢰",
  opportunities: "개선 여지",
};

/** Stable section order for grouped GEO issue UI */
export const GEO_ISSUE_CATEGORY_ORDER: readonly GeoIssueCategory[] = [
  "missing_signals",
  "weak_signals",
  "structural",
  "trust",
  "opportunities",
] as const;

export function getIssueCategoryLabel(category: GeoIssueCategory): string {
  return GEO_ISSUE_CATEGORY_LABEL[category];
}

export type GeoIssueGroup = { category: GeoIssueCategory; issues: GeoIssue[] };

/** Group issues by category; only non-empty groups, in GEO_ISSUE_CATEGORY_ORDER */
export function groupGeoIssuesByCategory(issues: GeoIssue[]): GeoIssueGroup[] {
  const buckets = new Map<GeoIssueCategory, GeoIssue[]>();
  for (const c of GEO_ISSUE_CATEGORY_ORDER) {
    buckets.set(c, []);
  }
  for (const issue of issues) {
    const cat = issue.category;
    if (!buckets.has(cat)) {
      buckets.set(cat, []);
    }
    buckets.get(cat)!.push(issue);
  }
  return GEO_ISSUE_CATEGORY_ORDER.map((c) => ({
    category: c,
    issues: buckets.get(c) ?? [],
  })).filter((g) => g.issues.length > 0);
}

export const GEO_AXIS_LABEL: Record<string, string> = {
  citation: "AI 인용",
  paragraph: "문단 품질",
  answerability: "답변 적합성",
  structure: "구조·메타",
  trust: "신뢰",
  questionMatch: "질문 매칭",
  questionCoverage: "질문 커버리지",
  density: "정보 밀도",
  videoMetadata: "영상 메타데이터",
};

export type AxisRow = { key: string; label: string; value: number };

/** Raw 0–100 axis values for explainability UI */
export function getAxisRows(result: AnalysisResult): AxisRow[] {
  const pt = result.pageType as PageType | undefined;
  const ax = result.axisScores;
  const s = result.scores;
  const rows: AxisRow[] = [];
  const push = (key: string, label: string, v: number | undefined) => {
    if (typeof v !== "number" || Number.isNaN(v)) return;
    rows.push({ key, label: GEO_AXIS_LABEL[key] ?? label, value: Math.round(Math.min(100, Math.max(0, v))) });
  };

  if (ax) {
    push("citation", "citation", ax.citation);
    push("paragraph", "paragraph", ax.paragraph);
    push("answerability", "answerability", ax.answerability);
    push("structure", "structure", ax.structure);
    push("trust", "trust", ax.trust);
    push("questionMatch", "questionMatch", ax.questionMatch);
    push("questionCoverage", "questionCoverage", ax.questionCoverage);
    if (ax.density != null && pt !== "video") push("density", "density", ax.density);
    if (ax.videoMetadata != null && pt === "video") push("videoMetadata", "videoMetadata", ax.videoMetadata);
  } else {
    push("citation", "citation", s.citationScore);
    push("paragraph", "paragraph", s.paragraphScore);
    push("answerability", "answerability", s.answerabilityScore);
    push("structure", "structure", s.structureScore);
    push("trust", "trust", s.trustScore);
    push("questionMatch", "questionMatch", s.questionMatchScore);
    push("questionCoverage", "questionCoverage", s.questionCoverage);
  }
  return rows;
}

export type StrengthRow = {
  id: string;
  label: string;
  description: string;
  reason: string;
  position?: PassedCheck["position"];
};

/**
 * Strength rows for the audit panel: `passedChecks` must come from `deriveAuditIssues`,
 * which resolves `geoExplain.passed` first, then engine passed signals (same source as `geoPassedItems`).
 */
export function getStrengthRows(_result: AnalysisResult, passedChecks: PassedCheck[]): StrengthRow[] {
  return passedChecks.map((pc) => ({
    id: pc.id,
    label: pc.label,
    description: pc.description ?? pc.label,
    reason: pc.reason,
    position: pc.position,
  }));
}

export const IMPACT_LABEL: Record<string, string> = {
  high: "높음",
  medium: "보통",
  low: "낮음",
};
