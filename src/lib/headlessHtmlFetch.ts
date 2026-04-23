import { chromium, type Browser } from 'playwright';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * When `GEO_HEADLESS_FETCH=0`, do not launch Playwright anywhere (transport fallback, Naver mobile, thin-extract retry).
 * Use on serverless hosts that cannot ship Chromium, or when browsers are not installed.
 */
export function isPlaywrightHeadlessGloballyEnabled(): boolean {
  return process.env.GEO_HEADLESS_FETCH !== '0';
}

function rewritePlaywrightMissingExecutableError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (/Executable doesn't exist|playwright install/i.test(msg)) {
    return new Error(
      'Playwright Chromium is not installed on this host (run `npx playwright install chromium` on the machine or image). Many serverless platforms cannot bundle browsers; set GEO_HEADLESS_FETCH=0 to skip headless fallbacks.',
      { cause: err instanceof Error ? err : undefined }
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

/**
 * SPA / client-rendered review sites (e.g. RTINGS) often ship almost no <p> in the raw HTTP HTML.
 * Headless Chromium runs JS and yields a DOM comparable to a real browser.
 */
export async function fetchHtmlViaHeadless(
  url: string,
  options?: { timeoutMs?: number; postLoadWaitMs?: number }
): Promise<string> {
  if (!isPlaywrightHeadlessGloballyEnabled()) {
    throw new Error('Playwright headless is disabled (GEO_HEADLESS_FETCH=0).');
  }

  const timeoutMs = options?.timeoutMs ?? 55_000;
  const postLoadWaitMs = options?.postLoadWaitMs ?? 4_500;

  let browser: Browser | undefined;
  try {
    try {
      browser = await chromium.launch({ headless: true });
    } catch (launchErr) {
      throw rewritePlaywrightMissingExecutableError(launchErr);
    }
    const context = await browser.newContext({
      userAgent: DEFAULT_UA,
      viewport: { width: 1280, height: 900 },
      locale: 'en-US',
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForTimeout(postLoadWaitMs);
    try {
      await page.waitForSelector('main p, article p, [role="main"] p', { timeout: 12_000 });
    } catch {
      /* SPA may still render without classic <p> in time — continue */
    }
    const html = await page.content();
    await context.close();
    return html;
  } finally {
    if (browser) await browser.close();
  }
}
