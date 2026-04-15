"use client";

import type { AiWritingExamplesData } from "@/lib/aiWritingExamplesTypes";

const PREFIX = "geo-ai-writing-v2:";
const TTL_MS = 24 * 60 * 60 * 1000;

export type CachedAiWritingEntry = {
  data: AiWritingExamplesData;
  savedAt: number;
  notice?: string | null;
  degraded?: boolean;
};

/**
 * In embedded / third-party / partitioned contexts, merely accessing `window.sessionStorage`
 * can throw (e.g. "Third party storage is not available"), before any getItem/setItem call.
 */
function getSessionStorageSafe(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function cacheStorageKey(normalizedUrl: string, guideSig: string): string {
  return `${PREFIX}${normalizedUrl}::${guideSig}`;
}

export function readAiWritingCache(normalizedUrl: string, guideSig: string): CachedAiWritingEntry | null {
  const storage = getSessionStorageSafe();
  if (!storage) return null;
  try {
    const raw = storage.getItem(cacheStorageKey(normalizedUrl, guideSig));
    if (!raw) return null;
    const o = JSON.parse(raw) as CachedAiWritingEntry;
    if (!o?.data || typeof o.savedAt !== "number") return null;
    if (Date.now() - o.savedAt > TTL_MS) {
      storage.removeItem(cacheStorageKey(normalizedUrl, guideSig));
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
  const storage = getSessionStorageSafe();
  if (!storage) return;
  try {
    const entry: CachedAiWritingEntry = {
      data: payload.data,
      savedAt: Date.now(),
      notice: payload.notice ?? null,
      degraded: payload.degraded,
    };
    storage.setItem(cacheStorageKey(normalizedUrl, guideSig), JSON.stringify(entry));
  } catch {
    /* storage full */
  }
}

export function clearAiWritingCache(normalizedUrl: string, guideSig?: string): void {
  const storage = getSessionStorageSafe();
  if (!storage) return;
  try {
    if (guideSig != null) {
      storage.removeItem(cacheStorageKey(normalizedUrl, guideSig));
      return;
    }
    const prefix = `${PREFIX}${normalizedUrl}::`;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) storage.removeItem(k);
  } catch {
    /* ignore */
  }
}
