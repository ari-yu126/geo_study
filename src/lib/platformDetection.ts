/**
 * Hosting platform detection (URL host/path first).
 * Separate from pageType and editorialSubtype — used for guidance and metadata only.
 */

import type { PageType, PlatformType } from './analysisTypes';
import { isYouTubeUrl } from './youtubeMetadataExtractor';

/** Substrings in hostname (lowercase) that indicate a commerce / marketplace surface */
const COMMERCE_HOST_MARKERS = [
  'coupang.com',
  'gmarket.co.kr',
  '11st.co.kr',
  'auction.co.kr',
  'danawa.com',
  'shopping.naver.com',
  'smartstore.naver.com',
  'brand.naver.com',
  'amazon.',
  'ebay.',
  'shopify.com',
  'walmart.com',
  'target.com',
  'bestbuy.com',
] as const;

function isCommerceHost(hostLower: string): boolean {
  for (const m of COMMERCE_HOST_MARKERS) {
    if (hostLower.includes(m)) return true;
  }
  return false;
}

export interface DetectPlatformOptions {
  /** When host is ambiguous, commerce pageType can reinforce commerce_platform */
  pageType?: PageType;
}

/**
 * Detect hosting platform from URL (and optionally pageType). Host/path rules first.
 */
export function detectHostingPlatform(url: string, options?: DetectPlatformOptions): PlatformType {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'unknown';
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    return 'unknown';
  }

  if (isYouTubeUrl(url)) {
    return 'youtube';
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'blog.naver.com' || host === 'm.blog.naver.com') {
    return 'naver_blog';
  }

  if (host === 'tistory.com' || host.endsWith('.tistory.com')) {
    return 'tistory';
  }

  if (host === 'brunch.co.kr' || host.endsWith('.brunch.co.kr')) {
    return 'brunch';
  }

  if (host === 'wordpress.com' || host.endsWith('.wordpress.com')) {
    return 'wordpress';
  }

  if (isCommerceHost(host)) {
    return 'commerce_platform';
  }

  if (options?.pageType === 'commerce') {
    return 'commerce_platform';
  }

  return 'self_hosted';
}
