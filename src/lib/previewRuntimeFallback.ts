/**
 * Heuristics to switch from live iframe preview to static summary when the embedded
 * document throws (same-origin proxy only; cross-origin iframes cannot be instrumented).
 */

/** Timestamps of non-instant failures within the burst window. */
const burstTimes: number[] = [];

const BURST_WINDOW_MS = 7000;
/** How many error/rejection signals in the window trigger fallback (no instant keyword match). */
const BURST_THRESHOLD = 3;

export function resetPreviewRuntimeErrorBudget(): void {
  burstTimes.length = 0;
}

function normalizeSignal(raw: string): string {
  return (raw ?? '').slice(0, 1200).toLowerCase();
}

/** High-confidence strings → switch immediately (one event). */
function matchesInstantFallback(text: string): boolean {
  if (text.includes('third party storage') && text.includes('not available')) return true;
  if (text.includes('getinitialprops')) return true;
  if (text.includes('client-side exception')) return true;
  if (text.includes('client side exception')) return true;
  if (text.includes('minified react error')) return true;
  if (text.includes('next.js') && text.includes('client-side')) return true;
  return false;
}

/**
 * Returns true if we should stop live preview and show the static card.
 * Call from iframe `error` / `unhandledrejection` handlers (same-origin only).
 */
export function notePreviewRuntimeFailure(rawMessage: string): boolean {
  const trimmed = (rawMessage ?? '').trim();
  if (trimmed.length < 3) return false;

  const text = normalizeSignal(trimmed);
  if (matchesInstantFallback(text)) return true;

  const now = Date.now();
  while (burstTimes.length > 0 && now - burstTimes[0]! > BURST_WINDOW_MS) {
    burstTimes.shift();
  }
  burstTimes.push(now);
  return burstTimes.length >= BURST_THRESHOLD;
}
