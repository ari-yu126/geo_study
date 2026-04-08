/**
 * Platform-specific URL canonicalization before normalizeUrl / fetch / cache keys.
 * Naver blog: PC and query-style URLs → mobile post URL for consistent HTML extraction.
 */

function stripLeadingWwwHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

/** Fix `.../12345&debug=true` where `&debug` was glued into the path segment (app query pollution). */
function stripDebugGluedAfterDigits(s: string): string {
  return s.replace(/(\d{4,})&debug=(?:true|false|1|0)\b/gi, '$1');
}

function coerceNaverLogNoSegment(seg: string): string | null {
  const t = seg.trim();
  if (/^\d+$/.test(t)) return t;
  const noDebug = t.replace(/&debug(?:=[^&]*)?.*$/i, '');
  if (/^\d+$/.test(noDebug)) return noDebug;
  return null;
}

export function tryParseNaverBlogPostId(url: URL): { blogId: string; logNo: string } | null {
  const host = stripLeadingWwwHost(url.hostname);
  if (host !== 'blog.naver.com' && host !== 'm.blog.naver.com') {
    return null;
  }

  const pathname = url.pathname || '/';
  const lowerPath = pathname.toLowerCase();
  const segments = pathname.split('/').filter(Boolean);
  const lastSeg = segments[segments.length - 1] ?? '';
  const isPostView =
    lastSeg.toLowerCase() === 'postview.naver' || lowerPath.includes('postview.naver');

  if (isPostView) {
    const blogId = url.searchParams.get('blogId') ?? url.searchParams.get('blogid');
    const logNo = url.searchParams.get('logNo') ?? url.searchParams.get('logno');
    if (blogId?.trim() && logNo?.trim()) {
      return { blogId: blogId.trim(), logNo: logNo.trim() };
    }
    return null;
  }

  if (segments.length >= 2) {
    const blogId = decodeURIComponent(segments[0]!);
    const rawSeg = decodeURIComponent(segments[1]!);
    const logNo = coerceNaverLogNoSegment(rawSeg);
    if (!logNo || !/^\d+$/.test(logNo)) {
      return null;
    }
    if (!blogId) {
      return null;
    }
    return { blogId, logNo };
  }

  return null;
}

/**
 * Normalize known platform URLs to a single fetch-friendly form.
 * Naver blog posts → https://m.blog.naver.com/{blogId}/{logNo}
 */
export function canonicalizePlatformUrl(rawUrl: string): string {
  const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!trimmed) {
    return rawUrl;
  }
  const pre = stripDebugGluedAfterDigits(trimmed);
  try {
    const u = new URL(pre);
    const parsed = tryParseNaverBlogPostId(u);
    if (!parsed) {
      return pre;
    }
    const { blogId, logNo } = parsed;
    if (!/^\d+$/.test(logNo)) {
      return pre;
    }
    return `https://m.blog.naver.com/${encodeURIComponent(blogId)}/${encodeURIComponent(logNo)}`;
  } catch {
    return pre;
  }
}

/** Parse blogId + logNo from any supported Naver blog post URL string, or null if not a post URL. */
export function parseNaverBlogPostFromUrlString(rawUrl: string): { blogId: string; logNo: string } | null {
  const pre = stripDebugGluedAfterDigits(rawUrl.trim());
  try {
    return tryParseNaverBlogPostId(new URL(pre));
  } catch {
    return null;
  }
}
