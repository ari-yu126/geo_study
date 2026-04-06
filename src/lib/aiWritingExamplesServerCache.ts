/**
 * Server-side cache for AI writing examples (normalizedUrl + pageType + locale).
 * Complements client sessionStorage; reduces repeat Gemini calls across sessions/devices on same instance.
 */

import { normalizeUrl } from './normalizeUrl';
import type { AiWritingExamplesApiResponse } from './aiWritingExamplesTypes';

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 300;

type Entry = { savedAt: number; payload: Extract<AiWritingExamplesApiResponse, { aiAvailable: true }> };

const store = new Map<string, Entry>();

function cacheKey(url: string, pageType: string, locale: string): string {
  return `${normalizeUrl(url)}::${pageType}::${locale}`;
}

function pruneIfNeeded(): void {
  if (store.size <= MAX_ENTRIES) return;
  const entries = [...store.entries()].sort((a, b) => a[1].savedAt - b[1].savedAt);
  const toDrop = store.size - MAX_ENTRIES + 40;
  for (let i = 0; i < toDrop && i < entries.length; i++) {
    store.delete(entries[i]![0]);
  }
}

export function getCachedAiWritingExamples(
  url: string,
  pageType: string,
  locale: 'ko' | 'en'
): Extract<AiWritingExamplesApiResponse, { aiAvailable: true }> | null {
  const key = cacheKey(url, pageType, locale);
  const row = store.get(key);
  if (!row) return null;
  if (Date.now() - row.savedAt > TTL_MS) {
    store.delete(key);
    return null;
  }
  return row.payload;
}

/** Cache successful responses (including quota template fallback with data). */
export function setCachedAiWritingExamples(
  url: string,
  pageType: string,
  locale: 'ko' | 'en',
  payload: Extract<AiWritingExamplesApiResponse, { aiAvailable: true }>
): void {
  const key = cacheKey(url, pageType, locale);
  store.set(key, { savedAt: Date.now(), payload });
  pruneIfNeeded();
}
