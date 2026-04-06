/**
 * Canonical URL for cache keys and DB normalized_url.
 * Strips query, hash (including #:~:text=), lowercases host, https, trailing slash (non-root).
 * YouTube URLs collapse to https://www.youtube.com/watch?v={id} so ?v= is preserved semantically.
 */

import { extractVideoId } from './youtubeMetadataExtractor';

export function normalizeUrl(rawUrl: string): string {
  try {
    const vid = extractVideoId(rawUrl);
    if (vid) {
      const normalizedUrl = `https://www.youtube.com/watch?v=${vid}`;
      console.log('[normalizeUrl]', rawUrl, '->', normalizedUrl);
      return normalizedUrl;
    }

    const url = new URL(rawUrl);

    url.search = '';
    url.hash = '';

    url.protocol = 'https:';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');

    let normalized = url.toString();

    if (normalized.endsWith('/') && url.pathname !== '/') {
      normalized = normalized.slice(0, -1);
    }

    console.log('[normalizeUrl]', rawUrl, '->', normalized);
    return normalized;
  } catch {
    console.log('[normalizeUrl]', rawUrl, '->', rawUrl, '(parse failed)');
    return rawUrl;
  }
}
