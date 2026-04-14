/**
 * POST /api/ai-writing-examples
 *
 * AI Writing Assistant — generates example prose for an analyzed page.
 * Intentionally separate from Recommendation / runAnalysis.
 *
 * Future improvements (not implemented):
 * - Cache responses by normalized URL + body hash.
 * - Regenerate / streaming / partial updates.
 * - Store results in Supabase for history.
 * - Locale-aware prompts (ko/en) aligned with UI.
 */

import { NextResponse } from 'next/server';
import {
  getAiWritingGuideCacheSignature,
  isAiWritingExamplesPageType,
  type AiWritingExamplesApiResponse,
  type AiWritingExamplesRequestBody,
} from '@/lib/aiWritingExamplesTypes';
import { buildFallbackAiWritingExamples } from '@/lib/aiWritingExamplesFallback';
import { AI_WRITING_QUOTA_NOTICE } from '@/lib/aiWritingExamplesMessages';
import { getAiWritingExamplesKeySource } from '@/lib/geminiEnv';
import { generateAiWritingExamples } from '@/lib/generateAiWritingExamples';
import {
  getCachedAiWritingExamples,
  setCachedAiWritingExamples,
} from '@/lib/aiWritingExamplesServerCache';
import { normalizeUrl } from '@/lib/normalizeUrl';

function logAiWritingExamplesCache(payload: {
  layer: 'memory' | 'supabase' | 'none';
  hit: boolean;
  url: string;
  pageType: string;
}): void {
  if (process.env.AI_WRITING_API_LOG !== '1') return;
  console.log('[CACHE] ai-writing-examples', JSON.stringify(payload));
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x.trim() : String(x ?? '').trim()))
    .filter((s) => s.length > 0);
}

function parseMatchedGuideRules(raw: unknown): AiWritingExamplesRequestBody['matchedGuideRules'] {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<AiWritingExamplesRequestBody['matchedGuideRules']> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    const message = typeof o.message === 'string' ? o.message.trim() : '';
    if (!id) continue;
    const priority = typeof o.priority === 'string' ? o.priority.trim() : undefined;
    out.push({ id, message, ...(priority ? { priority } : {}) });
  }
  return out.length > 0 ? out : undefined;
}

function parseBody(raw: unknown):
  | { ok: true; body: AiWritingExamplesRequestBody }
  | { ok: false; response: NextResponse } {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }),
    };
  }
  const o = raw as Record<string, unknown>;
  const url = typeof o.url === 'string' ? o.url.trim() : '';
  if (!url) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Field "url" is required' }, { status: 400 }),
    };
  }
  const pageType = o.pageType;
  if (!isAiWritingExamplesPageType(pageType)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            'Field "pageType" must be one of: editorial, commerce, video, review, site_info',
        },
        { status: 400 }
      ),
    };
  }

  const titleFromBody = typeof o.title === 'string' ? o.title : '';
  const pageTitle = typeof o.pageTitle === 'string' ? o.pageTitle : '';
  const title = (pageTitle || titleFromBody).trim();
  const snippetDirect = typeof o.contentSnippet === 'string' ? o.contentSnippet : '';
  const contentText = typeof o.contentText === 'string' ? o.contentText : '';
  const contentSnippet = (contentText || snippetDirect).trim();
  const questions = asStringArray(o.questions);
  const recommendedSections = asStringArray(o.recommendedSections);
  const locale: 'ko' | 'en' = o.locale === 'en' ? 'en' : 'ko';
  const forceRefresh = o.forceRefresh === true;
  const platform = typeof o.platform === 'string' ? o.platform.trim() : undefined;
  const matchedGuideRules = parseMatchedGuideRules(o.matchedGuideRules);
  const relatedIssueIds = asStringArray(o.relatedIssueIds);
  const currentGuideText =
    typeof o.currentGuideText === 'string' ? o.currentGuideText.trim() : undefined;

  return {
    ok: true,
    body: {
      url,
      title,
      contentSnippet,
      pageType,
      questions,
      recommendedSections,
      locale,
      forceRefresh,
      ...(platform ? { platform } : {}),
      ...(matchedGuideRules ? { matchedGuideRules } : {}),
      ...(relatedIssueIds.length > 0 ? { relatedIssueIds } : {}),
      ...(currentGuideText ? { currentGuideText } : {}),
    },
  };
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  const parsed = parseBody(raw);
  if (!parsed.ok) return parsed.response;

  const { body } = parsed;
  const keySource = getAiWritingExamplesKeySource();
  const loc = body.locale ?? 'ko';
  const cacheUrl = normalizeUrl(body.url);
  const guideSig = getAiWritingGuideCacheSignature(body);

  if (!body.forceRefresh) {
    const cached = getCachedAiWritingExamples(body.url, body.pageType, loc, guideSig);
    if (cached) {
      logAiWritingExamplesCache({
        layer: 'memory',
        hit: true,
        url: cacheUrl,
        pageType: body.pageType,
      });
      return NextResponse.json({ ...cached, serverCached: true });
    }
  }

  logAiWritingExamplesCache({
    layer: 'none',
    hit: false,
    url: cacheUrl,
    pageType: body.pageType,
  });

  const gen = await generateAiWritingExamples(body);

  if (!gen.ok && gen.reason === 'quota') {
    const data = buildFallbackAiWritingExamples(body, loc);
    const payload: AiWritingExamplesApiResponse = {
      aiAvailable: true,
      data,
      degraded: true,
      degradedReason: 'quota',
      notice: AI_WRITING_QUOTA_NOTICE[loc],
    };
    setCachedAiWritingExamples(body.url, body.pageType, loc, guideSig, payload);
    if (process.env.AI_WRITING_API_LOG === '1') {
      console.log('[AI WRITING API RESULT]', {
        ...payload,
        keySource,
        fallback: 'quota_template',
        note: 'Gemini may have been called once before quota/template fallback',
      });
    }
    return NextResponse.json(payload);
  }

  if (!gen.ok) {
    const payload: Extract<AiWritingExamplesApiResponse, { aiAvailable: false }> = {
      aiAvailable: false,
      message: gen.message,
      detail: gen.detail,
      keySource,
      reason: gen.reason,
    };
    if (process.env.AI_WRITING_API_LOG === '1') {
      console.log('[AI WRITING API RESULT]', payload);
    }
    return NextResponse.json(payload);
  }

  const payload: AiWritingExamplesApiResponse = {
    aiAvailable: true,
    data: gen.data,
    ...(gen.guideRulePromptDebug ? { guideRulePromptDebug: gen.guideRulePromptDebug } : {}),
  };
  setCachedAiWritingExamples(body.url, body.pageType, loc, guideSig, payload);
  if (process.env.AI_WRITING_API_LOG === '1') {
    console.log('[AI WRITING API RESULT]', {
      aiAvailable: true,
      keySource,
      geminiCalled: true,
      data: {
        summaryExampleLen: gen.data.summaryExample.length,
        faqCount: gen.data.faqExamples.length,
        prosConsLen: gen.data.prosConsExample.length,
        verdictLen: gen.data.verdictExample.length,
        headingsCount: gen.data.headingSuggestions.filter(Boolean).length,
      },
    });
  }
  return NextResponse.json(payload);
}
