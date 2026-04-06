import type { RecommendationContext } from '../recommendationContext';
import { isAxisLow } from './axisRules';
import { ko } from '../templates/ko';
import { en } from '../templates/en';

function Tmpl(ctx: RecommendationContext) {
  return ctx.locale === 'ko' ? ko : en;
}

function videoMetadataWeak(ctx: RecommendationContext): boolean {
  const s = ctx.axisScores;
  return (
    isAxisLow(s, 'videoMetadata') ||
    ctx.geoIssues.some((i) => i.axis === 'videoMetadata') ||
    ctx.geoOpportunities.some((o) => o.improvesAxis === 'videoMetadata')
  );
}

/**
 * Video: chapters/pinned only when video metadata signals are weak; FAQ from questions/axis.
 */
export function buildVideoHeadingsAndBlocks(ctx: RecommendationContext): {
  headings: { text: string; sources: string[] }[];
  blocks: { text: string; sources: string[] }[];
} {
  const t = Tmpl(ctx);
  const headings: { text: string; sources: string[] }[] = [];
  const blocks: { text: string; sources: string[] }[] = [];
  const s = ctx.axisScores;
  const nUnc = ctx.uncoveredQuestions.length;
  const vm = videoMetadataWeak(ctx);

  if (vm) {
    headings.push(
      { text: t.headings.videoChapters, sources: ['axis:videoMetadata'] },
      { text: t.headings.videoPinned, sources: ['axis:videoMetadata'] }
    );
    blocks.push({ text: t.blocks.videoChapters, sources: ['axis:videoMetadata'] });
  }

  if (nUnc > 0 || isAxisLow(s, 'questionCoverage') || isAxisLow(s, 'questionMatch')) {
    const src =
      nUnc > 0
        ? ['signal:uncovered_questions']
        : ['axis:questionCoverage', 'axis:questionMatch'].filter((a) =>
            a === 'axis:questionCoverage' ? isAxisLow(s, 'questionCoverage') : isAxisLow(s, 'questionMatch')
          );
    headings.push({ text: t.headings.videoFaq, sources: src.length > 0 ? src : ['axis:questionCoverage'] });
    blocks.push({
      text: nUnc > 0 ? t.blocks.faqUncovered(nUnc) : t.blocks.videoFaq,
      sources: nUnc > 0 ? ['signal:uncovered_questions'] : ['axis:questionCoverage'],
    });
  }

  if (isAxisLow(s, 'trust')) {
    headings.push({ text: t.headings.caveats, sources: ['axis:trust'] });
    blocks.push({ text: t.blocks.trustChecklist, sources: ['axis:trust'] });
  }

  return { headings, blocks };
}
