import type {
  GeoPredictedQuestion,
  GeoRecommendationTrace,
  GeoRecommendationTraceEntry,
  GeoRecommendations,
} from '../analysisTypes';
import { refineEditorialTrendSummaryForSubtype, refineGeminiEditorialTrendSummary } from '../geoExplain/editorialSubtypeWording';
import type { RecommendationContext } from './recommendationContext';
import {
  collectAxisGapParts,
  collectAxisPriorityNotes,
  MAX_CONTENT_GAPS,
  MAX_PRIORITY_ACTIONS,
} from './rules/axisRules';
import { buildEditorialHeadingsAndBlocks } from './rules/editorialRules';
import { buildCommerceHeadingsAndBlocks } from './rules/commerceRules';
import { buildVideoHeadingsAndBlocks } from './rules/videoRules';
import { ko } from './templates/ko';
import { en } from './templates/en';

function Tmpl(ctx: RecommendationContext) {
  return ctx.locale === 'ko' ? ko : en;
}

function uniqCapStrings(arr: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const k = x.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
    if (out.length >= max) break;
  }
  return out;
}

function appendTrace(
  entries: GeoRecommendationTraceEntry[],
  target: GeoRecommendationTraceEntry['target'],
  sources: string[]
): void {
  if (sources.length === 0) return;
  entries.push({ target, sources: [...new Set(sources)] });
}

/**
 * Deterministic content guide: internal analysis inputs → user-facing recommendations (no score copy).
 * Trace entries use internal ids for debugging only; strings shown in UI come from templates.
 */
export function buildGeoRecommendationsFromSignals(ctx: RecommendationContext): GeoRecommendations {
  const t = Tmpl(ctx);
  const entries: GeoRecommendationTraceEntry[] = [];

  let trendSummary: string;
  if (ctx.limitedAnalysis) {
    trendSummary = t.trend.limited;
    appendTrace(entries, 'trendSummary', ['signal:limitedAnalysis']);
  } else if (ctx.uncoveredQuestions.length > 0) {
    trendSummary = t.trend.uncovered;
    appendTrace(entries, 'trendSummary', ['signal:uncovered_questions']);
  } else if (ctx.geoOpportunities.length > 0) {
    trendSummary = t.trend.opportunities(ctx.geoOpportunities.length);
    appendTrace(
      entries,
      'trendSummary',
      ctx.geoOpportunities.slice(0, 8).map((o) => `opportunity:${o.id}`)
    );
  } else if (ctx.geoIssues.length > 0) {
    trendSummary = t.trend.issues(ctx.geoIssues.length);
    appendTrace(entries, 'trendSummary', ctx.geoIssues.slice(0, 8).map((i) => `issue:${i.id}`));
  } else {
    trendSummary = t.trend.neutral;
    appendTrace(entries, 'trendSummary', ['rule:neutral']);
  }

  if (ctx.pageType === 'editorial' && ctx.editorialSubtype) {
    if (ctx.locale === 'ko') {
      trendSummary = refineEditorialTrendSummaryForSubtype(trendSummary, ctx.editorialSubtype);
    } else {
      trendSummary = refineGeminiEditorialTrendSummary(trendSummary, ctx.editorialSubtype);
    }
    appendTrace(entries, 'trendSummary', [`editorialSubtype:${ctx.editorialSubtype}`]);
  }

  const gapAxisParts = collectAxisGapParts(ctx);
  const gapTexts = gapAxisParts.map((p) => p.text);
  gapAxisParts.forEach((p) => appendTrace(entries, 'contentGapSummary', p.sources));

  /** Problem-only lines (max MAX_CONTENT_GAPS); optional issue-list note only if room left. */
  let contentGapSummary = gapTexts.map((line) => `- ${line}`).join('\n').trim();
  const gapLineCount = gapTexts.length;
  if (ctx.geoIssues.length > 0) {
    if (gapLineCount < MAX_CONTENT_GAPS) {
      const footer = t.gap.issuesFooter(ctx.geoIssues.length);
      contentGapSummary = contentGapSummary ? `${contentGapSummary}\n- ${footer}` : `- ${footer}`;
    }
    appendTrace(
      entries,
      'contentGapSummary',
      ctx.geoIssues.slice(0, 8).map((i) => `issue:${i.id}`)
    );
  }
  if (!contentGapSummary) {
    contentGapSummary =
      ctx.locale === 'ko'
        ? '추가로 짚을 만한 빈칸은 많지 않습니다. 본문과 질문이 더 보이면 구체적인 팁을 드릴 수 있습니다.'
        : 'Not much seems missing beyond what follows. More page text and questions will allow sharper tips.';
    appendTrace(entries, 'contentGapSummary', ['rule:gap_fallback']);
  }

  let headingItems: { text: string; sources: string[] }[] = [];
  let blockItems: { text: string; sources: string[] }[] = [];

  if (ctx.pageType === 'video') {
    const v = buildVideoHeadingsAndBlocks(ctx);
    headingItems = v.headings;
    blockItems = v.blocks;
  } else if (ctx.pageType === 'commerce') {
    const c = buildCommerceHeadingsAndBlocks(ctx);
    headingItems = c.headings;
    blockItems = c.blocks;
  } else {
    const e = buildEditorialHeadingsAndBlocks(ctx);
    headingItems = e.headings;
    blockItems = e.blocks;
  }

  headingItems.forEach((h, i) =>
    entries.push({ target: 'heading', index: i, sources: h.sources })
  );
  blockItems.forEach((b, i) => entries.push({ target: 'block', index: i, sources: b.sources }));

  /** Single source of truth for to-dos: low axes → action lines (no issue/opportunity duplicates). */
  const priorityParts: { text: string; sources: string[] }[] = [...collectAxisPriorityNotes(ctx)];
  const priorityNotes = uniqCapStrings(
    priorityParts.map((p) => p.text),
    MAX_PRIORITY_ACTIONS
  );
  priorityParts.forEach((p, i) => {
    if (priorityNotes.includes(p.text)) {
      entries.push({ target: 'priorityNote', index: i, sources: p.sources });
    }
  });

  const texts = ctx.uncoveredQuestions.map((q) => q.text).filter(Boolean);
  const top6 = texts.slice(0, 6);
  const predictedQuestions: GeoPredictedQuestion[] = top6.slice(0, 5).map((q, i) => ({
    question: q,
    importanceReason: t.predictedReason,
    coveredByPage: false,
    isTopGap: i < 3,
  }));
  const predictedUncoveredTop3 = predictedQuestions.filter((_, i) => i < 3);
  if (predictedQuestions.length > 0) {
    appendTrace(entries, 'predictedQuestions', ['signal:uncovered_questions']);
  }

  const trace: GeoRecommendationTrace = {
    locale: ctx.locale,
    reviewCategory: 'none',
    reviewCategoryConfidence: 'low',
    entries,
  };

  return {
    trendSummary,
    contentGapSummary,
    actionPlan: {
      suggestedHeadings: uniqCapStrings(
        headingItems.map((h) => h.text),
        14
      ),
      suggestedBlocks: uniqCapStrings(
        blockItems.map((b) => b.text),
        12
      ),
      priorityNotes: priorityNotes.length > 0 ? priorityNotes : undefined,
    },
    predictedQuestions: predictedQuestions.length > 0 ? predictedQuestions : undefined,
    predictedUncoveredTop3: predictedUncoveredTop3.length > 0 ? predictedUncoveredTop3 : undefined,
    isTemplateFallback: false,
    trace,
  };
}
