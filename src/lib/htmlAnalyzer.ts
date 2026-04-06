import * as cheerio from 'cheerio';
import type { AnalysisMeta, ContentQuality, TrustSignals } from './analysisTypes';
import { extractSupplementalTextFromJsonLd } from './articleExtraction';
import { countProductSpecBlocks } from './paragraphAnalyzer';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

interface JsonLdWalkAccumulator {
  typesFound: Set<string>;
  hasJsonLdProduct: boolean;
  hasJsonLdItemList: boolean;
  hasJsonLdOfferOrAggregate: boolean;
  hasFaqSchema: boolean;
  hasReviewSchema: boolean;
  jsonLdAuthor: boolean;
  jsonLdDatePublished: boolean;
  jsonLdDateModified: boolean;
}

function walkJsonLdNode(node: unknown, acc: JsonLdWalkAccumulator): void {
  if (node === null || node === undefined) return;
  if (typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const x of node) walkJsonLdNode(x, acc);
    return;
  }
  const o = node as Record<string, unknown>;
  const t = o['@type'];
  const typeArr = Array.isArray(t) ? t : t ? [t] : [];
  for (const tt of typeArr) {
    if (typeof tt !== 'string') continue;
    acc.typesFound.add(tt);
    if (tt === 'Product') acc.hasJsonLdProduct = true;
    if (tt === 'ItemList') acc.hasJsonLdItemList = true;
    if (tt === 'Offer' || tt === 'AggregateOffer') acc.hasJsonLdOfferOrAggregate = true;
    if (tt === 'FAQPage') acc.hasFaqSchema = true;
    if (tt === 'Review') acc.hasReviewSchema = true;
  }
  if (o.author) acc.jsonLdAuthor = true;
  if (o.datePublished) acc.jsonLdDatePublished = true;
  if (o.dateModified) acc.jsonLdDateModified = true;
  for (const k of Object.keys(o)) {
    if (k === '@context') continue;
    walkJsonLdNode(o[k], acc);
  }
}

/**
 * 주어진 URL에서 HTML을 가져옵니다.
 * appOrigin이 있으면 프록시 경유 (iframe과 동일한 HTML 사용).
 */
