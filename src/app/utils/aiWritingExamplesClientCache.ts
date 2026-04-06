"use client";

import type { AiWritingExamplesData } from "@/lib/aiWritingExamplesTypes";

const PREFIX = "geo-ai-writing-v1:";
const TTL_MS = 24 * 60 * 60 * 1000;

export type CachedAiWritingEntry = {
  data: AiWritingExamplesData;
  savedAt: number;
  notice?: string | null;
  degraded?: boolean;
};

export function readAiWritingCache(normalizedUrl: string): CachedAiWritingEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PREFIX + normalizedUrl);
    if (!raw) return null;
    const o = JSON.parse(raw) as CachedAiWritingEntry;
    if (!o?.data || typeof o.savedAt !== "number") return null;
    if (Date.now() - o.savedAt > TTL_MS) {
      sessionStorage.removeItem(PREFIX + normalizedUrl);
      return null;
    }
    return o;
  } catch {
    return null;
  }
}

export function writeAiWritingCache(
  normalizedUrl: string,
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
    sessionStorage.setItem(PREFIX + normalizedUrl, JSON.stringify(entry));
  } catch {
    /* storage full */
  }
}

export function clearAiWritingCache(normalizedUrl: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(PREFIX + normalizedUrl);
  } catch {
    /* ignore */
  }
}
