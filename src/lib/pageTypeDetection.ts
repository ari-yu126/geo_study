/**
 * Page type detection (editorial vs commerce vs video).
 * Heuristics are tuned so ranking/review/comparison editorial pages (e.g. RTINGS best-of)
 * are not misclassified as commerce based on ItemList JSON-LD or affiliate links alone.
 */

import type { AnalysisMeta, ContentQuality, GeoScoringConfig } from './analysisTypes';
import { isYouTubeUrl } from './youtubeMetadataExtractor';

/** Commerce classification threshold (raised so weak signal stacks alone rarely qualify). */
const COMMERCE_SCORE_THRESHOLD = 8;

export function computeEditorialComparisonScore(
  meta: AnalysisMeta | undefined,
  headings: string[],
  contentSnippet: string,
  url?: string
): number {
  const titleBits = [meta?.title, meta?.description, meta?.ogTitle, meta?.ogDescription]
    .filter(Boolean)
    .join(' ');
  const blob = `${titleBits} ${headings.join(' ')} ${contentSnippet.slice(0, 14000)}`;
  const lower = blob.toLowerCase();
  let s = 0;
  if (url && /\/(reviews?|best|top|ranking|compare|versus|vs)[\/-]/i.test(url)) s += 2;
  if (/\b(best|top\s*\d|#\s*\d|#\d|rankings?|roundup|buying guide)\b/i.test(blob)) s += 2;
  if (/\b(reviews?|reviewed|tested|our picks|editors?'?s? pick)\b/i.test(blob)) s += 2;
  if (/\b(vs\.?|versus|compared|comparison|head[- ]?to[- ]?head)\b/i.test(blob)) s += 2;
  if (/\b(methodology|how we test|test bench|scoring|we (buy|test|measure|compare)|lab test)\b/i.test(lower)) s += 2;
  if (/\b(recommended|alternatives|runners?[- ]?up|the best)\b/i.test(lower)) s += 1;
  return Math.min(10, s);
}

function computeJsonLdCommercePoints(cq: ContentQuality): number {
  if (cq.hasJsonLdStandaloneProduct) return 4;
  if (cq.hasJsonLdProductInListContext) return 1;
  if (cq.hasJsonLdItemList && !cq.hasJsonLdProduct) return 1;
  return 0;
}

function computeOfferPoints(cq: ContentQuality): number {
  if (!cq.hasJsonLdOfferOrAggregate) return 0;
  if (cq.hasJsonLdStandaloneProduct) return 1;
  return 0;
}

export interface PageTypeDetectionLog {
  finalPageType: 'editorial' | 'commerce' | 'video';
  commerceScoreRaw: number;
  editorialComparisonScore: number;
  hasProductSchemaLegacy: boolean;
  productSchemaTypesFound: string[];
  hasItemListOnly: boolean;
  priceMatchCount: number;
  buyButtonCount: number;
  repeatedProductCardCount: number;
  commerceKeywordCount: number;
  hasJsonLdStandaloneProduct: boolean;
  hasJsonLdProductInListContext: boolean;
  methodologyOrComparisonSignals: boolean;
  editorialProtectionOverrodeCommerce: boolean;
  commerceThreshold: number;
}

/**
 * Returns page type and a structured log line for debugging.
 */
export function detectPageTypeWithLog(
  url: string,
  config: GeoScoringConfig,
  args: {
    meta?: AnalysisMeta;
    headings: string[];
    contentSnippet: string;
    contentQuality?: ContentQuality;
    /** Broad legacy flag: Product | ItemList | Offer in JSON-LD (scoring / features) */
    hasProductSchemaLegacy: boolean;
  }
): { pageType: 'editorial' | 'commerce' | 'video'; log: PageTypeDetectionLog } {
  const { meta, headings, contentSnippet, contentQuality: cqIn, hasProductSchemaLegacy } = args;
  const cq = cqIn ?? ({} as ContentQuality);

  if (isYouTubeUrl(url)) {
    const log: PageTypeDetectionLog = {
      finalPageType: 'video',
      commerceScoreRaw: 0,
      editorialComparisonScore: 0,
      hasProductSchemaLegacy,
      productSchemaTypesFound: cq.jsonLdProductTypesFound ?? [],
      hasItemListOnly: false,
      priceMatchCount: cq.priceMatchCount ?? 0,
      buyButtonCount: cq.buyButtonCount ?? 0,
      repeatedProductCardCount: cq.repeatedProductCardCount ?? 0,
      commerceKeywordCount: cq.commerceKeywordCount ?? 0,
      hasJsonLdStandaloneProduct: cq.hasJsonLdStandaloneProduct ?? false,
      hasJsonLdProductInListContext: cq.hasJsonLdProductInListContext ?? false,
      methodologyOrComparisonSignals: false,
      editorialProtectionOverrodeCommerce: false,
      commerceThreshold: COMMERCE_SCORE_THRESHOLD,
    };
    return { pageType: 'video', log };
  }

  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return '';
    }
  })();

  const commerceDomains = config.commerceDomains ?? [
    'coupang.com',
    'amazon.',
    'gmarket.co.kr',
    '11st.co.kr',
    'auction.co.kr',
    'danawa.com',
  ];

  if (commerceDomains.some((d) => host.includes(d))) {
    const log: PageTypeDetectionLog = {
      finalPageType: 'commerce',
      commerceScoreRaw: COMMERCE_SCORE_THRESHOLD,
      editorialComparisonScore: 0,
      hasProductSchemaLegacy,
      productSchemaTypesFound: cq.jsonLdProductTypesFound ?? [],
      hasItemListOnly: !!(cq.hasJsonLdItemList && !cq.hasJsonLdProduct),
      priceMatchCount: cq.priceMatchCount ?? 0,
      buyButtonCount: cq.buyButtonCount ?? 0,
      repeatedProductCardCount: cq.repeatedProductCardCount ?? 0,
      commerceKeywordCount: cq.commerceKeywordCount ?? 0,
      hasJsonLdStandaloneProduct: cq.hasJsonLdStandaloneProduct ?? false,
      hasJsonLdProductInListContext: cq.hasJsonLdProductInListContext ?? false,
      methodologyOrComparisonSignals: false,
      editorialProtectionOverrodeCommerce: false,
      commerceThreshold: COMMERCE_SCORE_THRESHOLD,
    };
    return { pageType: 'commerce', log };
  }

  const editorialComparisonScore = computeEditorialComparisonScore(meta, headings, contentSnippet, url);
  const strongEditorial = editorialComparisonScore >= 5;

  let commerceScore = 0;

  commerceScore += computeJsonLdCommercePoints(cq);
  commerceScore += computeOfferPoints(cq);

  if (cq.hasOgProductType) commerceScore += 2;

  const priceMatchCount = cq.priceMatchCount ?? 0;
  if (priceMatchCount > 0) {
    commerceScore += strongEditorial ? 1 : 2;
  }

  const buyButtonCount = cq.buyButtonCount ?? 0;
  if (buyButtonCount > 0) {
    commerceScore += strongEditorial ? 1 : 3;
  }

  const specBlocks = cq.productSpecBlockCount ?? 0;
  if (specBlocks > 0) {
    commerceScore += strongEditorial ? 1 : 2;
  }

  const repeatedProductCardCount = cq.repeatedProductCardCount ?? 0;
  if (repeatedProductCardCount >= 12) commerceScore += 1;
  else if (repeatedProductCardCount >= 6 && editorialComparisonScore < 4) commerceScore += 1;

  const commerceKeywordCount = cq.commerceKeywordCount ?? 0;
  if (commerceKeywordCount > 0) {
    commerceScore += strongEditorial ? 1 : 2;
  }

  const policyText = `${meta?.description ?? ''} ${contentSnippet.slice(0, 4000)}`;
  if (
    /배송|반품|교환|refund|return policy|free shipping|money[- ]back/i.test(policyText) &&
    editorialComparisonScore < 4
  ) {
    commerceScore += 1;
  }

  const productSchemaTypesFound = cq.jsonLdProductTypesFound ?? [];
  const hasItemListOnly = !!(cq.hasJsonLdItemList && !cq.hasJsonLdProduct);
  const hasJsonLdStandaloneProduct = cq.hasJsonLdStandaloneProduct ?? false;
  const hasJsonLdProductInListContext = cq.hasJsonLdProductInListContext ?? false;

  const methodologyOrComparisonSignals =
    editorialComparisonScore >= 4 ||
    /\b(methodology|how we test|test bench)\b/i.test(
      `${meta?.title ?? ''} ${headings.join(' ')} ${contentSnippet.slice(0, 6000)}`
    );

  const strongCommerceEvidence =
    hasJsonLdStandaloneProduct ||
    (buyButtonCount >= 2 && (cq.hasOgProductType === true || priceMatchCount >= 5)) ||
    buyButtonCount >= 5;

  const commerceScoreRaw = commerceScore;
  let finalPageType: 'editorial' | 'commerce' =
    commerceScoreRaw >= COMMERCE_SCORE_THRESHOLD ? 'commerce' : 'editorial';

  let editorialProtectionOverrodeCommerce = false;
  if (finalPageType === 'commerce' && editorialComparisonScore >= 5 && !strongCommerceEvidence) {
    finalPageType = 'editorial';
    editorialProtectionOverrodeCommerce = true;
  }

  const log: PageTypeDetectionLog = {
    finalPageType,
    commerceScoreRaw,
    editorialComparisonScore,
    hasProductSchemaLegacy,
    productSchemaTypesFound,
    hasItemListOnly,
    priceMatchCount,
    buyButtonCount,
    repeatedProductCardCount,
    commerceKeywordCount,
    hasJsonLdStandaloneProduct,
    hasJsonLdProductInListContext,
    methodologyOrComparisonSignals,
    editorialProtectionOverrodeCommerce,
    commerceThreshold: COMMERCE_SCORE_THRESHOLD,
  };

  if (process.env.GEO_PAGE_TYPE_LOG === '1') {
    console.log('[Detection] pageType resolved', {
      url,
      host,
      finalPageType: log.finalPageType,
      commerceScore: log.commerceScoreRaw,
      commerceThreshold: log.commerceThreshold,
      editorialComparisonScore: log.editorialComparisonScore,
      editorialProtectionOverrodeCommerce: log.editorialProtectionOverrodeCommerce,
      hasProductSchemaLegacy: log.hasProductSchemaLegacy,
      productSchemaTypesFound: log.productSchemaTypesFound,
      hasItemListOnly: log.hasItemListOnly,
      hasJsonLdStandaloneProduct: log.hasJsonLdStandaloneProduct,
      hasJsonLdProductInListContext: log.hasJsonLdProductInListContext,
      priceMatchCount: log.priceMatchCount,
      buyButtonCount: log.buyButtonCount,
      repeatedProductCardCount: log.repeatedProductCardCount,
      commerceKeywordCount: log.commerceKeywordCount,
      methodologyOrComparisonSignals: log.methodologyOrComparisonSignals,
      strongCommerceEvidence,
    });
  }

  return { pageType: finalPageType, log };
}

export function detectPageType(
  url: string,
  config: GeoScoringConfig,
  args: Parameters<typeof detectPageTypeWithLog>[2]
): 'editorial' | 'commerce' | 'video' {
  return detectPageTypeWithLog(url, config, args).pageType;
}
