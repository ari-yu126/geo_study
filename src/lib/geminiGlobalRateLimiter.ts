/**
 * Process-global minimum spacing between Gemini generateContent calls (same Node process).
 * Reduces burst 429s. Serverless: each instance has its own clock; still helps per instance.
 */

const MIN_GAP_MS = 2000;

let lastGeminiCallAt = 0;

/**
 * Waits until at least MIN_GAP_MS have passed since the previous Gemini call in this process,
 * then records the call time. Invoke immediately before any Google Generative AI generateContent.
 */
export async function waitForGeminiRateLimitSlot(label?: string): Promise<void> {
  const now = Date.now();
  const diff = now - lastGeminiCallAt;
  if (lastGeminiCallAt > 0 && diff < MIN_GAP_MS) {
    const waitMs = MIN_GAP_MS - diff;
    console.log(
      '[GEMINI_RATE_LIMIT]',
      JSON.stringify({
        waitedMs: waitMs,
        label: label ?? 'unknown',
        reason: 'min_gap_between_calls',
        minGapMs: MIN_GAP_MS,
      })
    );
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
  }
  lastGeminiCallAt = Date.now();
}

/** For tests or rare reset scenarios */
export function resetGeminiRateLimiterForTests(): void {
  lastGeminiCallAt = 0;
}
