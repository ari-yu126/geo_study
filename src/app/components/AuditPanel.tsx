"use client";

import { useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  Shield,
  Lightbulb,
  Layout,
  Bot,
  FileText,
  Circle,
  X,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Sparkles,
  Search,
  Star,
  ExternalLink,
} from "lucide-react";
import type {
  AnalysisResult,
  AuditIssue,
  ChunkCitation,
  FixExample,
  GeoIssue,
  PassedCheck,
  PlatformConstraint,
} from "@/lib/analysisTypes";
import { dedupeGeoIssuesById } from "@/lib/geoExplain/issueEngine";
import { GEO_UI_HIDE_COVERAGE_AND_PPT } from "../geoUiFlags";
import {
  GEO_AXIS_LABEL,
  getAxisRows,
  getIssueCategoryLabel,
  getStrengthRows,
  GEO_ISSUE_CATEGORY_ORDER,
  groupGeoIssuesByCategory,
  hasGeoExplain,
  IMPACT_LABEL,
  EDITORIAL_SUBTYPE_LABEL,
} from "../utils/geoExplainUi";
import type { GeoAxis } from "@/lib/analysisTypes";
import type {
  AiWritingExamplesApiResponse,
  AiWritingExamplesData,
  AiWritingExamplesPageType,
} from "@/lib/aiWritingExamplesTypes";
import { getAiWritingGuideCacheSignature } from "@/lib/aiWritingExamplesTypes";
import { buildFallbackAiWritingExamples } from "@/lib/aiWritingExamplesFallback";
import { AI_WRITING_QUOTA_NOTICE } from "@/lib/aiWritingExamplesMessages";
import { readAiWritingCache, writeAiWritingCache } from "@/app/utils/aiWritingExamplesClientCache";
import {
  AI_WRITING_ASSISTANT_UI,
  CONTENT_FOCUS_LABEL,
  getRecommendationLocale,
  RECOMMENDATION_SECTION_LABELS,
} from "@/lib/recommendations/recommendationUiLabels";
import { buildGeoScoreExplanation } from "@/lib/geoScoreExplanation";
import { generateOpportunities } from "@/lib/generateOpportunities";
import ScoreGauge, { getGradeInfo } from "./ScoreGauge";
import { GEO_SCORE_AXIS_LABEL_KO } from "@/lib/geoScoreAxisLabels";
import { GEO_REPORT_LABELS_KO } from "../utils/geoReportLabels";
import { GeoIssuesAlertIcon, GeoStrengthTrophyIcon } from "./geoAuditIcons";

const PRIORITY_COLORS: Record<string, { color: string; bg: string; border: string; label: string }> = {
  high: { color: "#f05c7a", bg: "rgba(240,92,122,0.08)", border: "rgba(240,92,122,0.25)", label: GEO_REPORT_LABELS_KO.tipPriorityHigh },
  medium: { color: "#f5a623", bg: "rgba(245,166,35,0.08)", border: "rgba(245,166,35,0.25)", label: GEO_REPORT_LABELS_KO.tipPriorityMedium },
  low: { color: "#34d399", bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.25)", label: GEO_REPORT_LABELS_KO.tipPriorityLow },
};

function GeoIssueCard({
  g,
  issueNum,
  activeIssueId,
  onIssueClick,
  auditIssueById,
  geoExplainDebugMode,
  hideCategoryBadge,
  axisFriendlyLabel,
}: {
  g: GeoIssue;
  issueNum: number;
  activeIssueId: string | null;
  onIssueClick: (id: string) => void;
  auditIssueById: (id: string) => AuditIssue | undefined;
  /** Dev-only + `?debug=true`: show full issue JSON under the card. */
  geoExplainDebugMode: boolean;
  hideCategoryBadge?: boolean;
  /** User-facing focus label (no internal axis ids). */
  axisFriendlyLabel?: string;
}) {
  const cfg = PRIORITY_COLORS[g.severity];
  const isActive = activeIssueId === g.id;
  const linked = auditIssueById(g.id);
  const fixExamples = linked?.fixExamples;
  const hasFixExamples = Boolean(fixExamples && fixExamples.length > 0);
  const hasFixGuide = Boolean(g.fix?.trim());
  const hasExpandableDetail = hasFixExamples || hasFixGuide || geoExplainDebugMode;
  const showDetailPanel = isActive && hasExpandableDetail;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <button
        onClick={() => onIssueClick(g.id)}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "10px 12px",
          borderRadius: showDetailPanel ? "8px 8px 0 0" : 8,
          borderTop: `1px solid ${isActive ? cfg.color + "66" : cfg.border}`,
          borderRight: `1px solid ${isActive ? cfg.color + "66" : cfg.border}`,
          borderLeft: `1px solid ${isActive ? cfg.color + "66" : cfg.border}`,
          borderBottom: showDetailPanel ? "none" : `1px solid ${isActive ? cfg.color + "66" : cfg.border}`,
          background: isActive ? cfg.bg : "transparent",
          cursor: "pointer",
          textAlign: "left",
          transition: "all 0.15s",
          width: "100%",
        }}
      >
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: cfg.color,
            color: "#fff",
            fontSize: 12,
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            marginTop: 1,
            fontFamily: "var(--font-mono)",
            boxShadow: isActive ? `0 0 8px ${cfg.color}66` : "none",
          }}
          title={PRIORITY_COLORS[g.severity]?.label ?? g.severity}
        >
          {issueNum}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#e8edf5", lineHeight: 1.3 }}>{g.label}</span>
            {!hideCategoryBadge && (
              <span
                style={{
                  fontSize: 10,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: "#1a2436",
                  color: "#8b9cb3",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {getIssueCategoryLabel(g.category)}
              </span>
            )}
            <span
              style={{
                fontSize: 10,
                padding: "2px 6px",
                borderRadius: 4,
                background: "rgba(91,110,245,0.12)",
                color: "#a5b4fc",
                fontFamily: "var(--font-mono)",
              }}
            >
              {axisFriendlyLabel ?? GEO_AXIS_LABEL[g.axis] ?? g.axis}
            </span>
            {hasExpandableDetail &&
              (isActive ? <ChevronUp size={14} style={{ color: "#5b6ef5", flexShrink: 0 }} /> : <ChevronDown size={14} style={{ color: "#7a8da3", flexShrink: 0 }} />)}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#8b9cb3",
              lineHeight: 1.5,
              display: isActive ? "block" : "-webkit-box",
              WebkitLineClamp: isActive ? undefined : 2,
              WebkitBoxOrient: "vertical",
              overflow: isActive ? "visible" : "hidden",
            }}
          >
            {g.description}
          </div>
        </div>
      </button>
      {isActive && showDetailPanel && (
        <div
          style={{
            border: `1px solid ${cfg.color}66`,
            borderTop: `1px dashed ${cfg.color}33`,
            borderRadius: "0 0 8px 8px",
            background: "#080d16",
            overflow: "hidden",
          }}
        >
          {g.fix?.trim() && (
            <div style={{ padding: "10px 12px", borderBottom: hasFixExamples ? "1px solid #1a2436" : "none" }}>
              <div style={{ fontSize: 11, color: "#5b6ef5", fontFamily: "var(--font-mono)", fontWeight: 600, marginBottom: 6 }}>수정 가이드</div>
              <div style={{ fontSize: 12, color: "#c4d0e0", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{g.fix}</div>
            </div>
          )}
          {hasFixExamples && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 12px", borderBottom: "1px solid #1a2436" }}>
                <span style={{ fontSize: 12, color: "#5b6ef5", fontFamily: "var(--font-mono)", fontWeight: 600, letterSpacing: "0.05em" }}>수정 예시</span>
              </div>
              {fixExamples!.map((fix, fidx) => (
                <FixCodeBlock key={`${g.id}-fix-${fidx}`} fix={fix} accentColor={cfg.color} />
              ))}
            </>
          )}
          {geoExplainDebugMode && (
            <div style={{ borderTop: hasFixGuide || hasFixExamples ? "1px solid #1a2436" : "none" }}>
              <div style={{ fontSize: 11, color: "#6d8099", fontFamily: "var(--font-mono)", fontWeight: 600, padding: "8px 12px 4px" }}>Issue (debug JSON)</div>
              <pre
                style={{
                  margin: 0,
                  padding: "0 12px 10px",
                  fontSize: 10,
                  color: "#6d8099",
                  fontFamily: "var(--font-mono)",
                  overflow: "auto",
                  maxHeight: 280,
                }}
              >
                {JSON.stringify(g, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FixCodeBlock({ fix, accentColor }: { fix: FixExample; accentColor: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(fix.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = fix.code;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }, [fix.code]);

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleCopy();
        }}
        style={{
          position: "absolute",
          top: 6,
          right: 8,
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "3px 8px",
          borderRadius: 4,
          border: `1px solid ${copied ? "#34d399" : "#1e2d45"}`,
          background: copied ? "rgba(52,211,153,0.12)" : "rgba(91,110,245,0.08)",
          color: copied ? "#34d399" : "#8b9cb3",
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          cursor: "pointer",
          transition: "all 0.15s",
          zIndex: 2,
        }}
      >
        {copied ? <><Check size={12} /> 복사됨</> : <><Copy size={12} /> 복사</>}
      </button>
      <pre
        style={{
          margin: 0,
          padding: "10px 12px",
          paddingRight: 70,
          fontSize: 12,
          lineHeight: 1.6,
          color: "#c4d0e0",
          fontFamily: "var(--font-mono)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          overflowX: "hidden",
          borderLeft: `2px solid ${accentColor}33`,
        }}
      >
        {fix.code}
      </pre>
    </div>
  );
}

function GoldenParagraphCard({ chunk, rank }: { chunk: ChunkCitation; rank: number }) {
  const rankColors = ["#fbbf24", "#a78bfa", "#34d399"] as const;
  const color = rankColors[rank - 1] ?? "#7a8da3";
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 8,
        border: `2px solid ${color}55`,
        background: `${color}12`,
        boxShadow: `0 0 12px ${color}22`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: color,
          color: "#0a0f1a",
          fontSize: 14,
          fontWeight: 800,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-mono)",
        }}>
          #{rank}
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: color, fontWeight: 700, fontFamily: "var(--font-mono)" }}>
            인용 점수 {chunk.score}/10
          </span>
          {chunk.communityFitScore != null && (
            <span style={{ fontSize: 11, color: "#7a8da3" }}>
              커뮤니티 {chunk.communityFitScore}%
            </span>
          )}
        </div>
      </div>
      <div style={{ fontSize: 12, color: "#c4d0e0", lineHeight: 1.6, marginBottom: 6 }}>
        {chunk.text}{chunk.text.length >= 200 ? "…" : ""}
      </div>
      {chunk.reason && (
        <div style={{ fontSize: 11, color: "#7a8da3", fontStyle: "italic", borderTop: `1px solid ${color}33`, paddingTop: 6 }}>
          {chunk.reason}
        </div>
      )}
    </div>
  );
}

