/**
 * Maps canonical {@link normalizeUrl} output (cache/DB identity) to the URL used for outbound HTTP fetches.
 *
 * Identity normalization strips `www`, lowercases host, and sorts product/search identity query params.
 * Some origins answer more predictably when the request targets the `www` hostname explicitly; the
 * normalized string stays apex for deduplication while fetch uses the network-preferred form.
 */

/** Exact hostnames (already lowercased, no `www.`) where fetch should use `www.{host}`. */
const FETCH_PREFER_WWW_EXACT_HOST = new Set<string>(['amoremall.com']);

export function resolveFetchTargetUrl(normalizedUrl: string): string {
  const trimmed = typeof normalizedUrl === 'string' ? normalizedUrl.trim() : '';
  if (!trimmed) return normalizedUrl;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return trimmed;
    }
    const host = u.hostname.toLowerCase();
    if (FETCH_PREFER_WWW_EXACT_HOST.has(host) && !host.startsWith('www.')) {
      u.hostname = `www.${host}`;
    }
    return u.toString();
  } catch {
    return trimmed;
  }
}
