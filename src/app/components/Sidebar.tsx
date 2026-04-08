"use client";

import { useState } from "react";
import type { AnalysisResult } from "@/lib/analysisTypes";
import { isHostedBlogPlatform } from "@/lib/geoExplain/platformIssueWording";

interface SidebarProps {
  result: AnalysisResult;
  onExportPPT: () => void;
  exporting: boolean;
}

const PRIORITY_MAP = {
  high: { label: "긴급", color: "#f05c7a", bg: "rgba(240,92,122,0.1)", border: "rgba(240,92,122,0.3)" },
  medium: { label: "보통", color: "#f5a623", bg: "rgba(245,166,35,0.1)", border: "rgba(245,166,35,0.3)" },
  low: { label: "낮음", color: "#34d399", bg: "rgba(52,211,153,0.1)", border: "rgba(52,211,153,0.3)" },
};

function deriveImprovements(result: AnalysisResult) {
  const items: Array<{
    id: string;
    title: string;
    tip: string;
    priority: "high" | "medium" | "low";
    category: string;
  }> = [];

  const { meta, scores } = result;

  if (!meta.title) {
    items.push({ id: "title", title: "Title 태그 누락", tip: "페이지 제목을 명확하게 설정하세요. GEO에서 title은 AI가 페이지 주제를 판단하는 핵심 신호입니다.", priority: "high", category: "메타 태그" });
  }
  const hasMeta = !!meta.description?.trim();
  const hasOg = !!meta.ogDescription?.trim();
  const hosted = isHostedBlogPlatform(result.platform);
  if (!hasMeta && !hasOg) {
    items.push({
      id: "desc",
      title: "Meta / OG 설명 누락",
      tip: "표준 meta description과 og:description이 모두 없습니다. 최소 한 가지 요약 신호를 제공하세요.",
      priority: "high",
      category: "메타 태그",
    });
  } else if (!hasMeta && hasOg) {
    items.push({
      id: "desc_og_only",
      title: "Meta description 없음 (OG만 있음)",
      tip: hosted
        ? "제목과 본문 첫 단락에 핵심 요약·키워드를 드러내세요. 이 플랫폼에서는 HTML meta를 직접 넣기 어려울 수 있습니다."
        : "og:description은 일부 신호를 제공합니다. 가능하면 표준 `<meta name=\"description\">`을 추가해 일관성을 높이세요.",
      priority: "medium",
      category: "메타 태그",
    });
  }
  if (scores.structureScore < 60) {
    items.push({ id: "struct", title: "페이지 구조 점수 미흡", tip: "H1/H2 헤딩을 질문형으로 재구성하고, 본문 첫 단락에 핵심 답변을 배치하세요.", priority: "high", category: "콘텐츠 구조" });
  }
  if (scores.questionCoverage < 40) {
    items.push({ id: "qcov", title: "질문 커버리지 낮음", tip: "사용자가 AI에게 물을 법한 질문을 예측하여 FAQ 섹션을 추가하거나, 소제목을 질문형으로 바꾸세요.", priority: "high", category: "질문 커버리지" });
  }
  if (!meta.ogTitle || !meta.ogDescription) {
    items.push({ id: "og", title: "OG 태그 미설정", tip: "og:title과 og:description을 설정하면 소셜 공유 시 노출이 개선되고 AI 크롤러의 콘텍스트 파악이 쉬워집니다.", priority: "medium", category: "메타 태그" });
  }
  if (!meta.canonical) {
    items.push({ id: "canonical", title: "Canonical URL 없음", tip: "중복 콘텐츠 문제 방지를 위해 canonical 태그를 추가하세요.", priority: "medium", category: "기술 SEO" });
  }
  if (result.pageQuestions.length < 3) {
    items.push({ id: "questions", title: "페이지 내 질문 부족", tip: "본문에 '왜', '어떻게', '비용은' 등 질문형 표현을 더 포함시켜 AI가 FAQ로 인식하도록 하세요.", priority: "medium", category: "콘텐츠 구조" });
  }
  if (result.seedKeywords.length < 5) {
    items.push({ id: "kw", title: "핵심 키워드 밀도 낮음", tip: "주요 키워드를 제목, 소제목, 본문 도입부에 자연스럽게 배치하세요.", priority: "low", category: "키워드" });
  }

  return items;
}

