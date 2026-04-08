import type { GeoAxis, GeoAxisScores, PageType } from '../../analysisTypes';
import type { RecommendationContext } from '../recommendationContext';
import { ko } from '../templates/ko';
import { en } from '../templates/en';

export const AXIS_LOW_THRESHOLD = 50;

/** Top gaps only: readability → FAQ/answers → search questions in headings → evidence → trust → structure → (video) description */
const GAP_AXIS_PRIORITY: GeoAxis[] = [
  'paragraph',
  'questionCoverage',
  'questionMatch',
  'citation',
  'trust',
  'structure',
  'videoMetadata',
];

export const MAX_CONTENT_GAPS = 3;
export const MAX_PRIORITY_ACTIONS = 3;

/** Same story as gaps, plus answerability after opening; caps at MAX_PRIORITY_ACTIONS */
const PRIORITY_AXIS_ORDER: GeoAxis[] = [
  'paragraph',
  'answerability',
  'questionCoverage',
  'questionMatch',
  'citation',
  'trust',
  'structure',
  'videoMetadata',
];

export function isAxisLow(scores: GeoAxisScores | null, axis: GeoAxis): boolean {
  if (!scores) return false;
  const v = scores[axis];
  return typeof v === 'number' && v < AXIS_LOW_THRESHOLD;
}

type T = typeof ko;

function Tmpl(ctx: RecommendationContext): T {
  return ctx.locale === 'ko' ? ko : en;
}

function gapLineForAxis(t: T, axis: GeoAxis): string | null {
  const g = t.gap;
  switch (axis) {
    case 'paragraph':
      return g.paragraph;
    case 'structure':
      return g.structure;
    case 'questionCoverage':
      return g.questionCoverage;
    case 'questionMatch':
      return g.questionMatch;
    case 'citation':
      return g.citation;
    case 'trust':
      return g.trust;
    case 'videoMetadata':
      return g.videoMetadata;
    default:
      return null;
  }
}

function gapAxesForPage(pageType: PageType | undefined): GeoAxis[] {
  const skipVideoMeta = pageType !== 'video';
  return GAP_AXIS_PRIORITY.filter((a) => !(skipVideoMeta && a === 'videoMetadata'));
}

/** At most MAX_CONTENT_GAPS items, in priority order (problem statements only). */
export function collectAxisGapParts(ctx: RecommendationContext): { text: string; sources: string[] }[] {
  const t = Tmpl(ctx);
  const parts: { text: string; sources: string[] }[] = [];
  const s = ctx.axisScores;

  for (const axis of gapAxesForPage(ctx.pageType)) {
    if (parts.length >= MAX_CONTENT_GAPS) break;
    if (!isAxisLow(s, axis)) continue;
    const text = gapLineForAxis(t, axis);
    if (text) parts.push({ text, sources: [`axis:${axis}`] });
  }

  return parts;
}

function priorityLineForAxis(t: T, axis: GeoAxis): string | null {
  const p = t.priority;
  switch (axis) {
    case 'paragraph':
      return p.paragraph;
    case 'structure':
      return p.structure;
    case 'answerability':
      return p.answerability;
    case 'questionCoverage':
      return p.questionCoverage;
    case 'questionMatch':
      return p.questionMatch;
    case 'citation':
      return p.citation;
    case 'trust':
      return p.trust;
    case 'videoMetadata':
      return p.videoMetadata;
    default:
      return null;
  }
}

function priorityAxesForPage(pageType: PageType | undefined): GeoAxis[] {
  const skipVideoMeta = pageType !== 'video';
  return PRIORITY_AXIS_ORDER.filter((a) => !(skipVideoMeta && a === 'videoMetadata'));
}

