/**
 * LLM(Gemini) 호출 에러 핸들링 유틸.
 * 429 / Quota exceeded 시 스킵 처리, Retry-After 추출, 쿨다운 캐시.
 */

let cooldownUntilMs = 0;

/** 429 발생 시 retryAfterSec 동안 Gemini 호출 즉시 스킵 */
export function setLlmCooldown(retryAfterSec: number): void {
  cooldownUntilMs = Date.now() + Math.min(300, Math.max(1, retryAfterSec)) * 1000;
}

/** 쿨다운 중이면 true — 호출 전 체크하여 불필요한 429 연쇄 방지 */
export function isLlmCooldown(): boolean {
  return Date.now() < cooldownUntilMs;
}

/** 쿨다운 남은 초 (UI 표시용) */
export function getCooldownRemainingSec(): number | null {
  if (Date.now() >= cooldownUntilMs) return null;
  return Math.ceil((cooldownUntilMs - Date.now()) / 1000);
}

export function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const msg = String((err as { message?: string }).message ?? '').toLowerCase();
  const status = (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode;
  if (status === 429) return true;
  return (
    msg.includes('429') ||
    msg.includes('quota exceeded') ||
    msg.includes('resource exhausted') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests')
  );
}

/** RetryInfo.retryDelay 또는 retry-after 파싱 (예: "55s" -> 55) */
export function extractRetryAfterSeconds(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const o = err as Record<string, unknown>;
  const msg = String(o.message ?? '');

  // google.rpc.RetryInfo retryDelay "55s" 패턴
  const match = msg.match(/(\d+)\s*s(?:ec(?:ond)?s?)?/i) ?? msg.match(/retry[-\s]?after[:\s]+(\d+)/i);
  if (match) return Math.min(300, Math.max(1, parseInt(match[1], 10)));

  const details = o.errorDetails ?? o.details ?? o.metadata;
  if (details && typeof details === 'object') {
    const d = details as Record<string, unknown>;
    const delay = d.retryDelay ?? d.retry_after;
    if (typeof delay === 'string') {
      const m = delay.match(/(\d+)/);
      if (m) return Math.min(300, Math.max(1, parseInt(m[1], 10)));
    }
    if (typeof delay === 'number' && delay > 0) return Math.min(300, Math.floor(delay));
  }
  return null;
}

export type LlmStatusType = 'ok' | 'skipped_quota' | 'error';

export interface LlmStatusResult {
  status: LlmStatusType;
  retryAfterSec?: number;
  message?: string;
}

export function toLlmStatus(err: unknown): LlmStatusResult {
  if (isQuotaError(err)) {
    const retryAfterSec = extractRetryAfterSeconds(err);
    return {
      status: 'skipped_quota',
      retryAfterSec: retryAfterSec ?? undefined,
      message: (err as Error)?.message,
    };
  }
  return {
    status: 'error',
    message: err instanceof Error ? err.message : String(err),
  };
}
