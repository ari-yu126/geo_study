import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { chromium } from 'playwright';
import { extractMetaAndContent } from '@/lib/htmlAnalyzer';
import { detectPageTypeWithLog } from '@/lib/pageTypeDetection';
import { loadActiveScoringConfig } from '@/lib/scoringConfigLoader';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const url = body?.url;
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'url required' }, { status: 400 });
    }

    // 1) get before-render analysis by calling internal analyze route
    const base = (process.env.GEO_ANALYZER_BASE_URL ?? (req.nextUrl.origin));
    const analyzeRes = await fetch(`${base}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    let before: any = null;
    try { before = await analyzeRes.json(); } catch { before = { error: 'analyze call failed' }; }

    // 2) headless render with Playwright (chromium)
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    let renderedHtml = '';
    try {
      const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      // wait small extra time for JS
      await page.waitForTimeout(1000);
      renderedHtml = await page.content();
    } catch (e) {
      await browser.close();
      return NextResponse.json({ error: 'headless render failed', detail: String(e) }, { status: 500 });
    }
    await browser.close();

    // 3) analyze rendered HTML with existing extractor
    const extracted = extractMetaAndContent(renderedHtml);
    const afterSignals = extracted.contentQuality;
    const config = await loadActiveScoringConfig();
    const { pageType, log: pageTypeLog } = detectPageTypeWithLog(url, config, {
      meta: extracted.meta,
      headings: extracted.headings,
      contentSnippet: extracted.contentText.slice(0, 20000),
      contentQuality: afterSignals,
      hasProductSchemaLegacy: extracted.hasProductSchema,
    });

    return NextResponse.json({
      url,
      before,
      after: {
        pageType,
        pageTypeDetection: pageTypeLog,
        signals: {
          hasProductSchema: extracted.hasProductSchema,
          hasOgProductType: afterSignals.hasOgProductType ?? false,
          hasPriceInfo: afterSignals.hasPriceInfo ?? false,
          priceMatchCount: afterSignals.priceMatchCount ?? 0,
          buyButtonCount: afterSignals.buyButtonCount ?? 0,
          commerceKeywordCount: afterSignals.commerceKeywordCount ?? 0,
          repeatedProductCardCount: afterSignals.repeatedProductCardCount ?? 0,
          productSpecBlockCount: afterSignals.productSpecBlockCount ?? 0,
        },
      },
      renderedHtmlSnippet: renderedHtml.substring(0, 800),
    });
  } catch (err: any) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

