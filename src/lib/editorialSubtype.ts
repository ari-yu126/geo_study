/**
 * Editorial page subtype (blog vs site documentation) — explainability/UI only.
 * Does not use reviewLike, editorialComparisonScore, or FAQ/comparison page flags.
 *
 * Heuristic tuning (precision-first): require stronger agreement before blog/site_info;
 * mixed when evidence is contested, blended, or too weak; confidence scales with spread + strength.
 */

import type { AnalysisMeta, EditorialSubtype, EditorialSubtypeDebug, TrustSignals } from './analysisTypes';

const BLOG_HOST_HINTS =
  /\b(medium\.com|substack\.com|velog\.io|tistory\.com|blog\.naver\.com|wordpress\.com|github\.io|notion\.site|brunch\.co\.kr|dev\.to)\b/i;

const BLOG_PATH_RE = /\/(blog|blogs|posts|post|articles|article|news|column|magazine|story|authors?)\//i;
const BLOG_DATE_SLUG_RE = /\/\d{4}\/\d{2}\//;

const SITE_PATH_RE =
  /\/(help|support|docs|documentation|documentation\/|legal|privacy|terms|policy|policies|company|about|services|service|customer|customers|contact|guide|guides|resources)(\/|$)/i;

const SITE_TITLE_HINTS =
  /이용약관|개인정보|개인정보처리방침|고객센터|환불|취소\s*정책|terms\s*of\s*service|privacy\s*policy|cookie\s*policy|help\s*center|support|documentation/i;

const BLOG_TITLE_HINTS =
  /posted\s+by|min\s+read|tags?:|카테고리|필자|기자|editor'?s?\s+pick|opinion|column/i;

const ARTICLE_JSONLD = new Set(['Article', 'BlogPosting', 'NewsArticle']);

/** Both sides must reach this to classify as genuinely blended (reduces spurious mixed from 4/4 noise). */
const BOTH_STRONG_MIXED_THRESHOLD = 5;

/**
 * Near-tie → mixed only when at least one side has meaningful mass (reduces overuse of mixed at low scores).
 */
const CLOSE_SCORE_MAX_DIFF = 1;
const CLOSE_SCORE_MIN_MAX = 4;

/** Need some signal before a definitive blog/site_info label. */
const MIN_MAX_FOR_DECISIVE = 3;

