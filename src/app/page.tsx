"use client";

import { Suspense, useState, useEffect, useRef, useCallback } from "react";
import type {
  AnalysisResult,
  AuditIssue,
  IframePositionData,
  PassedCheck,
  PlatformConstraint,
} from "@/lib/analysisTypes";
import { normalizeUrl, sanitizeIncomingAnalyzeUrl } from "@/lib/normalizeUrl";
import { toEmbedUrl } from "@/lib/youtubeMetadataExtractor";
import { deriveAuditIssues } from "@/lib/issueDetector";
import AuditPanel from "./components/AuditPanel";
import AuditMarker from "./components/AuditMarker";
import { GEO_UI_HIDE_COVERAGE_AND_PPT } from "./geoUiFlags";
import { GEO_REPORT_LABELS_KO } from "./utils/geoReportLabels";

type Status = "idle" | "loading" | "success" | "error";

const LOADING_STEPS = [
  "URL 정규화 중...",
  "캐시 확인 중...",
  "HTML 크롤링 중...",
  "메타 태그 추출 중...",
  "키워드 분석 중...",
  "검색 질문 수집 중...",
  "GEO 점수 계산 중...",
  "결과 저장 중...",
];

function getInitialUrlSanitized(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("url") ?? "";
  const sanitized = sanitizeIncomingAnalyzeUrl(raw);
  if (!sanitized) return "";
  return normalizeUrl(sanitized);
}

/** POST /api/analyze — forceRefresh defaults false (cache-friendly). Body uses canonical URL (e.g. Naver → m.blog). */
function postAnalyzeRequest(targetUrl: string, forceRefresh: boolean) {
  const trimmed = sanitizeIncomingAnalyzeUrl(targetUrl);
  const canonical = trimmed ? normalizeUrl(trimmed) : "";
  console.log("[ANALYZE REQUEST]", { url: canonical, forceRefresh });
  return fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: canonical, forceRefresh }),
  });
}

/**
 * Preview uses /api/proxy so golden highlights can inject scripts. If upstream blocks the proxy (502),
 * fall back to loading the target URL directly in the iframe (user's browser may still render the page).
 */
