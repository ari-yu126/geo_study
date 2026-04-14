import { NextResponse } from 'next/server';
import { fetchHtml, extractMetaAndContent } from '@/lib/htmlAnalyzer';
import { computeExtractionMetrics, extractChunks } from '@/lib/articleExtraction';
import { fetchHtmlViaHeadless } from '@/lib/headlessHtmlFetch';

export const runtime = 'nodejs';

/**
 * Compare server-fetched vs headless-rendered HTML extraction (e.g. RTINGS / SPA reviews).
 * POST { url: string }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const url = body?.url;
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'url required' }, { status: 400 });
    }

    const appOrigin = typeof req.url === 'string' ? new URL(req.url).origin : undefined;

    const { html: serverHtml } = await fetchHtml(url, appOrigin);
    const serverExtracted = extractMetaAndContent(serverHtml);
    const serverMetrics = computeExtractionMetrics(serverHtml);
    const serverChunks = extractChunks(serverHtml, 15);

    let headlessHtml: string | null = null;
    let headlessError: string | null = null;
    let headlessExtracted: ReturnType<typeof extractMetaAndContent> | null = null;
    let headlessMetrics = null as ReturnType<typeof computeExtractionMetrics> | null;
    let headlessChunksLen = 0;

    try {
      headlessHtml = await fetchHtmlViaHeadless(url);
      headlessExtracted = extractMetaAndContent(headlessHtml);
      headlessMetrics = computeExtractionMetrics(headlessHtml);
      headlessChunksLen = extractChunks(headlessHtml, 15).length;
    } catch (e) {
      headlessError = e instanceof Error ? e.message : String(e);
    }

    return NextResponse.json({
      url,
      server: {
        extractedTextLength: serverExtracted.contentText.length,
        paragraphChunkCount: serverMetrics.paragraphLikeCount,
        citationExtractedChunkCount: serverMetrics.citationExtractedChunkCount,
        rawBodyTextLength: serverMetrics.rawBodyTextLength,
        chunksSampleLen: serverChunks.length,
      },
      headless: headlessMetrics
        ? {
            extractedTextLength: headlessExtracted!.contentText.length,
            paragraphChunkCount: headlessMetrics.paragraphLikeCount,
            citationExtractedChunkCount: headlessMetrics.citationExtractedChunkCount,
            rawBodyTextLength: headlessMetrics.rawBodyTextLength,
            chunksSampleLen: headlessChunksLen,
          }
        : null,
      headlessError,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
