"use client";

import { getAiWritingGuideCacheSignature, type AiWritingExamplesData } from "@/lib/aiWritingExamplesTypes";

const PREFIX = "geo-ai-writing-v2:";
const TTL_MS = 24 * 60 * 60 * 1000;

export type CachedAiWritingEntry = {
  data: AiWritingExamplesData;
  savedAt: number;
  notice?: string | null;
  degraded?: boolean;
};

function cacheStorageKey(normalizedUrl: string, guideSig: string): string {
  return `${PREFIX}${normalizedUrl}::${guideSig}`;
}

export function readAiWritingCache(normalizedUrl: string, guideSig: string): CachedAiWritingEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(cacheStorageKey(normalizedUrl, guideSig));
    if (!raw) return null;
    const o = JSON.parse(raw) as CachedAiWritingEntry;
    if (!o?.data || typeof o.savedAt !== "number") return null;
    if (Date.now() - o.savedAt > TTL_MS) {
      sessionStorage.removeItem(cacheStorageKey(normalizedUrl, guideSig));
      return null;
    }
    return o;
  } catch {
    return null;
  }
}

export function writeAiWritingCache(
  normalizedUrl: string,
  guideSig: string,
  payload: Pick<CachedAiWritingEntry, "data"> & Partial<Omit<CachedAiWritingEntry, "savedAt" | "data">>
): void {
  if (typeof window === "undefined") return;
  try {
    const entry: CachedAiWritingEntry = {
      data: payload.data,
      savedAt: Date.now(),
      notice: payload.notice ?? null,
      degraded: payload.degraded,
    };
    sessionStorage.setItem(cacheStorageKey(normalizedUrl, guideSig), JSON.stringify(entry));
  } catch {
    /* storage full */
  }
}

export function clearAiWritingCache(normalizedUrl: string, guideSig?: string): void {
  if (typeof window === "undefined") return;
  try {
    if (guideSig != null) {
      sessionStorage.removeItem(cacheStorageKey(normalizedUrl, guideSig));
      return;
    }
    const prefix = `${PREFIX}${normalizedUrl}::`;
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
