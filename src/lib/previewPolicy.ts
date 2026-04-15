/**
 * Which origins must not be loaded inside our localhost /proxy iframe (SPA + storage / origin expectations).
 * Analysis stays server-side; only the client preview is affected.
 */

import type { PageType } from './analysisTypes';

/**
 * Apex hostnames that skip live iframe immediately (no white-screen flash).
 * Complemented by client-side iframe error / unhandledrejection heuristics (see previewRuntimeFallback).
 */
export const LIVE_PREVIEW_BLOCKED_HOSTS = new Set<string>(['amoremall.com']);

export function previewPolicyHostname(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * When true, skip /api/proxy and any remote origin in iframe — show static summary + "open in new tab" only.
 * Host blocklist applies regardless of `pageType` so misclassified editorial URLs on known SPA malls still skip the iframe.
 */
export function shouldUseStaticPreviewOnly(input: {
  pageType?: PageType;
  url: string;
  normalizedUrl: string;
}): boolean {
  const h =
    previewPolicyHostname(input.url) || previewPolicyHostname(input.normalizedUrl);
  return h.length > 0 && LIVE_PREVIEW_BLOCKED_HOSTS.has(h);
}
