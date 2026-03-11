/**
 * Implements quota-aware rate-limiting protection and graceful degradation for Gemini API calls.
 * - Rate-limit 429: retries with backoff when retrying can succeed.
 * - Quota-disabled 429: does not retry; returns typed fallback.
 */

/** 배치 크기 — Paid Tier 업그레이드 시 3~5로 상향 */
export const GEMINI_BATCH_SIZE = 1;
/** 배치/재시도 간 지연(ms) — Paid Tier 업그레이드 시 300~400으로 축소 */
export const GEMINI_RETRY_DELAY = 1000;

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
  const { feature, maxRetries = 3 } = options;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const data = await fn();
      return { ok: true, data };
    } catch (err) {
      lastErr = err;

      if (isQuotaDisabled429(err)) {
        const retryAfterSec = extractRetryAfterSeconds(err) ?? 60;
        setLlmCooldown(retryAfterSec);
        console.warn(`[GEMINI] ${feature} quota-disabled 429 — no retry`, { retryAfterSec });
        return {
          ok: false,
          status: 'skipped_quota',
          retryAfterSec,
          message: '현재 Gemini 무료 쿼터가 비활성화되어 AI 기능이 제한됩니다. 결제/쿼터 설정을 확인해주세요.',
        };
      }

      if (isRateLimit429(err) && attempt < maxRetries) {
        const retryAfterSec = extractRetryAfterSeconds(err);
        const delayMs = retryAfterSec != null
          ? retryAfterSec * 1000
          : BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        console.warn(`[GEMINI] ${feature} rate-limit 429 — retry ${attempt + 1}/${maxRetries} in ${delayMs}ms`);
        await sleep(delayMs);
        continue;
      }

      if (isQuotaError(err)) {
        const retryAfterSec = extractRetryAfterSeconds(err);
        if (retryAfterSec != null) setLlmCooldown(retryAfterSec);
        return {
          ok: false,
          status: 'skipped_quota',
          retryAfterSec: retryAfterSec ?? undefined,
          message: '요청이 많아 잠시 후 다시 시도해주세요.',
        };
      }

      break;
    }
  }

  return {
    ok: false,
    status: 'error',
    message: lastErr instanceof Error ? lastErr.message : String(lastErr),
  };
}
