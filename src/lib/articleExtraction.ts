import * as cheerio from 'cheerio';

/** Review / comparison editorial pages: section copy, tables, accordions */
const REVIEWISH =
  /review|verdict|comparison|rating|score|test|results|performance|battery|sound|noise|frequency|latency|comfort|mic|driver/i;

const DATA_LIKE =
  /[\d,]+\s*원|\d+[Aa][hH]|\d+[Vv]|용량|저온시동|정격출력|할인율|Hz|dB|ms|hour|min\b|score|rating|\b\d{1,2}\.\d+\b/;

export interface ExtractionMetrics {
  rawBodyTextLength: number;
  /** Approximate <p> + long list/table blocks */
  paragraphLikeCount: number;
  citationExtractedChunkCount: number;
}

/**
 * Text chunks for Gemini citation scoring — aligned with paragraph analysis selectors.
 */
export function extractChunks(html: string, maxChunks = 15): { index: number; text: string }[] {
  const $ = cheerio.load(html);
  $('script, style, noscript, nav, header, footer, iframe, svg').remove();

  const chunks: { index: number; text: string }[] = [];
  let idx = 0;

  const primarySelectors =
    'main p, article p, .content p, #content p, [role="main"] p, [class*="ArticleBody"] p, [class*="article-body"] p, [class*="review"] p';
  let elements = $(primarySelectors).toArray();
  if (elements.length < 3) {
    elements = $('body p').toArray();
  }

  const pushChunk = (text: string) => {
    const t = text.trim();
    if (t.length < 30) return;
    if (t.length > 800) {
      chunks.push({ index: idx++, text: t.substring(0, 800) });
    } else {
      chunks.push({ index: idx++, text: t });
    }
  };

  for (const el of elements) {
    pushChunk($(el).text());
    if (idx >= maxChunks) return chunks;
  }

  // Section / accordion / details (editorial reviews)
  if (chunks.length < 3) {
    $('section, [role="region"], details, [aria-expanded]').each((_, el) => {
      if (idx >= maxChunks) return false;
      const t = $(el).text().trim();
      if (t.length >= 80 && (REVIEWISH.test(t) || DATA_LIKE.test(t))) {
        pushChunk(t.length > 900 ? t.substring(0, 900) : t);
      }
    });
  }

  // Comparison tables — cell text often holds scores (RTINGS, etc.)
  if (chunks.length < 3) {
    $('table td, table th').each((_, el) => {
      if (idx >= maxChunks) return false;
      const t = $(el).text().trim();
      if (t.length >= 45 && (DATA_LIKE.test(t) || REVIEWISH.test(t))) {
        pushChunk(t.length > 650 ? t.substring(0, 650) : t);
      }
    });
  }

  // Shopping / spec-dense fallbacks (legacy)
  if (chunks.length < 3) {
    const dataSelectors =
      'ul li, ol li, [class*="product"] li, [class*="item"] div, [class*="plan"] li, [class*="goods"]';
    $(dataSelectors).each((_, el) => {
      if (idx >= maxChunks) return false;
      const text = $(el).text().trim();
      if (text.length < 45) return;
      if (DATA_LIKE.test(text)) {
        pushChunk(text.length > 600 ? text.substring(0, 600) : text);
      }
    });
  }

  // Long list items (methodology, pros/cons)
  if (chunks.length < 3) {
    $('main li, article li, [role="main"] li').each((_, el) => {
      if (idx >= maxChunks) return false;
      const text = $(el).text().trim();
      if (text.length >= 70 && (REVIEWISH.test(text) || DATA_LIKE.test(text))) {
        pushChunk(text.length > 700 ? text.substring(0, 700) : text);
      }
    });
  }

  return chunks;
}

function countParagraphLikeNodes(html: string): number {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  let n = $('main p, article p, .content p, #content p, [role="main"] p, body p').length;
  if (n < 8) {
    n += $('table td, table th').filter((_, el) => $(el).text().trim().length >= 40).length;
  }
  return n;
}

export function computeExtractionMetrics(html: string): ExtractionMetrics {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const rawBodyTextLength = $('body').text().replace(/\s+/g, ' ').trim().length;
  const paragraphLikeCount = countParagraphLikeNodes(html);
  const citationExtractedChunkCount = extractChunks(html, 15).length;
  return { rawBodyTextLength, paragraphLikeCount, citationExtractedChunkCount };
}

