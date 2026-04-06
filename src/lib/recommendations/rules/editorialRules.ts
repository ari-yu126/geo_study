import type { RecommendationContext } from '../recommendationContext';
import { collectEditorialStyleBlocks, collectEditorialStyleHeadings } from './axisRules';

/**
 * Editorial page: headings/blocks are fully determined by axisRules + reviewLike.
 */
export function buildEditorialHeadingsAndBlocks(ctx: RecommendationContext): {
  headings: { text: string; sources: string[] }[];
  blocks: { text: string; sources: string[] }[];
} {
  return {
    headings: collectEditorialStyleHeadings(ctx),
    blocks: collectEditorialStyleBlocks(ctx),
  };
}