/** At most MAX_PRIORITY_ACTIONS to-dos, same narrative order as gaps + answerability. */
export function collectAxisPriorityNotes(ctx: RecommendationContext): { text: string; sources: string[] }[] {
  const t = Tmpl(ctx);
  const out: { text: string; sources: string[] }[] = [];
  const s = ctx.axisScores;

  for (const axis of priorityAxesForPage(ctx.pageType)) {
    if (out.length >= MAX_PRIORITY_ACTIONS) break;
    if (!isAxisLow(s, axis)) continue;
    const text = priorityLineForAxis(t, axis);
    if (text) out.push({ text, sources: [`axis:${axis}`] });
  }

  return out;
}

/** Editorial / shared: headings driven only by allowed signals. */
export function collectEditorialStyleHeadings(ctx: RecommendationContext): { text: string; sources: string[] }[] {
  const t = Tmpl(ctx);
  const out: { text: string; sources: string[] }[] = [];
  const s = ctx.axisScores;
  const uncovered = ctx.uncoveredQuestions.length > 0;

  if (isAxisLow(s, 'questionCoverage') || uncovered) {
    out.push({
      text: t.headings.faq,
      sources: uncovered ? ['signal:uncovered_questions'] : ['axis:questionCoverage'],
    });
  }
  if (isAxisLow(s, 'structure')) {
    out.push({ text: t.headings.summary, sources: ['axis:structure'] });
  }
  if (isAxisLow(s, 'answerability')) {
    out.push({ text: t.headings.answerFirst, sources: ['axis:answerability'] });
  }
  if (isAxisLow(s, 'questionMatch')) {
    out.push({ text: t.headings.compare, sources: ['axis:questionMatch'] });
  }
  if (
    ctx.contentQuality &&
    !ctx.contentQuality.hasStepStructure &&
    (isAxisLow(s, 'structure') || isAxisLow(s, 'answerability'))
  ) {
    const howToSrc: string[] = ['signal:contentQuality.hasStepStructure:false'];
    if (isAxisLow(s, 'structure')) howToSrc.push('axis:structure');
    if (isAxisLow(s, 'answerability')) howToSrc.push('axis:answerability');
    out.push({ text: t.headings.howTo, sources: howToSrc });
  }
  if (isAxisLow(s, 'trust')) {
    out.push({ text: t.headings.caveats, sources: ['axis:trust'] });
  }

  if (ctx.reviewSignals.reviewLike) {
    out.push(
      { text: t.headings.prosCons, sources: ['signal:reviewLike'] },
      { text: t.headings.verdict, sources: ['signal:reviewLike'] },
      { text: t.headings.compareCriteria, sources: ['signal:reviewLike'] }
    );
  }

  return out;
}

/** Blocks driven by axis + reviewLike (not hasReviewSchema alone). */
export function collectEditorialStyleBlocks(ctx: RecommendationContext): { text: string; sources: string[] }[] {
  const t = Tmpl(ctx);
  const out: { text: string; sources: string[] }[] = [];
  const s = ctx.axisScores;
  const nUnc = ctx.uncoveredQuestions.length;

  if (isAxisLow(s, 'questionCoverage') || nUnc > 0) {
    out.push({
      text: nUnc > 0 ? t.blocks.faqUncovered(nUnc) : t.blocks.faqGeneric,
      sources: nUnc > 0 ? ['signal:uncovered_questions'] : ['axis:questionCoverage'],
    });
  }
  if (isAxisLow(s, 'paragraph')) {
    out.push({ text: t.blocks.topSummary, sources: ['axis:paragraph'] });
  }
  if (isAxisLow(s, 'citation')) {
    out.push({ text: t.blocks.citationParagraph, sources: ['axis:citation'] });
  }
  if (isAxisLow(s, 'structure')) {
    out.push({ text: t.blocks.summaryBullets, sources: ['axis:structure'] });
  }
  if (isAxisLow(s, 'trust')) {
    out.push({ text: t.blocks.trustChecklist, sources: ['axis:trust'] });
  }

  if (ctx.reviewSignals.reviewLike) {
    out.push(
      { text: t.blocks.prosCons, sources: ['signal:reviewLike'] },
      { text: t.blocks.verdict, sources: ['signal:reviewLike'] }
    );
  }

  return out;
}
