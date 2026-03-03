import type { AnalysisResult } from "@/lib/analysisTypes";

function scoreColor(score: number, max: number): string {
  const p = score / max;
  if (p >= 0.85) return "34D399";
  if (p >= 0.7) return "00D4C8";
  if (p >= 0.55) return "5B6EF5";
  if (p >= 0.4) return "F5A623";
  return "F05C7A";
}

function gradeInfo(score: number) {
  if (score >= 85) return { grade: "S", label: "최우수", color: "34D399" };
  if (score >= 70) return { grade: "A", label: "우수", color: "00D4C8" };
  if (score >= 55) return { grade: "B", label: "양호", color: "5B6EF5" };
  if (score >= 40) return { grade: "C", label: "미흡", color: "F5A623" };
  return { grade: "D", label: "개선필요", color: "F05C7A" };
}

export async function exportToPPT(result: AnalysisResult): Promise<void> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";

  const BG = "080C14";
  const SURFACE = "0F1623";
  const CARD = "141D2E";
  const BORDER = "1E2D45";
  const TEXT = "E8EDF5";
  const MUTED = "6B7D96";
  const gi = gradeInfo(result.scores.finalScore);

  // SLIDE 1: 표지
  {
    const s = pptx.addSlide();
    s.background = { color: BG };

    s.addShape(pptx.ShapeType.ellipse, { x: -0.8, y: -0.8, w: 4.5, h: 4.5, fill: { color: "5B6EF5", transparency: 90 }, line: { type: "none" } });
    s.addShape(pptx.ShapeType.ellipse, { x: 9, y: 3, w: 4, h: 4, fill: { color: "00D4C8", transparency: 92 }, line: { type: "none" } });

    s.addShape(pptx.ShapeType.roundRect, { x: 0.8, y: 1.0, w: 3.5, h: 0.36, fill: { color: CARD }, line: { color: "5B6EF5", pt: 1 }, rectRadius: 0.1 });
    s.addText("GEO ANALYSIS REPORT", { x: 0.8, y: 1.0, w: 3.5, h: 0.36, fontSize: 8, bold: true, color: "818CF8", align: "center", fontFace: "Arial" });

    s.addText("GEO 분석 리포트", { x: 0.8, y: 1.55, w: 9, h: 0.95, fontSize: 38, bold: true, color: TEXT, fontFace: "Arial" });

    const displayUrl = result.url.length > 60 ? result.url.slice(0, 60) + "..." : result.url;
    s.addText(displayUrl, { x: 0.8, y: 2.6, w: 9, h: 0.4, fontSize: 12, color: MUTED, fontFace: "Arial" });
    s.addShape(pptx.ShapeType.rect, { x: 0.8, y: 3.1, w: 5, h: 0.03, fill: { color: BORDER }, line: { type: "none" } });
    s.addText(`분석일: ${new Date(result.analyzedAt).toLocaleDateString("ko-KR")}`, { x: 0.8, y: 3.25, w: 8, h: 0.35, fontSize: 10, color: MUTED, fontFace: "Arial" });

    s.addShape(pptx.ShapeType.roundRect, { x: 8.8, y: 1.4, w: 3.2, h: 2.2, fill: { color: CARD }, line: { color: gi.color, pt: 2 }, rectRadius: 0.2 });
    s.addText("종합 GEO 등급", { x: 8.8, y: 1.6, w: 3.2, h: 0.3, fontSize: 10, color: MUTED, align: "center", fontFace: "Arial" });
    s.addText(gi.grade, { x: 8.8, y: 1.9, w: 3.2, h: 0.85, fontSize: 55, bold: true, color: gi.color, align: "center", fontFace: "Arial" });
    s.addText(`${result.scores.finalScore}점 / 100점`, { x: 8.8, y: 2.8, w: 3.2, h: 0.3, fontSize: 11, color: TEXT, align: "center", fontFace: "Arial" });
    s.addText(gi.label, { x: 8.8, y: 3.15, w: 3.2, h: 0.28, fontSize: 9, color: MUTED, align: "center", fontFace: "Arial" });
  }

  // SLIDE 2: 종합 점수
  {
    const s = pptx.addSlide();
    s.background = { color: BG };
    s.addText("종합 GEO 점수", { x: 0.5, y: 0.3, w: 12, h: 0.55, fontSize: 22, bold: true, color: TEXT, fontFace: "Arial" });
    s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.88, w: 12, h: 0.03, fill: { color: BORDER }, line: { type: "none" } });

    const items = [
      { label: "구조 점수", score: result.scores.structureScore, max: 100, color: scoreColor(result.scores.structureScore, 100), icon: "📐" },
      { label: "질문 커버리지", score: result.scores.questionCoverage, max: 100, color: scoreColor(result.scores.questionCoverage, 100), icon: "🎯" },
      { label: "최종 점수", score: result.scores.finalScore, max: 100, color: gi.color, icon: "⭐" },
    ];

    items.forEach((item, i) => {
      const x = 0.5 + i * 4.2;
      const barW = 3.5 * (item.score / item.max);
      s.addShape(pptx.ShapeType.roundRect, { x, y: 1.1, w: 3.9, h: 2.4, fill: { color: SURFACE }, line: { color: BORDER, pt: 1 }, rectRadius: 0.15 });
      s.addText(`${item.icon}  ${item.label}`, { x: x + 0.18, y: 1.28, w: 3.5, h: 0.35, fontSize: 11, bold: true, color: TEXT, fontFace: "Arial" });
      s.addText(`${item.score}`, { x: x + 0.18, y: 1.65, w: 3.5, h: 0.7, fontSize: 40, bold: true, color: item.color, fontFace: "Arial" });
      s.addText(`/ ${item.max}점`, { x: x + 1.4, y: 2.1, w: 2, h: 0.3, fontSize: 11, color: MUTED, fontFace: "Arial" });
      s.addShape(pptx.ShapeType.rect, { x: x + 0.18, y: 2.7, w: 3.5, h: 0.14, fill: { color: BORDER }, line: { type: "none" } });
      if (barW > 0) s.addShape(pptx.ShapeType.rect, { x: x + 0.18, y: 2.7, w: barW, h: 0.14, fill: { color: item.color }, line: { type: "none" } });
      s.addText(`${item.score}%`, { x: x + 0.18, y: 2.9, w: 3.5, h: 0.28, fontSize: 9, color: MUTED, fontFace: "Arial" });
    });

    if (result.meta.title) {
      s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 3.7, w: 12, h: 1.5, fill: { color: CARD }, line: { color: BORDER, pt: 1 }, rectRadius: 0.12 });
      s.addText("페이지 제목", { x: 0.7, y: 3.82, w: 3, h: 0.25, fontSize: 9, color: MUTED, fontFace: "Arial" });
      s.addText(result.meta.title, { x: 0.7, y: 4.05, w: 11, h: 0.35, fontSize: 13, bold: true, color: TEXT, fontFace: "Arial" });
      if (result.meta.description) {
        s.addText(result.meta.description.slice(0, 120) + (result.meta.description.length > 120 ? "..." : ""), { x: 0.7, y: 4.45, w: 11, h: 0.55, fontSize: 10, color: MUTED, fontFace: "Arial", wrap: true });
      }
    }
  }

  // SLIDE 3: 키워드
  {
    const s = pptx.addSlide();
    s.background = { color: BG };
    s.addText("핵심 키워드 분석", { x: 0.5, y: 0.3, w: 12, h: 0.55, fontSize: 22, bold: true, color: TEXT, fontFace: "Arial" });
    s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.88, w: 12, h: 0.03, fill: { color: BORDER }, line: { type: "none" } });

    const colors = ["5B6EF5", "00D4C8", "F5A623", "F05C7A", "34D399"];
    let kx = 0.5, ky = 1.1;
    result.seedKeywords.slice(0, 20).forEach((kw, i) => {
      const col = colors[i % colors.length];
      const fontSize = kw.score > 0.6 ? 14 : kw.score > 0.3 ? 11 : 9;
      const estW = kw.value.length * 0.13 + 0.5;
      if (kx + estW > 12.5) { kx = 0.5; ky += 0.6; }
      s.addShape(pptx.ShapeType.roundRect, { x: kx, y: ky, w: estW, h: 0.42, fill: { color: col, transparency: 82 }, line: { color: col, pt: 1 }, rectRadius: 0.18 });
      s.addText(kw.value, { x: kx, y: ky, w: estW, h: 0.42, fontSize, color: TEXT, align: "center", fontFace: "Arial", bold: kw.score > 0.6 });
      kx += estW + 0.18;
    });
  }

  // SLIDE 4: 질문 커버리지 현황 (핵심 장표) — 유저 검색 + AI 예상 통합
  const hasUserQuestions = result.searchQuestions && result.searchQuestions.length > 0;
  const hasAiQuestions = result.recommendations?.predictedQuestions && result.recommendations.predictedQuestions.length > 0;
  const hasUncoveredTop3 = result.recommendations?.predictedUncoveredTop3 && result.recommendations.predictedUncoveredTop3.length > 0;

  if (hasUserQuestions || hasAiQuestions) {
    const s = pptx.addSlide();
    s.background = { color: BG };
    s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 0.25, w: 1.2, h: 0.35, fill: { color: "00D4C8", transparency: 80 }, line: { color: "00D4C8", pt: 1 }, rectRadius: 0.08 });
    s.addText("핵심 장표", { x: 0.5, y: 0.28, w: 1.2, h: 0.3, fontSize: 8, bold: true, color: "00D4C8", align: "center", fontFace: "Arial" });
    s.addText("질문 커버리지 현황", { x: 0.5, y: 0.55, w: 12, h: 0.55, fontSize: 24, bold: true, color: TEXT, fontFace: "Arial" });
    s.addText("시장 데이터(Tavily) + AI 통찰(Gemini) — 유저 검색 질문 vs AI 예상 질문 · 미답변 AI 질문 우선 보강", { x: 0.5, y: 1.05, w: 12, h: 0.35, fontSize: 10, color: MUTED, fontFace: "Arial" });
    s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.4, w: 12, h: 0.03, fill: { color: "00D4C8" }, line: { type: "none" } });

    const covered = result.searchQuestionCovered ?? result.searchQuestions?.map(() => false) ?? [];
    const userCoveredCount = covered.filter(Boolean).length;
    const userTotal = result.searchQuestions?.length ?? 0;
    const aiTotal = result.recommendations?.predictedQuestions?.length ?? 0;
    const aiCoveredCount = (result.recommendations?.predictedQuestions ?? []).filter((q) => q.coveredByPage).length;

    s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 1.55, w: 12, h: 0.55, fill: { color: SURFACE }, line: { color: BORDER, pt: 1 }, rectRadius: 0.1 });
    s.addText(`[유저 검색] 답변 ${userTotal > 0 ? userCoveredCount : 0} / ${userTotal}  |  [AI 예상] 답변 ${aiTotal > 0 ? aiCoveredCount : 0} / ${aiTotal}`, { x: 0.7, y: 1.68, w: 11.6, h: 0.28, fontSize: 11, bold: true, color: TEXT, fontFace: "Arial" });

    let row = 2.2;
    const uncoveredTop3Set = new Set((result.recommendations?.predictedUncoveredTop3 ?? []).map((q) => q.question));

    if (hasUserQuestions) {
      s.addText("유저 검색 (Tavily)", { x: 0.5, y: row - 0.15, w: 6, h: 0.28, fontSize: 10, bold: true, color: "00D4C8", fontFace: "Arial" });
      result.searchQuestions!.slice(0, 4).forEach((q, i) => {
        const isCovered = covered[i] ?? false;
        const col = isCovered ? "34D399" : "F05C7A";
        s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: row, w: 5.8, h: 0.4, fill: { color: SURFACE }, line: { color: BORDER, pt: 1 }, rectRadius: 0.06 });
        s.addShape(pptx.ShapeType.rect, { x: 0.5, y: row, w: 0.04, h: 0.4, fill: { color: col }, line: { type: "none" } });
        s.addText(`${i + 1}. ${q.text.slice(0, 45)}${q.text.length > 45 ? "…" : ""}`, { x: 0.62, y: row + 0.06, w: 5.5, h: 0.28, fontSize: 9, color: TEXT, fontFace: "Arial" });
        s.addText(isCovered ? "✓" : "미답변", { x: 5.8, y: row + 0.08, w: 0.4, h: 0.24, fontSize: 8, color: col, align: "right", fontFace: "Arial" });
        row += 0.48;
      });
      row += 0.15;
    }

    if (hasAiQuestions) {
      s.addText("AI 예상 (Gemini)", { x: 6.5, y: 2.05, w: 6, h: 0.28, fontSize: 10, bold: true, color: "A855F7", fontFace: "Arial" });
      let aiRow = 2.2;
      result.recommendations!.predictedQuestions!.slice(0, 5).forEach((q, i) => {
        const isUncoveredAi = uncoveredTop3Set.has(q.question);
        const col = q.coveredByPage ? "34D399" : isUncoveredAi ? "F05C7A" : "F5A623";
        s.addShape(pptx.ShapeType.roundRect, { x: 6.5, y: aiRow, w: 5.8, h: isUncoveredAi ? 0.65 : 0.4, fill: { color: isUncoveredAi ? "1A1520" : SURFACE }, line: { color: col, pt: isUncoveredAi ? 1.5 : 1 }, rectRadius: 0.06 });
        s.addShape(pptx.ShapeType.rect, { x: 6.5, y: aiRow, w: 0.04, h: isUncoveredAi ? 0.65 : 0.4, fill: { color: col }, line: { type: "none" } });
        s.addText(`${i + 1}. ${q.question.slice(0, 45)}${q.question.length > 45 ? "…" : ""}`, { x: 6.62, y: aiRow + 0.06, w: 5.5, h: 0.28, fontSize: 9, color: TEXT, fontFace: "Arial", bold: isUncoveredAi });
        s.addText(isUncoveredAi ? "⚠ 우선보강" : q.coveredByPage ? "✓" : "미답변", { x: 11.9, y: aiRow + 0.08, w: 0.4, h: 0.24, fontSize: 8, color: col, align: "right", fontFace: "Arial" });
        if (isUncoveredAi && q.importanceReason) {
          s.addText(q.importanceReason.slice(0, 55) + (q.importanceReason.length > 55 ? "…" : ""), { x: 6.62, y: aiRow + 0.38, w: 5.5, h: 0.24, fontSize: 8, color: MUTED, fontFace: "Arial" });
        }
        aiRow += isUncoveredAi ? 0.73 : 0.48;
      });
    }

    if (hasUncoveredTop3) {
      row = Math.max(row, 4.2);
      s.addText("미답변 AI 질문 Top 3 (보강 우선순위)", { x: 0.5, y: row, w: 12, h: 0.3, fontSize: 11, bold: true, color: "F05C7A", fontFace: "Arial" });
      result.recommendations!.predictedUncoveredTop3!.forEach((q, i) => {
        row += 0.5;
        s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: row, w: 12, h: 0.75, fill: { color: SURFACE }, line: { color: "F05C7A", pt: 1 }, rectRadius: 0.08 });
        s.addShape(pptx.ShapeType.roundRect, { x: 0.6, y: row + 0.15, w: 0.4, h: 0.45, fill: { color: "F05C7A" }, line: { type: "none" }, rectRadius: 0.08 });
        s.addText(`${i + 1}`, { x: 0.6, y: row + 0.18, w: 0.4, h: 0.4, fontSize: 14, bold: true, color: "0A0F1A", align: "center", fontFace: "Arial" });
        s.addText(q.question, { x: 1.15, y: row + 0.12, w: 11.2, h: 0.35, fontSize: 10, color: TEXT, fontFace: "Arial", wrap: true });
        if (q.importanceReason) s.addText(q.importanceReason.slice(0, 70) + (q.importanceReason.length > 70 ? "…" : ""), { x: 1.15, y: row + 0.5, w: 11.2, h: 0.22, fontSize: 8, color: MUTED, fontFace: "Arial" });
        row += 0.8;
      });
    }
  }

  // SLIDE 4d: 황금 문단 (인용 확률 TOP 3)
  if (result.chunkCitations && result.chunkCitations.length > 0) {
    const s = pptx.addSlide();
    s.background = { color: BG };
    s.addText("황금 문단 (AI 인용 확률 TOP 3)", { x: 0.5, y: 0.3, w: 12, h: 0.55, fontSize: 22, bold: true, color: TEXT, fontFace: "Arial" });
    s.addText("Gemini 의미적 평가: AI가 정답 출처로 인용할 가능성이 높은 문단", { x: 0.5, y: 0.82, w: 12, h: 0.3, fontSize: 10, color: MUTED, fontFace: "Arial" });
    s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.12, w: 12, h: 0.03, fill: { color: BORDER }, line: { type: "none" } });

    const golden = [...result.chunkCitations].sort((a, b) => b.score - a.score).slice(0, 3);
    const rankColors = ["FBBF24", "A78BFA", "34D399"];
    golden.forEach((chunk, i) => {
      const col = rankColors[i] ?? MUTED;
      const iy = 1.3 + i * 1.6;
      s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: iy, w: 12, h: 1.45, fill: { color: SURFACE }, line: { color: col, pt: 1.5 }, rectRadius: 0.12 });
      s.addShape(pptx.ShapeType.roundRect, { x: 0.6, y: iy + 0.12, w: 0.45, h: 0.4, fill: { color: col }, line: { type: "none" }, rectRadius: 0.1 });
      s.addText(`#${i + 1}`, { x: 0.6, y: iy + 0.15, w: 0.45, h: 0.35, fontSize: 14, bold: true, color: "0A0F1A", align: "center", fontFace: "Arial" });
      s.addText(`인용 점수 ${chunk.score}/10`, { x: 1.2, y: iy + 0.18, w: 2, h: 0.3, fontSize: 10, color: col, fontFace: "Arial" });
      s.addText(chunk.text.slice(0, 120) + (chunk.text.length > 120 ? "…" : ""), { x: 0.6, y: iy + 0.58, w: 11.6, h: 0.45, fontSize: 10, color: TEXT, fontFace: "Arial", wrap: true });
      if (chunk.reason) s.addText(chunk.reason.slice(0, 80) + (chunk.reason.length > 80 ? "…" : ""), { x: 0.6, y: iy + 1.1, w: 11.6, h: 0.3, fontSize: 9, color: MUTED, fontFace: "Arial", italic: true, wrap: true });
    });
  }

  // SLIDE 5: 메타 태그
  {
    const s = pptx.addSlide();
    s.background = { color: BG };
    s.addText("메타 태그 분석", { x: 0.5, y: 0.3, w: 12, h: 0.55, fontSize: 22, bold: true, color: TEXT, fontFace: "Arial" });
    s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.88, w: 12, h: 0.03, fill: { color: BORDER }, line: { type: "none" } });

    const metaItems = [
      { label: "Title", value: result.meta.title, required: true },
      { label: "Meta Description", value: result.meta.description, required: true },
      { label: "OG Title", value: result.meta.ogTitle, required: false },
      { label: "OG Description", value: result.meta.ogDescription, required: false },
      { label: "Canonical URL", value: result.meta.canonical, required: false },
    ];

    metaItems.forEach((item, i) => {
      const present = !!item.value;
      const iy = 1.1 + i * 0.82;
      const col = present ? "34D399" : item.required ? "F05C7A" : MUTED;
      s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: iy, w: 12, h: 0.72, fill: { color: SURFACE }, line: { color: present ? "1E3A2A" : item.required ? "3A1E24" : BORDER, pt: 1 }, rectRadius: 0.1 });
      s.addText(`${item.label}${item.required ? " *" : ""}`, { x: 0.7, y: iy + 0.07, w: 3, h: 0.25, fontSize: 9, color: MUTED, fontFace: "Arial" });
      s.addText(present ? "✓ 설정됨" : "✗ 없음", { x: 10.5, y: iy + 0.07, w: 1.8, h: 0.25, fontSize: 9, color: col, align: "right", fontFace: "Arial" });
      s.addText(item.value ? item.value.slice(0, 100) : "설정되지 않음", { x: 0.7, y: iy + 0.34, w: 11, h: 0.3, fontSize: 11, color: present ? TEXT : col, fontFace: "Arial" });
    });
  }

  // SLIDE 5b: 액션 플랜 (AI 추천 - H2/H3, 블록)
  if (result.recommendations?.actionPlan) {
    const ap = result.recommendations.actionPlan;
    const s = pptx.addSlide();
    s.background = { color: BG };
    s.addText("액션 플랜 (AI 추천)", { x: 0.5, y: 0.3, w: 12, h: 0.55, fontSize: 22, bold: true, color: TEXT, fontFace: "Arial" });
    s.addText("추가할 H2/H3 제목 및 블록(테이블, 리스트, FAQ) — GEO 점수 향상을 위한 맞춤 제안", { x: 0.5, y: 0.82, w: 12, h: 0.3, fontSize: 10, color: MUTED, fontFace: "Arial" });
    s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.12, w: 12, h: 0.03, fill: { color: BORDER }, line: { type: "none" } });

    let iy = 1.35;
    if (ap.suggestedHeadings.length > 0) {
      s.addText("추천 H2/H3 제목", { x: 0.5, y: iy, w: 5.5, h: 0.3, fontSize: 11, bold: true, color: "5B6EF5", fontFace: "Arial" });
      ap.suggestedHeadings.slice(0, 4).forEach((h, i) => {
        iy += 0.42;
        s.addShape(pptx.ShapeType.rect, { x: 0.5, y: iy + 0.05, w: 0.06, h: 0.28, fill: { color: "5B6EF5" }, line: { type: "none" } });
        s.addText(`${i + 1}. ${h}`, { x: 0.68, y: iy, w: 5.2, h: 0.4, fontSize: 10, color: TEXT, fontFace: "Arial", wrap: true });
      });
      iy += 0.5;
    }
    if (ap.suggestedBlocks.length > 0) {
      s.addText("추천 블록 (테이블/리스트/FAQ)", { x: 6.5, y: 1.35, w: 6, h: 0.3, fontSize: 11, bold: true, color: "00D4C8", fontFace: "Arial" });
      let by = 1.75;
      ap.suggestedBlocks.slice(0, 4).forEach((b, i) => {
        s.addShape(pptx.ShapeType.rect, { x: 6.5, y: by + 0.05, w: 0.06, h: 0.28, fill: { color: "00D4C8" }, line: { type: "none" } });
        s.addText(`${i + 1}. ${b.slice(0, 60)}${b.length > 60 ? "…" : ""}`, { x: 6.68, y: by, w: 5.6, h: 0.5, fontSize: 10, color: TEXT, fontFace: "Arial", wrap: true });
        by += 0.6;
      });
    }
  }

  // SLIDE 6: 개선 권고사항
  {
    const s = pptx.addSlide();
    s.background = { color: BG };
    s.addText("개선 권고사항", { x: 0.5, y: 0.3, w: 12, h: 0.55, fontSize: 22, bold: true, color: TEXT, fontFace: "Arial" });
    s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.88, w: 12, h: 0.03, fill: { color: BORDER }, line: { type: "none" } });

    const tips = [];
    if (!result.meta.title) tips.push({ title: "Title 태그 추가", tip: "페이지 주제를 담은 명확한 title을 설정하세요.", priority: "high" });
    if (!result.meta.description) tips.push({ title: "Meta Description 작성", tip: "핵심 답변이 포함된 150자 내외의 description을 작성하세요.", priority: "high" });
    if (result.scores.structureScore < 60) tips.push({ title: "헤딩 구조 개선", tip: "H2 소제목을 질문형으로 재구성하고 본문 첫 단락에 핵심 답변을 배치하세요.", priority: "high" });
    if (result.scores.questionCoverage < 40) tips.push({ title: "FAQ 섹션 추가", tip: "사용자가 AI에게 물을 법한 질문-답변 블록을 본문에 추가하세요.", priority: "medium" });
    if (!result.meta.canonical) tips.push({ title: "Canonical URL 설정", tip: "중복 콘텐츠 방지를 위해 canonical 태그를 추가하세요.", priority: "medium" });
    tips.push({ title: "Schema 마크업 추가", tip: "FAQPage, Article 스키마를 JSON-LD 형식으로 추가하면 AI 인식률이 높아집니다.", priority: "low" });
    if (result.recommendations?.actionPlan?.priorityNotes) {
      result.recommendations.actionPlan.priorityNotes.forEach((note) =>
        tips.push({ title: "AI 추천", tip: note, priority: "medium" as const })
      );
    }

    const pCols: Record<string, string> = { high: "F05C7A", medium: "F5A623", low: "34D399" };
    const pLabels: Record<string, string> = { high: "긴급", medium: "보통", low: "낮음" };

    tips.slice(0, 6).forEach((item, i) => {
      const col = pCols[item.priority] || MUTED;
      const colCount = i < 3 ? 3 : 2;
      const cardW = colCount === 3 ? 4.0 : 6.1;
      const ix = 0.4 + (i % colCount) * (cardW + 0.2);
      const iy = 1.1 + Math.floor(i / colCount) * 2.1;
      s.addShape(pptx.ShapeType.roundRect, { x: ix, y: iy, w: cardW, h: 1.85, fill: { color: SURFACE }, line: { color: col, pt: 1.5 }, rectRadius: 0.12 });
      s.addShape(pptx.ShapeType.roundRect, { x: ix + 0.15, y: iy + 0.12, w: 1.1, h: 0.26, fill: { color: col, transparency: 75 }, line: { type: "none" }, rectRadius: 0.08 });
      s.addText(pLabels[item.priority], { x: ix + 0.15, y: iy + 0.12, w: 1.1, h: 0.26, fontSize: 7, bold: true, color: col, align: "center", fontFace: "Arial" });
      s.addText(item.title, { x: ix + 0.15, y: iy + 0.46, w: cardW - 0.3, h: 0.35, fontSize: 11, bold: true, color: TEXT, fontFace: "Arial" });
      s.addText(item.tip, { x: ix + 0.15, y: iy + 0.88, w: cardW - 0.3, h: 0.8, fontSize: 9, color: MUTED, fontFace: "Arial", wrap: true });
    });
  }

  // SLIDE 7: 결론
  {
    const s = pptx.addSlide();
    s.background = { color: BG };
    s.addShape(pptx.ShapeType.ellipse, { x: 7.5, y: -0.5, w: 5.5, h: 5.5, fill: { color: "5B6EF5", transparency: 93 }, line: { type: "none" } });

    s.addText("결론 및 다음 단계", { x: 0.5, y: 0.4, w: 12, h: 0.55, fontSize: 22, bold: true, color: TEXT, fontFace: "Arial" });
    s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.95, w: 12, h: 0.03, fill: { color: BORDER }, line: { type: "none" } });

    s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 1.2, w: 3.5, h: 2.6, fill: { color: CARD }, line: { color: gi.color, pt: 2 }, rectRadius: 0.2 });
    s.addText("종합 GEO 등급", { x: 0.5, y: 1.38, w: 3.5, h: 0.3, fontSize: 10, color: MUTED, align: "center", fontFace: "Arial" });
    s.addText(gi.grade, { x: 0.5, y: 1.68, w: 3.5, h: 0.85, fontSize: 60, bold: true, color: gi.color, align: "center", fontFace: "Arial" });
    s.addText(`${result.scores.finalScore}점 / 100`, { x: 0.5, y: 2.58, w: 3.5, h: 0.3, fontSize: 13, color: TEXT, align: "center", fontFace: "Arial" });
    s.addText(gi.label, { x: 0.5, y: 2.92, w: 3.5, h: 0.3, fontSize: 10, color: MUTED, align: "center", fontFace: "Arial" });
    s.addText(`구조: ${result.scores.structureScore}점  ·  커버리지: ${result.scores.questionCoverage}%`, { x: 0.5, y: 3.3, w: 3.5, h: 0.28, fontSize: 9, color: MUTED, align: "center", fontFace: "Arial" });

    s.addText("즉시 실행 가능한 개선 항목", { x: 4.3, y: 1.2, w: 8, h: 0.35, fontSize: 11, bold: true, color: TEXT, fontFace: "Arial" });
    const urgents = [];
    if (!result.meta.title) urgents.push("Title 태그 추가");
    if (!result.meta.description) urgents.push("Meta Description 작성");
    if (result.scores.structureScore < 60) urgents.push("헤딩 구조를 질문형으로 개선");
    if (result.scores.questionCoverage < 40) urgents.push("FAQ 섹션 추가");
    if (!result.meta.canonical) urgents.push("Canonical URL 설정");

    urgents.slice(0, 5).forEach((u, i) => {
      const iy = 1.65 + i * 0.5;
      s.addShape(pptx.ShapeType.rect, { x: 4.3, y: iy + 0.08, w: 0.04, h: 0.34, fill: { color: "F05C7A" }, line: { type: "none" } });
      s.addText(u, { x: 4.5, y: iy, w: 8, h: 0.5, fontSize: 11, color: TEXT, fontFace: "Arial", valign: "middle" });
    });

    s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 4.5, w: 12, h: 0.78, fill: { color: CARD }, line: { color: BORDER, pt: 1 }, rectRadius: 0.1 });
    s.addText(`분석 URL: ${result.url}  |  분석일: ${new Date(result.analyzedAt).toLocaleDateString("ko-KR")}`, { x: 0.5, y: 4.5, w: 12, h: 0.78, fontSize: 9, color: MUTED, align: "center", fontFace: "Arial" });
  }

  const domain = result.url.replace(/https?:\/\//, "").split("/")[0].replace(/\./g, "_");
  const dateStr = new Date().toISOString().slice(0, 10);
  await pptx.writeFile({ fileName: `GEO_Report_${domain}_${dateStr}.pptx` });
}
