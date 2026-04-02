"use client";

import { useState } from "react";
import type { AnalysisResult } from "@/lib/analysisTypes";
import { SCORE_CRITERIA } from "@/lib/scoreCriteria";
import ScoreGauge, { getGradeInfo } from "./ScoreGauge";
import CategoryBar from "./CategoryBar";
import Sidebar from "./Sidebar";
import References from "./References";
import { EDITORIAL_SUBTYPE_LABEL, editorialSubtypeTooltip } from "../utils/geoExplainUi";

interface ResultDashboardProps {
  result: AnalysisResult;
  onReset: () => void;
}

const TABS = [
  { id: "overview", label: "📊 종합" },
  { id: "keywords", label: "🔑 키워드" },
  { id: "questions", label: "❓ 검색 질문" },
  { id: "meta", label: "🏷️ 메타 정보" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function buildCategories(result: AnalysisResult) {
  const { scores } = result;
  const hasCitation = (scores.citationScore ?? -1) >= 0;

  const withCriteria = (arr: { id: string; label: string; icon: string; score: number; maxScore: number; color: string }[]) =>
    arr.map((cat) => ({ ...cat, criteriaItems: SCORE_CRITERIA[cat.id]?.items }));

  if (hasCitation) {
    return withCriteria([
      { id: "citation", label: "AI 인용 가능성", icon: "🤖", score: Math.round((scores.citationScore ?? 0) * 0.40), maxScore: 40, color: "#a855f7" },
      { id: "paragraph", label: "문단 품질", icon: "📝", score: Math.round((scores.paragraphScore ?? 0) * 0.15), maxScore: 15, color: "#5b6ef5" },
      { id: "answerability", label: "답변가능성", icon: "💡", score: Math.round((scores.answerabilityScore ?? 0) * 0.15), maxScore: 15, color: "#00d4c8" },
      { id: "structure", label: "SEO 구조", icon: "📐", score: Math.round(scores.structureScore * 0.15), maxScore: 15, color: "#34d399" },
      { id: "trust", label: "신뢰 신호", icon: "🛡️", score: Math.round((scores.trustScore ?? 0) * 0.15), maxScore: 15, color: "#f5a623" },
    ]);
  }

  return withCriteria([
    { id: "paragraph", label: "문단 품질", icon: "📝", score: Math.round((scores.paragraphScore ?? 0) * 0.35), maxScore: 35, color: "#5b6ef5" },
    { id: "answerability", label: "답변가능성", icon: "💡", score: Math.round((scores.answerabilityScore ?? 0) * 0.25), maxScore: 25, color: "#00d4c8" },
    { id: "structure", label: "SEO 구조", icon: "📐", score: Math.round(scores.structureScore * 0.20), maxScore: 20, color: "#34d399" },
    { id: "trust", label: "신뢰 신호", icon: "🛡️", score: Math.round((scores.trustScore ?? 0) * 0.15), maxScore: 15, color: "#f5a623" },
  ]);
}

export default function ResultDashboard({ result, onReset }: ResultDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [exporting, setExporting] = useState(false);

  const gi = getGradeInfo(result.scores.finalScore);
  const categories = buildCategories(result);

  const handleExportPPT = async () => {
    setExporting(true);
    try {
      const { exportToPPT } = await import("../utils/pptExporter");
      await exportToPPT(result);
    } catch (e) {
      alert("PPT 생성 오류: " + (e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <main style={{ flex: 1, overflowY: "auto", background: "#080c14" }}>

        {/* 상단 바 */}
        <div
          style={{
            padding: "14px 24px",
            borderBottom: "1px solid #1e2d45",
            display: "flex",
            alignItems: "center",
            gap: 14,
            position: "sticky",
            top: 0,
            background: "#080c14ee",
            backdropFilter: "blur(12px)",
            zIndex: 20,
          }}
        >
          <button
            onClick={onReset}
            style={{
              background: "transparent",
              border: "1px solid #1e2d45",
              borderRadius: 8,
              color: "#8b9cb3",
              fontSize: 12,
              padding: "5px 12px",
              cursor: "pointer",
              fontFamily: "var(--font-body)",
            }}
          >
            ← 새 분석
          </button>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: "#7a8da3",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: "var(--font-mono)",
              }}
            >
              {result.url}
            </div>
            {result.pageType === "editorial" && result.editorialSubtype && (
              <div
                style={{ fontSize: 11, color: "#6d8099", fontFamily: "var(--font-body)" }}
                title={editorialSubtypeTooltip(result) ?? undefined}
              >
                맥락: {EDITORIAL_SUBTYPE_LABEL[result.editorialSubtype]}
                {result.editorialSubtypeDebug?.confidence != null
                  ? ` · ${Math.round(result.editorialSubtypeDebug.confidence * 100)}%`
                  : ""}
              </div>
            )}
          </div>
          <div style={{ fontSize: 12, color: "#6d8099", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>
            분석 완료 · {new Date(result.analyzedAt).toLocaleString("ko-KR")}
          </div>
        </div>

        {/* 점수 배너 */}
        <div
          className="animate-fade-in"
          style={{
            padding: "28px 28px 24px",
            background: "linear-gradient(135deg, #0f1623 0%, #080c14 100%)",
            borderBottom: "1px solid #1e2d45",
          }}
        >
          <div style={{ display: "flex", gap: 28, alignItems: "center", flexWrap: "wrap" }}>
            <ScoreGauge score={result.scores.finalScore} size={130} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <p style={{ fontSize: 12, color: "#7a8da3", marginBottom: 4, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                종합 GEO 점수
              </p>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 44,
                    fontWeight: 800,
                    color: gi.color,
                    lineHeight: 1,
                  }}
                >
                  {result.scores.finalScore}
                </span>
                <span style={{ fontSize: 16, color: "#7a8da3" }}>/ 100점</span>
                <span
                  style={{
                    fontSize: 12,
                    padding: "3px 10px",
                    borderRadius: 99,
                    background: `${gi.color}18`,
                    border: `1px solid ${gi.color}55`,
                    color: gi.color,
                    fontWeight: 700,
                  }}
                >
                  {gi.label}
                </span>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(result.scores.citationScore ?? -1) >= 0 && (
                  <span style={{ fontSize: 12, color: "#8b9cb3", background: "#141d2e", border: "1px solid #1e2d45", borderRadius: 8, padding: "4px 10px" }}>
                    AI 인용: <strong style={{ color: "#a855f7" }}>{result.scores.citationScore}</strong>
                  </span>
                )}
                <span style={{ fontSize: 12, color: "#8b9cb3", background: "#141d2e", border: "1px solid #1e2d45", borderRadius: 8, padding: "4px 10px" }}>
                  문단: <strong style={{ color: "#5b6ef5" }}>{result.scores.paragraphScore ?? 0}</strong>
                </span>
                <span style={{ fontSize: 12, color: "#8b9cb3", background: "#141d2e", border: "1px solid #1e2d45", borderRadius: 8, padding: "4px 10px" }}>
                  구조: <strong style={{ color: "#00d4c8" }}>{result.scores.structureScore}</strong>
                </span>
                <span style={{ fontSize: 12, color: "#8b9cb3", background: "#141d2e", border: "1px solid #1e2d45", borderRadius: 8, padding: "4px 10px" }}>
                  신뢰: <strong style={{ color: "#f5a623" }}>{result.scores.trustScore ?? 0}</strong>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 탭 네비 */}
        <div
          style={{
            display: "flex",
            gap: 0,
            borderBottom: "1px solid #1e2d45",
            padding: "0 24px",
            background: "#080c14f0",
            position: "sticky",
            top: 53,
            zIndex: 19,
          }}
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "13px 18px",
                background: "transparent",
                border: "none",
                borderBottom: activeTab === tab.id ? "2px solid #5b6ef5" : "2px solid transparent",
                color: activeTab === tab.id ? "#e8edf5" : "#7a8da3",
                fontSize: 12,
                fontWeight: activeTab === tab.id ? 700 : 400,
                cursor: "pointer",
                transition: "all 0.2s",
                whiteSpace: "nowrap",
                fontFamily: "var(--font-body)",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 탭 콘텐츠 */}
        <div style={{ padding: 24 }}>

          {/* References section */}
          <div style={{ marginBottom: 18 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#7a8da3", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, fontFamily: "var(--font-mono)" }}>
              References & Research Sources
            </h3>
            <div style={{ background: "#0f1623", border: "1px solid #1e2d45", borderRadius: 12, padding: 12 }}>
              <References />
            </div>
          </div>

          {/* 종합 탭 */}
          {activeTab === "overview" && (
            <div className="animate-fade-up">
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#7a8da3", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16, fontFamily: "var(--font-mono)" }}>
                카테고리별 점수
              </h3>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: 14,
                  marginBottom: 28,
                }}
              >
                {categories.map((cat, i) => (
                  <div
                    key={cat.id}
                    style={{
                      background: "#0f1623",
                      border: "1px solid #1e2d45",
                      borderRadius: 12,
                      padding: "18px 20px",
                    }}
                  >
                    <CategoryBar {...cat} delay={i * 100} />
                  </div>
                ))}
              </div>

              {result.meta.title && (
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: "#7a8da3", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14, fontFamily: "var(--font-mono)" }}>
                    페이지 요약
                  </h3>
                  <div
                    style={{
                      background: "#0f1623",
                      border: "1px solid #1e2d45",
                      borderRadius: 12,
                      padding: "18px 20px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    <div>
                      <span style={{ fontSize: 12, color: "#7a8da3", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>Title</span>
                      <p style={{ fontSize: 14, fontWeight: 600, color: "#e8edf5", marginTop: 3 }}>{result.meta.title}</p>
                    </div>
                    {result.meta.description && (
                      <div>
                        <span style={{ fontSize: 12, color: "#7a8da3", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>Description</span>
                        <p style={{ fontSize: 12, color: "#8b9cb3", marginTop: 3, lineHeight: 1.6 }}>{result.meta.description}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 키워드 탭 */}
          {activeTab === "keywords" && (
            <div className="animate-fade-up">
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#7a8da3", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16, fontFamily: "var(--font-mono)" }}>
                추출된 핵심 키워드 — {result.seedKeywords.length}개
              </h3>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
                {[
                  { label: "고빈도 키워드", count: result.seedKeywords.filter(k => k.score > 0.6).length, color: "#f05c7a" },
                  { label: "중빈도 키워드", count: result.seedKeywords.filter(k => k.score >= 0.3 && k.score <= 0.6).length, color: "#f5a623" },
                  { label: "저빈도 키워드", count: result.seedKeywords.filter(k => k.score < 0.3).length, color: "#34d399" },
                ].map(s => (
                  <div key={s.label} style={{ background: "#0f1623", border: "1px solid #1e2d45", borderRadius: 8, padding: "8px 14px", textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: s.color, fontFamily: "var(--font-display)" }}>{s.count}</div>
                    <div style={{ fontSize: 12, color: "#7a8da3", marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {result.seedKeywords.map((kw, i) => {
                  const colors = ["#5b6ef5", "#00d4c8", "#f5a623", "#f05c7a", "#34d399"];
                  const col = colors[i % colors.length];
                  const size = kw.score > 0.6 ? 15 : kw.score > 0.3 ? 13 : 11;
                  return (
                    <span
                      key={kw.value}
                      style={{
                        padding: "5px 13px",
                        borderRadius: 99,
                        background: `${col}18`,
                        border: `1px solid ${col}44`,
                        color: "#e8edf5",
                        fontSize: size,
                        fontWeight: kw.score > 0.6 ? 700 : 400,
                      }}
                    >
                      {kw.value}
                      <span style={{ color: "#7a8da3", fontSize: 12, marginLeft: 5, fontFamily: "var(--font-mono)" }}>
                        {(kw.score * 100).toFixed(0)}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* 검색 질문 탭 */}
          {activeTab === "questions" && (
            <div className="animate-fade-up">
              <div style={{ marginBottom: 20 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: "#7a8da3", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, fontFamily: "var(--font-mono)" }}>
                  AI 예상 검색 질문
                </h3>
                <p style={{ fontSize: 12, color: "#7a8da3" }}>
                  사용자가 ChatGPT, Perplexity 등에 입력할 가능성이 높은 질문들
                </p>
              </div>

              {result.pageQuestions.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 12, color: "#5b6ef5", fontFamily: "var(--font-mono)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#5b6ef5", display: "inline-block" }} />
                    페이지 내 발견된 질문 ({result.pageQuestions.length}개)
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {result.pageQuestions.map((q, i) => (
                      <div
                        key={`page-q-${i}`}
                        style={{
                          background: "#0f1623",
                          border: "1px solid #1e2d45",
                          borderRadius: 10,
                          padding: "12px 16px",
                          display: "flex",
                          gap: 12,
                          alignItems: "flex-start",
                        }}
                      >
                        <span style={{ fontSize: 12, color: "#7a8da3", fontFamily: "var(--font-mono)", marginTop: 1, flexShrink: 0 }}>Q{i + 1}</span>
                        <span style={{ fontSize: 14, color: "#e8edf5", lineHeight: 1.5 }}>{q}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.searchQuestions.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, color: "#00d4c8", fontFamily: "var(--font-mono)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00d4c8", display: "inline-block" }} />
                    외부 검색 기반 질문 ({result.searchQuestions.length}개)
                    <span style={{ color: "#7a8da3", fontSize: 10 }}>— Tavily 연동 시 실제 데이터로 교체</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {result.searchQuestions.map((q, i) => {
                      const sourceColors: Record<string, string> = { google: "#5b6ef5", naver: "#34d399", community: "#f5a623" };
                      const col = sourceColors[q.source] || "#8b9cb3";
                      return (
                        <div
                          key={q.url ?? `search-q-${i}`}
                          style={{
                            background: "#0f1623",
                            borderRadius: 10,
                            overflow: "hidden",
                            border: "1px solid #1e2d45",
                          }}
                        >
                          <div style={{ display: "flex" }}>
                            <div style={{ width: 3, background: col, flexShrink: 0 }} />
                            <div style={{ padding: "12px 16px", flex: 1 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                <span style={{ fontSize: 14, color: "#e8edf5", lineHeight: 1.5 }}>{q.text}</span>
                                <span style={{ fontSize: 12, padding: "2px 7px", borderRadius: 99, background: `${col}22`, color: col, border: `1px solid ${col}44`, flexShrink: 0, marginLeft: 8, fontFamily: "var(--font-mono)" }}>
                                  {q.source}
                                </span>
                              </div>
                              {q.url && (
                                <a href={q.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#7a8da3", textDecoration: "none" }}>
                                  {q.url.slice(0, 60)}...
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {result.pageQuestions.length === 0 && result.searchQuestions.length === 0 && (
                <div style={{ textAlign: "center", color: "#7a8da3", fontSize: 14, padding: "40px 0" }}>
                  추출된 질문이 없습니다.<br />
                  <span style={{ fontSize: 11 }}>페이지에 질문형 콘텐츠를 추가하세요.</span>
                </div>
              )}
            </div>
          )}

          {/* 메타 정보 탭 */}
          {activeTab === "meta" && (
            <div className="animate-fade-up">
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#7a8da3", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16, fontFamily: "var(--font-mono)" }}>
                메타 태그 상세
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { label: "Title", value: result.meta.title, required: true },
                  { label: "Description", value: result.meta.description, required: true },
                  { label: "OG Title", value: result.meta.ogTitle, required: false },
                  { label: "OG Description", value: result.meta.ogDescription, required: false },
                  { label: "Canonical", value: result.meta.canonical, required: false },
                ].map((item) => {
                  const present = !!item.value;
                  return (
                    <div
                      key={item.label}
                      style={{
                        background: "#0f1623",
                        border: `1px solid ${present ? "#1e2d45" : item.required ? "rgba(240,92,122,0.3)" : "#1e2d45"}`,
                        borderRadius: 10,
                        padding: "14px 16px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: present ? 6 : 0 }}>
                        <span style={{ fontSize: 12, color: "#7a8da3", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>
                          {item.label}
                          {item.required && <span style={{ color: "#f05c7a", marginLeft: 4 }}>*필수</span>}
                        </span>
                        <span style={{ fontSize: 12, color: present ? "#34d399" : "#f05c7a" }}>
                          {present ? "✓ 설정됨" : "✗ 없음"}
                        </span>
                      </div>
                      {present && (
                        <p style={{ fontSize: 14, color: "#e8edf5", margin: 0, lineHeight: 1.6, wordBreak: "break-all" }}>
                          {item.value}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>

      <Sidebar result={result} onExportPPT={handleExportPPT} exporting={exporting} />
    </div>
  );
}
