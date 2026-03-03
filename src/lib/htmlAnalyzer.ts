import * as cheerio from 'cheerio';
import type { AnalysisMeta, ContentQuality, TrustSignals } from './analysisTypes';
import { countProductSpecBlocks } from './paragraphAnalyzer';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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

  // [콘솔 체크 포인트]
  const bodyIdx = html.toLowerCase().indexOf('<body');
  const bodyPreview = bodyIdx >= 0
    ? html.substring(bodyIdx, bodyIdx + 500)
    : html.substring(0, 500);
  console.log('--- HTML 수집 결과 ---');
  console.log('URL:', url);
  console.log('HTML 길이:', html.length);
  console.log('Body 내용 일부:', bodyPreview);
  console.log('---------------------');

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
  contentQuality: ContentQuality;
  trustSignals: TrustSignals;
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
  $('script[type="application/ld+json"]').each((_, elem) => {
    hasStructuredData = true;
    try {
      const json = JSON.parse($(elem).html() || '');
      const types = Array.isArray(json) ? json : [json];
      const productTypes = ['Product', 'ItemList', 'Offer', 'AggregateOffer'];
      for (const item of types) {
        const t = item['@type'];
        const typeArr = Array.isArray(t) ? t : (t ? [t] : []);
        if (typeArr.some((tt: string) => productTypes.includes(tt))) hasProductSchema = true;
        if (
          typeArr.includes('FAQPage') ||
          (item['@graph'] && Array.isArray(item['@graph']) && item['@graph'].some((n: { '@type'?: string }) => n['@type'] === 'FAQPage'))
        ) {
          hasFaqSchema = true;
        }
        if (item['@graph'] && Array.isArray(item['@graph'])) {
          for (const node of item['@graph']) {
            if (node['@type'] === 'FAQPage') hasFaqSchema = true;
            if (productTypes.includes(node['@type'] as string)) hasProductSchema = true;
          }
        }
      }
    } catch {
      // ignore
    }
  });

  // JSON-LD 구조화 데이터에서 trust signals 추출
  let jsonLdAuthor = false;
  let jsonLdDatePublished = false;
  let jsonLdDateModified = false;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).html() ?? '';
      const ld = JSON.parse(raw);
      const items = Array.isArray(ld) ? ld : [ld];
      for (const item of items) {
        if (item.author) jsonLdAuthor = true;
        if (item.datePublished) jsonLdDatePublished = true;
        if (item.dateModified) jsonLdDateModified = true;
      }
    } catch { /* malformed JSON-LD */ }
  });

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
  const hasContactLink = /href=["'][^"']*(?:contact|문의|연락|상담|고객센터)/i.test(fullHtml);
  const hasAboutLink = /href=["'][^"']*(?:about|소개|회사소개|기업소개)/i.test(fullHtml);

  $('script, style, noscript, svg').remove();
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const contentText = bodyText.substring(0, 20000);

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

  // 가격 정보
  const hasPriceInfo = /[\d,]+\s*원|₩\s*[\d,]+|\$\s*[\d,.]+|[\d,]+\s*만원|무료|가격|비용|렌탈료|월\s*[\d,]+/.test(contentText);

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
    contentQuality,
    trustSignals,
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

/**
 * URL을 정규화합니다 (캐시 키로 사용).
 * - 프로토콜은 https://로 통일
 * - www. 제거
 * - trailing slash 제거
 * - utm_ 파라미터 제거
 */
export function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);

    // 프로토콜을 https로 통일
    urlObj.protocol = 'https:';

    // www. 제거
    urlObj.hostname = urlObj.hostname.replace(/^www\./, '');

    // utm_ 파라미터 제거
    const params = new URLSearchParams(urlObj.search);
    const keysToDelete: string[] = [];
    
    params.forEach((_, key) => {
      if (key.startsWith('utm_')) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach(key => params.delete(key));
    urlObj.search = params.toString();

    // trailing slash 제거
    let normalized = urlObj.toString();
    if (normalized.endsWith('/') && urlObj.pathname !== '/') {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  } catch (error) {
    // URL 파싱 실패 시 원본 반환
    return url;
  }
}
