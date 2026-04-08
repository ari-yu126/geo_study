/**
 * Visible publish-date heuristics for hosted blog templates (Naver / Tistory / Brunch).
 * Complements meta + JSON-LD; does not change scoring weights.
 */

import * as cheerio from 'cheerio';
import { detectHostingPlatform } from './platformDetection';

const KR_DATE_IN_TEXT =
  /20\d{2}\s*[\.\/년\-]\s*\d{1,2}\s*[\.\/월\-]\s*\d{1,2}|20\d{2}\.\s*\d{1,2}\.\s*\d{1,2}/;

function naverVisibleDate($: cheerio.CheerioAPI): boolean {
  if ($('.se_publishDate, .blog_date, .date, [class*="publishDate"], [class*="post_date"]').length > 0) {
    return true;
  }
  const hit = $('span, p, div, time').filter((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    return t.length <= 80 && KR_DATE_IN_TEXT.test(t);
  });
  return hit.length > 0 && hit.first().parents('article, main, #post, .post, .entry').length > 0;
}

function tistoryVisibleDate($: cheerio.CheerioAPI): boolean {
  if ($('.tt_article-date, .txt_date, .date, time[datetime], [class*="article-date"]').length > 0) {
    return true;
  }
  return false;
}

function brunchVisibleDate($: cheerio.CheerioAPI): boolean {
  if ($('time[datetime], .publish_time, [class*="Publish"], [class*="metadata"] time').length > 0) {
    return true;
  }
  const meta = $('meta[property="article:published_time"], meta[name="date"]').attr('content');
  if (meta && /^\d{4}-\d{2}-\d{2}/.test(meta)) return true;
  return false;
}

/**
 * True if the page shows a human-visible publication date typical of the hosted blog UI.
 * Prefer this when cheerio is already loaded for the document.
 */
export function detectVisibleHostedPublishDateFromDoc(
  $: cheerio.CheerioAPI,
  pageUrl: string
): boolean {
  try {
    const platform = detectHostingPlatform(pageUrl);
    if (platform !== 'naver_blog' && platform !== 'tistory' && platform !== 'brunch') {
      return false;
    }
    if (platform === 'naver_blog') return naverVisibleDate($);
    if (platform === 'tistory') return tistoryVisibleDate($);
    return brunchVisibleDate($);
  } catch {
    return false;
  }
}

/** Convenience: parse HTML then run hosted visible-date heuristics. */
export function detectVisibleHostedPublishDate(html: string, pageUrl: string): boolean {
  try {
    const $ = cheerio.load(html);
    return detectVisibleHostedPublishDateFromDoc($, pageUrl);
  } catch {
    return false;
  }
}
