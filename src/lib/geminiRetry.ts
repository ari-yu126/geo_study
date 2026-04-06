/**
 * Implements quota-aware rate-limiting protection and graceful degradation for Gemini API calls.
 * - Rate-limit 429: retries with backoff when retrying can succeed.
 * - Quota-disabled 429: does not retry; returns typed fallback.
 */

/** 배치 크기 — Paid Tier 업그레이드 시 3~5로 상향 */
export const GEMINI_BATCH_SIZE = 1;
/** 배치/재시도 간 지연(ms) — Paid Tier 업그레이드 시 300~400으로 축소 */
export const GEMINI_RETRY_DELAY = 5000;

import { waitForGeminiRateLimitSlot } from './geminiGlobalRateLimiter';
import { isQuotaError, extractRetryAfterSeconds, setLlmCooldown } from './llmError';
import type { LlmFeature } from './analysisTypes';

/** 429가 rate-limit인지 (재시도 가능) vs quota-disabled인지 (재시도 불가) */
function isQuotaDisabled429(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const msg = String((err as { message?: string }).message ?? '').toLowerCase();
  return (
    msg.includes('limit: 0') ||
    msg.includes('limit = 0') ||
    (msg.includes('free_tier') && msg.includes('limit')) ||
    msg.includes('check your plan and billing') ||
    (msg.includes('quota exceeded') && msg.includes('0'))
  );
}

/** Rate-limit 429: RetryInfo.retryDelay 또는 "Please retry in" 포함 */
function isRateLimit429(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode;
  if (status !== 429) return false;
  const msg = String((err as { message?: string }).message ?? '');
  const hasRetryHint = extractRetryAfterSeconds(err) != null || /please retry in|retry after/i.test(msg);
  return !isQuotaDisabled429(err) && (hasRetryHint || !msg.includes('limit: 0'));
}

export interface WithGeminiRetryOptions {
  feature: LlmFeature;
  maxRetries?: number;
  /** ms to wait before each attempt (Gemini free-tier RPM). Use 0 for Groq. Default 5000. */
  preCallDelayMs?: number;
}

export type GeminiRetryResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: 'skipped_quota'; retryAfterSec?: number; message?: string }
  | { ok: false; status: 'error'; message?: string };

/** Exponential backoff: GEMINI_RETRY_DELAY 기준 */
const BACKOFF_MS = [GEMINI_RETRY_DELAY, GEMINI_RETRY_DELAY * 2, GEMINI_RETRY_DELAY * 4];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Wraps a Gemini API call with quota-aware retry logic.
 * - Rate-limit 429: retries up to maxRetries with backoff.
 * - Quota-disabled 429: no retry; returns skipped_quota.
 */
export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  options: WithGeminiRetryOptions
): Promise<GeminiRetryResult<T>> {
  const { feature, maxRetries = 3, preCallDelayMs = 0 } = options;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await waitForGeminiRateLimitSlot(`retry:${feature}`);
      if (preCallDelayMs > 0) {
        await new Promise((res) => setTimeout(res, preCallDelayMs));
      }
      const data = await fn();
      return { ok: true, data };
    } catch (err) {
      lastErr = err;
      // If this is any quota/rate-limit (429) situation, do not retry here.
      if (isQuotaError(err)) {
        const retryAfterSec = extractRetryAfterSeconds(err) ?? 60;
        // Set short cooldown so subsequent analyses skip Gemini briefly.
        setLlmCooldown(retryAfterSec);
        console.warn(`[GEMINI] ${feature} quota/rate-limit detected — skip retries and set cooldown ${retryAfterSec}s`);
        return {
          ok: false,
          status: 'skipped_quota',
          retryAfterSec,
          message: undefined,
        };
      }

      // For non-quota transient errors, allow retry with backoff.
      if (attempt < maxRetries) {
        const delayMs = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        console.warn(`[GEMINI] ${feature} transient error — retry ${attempt + 1}/${maxRetries} in ${delayMs}ms`, {
          err: lastErr,
        });
        await sleep(delayMs);
        continue;
      }
      // Exhausted retries for transient errors; break and return error.
      break;
    }
  }

  return {
    ok: false,
    status: 'error',
    message: lastErr instanceof Error ? lastErr.message : String(lastErr),
  };
}
