"use client";

import { useState, useCallback, useMemo, type ReactNode } from "react";
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
import type { AnalysisResult, AuditIssue, ChunkCitation, FixExample, PassedCheck } from "@/lib/analysisTypes";
import { computeSimulatedScores } from "@/lib/simulationScore";
import ScoreGauge, { getGradeInfo } from "./ScoreGauge";

const PRIORITY_COLORS: Record<string, { color: string; bg: string; border: string; label: string }> = {
  high: { color: "#f05c7a", bg: "rgba(240,92,122,0.08)", border: "rgba(240,92,122,0.25)", label: "긴급" },
  medium: { color: "#f5a623", bg: "rgba(245,166,35,0.08)", border: "rgba(245,166,35,0.25)", label: "보통" },
  low: { color: "#34d399", bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.25)", label: "낮음" },
};

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
  includeSimulatedInExport?: boolean;
  onIncludeSimulatedInExportChange?: (v: boolean) => void;
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
  includeSimulatedInExport = false,
  onIncludeSimulatedInExportChange,
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
  const [isSimulated, setIsSimulated] = useState(false);

  const simulatedScores = useMemo(
    () => computeSimulatedScores(result, issues),
    [result, issues]
  );
  const displayScores = isSimulated ? simulatedScores : result.scores;
  const displayResult = isSimulated ? { ...result, scores: simulatedScores } : result;
  const scoreDiff = simulatedScores.finalScore - result.scores.finalScore;

  const goldenParagraphs = (result.chunkCitations ?? [])
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const gi = getGradeInfo(displayScores.finalScore);
  const categories = buildCategories(displayResult);

  const filtered = filter === "all" ? issues : issues.filter((i) => i.priority === filter);
  const counts = {
    high: issues.filter((i) => i.priority === "high").length,
    medium: issues.filter((i) => i.priority === "medium").length,
    low: issues.filter((i) => i.priority === "low").length,
  };

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

      {/* 1. 점수 + 제언 적용 예상 + 시뮬레이션 버튼 (한 박스) */}
      <div style={CARD_STYLE}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 14 }}>
          <ScoreGauge score={displayScores.finalScore} size={100} strokeWidth={8} />
          <div style={{ textAlign: "center", marginTop: 4 }}>
            <div style={{ fontSize: 11, color: "#7a8da3", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>
              {isSimulated ? "개선 후 예상" : "종합 GEO 점수"}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 4 }}>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 800, color: gi.color }}>{displayScores.finalScore}</span>
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

        {isSimulated && scoreDiff > 0 && (
          <div
            style={{
              marginBottom: 12,
              padding: "10px 12px",
              borderRadius: 8,
              background: "linear-gradient(135deg, rgba(52,211,153,0.12) 0%, rgba(0,212,200,0.08) 100%)",
              border: "1px solid rgba(52,211,153,0.3)",
            }}
          >
            <div style={{ fontSize: 12, color: "#34d399", fontWeight: 700, marginBottom: 8, fontFamily: "var(--font-body)" }}>
              제언 적용 시 GEO 점수 {scoreDiff}점 상승 예상
            </div>
            {result.chunkCitations && result.chunkCitations.length > 0 && (
              <div style={{ fontSize: 11, color: "#7a8da3", marginBottom: 8, lineHeight: 1.5 }}>
                AI 인용 점수를 에이스 문단 수준으로 개선했다고 가정합니다.
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#7a8da3" }}>현재</span>
              <div style={{ flex: 1, height: 6, background: "#1e2d45", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${result.scores.finalScore}%`, background: "#5b6ef5", borderRadius: 99, transition: "width 1s" }} />
              </div>
              <span style={{ fontSize: 11, color: "#8b9cb3", fontFamily: "var(--font-mono)", minWidth: 28 }}>{result.scores.finalScore}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 11, color: "#34d399" }}>개선 후</span>
              <div style={{ flex: 1, height: 6, background: "#1e2d45", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${displayScores.finalScore}%`, background: "linear-gradient(90deg, #34d399, #00d4c8)", borderRadius: 99, transition: "width 1.2s" }} />
              </div>
              <span style={{ fontSize: 11, color: "#34d399", fontFamily: "var(--font-mono)", fontWeight: 700, minWidth: 28 }}>{displayScores.finalScore}</span>
            </div>
          </div>
        )}

        {!isSimulated ? (
          <button
            type="button"
            onClick={() => setIsSimulated(true)}
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid rgba(251,191,36,0.4)",
              background: "linear-gradient(135deg, rgba(251,191,36,0.15) 0%, rgba(251,191,36,0.06) 100%)",
              color: "#fbbf24",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "var(--font-body)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              transition: "all 0.2s",
            }}
          >
            ✨ 개선안 적용 시 예상 점수 보기
          </button>
        ) : (
          <button
              type="button"
              onClick={() => setIsSimulated(false)}
              style={{
                width: "100%",
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid #1e2d45",
                background: "transparent",
                color: "#7a8da3",
                fontSize: 11,
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                transition: "all 0.2s",
              }}
            >
              시뮬레이션 종료
            </button>
        )}
      </div>

      {/* 발견된 이슈 */}
      <div style={CARD_STYLE}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#7a8da3", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
          발견된 이슈 ({issues.length})
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["all", "high", "medium", "low"] as const).map((f) => {
            const cfg = f === "all" ? { label: `전체 ${issues.length}`, color: "#8b9cb3" } : { label: `${PRIORITY_COLORS[f].label} ${counts[f]}`, color: PRIORITY_COLORS[f].color };
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
          {filtered.map((issue) => {
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
                  <span style={{ width: 24, height: 24, borderRadius: "50%", background: cfg.color, color: "#fff", fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1, fontFamily: "var(--font-mono)", boxShadow: isActive ? `0 0 8px ${cfg.color}66` : "none" }}>
                    {issue.number}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "#e8edf5", lineHeight: 1.3 }}>{issue.label}</span>
                      {hasFixExamples && (isActive ? <ChevronUp size={14} style={{ color: "#5b6ef5", flexShrink: 0 }} /> : <ChevronDown size={14} style={{ color: "#7a8da3", flexShrink: 0 }} />)}
                    </div>
                    <div style={{ fontSize: 12, color: "#8b9cb3", lineHeight: 1.5, display: isActive ? "block" : "-webkit-box", WebkitLineClamp: isActive ? undefined : 2, WebkitBoxOrient: "vertical", overflow: isActive ? "visible" : "hidden" }}>
                      {issue.description}
                    </div>
                  </div>
                </button>
                {isActive && hasFixExamples && (
                  <div style={{ border: `1px solid ${cfg.color}66`, borderTop: `1px dashed ${cfg.color}33`, borderRadius: "0 0 8px 8px", background: "#080d16", overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 12px", borderBottom: "1px solid #1a2436" }}>
                      <span style={{ fontSize: 12, color: "#5b6ef5", fontFamily: "var(--font-mono)", fontWeight: 600, letterSpacing: "0.05em" }}>수정 예시</span>
                    </div>
                    {issue.fixExamples!.map((fix, idx) => (
                      <FixCodeBlock key={idx} fix={fix} accentColor={cfg.color} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </div>
      </div>

      {/* 잘된점 */}
      {passedChecks.length > 0 && (
        <div style={CARD_STYLE}>
          <button
            onClick={() => setPassedOpen((v) => !v)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 16px",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#34d399", fontFamily: "var(--font-mono)", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                잘된 점 ({passedChecks.length})
              </span>
            </div>
            {passedOpen ? <ChevronUp size={16} style={{ color: "#34d399" }} /> : <ChevronDown size={16} style={{ color: "#7a8da3" }} />}
          </button>
          {passedOpen && (
            <div style={{ padding: "0 12px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
              {passedChecks.map((pc) => {
                const isExpanded = expandedPassedId === pc.id;
                return (
                  <button
                    key={pc.id}
                    onClick={() => {
                      setExpandedPassedId(isExpanded ? null : pc.id);
                      if (pc.position && onPassedCheckClick) onPassedCheckClick(pc);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: `1px solid ${isExpanded ? "rgba(52,211,153,0.4)" : "rgba(52,211,153,0.15)"}`,
                      background: isExpanded ? "rgba(52,211,153,0.06)" : "transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.15s",
                      width: "100%",
                    }}
                  >
                    <span style={{ width: 22, height: 22, borderRadius: "50%", background: "rgba(52,211,153,0.15)", color: "#34d399", fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                      <Check size={12} strokeWidth={3} style={{ color: "inherit" }} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: isExpanded ? 4 : 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "#c4d0e0", lineHeight: 1.3 }}>{pc.label}</span>
                        {isExpanded ? <ChevronUp size={14} style={{ color: "#34d399", flexShrink: 0 }} /> : <ChevronDown size={14} style={{ color: "#7a8da3", flexShrink: 0 }} />}
                      </div>
                      {isExpanded && (
                        <div style={{ fontSize: 12, color: "#8b9cb3", lineHeight: 1.6, borderTop: "1px dashed rgba(52,211,153,0.2)", paddingTop: 4, marginTop: 2 }}>
                          {pc.reason}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* AI 전략 제언 */}
      {result.recommendations && (
        <div
          style={{
            ...CARD_STYLE,
            background: "linear-gradient(180deg, rgba(99,102,241,0.15) 0%, rgba(99,102,241,0.06) 100%)",
            border: "1px solid rgba(99,102,241,0.35)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <Sparkles size={18} style={{ color: "#818cf8" }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: "#e8edf5", fontFamily: "var(--font-body)" }}>
              AI 전략 제언: 커뮤니티가 원하는 정답
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
            <div style={{ fontWeight: 600, color: "#7a8da3", marginBottom: 4 }}>콘텐츠 Gap</div>
            {result.recommendations.contentGapSummary}
          </div>
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
                <GoldenParagraphCard key={chunk.index} chunk={chunk} rank={idx + 1} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 4. 커버리지 그룹 */}
      {/* 질문 커버리지 카드 */}
      {((result.searchQuestions && result.searchQuestions.length > 0) || (result.recommendations?.predictedQuestions && result.recommendations.predictedQuestions.length > 0)) && (
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
      )}

      </div>

      {/* PPT 버튼 - 하단 고정 (항상 actualResult 사용, 시뮬레이션은 부록 옵션) */}
      <div style={{ padding: "10px 12px 16px", borderTop: "1px solid #1e2d45" }}>
        {onIncludeSimulatedInExportChange && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: "pointer", fontSize: 12, color: "#8b9cb3", fontFamily: "var(--font-body)" }}>
            <input
              type="checkbox"
              checked={includeSimulatedInExport}
              onChange={(e) => onIncludeSimulatedInExportChange(e.target.checked)}
              style={{ accentColor: "#5b6ef5" }}
            />
            예상 점수 포함 (부록 슬라이드 1장 추가)
          </label>
        )}
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