async function resolvePreviewIframeSrc(
  canonical: string,
  golden: string,
  reasons: string
): Promise<{ src: string; usedDirectFallback: boolean }> {
  const embedUrl = toEmbedUrl(canonical);
  if (embedUrl) {
    return { src: embedUrl, usedDirectFallback: false };
  }
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(canonical)}`;
  const params = new URLSearchParams();
  if (golden) params.set("golden", golden);
  if (reasons) params.set("reasons", reasons);
  const fullProxy = params.toString() ? `${proxyUrl}&${params.toString()}` : proxyUrl;

  try {
    const res = await fetch(fullProxy, { method: "GET", cache: "no-store" });
    if (res.ok) {
      return { src: fullProxy, usedDirectFallback: false };
    }
  } catch {
    /* network failure — try direct */
  }
  return { src: canonical, usedDirectFallback: true };
}

export default function Home() {
  const [url, setUrl] = useState(getInitialUrlSanitized);
  const [status, setStatus] = useState<Status>("idle");
  const initialLoadRef = useRef(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [loadingStep, setLoadingStep] = useState(0);
  const [exporting, setExporting] = useState(false);

  const [positionData, setPositionData] = useState<IframePositionData | null>(null);
  const [issues, setIssues] = useState<AuditIssue[]>([]);
  const [passedChecks, setPassedChecks] = useState<PassedCheck[]>([]);
  const [platformConstraints, setPlatformConstraints] = useState<PlatformConstraint[] | undefined>(undefined);
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const [iframeScrollTop, setIframeScrollTop] = useState(0);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [analyzeMeta, setAnalyzeMeta] = useState<{
    fromCache: boolean;
    cacheLayer: string;
  } | null>(null);

  const [iframeSrc, setIframeSrc] = useState<string>("");
  /** True when /api/proxy returned an error and iframe loads the target site directly. */
  const [iframeDirectFallback, setIframeDirectFallback] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const currentAnalyzedUrlRef = useRef<string>("");
  const highlightedElRef = useRef<{ el: HTMLElement; originalBg: string; originalBoxShadow: string } | null>(null);

  // Polluted ?url=... (e.g. &forceRefresh merged into value): sync address bar to sanitized form once
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("url");
    if (raw == null || raw === "") return;
    const clean = sanitizeIncomingAnalyzeUrl(raw);
    const canonical = clean ? normalizeUrl(clean) : "";
    if (canonical && canonical !== raw) {
      const u = new URL(window.location.href);
      u.searchParams.set("url", canonical);
      window.history.replaceState({}, "", u.toString());
    }
  }, []);

  // 쿼리 파라미터에 url이 있으면 자동 분석
  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;
    if (url) {
      runAnalyze(url);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // postMessage 리스너
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.data?.type === "GEO_ELEMENT_POSITIONS") {
        setPositionData(e.data as IframePositionData);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    if (!result) return;
    deriveAuditIssues(result, positionData ?? undefined).then(
      ({ issues: newIssues, passedChecks: newPassed, platformConstraints: pc }) => {
        setIssues(newIssues);
        setPassedChecks(newPassed);
        setPlatformConstraints(pc);
      }
    );
  }, [result, positionData]);

  // iframe 스크롤 동기화
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    function syncScroll() {
      try {
        const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
        if (doc) {
          setIframeScrollTop(doc.documentElement.scrollTop || doc.body.scrollTop);
        }
      } catch {
        // cross-origin이면 무시
      }
    }

    const interval = setInterval(syncScroll, 200);
    return () => clearInterval(interval);
  }, [status]);

  const runAnalyze = async (targetUrl: string, options?: { forceRefresh?: boolean }) => {
    const clean = sanitizeIncomingAnalyzeUrl(targetUrl);
    if (!clean) return;
    const canonical = normalizeUrl(clean);
    const forceRefresh = options?.forceRefresh === true;

    setUrl(canonical);

    setStatus("loading");
    setError("");
    setLoadingStep(0);
    setPositionData(null);
    setIssues([]);
    setPassedChecks([]);
    setActiveIssueId(null);
    setAnalyzeMeta(null);
    setIframeDirectFallback(false);

    const stepInterval = setInterval(() => {
      setLoadingStep((prev) => {
        if (prev < LOADING_STEPS.length - 2) return prev + 1;
        clearInterval(stepInterval);
        return prev;
      });
    }, 800);

    try {
      const res = await postAnalyzeRequest(canonical, forceRefresh);

      clearInterval(stepInterval);
      setLoadingStep(LOADING_STEPS.length - 1);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data.detail ? `${data.error}\n${data.detail}` : (data.error || `서버 오류 (${res.status})`);
        throw new Error(msg);
      }

      const data = await res.json();
      const resResult = data.result as import("@/lib/analysisTypes").AnalysisResult;
      setResult({ ...resResult, url: canonical });
      setAnalyzeMeta({
        fromCache: Boolean(data.fromCache),
        cacheLayer: typeof data.cacheLayer === "string" ? data.cacheLayer : "none",
      });
      const topChunks = (resResult.chunkCitations ?? [])
        .slice()
        .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
        .slice(0, 3);
      const golden = topChunks.map((c: { index: number }) => c.index).join(",");
      const reasons = topChunks.map((c: { reason?: string }) => c.reason ?? "AI 분석 기반 고품질 문단").join("||");
      const { src: previewSrc, usedDirectFallback } = await resolvePreviewIframeSrc(canonical, golden, reasons);
      setIframeSrc(previewSrc);
      setIframeDirectFallback(usedDirectFallback);
      setStatus("success");
      setUrl(canonical);
      currentAnalyzedUrlRef.current = canonical;

      const browserUrl = new URL(window.location.href);
      browserUrl.searchParams.set("url", canonical);
      window.history.replaceState({}, "", browserUrl.toString());
    } catch (err) {
      clearInterval(stepInterval);
      setError((err as Error).message);
      setStatus("error");
    }
  };

  const reanalyzeInBackground = useCallback(async (targetUrl: string) => {
    const clean = sanitizeIncomingAnalyzeUrl(targetUrl);
    if (!clean) return;
    const canonical = normalizeUrl(clean);

    setReanalyzing(true);
    setPositionData(null);
    setActiveIssueId(null);
    currentAnalyzedUrlRef.current = canonical;

    try {
      const res = await postAnalyzeRequest(canonical, false);

      if (!res.ok) return;

      const data = await res.json();
      const resResult = data.result as AnalysisResult;
      setResult({ ...resResult, url: canonical });
      setAnalyzeMeta({
        fromCache: Boolean(data.fromCache),
        cacheLayer: typeof data.cacheLayer === "string" ? data.cacheLayer : "none",
      });
      setUrl(canonical);

      const topChunks = (resResult.chunkCitations ?? [])
        .slice()
        .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
        .slice(0, 3);
      const golden = topChunks.map((c: { index: number }) => c.index).join(",");
      const reasons = topChunks.map((c: { reason?: string }) => c.reason ?? "AI 분석 기반 고품질 문단").join("||");
      const { src: previewSrc, usedDirectFallback } = await resolvePreviewIframeSrc(canonical, golden, reasons);
      setIframeSrc(previewSrc);
      setIframeDirectFallback(usedDirectFallback);

      const browserUrl = new URL(window.location.href);
      browserUrl.searchParams.set("url", canonical);
      window.history.replaceState({}, "", browserUrl.toString());
    } catch {
      // 백그라운드 재분석 실패 시 기존 결과 유지
    } finally {
      setReanalyzing(false);
    }
  }, []);

  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    try {
      const iframeSrc = iframe.contentWindow?.location.href ?? "";
      if (!iframeSrc) return;
      const u = new URL(iframeSrc);
      const navigatedUrl = u.searchParams.get("url");
      if (navigatedUrl && navigatedUrl !== currentAnalyzedUrlRef.current) {
        reanalyzeInBackground(navigatedUrl);
      }
    } catch {
      // cross-origin인 경우 무시
    }
  }, [reanalyzeInBackground]);

  const handleAnalyze = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = sanitizeIncomingAnalyzeUrl(url);
    if (!clean) return;
    runAnalyze(clean);
  };

  const handleReset = () => {
    setStatus("idle");
    setResult(null);
    setError("");
    setUrl("");
    setLoadingStep(0);
    setPositionData(null);
    setIssues([]);
    setActiveIssueId(null);
    setIframeScrollTop(0);
    setIframeSrc("");
    setIframeDirectFallback(false);
    setPassedChecks([]);
    setPlatformConstraints(undefined);
    setAnalyzeMeta(null);

    const newUrl = new URL(window.location.href);
    newUrl.searchParams.delete("url");
    window.history.replaceState({}, "", newUrl.pathname);
  };

  const handleIssueClick = useCallback(
    (id: string) => {
      setActiveIssueId((prev) => (prev === id ? null : id));

      const issue = issues.find((i) => i.id === id);
      if (issue?.position && iframeRef.current?.contentWindow) {
        try {
          iframeRef.current.contentWindow.scrollTo({
            top: Math.max(0, issue.position.top - 100),
            behavior: "smooth",
          });
        } catch {
          // cross-origin
        }
      }
    },
    [issues]
  );

  const handlePassedCheckClick = useCallback((pc: { position?: { top: number } }) => {
    if (pc.position && iframeRef.current?.contentWindow) {
      try {
        iframeRef.current.contentWindow.scrollTo({
          top: Math.max(0, pc.position.top - 100),
          behavior: "smooth",
        });
      } catch {
        // cross-origin
      }
    }
  }, []);

  const handleQuestionClick = useCallback((questionText: string) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument?.body) return;

    // 이전 하이라이트 제거
    if (highlightedElRef.current) {
      const { el, originalBg, originalBoxShadow } = highlightedElRef.current;
      el.style.backgroundColor = originalBg;
      el.style.boxShadow = originalBoxShadow;
      el.classList.remove("geo-question-highlight");
      highlightedElRef.current = null;
    }

    const tokens = questionText
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2);

    if (tokens.length === 0) return;

    const selectors = "main p, article p, [role='main'] p, .content p, .post-content p, p";
    const elements = Array.from(iframe.contentDocument.querySelectorAll(selectors)) as HTMLElement[];
    let best: { el: HTMLElement; score: number } | null = null;

    for (const el of elements) {
      const text = (el.textContent ?? "").toLowerCase();
      if (text.length < 20) continue;

      const paraTokens = text.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((t) => t.length >= 2);
      const overlap = tokens.filter((t) => paraTokens.some((pt) => pt.includes(t) || t.includes(pt))).length;
      const score = overlap / tokens.length;

      if (score > 0.2 && (!best || score > best.score)) {
        best = { el, score };
      }
    }

    if (best) {
      best.el.scrollIntoView({ behavior: "smooth", block: "center" });
      // 형광펜 밑줄 효과
      const doc = iframe.contentDocument;
      if (doc) {
        const style = doc.getElementById("geo-highlight-style") || doc.createElement("style");
        style.id = "geo-highlight-style";
        style.textContent = `.geo-question-highlight{background:linear-gradient(transparent 60%,rgba(251,191,36,0.45) 60%)!important;transition:background 0.3s ease!important}`;
        if (!doc.getElementById("geo-highlight-style")) doc.head.appendChild(style);
      }
      const originalBg = best.el.style.backgroundColor;
      const originalBoxShadow = best.el.style.boxShadow;
      best.el.classList.add("geo-question-highlight");
      highlightedElRef.current = { el: best.el, originalBg, originalBoxShadow };
      setTimeout(() => {
        if (highlightedElRef.current?.el === best.el) {
          best.el.classList.remove("geo-question-highlight");
          best.el.style.backgroundColor = originalBg;
          best.el.style.boxShadow = originalBoxShadow;
          highlightedElRef.current = null;
        }
      }, 4000);
    }
  }, []);

  const handleExportPPT = async () => {
    if (!result) return;
    setExporting(true);
    try {
      const { exportToPPT } = await import("./utils/pptExporter");
      await exportToPPT(result, { passedChecks, auditIssues: issues });
    } catch (e) {
      alert("PPT 생성 오류: " + (e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  // ── 결과 화면: 좌측 패널 + 우측 사이트 프리뷰 ──
  if (status === "success" && result) {
    const videoDescriptionSnippet =
      result.meta.description?.trim() || result.meta.ogDescription?.trim() || "";
    return (
      <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#080c14" }}>
        {/* 좌측 패널 */}
        <Suspense
          fallback={
            <aside
              style={{
                width: 360,
                flexShrink: 0,
                height: "100vh",
                background: "#0a0f1a",
                borderRight: "1px solid #1e2d45",
              }}
            />
          }
        >
          <AuditPanel
            result={result}
            analyzeMeta={analyzeMeta}
            issues={issues}
            passedChecks={passedChecks}
            platformConstraints={platformConstraints ?? result.platformConstraints}
            activeIssueId={activeIssueId}
            onIssueClick={handleIssueClick}
            onReset={handleReset}
            onExportPPT={handleExportPPT}
            onNavigate={(newUrl, opts) => runAnalyze(newUrl, opts)}
            onQuestionClick={handleQuestionClick}
            onPassedCheckClick={handlePassedCheckClick}
            exporting={exporting}
            reanalyzing={reanalyzing}
          />
        </Suspense>

        {/* 우측: iframe + 오버레이 */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {/* 유튜브 시: 분석된 메타데이터 (iframe은 영상만 표시) */}
          {result?.url && toEmbedUrl(result.url) && result.meta && (
            <div
              style={{
                flexShrink: 0,
                padding: "12px 16px",
                background: "rgba(8,12,20,0.85)",
                borderBottom: "1px solid #1e2d45",
                fontFamily: "var(--font-sans)",
              }}
            >
              <div style={{ fontSize: 11, color: "#5b6ef7", fontWeight: 600, marginBottom: 6 }}>분석된 영상 정보</div>
              {result.meta.title && (
                <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", marginBottom: 6 }}>{result.meta.title}</div>
              )}
              {videoDescriptionSnippet && (
                <div style={{ fontSize: 12, color: "#8b9cb3", lineHeight: 1.5, maxHeight: 60, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {videoDescriptionSnippet.slice(0, 200)}
                  {videoDescriptionSnippet.length > 200 ? "…" : ""}
                </div>
              )}
            </div>
          )}
          {iframeDirectFallback && (
            <div
              style={{
                flexShrink: 0,
                padding: "8px 12px",
                background: "rgba(251, 191, 36, 0.12)",
                borderBottom: "1px solid rgba(251, 191, 36, 0.35)",
                fontSize: 11,
                color: "#e2e8f0",
                lineHeight: 1.45,
              }}
            >
              프리뷰: 서버 프록시가 해당 URL에서 HTML을 가져오지 못해 <strong style={{ color: "#fbbf24" }}>원본 페이지를 직접</strong> 불러옵니다. 일부 쇼핑몰은 iframe 표시를 막을 수 있습니다. 문단 하이라이트는 프록시 경로에서만 동작합니다.
            </div>
          )}
          {/* iframe */}
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            style={{
              flex: 1,
              width: "100%",
              minHeight: 200,
              border: "none",
              background: "#fff",
            }}
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
            referrerPolicy={iframeSrc.includes("youtube-nocookie.com") ? "strict-origin-when-cross-origin" : "no-referrer"}
            onLoad={handleIframeLoad}
          />

          {/* 오버레이 컨테이너 */}
          <div
            ref={overlayRef}
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              overflow: "hidden",
            }}
          >
            {issues.map((issue) => (
              <AuditMarker
                key={issue.id}
                issue={issue}
                active={activeIssueId === issue.id}
                iframeScrollTop={iframeScrollTop}
                onClick={() => handleIssueClick(issue.id)}
              />
            ))}
          </div>

          {/* 이슈 개수 배지 */}
          <div
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              display: "flex",
              gap: 6,
              zIndex: 40,
            }}
          >
            {issues.filter((i) => i.priority === "high").length > 0 && (
              <span style={{
                padding: "4px 10px",
                borderRadius: 99,
                background: "rgba(240,92,122,0.15)",
                border: "1px solid rgba(240,92,122,0.4)",
                color: "#f05c7a",
                fontSize: 12,
                fontWeight: 700,
                fontFamily: "var(--font-mono)",
                backdropFilter: "blur(8px)",
              }}>
                긴급 {issues.filter((i) => i.priority === "high").length}
              </span>
            )}
            <span style={{
              padding: "4px 10px",
              borderRadius: 99,
              background: "rgba(8,12,20,0.7)",
              border: "1px solid #1e2d45",
              color: "#8b9cb3",
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "var(--font-mono)",
              backdropFilter: "blur(8px)",
            }}>
              총 {issues.length}개 이슈
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ── 입력 / 로딩 / 에러 화면 ──
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* 배경 */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        <div style={{ position: "absolute", top: "-15%", left: "-10%", width: "50vw", height: "50vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(91,110,245,0.08) 0%, transparent 70%)" }} />
        <div style={{ position: "absolute", bottom: "-10%", right: "-10%", width: "40vw", height: "40vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(0,212,200,0.06) 0%, transparent 70%)" }} />
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(30,45,69,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(30,45,69,0.3) 1px, transparent 1px)", backgroundSize: "48px 48px", opacity: 0.4 }} />
      </div>

      <div style={{ position: "relative", zIndex: 1, maxWidth: 560, width: "100%" }}>
        {/* 헤더 */}
        <div className="animate-fade-up" style={{ textAlign: "center", marginBottom: 44 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(91,110,245,0.1)", border: "1px solid rgba(91,110,245,0.3)", borderRadius: 99, padding: "5px 14px", marginBottom: 20 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#5b6ef5", display: "inline-block", animation: "pulseSlow 2.5s ease-in-out infinite" }} />
            <span style={{ fontSize: 12, color: "#818cf8", fontFamily: "var(--font-mono)", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              GEO Analyzer v1.0
            </span>
          </div>

          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(2.2rem, 6vw, 3.2rem)", fontWeight: 800, lineHeight: 1.1, marginBottom: 14, letterSpacing: "-0.02em" }}>
            <span className="text-gradient-cyan">GEO</span> 분석기
          </h1>
          <p style={{ fontSize: 16, color: "#8b9cb3", lineHeight: 1.7, maxWidth: 420, margin: "0 auto" }}>
            URL을 입력하면 사이트를 실시간으로 분석하고<br />
            부족한 부분을 표시해줍니다
          </p>
        </div>

        {/* 입력 카드 */}
        <div className="animate-fade-up" style={{ animationDelay: "100ms", background: "rgba(15,22,35,0.8)", border: "1px solid #1e2d45", borderRadius: 16, padding: 28, backdropFilter: "blur(16px)" }}>
          <form onSubmit={handleAnalyze}>
            <label style={{ display: "block", fontSize: 14, color: "#7a8da3", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
              분석할 URL
            </label>
            <div style={{ position: "relative", marginBottom: 16 }}>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/page"
                required
                disabled={status === "loading"}
                style={{
                  width: "100%",
                  padding: "13px 16px 13px 42px",
                  borderRadius: 10,
                  background: "#080c14",
                  border: `1px solid ${status === "error" ? "rgba(240,92,122,0.4)" : "#1e2d45"}`,
                  color: "#e8edf5",
                  fontSize: 14,
                  outline: "none",
                  fontFamily: "var(--font-mono)",
                  transition: "border-color 0.2s",
                  boxSizing: "border-box",
                  opacity: status === "loading" ? 0.5 : 1,
                }}
                onFocus={(e) => { e.target.style.borderColor = "#5b6ef5"; }}
                onBlur={(e) => { e.target.style.borderColor = status === "error" ? "rgba(240,92,122,0.4)" : "#1e2d45"; }}
              />
              <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16, opacity: 0.4, pointerEvents: "none" }}>
                🔗
              </span>
            </div>

            {status === "error" && error && (
              <div style={{ background: "rgba(240,92,122,0.1)", border: "1px solid rgba(240,92,122,0.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 14, color: "#f05c7a", lineHeight: 1.5 }}>
                {error}
              </div>
            )}

            {status === "loading" && (
              <div style={{ marginBottom: 14 }}>
                {/* 프로그레스 바 */}
                <div style={{ position: "relative", height: 6, background: "#1e2d45", borderRadius: 99, overflow: "hidden", marginBottom: 12 }}>
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: `${((loadingStep + 1) / LOADING_STEPS.length) * 100}%`,
                      background: "linear-gradient(90deg, #5b6ef5, #00d4c8)",
                      borderRadius: 99,
                      transition: "width 0.6s ease",
                      boxShadow: "0 0 12px rgba(91,110,245,0.4)",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 50%, transparent 100%)",
                      backgroundSize: "200% 100%",
                      animation: "shimmer 1.5s infinite linear",
                    }}
                  />
                </div>

                {/* 단계 표시 */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#818cf8", fontFamily: "var(--font-mono)" }}>
                    <span style={{ display: "inline-block", animation: "spin 0.8s linear infinite", fontSize: 16 }}>⚙</span>
                    {LOADING_STEPS[loadingStep]}
                  </div>
                  <span style={{ fontSize: 12, color: "#7a8da3", fontFamily: "var(--font-mono)" }}>
                    {loadingStep + 1}/{LOADING_STEPS.length}
                  </span>
                </div>

                {/* 단계 목록 */}
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                  {LOADING_STEPS.map((step, i) => (
                    <div
                      key={step}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 12,
                        color: i < loadingStep ? "#34d399" : i === loadingStep ? "#818cf8" : "#374357",
                        fontFamily: "var(--font-mono)",
                        transition: "color 0.3s",
                      }}
                    >
                      <span style={{ width: 16, textAlign: "center", fontSize: 12 }}>
                        {i < loadingStep ? "✓" : i === loadingStep ? "●" : "○"}
                      </span>
                      {step}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={status === "loading"}
              style={{
                width: "100%",
                padding: "13px 0",
                borderRadius: 10,
                background: status === "loading" ? "#141d2e" : "linear-gradient(135deg, #5b6ef5 0%, #00d4c8 100%)",
                border: "none",
                color: "#fff",
                fontSize: 16,
                fontWeight: 700,
                cursor: status === "loading" ? "not-allowed" : "pointer",
                opacity: status === "loading" ? 0.7 : 1,
                transition: "all 0.2s",
                fontFamily: "var(--font-body)",
                letterSpacing: "-0.01em",
              }}
            >
              {status === "loading" ? "분석 중..." : "GEO 분석 시작"}
            </button>
          </form>
        </div>

        {/* 기능 요약 칩 */}
        <div className="animate-fade-up" style={{ animationDelay: "200ms", display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap", justifyContent: "center" }}>
          {[
            { icon: "📊", label: "GEO 점수" },
            { icon: "🔍", label: "사이트 오버레이" },
            { icon: "❓", label: "이슈 마커" },
            { icon: "💡", label: "개선 가이드" },
            ...(GEO_UI_HIDE_COVERAGE_AND_PPT ? [] : [{ icon: "📊", label: GEO_REPORT_LABELS_KO.pptFeatureLabel }]),
          ].map((f) => (
            <span key={f.label} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 99, background: "rgba(15,22,35,0.6)", border: "1px solid #1e2d45", fontSize: 14, color: "#8b9cb3" }}>
              {f.icon} {f.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
