"use client";

import type { AnalysisResult } from "@/lib/analysisTypes";

type Props = {
  result: AnalysisResult;
  /** Why live preview was disabled — adjusts the explainer copy. */
  fallbackReason?: "policy" | "runtime" | "proxy_unavailable";
  /** When true, show internal debug explanation instead of user-facing copy. */
  debug?: boolean;
};

function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

const USER_REASON_COPY = {
  runtime:
    "이 페이지는 미리보기가 제한되어 핵심 정보만 표시합니다. GEO 분석 결과는 정상적으로 제공됩니다.",
  policy:
    "이 페이지는 보안 정책으로 인해 미리보기가 제한되어 핵심 정보만 표시합니다. GEO 분석 결과는 정상적으로 제공됩니다.",
  proxy_unavailable:
    "이 페이지 정보를 불러오는 데 제한이 있어 핵심 정보만 표시합니다. GEO 분석 결과는 정상적으로 제공됩니다.",
} as const;

const DEBUG_REASON_COPY = {
  runtime:
    "미리보기 iframe 안에서 스크립트 오류 또는 처리되지 않은 Promise 거부가 감지되어 라이브 미리보기를 중단했습니다.",
  policy:
    "이 사이트는 브라우저 저장소/쿠키/고유 출처에 의존하는 SPA로, localhost/프록시/iframe 환경에서 초기화 실패 가능성이 높습니다.",
  proxy_unavailable:
    "서버 프록시로 HTML을 가져오지 못해 원본 URL 기반 미리보기를 시도하지 않고 메타 요약만 표시했습니다.",
} as const;

function explainerCopy(
  fallbackReason: NonNullable<Props["fallbackReason"]>,
  debug: boolean
): string {
  const key = fallbackReason;
  return debug ? DEBUG_REASON_COPY[key] : USER_REASON_COPY[key];
}

export default function StaticSitePreviewCard({
  result,
  fallbackReason = "policy",
  debug = false,
}: Props) {
  const openUrl = result.url?.trim() || result.normalizedUrl;
  const title = (result.meta.title || result.meta.ogTitle || "").trim() || "페이지 제목 없음";
  const desc = (
    result.meta.description ||
    result.meta.ogDescription ||
    ""
  ).trim();
  const snippet = desc || (result.headings?.[0] ? `대표 제목: ${result.headings[0]}` : "설명 메타가 없습니다. 새 탭에서 원본을 확인해 주세요.");

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "center",
        padding: "28px 32px",
        background: "linear-gradient(165deg, rgba(12,18,32,0.98) 0%, #080c14 45%)",
        overflow: "auto",
        fontFamily: "var(--font-sans)",
      }}
    >
      <div
        style={{
          maxWidth: 560,
          margin: "0 auto",
          width: "100%",
          borderRadius: 12,
          border: "1px solid #1e2d45",
          background: "rgba(10,15,26,0.95)",
          padding: "22px 24px",
          boxShadow: "0 24px 48px rgba(0,0,0,0.35)",
        }}
      >
        <p style={{ margin: "0 0 12px", fontSize: 11, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          정적 미리보기{debug ? " · 디버그" : ""}
        </p>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: 13,
            color: debug ? "#a5b4c8" : "#94a3b8",
            lineHeight: 1.65,
            fontFamily: debug ? "var(--font-mono)" : "var(--font-sans)",
          }}
        >
          {explainerCopy(fallbackReason, debug)}
        </p>
        <h2 style={{ margin: "0 0 10px", fontSize: 18, fontWeight: 700, color: "#e2e8f0", lineHeight: 1.35 }}>
          {title}
        </h2>
        <p style={{ margin: "0 0 22px", fontSize: 13, color: "#cbd5e1", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {clip(snippet, 900)}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            onClick={() => window.open(openUrl, "_blank", "noopener,noreferrer")}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 700,
              color: "#fff",
              background: "linear-gradient(135deg, #5b6ef5, #00d4c8)",
              fontFamily: "var(--font-mono)",
            }}
          >
            원본 페이지 새 탭에서 열기
          </button>
          <span style={{ fontSize: 11, color: "#64748b", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>
            {openUrl}
          </span>
        </div>
      </div>
    </div>
  );
}
