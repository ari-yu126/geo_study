/**
 * Canonical URL for cache keys and DB normalized_url.
 * Strips leading `www.` from host (stable identity); actual HTTP fetch may use `www` via
 * {@link resolveFetchTargetUrl} — keep identity and network layers separate.
 * Strips query, hash (including #:~:text=), lowercases host, https, trailing slash (non-root).
 * YouTube URLs collapse to https://www.youtube.com/watch?v={id} so ?v= is preserved semantically.
 * Search/listing pages (path segment `search`): preserves identity params (e.g. keyword, q) so SERPs stay distinct.
 * Product detail pages (path contains `/product/detail`): preserves commerce identity params (e.g. onlineProdSn)
 * and drops tracking-only query keys so the analyzed SKU stays distinct in cache/DB.
 */

import { canonicalizePlatformUrl } from './canonicalizePlatformUrl';
import { extractVideoId } from './youtubeMetadataExtractor';

function geoNormalizeDebug(): boolean {
  if (typeof process === 'undefined') return false;
  return (
    process.env.GEO_DEBUG === '1' ||
    process.env.NEXT_PUBLIC_GEO_DEBUG === '1'
  );
}

/**
 * Path segment is literally `search` (e.g. /n/search, /goods/search). Not "research".
 */
function pathnameHasSearchSegment(pathname: string): boolean {
  return pathname
    .toLowerCase()
    .split('/')
    .filter(Boolean)
    .some((seg) => seg === 'search');
}

/** Query keys that define which SERP/listing is shown (cache key must include them). */
const SEARCH_IDENTITY_PARAM_KEYS = [
  'keyword',
  'q',
  'query',
  'k',
  'search_word',
  'searchword',
  'kw',
] as const;

function collectSearchIdentityParams(source: URL): URLSearchParams | null {
  if (!pathnameHasSearchSegment(source.pathname)) return null;
  const out = new URLSearchParams();
  for (const key of SEARCH_IDENTITY_PARAM_KEYS) {
    const v = source.searchParams.get(key);
    if (v != null && v.trim() !== '') {
      out.set(key, v);
    }
  }
  return out.size > 0 ? out : null;
}

/** Paths like .../product/detail — query often holds the real SKU (path alone is a shell). */
function pathnameLooksLikeProductDetailPage(pathname: string): boolean {
  return /\/product\/detail(?:\/|$)/i.test(pathname);
}

/**
 * Query keys that identify which product is shown (case-insensitive match on key).
 * Tracking/recommend params are intentionally omitted.
 */
const PRODUCT_DETAIL_IDENTITY_PARAM_KEYS_LC = new Set([
  'onlineprodsn',
  'onlineprodcode',
  'item_value',
  'goodsno',
  'goods_no',
  'productid',
  'product_id',
  'itemid',
  'item_id',
  'prdno',
  'prd_no',
  'prdsn',
  'sku',
  'variant',
  'optionid',
  'option_id',
]);

function collectProductDetailIdentityParams(source: URL): URLSearchParams | null {
  if (!pathnameLooksLikeProductDetailPage(source.pathname)) return null;
  const pairs: Array<[string, string]> = [];
  for (const [key, value] of source.searchParams) {
    if (value == null || value.trim() === '') continue;
    if (PRODUCT_DETAIL_IDENTITY_PARAM_KEYS_LC.has(key.toLowerCase())) {
      pairs.push([key, value]);
    }
  }
  if (pairs.length === 0) return null;
  pairs.sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()));
  const out = new URLSearchParams();
  for (const [k, v] of pairs) {
    out.set(k, v);
  }
  return out;
}

/**
 * Removes mistaken `forceRefresh` / `force_refresh` flags accidentally merged into the URL string
 * (e.g. copy-paste, bad query concatenation, or pasted inside #:~:text= fragments).
 * Also strips app-only `debug` flags merged into the analyzed target (e.g. `.../223632465989&debug=true`
 * when `&debug` was meant for the app query, not the blog path).
 * Safe to run before {@link normalizeUrl}, router query, and iframe/proxy `url` params.
 */