/** Extra signals for Naver m.blog — SmartEditor uses div modules, not always <p>. */
export type NaverMobileBodyMetrics = ExtractionMetrics & {
  headingCount: number;
  /** Text length from Naver post containers (se-*, postView) */
  naverModuleTextLength: number;
  /** Approximate SmartEditor / post body blocks (div-based) */
  naverModuleBlockCount: number;
  jsonLdSupplementalLength: number;
  /** max(raw, naver modules, JSON-LD article text) */
  meaningfulBodyLength: number;
};

/**
 * Metrics for deciding if m.blog HTML is usable before PC fallback.
 * Prefer this over raw {@link computeExtractionMetrics} alone for Naver mobile.
 */
export function computeNaverMobileBodyMetrics(html: string): NaverMobileBodyMetrics {
  const base = computeExtractionMetrics(html);
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();

  const headingCount = $('h1, h2, h3, h4').length;

  const naverRoots = $('.se-main-container, #postView, .se-viewer, article.se-fs, article').toArray();
  let naverModuleTextLength = 0;
  if (naverRoots.length > 0) {
    for (const el of naverRoots) {
      const t = $(el).text().replace(/\s+/g, ' ').trim().length;
      naverModuleTextLength = Math.max(naverModuleTextLength, t);
    }
  }
  if (naverModuleTextLength < 120) {
    let blob = '';
    $('.se-module-text, .se-text, .se_component_wrap, [class*="se-module"]').each((_, el) => {
      blob += $(el).text();
    });
    const alt = blob.replace(/\s+/g, ' ').trim().length;
    naverModuleTextLength = Math.max(naverModuleTextLength, alt);
  }

  const naverModuleBlockCount =
    $('.se-module-text, .se-text, .se_component_wrap, [class*="se-module-text"]').length +
    $('main p, article p, .se-main-container p, #postView p').length;

  const jsonLdBlob = extractSupplementalTextFromJsonLd(html);
  const jsonLdSupplementalLength = jsonLdBlob.trim().length;

  const meaningfulBodyLength = Math.max(
    base.rawBodyTextLength,
    naverModuleTextLength,
    jsonLdSupplementalLength
  );

  return {
    ...base,
    headingCount,
    naverModuleTextLength,
    naverModuleBlockCount,
    jsonLdSupplementalLength,
    meaningfulBodyLength,
  };
}

/**
 * Pulls headline / description / articleBody from JSON-LD when the DOM body is thin (SSR shell).
 */
export function extractSupplementalTextFromJsonLd(html: string): string {
  const $ = cheerio.load(html);
  const parts: string[] = [];

  function walk(node: unknown): void {
    if (node === null || node === undefined) return;
    if (typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    const o = node as Record<string, unknown>;
    for (const k of ['headline', 'name', 'description', 'articleBody', 'reviewBody'] as const) {
      const v = o[k];
      if (typeof v === 'string' && v.length > 45) parts.push(v);
    }
    for (const v of Object.values(o)) {
      if (v && typeof v === 'object') walk(v);
    }
  }

  $('script[type="application/ld+json"]').each((_, elem) => {
    try {
      const json = JSON.parse($(elem).html() || '');
      const roots = Array.isArray(json) ? json : [json];
      for (const item of roots) walk(item);
    } catch {
      /* ignore */
    }
  });

  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const p of parts) {
    const key = p.slice(0, 60).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(p);
  }
  return uniq.join('\n\n').slice(0, 15000);
}

/** When true, runAnalysis may fetch the page again via Playwright (JS-rendered DOM). */
export function shouldAttemptHeadlessFetch(hostname: string, metrics: ExtractionMetrics): boolean {
  if (process.env.GEO_HEADLESS_FETCH === '0') return false;
  const allow = (process.env.GEO_HEADLESS_DOMAINS ?? 'rtings.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const onAllowlist = allow.some((d) => hostname === d || hostname.endsWith('.' + d));
  if (onAllowlist) {
    return (
      metrics.citationExtractedChunkCount < 2 ||
      metrics.rawBodyTextLength < 5000 ||
      metrics.paragraphLikeCount < 6
    );
  }
  if (process.env.GEO_HEADLESS_ON_THIN_EXTRACT === '1') {
    return metrics.paragraphLikeCount < 2 && metrics.rawBodyTextLength < 2800;
  }
  return false;
}

export function headlessImprovesExtraction(pre: ExtractionMetrics, post: ExtractionMetrics): boolean {
  if (post.rawBodyTextLength <= pre.rawBodyTextLength + 1200) return false;
  if (post.citationExtractedChunkCount > pre.citationExtractedChunkCount) return true;
  if (post.paragraphLikeCount > pre.paragraphLikeCount + 4) return true;
  return post.rawBodyTextLength > pre.rawBodyTextLength * 1.55;
}
