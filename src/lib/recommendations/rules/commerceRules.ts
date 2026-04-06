import type { RecommendationContext } from '../recommendationContext';
import { isAxisLow } from './axisRules';
import { ko } from '../templates/ko';
import { en } from '../templates/en';
import {
  collectEditorialStyleBlocks,
  collectEditorialStyleHeadings,
} from './axisRules';

function Tmpl(ctx: RecommendationContext) {
  return ctx.locale === 'ko' ? ko : en;
}

/**
 * Commerce: same axis-driven core as editorial, plus policy/spec only when a signal demands it.
 * No pageType-only dumps.
 */
export function buildCommerceHeadingsAndBlocks(ctx: RecommendationContext): {
  headings: { text: string; sources: string[] }[];
  blocks: { text: string; sources: string[] }[];
} {
  const t = Tmpl(ctx);
  const base = {
    headings: collectEditorialStyleHeadings(ctx),
    blocks: collectEditorialStyleBlocks(ctx),
  };
  const s = ctx.axisScores;
  const headings = [...base.headings];
  const blocks = [...base.blocks];

  const needPolicy =
    isAxisLow(s, 'trust') ||
    ctx.geoIssues.some((i) => i.axis === 'trust') ||
    ctx.geoOpportunities.some((o) => o.improvesAxis === 'trust');

  if (needPolicy) {
    headings.push({
      text: t.headings.commercePolicy,
      sources: ['rule:commerce_policy', ...(isAxisLow(s, 'trust') ? ['axis:trust'] : [])],
    });
    blocks.push({
      text: t.blocks.commercePolicy,
      sources: ['rule:commerce_policy'],
    });
  }

  const needSpec =
    isAxisLow(s, 'citation') ||
    isAxisLow(s, 'structure') ||
    ctx.geoIssues.some((i) => i.axis === 'citation' || i.axis === 'structure') ||
    ctx.geoOpportunities.some((o) => o.improvesAxis === 'citation' || o.improvesAxis === 'structure');

  if (needSpec) {
    headings.push({
      text: t.headings.commerceSpec,
      sources: [
        'rule:commerce_spec',
        ...(isAxisLow(s, 'citation') ? ['axis:citation'] : []),
        ...(isAxisLow(s, 'structure') ? ['axis:structure'] : []),
      ],
    });
    blocks.push({
      text: t.blocks.commerceSpecTable,
      sources: ['rule:commerce_spec'],
    });
  }

  return { headings, blocks };
}
