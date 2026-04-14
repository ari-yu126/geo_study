/**
 * HTML fetch for analysis: normalized_url stays canonical (m.blog for Naver posts).
 * Naver: mobile (m.blog) is tried aggressively (retry + headless) before any PC/PostView URL.
 */

import { computeNaverMobileBodyMetrics } from './articleExtraction';
import { fetchHtml } from './htmlAnalyzer';
import { fetchHtmlViaHeadless } from './headlessHtmlFetch';
import { parseNaverBlogPostFromUrlString } from './canonicalizePlatformUrl';

/** How HTML was retrieved for non-Naver URLs (proxy may return 502 when upstream blocks bots). */
export type HtmlFetchTransport = 'proxy' | 'direct' | 'headless';

/**
 * Try /api/proxy when appOrigin is set, then same-URL direct fetch, then Playwright.
 * Used for commerce sites (e.g. Cloudflare) where one transport sometimes succeeds.
 */
export async function fetchHtmlWithRobustTransport(
  targetUrl: string,
  appOrigin?: string
): Promise<{ html: string; transport: HtmlFetchTransport }> {
  const errors: string[] = [];

  try {
    const html = await fetchHtml(targetUrl, appOrigin);
    return { html, transport: appOrigin ? 'proxy' : 'direct' };
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  if (appOrigin) {
    try {
      console.warn('[GEO_FETCH] transport fallback: direct (proxy failed)', { targetUrl });
      const html = await fetchHtml(targetUrl, undefined);
      return { html, transport: 'direct' };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  try {
    console.warn('[GEO_FETCH] transport fallback: headless', { targetUrl });
    const html = await fetchHtmlViaHeadless(targetUrl);
    return { html, transport: 'headless' };
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
    throw new Error(`Failed to fetch ${targetUrl}: ${errors.join(' | ')}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function dedupeUrlStrings(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const t = raw.trim();
    if (!t) continue;
    try {
      const key = new URL(t).href;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * Decide if m.blog HTML is unusable (must use PC fallback).
 * Naver SmartEditor often uses div modules instead of <p> — use {@link computeNaverMobileBodyMetrics}.
 * Prefer accepting borderline mobile over PC fallback unless content is truly empty/bot.
 */
/** Hard bot/WAF pages only — must NOT match normal HTML (e.g. <meta name="robots"> contains "robots" → do not use bare "robot"). */
function looksLikeNaverBotOrWafWall(html: string): boolean {
  const sample = html.slice(0, 80000).toLowerCase();
  return /access denied|비정상적인 접근|\bcaptcha\b|차단|forbidden\s*403/i.test(sample);
}

function evaluateNaverMobileHtml(html: string): {
  insufficient: boolean;
  reason: string;
  metrics: ReturnType<typeof computeNaverMobileBodyMetrics>;
} {
  const m = computeNaverMobileBodyMetrics(html);

  // If the post clearly has real body text, never treat as bot — regex false positives on "robots" meta, scripts, etc.
  const likelyRealNaverPost =
    m.naverModuleTextLength >= 200 ||
    m.meaningfulBodyLength >= 400 ||
    m.paragraphLikeCount >= 8 ||
    m.naverModuleBlockCount >= 12;

  if (!likelyRealNaverPost && looksLikeNaverBotOrWafWall(html)) {
    return { insufficient: true, reason: 'blocked_or_bot_page', metrics: m };
  }

  // Strong: JSON-LD article / headline+body from structured data
  if (m.jsonLdSupplementalLength >= 180) {
    return { insufficient: false, reason: 'json_ld_supplemental', metrics: m };
  }
  // SmartEditor main text (often not counted as <p>)
  if (m.naverModuleTextLength >= 180) {
    return { insufficient: false, reason: 'naver_module_text', metrics: m };
  }
  if (m.meaningfulBodyLength >= 340) {
    return { insufficient: false, reason: 'meaningful_body_bulk', metrics: m };
  }
  if (m.meaningfulBodyLength >= 200 && (m.paragraphLikeCount >= 2 || m.headingCount >= 1)) {
    return { insufficient: false, reason: 'structured_post_short', metrics: m };
  }
  if (m.paragraphLikeCount >= 2 && m.meaningfulBodyLength >= 150) {
    return { insufficient: false, reason: 'paragraphs_ok', metrics: m };
  }
  if (m.naverModuleBlockCount >= 4 && m.meaningfulBodyLength >= 150) {
    return { insufficient: false, reason: 'naver_editor_blocks', metrics: m };
  }
  if (m.citationExtractedChunkCount >= 2 && m.meaningfulBodyLength >= 160) {
    return { insufficient: false, reason: 'citation_chunks_ok', metrics: m };
  }

  // Truly thin — safe to try PC
  if (m.meaningfulBodyLength < 95) {
    return { insufficient: true, reason: 'tiny_meaningful_body', metrics: m };
  }
  if (
    m.meaningfulBodyLength < 175 &&
    m.naverModuleTextLength < 85 &&
    m.paragraphLikeCount < 1 &&
    m.headingCount < 1 &&
    m.naverModuleBlockCount < 2
  ) {
    return { insufficient: true, reason: 'no_structure_minimal_text', metrics: m };
  }

  // Borderline: keep mobile (partially usable beats PC fallback for scoring consistency)
  return { insufficient: false, reason: 'borderline_prefer_mobile', metrics: m };
}

function mobileUrlForNaver(blogId: string, logNo: string): string {
  return `https://m.blog.naver.com/${encodeURIComponent(blogId)}/${encodeURIComponent(logNo)}`;
}

/**
 * PC / PostView / raw input only — never m.blog (mobile phase handles m.blog first).
 */
function buildNaverPcFallbackCandidates(
  inputUrl: string,
  normalizedUrl: string,
  blogId: string,
  logNo: string,
  mobileUrl: string
): string[] {
  const pc = `https://blog.naver.com/${encodeURIComponent(blogId)}/${encodeURIComponent(logNo)}`;
  const postView = `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(blogId)}&logNo=${encodeURIComponent(logNo)}`;
  let mobileKey = '';
  try {
    mobileKey = new URL(mobileUrl).href;
  } catch {
    /* ignore */
  }
  const raw = [inputUrl.trim(), pc, postView, normalizedUrl].filter(Boolean);
  const filtered = raw.filter((u) => {
    try {
      return new URL(u).href !== mobileKey;
    } catch {
      return true;
    }
  });
  return dedupeUrlStrings(filtered);
}

export type FetchHtmlForAnalysisResult = {
  html: string;
  usedFetchUrl: string;
  naverUsedPcFallback: boolean;
  naverMobileUsedHeadless: boolean;
  /** Set when non-Naver path used {@link fetchHtmlWithRobustTransport}. */
  fetchTransport?: HtmlFetchTransport;
};

/**
 * Try m.blog repeatedly, then headless m.blog, before any PC URL.
 */
async function fetchNaverMobileAggressive(
  mobileUrl: string,
  normalizedUrl: string,
  appOrigin?: string
): Promise<
  | { ok: true; html: string; naverMobileUsedHeadless: boolean }
  | { ok: false; lastError: string }
> {
  let lastErr = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const html = await fetchHtml(mobileUrl, appOrigin);
      const ev = evaluateNaverMobileHtml(html);
      if (!ev.insufficient) {
        return { ok: true, html, naverMobileUsedHeadless: false };
      }
      lastErr = `mobile_rejected:${ev.reason}`;
      console.warn(
        '[GEO_FETCH]',
        JSON.stringify({
          phase: 'naver_mobile',
          normalized_url: normalizedUrl,
          fetch_target_url: mobileUrl,
          attempt,
          via: 'server',
          ok: false,
          reason: lastErr,
        })
      );
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      console.warn(
        '[GEO_FETCH]',
        JSON.stringify({
          phase: 'naver_mobile',
          normalized_url: normalizedUrl,
          fetch_target_url: mobileUrl,
          attempt,
          via: 'server',
          ok: false,
          error: lastErr,
        })
      );
    }
    if (attempt < 2) await sleep(450);
  }

  try {
    const html = await fetchHtmlViaHeadless(mobileUrl);
    const evH = evaluateNaverMobileHtml(html);
    if (!evH.insufficient) {
      return { ok: true, html, naverMobileUsedHeadless: true };
    }
    lastErr = `headless_mobile_rejected:${evH.reason}`;
    console.warn(
      '[GEO_FETCH]',
      JSON.stringify({
        phase: 'naver_mobile',
        normalized_url: normalizedUrl,
        fetch_target_url: mobileUrl,
        via: 'headless',
        ok: false,
        reason: lastErr,
      })
    );
  } catch (e) {
    lastErr = e instanceof Error ? e.message : String(e);
    console.warn(
      '[GEO_FETCH]',
      JSON.stringify({
        phase: 'naver_mobile',
        normalized_url: normalizedUrl,
        fetch_target_url: mobileUrl,
        via: 'headless',
        ok: false,
        error: lastErr,
      })
    );
  }

  return { ok: false, lastError: lastErr };
}

export async function fetchHtmlWithNaverFallback(
  inputUrl: string,
  normalizedUrl: string,
  appOrigin?: string
): Promise<FetchHtmlForAnalysisResult> {
  const parsed =
    parseNaverBlogPostFromUrlString(normalizedUrl) ?? parseNaverBlogPostFromUrlString(inputUrl.trim());

  if (!parsed) {
    const { html, transport } = await fetchHtmlWithRobustTransport(normalizedUrl, appOrigin);
    return {
      html,
      usedFetchUrl: normalizedUrl,
      naverUsedPcFallback: false,
      naverMobileUsedHeadless: false,
      fetchTransport: transport,
    };
  }

  const { blogId, logNo } = parsed;
  const mobileUrl = mobileUrlForNaver(blogId, logNo);

  const mobilePhase = await fetchNaverMobileAggressive(mobileUrl, normalizedUrl, appOrigin);
  if (mobilePhase.ok) {
    return {
      html: mobilePhase.html,
      usedFetchUrl: mobileUrl,
      naverUsedPcFallback: false,
      naverMobileUsedHeadless: mobilePhase.naverMobileUsedHeadless,
    };
  }

  const candidates = buildNaverPcFallbackCandidates(inputUrl, normalizedUrl, blogId, logNo, mobileUrl);
  const attempts: Array<{ fetch_target_url: string; error: string }> = [];
  let lastErr: Error | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const fetchTargetUrl = candidates[i]!;
    try {
      const html = await fetchHtml(fetchTargetUrl, appOrigin);
      console.warn(
        '[GEO_FETCH_SUMMARY]',
        JSON.stringify({
          normalized_url: normalizedUrl,
          analysisFetchTargetUrl: fetchTargetUrl,
          naver_used_pc_fallback: true,
          naver_mobile_used_headless: false,
        })
      );
      return {
        html,
        usedFetchUrl: fetchTargetUrl,
        naverUsedPcFallback: true,
        naverMobileUsedHeadless: false,
      };
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      attempts.push({ fetch_target_url: fetchTargetUrl, error: lastErr.message });
      console.warn(
        '[GEO_FETCH]',
        JSON.stringify({
          phase: 'naver_pc_fallback',
          normalized_url: normalizedUrl,
          fetch_target_url: fetchTargetUrl,
          attempt: i + 1,
          total_candidates: candidates.length,
          ok: false,
          error: lastErr.message,
        })
      );
    }
  }

  console.error(
    '[GEO_FETCH]',
    JSON.stringify({
      normalized_url: normalizedUrl,
      ok: false,
      naver_used_pc_fallback: false,
      fetch_fallback_attempts: attempts,
    })
  );
  throw lastErr ?? new Error('HTML fetch failed for all Naver candidates');
}
