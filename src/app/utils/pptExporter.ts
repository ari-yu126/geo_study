import type { AnalysisResult, AuditIssue, GeoIssue, PassedCheck } from "@/lib/analysisTypes";
import { GEO_SCORE_AXIS_LABEL_KO } from "@/lib/geoScoreAxisLabels";
import { geoPassedToPassedChecks } from "@/lib/geoExplain";
import { dedupeGeoIssuesById } from "@/lib/geoExplain/issueEngine";
import { RECOMMENDATION_SECTION_LABELS } from "@/lib/recommendations/recommendationUiLabels";
import {
  GEO_REPORT_LABELS_KO,
  geoReportGuideTitle,
  geoReportHeadingsSectionLabel,
  getGeoGradeInfo,
} from "@/app/utils/geoReportLabels";
import { getAxisRows, getStrengthRows, type AxisRow, type StrengthRow } from "@/app/utils/geoExplainUi";
import { generateOpportunities } from "@/lib/generateOpportunities";

/**
 * pptxgen `addText` has no auto-height — estimate wrapped block height (inches) for box `w` / `fontSizePt`.
 * Slightly conservative for mixed KO/EN so text is less likely to clip.
 */
function pptTextBoxHeightInches(
  text: string,
  boxWidthIn: number,
  fontSizePt: number,
  lineHeight = 1.4
): number {
  const t = text.trim();
  const lineH = (fontSizePt / 72) * lineHeight;
  if (!t) return lineH;
  const avgCharW = Math.max((fontSizePt / 72) * 0.52, 0.055);
  const charsPerLine = Math.max(6, Math.floor(boxWidthIn / avgCharW));
  const lines = Math.ceil(t.length / charsPerLine);
  return Math.max(lineH, lines * lineH);
}

/**
 * pptxgen height for KO/mixed copy: Latin `charsPerLine` over-counts capacity; CJK glyphs are wider → more lines.
 * Used where clipping was reported (slide 2 Title card).
 */
function pptTextBoxHeightInchesI18n(
  text: string,
  boxWidthIn: number,
  fontSizePt: number,
  lineHeight: number,
  opts?: { bold?: boolean }
): number {
  const t = text.trim().replace(/\r\n/g, "\n");
  const em = fontSizePt / 72;
  const lineH = em * lineHeight;
  if (!t) return lineH;
  const cjkMatches = t.match(/[\u3000-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/g);
  const cjkCount = cjkMatches?.length ?? 0;
  const cjkRatio = t.length > 0 ? cjkCount / t.length : 0;
  const avgW = em * (0.5 * (1 - cjkRatio) + 0.92 * cjkRatio);
  const charsPerLine = Math.max(4, Math.floor(boxWidthIn / Math.max(avgW, 0.05)));
  /** Each `\\n` is a real line break; empty segments are blank lines (e.g. `\\n\\n` between paragraphs). */
  const segments = t.split("\n");
  let totalLines = 0;
  for (const seg of segments) {
    if (seg.length === 0) {
      totalLines += 1;
      continue;
    }
    let segLines = Math.ceil(seg.length / charsPerLine);
    if (opts?.bold) segLines = Math.ceil(segLines * 1.12);
    totalLines += Math.max(1, segLines);
  }
  const raw = Math.max(lineH, totalLines * lineH);
  return raw * 1.1;
}

function clipPptLine(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(0, maxChars - 1))}…`;
}

/** True when engine copy uses `… 점수가 N로 높습니다.` (axis highlight). */
function strengthPptHasScoreHighlightLine(row: StrengthRow): boolean {
  const d = row.description?.trim() ?? "";
  return /점수가\s*\d+\s*로\s*높습니다/.test(d);
}

/**
 * Primary title: `ㅇㅇ 축 우수 (점수 85점. 높음)` — score part immediately after label, same line / wrap.
 * If no score pattern, returns `row.label` only.
 */
function strengthPptPrimaryTitleLine(row: StrengthRow): string {
  const d = row.description?.trim() ?? "";
  const m = d.match(/점수가\s*(\d+)\s*로\s*높습니다/);
  if (m) {
    const n = m[1];
    return `${row.label} (점수 ${n}점. 높음)`;
  }
  return row.label;
}

/** Body below title row (if score highlight, description is folded into title; only reason remains). */
function strengthPptBodyAfterTitle(row: StrengthRow, hasScoreHighlight: boolean): string {
  const d = row.description?.trim() ?? "";
  const r = row.reason?.trim() ?? "";
  if (hasScoreHighlight) {
    return r;
  }
  const parts: string[] = [];
  if (d && d !== row.label) parts.push(d);
  if (r) parts.push(r);
  return parts.join("\n\n");
}

function geoIssueFullBlock(g: GeoIssue): string {
  const parts: string[] = [g.label];
  if (g.description?.trim()) parts.push(g.description.trim());
  if (g.fix?.trim()) parts.push(g.fix.trim());
  return parts.join("\n\n");
}

function legacyAuditIssueFullBlock(i: AuditIssue): string {
  const parts: string[] = [i.label];
  if (i.description?.trim()) parts.push(i.description.trim());
  return parts.join("\n\n");
}

/** AuditPanel `SEARCH_SOURCE_LABEL` — PPT question rows */
const SEARCH_SOURCE_LABEL_PPT: Record<string, string> = {
  google: "Google",
  naver: "Naver",
  community: "커뮤니티",
};

function pptDomainFromUrl(url?: string): string | null {
  if (!url?.trim()) return null;
  try {
    const u = url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`;
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Optional audit snapshot from the same source as AuditPanel (`deriveAuditIssues`). When omitted, GEO explain fields on `result` are used. */
export type ExportPptAuditOptions = {
  passedChecks?: PassedCheck[];
  auditIssues?: AuditIssue[];
};

/**
 * UI에 렌더된 AnalysisResult만 사용해 PPT 생성. runAnalysis 재호출 없음.
 * 슬라이드 값은 result.scores / issues / recommendations / searchQuestions / covered 등 실제 result 필드만 사용.
 */