export default function Sidebar({ result, onExportPPT, exporting }: SidebarProps) {
  const [filter, setFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const improvements = deriveImprovements(result);
  const filtered = filter === "all" ? improvements : improvements.filter((i) => i.priority === filter);
  const counts = { high: improvements.filter(i => i.priority === "high").length, medium: improvements.filter(i => i.priority === "medium").length, low: improvements.filter(i => i.priority === "low").length };

  return (
    <aside
      style={{
        width: 300,
        flexShrink: 0,
        borderLeft: "1px solid #1e2d45",
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        position: "sticky",
        top: 0,
        overflowY: "auto",
        background: "#0f1623",
      }}
    >
      <div style={{ padding: "20px 16px 14px", borderBottom: "1px solid #1e2d45" }}>
        <p style={{ fontSize: 12, color: "#7a8da3", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4, fontFamily: "var(--font-mono)" }}>
          개선 가이드
        </p>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "#e8edf5", marginBottom: 12 }}>
          부족한 항목 & 해결책
        </h2>

        <div style={{ display: "flex", gap: 5 }}>
          {(["all", "high", "medium", "low"] as const).map((f) => {
            const cfg = f === "all" ? { label: `전체 ${improvements.length}`, color: "#8b9cb3" } : { label: `${PRIORITY_MAP[f].label} ${counts[f]}`, color: PRIORITY_MAP[f].color };
            const active = filter === f;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: "3px 9px",
                  borderRadius: 99,
                  border: `1px solid ${active ? cfg.color : "#1e2d45"}`,
                  background: active ? `${cfg.color}18` : "transparent",
                  color: active ? cfg.color : "#7a8da3",
                  fontSize: 12,
                  fontWeight: active ? 700 : 400,
                  cursor: "pointer",
                  transition: "all 0.2s",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {cfg.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, padding: "12px 12px", display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", color: "#7a8da3", fontSize: 14, marginTop: 32 }}>
            해당 항목 없음
          </div>
        )}
        {filtered.map((item, i) => {
          const cfg = PRIORITY_MAP[item.priority];
          return (
            <div
              key={item.id}
              className="animate-fade-up"
              style={{
                animationDelay: `${i * 60}ms`,
                background: cfg.bg,
                border: `1px solid ${cfg.border}`,
                borderRadius: 10,
                padding: "12px 14px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#e8edf5", flex: 1, paddingRight: 8, lineHeight: 1.4 }}>
                  {item.title}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    padding: "2px 6px",
                    borderRadius: 99,
                    border: `1px solid ${cfg.color}`,
                    color: cfg.color,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {cfg.label}
                </span>
              </div>
              <p style={{ fontSize: 12, color: "#8b9cb3", lineHeight: 1.7, margin: 0 }}>{item.tip}</p>
              <div style={{ marginTop: 6, fontSize: 12, color: "#7a8da3", fontFamily: "var(--font-mono)" }}>
                {item.category}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ padding: "12px 12px 20px", borderTop: "1px solid #1e2d45" }}>
        <button
          onClick={onExportPPT}
          disabled={exporting}
          style={{
            width: "100%",
            padding: "11px 0",
            borderRadius: 10,
            background: exporting
              ? "#141d2e"
              : "linear-gradient(135deg, #5b6ef5 0%, #00d4c8 100%)",
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
        <p style={{ fontSize: 12, color: "#7a8da3", textAlign: "center", marginTop: 6 }}>
          7슬라이드 자동 생성 · .pptx 형식
        </p>
      </div>
    </aside>
  );
}