export async function fetchHtml(url: string, appOrigin?: string): Promise<string> {
  const fetchUrl = appOrigin
    ? `${appOrigin}/api/proxy?url=${encodeURIComponent(url)}`
    : url;

  const response = await fetch(fetchUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': 'https://www.google.com/',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-User': '?1',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();

  // Debug logging only when GEO_DEBUG=1 to avoid noisy production logs
  if (process.env.GEO_DEBUG === '1') {
    const bodyIdx = html.toLowerCase().indexOf('<body');
    const bodyPreview = bodyIdx >= 0 ? html.substring(bodyIdx, bodyIdx + 500) : html.substring(0, 500);
    console.log('--- HTML 수집 결과 ---');
    console.log('URL:', url);
    console.log('HTML 길이:', html.length);
    console.log('Body 내용 일부:', bodyPreview);
    console.log('---------------------');
  }

  return html;
}

/**
 * HTML에서 메타 정보, 제목, 본문 텍스트, 질문 등을 추출합니다.
 */
export function extractMetaAndContent(html: string): {
  meta: AnalysisMeta;
  headings: string[];
  h1Count: number;
  contentText: string;
  pageQuestions: string[];
  hasFaqSchema: boolean;
  hasStructuredData: boolean;
  hasProductSchema: boolean;
  hasReviewSchema: boolean;
  contentQuality: ContentQuality;
  trustSignals: TrustSignals;
  limitedAnalysis?: boolean;
  limitedReason?: string | null;
} {
  const $ = cheerio.load(html);

  const meta: AnalysisMeta = {
    title: $('title').text().trim() || null,
    description: $('meta[name="description"]').attr('content')?.trim() || null,
    keywords: $('meta[name="keywords"]').attr('content')?.trim() || null,
    ogTitle: $('meta[property="og:title"]').attr('content')?.trim() || null,
    ogDescription: $('meta[property="og:description"]').attr('content')?.trim() || null,
    canonical: $('link[rel="canonical"]').attr('href')?.trim() || null,
  };

  const h1Count = $('h1').length;
  const h2Count = $('h2').length;
  const h3Count = $('h3').length;

  const headings: string[] = [];
  $('h1, h2, h3').each((_, elem) => {
    const text = $(elem).text().trim();
    if (text) headings.push(text);
  });

  const tableCount = $('table').length;
  const listCount = $('ul, ol').length;
  const imageCount = $('img').length;

  const stepPattern = /step\s*\d|단계\s*\d|step\d/i;
  const headingsJoined = headings.join(' ');
  const hasStepStructure =
    stepPattern.test(headingsJoined) ||
    stepPattern.test($('body').html() ?? '') ||
    headings.some((h) => /^\d+[\.\)]\s/.test(h));

  let hasFaqSchema = false;
  let hasStructuredData = false;
  let hasProductSchema = false;
  let hasReviewSchema = false;
  let hasOgProductType = false;
  let commerceKeywordCount = 0;
  let buyButtonCount = 0;
  let priceMatchCount = 0;
  let repeatedProductCardCount = 0;
  let hasCommerceKeywords = false;

  const jsonLdAcc: JsonLdWalkAccumulator = {
    typesFound: new Set<string>(),
    hasJsonLdProduct: false,
    hasJsonLdItemList: false,
    hasJsonLdOfferOrAggregate: false,
    hasFaqSchema: false,
    hasReviewSchema: false,
    jsonLdAuthor: false,
    jsonLdDatePublished: false,
    jsonLdDateModified: false,
  };

  $('script[type="application/ld+json"]').each((_, elem) => {
    hasStructuredData = true;
    try {
      const json = JSON.parse($(elem).html() || '');
      const roots = Array.isArray(json) ? json : [json];
      for (const item of roots) walkJsonLdNode(item, jsonLdAcc);
    } catch {
      // ignore malformed JSON-LD
    }
  });

  hasFaqSchema = jsonLdAcc.hasFaqSchema;
  hasReviewSchema = jsonLdAcc.hasReviewSchema;
  const jsonLdProductTypesFound = [...jsonLdAcc.typesFound].sort();
  const hasJsonLdProduct = jsonLdAcc.hasJsonLdProduct;
  const hasJsonLdItemList = jsonLdAcc.hasJsonLdItemList;
  const hasJsonLdOfferOrAggregate = jsonLdAcc.hasJsonLdOfferOrAggregate;
  const hasJsonLdStandaloneProduct = hasJsonLdProduct && !hasJsonLdItemList;
  const hasJsonLdProductInListContext = hasJsonLdItemList && hasJsonLdProduct;
  /** Legacy: any commerce-relevant JSON-LD (scoring / isDataPage) — unchanged broad OR */
  hasProductSchema =
    hasJsonLdProduct || hasJsonLdItemList || hasJsonLdOfferOrAggregate;

  // OG product type detection
  if ($('meta[property="og:type"]').attr('content')?.toLowerCase() === 'product') {
    hasOgProductType = true;
  }

  const jsonLdAuthor = jsonLdAcc.jsonLdAuthor;
  const jsonLdDatePublished = jsonLdAcc.jsonLdDatePublished;
  const jsonLdDateModified = jsonLdAcc.jsonLdDateModified;

  const hasAuthor = !!(
    jsonLdAuthor ||
    $('meta[name="author"]').attr('content') ||
    $('[rel="author"]').length > 0 ||
    $('[class*="author"], [itemprop="author"]').length > 0
  );
  const hasPublishDate = !!(
    jsonLdDatePublished ||
    $('meta[property="article:published_time"]').attr('content') ||
    $('time[datetime]').length > 0 ||
    $('[itemprop="datePublished"]').length > 0
  );
  const hasModifiedDate = !!(
    jsonLdDateModified ||
    $('meta[property="article:modified_time"]').attr('content') ||
    $('[itemprop="dateModified"]').length > 0
  );

  const fullHtml = $.html() ?? '';
  const lowered = fullHtml.toLowerCase();
  // Detect common bot-check / interstitial patterns
  const protectionPatterns = [
    /access denied/i,
    /please enable javascript/i,
    /captcha/i,
    /robot or human/i,
    /verify you are a human/i,
    /blocked/i,
    /forbidden/i,
    /access denied/i,
  ];
  let limitedAnalysis = false;
  let limitedReason: string | null = null;
  if ((fullHtml.length ?? 0) < 2000) {
    limitedAnalysis = true;
    limitedReason = 'short_html';
  } else if (protectionPatterns.some((p) => p.test(lowered))) {
    limitedAnalysis = true;
    limitedReason = 'site_protection';
  }
  const contactHrefPattern = /href=["'][^"']*(?:contact|문의|연락|상담|고객센터|inquiry|support|cs|help)/i;
  let hasContactLink = contactHrefPattern.test(fullHtml);
  if (!hasContactLink) {
    $('a[href]').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (/연락|문의|상담|고객\s*센터|1:1|바로가기|전화|이메일|문의하기/i.test(text)) {
        hasContactLink = true;
        return false;
      }
    });
  }
  const hasAboutLink = /href=["'][^"']*(?:about|소개|회사소개|기업소개)/i.test(fullHtml);

  const jsonLdSupplement = extractSupplementalTextFromJsonLd(html);
  $('script, style, noscript, svg').remove();
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const mergedForContent = [bodyText, jsonLdSupplement].filter(Boolean).join('\n\n').trim();
  const contentText = mergedForContent.substring(0, 20000);

  // AI Citeability: 첫 문단 분석 (20자 이상인 첫 의미 있는 문단 또는 H1)
  let firstP = '';
  $('main p, article p, .content p, #content p, body p').each((_, el) => {
    if (firstP) return;
    const txt = $(el).text().trim();
    if (txt.length >= 20) firstP = txt;
  });
  // H1이 인트로 역할이면 사용 (예: "매일 사용하는 헤어드라이기 현명하게 고르는 방법 5가지")
  const firstH1 = $('h1').first().text().trim();
  const effectiveFirst =
    firstP.length >= firstH1.length ? firstP : firstH1.length >= 20 ? firstH1 : firstP;
  const firstParagraphLength = effectiveFirst.length;
  const definitionPatterns = [
    /은\s+.{5,}(?:입니다|합니다|됩니다|인\s)/,
    /는\s+.{5,}(?:입니다|합니다|됩니다|인\s)/,
    /이란\s+.{3,}/,
    /이라\s+함은/,
    /\bis\s+(?:a|an|the)\b/i,
    /\bare\s+/i,
    /\brefers?\s+to\b/i,
    /\bdesigned\s+(?:to|for)\b/i,
    /\bused\s+(?:to|for)\b/i,
  ];
  const hasDefinitionPattern =
    definitionPatterns.some((p) => p.test(effectiveFirst)) ||
    firstParagraphLength > 80 ||
    /(방법|가이드|추천|고르는|선택|이용).{2,20}(가지|팁|정리)/.test(effectiveFirst);

  // AI Citeability: 인용 가능한 문장 (5-25단어, 숫자/데이터 포함) + 제품 스펙 블록
  const sentences = contentText.split(/[.!?。]\s+/);
  let quotableSentenceCount = 0;
  for (const s of sentences) {
    const words = s.trim().split(/\s+/);
    if (words.length >= 3 && words.length <= 30) {
      if (/\d/.test(s) || /[%₩$원만천억]/.test(s) || /\d+[가-힣]/.test(s)) {
        quotableSentenceCount++;
      }
    }
  }
  const productSpecBlockCount = countProductSpecBlocks($.html() ?? '');

  // 가격 정보 + 가격 패턴 카운트
  const pricePattern = /(\d{1,3}(?:,\d{3})*\s*원|₩\s*\d{1,3}(?:,\d{3})*|\$\s*\d{1,3}(?:[.,]\d{2})?|\d{1,3}(?:,\d{3})*\s*만원)/g;
  const priceMatches = [...(contentText.matchAll(pricePattern) || [])];
  priceMatchCount = priceMatches.length;
  const hasPriceInfo = priceMatchCount > 0 || /무료|가격|비용|렌탈료|월\s*[\d,]+/.test(contentText);

  // Commerce keyword detection (class/id/button/link text)
  const commerceKeysEn = ['cart','checkout','order','purchase','buy-now','buy','wishlist','add-to-cart','addtocart'];
  const commerceKeysKr = ['장바구니','구매하기','결제하기','주문하기','배송비','바로구매'];
  const commerceSelectorPattern = '[class],[id],button,a';
  $(commerceSelectorPattern).each((_, el) => {
    const cls = ($(el).attr('class') || '') + ' ' + ($(el).attr('id') || '');
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const combined = (cls + ' ' + text).toLowerCase();
    for (const k of commerceKeysEn) {
      if (combined.includes(k)) commerceKeywordCount++;
    }
    for (const k of commerceKeysKr) {
      if (combined.includes(k)) commerceKeywordCount++;
    }
    // buy button heuristic
    if (/\b(buy|구매|장바구니|구매하기|바로구매|주문)\b/i.test(text)) buyButtonCount++;
  });
  hasCommerceKeywords = commerceKeywordCount > 0;

  // Repeated product card detection — avoid generic [class*="item"] (inflates editorial layouts)
  const productCardSelectors = [
    '.product',
    '[class*="product-"]',
    '[class*="prd-"]',
    '[class*="product_card"]',
    '[class*="product-card"]',
    '[class*="prd"]',
  ];
  let prodCards = 0;
  for (const sel of productCardSelectors) {
    prodCards += Math.min(45, $(sel).length);
  }
  repeatedProductCardCount = prodCards;

  const pageQuestions = extractQuestions(contentText, headings);

  const contentQuality: ContentQuality = {
    contentLength: bodyText.length,
    tableCount,
    listCount,
    h2Count,
    h3Count,
    imageCount,
    hasStepStructure,
    quotableSentenceCount: quotableSentenceCount + Math.min(productSpecBlockCount, 5),
    firstParagraphLength,
    hasDefinitionPattern,
    hasPriceInfo,
    productSpecBlockCount,
    priceMatchCount,
    buyButtonCount,
    commerceKeywordCount,
    repeatedProductCardCount,
    hasOgProductType,
    hasCommerceKeywords,
    jsonLdProductTypesFound,
    hasJsonLdProduct,
    hasJsonLdItemList,
    hasJsonLdOfferOrAggregate,
    hasJsonLdStandaloneProduct,
    hasJsonLdProductInListContext,
  };

  const trustSignals: TrustSignals = {
    hasAuthor,
    hasPublishDate,
    hasModifiedDate,
    hasContactLink,
    hasAboutLink,
  };

  return {
    meta,
    headings,
    h1Count,
    contentText,
    pageQuestions,
    hasFaqSchema,
    hasStructuredData,
    hasProductSchema,
    hasReviewSchema,
    contentQuality,
    trustSignals,
    limitedAnalysis,
    limitedReason,
  };
}