export async function exportToPPT(
  result: AnalysisResult,
  options?: ExportPptAuditOptions
): Promise<void> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";

  const displayMetaOrOgSnippet =
    result.meta.description?.trim() || result.meta.ogDescription?.trim() || "";
  const BG = "080C14";
  const SURFACE = "0F1623";
  const CARD = "141D2E";
  const BORDER = "1E2D45";
  /** Section title underline — same as 질문 커버리지 현황 divider (`00D4C8`). */
  const SECTION_TITLE_RULE = "00D4C8";
  const TEXT = "E8EDF5";
  const MUTED = "6B7D96";
  const sc = result.scores;
  const gi = getGeoGradeInfo(sc.finalScore);
  const hasCitation = (sc.citationScore ?? -1) >= 0;
  const R = GEO_REPORT_LABELS_KO;
  const axisL = GEO_SCORE_AXIS_LABEL_KO;
  const secKo = RECOMMENDATION_SECTION_LABELS.ko;

  const passedChecksForPpt =
    options?.passedChecks ?? result.passedChecks ?? geoPassedToPassedChecks(result.geoExplain?.passed ?? []);
  const strengthRows = getStrengthRows(result, passedChecksForPpt);
  const useGeoIssues = Boolean(result.geoExplain?.issues && result.geoExplain.issues.length > 0);
  const geoIssuesForPpt = useGeoIssues ? dedupeGeoIssuesById(result.geoExplain!.issues) : [];
  const legacyIssuesForPpt = options?.auditIssues ?? result.auditIssues ?? [];

  /** GEO 감사 요약 split slides — shared header (title + divider). */
  const addAuditSectionSlide = (titleLine: string, continued: boolean) => {
    const slide = pptx.addSlide();
    slide.background = { color: BG };
    const t = continued ? titleLine + R.pptAuditSectionContinued : titleLine;
    slide.addText(t, {
      x: 0.5,
      y: 0.26,
      w: 12,
      h: 0.6,
      fontSize: 20,
      bold: true,
      color: TEXT,
      fontFace: "Arial",
      wrap: true,
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.5,
      y: 0.88,
      w: 12,
      h: 0.03,
      fill: { color: SECTION_TITLE_RULE },
      line: { type: "none" },
    });
    return slide;
  };

  /** PPT 전용: 종합 탭과 동일 가중(인용 축 있을 때 40/15/15/15/15) */
  function buildPptWeightedAxisRows(): { pptLabel: string; score: number; maxScore: number; fillHex: string }[] {
    const L = axisL;
    const hex = (c: string) => c.replace("#", "").toUpperCase();
    if (hasCitation) {
      return [
        {
          pptLabel: L.citation,
          score: Math.round((sc.citationScore ?? 0) * 0.4),
          maxScore: 40,
          fillHex: hex("#a855f7"),
        },
        {
          pptLabel: L.paragraph,
          score: Math.round((sc.paragraphScore ?? 0) * 0.15),
          maxScore: 15,
          fillHex: hex("#5b6ef5"),
        },
        {
          pptLabel: L.answerability,
          score: Math.round((sc.answerabilityScore ?? 0) * 0.15),
          maxScore: 15,
          fillHex: hex("#00d4c8"),
        },
        {
          pptLabel: L.structure,
          score: Math.round(sc.structureScore * 0.15),
          maxScore: 15,
          fillHex: hex("#34d399"),
        },
        {
          pptLabel: L.trust,
          score: Math.round((sc.trustScore ?? 0) * 0.15),
          maxScore: 15,
          fillHex: hex("#f5a623"),
        },
      ];
    }
    return [
      {
        pptLabel: L.paragraph,
        score: Math.round((sc.paragraphScore ?? 0) * 0.35),
        maxScore: 35,
        fillHex: hex("#5b6ef5"),
      },
      {
        pptLabel: L.answerability,
        score: Math.round((sc.answerabilityScore ?? 0) * 0.25),
        maxScore: 25,
        fillHex: hex("#00d4c8"),
      },
      {
        pptLabel: L.structure,
        score: Math.round(sc.structureScore * 0.2),
        maxScore: 20,
        fillHex: hex("#34d399"),
      },
      {
        pptLabel: L.trust,
        score: Math.round((sc.trustScore ?? 0) * 0.15),
        maxScore: 15,
        fillHex: hex("#f5a623"),
      },
    ];
  }

  // SLIDE 1: 표지
  {
    const s = pptx.addSlide();
    s.background = { color: BG };

    s.addShape(pptx.ShapeType.ellipse, { x: -0.8, y: -0.8, w: 4.5, h: 4.5, fill: { color: "5B6EF5", transparency: 90 }, line: { type: "none" } });
    s.addShape(pptx.ShapeType.ellipse, { x: 9, y: 3, w: 4, h: 4, fill: { color: "00D4C8", transparency: 92 }, line: { type: "none" } });

    s.addShape(pptx.ShapeType.roundRect, { x: 0.8, y: 1.0, w: 3.5, h: 0.36, fill: { color: CARD }, line: { color: "5B6EF5", pt: 1 }, rectRadius: 0.1 });
    s.addText(R.pptCoverBadge, { x: 0.8, y: 1.0, w: 3.5, h: 0.36, fontSize: 8, bold: true, color: "818CF8", align: "center", fontFace: "Arial" });

    s.addText(R.reportTitle, { x: 0.8, y: 1.55, w: 9, h: 0.95, fontSize: 38, bold: true, color: TEXT, fontFace: "Arial" });

    const displayUrl = result.url.length > 60 ? result.url.slice(0, 60) + "..." : result.url;
    s.addText(displayUrl, { x: 0.8, y: 2.6, w: 9, h: 0.4, fontSize: 12, color: MUTED, fontFace: "Arial" });
    s.addShape(pptx.ShapeType.rect, { x: 0.8, y: 3.1, w: 5, h: 0.03, fill: { color: BORDER }, line: { type: "none" } });
    s.addText(`${R.analyzedOnPrefix} ${new Date(result.analyzedAt).toLocaleDateString("ko-KR")}`, { x: 0.8, y: 3.25, w: 8, h: 0.35, fontSize: 10, color: MUTED, fontFace: "Arial" });

    const gradeCardY = 4.88;
    s.addShape(pptx.ShapeType.roundRect, { x: 8.8, y: gradeCardY, w: 3.2, h: 2.2, fill: { color: CARD }, line: { color: gi.colorHex, pt: 2 }, rectRadius: 0.2 });
    s.addText(R.overallGeoGrade, { x: 8.8, y: gradeCardY + 0.2, w: 3.2, h: 0.3, fontSize: 10, color: MUTED, align: "center", fontFace: "Arial" });
    s.addText(gi.grade, { x: 8.8, y: gradeCardY + 0.5, w: 3.2, h: 0.85, fontSize: 55, bold: true, color: gi.colorHex, align: "center", fontFace: "Arial" });
    s.addText(R.pointsOutOf100(sc.finalScore), { x: 8.8, y: gradeCardY + 1.4, w: 3.2, h: 0.3, fontSize: 11, color: TEXT, align: "center", fontFace: "Arial" });
    s.addText(gi.label, { x: 8.8, y: gradeCardY + 1.75, w: 3.2, h: 0.28, fontSize: 9, color: MUTED, align: "center", fontFace: "Arial" });
  }

  // SLIDE 2: 최종 점수 + 가중 기여도(PPT 만점 라벨) + 세부 점수 0–100 (AuditPanel `getAxisRows`와 동일)
  {
    const s = pptx.addSlide();
    s.background = { color: BG };
    s.addText(R.overallGeoScoreSlideTitle, { x: 0.5, y: 0.3, w: 12, h: 0.55, fontSize: 22, bold: true, color: TEXT, fontFace: "Arial" });
    s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.88, w: 12, h: 0.03, fill: { color: SECTION_TITLE_RULE }, line: { type: "none" } });

    s.addText(String(sc.finalScore), { x: 0.5, y: 1.12, w: 2.35, h: 0.65, fontSize: 44, bold: true, color: gi.colorHex, fontFace: "Arial" });
    s.addText(R.finalScoreSlash100WithGrade(sc.finalScore, gi.label), { x: 3.05, y: 1.38, w: 5.5, h: 0.4, fontSize: 12, color: TEXT, fontFace: "Arial" });

    const weightedRows = buildPptWeightedAxisRows();
    const n = weightedRows.length;
    /** Same full-bleed row as title / detail blocks: x=0.5, width=12 → cards fill 100% */
    const rowLeft = 0.5;
    const rowWidth = 12;
    const gap = n > 1 ? 0.06 : 0;
    const cardW = (rowWidth - gap * (n - 1)) / n;
    const cardTop = 2.12;
    const labelColFrac = 0.62;
    const headerY = 0.14;
    const headerRowH = 0.42;
    const barGap = 0.12;
    const barH = 0.13;
    const cardPadBottom = 0.18;
    const cardH = headerY + headerRowH + barGap + barH + cardPadBottom;
    const cardPadX = Math.min(0.18, cardW * 0.085);

    weightedRows.forEach((item, i) => {
      const x = rowLeft + i * (cardW + gap);
      const ratio = item.maxScore > 0 ? item.score / item.maxScore : 0;
      const innerW = cardW - 2 * cardPadX;
      const barW = innerW * ratio;
      const scoreLine = `${item.score}/${item.maxScore}`;
      const barY = cardTop + headerY + headerRowH + barGap;
      s.addShape(pptx.ShapeType.roundRect, {
        x,
        y: cardTop,
        w: cardW,
        h: cardH,
        fill: { color: SURFACE },
        line: { color: BORDER, pt: 1 },
        rectRadius: 0.12,
      });
      s.addText(item.pptLabel, {
        x: x + cardPadX,
        y: cardTop + headerY,
        w: innerW * labelColFrac,
        h: headerRowH,
        fontSize: 8,
        bold: true,
        color: TEXT,
        fontFace: "Arial",
        wrap: true,
        valign: "middle",
      });
      s.addText(scoreLine, {
        x: x + cardPadX + innerW * labelColFrac,
        y: cardTop + headerY,
        w: innerW * (1 - labelColFrac),
        h: headerRowH,
        fontSize: 13,
        bold: true,
        color: item.fillHex,
        align: "right",
        fontFace: "Arial",
        valign: "middle",
      });
      s.addShape(pptx.ShapeType.rect, { x: x + cardPadX, y: barY, w: innerW, h: barH, fill: { color: BORDER }, line: { type: "none" } });
      if (barW > 0) s.addShape(pptx.ShapeType.rect, { x: x + cardPadX, y: barY, w: barW, h: barH, fill: { color: item.fillHex }, line: { type: "none" } });
    });

    const axisRows = getAxisRows(result);
    const supportingY = cardTop + cardH + 0.12;
    const rowH = 0.26;
    const titleBand = 0.42;
    const bottomPad = 0.16;
    const colGap = 0.4;
    const innerLeft = 0.65;
    const innerW = 11.1;
    const colW = (innerW - colGap) / 2;

    const addDetailCell = (x: number, y: number, w: number, row: AxisRow) => {
      s.addText(row.label, {
        x,
        y,
        w: w * 0.68,
        h: rowH,
        fontSize: 9,
        color: TEXT,
        fontFace: "Arial",
      });
      s.addText(String(row.value), {
        x: x + w * 0.68,
        y,
        w: w * 0.32,
        h: rowH,
        fontSize: 9,
        bold: true,
        color: "5B6EF5",
        align: "right",
        fontFace: "Arial",
      });
    };

    const pairCount = axisRows.length === 0 ? 0 : Math.ceil(axisRows.length / 2);
    const detailBodyH = axisRows.length === 0 ? 0.28 : pairCount * rowH;
    const detailBoxH = titleBand + detailBodyH + bottomPad;

    s.addShape(pptx.ShapeType.roundRect, {
      x: 0.5,
      y: supportingY,
      w: 12,
      h: detailBoxH,
      fill: { color: CARD },
      line: { color: BORDER, pt: 1 },
      rectRadius: 0.1,
    });
    s.addText(R.detailScoreSectionTitle, {
      x: 0.65,
      y: supportingY + 0.1,
      w: 11,
      h: 0.3,
      fontSize: 10,
      bold: true,
      color: "6B7D96",
      fontFace: "Arial",
    });

    let lineY = supportingY + titleBand;
    if (axisRows.length === 0) {
      s.addText(R.detailScoreSectionEmpty, {
        x: 0.65,
        y: lineY,
        w: 11.2,
        h: 0.26,
        fontSize: 9,
        color: MUTED,
        fontFace: "Arial",
      });
    } else {
      for (let p = 0; p < pairCount; p++) {
        const left = axisRows[p * 2];
        const right = axisRows[p * 2 + 1];
        addDetailCell(innerLeft, lineY, colW, left);
        if (right) addDetailCell(innerLeft + colW + colGap, lineY, colW, right);
        lineY += rowH;
      }
    }

    const metaBoxY = supportingY + detailBoxH + 0.18;
    if (result.meta.title) {
      /** Page title + optional snippet — tight top padding, shorter title box, less gap before snippet. */
      const metaTextW = 11;
      const metaInnerBottom = 0.2;
      const pageTitleH =
        pptTextBoxHeightInchesI18n(result.meta.title, metaTextW, 12, 1.1, { bold: true }) + 0.14;
      const snippet =
        displayMetaOrOgSnippet
          ? displayMetaOrOgSnippet.slice(0, 120) + (displayMetaOrOgSnippet.length > 120 ? "..." : "")
          : "";
      const snippetH = displayMetaOrOgSnippet
        ? pptTextBoxHeightInchesI18n(snippet, metaTextW, 9, 1.55) + 0.24
        : 0;
      /** Top inset inside meta card — keep title block visually higher (closer to box top). */
      const metaTitleLabelBand = 0.26;
      const metaTitleY = metaBoxY + metaTitleLabelBand;
      /** Pull snippet closer to title (pptx often leaves slack in the title box). */
      const metaTitleToSnippetTighten = 0.1;
      const metaBoxH =
        metaTitleLabelBand +
        pageTitleH +
        (displayMetaOrOgSnippet ? snippetH - metaTitleToSnippetTighten : 0) +
        metaInnerBottom;
      const metaSnippetY = metaTitleY + pageTitleH - metaTitleToSnippetTighten;
      s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: metaBoxY, w: 12, h: metaBoxH, fill: { color: CARD }, line: { color: BORDER, pt: 1 }, rectRadius: 0.12 });
      s.addText(result.meta.title, {
        x: 0.65,
        y: metaTitleY,
        w: metaTextW,
        h: pageTitleH,
        fontSize: 12,
        bold: true,
        color: TEXT,
        fontFace: "Arial",
        wrap: true,
      });
      if (displayMetaOrOgSnippet) {
        s.addText(snippet, {
          x: 0.65,
          y: metaSnippetY,
          w: metaTextW,
          h: snippetH,
          fontSize: 9,
          color: MUTED,
          fontFace: "Arial",
          wrap: true,
        });
      }
    }
  }

  // SLIDE 3+: 잘된 점 (전체 행 · AuditPanel에서 View More 펼친 것과 동일 문구)
  {
    const AUDIT_BODY_TOP = 1.02;
    const AUDIT_BODY_MAX = 6.88;
    const strengthBoxX = 0.5;
    const strengthBoxW = 12;
    const strengthInnerPad = 0.08;
    const strengthTextW = strengthBoxW - 2 * strengthInnerPad;
    const strengthTitlePt = 12;
    const rowGap = 0.14;

    let slideRef = addAuditSectionSlide(R.pptAuditStrengthsSlideTitle, false);
    let y = AUDIT_BODY_TOP;
    if (strengthRows.length === 0) {
      const emptyH = pptTextBoxHeightInchesI18n(R.pptStrengthsEmpty, strengthTextW, 10, 1.45);
      const emptyBoxH = emptyH + 2 * strengthInnerPad;
      if (y + emptyBoxH > AUDIT_BODY_MAX) {
        slideRef = addAuditSectionSlide(R.pptAuditStrengthsSlideTitle, true);
        y = AUDIT_BODY_TOP;
      }
      slideRef.addShape(pptx.ShapeType.roundRect, {
        x: strengthBoxX,
        y,
        w: strengthBoxW,
        h: emptyBoxH,
        fill: { color: SURFACE },
        line: { color: BORDER, pt: 1 },
        rectRadius: 0.12,
      });
      slideRef.addText(R.pptStrengthsEmpty, {
        x: strengthBoxX + strengthInnerPad,
        y: y + strengthInnerPad,
        w: strengthTextW,
        h: emptyH,
        fontSize: 10,
        color: MUTED,
        fontFace: "Arial",
        wrap: true,
      });
    } else {
      const innerLeft = strengthBoxX + strengthInnerPad;
      for (const row of strengthRows) {
        const hasScoreHighlight = strengthPptHasScoreHighlightLine(row);
        const titleLine = strengthPptPrimaryTitleLine(row);
        const bodyText = strengthPptBodyAfterTitle(row, hasScoreHighlight).trim();
        const titleRowH = pptTextBoxHeightInchesI18n(titleLine, strengthTextW, strengthTitlePt, 1.22, { bold: true });
        const bodyH = bodyText.length
          ? pptTextBoxHeightInchesI18n(bodyText, strengthTextW, 9, 1.52) + 0.14
          : 0;
        const textStackH = titleRowH + (bodyH > 0 ? 0.12 + bodyH : 0);
        const textH = textStackH + 0.06;
        const boxH = textH + 2 * strengthInnerPad;
        if (y + boxH > AUDIT_BODY_MAX) {
          slideRef = addAuditSectionSlide(R.pptAuditStrengthsSlideTitle, true);
          y = AUDIT_BODY_TOP;
        }
        const contentY = y + strengthInnerPad;
        slideRef.addShape(pptx.ShapeType.roundRect, {
          x: strengthBoxX,
          y,
          w: strengthBoxW,
          h: boxH,
          fill: { color: SURFACE },
          line: { color: BORDER, pt: 1 },
          rectRadius: 0.12,
        });
        slideRef.addText(titleLine, {
          x: innerLeft,
          y: contentY,
          w: strengthTextW,
          h: titleRowH,
          fontSize: strengthTitlePt,
          bold: true,
          color: TEXT,
          fontFace: "Arial",
          wrap: true,
        });
        if (bodyH > 0) {
          slideRef.addText(bodyText, {
            x: innerLeft,
            y: contentY + titleRowH + 0.12,
            w: strengthTextW,
            h: bodyH,
            fontSize: 9,
            color: TEXT,
            fontFace: "Arial",
            wrap: true,
          });
        }
        y += boxH + rowGap;
      }
    }
  }

  // SLIDE: 발견된 이슈 (전체)
  {
    const AUDIT_BODY_TOP = 1.02;
    const AUDIT_BODY_MAX = 6.88;
    const issueBoxX = 0.5;
    const issueBoxW = 12;
    const issueInnerPad = 0.14;
    const issueTextW = issueBoxW - 2 * issueInnerPad;
    const textFullW = 11.38;
    const barLeft = 0.55;
    const rowGap = 0.12;

    const issueBlocks: { text: string; sev: string }[] = [];
    if (useGeoIssues) {
      geoIssuesForPpt.forEach((g) => {
        issueBlocks.push({ text: geoIssueFullBlock(g), sev: g.severity });
      });
    } else {
      legacyIssuesForPpt.forEach((iss) => {
        issueBlocks.push({ text: legacyAuditIssueFullBlock(iss), sev: iss.priority });
      });
    }

    /** Same as AuditPanel: `auditIssueIds` + `generateOpportunities` + `auditIssueCount <= 2` */
    const auditIssueIdsForOpportunities = useGeoIssues
      ? geoIssuesForPpt.map((g) => g.id)
      : legacyIssuesForPpt.map((i) => i.id);
    const strengthOpportunities = generateOpportunities(
      result,
      result.pageType ?? "default",
      auditIssueIdsForOpportunities
    );
    const auditIssueCount = useGeoIssues ? geoIssuesForPpt.length : legacyIssuesForPpt.length;
    const showStrengthOpportunities = auditIssueCount <= 2 && strengthOpportunities.length > 0;

    let slideRef = addAuditSectionSlide(R.pptAuditIssuesSlideTitle, false);
    let y = AUDIT_BODY_TOP;
    if (issueBlocks.length === 0) {
      /** Same title size as keywords empty state (`keywordsEmptyTitle` uses fontSize 14). */
      const issueEmptyTitlePt = 14;
      const emptyH = pptTextBoxHeightInchesI18n(R.pptIssuesEmpty, textFullW, issueEmptyTitlePt, 1.4);
      slideRef.addText(R.pptIssuesEmpty, {
        x: barLeft,
        y,
        w: textFullW,
        h: emptyH,
        fontSize: issueEmptyTitlePt,
        color: MUTED,
        fontFace: "Arial",
        wrap: true,
      });
      y += emptyH + 0.16;
    } else {
      for (const it of issueBlocks) {
        const textH = pptTextBoxHeightInchesI18n(it.text, issueTextW, 9, 1.52) + 0.2;
        const boxH = textH + 2 * issueInnerPad;
        if (y + boxH > AUDIT_BODY_MAX) {
          slideRef = addAuditSectionSlide(R.pptAuditIssuesSlideTitle, true);
          y = AUDIT_BODY_TOP;
        }
        slideRef.addShape(pptx.ShapeType.roundRect, {
          x: issueBoxX,
          y,
          w: issueBoxW,
          h: boxH,
          fill: { color: SURFACE },
          line: { color: BORDER, pt: 1 },
          rectRadius: 0.12,
        });
        slideRef.addText(it.text, {
          x: issueBoxX + issueInnerPad,
          y: y + issueInnerPad,
          w: issueTextW,
          h: textH,
          fontSize: 9,
          color: TEXT,
          fontFace: "Arial",
          wrap: true,
        });
        y += boxH + rowGap;
      }
    }

    if (showStrengthOpportunities) {
      const sectionTopGap = issueBlocks.length > 0 ? 0.26 : 0.12;
      y += sectionTopGap;
      const headingText = R.pptStrengthBoostHeading(strengthOpportunities.length);
      const headingH = 0.3;
      if (y + headingH + 0.5 > AUDIT_BODY_MAX) {
        slideRef = addAuditSectionSlide(R.pptAuditIssuesSlideTitle, true);
        y = AUDIT_BODY_TOP;
      }
      slideRef.addText(headingText, {
        x: barLeft,
        y,
        w: textFullW,
        h: headingH,
        fontSize: 10,
        bold: true,
        color: "7A8DA3",
        fontFace: "Arial",
      });
      y += headingH + 0.12;
      const boostColor = "A8B8CC";
      for (const line of strengthOpportunities) {
        const bullet = `• ${line}`;
        const h = pptTextBoxHeightInchesI18n(bullet, textFullW - 0.18, 10, 1.48) + 0.1;
        if (y + h > AUDIT_BODY_MAX) {
          slideRef = addAuditSectionSlide(R.pptAuditIssuesSlideTitle, true);
          y = AUDIT_BODY_TOP;
        }
        slideRef.addText(bullet, {
          x: barLeft + 0.06,
          y,
          w: textFullW - 0.12,
          h,
          fontSize: 10,
          color: boostColor,
          fontFace: "Arial",
          wrap: true,
        });
        y += h + 0.08;
      }
    }
  }

  // SLIDE 4: 키워드
  {
    const s = pptx.addSlide();
    s.background = { color: BG };
    s.addText(R.keywordsSlideTitle, { x: 0.5, y: 0.3, w: 12, h: 0.55, fontSize: 22, bold: true, color: TEXT, fontFace: "Arial" });
    s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.88, w: 12, h: 0.03, fill: { color: SECTION_TITLE_RULE }, line: { type: "none" } });

    const keywords = result.seedKeywords?.slice(0, 20) ?? [];
    const colors = ["5B6EF5", "00D4C8", "F5A623", "F05C7A", "34D399"];
    const boxX = 0.5;
    const boxW = 12;
    const innerPad = 0.22;
    const lineStep = 0.6;
    const chipH = 0.42;
    const chipGapX = 0.18;
    const boxTop = 1.06;
    const contentLeft = boxX + innerPad;
    const maxX = boxX + boxW - innerPad;

    if (keywords.length === 0) {
      const emptyTitleH = pptTextBoxHeightInches(R.keywordsEmptyTitle, boxW - 2 * innerPad, 14);
      const emptyHintH = pptTextBoxHeightInches(R.keywordsEmptyHint, boxW - 2 * innerPad, 11);
      const emptyBoxH = innerPad + emptyTitleH + 0.12 + emptyHintH + innerPad;
      s.addShape(pptx.ShapeType.roundRect, {
        x: boxX,
        y: boxTop,
        w: boxW,
        h: emptyBoxH,
        fill: { color: SURFACE },
        line: { color: BORDER, pt: 1 },
        rectRadius: 0.12,
      });
      s.addText(R.keywordsEmptyTitle, {
        x: contentLeft,
        y: boxTop + innerPad,
        w: boxW - 2 * innerPad,
        h: emptyTitleH,
        fontSize: 14,
        color: MUTED,
        fontFace: "Arial",
        wrap: true,
      });
      s.addText(R.keywordsEmptyHint, {
        x: contentLeft,
        y: boxTop + innerPad + emptyTitleH + 0.12,
        w: boxW - 2 * innerPad,
        h: emptyHintH,
        fontSize: 11,
        color: MUTED,
        fontFace: "Arial",
        wrap: true,
      });
    } else {
      let kx = contentLeft;
      let ky = boxTop + innerPad;
      let maxBottom = ky;
      const placements: { x: number; y: number; w: number; kw: (typeof keywords)[0]; i: number }[] = [];
      keywords.forEach((kw, i) => {
        let estW = kw.value.length * 0.13 + 0.5;
        if (kx + estW > maxX && kx > contentLeft) {
          kx = contentLeft;
          ky += lineStep;
        }
        if (kx + estW > maxX) {
          estW = Math.max(0.55, maxX - kx);
        }
        placements.push({ x: kx, y: ky, w: estW, kw, i });
        maxBottom = Math.max(maxBottom, ky + chipH);
        kx += estW + chipGapX;
      });
      const boxH = maxBottom - boxTop + innerPad;
      s.addShape(pptx.ShapeType.roundRect, {
        x: boxX,
        y: boxTop,
        w: boxW,
        h: boxH,
        fill: { color: SURFACE },
        line: { color: BORDER, pt: 1 },
        rectRadius: 0.12,
      });
      placements.forEach(({ x, y, w, kw, i }) => {
        const col = colors[i % colors.length];
        const fontSize = kw.score > 0.6 ? 14 : kw.score > 0.3 ? 11 : 9;
        s.addShape(pptx.ShapeType.roundRect, {
          x,
          y,
          w,
          h: chipH,
          fill: { color: col, transparency: 82 },
          line: { color: col, pt: 1 },
          rectRadius: 0.18,
        });
        s.addText(kw.value, {
          x,
          y,
          w,
          h: chipH,
          fontSize,
          color: TEXT,
          align: "center",
          fontFace: "Arial",
          bold: kw.score > 0.6,
          valign: "middle",
        });
      });
    }
  }

  // SLIDE 5+: 메타 태그 (키워드 직후 — Title / OG Title / Canonical 은 첫 슬라이드에 묶음, 설명 필드는 이어서 · 넘치면 계속 슬라이드)
  {
    const META_BODY_TOP = 1.02;
    const META_BODY_MAX = 6.88;
    const cardX = 0.5;
    const cardW = 12;
    const innerX = 0.7;
    const textW = 11;
    const metaLabelFontPt = 12;
    const labelRowH = 0.36;
    const padT = 0.12;
    const padB = 0.16;
    const gapLabelToValue = 0.12;
    const betweenCards = 0.12;
    /** Tighter stack so Title + OG Title + Canonical stay on one slide when possible */
    const betweenHeadCards = 0.1;

    const addMetaSlideHeader = (continued: boolean) => {
      const slide = pptx.addSlide();
      slide.background = { color: BG };
      const t = continued ? R.metaTagsSlideTitle + R.pptAuditSectionContinued : R.metaTagsSlideTitle;
      slide.addText(t, {
        x: 0.5,
        y: 0.26,
        w: 12,
        h: 0.58,
        fontSize: 22,
        bold: true,
        color: TEXT,
        fontFace: "Arial",
        wrap: true,
      });
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.5,
        y: 0.88,
        w: 12,
        h: 0.03,
        fill: { color: SECTION_TITLE_RULE },
        line: { type: "none" },
      });
      return slide;
    };

    type MetaFieldRow = { label: string; value: string | null | undefined; required: boolean };

    const metaHeadItems: MetaFieldRow[] = [
      { label: R.metaLabelTitle, value: result.meta.title, required: true },
      { label: R.metaLabelOgTitle, value: result.meta.ogTitle, required: false },
      { label: R.metaLabelCanonical, value: result.meta.canonical, required: false },
    ];
    const metaTailItems: MetaFieldRow[] = [
      { label: R.metaLabelMetaDescription, value: result.meta.description, required: true },
      { label: R.metaLabelOgDescription, value: result.meta.ogDescription, required: false },
    ];

    const renderMetaCard = (
      item: MetaFieldRow,
      iy: number,
      s: ReturnType<typeof addMetaSlideHeader>
    ): void => {
      const present = !!item.value?.trim();
      const raw = item.value?.trim() ?? "";
      const displayValue = present
        ? raw.slice(0, 600) + (raw.length > 600 ? "…" : "")
        : R.metaUnset;
      const col = present ? "34D399" : item.required ? "F05C7A" : MUTED;
      const lineColor = present ? TEXT : col;
      const valueH = pptTextBoxHeightInchesI18n(displayValue, textW, 11, 1.52) + 0.2;
      const cardH = padT + labelRowH + gapLabelToValue + valueH + padB;

      s.addShape(pptx.ShapeType.roundRect, {
        x: cardX,
        y: iy,
        w: cardW,
        h: cardH,
        fill: { color: SURFACE },
        line: { color: present ? "1E3A2A" : item.required ? "3A1E24" : BORDER, pt: 1 },
        rectRadius: 0.1,
      });
      s.addText(`${item.label}${item.required ? R.metaRequiredMark : ""}`, {
        x: innerX,
        y: iy + padT,
        w: 6.2,
        h: labelRowH,
        fontSize: metaLabelFontPt,
        bold: true,
        color: MUTED,
        fontFace: "Arial",
        valign: "top",
      });
      s.addText(present ? R.metaPresent : R.metaAbsent, {
        x: 10.35,
        y: iy + padT,
        w: 2,
        h: labelRowH,
        fontSize: 10,
        color: col,
        align: "right",
        fontFace: "Arial",
        valign: "top",
      });
      s.addText(displayValue, {
        x: innerX,
        y: iy + padT + labelRowH + gapLabelToValue,
        w: textW,
        h: valueH,
        fontSize: 11,
        color: lineColor,
        fontFace: "Arial",
        wrap: true,
      });
    };

    const cardHeight = (item: MetaFieldRow): number => {
      const present = !!item.value?.trim();
      const raw = item.value?.trim() ?? "";
      const displayValue = present
        ? raw.slice(0, 600) + (raw.length > 600 ? "…" : "")
        : R.metaUnset;
      const valueH = pptTextBoxHeightInchesI18n(displayValue, textW, 11, 1.52) + 0.2;
      return padT + labelRowH + gapLabelToValue + valueH + padB;
    };

    let slideRef = addMetaSlideHeader(false);
    let y = META_BODY_TOP;

    for (let i = 0; i < metaHeadItems.length; i++) {
      const item = metaHeadItems[i]!;
      const h = cardHeight(item);
      const gapAfter = i < metaHeadItems.length - 1 ? betweenHeadCards : betweenCards;
      renderMetaCard(item, y, slideRef);
      y += h + gapAfter;
    }

    for (const item of metaTailItems) {
      const h = cardHeight(item);
      if (y + h > META_BODY_MAX) {
        slideRef = addMetaSlideHeader(true);
        y = META_BODY_TOP;
      }
      renderMetaCard(item, y, slideRef);
      y += h + betweenCards;
    }
  }

  // SLIDE 5b: 콘텐츠 개선 가이드 — 세로 순서: 요약 → 갭 → 우선작업 → 소제목 → 추천 블록(콘텐츠 보완 포인트 아래)
  if (result.recommendations?.actionPlan) {
    const rec = result.recommendations;
    const ap = rec.actionPlan;
    const actionGuideTitle = geoReportGuideTitle(result.pageType);
    const headingsLabel = geoReportHeadingsSectionLabel(result.pageType);
    const improvementSummaryLabel =
      result.pageType === "video"
        ? secKo.improvementSummaryVideo
        : result.pageType === "editorial" && result.reviewLike
          ? secKo.improvementSummaryReview
          : secKo.improvementSummary;
    const s = pptx.addSlide();
    s.background = { color: BG };
    /** Same title / rule / body top as 키워드·종합 GEO 점수 슬라이드 (line y=0.88, content ≈1.06). */
    s.addText(actionGuideTitle, { x: 0.5, y: 0.3, w: 12, h: 0.55, fontSize: 22, bold: true, color: TEXT, fontFace: "Arial", wrap: true });
    s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.88, w: 12, h: 0.03, fill: { color: SECTION_TITLE_RULE }, line: { type: "none" } });

    const bodyX = 0.65;
    const bodyW = 11.4;
    let iy = 1.06;

    const trendText = clipPptLine(rec.trendSummary, 320);
    if (trendText) {
      s.addText(improvementSummaryLabel, {
        x: bodyX,
        y: iy,
        w: bodyW,
        h: 0.26,
        fontSize: 10,
        bold: true,
        color: "A5B4FC",
        fontFace: "Arial",
      });
      iy += 0.3;
      const trendH = pptTextBoxHeightInches(trendText, bodyW, 10);
      s.addText(trendText, {
        x: bodyX,
        y: iy,
        w: bodyW,
        h: trendH,
        fontSize: 10,
        color: TEXT,
        fontFace: "Arial",
        wrap: true,
      });
      iy += trendH + 0.2;
    }

    const gapText = clipPptLine(rec.contentGapSummary, 400);
    if (gapText) {
      s.addText(secKo.contentGaps, {
        x: bodyX,
        y: iy,
        w: bodyW,
        h: 0.26,
        fontSize: 10,
        bold: true,
        color: "A5B4FC",
        fontFace: "Arial",
      });
      iy += 0.3;
      const gapH = pptTextBoxHeightInches(gapText, bodyW, 9);
      s.addText(gapText, {
        x: bodyX,
        y: iy,
        w: bodyW,
        h: gapH,
        fontSize: 9,
        color: MUTED,
        fontFace: "Arial",
        wrap: true,
      });
      iy += gapH + 0.22;
    }

    if (ap.priorityNotes && ap.priorityNotes.length > 0) {
      s.addText(secKo.priorityActions, {
        x: bodyX,
        y: iy,
        w: bodyW,
        h: 0.26,
        fontSize: 10,
        bold: true,
        color: "F5A623",
        fontFace: "Arial",
      });
      iy += 0.32;
      ap.priorityNotes.slice(0, 5).forEach((note, idx) => {
        const line = clipPptLine(note, 220);
        const numbered = `${idx + 1}. ${line}`;
        const nh = pptTextBoxHeightInches(numbered, bodyW - 0.15, 9);
        s.addText(numbered, {
          x: bodyX + 0.06,
          y: iy,
          w: bodyW - 0.12,
          h: nh,
          fontSize: 9,
          color: "F5D7A8",
          fontFace: "Arial",
          wrap: true,
        });
        iy += nh + 0.08;
      });
      iy += 0.12;
    }

    if (ap.suggestedHeadings.length > 0) {
      s.addText(headingsLabel, {
        x: bodyX,
        y: iy,
        w: bodyW,
        h: 0.28,
        fontSize: 11,
        bold: true,
        color: "5B6EF5",
        fontFace: "Arial",
      });
      iy += 0.34;
      const headingPad = 0.12;
      const headingInnerW = bodyW - 2 * headingPad;
      ap.suggestedHeadings.forEach((h) => {
        const line = `- ${h}`;
        const innerH = pptTextBoxHeightInchesI18n(line, headingInnerW, 10, 1.45) + 0.06;
        const boxH = innerH + 2 * headingPad;
        s.addShape(pptx.ShapeType.roundRect, {
          x: bodyX,
          y: iy,
          w: bodyW,
          h: boxH,
          fill: { color: SURFACE },
          line: { color: BORDER, pt: 1 },
          rectRadius: 0.1,
        });
        s.addText(line, {
          x: bodyX + headingPad,
          y: iy + headingPad,
          w: headingInnerW,
          h: innerH,
          fontSize: 10,
          color: TEXT,
          fontFace: "Arial",
          wrap: true,
        });
        iy += boxH + 0.1;
      });
      iy += 0.14;
    }

    if (ap.suggestedBlocks.length > 0) {
      s.addText(R.recommendedBlocks, {
        x: bodyX,
        y: iy,
        w: bodyW,
        h: 0.28,
        fontSize: 11,
        bold: true,
        color: "00D4C8",
        fontFace: "Arial",
      });
      iy += 0.34;
      const blockPad = 0.12;
      const blockInnerW = bodyW - 2 * blockPad;
      ap.suggestedBlocks.forEach((b) => {
        const line = `- ${b}`;
        const innerH = pptTextBoxHeightInchesI18n(line, blockInnerW, 10, 1.45) + 0.06;
        const boxH = innerH + 2 * blockPad;
        s.addShape(pptx.ShapeType.roundRect, {
          x: bodyX,
          y: iy,
          w: bodyW,
          h: boxH,
          fill: { color: SURFACE },
          line: { color: BORDER, pt: 1 },
          rectRadius: 0.1,
        });
        s.addText(line, {
          x: bodyX + blockPad,
          y: iy + blockPad,
          w: blockInnerW,
          h: innerH,
          fontSize: 10,
          color: TEXT,
          fontFace: "Arial",
          wrap: true,
        });
        iy += boxH + 0.1;
      });
    }
  }

  // SLIDE 6: 질문 커버리지 — AuditPanel과 동일 통합 목록(전체), Top3 중복 블록 없음
  const hasUserQuestions = result.searchQuestions && result.searchQuestions.length > 0;
  const hasAiQuestions =
    result.recommendations?.predictedQuestions && result.recommendations.predictedQuestions.length > 0;

  if (hasUserQuestions || hasAiQuestions) {
    const qs = result.questionSourceStatus;
    const hideUserSourceLabels = qs === "fallback_only" || qs === "tavily_failed";
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
      domain: q.source === "community" ? pptDomainFromUrl(q.url) : null,
    }));

    const aiItems = (result.recommendations?.predictedQuestions ?? []).map((q) => ({
      type: "ai" as const,
      text: q.question,
      isCovered: q.coveredByPage ?? false,
      isUncoveredTop3: uncoveredTop3Set.has(q.question),
      importanceReason: q.importanceReason,
    }));

    const all = [...userItems, ...aiItems].sort((a, b) => {
      const aTop = "isUncoveredTop3" in a && a.isUncoveredTop3 ? 1 : 0;
      const bTop = "isUncoveredTop3" in b && b.isUncoveredTop3 ? 1 : 0;
      return bTop - aTop;
    });

    const QC_TOP = 1.05;
    const QC_MAX = 6.88;
    const textW = 11.35;
    const leftX = 0.58;

    const addQuestionSlide = (continued: boolean) => {
      const slide = pptx.addSlide();
      slide.background = { color: BG };
      const ht = continued ? R.questionCoverageSlideHeading + R.pptAuditSectionContinued : R.questionCoverageSlideHeading;
      slide.addText(ht, {
        x: 0.5,
        y: 0.26,
        w: 12,
        h: 0.45,
        fontSize: 22,
        bold: true,
        color: TEXT,
        fontFace: "Arial",
        wrap: true,
      });
      slide.addText(R.questionCoverageSlideSubtitle, {
        x: 0.5,
        y: 0.76,
        w: 12,
        h: 0.32,
        fontSize: 9,
        color: MUTED,
        fontFace: "Arial",
        wrap: true,
      });
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.5,
        y: 1.12,
        w: 12,
        h: 0.03,
        fill: { color: SECTION_TITLE_RULE },
        line: { type: "none" },
      });
      return slide;
    };

    let qSlide = addQuestionSlide(false);
    let y = QC_TOP + 0.52;

    if (hideUserSourceLabels) {
      const wh = pptTextBoxHeightInchesI18n(R.pptQuestionCoverageExternalFailed, textW, 9, 1.45) + 0.1;
      qSlide.addText(R.pptQuestionCoverageExternalFailed, {
        x: leftX,
        y,
        w: textW,
        h: wh,
        fontSize: 9,
        color: "E8B4BF",
        fontFace: "Arial",
        wrap: true,
      });
      y += wh + 0.14;
    }

    const userTotal = result.searchQuestions?.length ?? 0;
    const aiTotal = result.recommendations?.predictedQuestions?.length ?? 0;
    const userCoveredCount = covered.filter(Boolean).length;
    const aiCoveredCount = (result.recommendations?.predictedQuestions ?? []).filter((q) => q.coveredByPage).length;
    const summaryLine = R.userVsAiAnswerLine(
      userTotal > 0 ? userCoveredCount : 0,
      userTotal,
      aiTotal > 0 ? aiCoveredCount : 0,
      aiTotal
    );
    const sumInnerH = pptTextBoxHeightInchesI18n(summaryLine, textW - 0.25, 10, 1.35) + 0.14;
    const sumBoxH = sumInnerH + 0.2;
    qSlide.addShape(pptx.ShapeType.roundRect, {
      x: 0.5,
      y,
      w: 12,
      h: sumBoxH,
      fill: { color: SURFACE },
      line: { color: BORDER, pt: 1 },
      rectRadius: 0.1,
    });
    qSlide.addText(summaryLine, {
      x: 0.65,
      y: y + 0.1,
      w: textW - 0.05,
      h: sumInnerH,
      fontSize: 10,
      bold: true,
      color: TEXT,
      fontFace: "Arial",
      wrap: true,
    });
    y += sumBoxH + 0.18;

    if (qs === "fallback_only" && userTotal > 0) {
      qSlide.addText(R.pptQuestionCoverageFallbackExamples, {
        x: leftX,
        y,
        w: textW,
        h: 0.24,
        fontSize: 10,
        color: MUTED,
        fontFace: "Arial",
      });
      y += 0.32;
    }

    let qIdx = 0;
    for (const item of all) {
      qIdx += 1;
      const isUncovered = item.type === "user" ? !item.isCovered : !item.isCovered;
      const borderCol =
        item.type === "ai" && item.isUncoveredTop3 && !item.isCovered
          ? "F05C7A"
          : !isUncovered
            ? "34D399"
            : item.type === "ai"
              ? "F5A623"
              : "F05C7A";

      const statusText =
        item.type === "user"
          ? item.isCovered
            ? "답변됨"
            : R.statusUncovered
          : item.isCovered
            ? "답변됨"
            : item.isUncoveredTop3
              ? R.statusPriorityFix
              : R.statusUncovered;

      const detailLines: string[] = [`${qIdx}. ${item.text}`];
      if (item.type === "user" && !hideUserSourceLabels) {
        detailLines.push(`  · ${SEARCH_SOURCE_LABEL_PPT[item.source] ?? item.source}`);
        if (item.refUrl)
          detailLines.push(`  · ${item.refUrl.replace(/^https?:\/\//, "").slice(0, 200)}${item.refUrl.length > 200 ? "…" : ""}`);
        if (item.domain) detailLines.push(`  · ${item.domain}`);
      }
      if (item.type === "ai" && item.importanceReason?.trim()) {
        detailLines.push(`  · ${item.importanceReason.trim()}`);
      }

      const blockText = detailLines.join("\n");
      const cardRight = 0.5 + 12;
      const chipPad = 0.12;
      const chipH = 0.28;
      const chipW = Math.min(2.35, Math.max(1.2, statusText.length * 0.11 + 0.45));
      const chipX = cardRight - chipPad - chipW;
      const bodyTextW = chipX - leftX - 0.1;
      const cardInnerH = pptTextBoxHeightInchesI18n(blockText, bodyTextW, 9, 1.48) + 0.18;
      const cardH = cardInnerH + 0.22;
      if (y + cardH > QC_MAX) {
        qSlide = addQuestionSlide(true);
        y = QC_TOP + 0.1;
      }
      qSlide.addShape(pptx.ShapeType.roundRect, {
        x: 0.5,
        y,
        w: 12,
        h: cardH,
        fill: { color: SURFACE },
        line: { color: borderCol, pt: 1 },
        rectRadius: 0.08,
      });
      qSlide.addShape(pptx.ShapeType.roundRect, {
        x: chipX,
        y: y + 0.08,
        w: chipW,
        h: chipH,
        fill: { color: borderCol, transparency: 78 },
        line: { type: "none" },
        rectRadius: 0.06,
      });
      qSlide.addText(statusText, {
        x: chipX,
        y: y + 0.08,
        w: chipW,
        h: chipH,
        fontSize: statusText.length > 8 ? 6.5 : 7.5,
        bold: true,
        color: TEXT,
        align: "center",
        fontFace: "Arial",
        valign: "middle",
        wrap: true,
      });
      qSlide.addText(blockText, {
        x: leftX,
        y: y + 0.1,
        w: bodyTextW,
        h: cardInnerH,
        fontSize: 9,
        color: TEXT,
        fontFace: "Arial",
        wrap: true,
      });
      y += cardH + 0.12;
    }
  }

  // SLIDE 7: 황금 문단 (인용 확률 TOP 3)
  if (result.chunkCitations && result.chunkCitations.length > 0) {
    const s = pptx.addSlide();
    s.background = { color: BG };
    s.addText(R.goldenParagraphsTitle, { x: 0.5, y: 0.3, w: 12, h: 0.55, fontSize: 22, bold: true, color: TEXT, fontFace: "Arial" });
    s.addText(R.goldenParagraphsSubtitle, { x: 0.5, y: 0.82, w: 12, h: 0.3, fontSize: 10, color: MUTED, fontFace: "Arial" });
    s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.12, w: 12, h: 0.03, fill: { color: SECTION_TITLE_RULE }, line: { type: "none" } });

    const golden = [...result.chunkCitations].sort((a, b) => b.score - a.score).slice(0, 3);
    const rankColors = ["FBBF24", "A78BFA", "34D399"];
    golden.forEach((chunk, i) => {
      const col = rankColors[i] ?? MUTED;
      const iy = 1.3 + i * 1.6;
      s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: iy, w: 12, h: 1.45, fill: { color: SURFACE }, line: { color: col, pt: 1.5 }, rectRadius: 0.12 });
      s.addShape(pptx.ShapeType.roundRect, { x: 0.6, y: iy + 0.12, w: 0.45, h: 0.4, fill: { color: col }, line: { type: "none" }, rectRadius: 0.1 });
      s.addText(`#${i + 1}`, { x: 0.6, y: iy + 0.15, w: 0.45, h: 0.35, fontSize: 14, bold: true, color: "0A0F1A", align: "center", fontFace: "Arial" });
      s.addText(R.citationChunkScore(chunk.score), { x: 1.2, y: iy + 0.18, w: 2, h: 0.3, fontSize: 10, color: col, fontFace: "Arial" });
      s.addText(chunk.text.slice(0, 120) + (chunk.text.length > 120 ? "…" : ""), { x: 0.6, y: iy + 0.58, w: 11.6, h: 0.45, fontSize: 10, color: TEXT, fontFace: "Arial", wrap: true });
      if (chunk.reason) s.addText(chunk.reason.slice(0, 80) + (chunk.reason.length > 80 ? "…" : ""), { x: 0.6, y: iy + 1.1, w: 11.6, h: 0.3, fontSize: 9, color: MUTED, fontFace: "Arial", italic: true, wrap: true });
    });
  }

  // Closing slide: end marker only (no 개선 권고 / 결론 본문)
  {
    const s = pptx.addSlide();
    s.background = { color: BG };
    s.addText(R.pptLastPageMarker, {
      x: 0.5,
      y: 3.15,
      w: 12,
      h: 0.55,
      fontSize: 16,
      color: MUTED,
      align: "center",
      fontFace: "Arial",
    });
  }

  const domain = result.url.replace(/https?:\/\//, "").split("/")[0].replace(/\./g, "_");
  const dateStr = new Date().toISOString().slice(0, 10);
  await pptx.writeFile({ fileName: `GEO_Report_${domain}_${dateStr}.pptx` });
}
