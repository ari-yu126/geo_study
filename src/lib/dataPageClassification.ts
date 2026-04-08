/**
 * data-heavy / isDataPage classification for answerability routing and structure bonuses.
 * Hosted editorial blogs use stricter thresholds so a single table or list+price does not
 * trigger legacy answerability + 65pt floor (see runAnalysis).
 */

import type { ContentQuality, PageType, PlatformType } from './analysisTypes';
import { detectHostingPlatform } from './platformDetection';
import { isHostedBlogPlatform } from './geoExplain/platformIssueWording';

/** Self-hosted / non–hosted-blog editorial: require stronger DOM data signals than 0.3 (one table). */
export const DATA_DENSITY_THRESHOLD_DEFAULT = 0.45;

/** Naver/Tistory/Brunch/WordPress.com editorials: only data-dense posts or Product JSON-LD qualify. */
export const DATA_DENSITY_THRESHOLD_HOSTED_BLOG_EDITORIAL = 0.65;

export function computeDataDensity(contentQuality: ContentQuality): number {
  const cq = contentQuality;
  return (
    (cq.tableCount > 0 ? 1 : 0) * 0.3 +
    (cq.listCount >= 1 ? 1 : 0) * 0.25 +
    ((cq.productSpecBlockCount ?? 0) >= 1 ? 1 : 0) * 0.25 +
    (cq.hasPriceInfo ? 1 : 0) * 0.2
  );
}

/** Product / ItemList+Product JSON-LD — excludes Offer-Aggregate-only noise common on blogs. */
export function hasStructuredProductJsonLd(contentQuality: ContentQuality): boolean {
  const cq = contentQuality;
  return !!(cq.hasJsonLdProduct || cq.hasJsonLdProductInListContext || cq.hasJsonLdStandaloneProduct);
}

export function classifyDataPageAndHosting(params: {
  url: string;
  normalizedUrl: string;
  pageType: PageType;
  contentQuality: ContentQuality;
  /** From htmlAnalyzer: Product | ItemList | Offer/Aggregate OR */
  hasProductSchemaBroad: boolean;
}): { isDataPage: boolean; dataDensity: number; platform: PlatformType } {
  const isDanawa = params.url.includes('danawa.com');
  const platform = detectHostingPlatform(params.normalizedUrl, { pageType: params.pageType });
  const dataDensity = computeDataDensity(params.contentQuality);
  const hostedBlogEditorial = isHostedBlogPlatform(platform) && params.pageType === 'editorial';

  let isDataPage: boolean;
  if (hostedBlogEditorial) {
    isDataPage =
      isDanawa ||
      hasStructuredProductJsonLd(params.contentQuality) ||
      dataDensity >= DATA_DENSITY_THRESHOLD_HOSTED_BLOG_EDITORIAL;
  } else {
    isDataPage =
      isDanawa ||
      params.hasProductSchemaBroad ||
      dataDensity >= DATA_DENSITY_THRESHOLD_DEFAULT;
  }

  return { isDataPage, dataDensity, platform };
}