export function sanitizeIncomingAnalyzeUrl(raw: string): string {
  let s = (raw ?? '').trim();
  if (!s) return s;

  // Glued after logNo / path digits (malformed: no `?` before `&debug`)
  s = s.replace(/(\d{4,})&debug=(?:true|false|1|0)\b/gi, '$1');

  // Encoded mistaken tails (e.g. glued after path or inside fragments)
  s = s.replace(/%26debug%3D(?:true|false|1|0)(?=%|$|[&#])/gi, '');
  s = s.replace(/%3Fdebug%3D(?:true|false|1|0)\b/gi, '');
  s = s.replace(/%26forceRefresh%3D(?:true|false|1|0)(?=%|$|[&#])/gi, '');
  s = s.replace(/%26force_refresh%3D(?:true|false|1|0)(?=%|$|[&#])/gi, '');
  s = s.replace(/%3FforceRefresh%3D(?:true|false|1|0)\b/gi, '');
  s = s.replace(/%3Fforce_refresh%3D(?:true|false|1|0)\b/gi, '');

  s = s.replace(/[&?]debug=(?:true|false|1|0)\s*$/i, '');
  s = s.replace(/[&?]forceRefresh=(?:true|false|1|0)\s*$/i, '');
  s = s.replace(/[&?]force_refresh=(?:true|false|1|0)\s*$/i, '');

  // Anywhere in the string (including hash / text fragments)
  s = s.replace(/\?debug=(?:true|false|1|0)\b/gi, '');
  s = s.replace(/&debug=(?:true|false|1|0)\b/gi, '');
  s = s.replace(/\?forceRefresh=(?:true|false|1|0)\b/gi, '');
  s = s.replace(/&forceRefresh=(?:true|false|1|0)\b/gi, '');
  s = s.replace(/\?force_refresh=(?:true|false|1|0)\b/gi, '');
  s = s.replace(/&force_refresh=(?:true|false|1|0)\b/gi, '');

  try {
    const u = new URL(s);
    u.searchParams.delete('debug');
    u.searchParams.delete('forceRefresh');
    u.searchParams.delete('force_refresh');
    return u.toString();
  } catch {
    s = s.replace(/[&?]debug=(?:true|false|1|0)\b/gi, '');
    s = s.replace(/[&?]forceRefresh=(?:true|false|1|0)\b/gi, '');
    s = s.replace(/[&?]force_refresh=(?:true|false|1|0)\b/gi, '');
    s = s.replace(/\?&+/g, '?').replace(/&&+/g, '&').replace(/[?&]$/g, '');
    return s.trim();
  }
}

export function normalizeUrl(rawUrl: string): string {
  const cleanedInput = sanitizeIncomingAnalyzeUrl(rawUrl);
  try {
    const vid = extractVideoId(cleanedInput);
    if (vid) {
      const normalizedUrl = `https://www.youtube.com/watch?v=${vid}`;
      if (geoNormalizeDebug()) {
        console.log('[normalizeUrl]', rawUrl, '->', normalizedUrl);
      }
      return normalizedUrl;
    }

    const platformCanonical = canonicalizePlatformUrl(cleanedInput);
    const url = new URL(platformCanonical);
    const searchIdentity = collectSearchIdentityParams(url);
    const productDetailIdentity = collectProductDetailIdentityParams(url);

    url.search = '';
    url.hash = '';

    url.protocol = 'https:';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');

    let normalized = url.toString();

    if (normalized.endsWith('/') && url.pathname !== '/') {
      normalized = normalized.slice(0, -1);
    }

    if (searchIdentity) {
      const withQuery = new URL(normalized);
      for (const [k, v] of searchIdentity) {
        withQuery.searchParams.set(k, v);
      }
      normalized = withQuery.toString();
    } else if (productDetailIdentity) {
      const withQuery = new URL(normalized);
      for (const [k, v] of productDetailIdentity) {
        withQuery.searchParams.set(k, v);
      }
      normalized = withQuery.toString();
    }

    if (geoNormalizeDebug()) {
      console.log('[normalizeUrl]', rawUrl, '->', normalized);
    }
    return normalized;
  } catch {
    if (geoNormalizeDebug()) {
      console.log('[normalizeUrl]', rawUrl, '->', cleanedInput, '(parse failed)');
    }
    return cleanedInput;
  }
}
