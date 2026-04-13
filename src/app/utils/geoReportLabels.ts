/**
 * Single source of truth for Korean copy shared by Web UI (AuditPanel, ResultDashboard)
 * and PPT export. PPT must import strings only from here — no duplicate wording.
 */

import type { PageType } from "@/lib/analysisTypes";
import { GEO_SCORE_AXIS_LABEL_KO } from "@/lib/geoScoreAxisLabels";
import { RECOMMENDATION_SECTION_LABELS } from "@/lib/recommendations/recommendationUiLabels";

const sec = RECOMMENDATION_SECTION_LABELS.ko;

export { GEO_SCORE_AXIS_LABEL_KO };

/** Grade tiers — same logic as ScoreGauge / PPT (`colorHex` = RGB hex without `#`, pptxgen style) */
export function getGeoGradeInfo(score: number): {
  grade: string;
  label: string;
  colorHex: string;
} {
  if (score >= 85) return { grade: "S", label: "최우수", colorHex: "34D399" };
  if (score >= 70) return { grade: "A", label: "우수", colorHex: "00D4C8" };
  if (score >= 55) return { grade: "B", label: "양호", colorHex: "5B6EF5" };
  if (score >= 40) return { grade: "C", label: "미흡", colorHex: "F5A623" };
  return { grade: "D", label: "개선필요", colorHex: "F05C7A" };
}

/** When video pipeline leaves paragraph/structure/citation at 0 — PPT + any shared display */
export const GEO_VIDEO_SCORE_NA = "N/A (영상 페이지 특성)";

/** Headings subsection — mirrors AuditPanel `headingsSectionLabel` */
export function geoReportHeadingsSectionLabel(pageType: PageType | undefined): string {
  if (pageType === "video") return sec.recommendedHeadingsVideo;
  if (pageType === "commerce") return sec.recommendedHeadingsCommerce;
  return sec.recommendedHeadings;
}

/** Guide card title — mirrors AuditPanel `guideTitle` */
export function geoReportGuideTitle(pageType: PageType | undefined): string {
  return pageType === "video" ? "영상 설명란 개선 가이드" : "콘텐츠 개선 가이드";
}

/**
 * All Korean strings for PPT slides (and re-used where noted).
 * Keys are stable; edit copy here only.
 */