/**
 * 텍스트와 헤딩에서 질문으로 보이는 문장들을 추출합니다.
 */
function extractQuestions(text: string, headings: string[] = []): string[] {
  const questionKeywords = [
    '어떻게', '언제', '왜', '무엇', '가능', '방법',
    '비용', '기간', '차이', '추천', '어디', '누가',
    '할 수', '되나요', '인가요', '인가', '있나요', '없나요',
    '해야', '하나요', '인지', '일까', '은요', '를요',
  ];

  const seen = new Set<string>();
  const questions: string[] = [];

  function addIfQuestion(s: string) {
    const trimmed = s.trim();
    if (trimmed.length <= 8) return;
    const key = trimmed.toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) return;

    const hasQuestionMark = trimmed.includes('?');
    const hasKeyword = questionKeywords.some((kw) => trimmed.includes(kw));
    if (hasQuestionMark || hasKeyword) {
      seen.add(key);
      questions.push(trimmed);
    }
  }

  for (const h of headings) {
    addIfQuestion(h);
  }

  // ?로 끝나는 부분을 먼저 별도 추출 (FAQ 형식에 강함)
  const qmarkSegments = text.match(/[^.!?\n]*\?/g) ?? [];
  for (const seg of qmarkSegments) {
    addIfQuestion(seg);
  }

  // 일반 문장 분리
  const sentences = text.split(/[.!?]\s+/).map((s) => s.trim());
  for (const sentence of sentences) {
    addIfQuestion(sentence);
  }

  return questions;
}

