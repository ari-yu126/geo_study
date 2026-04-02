"use client";

import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
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
} from "lucide-react";
import type {
  AnalysisResult,
  AuditIssue,
  ChunkCitation,
  FixExample,
  GeoIssue,
  PassedCheck,
} from "@/lib/analysisTypes";
import { dedupeGeoIssuesById } from "@/lib/geoExplain/issueEngine";
import { GEO_UI_HIDE_COVERAGE_AND_PPT } from "../geoUiFlags";
import {
  GEO_AXIS_LABEL,
  getAxisRows,
  getIssueCategoryLabel,
  getStrengthRows,
  groupGeoIssuesByCategory,
  hasGeoExplain,
  IMPACT_LABEL,
  EDITORIAL_SUBTYPE_LABEL,
  editorialSubtypeTooltip,
} from "../utils/geoExplainUi";
import ScoreGauge, { getGradeInfo } from "./ScoreGauge";

const PRIORITY_COLORS: Record<string, { color: string; bg: string; border: string; label: string }> = {
  high: { color: "#f05c7a", bg: "rgba(240,92,122,0.08)", border: "rgba(240,92,122,0.25)", label: "긴급" },
  medium: { color: "#f5a623", bg: "rgba(245,166,35,0.08)", border: "rgba(245,166,35,0.25)", label: "보통" },
  low: { color: "#34d399", bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.25)", label: "낮음" },
};