export const GEO_REPORT_LABELS_KO = {
  pptCoverBadge: "GEO ANALYSIS REPORT",
  reportTitle: "GEO 분석 리포트",
  analyzedOnPrefix: "분석일:",
  overallGeoGrade: "종합 GEO 등급",
  pointsOutOf100: (n: number) => `${n}점 / 100점`,
  overallGeoScoreSlideTitle: "종합 GEO 점수",
  finalScoreSlash100WithGrade: (n: number, gradeLabel: string) => `/ 100 · ${gradeLabel}`,
  pointsSlash100Short: (n: number) => `${n}점 / 100`,
  /** AuditPanel `getAxisRows` 블록과 동일 제목 */
  detailScoreSectionTitle: "세부 점수 (0-100)",
  detailScoreSectionEmpty: "표시할 세부 점수가 없습니다.",
  supportingInsightHeading: "보조 지표 · 추가 인사이트",
  questionCoverageSupportingLine: (coverageDisplay: string) =>
    `질문 커버리지 ${coverageDisplay} / 100 — 핵심 5축과 별도의 보조 신호이며, 최종 점수에 가중 반영됩니다.`,

  keywordsSlideTitle: "핵심 키워드 분석",
  keywordsEmptyTitle: "추출된 핵심 키워드가 없습니다.",
  keywordsEmptyHint:
    "페이지 제목·설명·본문에서 키워드가 추출되지 않았거나, 영상 페이지의 경우 API 응답에 citationKeywords가 없을 수 있습니다.",

  /** PPT — AuditPanel 감사 카드와 동일 섹션명 */
  pptAuditStrengthsSlideTitle: "잘된 점",
  pptAuditIssuesSlideTitle: "발견된 이슈",
  /** Overflow slide suffix when strengths/issues span multiple slides */
  pptAuditSectionContinued: " (계속)",
  pptStrengthsEmpty: "강한 GEO 신호가 아직 감지되지 않았습니다.",
  pptIssuesEmpty: "해당 이슈 없음",
  /** AuditPanel issue card — strength opportunities (same as `generateOpportunities` lines) */
  pptStrengthBoostHeading: (n: number) => `보강 포인트 (${n})`,

  slideBadgeKeyChart: "핵심 장표",
  questionCoverageSlideTitle: "질문 커버리지",
  questionCoverageSlideHeading: "질문 커버리지 현황",
  questionCoverageSlideSubtitle:
    "보조 지표 · 추가 인사이트 — 핵심 5축(인용·문단·답변·SEO 구조·신뢰)과 별개로, 검색·AI 질문 대비 본문 적합성을 봅니다.",
  pptQuestionCoverageExternalFailed: "외부 질문 데이터를 불러오지 못했습니다",
  pptQuestionCoverageFallbackExamples: "관련 질문 예시",
  userVsAiAnswerLine: (uAns: number, uTot: number, aiAns: number, aiTot: number) =>
    `[유저 검색] 답변 ${uTot > 0 ? uAns : 0} / ${uTot}  |  [AI 예상] 답변 ${aiTot > 0 ? aiAns : 0} / ${aiTot}`,
  userSearchTavily: "유저 검색 (Tavily)",
  aiPredictedGemini: "AI 예상 (Gemini)",
  statusUncovered: "미답변",
  statusPriorityFix: "⚠ 우선보강",
  uncoveredAiTop3Title: "미답변 AI 질문 Top 3 (보강 우선순위)",

  goldenParagraphsTitle: "황금 문단 (인용 확률 TOP 3)",
  goldenParagraphsSubtitle: "Gemini 의미적 평가: AI가 정답 출처로 인용할 가능성이 높은 문단",
  citationChunkScore: (n: number) => `인용 점수 ${n}/10`,

  metaTagsSlideTitle: "메타 태그 분석",
  metaLabelTitle: "Title",
  metaLabelMetaDescription: "Meta Description",
  metaLabelOgTitle: "OG Title",
  metaLabelOgDescription: "OG Description",
  metaLabelCanonical: "Canonical URL",
  metaRequiredMark: " *",
  metaPresent: "✓ 설정됨",
  metaAbsent: "✗ 없음",
  metaUnset: "설정되지 않음",

  guidePurposeLine: sec.guidePurpose,
  recommendedBlocks: sec.recommendedBlocks,

  improvementsSlideTitle: "개선 권고사항",
  tipPriorityHigh: "긴급",
  tipPriorityMedium: "보통",
  tipPriorityLow: "낮음",
  tipTitleAddTitleTag: "Title 태그 추가",
  tipBodyAddTitleTag: "페이지 주제를 담은 명확한 title을 설정하세요.",
  tipTitleMetaOgMissing: "Meta / OG 설명 누락",
  tipBodyMetaOgMissing:
    "표준 meta description과 og:description이 모두 없습니다. 최소 한 가지 요약 신호를 제공하세요.",
  tipTitleIntroSummaryHosted: "도입 요약·제목 보강 (메타 미제공)",
  tipBodyIntroSummaryHosted:
    "제목을 검색 의도에 맞게 명확히 하고, 본문 맨 앞에 핵심 요약(2~4문장)과 주요 정보를 드러내세요. 호스팅 플랫폼에서는 HTML meta description을 직접 넣기 어려운 경우가 많습니다.",
  tipTitleStandardMetaDesc: "표준 Meta description 추가",
  tipBodyStandardMetaDesc:
    'og:description은 일부 설명 신호를 제공합니다. 가능하면 `<meta name="description">`을 추가해 검색·스니펫 일관성을 높이세요.',
  tipTitleSeoStructure: "SEO 구조 개선",
  tipBodySeoStructure:
    "H2 소제목을 질문형으로 재구성하고 본문 첫 단락에 핵심 답변을 배치하세요. (대시보드의 SEO 구조 점수와 동일 축)",
  tipTitleQuestionCoverage: "질문 커버리지 보강 (보조 지표)",
  tipBodyQuestionCoverage:
    "사용자가 AI에게 물을 법한 질문-답변 블록을 본문에 추가하세요. 핵심 5축과 별도의 보조 신호입니다.",
  tipTitleCanonical: "Canonical URL 설정",
  tipBodyCanonical: "중복 콘텐츠 방지를 위해 canonical 태그를 추가하세요.",
  tipTitleGuideNote: "가이드",

  conclusionTitle: "결론 및 다음 단계",
  conclusionSupportingPrefix: "보조: 질문 커버리지",
  urgentActionsTitle: "즉시 실행 가능한 개선 항목",
  urgentAddTitle: "Title 태그 추가",
  urgentMetaOg: "Meta / OG 설명 보강",
  urgentSeoStructure: "SEO 구조(헤딩)를 질문형으로 개선",
  urgentQuestionCoverage: "질문 커버리지 보강(FAQ 등)",
  urgentCanonical: "Canonical URL 설정",
  footerAnalysisLine: (url: string, dateStr: string) => `분석 URL: ${url}  |  분석일: ${dateStr}`,

  /** PPT closing slide — no conclusion body; deck end marker only */
  pptLastPageMarker: "End",

  /** Shared with AuditPanel / Sidebar / page — PPT export control */
  pptDownloadButton: "PPT 리포트 다운로드",
  pptGenerating: "PPT 생성 중...",
  /** Marketing / feature list (page.tsx) */
  pptFeatureLabel: "PPT 리포트",
} as const;