function getDomainFromUrl(url?: string): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const parts = host.split(".");
    if (parts.length >= 2) return parts.slice(-2).join(".");
    return host;
  } catch {
    return null;
  }
}

/** Shown in header: which GEO scoring profile was applied (page type). */
function pageEvalStandard(pageType?: AnalysisResult["pageType"]) {
  switch (pageType) {
    case "video":
      return {
        title: "유튜브 · 비디오",
        hint: "제목·설명·챕터 등 메타 중심 평가",
        color: "#f472b6",
      };
    case "commerce":
      return {
        title: "쇼핑몰 · 커머스",
        hint: "상품·스펙·스키마·신뢰 신호 중심 평가",
        color: "#f5a623",
      };
    case "editorial":
      return {
        title: "일반 사이트 · 에디토리얼",
        hint: "본문·인용·구조·답변 적합성 중심 평가",
        color: "#00d4c8",
      };
    default:
      return {
        title: "일반(기본)",
        hint: "에디토리얼에 가까운 기준으로 평가",
        color: "#5b6ef5",
      };
  }
}

/** `?debug=true` (dev only): show how each panel maps to pipeline categories. */
function DebugCategoryBox({
  show,
  heading,
  lines,
}: {
  show: boolean;
  heading: string;
  lines: string[];
}) {
  if (!show || lines.length === 0) return null;
  return (
    <div
      style={{
        marginTop: 10,
        marginBottom:10,
        padding: "8px 10px",
        borderRadius: 8,
        background: "rgba(91,110,245,0.08)",
        border: "1px dashed rgba(91,110,245,0.35)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "#818cf8",
          fontFamily: "var(--font-mono)",
          fontWeight: 600,
          letterSpacing: "0.04em",
          marginBottom: 10,
        }}
      >
        {heading}
      </div>
      <ul
        style={{
          margin: 0,
          paddingLeft: 16,
          fontSize: 10,
          color: "#8b9cb3",
          lineHeight: 1.55,
          fontFamily: "var(--font-mono)",
          listStyle: "disc",
        }}
      >
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function buildScoreCategoryDebugLines(result: AnalysisResult): string[] {
  const pt = result.pageType ?? "default";
  const ev = pageEvalStandard(result.pageType);
  const hasCitation = (result.scores.citationScore ?? -1) >= 0;
  return [
    `pageType: ${pt}`,
    `프로필: ${ev.title} — ${ev.hint}`,
    hasCitation
      ? "이 카드 5분할(표시): AI 인용 / 문단 / 답변가능성 / SEO 구조 / 신뢰 — 가중 합산 표시"
      : "이 카드 4분할(표시): 문단 / 답변가능성 / SEO 구조 / 신뢰 — 인용 축 미노출 시",
    "최종 점수: 활성 scoring 설정 → 특징량 → 부분점수 → pageType 브랜치(웹·커머스·비디오) → finalScore (단일 고정 식 아님)",
  ];
}

function buildAxisCategoryDebugLines(result: AnalysisResult): string[] {
  const rows = getAxisRows(result);
  const keys = rows.map((r) => `${r.key}=${r.label}`).join(" · ");
  return [
    "카테고리: GeoAxis 부분 점수(0–100 스냅샷)",
    keys ? `포함 축: ${keys}` : "축 스냅샷 없음 (원시 점수만)",
    result.pageType === "video"
      ? "비디오: videoMetadata 축 포함 가능"
      : "웹/커머스: density 등 비디오 전용 축은 표시에서 제외될 수 있음",
  ];
}

function buildStrengthCategoryDebugLines(result: AnalysisResult): string[] {
  const lines: string[] = [];
  if (result.pageType === "video") {
    lines.push("엔진: runYoutubePassedEngine — youtubePassedCheckRules + geo_vid_* 등 유튜브 전용 신호");
  } else {
    lines.push(
      "엔진: runEditorialPassedEngine — runGeoRuleLayer 통과분 + 에디토리얼 strengthRules/geo_* + 커머스 제품 신호 + 월간 passedRules + 축 하이라이트"
    );
  }
  lines.push(
    result.geoExplain?.passed?.length
      ? "표시 우선순위: geoExplain.passed → PassedCheck 매핑"
      : "표시: deriveAuditIssues가 만든 passedChecks"
  );
  const sgd = result.geoExplain?.strengthGenerationDebug;
  if (sgd) {
    lines.push(`strengthRules 소스: ${sgd.source} · matched: ${sgd.matchedRuleIds?.length ? sgd.matchedRuleIds.join(", ") : "—"}`);
  }
  lines.push("항목 분류: GeoPassedItem.axis (축) + 규칙 id — 카드 우측 축 배지와 동일 체계");
  return lines;
}

function buildIssuesCategoryDebugLines(result: AnalysisResult): string[] {
  const lines: string[] = [];
  if (result.pageType === "video") {
    lines.push("엔진: runYoutubeIssueEngine (유튜브 전용 이슈 규칙)");
  } else {
    lines.push("엔진: runGeoRuleLayer 실패분 + runEditorialIssueEngine — 설정 이슈룰 + 축 약점 등");
  }
  const ig = result.geoExplain?.issueGenerationDebug;
  if (ig) {
    lines.push(`이슈룰 해석 소스: ${ig.source} · pageType: ${ig.pageType}`);
    lines.push(`매칭 규칙 id(일부): ${ig.matchedRuleIds?.slice(0, 12).join(", ") || "—"}${(ig.matchedRuleIds?.length ?? 0) > 12 ? " …" : ""}`);
  }
  const catLabels = GEO_ISSUE_CATEGORY_ORDER.map((c) => `${c}(${getIssueCategoryLabel(c)})`).join(" → ");
  lines.push(`UI 그룹 순서(카테고리): ${catLabels}`);
  return lines;
}

function buildRecommendationCategoryDebugLines(
  pageType: AnalysisResult["pageType"],
  rec: NonNullable<AnalysisResult["recommendations"]>
): string[] {
  const lines: string[] = [
    "생성: buildGeoRecommendationsFromSignals — 템플릿(ko/en) + 축/신호 기반 결정적 문구",
    "후처리: filterRecommendationsByPageType — 표면(에디토리얼/커머스/비디오)에 맞게 표시 문구 정리",
    `trace.locale: ${rec.trace?.locale ?? "—"}`,
  ];
  const gd = rec.guideGenerationDebug;
  if (gd) {
    lines.push(`월간 guideRules 병합: source=${gd.source} · ids=${gd.matchedRuleIds?.join(", ") || "—"}`);
  } else {
    lines.push("월간 guideRules: 병합 메타 없음(엔진만 또는 미매칭)");
  }
  lines.push(`pageType 기준 필터: ${pageType ?? "editorial"}`);
  return lines;
}

const SEARCH_SOURCE_LABEL: Record<string, string> = {
  google: "Google",
  naver: "Naver",
  community: "커뮤니티",
};

interface AuditPanelProps {
  result: AnalysisResult;
  /** Last /api/analyze response: cache hit layer for demo status */
  analyzeMeta?: { fromCache: boolean; cacheLayer: string } | null;
  issues: AuditIssue[];
  passedChecks: PassedCheck[];
  /** Client-derived or API: Naver Blog non-actionable technical items */
  platformConstraints?: PlatformConstraint[];
  activeIssueId: string | null;
  onIssueClick: (id: string) => void;
  onReset: () => void;
  onExportPPT: () => void;
  /** `forceRefresh: true` bypasses memory + Supabase cache (explicit re-analyze only). */
  onNavigate: (url: string, options?: { forceRefresh?: boolean }) => void;
  onQuestionClick?: (questionText: string) => void;
  onPassedCheckClick?: (pc: PassedCheck) => void;
  exporting: boolean;
  reanalyzing?: boolean;
}

const CATEGORY_ICONS: Record<string, ReactNode> = {
  citation: <Bot size={14} />,
  paragraph: <FileText size={14} />,
  answerability: <Lightbulb size={14} />,
  structure: <Layout size={14} />,
  trust: <Shield size={14} />,
};

function buildCategories(result: AnalysisResult) {
  const { scores } = result;
  const hasCitation = (scores.citationScore ?? -1) >= 0;

  const base = (arr: { id: string; label: string; score: number; maxScore: number; color: string }[]) =>
    arr.map((cat) => ({ ...cat, icon: CATEGORY_ICONS[cat.id] }));

  const L = GEO_SCORE_AXIS_LABEL_KO;
  if (hasCitation) {
    return base([
      { id: "citation", label: L.citation, score: Math.round((scores.citationScore ?? 0) * 0.40), maxScore: 40, color: "#a855f7" },
      { id: "paragraph", label: L.paragraph, score: Math.round((scores.paragraphScore ?? 0) * 0.15), maxScore: 15, color: "#5b6ef5" },
      { id: "answerability", label: L.answerability, score: Math.round((scores.answerabilityScore ?? 0) * 0.15), maxScore: 15, color: "#00d4c8" },
      { id: "structure", label: L.structure, score: Math.round(scores.structureScore * 0.15), maxScore: 15, color: "#34d399" },
      { id: "trust", label: L.trust, score: Math.round((scores.trustScore ?? 0) * 0.15), maxScore: 15, color: "#f5a623" },
    ]);
  }

  return base([
    { id: "paragraph", label: L.paragraph, score: Math.round((scores.paragraphScore ?? 0) * 0.35), maxScore: 35, color: "#5b6ef5" },
    { id: "answerability", label: L.answerability, score: Math.round((scores.answerabilityScore ?? 0) * 0.25), maxScore: 25, color: "#00d4c8" },
    { id: "structure", label: L.structure, score: Math.round(scores.structureScore * 0.20), maxScore: 20, color: "#34d399" },
    { id: "trust", label: L.trust, score: Math.round((scores.trustScore ?? 0) * 0.15), maxScore: 15, color: "#f5a623" },
  ]);
}

const INITIAL_QUESTIONS = 3;

function mapAiWritingPageType(r: AnalysisResult): AiWritingExamplesPageType {
  const pt = r.pageType ?? "editorial";
  if (pt === "video") return "video";
  if (pt === "commerce") return "commerce";
  if (r.reviewLike) return "review";
  if (r.editorialSubtype === "site_info") return "site_info";
  return "editorial";
}

function buildAiWritingContentSnippet(r: AnalysisResult): string {
  const parts: string[] = [];
  const d0 = r.meta.description?.trim();
  if (d0) parts.push(d0);
  const og = r.meta.ogDescription?.trim();
  if (og && og !== d0) parts.push(og);
  const chunkText = (r.chunkCitations ?? [])
    .slice(0, 12)
    .map((c) => c.text)
    .join("\n\n");
  if (chunkText) parts.push(chunkText);
  return parts.join("\n\n").slice(0, 14000);
}

const CARD_STYLE = {
  padding: "14px 16px",
  borderRadius: 12,
  border: "1px solid #1e2d45",
  background: "#0d1321",
} as const;

function CopyableBlock({
  children,
  label,
  copyLabel = "복사",
  copiedLabel = "복사됨",
}: {
  children: string;
  label?: string;
  copyLabel?: string;
  copiedLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = children;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [children]);

  const listItems = children
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.startsWith("- ") ? l.slice(2).trim() : l));

  return (
    <div style={{ position: "relative", marginBottom: 6 }}>
      <button
        type="button"
        onClick={handleCopy}
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 8px",
          borderRadius: 6,
          border: "1px solid #1e2d45",
          background: copied ? "rgba(52,211,153,0.15)" : "rgba(91,110,245,0.12)",
          color: copied ? "#34d399" : "#8b9cb3",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          cursor: "pointer",
          transition: "all 0.15s",
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? copiedLabel : copyLabel}
      </button>
      {label && (
        <div style={{ fontSize: 11, fontWeight: 600, color: "#7a8da3", marginBottom: 4 }}>{label}</div>
      )}
      <ul
        style={{
          paddingRight: 60,
          paddingLeft: 18,
          margin: 0,
          fontSize: 12,
          color: "#c4d0e0",
          lineHeight: 1.6,
          wordBreak: "break-word",
          listStyle: "circle",
        }}
      >
        {listItems.map((line, i) => (
          <li key={i} style={{ marginBottom: 4 }}>
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AuditPanel({
  result,
  analyzeMeta,
  issues,
  passedChecks,
  platformConstraints: platformConstraintsProp,
  activeIssueId,
  onIssueClick,
  onReset,
  onExportPPT,
  onNavigate,
  onQuestionClick,
  onPassedCheckClick,
  exporting,
  reanalyzing,
}: AuditPanelProps) {
  const searchParams = useSearchParams();
  /** Dev server only + `?debug=true`: show GEO issue/opportunity debug JSON in the panel. */
  const geoExplainDebugMode =
    process.env.NODE_ENV === "development" && searchParams.get("debug") === "true";

  const [filter, setFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [passedOpen, setPassedOpen] = useState(false);
  const [goldenOpen, setGoldenOpen] = useState(true);
  const [expandedPassedId, setExpandedPassedId] = useState<string | null>(null);
  /** User-controlled URL field; not overwritten when analysis returns (avoids canonical URL replacing input). */
  const [urlInput, setUrlInput] = useState(result.url);
  /** Last URL sent to / analyze (submit or re-analyze); used to enable/disable "분석" vs duplicate requests. */
  const [committedUrl, setCommittedUrl] = useState(result.url);
  const [questionsExpanded, setQuestionsExpanded] = useState(false);
  const [opportunitiesOpen, setOpportunitiesOpen] = useState(true);
  const [aiWritingExamplesOpen, setAiWritingExamplesOpen] = useState(false);
  const [aiWritingExamplesLoading, setAiWritingExamplesLoading] = useState(false);
  const [aiWritingExamplesError, setAiWritingExamplesError] = useState<string | null>(null);
  const [aiWritingExamplesData, setAiWritingExamplesData] = useState<AiWritingExamplesData | null>(null);
  const [aiWritingNotice, setAiWritingNotice] = useState<string | null>(null);
  const [aiWritingDegraded, setAiWritingDegraded] = useState(false);
  const [aiWritingFromCache, setAiWritingFromCache] = useState(false);
  const lastAiWritingFetchAtRef = useRef<Record<string, number>>({});

  const [configVersion, setConfigVersion] = useState<string | null>(null);
  const [configCreatedAt, setConfigCreatedAt] = useState<string | null>(null);
  const [configDaysLeft, setConfigDaysLeft] = useState<number | null>(null);
  const [monthlyResearchLines, setMonthlyResearchLines] = useState<string[]>([]);
  const [researchSourcesOpen, setResearchSourcesOpen] = useState(false);

  // Fetch latest active AI config metadata for badge display
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/geo-config/update', { signal: controller.signal });
        if (!mountedRef.current) return;
        if (!res.ok) return;
        const data = await res.json();
        if (data?.version) setConfigVersion(String(data.version));
        if (data?.created_at) setConfigCreatedAt(String(data.created_at));
        if (typeof data?.days_until_next_update === 'number') setConfigDaysLeft(data.days_until_next_update);
        const cfg = data?.config as { source_summary?: string[] } | undefined;
        if (Array.isArray(cfg?.source_summary)) {
          setMonthlyResearchLines(cfg.source_summary.map((s) => String(s).trim()).filter(Boolean));
        } else {
          setMonthlyResearchLines([]);
        }
      } catch {
        // silent
      }
    })();
    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    setAiWritingExamplesOpen(false);
    setAiWritingExamplesLoading(false);
    setAiWritingExamplesError(null);
    setAiWritingExamplesData(null);
    setAiWritingNotice(null);
    setAiWritingDegraded(false);
    setAiWritingFromCache(false);
  }, [result.normalizedUrl]);

  useEffect(() => {
    if (!result) return;
    console.log('[RESULT_DEBUG]', {
      url: result.url,
      normalizedUrl: result.normalizedUrl,
      analysisFetchTargetUrl: result.analysisFetchTargetUrl,
    });
  }, [result]);

  const AI_WRITING_FETCH_COOLDOWN_MS = 4000;

  const requestAiWritingExamples = useCallback(async () => {
    const loc = getRecommendationLocale(result.recommendations?.trace?.locale, result.meta, "");
    const aiAssistLocal = AI_WRITING_ASSISTANT_UI[loc];
    const urlKey = result.normalizedUrl;

    setAiWritingExamplesOpen(true);
    setAiWritingExamplesLoading(true);
    setAiWritingExamplesError(null);

    const title = result.meta.title?.trim() || result.meta.ogTitle?.trim() || "";
    const contentSnippet = buildAiWritingContentSnippet(result);
    const matchedFromAnalysis =
      result.recommendations?.guideGenerationDebug?.matchedGuideRules ?? [];
    const matchedGuideRules =
      matchedFromAnalysis.length > 0
        ? matchedFromAnalysis.map((g) => ({
            id: g.id,
            message: g.message,
            ...(g.priority ? { priority: g.priority } : {}),
          }))
        : undefined;
    const relatedIssueIds = (result.geoExplain?.issues ?? []).map((i) => i.id).filter(Boolean);
    const priorityNotes = result.recommendations?.actionPlan?.priorityNotes ?? [];
    const currentGuideText = priorityNotes[0]?.trim() || undefined;

    const body = {
      url: result.url,
      title,
      pageTitle: title,
      contentSnippet,
      contentText: contentSnippet,
      pageType: mapAiWritingPageType(result),
      questions: (result.searchQuestions ?? []).map((q) => q.text),
      recommendedSections: result.recommendations?.actionPlan.suggestedHeadings ?? [],
      locale: loc,
      ...(result.platform ? { platform: result.platform } : {}),
      ...(matchedGuideRules ? { matchedGuideRules } : {}),
      ...(relatedIssueIds.length > 0 ? { relatedIssueIds } : {}),
      ...(currentGuideText ? { currentGuideText } : {}),
    };

    const guideSig = getAiWritingGuideCacheSignature(body);
    const cached = readAiWritingCache(urlKey, guideSig);
    if (cached) {
      console.log("[AI WRITING FETCH SKIPPED - USING EXISTING STATE]");
      setAiWritingExamplesData(cached.data);
      setAiWritingNotice(cached.notice ?? null);
      setAiWritingDegraded(Boolean(cached.degraded));
      setAiWritingFromCache(true);
      setAiWritingExamplesError(null);
      setAiWritingExamplesLoading(false);
      return;
    }

    setAiWritingFromCache(false);
    const lastFetch = lastAiWritingFetchAtRef.current[urlKey] ?? 0;
    if (Date.now() - lastFetch < AI_WRITING_FETCH_COOLDOWN_MS && lastFetch > 0) {
      setAiWritingExamplesError(aiAssistLocal.rateLimitWait);
      setAiWritingExamplesLoading(false);
      return;
    }
    lastAiWritingFetchAtRef.current[urlKey] = Date.now();

    setAiWritingNotice(null);
    setAiWritingDegraded(false);

    try {
      const requestBody = body;
      console.log("[AI WRITING FETCH START]", requestBody);
      const res = await fetch("/api/ai-writing-examples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      console.log("[AI WRITING FETCH RESPONSE STATUS]", res.status);
      const json = (await res.json()) as AiWritingExamplesApiResponse & { error?: string };
      console.log("[AI WRITING FETCH RESPONSE JSON]", json);

      if (!res.ok) {
        setAiWritingExamplesError(json.error ?? ("message" in json ? json.message : undefined) ?? "Request failed");
        return;
      }

      if (json.aiAvailable && json.data) {
        setAiWritingExamplesData(json.data);
        setAiWritingNotice(json.notice ?? null);
        setAiWritingDegraded(Boolean(json.degraded));
        writeAiWritingCache(urlKey, guideSig, {
          data: json.data,
          notice: json.notice ?? null,
          degraded: json.degraded,
        });
        setAiWritingExamplesError(null);
        return;
      }

      if (!json.aiAvailable && json.reason === "quota") {
        const fb = buildFallbackAiWritingExamples(body, loc);
        setAiWritingExamplesData(fb);
        setAiWritingNotice(AI_WRITING_QUOTA_NOTICE[loc]);
        setAiWritingDegraded(true);
        writeAiWritingCache(urlKey, guideSig, {
          data: fb,
          notice: AI_WRITING_QUOTA_NOTICE[loc],
          degraded: true,
        });
        setAiWritingExamplesError(null);
        return;
      }

      if (!json.aiAvailable) {
        const parts = [
          json.message ?? "AI writing examples are not available.",
          json.keySource === "dedicated"
            ? "(키: 무료 전용)"
            : json.keySource === "paid_fallback"
              ? "(키: 유료 폴백 — GEMINI_WRITING_EXAMPLES_API_KEY 비어 있음)"
              : json.keySource === "none"
                ? "(키 없음)"
                : "",
          json.detail ? `— ${json.detail}` : "",
        ].filter(Boolean);
        setAiWritingExamplesError(parts.join(" "));
        return;
      }

      setAiWritingExamplesError("Invalid response from server.");
    } catch {
      setAiWritingExamplesError("Network error. Please try again.");
    } finally {
      setAiWritingExamplesLoading(false);
    }
  }, [result]);

  const goldenParagraphs = (result.chunkCitations ?? [])
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const gi = getGradeInfo(result.scores.finalScore);
  const categories = buildCategories(result);
  const scoreExplanation = useMemo(() => {
    if (!geoExplainDebugMode) return null;
    return buildGeoScoreExplanation(result);
  }, [result, geoExplainDebugMode]);

  const geo = hasGeoExplain(result);
  const geoExplain = result.geoExplain;
  const useGeoIssueList = Boolean(geo && geoExplain && geoExplain.issues.length > 0);
  const geoIssues: GeoIssue[] = useGeoIssueList ? dedupeGeoIssuesById(geoExplain!.issues) : [];

  const filteredGeoIssues =
    filter === "all" ? geoIssues : geoIssues.filter((i) => i.severity === filter);
  const filteredLegacyIssues = filter === "all" ? issues : issues.filter((i) => i.priority === filter);
  const filtered = useGeoIssueList ? filteredGeoIssues : filteredLegacyIssues;

  const issueCounts = useGeoIssueList
    ? {
        high: geoIssues.filter((i) => i.severity === "high").length,
        medium: geoIssues.filter((i) => i.severity === "medium").length,
        low: geoIssues.filter((i) => i.severity === "low").length,
      }
    : {
        high: issues.filter((i) => i.priority === "high").length,
        medium: issues.filter((i) => i.priority === "medium").length,
        low: issues.filter((i) => i.priority === "low").length,
      };

  const strengthRows = getStrengthRows(result, passedChecks);

  const axisRows = getAxisRows(result);
  const recLocale = getRecommendationLocale(result.recommendations?.trace?.locale, result.meta, "");
  /** Panel chrome (titles, section headers, copy actions) stays Korean; recommendation body text follows `recLocale`. */
  const sec = RECOMMENDATION_SECTION_LABELS.ko;
  const aiAssist = AI_WRITING_ASSISTANT_UI.ko;
  const focusByAxis = CONTENT_FOCUS_LABEL[recLocale];
  const copyUi = { copy: "복사", copied: "복사됨" } as const;
  const opportunities = geoExplain?.opportunities ?? [];

  const platformConstraints = platformConstraintsProp ?? result.platformConstraints;

  const auditIssueById = (id: string) => issues.find((i) => i.id === id);

  const geoIssueGroups = useGeoIssueList ? groupGeoIssuesByCategory(filteredGeoIssues) : [];

  const auditIssueIds = useMemo(() => {
    if (useGeoIssueList && geoExplain?.issues?.length) {
      return dedupeGeoIssuesById(geoExplain.issues).map((g) => g.id);
    }
    return issues.map((i) => i.id);
  }, [useGeoIssueList, geoExplain?.issues, issues]);
  const strengthOpportunities = useMemo(
    () => generateOpportunities(result, result.pageType ?? "default", auditIssueIds),
    [result, auditIssueIds]
  );
  const auditIssueCount = useGeoIssueList ? geoIssues.length : issues.length;
  const showStrengthOpportunities = auditIssueCount <= 2 && strengthOpportunities.length > 0;

  /**
   * While reanalyzing: show the in-flight request URL (committedUrl / urlInput), not `result.normalizedUrl`.
   * If the user edits the field during the request, show their draft (urlInput).
   */
  const userFacingUrlForLoadingUi =
    reanalyzing && urlInput.trim() !== committedUrl.trim()
      ? urlInput
      : committedUrl.trim() || urlInput.trim();

  return (
    <aside
      style={{
        width: 360,
        flexShrink: 0,
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#0a0f1a",
        borderRight: "1px solid #1e2d45",
        overflow: "hidden",
        minHeight: 0,
      }}
    >
      {/* 헤더 - 고정 */}
      <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #1e2d45" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start"}}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "#818cf8", fontFamily: "var(--font-mono)", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                GEO Analyzer
              </span>
              {analyzeMeta && (
                <span
                  style={{
                    fontSize: 10,
                    padding: "2px 8px",
                    borderRadius: 4,
                    background: analyzeMeta.fromCache ? "rgba(52,211,153,0.12)" : "rgba(91,110,245,0.15)",
                    color: analyzeMeta.fromCache ? "#34d399" : "#a5b4fc",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {analyzeMeta.fromCache
                    ? analyzeMeta.cacheLayer === "memory"
                      ? "캐시 · 메모리"
                      : analyzeMeta.cacheLayer === "supabase"
                        ? "캐시 · 저장소"
                        : "캐시"
                    : "실시간 분석"}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: "#7a8da3", lineHeight: 1.45 }}>
              <span style={{ color: "#9ca3af" }}>월간 GEO 기준</span>
              {" : "}
              <span style={{ fontFamily: "var(--font-mono)", color: "#c4d0e0" }}>
                {configVersion ?? result.geoConfigVersion ?? "—"}
                {" "}
              </span>
              {configCreatedAt && (
                <p style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span>
                    갱신{" "}
                    {new Date(configCreatedAt)
                      .toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" })
                      .replace(/\s/g, "")}
                  </span>
                  {configDaysLeft != null && <span>(다음 기준 갱신까지 약 {configDaysLeft}일)</span>}
                </p>
              )}
            </div>
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = urlInput.trim();
            if (!trimmed || trimmed === committedUrl.trim()) return;
            setCommittedUrl(trimmed);
            onNavigate(trimmed);
          }}
          style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
        >
          <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
            {reanalyzing && (
              <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", display: "inline-block", animation: "spin 0.8s linear infinite", color: "#5b6ef5", fontSize: 12, zIndex: 1 }}>⚙</span>
            )}
            <input
              type="url"
              value={reanalyzing ? userFacingUrlForLoadingUi : urlInput}
              title={geoExplainDebugMode ? `display: user URL · normalized: ${result.normalizedUrl}` : undefined}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://example.com"
              style={{
                width: "100%",
                padding: reanalyzing ? "6px 8px 6px 24px" : "6px 8px",
                borderRadius: 6,
                background: "#080c14",
                border: "1px solid #1e2d45",
                color: "#e8edf5",
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                outline: "none",
                boxSizing: "border-box",
                opacity: reanalyzing ? 0.5 : 1,
                transition: "border-color 0.2s, opacity 0.2s",
              }}
              onFocus={(e) => { e.target.style.borderColor = "#5b6ef5"; }}
              onBlur={(e) => { e.target.style.borderColor = "#1e2d45"; }}
            />
          </div>
          <button
            type="submit"
            disabled={reanalyzing || !urlInput.trim() || urlInput.trim() === committedUrl.trim()}
            style={{
              flexShrink: 0,
              padding: "6px 10px",
              borderRadius: 6,
              background: "linear-gradient(135deg, #5b6ef5, #00d4c8)",
              border: "none",
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              cursor: reanalyzing ? "not-allowed" : "pointer",
              opacity: (reanalyzing || !urlInput.trim() || urlInput.trim() === committedUrl.trim()) ? 0.4 : 1,
              transition: "opacity 0.2s",
              fontFamily: "var(--font-mono)",
            }}
          >
            분석
          </button>
          <button
            type="button"
            disabled={reanalyzing}
            title="캐시를 쓰지 않고 이 URL을 처음부터 다시 분석합니다"
            onClick={() => {
              const t = urlInput.trim();
              if (!t) return;
              setCommittedUrl(t);
              onNavigate(t, { forceRefresh: true });
            }}
            style={{
              flexShrink: 0,
              padding: "6px 10px",
              borderRadius: 6,
              background: "transparent",
              border: "1px solid #3d4f6f",
              color: "#a8c4e8",
              fontSize: 11,
              fontWeight: 600,
              cursor: reanalyzing ? "not-allowed" : "pointer",
              opacity: reanalyzing ? 0.5 : 1,
              fontFamily: "var(--font-body)",
            }}
          >
            다시 분석
          </button>
        </form>
        {(() => {
          const ev = pageEvalStandard(result.pageType);
          return (
            <>
              <div
                style={{
                  marginTop: 10,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: `1px solid ${ev.color}44`,
                  background: `${ev.color}10`,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  flexWrap: "wrap",
                  flexDirection: "column",
                }}
              >
                <div style={{
                  display:"flex",
                  alignItems:"center",
                  gap: 8,
                  flexWrap: "wrap",
                }}>
                  <span style={{ fontSize: 10, color: "#6d8099", fontFamily: "var(--font-mono)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    평가 기준
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: ev.color, fontFamily: "var(--font-body)" }}>{ev.title}</span>
                  {result.pageType === "editorial" && result.editorialSubtype && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#a8c4e8", fontFamily: "var(--font-body)" }}>
                      ({EDITORIAL_SUBTYPE_LABEL[result.editorialSubtype]})
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "#8b9cb3", flex: 1, minWidth: 140 }}>{ev.hint}</div>
              </div>
            </>
          );
        })()}
      </div>

      {/* 스크롤 영역 — 카드 레이아웃, gap-y-6 */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 24,
          padding: "16px 12px 20px",
        }}
      >
      {monthlyResearchLines.length > 0 && (
        <div style={CARD_STYLE}>
          <button
            type="button"
            onClick={() => setResearchSourcesOpen((v) => !v)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "4px 0 8px",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ExternalLink size={16} style={{ color: "#5b6ef5" }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#e8edf5" }}>월간 GEO 리서치 출처</span>
              <span style={{ fontSize: 10, color: "#6d8099", fontFamily: "var(--font-mono)" }}>
                ({monthlyResearchLines.length})
              </span>
            </div>
            {researchSourcesOpen ? <ChevronUp size={16} color="#7a8da3" /> : <ChevronDown size={16} color="#7a8da3" />}
          </button>
          {researchSourcesOpen && (
            <ul style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 8 }}>
              {monthlyResearchLines.map((line, i) => {
                const m = line.match(/(https?:\/\/[^\s<]+[^\s<.,;)]?)/);
                if (!m) {
                  return (
                    <li key={`mr-${i}`} style={{ fontSize: 12, color: "#a8b8cc", lineHeight: 1.5 }}>
                      {line}
                    </li>
                  );
                }
                const url = m[1] ?? m[0];
                const parts = line.split(url);
                const after = parts.length > 1 ? parts.slice(1).join(url) : "";
                return (
                  <li key={`mr-${i}`} style={{ fontSize: 12, color: "#a8b8cc", lineHeight: 1.5 }}>
                    {parts[0]}
                    <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "#00d4c8", wordBreak: "break-all" }}>
                      {url}
                    </a>
                    {after}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {/* 쿼터 제한 알림 (상단 고정) */}
      {result.llmStatuses?.some((s) => s.status === "skipped_quota") && (
        <div
          style={{
            ...CARD_STYLE,
            background: "rgba(245,166,35,0.08)",
            border: "1px solid rgba(245,166,35,0.4)",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4, color: "#f5a623" }}>
            {result.llmStatuses?.find((s) => s.status === "skipped_quota")?.message ??
              "Gemini 무료 쿼터 제한으로 일부 AI 기능이 일시 스킵되었습니다."}
          </div>
          <div style={{ color: "#8b9cb3", fontSize: 11 }}>
            추천·인용평가 등
            {(() => {
              const sec = Math.max(...(result.llmStatuses ?? [])
                .filter((s) => s.status === "skipped_quota" && s.retryAfterSec != null)
                .map((s) => s.retryAfterSec ?? 0));
              return sec > 0 ? ` · 약 ${sec}초 후 재시도 가능` : "";
            })()}
          </div>
        </div>
      )}
      {/* 제한된 분석 알림 (예: WAF/Access Denied, 짧은 HTML 등) */}
      {result.limitedAnalysis && (
        <div
          style={{
            ...CARD_STYLE,
            background: "rgba(245,245,245,0.03)",
            border: "1px solid rgba(196,208,224,0.04)",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6, color: "#f5a623" }}>
            제한된 분석 — 일부 데이터가 수집되지 않았습니다
          </div>
          <div style={{ color: "#8b9cb3", fontSize: 12, lineHeight: 1.5 }}>
            {result.limitedReason === 'short_html' && '수집된 HTML이 매우 짧아(또는 빈 응답) 페이지의 주요 콘텐츠를 분석할 수 없습니다.'}
            {result.limitedReason === 'site_protection' && '웹방화벽 또는 접근제한으로 인해 페이지 본문이 반환되지 않았습니다 (Access Denied / Captcha).'}
            {!result.limitedReason && '페이지가 부분적으로 로드되었거나 보호되어 분석이 제한되었습니다.'}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#6d8099" }}>
            이 경우 프록시/헤드리스 등의 우회 시도는 Phase 2로 보관되어 있으며, 현재는 안전한 화이트리스트 폴백을 사용합니다.
          </div>
        </div>
      )}

      {/* 1. 종합 GEO 점수 */}
      <div style={CARD_STYLE}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 14 }}>
          <ScoreGauge score={result.scores.finalScore} size={100} strokeWidth={8} />
          <div style={{ textAlign: "center", marginTop: 4 }}>
            <div style={{ fontSize: 11, color: "#7a8da3", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>
              종합 GEO 점수
            </div>
            {/* <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 4 }}>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 800, color: gi.color }}>{result.scores.finalScore}</span>
              <span style={{ fontSize: 12, color: "#7a8da3" }}>/ 100</span>
            </div> */}
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, background: `${gi.color}18`, border: `1px solid ${gi.color}44`, color: gi.color, fontWeight: 600, display: "inline-block", marginTop: 4 }}>
              {gi.label}
            </span>
          </div>
        </div>

        {scoreExplanation && (
          <div
            style={{
              marginBottom: 14,
              padding: "12px 12px",
              borderRadius: 10,
              background: "rgba(91,110,245,0.06)",
              border: "1px solid rgba(91,110,245,0.18)",
            }}
          >
            <div style={{ fontSize: 10, color: "#7a8da3", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              점수 해설 (디버그)
            </div>
            <p style={{ fontSize: 12, color: "#c4d0e0", lineHeight: 1.55, margin: 0 }}>{scoreExplanation.summary}</p>
            {scoreExplanation.strengths.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 10, color: "#34d399", fontWeight: 600, marginBottom: 4 }}>강점</div>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#a8b8cc", fontSize: 11, lineHeight: 1.5 }}>
                  {scoreExplanation.strengths.map((line, i) => (
                    <li key={`se-s-${i}`}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            {scoreExplanation.weaknesses.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 10, color: "#f5a623", fontWeight: 600, marginBottom: 4 }}>보완 포인트</div>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#a8b8cc", fontSize: 11, lineHeight: 1.5 }}>
                  {scoreExplanation.weaknesses.map((line, i) => (
                    <li key={`se-w-${i}`}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 12px"}}>
          {categories.map((cat) => {
            const pct = Math.min((cat.score / cat.maxScore) * 100, 100);
            return (
              <div key={cat.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ display: "flex", alignItems: "center", color: cat.color, flexShrink: 0 }}>{cat.icon}</span>
                  <span style={{ fontSize: 11, color: "#e8edf5", fontWeight: 500, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.label}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: cat.color, flexShrink: 0 }}>{cat.score}/{cat.maxScore}</span>
                </div>
                <div style={{ height: 4, background: "#1e2d45", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: cat.color, borderRadius: 99, transition: "width 0.8s" }} />
                </div>
              </div>
            );
          })}
        </div>
        <DebugCategoryBox
          show={geoExplainDebugMode}
          heading="[debug] 점수 기준 · 카테고리"
          lines={buildScoreCategoryDebugLines(result)}
        />

        {/* 2. 축 점수 (0–100, GEO Explain) */}
        {axisRows.length > 0 && (
          <div style={{borderTop: '1px solid #1e2d45', paddingTop: 20, marginTop:20}}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#7a8da3", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
              세부 점수 (0-100)
            </div>
            <DebugCategoryBox
              show={geoExplainDebugMode}
              heading="[debug] 세부 점수(축) 기준 · 카테고리"
              lines={buildAxisCategoryDebugLines(result)}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" }}>
              {axisRows.map((row) => (
                <div key={row.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "#c4d0e0", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.label}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, color: "#5b6ef5", flexShrink: 0 }}>{row.value}</span>
                  </div>
                  {/* <div style={{ height: 4, background: "#1e2d45", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${row.value}%`, background: "linear-gradient(90deg, #5b6ef5, #00d4c8)", borderRadius: 99, transition: "width 0.6s" }} />
                  </div> */}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 2. 발견된 이슈 */}
      <div style={CARD_STYLE}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <GeoIssuesAlertIcon />
          <div style={{ fontSize: 14, fontWeight: 700, color: "#7a8da3", fontFamily: "var(--font-body)" }}>
            발견된 이슈 ({useGeoIssueList ? geoIssues.length : issues.length})
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["all", "high", "medium", "low"] as const).map((f) => {
            const cfg =
              f === "all"
                ? { label: `전체 ${useGeoIssueList ? geoIssues.length : issues.length}`, color: "#8b9cb3" }
                : { label: `${PRIORITY_COLORS[f].label} ${issueCounts[f]}`, color: PRIORITY_COLORS[f].color };
            const active = filter === f;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 99,
                  border: `1px solid ${active ? cfg.color : "#1e2d45"}`,
                  background: active ? `${cfg.color}18` : "transparent",
                  color: active ? cfg.color : "#7a8da3",
                  fontSize: 12,
                  fontWeight: active ? 700 : 400,
                  cursor: "pointer",
                  fontFamily: "var(--font-mono)",
                  transition: "all 0.15s",
                }}
              >
                {cfg.label}
              </button>
            );
          })}
        </div>
        <DebugCategoryBox
          show={geoExplainDebugMode}
          heading="[debug] 발견된 이슈 · 카테고리"
          lines={buildIssuesCategoryDebugLines(result)}
        />
        <div style={{ marginTop: 10 }}>
          {filtered.length === 0 && (
            <div style={{ textAlign: "center", color: "#7a8da3", fontSize: 14, marginTop: 24 }}>
              해당 이슈 없음
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {useGeoIssueList ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {geoIssueGroups.map((group) => (
                  <div key={group.category} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#a8b4c8",
                        fontFamily: "var(--font-mono)",
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        padding: "4px 2px 0",
                        borderBottom: "1px solid #1e2d45",
                        paddingBottom: 6,
                      }}
                    >
                      {getIssueCategoryLabel(group.category)}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {group.issues.map((g) => (
                        <GeoIssueCard
                          key={g.id}
                          g={g}
                          issueNum={geoIssues.findIndex((x) => x.id === g.id) + 1}
                          activeIssueId={activeIssueId}
                          onIssueClick={onIssueClick}
                          auditIssueById={auditIssueById}
                          geoExplainDebugMode={geoExplainDebugMode}
                          hideCategoryBadge
                          axisFriendlyLabel={focusByAxis[g.axis as GeoAxis] ?? GEO_AXIS_LABEL[g.axis] ?? g.axis}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              (filtered as AuditIssue[]).map((issue) => {
                  const cfg = PRIORITY_COLORS[issue.priority];
                  const isActive = activeIssueId === issue.id;
                  const hasFixExamples = issue.fixExamples && issue.fixExamples.length > 0;
                  return (
                    <div key={issue.id} style={{ display: "flex", flexDirection: "column" }}>
                      <button
                        onClick={() => onIssueClick(issue.id)}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 10,
                          padding: "10px 12px",
                          borderRadius: isActive && hasFixExamples ? "8px 8px 0 0" : 8,
                          borderTop: `1px solid ${isActive ? cfg.color + "66" : cfg.border}`,
                          borderRight: `1px solid ${isActive ? cfg.color + "66" : cfg.border}`,
                          borderLeft: `1px solid ${isActive ? cfg.color + "66" : cfg.border}`,
                          borderBottom: isActive && hasFixExamples ? "none" : `1px solid ${isActive ? cfg.color + "66" : cfg.border}`,
                          background: isActive ? cfg.bg : "transparent",
                          cursor: "pointer",
                          textAlign: "left",
                          transition: "all 0.15s",
                          width: "100%",
                        }}
                      >
                        <span
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: "50%",
                            background: cfg.color,
                            color: "#fff",
                            fontSize: 12,
                            fontWeight: 800,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            marginTop: 1,
                            fontFamily: "var(--font-mono)",
                            boxShadow: isActive ? `0 0 8px ${cfg.color}66` : "none",
                          }}
                        >
                          {issue.number}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: "#e8edf5", lineHeight: 1.3 }}>{issue.label}</span>
                            {hasFixExamples && (isActive ? <ChevronUp size={14} style={{ color: "#5b6ef5", flexShrink: 0 }} /> : <ChevronDown size={14} style={{ color: "#7a8da3", flexShrink: 0 }} />)}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: "#8b9cb3",
                              lineHeight: 1.5,
                              display: isActive ? "block" : "-webkit-box",
                              WebkitLineClamp: isActive ? undefined : 2,
                              WebkitBoxOrient: "vertical",
                              overflow: isActive ? "visible" : "hidden",
                            }}
                          >
                            {issue.description}
                          </div>
                        </div>
                      </button>
                      {isActive && hasFixExamples && (
                        <div style={{ border: `1px solid ${cfg.color}66`, borderTop: `1px dashed ${cfg.color}33`, borderRadius: "0 0 8px 8px", background: "#080d16", overflow: "hidden" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 12px", borderBottom: "1px solid #1a2436" }}>
                            <span style={{ fontSize: 12, color: "#5b6ef5", fontFamily: "var(--font-mono)", fontWeight: 600, letterSpacing: "0.05em" }}>수정 예시</span>
                          </div>
                          {issue.fixExamples!.map((fix, fidx) => (
                            <FixCodeBlock key={`${issue.id}-fix-${fidx}`} fix={fix} accentColor={cfg.color} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
            )}
          </div>
          {showStrengthOpportunities && (
            <div style={{ borderTop: "1px solid #1e2d45", paddingTop: 20, marginTop: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#7a8da3", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  보강 포인트 ({strengthOpportunities.length})
                </span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8, listStyle: "disc" }}>
                {strengthOpportunities.map((line, i) => (
                  <li key={`strength-opp-${i}`} style={{ fontSize: 13, color: "#a8b8cc", lineHeight: 1.5 }}>
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* 3. 질문 커버리지 — optional hide (geoUiFlags) */}
      <div style={CARD_STYLE}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <Search size={18} style={{ color: "#00d4c8" }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: "#e8edf5", fontFamily: "var(--font-body)" }}>
            {GEO_REPORT_LABELS_KO.questionCoverageSlideTitle}
          </span>
        </div>
        {(() => {
          const qs = result.questionSourceStatus;
          const externalQuestionDataUnreliable =
            qs === "fallback_only" || qs === "tavily_failed";
          return externalQuestionDataUnreliable ? (
            <div
              style={{
                marginBottom: 10,
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid rgba(240,92,122,0.35)",
                background: "rgba(240,92,122,0.06)",
                fontSize: 12,
                color: "#e8b4bf",
                lineHeight: 1.45,
              }}
            >
              외부 질문 데이터를 불러오지 못했습니다
            </div>
          ) : null;
        })()}
        <div style={{ maxHeight: 340, overflowY: "auto", marginBottom: 8 }}>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
            {(() => {
              const qs = result.questionSourceStatus;
              const hideUserSourceLabels = qs === "fallback_only" || qs === "tavily_failed";
              const showFallbackExamplesHeading = qs === "fallback_only" && (result.searchQuestions?.length ?? 0) > 0;

              const covered = result.searchQuestionCovered ?? result.searchQuestions?.map(() => false) ?? [];
              const uncoveredTop3Set = new Set(
                (result.recommendations?.predictedUncoveredTop3 ?? []).map((q) => q.question)
              );

              const userItems = (result.searchQuestions ?? []).map((q, i) => ({
                type: "user" as const,
                text: q.text,
                isCovered: covered[i] ?? false,
                source: q.source,
                refUrl: q.url,
                domain: q.source === "community" ? getDomainFromUrl(q.url) : null,
                key: `u-${i}`,
              }));

              const aiItems = (result.recommendations?.predictedQuestions ?? []).map((q, i) => ({
                type: "ai" as const,
                text: q.question,
                isCovered: q.coveredByPage ?? false,
                isUncoveredTop3: uncoveredTop3Set.has(q.question),
                importanceReason: q.importanceReason,
                key: `a-${i}`,
              }));

              const all = [...userItems, ...aiItems].sort((a, b) => {
                const aTop = "isUncoveredTop3" in a && a.isUncoveredTop3 ? 1 : 0;
                const bTop = "isUncoveredTop3" in b && b.isUncoveredTop3 ? 1 : 0;
                return bTop - aTop;
              });
              const visibleCount = questionsExpanded ? all.length : Math.min(INITIAL_QUESTIONS, all.length);
              const visible = all.slice(0, visibleCount);

              if (all.length === 0) {
                return (
                  <li style={{ padding: "12px 10px", fontSize: 12, color: "#7a8da3", fontStyle: "italic" }}>
                    {qs === "tavily_failed" || qs === "fallback_only"
                      ? "표시할 질문이 없습니다"
                      : "수집된 질문 없음"}
                  </li>
                );
              }

              return (
                <>
                  {showFallbackExamplesHeading && (
                    <li style={{ listStyle: "none", padding: "4px 2px 0", fontSize: 11, color: "#7a8da3" }}>
                      관련 질문 예시
                    </li>
                  )}
                  {visible.map((item) => {
                    const isUncovered = item.type === "user" ? !item.isCovered : !item.isCovered;

                    return (
                      <li key={item.key}>
                        <button
                          type="button"
                          onClick={() => item.isCovered && onQuestionClick?.(item.text)}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 8,
                            padding: "8px 10px",
                            borderRadius: 8,
                            border: "1px solid #1e2d45",
                            background: "transparent",
                            cursor: item.isCovered && onQuestionClick ? "pointer" : "default",
                            textAlign: "left",
                            transition: "all 0.15s",
                          }}
                          onMouseEnter={(e) => {
                            if (item.isCovered && onQuestionClick)
                              e.currentTarget.style.background = "rgba(0,212,200,0.06)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "transparent";
                          }}
                        >
                          {isUncovered ? (
                            <X size={16} style={{ flexShrink: 0, marginTop: 2, color: "#f05c7a" }} />
                          ) : (
                            <Circle size={16} style={{ flexShrink: 0, marginTop: 2, color: "#34d399" }} />
                          )}
                          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                            <span style={{ fontSize: 12, color: "#c4d0e0", lineHeight: 1.5 }}>
                              {item.text}
                            </span>
                            {item.type === "user" && !hideUserSourceLabels && (
                              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 2 }}>
                                <span
                                  style={{
                                    fontSize: 10,
                                    padding: "1px 6px",
                                    borderRadius: 4,
                                    background: "rgba(0,212,200,0.1)",
                                    color: "#5eead4",
                                    fontFamily: "var(--font-mono)",
                                  }}
                                >
                                  {SEARCH_SOURCE_LABEL[item.source] ?? item.source}
                                </span>
                                {"refUrl" in item && item.refUrl && (
                                  <a
                                    href={item.refUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                      fontSize: 10,
                                      color: "#00d4c8",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 4,
                                      textDecoration: "none",
                                      maxWidth: "100%",
                                    }}
                                  >
                                    <ExternalLink size={10} style={{ flexShrink: 0 }} />
                                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {item.refUrl.replace(/^https?:\/\//, "").slice(0, 56)}
                                      {item.refUrl.length > 56 ? "…" : ""}
                                    </span>
                                  </a>
                                )}
                                {"domain" in item && item.domain && (
                                  <span style={{ fontSize: 10, color: "#6d8099" }}>{item.domain}</span>
                                )}
                              </div>
                            )}
                            {item.type === "ai" && item.importanceReason && (
                              <div style={{ fontSize: 11, color: "#7a8da3" }}>{item.importanceReason}</div>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </>
              );
            })()}
          </ul>
        </div>
        {((result.searchQuestions?.length ?? 0) + (result.recommendations?.predictedQuestions?.length ?? 0)) > INITIAL_QUESTIONS && (
          !questionsExpanded ? (
            <button
              type="button"
              onClick={() => setQuestionsExpanded(true)}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px dashed #1e2d45",
                background: "transparent",
                color: "#00d4c8",
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
              }}
            >
              View More ({(result.searchQuestions?.length ?? 0) + (result.recommendations?.predictedQuestions?.length ?? 0) - INITIAL_QUESTIONS})
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setQuestionsExpanded(false)}
              style={{
                width: "100%",
                padding: "6px 12px",
                borderRadius: 8,
                border: "none",
                background: "transparent",
                color: "#7a8da3",
                fontSize: 11,
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
              }}
            >
              접기
            </button>
          )
        )}
      </div>

      {/* 4. 잘된 점 / Strengths */}
      <div style={CARD_STYLE}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <GeoStrengthTrophyIcon />
            <span style={{ fontSize: 14, fontWeight: 700, color: "#e8edf5", fontFamily: "var(--font-body)" }}>
              잘된 점 {strengthRows.length > 0 ? `(${strengthRows.length})` : ""}
            </span>
          </div>
        </div>
        <DebugCategoryBox
          show={geoExplainDebugMode}
          heading="[debug] 잘된 점 기준 · 카테고리"
          lines={buildStrengthCategoryDebugLines(result)}
        />

        {strengthRows.length === 0 ? (
          <div style={{ fontSize: 13, color: "#7a8da3", padding: "8px 4px" }}>
            No strong GEO signals were detected yet.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(strengthRows.slice(0, passedOpen ? strengthRows.length : Math.min(5, strengthRows.length))).map((row) => {
                const legacyPc = passedChecks.find((p) => p.id === row.id);
                const isExpanded = expandedPassedId === row.id;
                return (
                  <button
                    key={row.id}
                    onClick={() => {
                      setExpandedPassedId(isExpanded ? null : row.id);
                      if (legacyPc?.position && onPassedCheckClick) onPassedCheckClick(legacyPc);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: `1px solid ${isExpanded ? "rgba(52,211,153,0.4)" : "rgba(52,211,153,0.06)"}`,
                      background: isExpanded ? "rgba(52,211,153,0.04)" : "transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.15s",
                      width: "100%",
                    }}
                  >
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: "rgba(52,211,153,0.18)",
                        color: "#10b981",
                        fontSize: 12,
                        fontWeight: 800,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        marginTop: 1,
                      }}
                    >
                      <Check size={12} strokeWidth={3} style={{ color: "inherit" }} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: isExpanded ? 6 : 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "#c4d0e0", lineHeight: 1.3 }}>{row.label}</span>
                        {isExpanded ? <ChevronUp size={14} style={{ color: "#34d399", flexShrink: 0 }} /> : <ChevronDown size={14} style={{ color: "#7a8da3", flexShrink: 0 }} />}
                      </div>
                      {isExpanded && (
                        <div style={{ fontSize: 12, color: "#8b9cb3", lineHeight: 1.6, borderTop: "1px dashed rgba(52,211,153,0.12)", paddingTop: 6, marginTop: 4 }}>
                          {row.description && row.description !== row.label && (
                            <div style={{ marginBottom: row.reason ? 8 : 0, color: "#a8b8cc" }}>{row.description}</div>
                          )}
                          {row.reason}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {strengthRows.length > 5 && (
              <div style={{ marginTop: 10, display: "flex", justifyContent: "center" }}>
                <button
                  type="button"
                  onClick={() => setPassedOpen((v) => !v)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid #1e2d45",
                    background: "transparent",
                    color: "#00d4c8",
                    fontSize: 12,
                    cursor: "pointer",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {passedOpen ? "View Less" : `View More (${strengthRows.length - 5})`}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 5. 콘텐츠 개선 가이드 (요약 → 갭 → 우선 작업 → 소제목 → 블록 → 작성 예시) */}
      {result.recommendations && (() => {
        const rec = result.recommendations;
        const improvementSummaryLabel =
          result.pageType === "video"
            ? sec.improvementSummaryVideo
            : result.pageType === "editorial" && result.reviewLike
              ? sec.improvementSummaryReview
              : sec.improvementSummary;
        const guideTitle =
          result.pageType === "video" ? "영상 설명란 개선 가이드" : "콘텐츠 개선 가이드";
        const headingsSectionLabel =
          result.pageType === "video"
            ? sec.recommendedHeadingsVideo
            : result.pageType === "commerce"
              ? sec.recommendedHeadingsCommerce
              : sec.recommendedHeadings;
        const blocksJoin = "\n";
        const blocksText = rec.actionPlan.suggestedBlocks.join(blocksJoin);
        return (
        <div
          style={{
            ...CARD_STYLE,
            background: "linear-gradient(180deg, rgba(99,102,241,0.15) 0%, rgba(99,102,241,0.06) 100%)",
            border: "1px solid rgba(99,102,241,0.35)",
          }}
        >
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              <Sparkles size={18} style={{ color: "#818cf8" }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: "#e8edf5", fontFamily: "var(--font-body)" }}>
                {guideTitle}
              </span>
              {rec.isTemplateFallback && (
                <span style={{ padding: "2px 8px", borderRadius: 4, background: "rgba(245,166,35,0.2)", border: "1px solid rgba(245,166,35,0.5)", color: "#f5a623", fontSize: 10, fontWeight: 600, fontFamily: "var(--font-mono)" }}>
                  {sec.templateFallback}
                </span>
              )}
            </div>
          </div>
          <DebugCategoryBox
            show={geoExplainDebugMode}
            heading="[debug] 개선 가이드 · 카테고리"
            lines={buildRecommendationCategoryDebugLines(result.pageType, rec)}
          />
          <div style={{ fontWeight: 600, color: "#a5b4fc", fontSize: 11, marginBottom: 6, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            {improvementSummaryLabel}
          </div>
          <div style={{ fontSize: 12, color: "#c4d0e0", lineHeight: 1.6, marginBottom: 12 }}>
            {rec.trendSummary}
          </div>
          <div style={{ fontWeight: 600, color: "#a5b4fc", fontSize: 11, marginBottom: 6, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            {sec.contentGaps}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#8b9cb3",
              lineHeight: 1.65,
              marginBottom: 12,
              whiteSpace: "pre-wrap",
            }}
          >
            {rec.contentGapSummary}
          </div>
          {rec.actionPlan.priorityNotes && rec.actionPlan.priorityNotes.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, color: "#f5a623", fontSize: 11, marginBottom: 8, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                {sec.priorityActions}
              </div>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 20,
                  color: "#f5d7a8",
                  fontSize: 12,
                  fontWeight: 500,
                  lineHeight: 1.55,
                  listStyle: "circle",
                }}
              >
                {rec.actionPlan.priorityNotes.map((note, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {rec.actionPlan.suggestedHeadings.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#818cf8", marginBottom: 6 }}>{headingsSectionLabel}</div>
              <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)" }}>
                <CopyableBlock copyLabel={copyUi.copy} copiedLabel={copyUi.copied}>{rec.actionPlan.suggestedHeadings.join("\n")}</CopyableBlock>
              </div>
            </div>
          )}
          {rec.actionPlan.suggestedBlocks.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#00d4c8", marginBottom: 6 }}>{sec.recommendedBlocks}</div>
              {result.pageType === "video" && (
                <div style={{ fontSize: 11, color: "#8b9cb3", lineHeight: 1.5, marginBottom: 8 }}>{sec.videoBlocksHint}</div>
              )}
              <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(0,212,200,0.06)", border: "1px solid rgba(0,212,200,0.2)" }}>
                <CopyableBlock copyLabel={copyUi.copy} copiedLabel={copyUi.copied}>{blocksText}</CopyableBlock>
              </div>
            </div>
          )}
          <div style={{ marginTop: 12, marginBottom: aiWritingExamplesOpen ? 10 : 0 }}>
            <button
              type="button"
              disabled={aiWritingExamplesLoading}
              onClick={() => {
                const loc = getRecommendationLocale(
                  result.recommendations?.trace?.locale,
                  result.meta,
                  ""
                );
                console.log("[AI WRITING BUTTON CLICKED]", {
                  url: result.url,
                  pageType: mapAiWritingPageType(result),
                  locale: loc,
                });
                void requestAiWritingExamples();
              }}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid rgba(168,85,247,0.45)",
                background: "linear-gradient(135deg, rgba(129,140,248,0.2) 0%, rgba(168,85,247,0.15) 100%)",
                color: "#e9d5ff",
                fontSize: 12,
                fontWeight: 600,
                cursor: aiWritingExamplesLoading ? "wait" : "pointer",
                textAlign: "center",
                fontFamily: "var(--font-body)",
                lineHeight: 1.45,
                opacity: aiWritingExamplesLoading ? 0.75 : 1,
              }}
              title={aiAssist.rateLimitWait}
            >
              {aiAssist.generateButton}
            </button>
          </div>
          {aiWritingExamplesOpen && (
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 8,
                border: "1px solid rgba(168,85,247,0.35)",
                background: "rgba(168,85,247,0.06)",
                marginBottom: 4,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: "#c4b5fd", marginBottom: 8 }}>{aiAssist.sectionTitle}</div>
              {aiWritingFromCache && !aiWritingExamplesLoading && (
                <div style={{ fontSize: 11, color: "#8b9cb3", marginBottom: 8, lineHeight: 1.5 }}>{aiAssist.cachedFromSession}</div>
              )}
              {(aiWritingNotice || aiWritingDegraded) && !aiWritingExamplesLoading && (
                <div
                  style={{
                    marginBottom: 10,
                    padding: "8px 10px",
                    borderRadius: 6,
                    background: "rgba(251,191,36,0.08)",
                    border: "1px solid rgba(251,191,36,0.25)",
                    fontSize: 11,
                    color: "#fcd34d",
                    lineHeight: 1.55,
                  }}
                >
                  {aiWritingDegraded ? (
                    <span
                      style={{
                        display: "inline-block",
                        marginRight: 8,
                        marginBottom: 2,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: "rgba(251,191,36,0.15)",
                        fontWeight: 600,
                        fontSize: 10,
                        verticalAlign: "middle",
                      }}
                    >
                      {aiAssist.templateFallbackBadge}
                    </span>
                  ) : null}
                  {aiWritingNotice ? <span>{aiWritingNotice}</span> : null}
                </div>
              )}
              {aiWritingExamplesLoading && (
                <div style={{ fontSize: 12, color: "#a8b8cc", lineHeight: 1.55 }}>{aiAssist.loading}</div>
              )}
              {!aiWritingExamplesLoading && aiWritingExamplesError && (
                <div style={{ fontSize: 12, color: "#f0a8b8", lineHeight: 1.55 }}>{aiWritingExamplesError}</div>
              )}
              {!aiWritingExamplesLoading && !aiWritingExamplesError && aiWritingExamplesData && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {aiWritingExamplesData.summaryExample.trim() ? (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#a78bfa", marginBottom: 4 }}>{aiAssist.summaryLabel}</div>
                      <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(0,0,0,0.2)", border: "1px solid rgba(168,85,247,0.2)" }}>
                        <CopyableBlock copyLabel={copyUi.copy} copiedLabel={copyUi.copied}>{aiWritingExamplesData.summaryExample}</CopyableBlock>
                      </div>
                    </div>
                  ) : null}
                  {aiWritingExamplesData.faqExamples.some((f) => f.question.trim() || f.answer.trim()) ? (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#a78bfa", marginBottom: 6 }}>{aiAssist.faqLabel}</div>
                      {aiWritingExamplesData.faqExamples.map((f, i) => (
                        <div key={i} style={{ marginBottom: 8, padding: "8px 10px", borderRadius: 8, background: "rgba(0,0,0,0.2)", border: "1px solid rgba(168,85,247,0.2)" }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: "#7c6bb5", marginBottom: 4 }}>{aiAssist.faqItem(i + 1)}</div>
                          <CopyableBlock copyLabel={copyUi.copy} copiedLabel={copyUi.copied}>{`${f.question}\n\n${f.answer}`.trim()}</CopyableBlock>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {aiWritingExamplesData.prosConsExample.trim() ? (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#a78bfa", marginBottom: 4 }}>{aiAssist.prosConsLabel}</div>
                      <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(0,0,0,0.2)", border: "1px solid rgba(168,85,247,0.2)" }}>
                        <CopyableBlock copyLabel={copyUi.copy} copiedLabel={copyUi.copied}>{aiWritingExamplesData.prosConsExample}</CopyableBlock>
                      </div>
                    </div>
                  ) : null}
                  {aiWritingExamplesData.verdictExample.trim() ? (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#a78bfa", marginBottom: 4 }}>{aiAssist.verdictLabel}</div>
                      <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(0,0,0,0.2)", border: "1px solid rgba(168,85,247,0.2)" }}>
                        <CopyableBlock copyLabel={copyUi.copy} copiedLabel={copyUi.copied}>{aiWritingExamplesData.verdictExample}</CopyableBlock>
                      </div>
                    </div>
                  ) : null}
                  {aiWritingExamplesData.headingSuggestions.some((h) => h.trim()) ? (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#a78bfa", marginBottom: 4 }}>{aiAssist.headingsLabel}</div>
                      <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(0,0,0,0.2)", border: "1px solid rgba(168,85,247,0.2)" }}>
                        <CopyableBlock copyLabel={copyUi.copy} copiedLabel={copyUi.copied}>
                          {aiWritingExamplesData.headingSuggestions.filter((h) => h.trim()).join("\n")}
                        </CopyableBlock>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
        );
      })()}

      {/* 플랫폼 제약 (네이버 블로그 등): 기술 SEO는 작성자가 직접 수정 불가 */}
      {platformConstraints && platformConstraints.length > 0 && (
        <div style={{ ...CARD_STYLE, marginBottom: 10 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#a78bfa",
              fontFamily: "var(--font-mono)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 10,
            }}
          >
            플랫폼 제약
          </div>
          <p style={{ fontSize: 11, color: "#7a8da3", lineHeight: 1.5, marginBottom: 10 }}>
            아래 항목은 호스팅 환경상 직접 수정이 어렵습니다. 감점이 아니라 &quot;조치 불가&quot;에 가깝게 이해하세요.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {platformConstraints.map((c) => (
              <div
                key={c.id}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid rgba(167,139,250,0.25)",
                  background: "rgba(167,139,250,0.06)",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: "#ddd6fe", marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontSize: 12, color: "#a8b8cc", lineHeight: 1.55, marginBottom: 6 }}>{c.description}</div>
                <div style={{ fontSize: 12, color: "#5eead4", lineHeight: 1.5 }}>
                  <span style={{ fontWeight: 600, color: "#7dd3fc" }}>대안 · </span>
                  {c.alternative}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 개선 기회 — 숨김 when rule-based recommendations exist (actions live in Priority Actions only). */}
      {opportunities.length > 0 && !result.recommendations && (
        <div style={CARD_STYLE}>
          <button
            type="button"
            onClick={() => setOpportunitiesOpen((v) => !v)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              marginBottom: opportunitiesOpen ? 10 : 0,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: "#00d4c8", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              개선 기회 ({opportunities.length})
            </span>
            {opportunitiesOpen ? <ChevronUp size={16} color="#7a8da3" /> : <ChevronDown size={16} color="#7a8da3" />}
          </button>
          {opportunitiesOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {opportunities.map((opp) => {
                const imp = PRIORITY_COLORS[opp.impact];
                return (
                  <div
                    key={opp.id}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: `1px solid ${imp.border}`,
                      background: "rgba(0,212,200,0.04)",
                    }}
                  >
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#e8edf5" }}>{opp.title}</span>
                      <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: imp.bg, color: imp.color, fontFamily: "var(--font-mono)" }}>
                        {IMPACT_LABEL[opp.impact] ?? opp.impact}
                      </span>
                      <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "rgba(91,110,245,0.12)", color: "#a5b4fc", fontFamily: "var(--font-mono)" }}>
                        {focusByAxis[opp.improvesAxis] ?? GEO_AXIS_LABEL[opp.improvesAxis] ?? opp.improvesAxis}
                      </span>
                      {opp.fixesIssueId && (
                        <span style={{ fontSize: 10, color: "#7a8da3", fontFamily: "var(--font-mono)" }}>↳ 이슈 {opp.fixesIssueId}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "#a8b8cc", lineHeight: 1.55 }}>{opp.rationale}</div>
                    {geoExplainDebugMode && (
                      <>
                        <div style={{ fontSize: 11, color: "#6d8099", fontFamily: "var(--font-mono)", fontWeight: 600, marginTop: 8 }}>Opportunity (debug JSON)</div>
                        <pre style={{ margin: "4px 0 0", fontSize: 10, color: "#6d8099", fontFamily: "var(--font-mono)", overflow: "auto", maxHeight: 240 }}>
                          {JSON.stringify(opp, null, 2)}
                        </pre>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 황금 문단 */}
      {goldenParagraphs.length > 0 && (
        <div style={CARD_STYLE}>
          <button
            onClick={() => setGoldenOpen((v) => !v)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "4px 0 8px",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Star size={16} style={{ color: "#fbbf24" }} />
              <span style={{ fontSize: 12, color: "#fbbf24", fontFamily: "var(--font-mono)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                황금 문단 (인용 확률 TOP 3)
              </span>
              <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "rgba(168,85,247,0.2)", border: "1px solid rgba(168,85,247,0.4)", color: "#a855f7", fontFamily: "var(--font-mono)", fontWeight: 600, letterSpacing: "0.04em" }}>
                Gemini 의미적 평가
              </span>
            </div>
            {goldenOpen ? <ChevronUp size={16} style={{ color: "#fbbf24" }} /> : <ChevronDown size={16} style={{ color: "#7a8da3" }} />}
          </button>
          {goldenOpen && (
            <div style={{ paddingTop: 8, display: "flex", flexDirection: "column", gap: 10 }}>
              {goldenParagraphs.map((chunk, idx) => (
                <GoldenParagraphCard key={`gold-${idx}`} chunk={chunk} rank={idx + 1} />
              ))}
            </div>
          )}
        </div>
      )}
      </div>

      {/* PPT 버튼 - 하단 고정 — optional hide (geoUiFlags) */}
      <div style={{ padding: "10px 12px 16px", borderTop: "1px solid #1e2d45" }}>
        <button
          onClick={onExportPPT}
          disabled={exporting}
          style={{
            width: "100%",
            padding: "11px 0",
            borderRadius: 8,
            background: exporting ? "#141d2e" : "linear-gradient(135deg, #5b6ef5 0%, #00d4c8 100%)",
            border: "none",
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            cursor: exporting ? "not-allowed" : "pointer",
            opacity: exporting ? 0.6 : 1,
            transition: "opacity 0.2s",
            fontFamily: "var(--font-body)",
          }}
        >
          {exporting ? GEO_REPORT_LABELS_KO.pptGenerating : GEO_REPORT_LABELS_KO.pptDownloadButton}
        </button>
      </div>
    </aside>
  );
}