function normalizeJsonLdType(raw: string): string {
  const s = raw.trim();
  return (s.split(/[/#]/).pop() ?? s).trim();
}

export interface DetectEditorialSubtypeInput {
  url: string;
  meta: Pick<AnalysisMeta, 'title' | 'ogTitle' | 'description'>;
  headings: string[];
  trustSignals: TrustSignals;
  /** From ContentQuality.jsonLdProductTypesFound — all @type values seen in JSON-LD */
  jsonLdTypesFound: string[];
}

export function detectEditorialSubtype(input: DetectEditorialSubtypeInput): {
  editorialSubtype: EditorialSubtype;
  editorialSubtypeDebug: EditorialSubtypeDebug;
} {
  const { url, meta, headings, trustSignals, jsonLdTypesFound } = input;
  let blogScore = 0;
  let siteInfoScore = 0;
  const reasons: string[] = [];

  let pathname = '';
  let host = '';
  try {
    const u = new URL(url);
    pathname = u.pathname.toLowerCase();
    host = u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    pathname = '';
    host = '';
  }

  if (BLOG_HOST_HINTS.test(host)) {
    blogScore += 3;
    reasons.push('host: known blog/publishing platform');
  }

  if (BLOG_PATH_RE.test(pathname)) {
    blogScore += 2;
    reasons.push('path: blog/article segment');
  }
  if (BLOG_DATE_SLUG_RE.test(pathname)) {
    blogScore += 1;
    reasons.push('path: date-style URL segment');
  }

  if (SITE_PATH_RE.test(pathname)) {
    siteInfoScore += 2;
    reasons.push('path: help/docs/policy/company segment');
  }

  let hasArticleType = false;
  for (const raw of jsonLdTypesFound) {
    const n = normalizeJsonLdType(raw);
    if (ARTICLE_JSONLD.has(n)) {
      hasArticleType = true;
      break;
    }
  }
  if (hasArticleType) {
    blogScore += 2;
    reasons.push('json-ld: Article/BlogPosting/NewsArticle');
  }

  const hasWebPageOnly =
    jsonLdTypesFound.length > 0 &&
    jsonLdTypesFound.some((t) => normalizeJsonLdType(t) === 'WebPage') &&
    !hasArticleType;
  if (hasWebPageOnly) {
    siteInfoScore += 1;
    reasons.push('json-ld: WebPage without article type');
  }

  if (trustSignals.hasAuthor && trustSignals.hasPublishDate) {
    blogScore += 2;
    reasons.push('trust: author + publish date');
  }
  if (trustSignals.hasContactLink) {
    siteInfoScore += 1;
    reasons.push('trust: contact link');
  }
  if (trustSignals.hasAboutLink) {
    siteInfoScore += 1;
    reasons.push('trust: about link');
  }

  const titleBlob = [meta.title, meta.ogTitle, meta.description, headings.slice(0, 12).join(' ')].filter(Boolean).join(' ');
  if (SITE_TITLE_HINTS.test(titleBlob)) {
    siteInfoScore += 1;
    reasons.push('title/heading: policy/help/legal phrasing');
  }
  if (BLOG_TITLE_HINTS.test(titleBlob)) {
    blogScore += 1;
    reasons.push('title/heading: article/blog phrasing');
  }

  const spread = Math.abs(blogScore - siteInfoScore);
  const maxS = Math.max(blogScore, siteInfoScore);
  const minS = Math.min(blogScore, siteInfoScore);

  let editorialSubtype: EditorialSubtype;

  if (maxS < MIN_MAX_FOR_DECISIVE) {
    editorialSubtype = 'mixed';
    reasons.push('resolution: max score < 3 → mixed (insufficient evidence)');
  } else if (blogScore >= BOTH_STRONG_MIXED_THRESHOLD && siteInfoScore >= BOTH_STRONG_MIXED_THRESHOLD) {
    editorialSubtype = 'mixed';
    reasons.push('resolution: both blog and site_info signals strong → mixed');
  } else if (spread <= CLOSE_SCORE_MAX_DIFF && maxS >= CLOSE_SCORE_MIN_MAX) {
    editorialSubtype = 'mixed';
    reasons.push('resolution: scores too close (max≥4, diff≤1) → mixed');
  } else if (blogScore > siteInfoScore) {
    if (spread === 1 && siteInfoScore >= 3) {
      editorialSubtype = 'mixed';
      reasons.push('resolution: narrow blog lead with strong site_info signals → mixed');
    } else {
      editorialSubtype = 'blog';
      reasons.push('resolution: blogScore > siteInfoScore');
    }
  } else if (siteInfoScore > blogScore) {
    if (spread === 1 && blogScore >= 3) {
      editorialSubtype = 'mixed';
      reasons.push('resolution: narrow site_info lead with strong blog signals → mixed');
    } else {
      editorialSubtype = 'site_info';
      reasons.push('resolution: siteInfoScore > blogScore');
    }
  } else {
    editorialSubtype = 'mixed';
    reasons.push('resolution: tie → mixed');
  }

  const strength = maxS;
  let confidence = Math.min(1, spread / 10 + strength / 28);
  if (spread < 2) confidence *= 0.78;
  if (strength < 5) confidence *= 0.82;
  if (editorialSubtype === 'mixed') {
    confidence = Math.min(confidence, 0.62);
  }
  confidence = Math.min(1, Math.round(confidence * 100) / 100);

  return {
    editorialSubtype,
    editorialSubtypeDebug: {
      confidence,
      blogScore,
      siteInfoScore,
      reasons,
    },
  };
}
