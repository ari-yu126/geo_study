/**
 * Text surfaces used for question coverage matching (title, headings, intro, FAQ, key sentences).
 */

import * as cheerio from 'cheerio';
import type { AnalysisMeta } from './analysisTypes';

const FAQ_HEADING = /\?|faq|q\s*[.&:]|묻는\s*질문|자주\s*묻|질문과\s*답|q&a/i;
const RECOMMENDATION_MARK = /추천|권장|결론|verdict|recommend|best\s+choice|top\s+pick|요약|정리하자면/i;

function extractFirstParagraphs(html: string, maxParagraphs: number, maxChars: number): string {
  try {
    const $ = cheerio.load(html);
    $('script, style, noscript, nav, header, footer, iframe, svg').remove();
    const parts: string[] = [];
    let n = 0;
    $('main p, article p, .content p, #content p, [role="main"] p, body p').each((_, el) => {
      if (n >= maxParagraphs) return false;
      const txt = $(el).text().trim();
      if (txt.length >= 25) {
        parts.push(txt);
        n++;
      }
    });
    const joined = parts.join('\n');
    return joined.length > maxChars ? `${joined.slice(0, maxChars - 1)}…` : joined;
  } catch {
    return '';
  }
}

function faqHeadingText(headings: string[]): string {
  return headings.filter((h) => FAQ_HEADING.test(h)).join('\n');
}

function extractKeyRecommendationSentences(contentText: string, maxLen: number): string {
  const chunk = contentText.slice(0, 8000);
  const sentences = chunk.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
  const hits = sentences.filter((s) => RECOMMENDATION_MARK.test(s) && s.length >= 20 && s.length <= 400);
  const joined = hits.slice(0, 6).join('\n');
  return joined.length > maxLen ? `${joined.slice(0, maxLen - 1)}…` : joined;
}

export interface CoverageMatchInput {
  pageTitle: string;
  headingsText: string;
  /** Title + headings + intro + FAQ headings + recommendation-like lines */
  prioritySurface: string;
  pageQuestions: string[];
  fullContent: string;
  /** Primary topic tokens — fallback when pageQuestions is empty */
  topicTokens: string[];
}

export function buildCoverageMatchInput(params: {
  meta: Pick<AnalysisMeta, 'title' | 'ogTitle' | 'description' | 'ogDescription'>;
  headings: string[];
  html?: string;
  contentText: string;
  pageQuestions: string[];
  hasFaqSchema: boolean;
  topicTokens: string[];
}): CoverageMatchInput {
  const title = (params.meta.title ?? params.meta.ogTitle ?? '').trim();
  const desc = (params.meta.description ?? params.meta.ogDescription ?? '').trim();
  const headingsText = params.headings.join('\n');

  let intro = '';
  if (params.html && params.html.length > 50) {
    intro = extractFirstParagraphs(params.html, 3, 2200);
  }
  if (!intro) {
    intro = params.contentText.slice(0, 1800);
  }

  const faqHeads = faqHeadingText(params.headings);
  const faqBodySample = params.hasFaqSchema ? params.contentText.slice(400, 2800) : '';

  const keyRec = extractKeyRecommendationSentences(params.contentText, 2000);

  const prioritySurface = [
    title,
    desc.slice(0, 600),
    headingsText,
    faqHeads,
    intro,
    faqBodySample,
    keyRec,
    params.pageQuestions.join('\n'),
  ]
    .filter(Boolean)
    .join('\n');

  return {
    pageTitle: title,
    headingsText,
    prioritySurface,
    pageQuestions: params.pageQuestions,
    fullContent: params.contentText,
    topicTokens: params.topicTokens.map((t) => t.toLowerCase()),
  };
}

/** Video / plain text pages without article HTML */
export function buildCoverageMatchInputPlain(params: {
  meta: Pick<AnalysisMeta, 'title' | 'ogTitle' | 'description' | 'ogDescription'>;
  contentText: string;
  pageQuestions: string[];
  topicTokens: string[];
}): CoverageMatchInput {
  const title = (params.meta.title ?? params.meta.ogTitle ?? '').trim();
  const desc = (params.meta.description ?? params.meta.ogDescription ?? '').trim();
  const head = params.contentText.slice(0, 2200);
  const keyRec = extractKeyRecommendationSentences(params.contentText, 1500);
  const prioritySurface = [title, desc.slice(0, 800), head, keyRec, params.pageQuestions.join('\n')]
    .filter(Boolean)
    .join('\n');

  return {
    pageTitle: title,
    headingsText: '',
    prioritySurface,
    pageQuestions: params.pageQuestions,
    fullContent: params.contentText,
    topicTokens: params.topicTokens.map((t) => t.toLowerCase()),
  };
}