function GeoIssueCard({
  g,
  issueNum,
  activeIssueId,
  onIssueClick,
  auditIssueById,
  showDebugRefs,
  hideCategoryBadge,
}: {
  g: GeoIssue;
  issueNum: number;
  activeIssueId: string | null;
  onIssueClick: (id: string) => void;
  auditIssueById: (id: string) => AuditIssue | undefined;
  showDebugRefs: boolean;
  hideCategoryBadge?: boolean;
}) {
  const cfg = PRIORITY_COLORS[g.severity];
  const isActive = activeIssueId === g.id;
  const linked = auditIssueById(g.id);
  const fixExamples = linked?.fixExamples;
  const hasFixExamples = Boolean(fixExamples && fixExamples.length > 0);
  const showFixPanel = isActive && (hasFixExamples || Boolean(g.fix?.trim()));
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <button
        onClick={() => onIssueClick(g.id)}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "10px 12px",
          borderRadius: showFixPanel ? "8px 8px 0 0" : 8,
          borderTop: `1px solid ${isActive ? cfg.color + "66" : cfg.border}`,
          borderRight: `1px solid ${isActive ? cfg.color + "66" : cfg.border}`,
          borderLeft: `1px solid ${isActive ? cfg.color + "66" : cfg.border}`,
          borderBottom: showFixPanel ? "none" : `1px solid ${isActive ? cfg.color + "66" : cfg.border}`,
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
              {GEO_AXIS_LABEL[g.axis] ?? g.axis}
            </span>
            {(hasFixExamples || g.fix?.trim()) &&
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
      {isActive && showFixPanel && (
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
          {showDebugRefs && g.sourceRefs && Object.keys(g.sourceRefs).length > 0 && (
            <pre
              style={{
                margin: 0,
                padding: "8px 12px",
                fontSize: 10,
                color: "#6d8099",
                fontFamily: "var(--font-mono)",
                borderTop: "1px solid #1a2436",
                overflow: "auto",
                maxHeight: 120,
              }}
            >
              {JSON.stringify(g.sourceRefs, null, 2)}
            </pre>
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

interface AuditPanelProps {
  result: AnalysisResult;
  issues: AuditIssue[];
  passedChecks: PassedCheck[];
  activeIssueId: string | null;
  onIssueClick: (id: string) => void;
  onReset: () => void;
  onExportPPT: () => void;
  onNavigate: (url: string) => void;
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

  if (hasCitation) {
    return base([
      { id: "citation", label: "AI 인용", score: Math.round((scores.citationScore ?? 0) * 0.40), maxScore: 40, color: "#a855f7" },
      { id: "paragraph", label: "문단 품질", score: Math.round((scores.paragraphScore ?? 0) * 0.15), maxScore: 15, color: "#5b6ef5" },
      { id: "answerability", label: "답변가능성", score: Math.round((scores.answerabilityScore ?? 0) * 0.15), maxScore: 15, color: "#00d4c8" },
      { id: "structure", label: "SEO 구조", score: Math.round(scores.structureScore * 0.15), maxScore: 15, color: "#34d399" },
      { id: "trust", label: "신뢰 신호", score: Math.round((scores.trustScore ?? 0) * 0.15), maxScore: 15, color: "#f5a623" },
    ]);
  }

  return base([
    { id: "paragraph", label: "문단 품질", score: Math.round((scores.paragraphScore ?? 0) * 0.35), maxScore: 35, color: "#5b6ef5" },
    { id: "answerability", label: "답변가능성", score: Math.round((scores.answerabilityScore ?? 0) * 0.25), maxScore: 25, color: "#00d4c8" },
    { id: "structure", label: "SEO 구조", score: Math.round(scores.structureScore * 0.20), maxScore: 20, color: "#34d399" },
    { id: "trust", label: "신뢰 신호", score: Math.round((scores.trustScore ?? 0) * 0.15), maxScore: 15, color: "#f5a623" },
  ]);
}

const INITIAL_QUESTIONS = 3;

const CARD_STYLE = {
  padding: "14px 16px",
  borderRadius: 12,
  border: "1px solid #1e2d45",
  background: "#0d1321",
  boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
} as const;

function CopyableBlock({ children, label }: { children: string; label?: string }) {
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
        {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "복사됨" : "복사"}
      </button>
      {label && (
        <div style={{ fontSize: 11, fontWeight: 600, color: "#7a8da3", marginBottom: 4 }}>{label}</div>
      )}
      <div style={{ paddingRight: 60, fontSize: 12, color: "#c4d0e0", lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

export default function AuditPanel({
  result,
  issues,
  passedChecks,
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
  const [filter, setFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [passedOpen, setPassedOpen] = useState(false);
  const [goldenOpen, setGoldenOpen] = useState(true);
  const [expandedPassedId, setExpandedPassedId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState(result.url);
  const [questionsExpanded, setQuestionsExpanded] = useState(false);
  const [opportunitiesOpen, setOpportunitiesOpen] = useState(true);

  const [configVersion, setConfigVersion] = useState<string | null>(null);
  const [configCreatedAt, setConfigCreatedAt] = useState<string | null>(null);
  const [configDaysLeft, setConfigDaysLeft] = useState<number | null>(null);

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
      } catch {
        // silent
      }
    })();
    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, []);

  const goldenParagraphs = (result.chunkCitations ?? [])
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const gi = getGradeInfo(result.scores.finalScore);
  const categories = buildCategories(result);

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
  const opportunities = geoExplain?.opportunities ?? [];
  const showDebugRefs = typeof process !== "undefined" && process.env.NODE_ENV === "development";

  const auditIssueById = (id: string) => issues.find((i) => i.id === id);

  const geoIssueGroups = useGeoIssueList ? groupGeoIssuesByCategory(filteredGeoIssues) : [];

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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#818cf8", fontFamily: "var(--font-mono)", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              GEO Analyzer
            </span>
              {configVersion ? (
                <span style={{ fontSize: 11, color: "#7a8da3", marginLeft: 8 }}>
                  Scored using Monthly AI GEO Criteria (Updated {configCreatedAt ? new Date(configCreatedAt).toISOString().slice(0,10).replace(/-/g,'.') : configVersion})
                  {configDaysLeft != null ? ` · ${configDaysLeft}d left` : ''}
                </span>
              ) : (
                <span style={{ fontSize: 11, color: "#7a8da3", marginLeft: 8 }}>Scoring Engine: v26.03 Commerce Update</span>
              )}
          </div>
          <button
            onClick={onReset}
            style={{
              background: "transparent",
              border: "1px solid #1e2d45",
              borderRadius: 6,
              color: "#8b9cb3",
              fontSize: 14,
              padding: "4px 12px",
              cursor: "pointer",
              fontFamily: "var(--font-body)",
            }}
          >
            ← 새 분석
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = urlInput.trim();
            if (trimmed && trimmed !== result.url) onNavigate(trimmed);
          }}
          style={{ display: "flex", gap: 4, alignItems: "center" }}
        >
          <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
            {reanalyzing && (
              <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", display: "inline-block", animation: "spin 0.8s linear infinite", color: "#5b6ef5", fontSize: 12, zIndex: 1 }}>⚙</span>
            )}
            <input
              type="url"
              value={urlInput}
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
            disabled={reanalyzing || !urlInput.trim() || urlInput.trim() === result.url}
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
              opacity: (reanalyzing || !urlInput.trim() || urlInput.trim() === result.url) ? 0.4 : 1,
              transition: "opacity 0.2s",
              fontFamily: "var(--font-mono)",
            }}
          >
            분석
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
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
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
                <span style={{ fontSize: 11, color: "#8b9cb3", flex: 1, minWidth: 140 }}>{ev.hint}</span>
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
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 4 }}>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 800, color: gi.color }}>{result.scores.finalScore}</span>
              <span style={{ fontSize: 12, color: "#7a8da3" }}>/ 100</span>
            </div>
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, background: `${gi.color}18`, border: `1px solid ${gi.color}44`, color: gi.color, fontWeight: 600, display: "inline-block", marginTop: 4 }}>
              {gi.label}
            </span>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 12px", marginBottom: 14 }}>
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
      </div>

      {/* 2. 축 점수 (0–100, GEO Explain) */}
      {axisRows.length > 0 && (
        <div style={CARD_STYLE}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#7a8da3", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
            축 점수 (0–100)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" }}>
            {axisRows.map((row) => (
              <div key={row.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "#c4d0e0", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.label}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, color: "#5b6ef5", flexShrink: 0 }}>{row.value}</span>
                </div>
                <div style={{ height: 4, background: "#1e2d45", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${row.value}%`, background: "linear-gradient(90deg, #5b6ef5, #00d4c8)", borderRadius: 99, transition: "width 0.6s" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. 잘된 점 / Strengths */}
      <div style={CARD_STYLE}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#34d399", fontFamily: "var(--font-mono)", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              잘된 점 {strengthRows.length > 0 ? `(${strengthRows.length})` : ""}
            </span>
            {geo && geoExplain && geoExplain.passed.length > 0 && (
              <span style={{ fontSize: 10, color: "#10b981", fontFamily: "var(--font-mono)" }}>GEO</span>
            )}
          </div>
        </div>

        {strengthRows.length === 0 ? (
          <div style={{ fontSize: 13, color: "#7a8da3", padding: "8px 4px" }}>
            No strong GEO signals were detected yet.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(strengthRows.slice(0, passedOpen ? strengthRows.length : Math.min(5, strengthRows.length))).map((row) => {
                const legacyPc = passedChecks.find((p) => p.id === row.id);
                const isGeoStrength = Boolean(geo && geoExplain && geoExplain.passed.some((p) => p.id === row.id));
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
                      title={isGeoStrength ? "GEO Explain — passed signal" : undefined}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: isGeoStrength ? "rgba(52,211,153,0.18)" : "rgba(99,102,241,0.06)",
                        color: isGeoStrength ? "#10b981" : "#7a8da3",
                        fontSize: 12,
                        fontWeight: 800,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        marginTop: 1,
                      }}
                    >
                      {isGeoStrength ? "G" : <Check size={12} strokeWidth={3} style={{ color: "inherit" }} />}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: isExpanded ? 6 : 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "#c4d0e0", lineHeight: 1.3 }}>{row.label}</span>
                        {isExpanded ? <ChevronUp size={14} style={{ color: "#34d399", flexShrink: 0 }} /> : <ChevronDown size={14} style={{ color: "#7a8da3", flexShrink: 0 }} />}
                        {isGeoStrength && (
                          <span style={{ fontSize: 11, color: "#10b981", fontWeight: 700, marginLeft: "auto", fontFamily: "var(--font-mono)" }}>GEO</span>
                        )}
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

      {/* 4. 발견된 이슈 */}
      <div style={CARD_STYLE}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#7a8da3", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
          발견된 이슈 ({useGeoIssueList ? geoIssues.length : issues.length})
          {useGeoIssueList && <span style={{ marginLeft: 8, fontSize: 10, color: "#5b6ef5" }}>GEO</span>}
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
                          showDebugRefs={showDebugRefs}
                          hideCategoryBadge
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
        </div>
      </div>

      {/* 5. 개선 기회 / Opportunities */}
      {opportunities.length > 0 && (
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
                        {GEO_AXIS_LABEL[opp.improvesAxis] ?? opp.improvesAxis}
                      </span>
                      {opp.fixesIssueId && (
                        <span style={{ fontSize: 10, color: "#7a8da3", fontFamily: "var(--font-mono)" }}>↳ 이슈 {opp.fixesIssueId}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "#a8b8cc", lineHeight: 1.55 }}>{opp.rationale}</div>
                    {showDebugRefs && opp.sourceRefs && Object.keys(opp.sourceRefs).length > 0 && (
                      <pre style={{ margin: "8px 0 0", fontSize: 10, color: "#6d8099", fontFamily: "var(--font-mono)" }}>{JSON.stringify(opp.sourceRefs, null, 2)}</pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 6. AI 전략 제언 — 서술 레이어 (구조화 기회 보강) */}
      {result.recommendations && (
        <div
          style={{
            ...CARD_STYLE,
            background: "linear-gradient(180deg, rgba(99,102,241,0.15) 0%, rgba(99,102,241,0.06) 100%)",
            border: "1px solid rgba(99,102,241,0.35)",
          }}
        >
          {opportunities.length > 0 && (
            <div style={{ fontSize: 11, color: "#a5b4fc", lineHeight: 1.5, marginBottom: 10, padding: "8px 10px", borderRadius: 6, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)" }}>
              위의 <strong style={{ color: "#e8edf5" }}>개선 기회</strong>가 우선입니다. 아래는 Gemini가 같은 맥락에서 다듬은 설명·템플릿입니다.
            </div>
          )}
          여기다
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <Sparkles size={18} style={{ color: "#818cf8" }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: "#e8edf5", fontFamily: "var(--font-body)" }}>
              {result.pageType === "video" ? "AI 검색 최적화 설명란 전략" : result.pageType === "editorial" && result.reviewLike ? "리뷰 분석 제언" : "AI 전략 제언: 커뮤니티가 원하는 정답"}
            </span>
            {result.recommendations.isTemplateFallback && (
              <span style={{ padding: "2px 8px", borderRadius: 4, background: "rgba(245,166,35,0.2)", border: "1px solid rgba(245,166,35,0.5)", color: "#f5a623", fontSize: 10, fontWeight: 600, fontFamily: "var(--font-mono)" }}>
                AI 추천이 제한되어 템플릿 추천으로 대체되었습니다(쿼터 제한).
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "#c4d0e0", lineHeight: 1.6, marginBottom: 12 }}>
            {result.recommendations.trendSummary}
          </div>
          <div style={{ fontSize: 12, color: "#8b9cb3", lineHeight: 1.6, marginBottom: 12, paddingLeft: 8, borderLeft: "2px solid #1e2d45" }}>
            <div style={{ fontWeight: 600, color: "#7a8da3", marginBottom: 4 }}>{result.pageType === "video" ? "설명란 보강 포인트" : "콘텐츠 Gap"}</div>
            {result.recommendations.contentGapSummary}
          </div>
          {result.pageType === "video" ? (
            <>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#7a8da3", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>콘텐츠 구조 (Content Structure)</div>
                <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)" }}>
                  <CopyableBlock>{result.recommendations.actionPlan.suggestedHeadings.join("\n")}</CopyableBlock>
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#7a8da3", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>메타데이터·링크 (Metadata / Links)</div>
                <div style={{ fontSize: 11, color: "#8b9cb3", lineHeight: 1.5, marginBottom: 8 }}>고정 댓글에 핵심 요약 배치, 관련 링크 정리</div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#7a8da3", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>복사용 템플릿 (Copy-paste Templates)</div>
                <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(0,212,200,0.06)", border: "1px solid rgba(0,212,200,0.2)" }}>
                  <CopyableBlock>{result.recommendations.actionPlan.suggestedBlocks.join("\n\n")}</CopyableBlock>
                </div>
              </div>
            </>
          ) : (
            <>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#818cf8", marginBottom: 6 }}>추천 H2/H3 제목</div>
                <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)" }}>
                  <CopyableBlock>{result.recommendations.actionPlan.suggestedHeadings.join("\n")}</CopyableBlock>
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#00d4c8", marginBottom: 6 }}>추천 블록 (테이블/리스트/FAQ)</div>
                <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(0,212,200,0.06)", border: "1px solid rgba(0,212,200,0.2)" }}>
                  <CopyableBlock>{result.recommendations.actionPlan.suggestedBlocks.join("\n")}</CopyableBlock>
                </div>
              </div>
            </>
          )}
          {result.recommendations.actionPlan.priorityNotes && result.recommendations.actionPlan.priorityNotes.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {result.recommendations.actionPlan.priorityNotes.map((note, i) => (
                <span key={i} style={{ padding: "4px 10px", borderRadius: 6, background: "rgba(245,166,35,0.15)", border: "1px solid rgba(245,166,35,0.4)", color: "#f5a623", fontSize: 11, fontWeight: 600, fontFamily: "var(--font-mono)" }}>
                  {note}
                </span>
              ))}
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

      {/* 4. 커버리지 그룹 — optional hide (geoUiFlags) */}
      <div style={CARD_STYLE}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Search size={18} style={{ color: "#00d4c8" }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: "#e8edf5", fontFamily: "var(--font-body)" }}>
              질문 커버리지
            </span>
          </div>
          <div style={{ maxHeight: 340, overflowY: "auto", marginBottom: 8 }}>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
              {(() => {
                const covered = result.searchQuestionCovered ?? result.searchQuestions?.map(() => false) ?? [];
                const uncoveredTop3Set = new Set(
                  (result.recommendations?.predictedUncoveredTop3 ?? []).map((q) => q.question)
                );

                const userItems = (result.searchQuestions ?? []).map((q, i) => ({
                  type: "user" as const,
                  text: q.text,
                  isCovered: covered[i] ?? false,
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
                      수집된 질문 없음
                    </li>
                  );
                }

                return visible.map((item) => {
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
                          {item.type === "user" && "domain" in item && item.domain && (
                            <div style={{ fontSize: 10, color: "#6d8099" }}>{item.domain}</div>
                          )}
                          {item.type === "ai" && item.importanceReason && (
                            <div style={{ fontSize: 11, color: "#7a8da3" }}>{item.importanceReason}</div>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                });
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
          {exporting ? "PPT 생성 중..." : "PPT 리포트 다운로드"}
        </button>
      </div>
    </aside>
  );
}
