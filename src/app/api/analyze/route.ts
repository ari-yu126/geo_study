import { NextResponse } from 'next/server';
import { normalizeUrl, sanitizeIncomingAnalyzeUrl } from '@/lib/normalizeUrl';
import { runAnalysis } from '@/lib/runAnalysis';
import type { AnalysisResult } from '@/lib/analysisTypes';
import {
  getMemoryCachedAnalysis,
  setMemoryCachedAnalysis,
} from '@/lib/serverAnalysisMemoryCache';
import { supabase, supabaseAdmin, isSupabaseReachable } from '@/lib/supabase';
import { isAnalysisCacheEntryValid } from '@/lib/geoCacheTtl';
import { invalidateConfigCache, loadActiveScoringConfig } from '@/lib/scoringConfigLoader';
import { saveGeoAnalysisResult } from '@/lib/saveGeoAnalysisResult';

// 타입들을 외부에서도 사용할 수 있도록 re-export
export type {
  AnalysisMeta,
  SeedKeyword,
  SearchQuestion,
  QuestionCluster,
  GeoScores,
  AnalysisResult,
  SearchSource,
  ContentQuality,
  PlatformType,
} from '@/lib/analysisTypes';

/** Set GEO_ANALYZE_API_LOG=1 to emit cache-hit and GEMINI_TRACE console lines from this route. */
function shouldLogAnalyzeApiVerbose(): boolean {
  return process.env.GEO_ANALYZE_API_LOG === '1';
}

// Analysis uses only loadActiveScoringConfig() (read active row). It never rebuilds GEO config,
// never POSTs /api/geo-config/update, and never runs Gemini for monthly criteria generation.

/** Normalize `geoConfigVersion` on API responses (legacy cached rows may omit the field). */
function withResolvedGeoConfigVersion(
  r: AnalysisResult,
  currentGeoConfigVersion: string | null
): AnalysisResult {
  return { ...r, geoConfigVersion: r.geoConfigVersion ?? currentGeoConfigVersion ?? null };
}

/**
 * Ensures `result.url` is openable/displayable: post-redirect fetch URL → fetch target → prior value → request.
 * Cache rows may predate `finalFetchedUrl`; this merges safely on read.
 */
function withResolvedDisplayUrl(r: AnalysisResult, requestSanitizedUrl: string): AnalysisResult {
  const display =
    r.finalFetchedUrl ?? r.analysisFetchTargetUrl ?? r.url ?? requestSanitizedUrl;
  return { ...r, url: display };
}

function logGeoUrlTrace(payload: Record<string, unknown>): void {
  if (process.env.GEO_URL_TRACE !== '1') return;
  console.log('[GEO_URL_TRACE]', JSON.stringify(payload));
}

// TODO: analysis_history 테이블 컬럼명이 다를 경우 이 부분을 실제 스키마에 맞게 조정할 것
/**
 * Supabase에서 캐시된 분석 결과를 조회합니다.
 * Valid only when updated_at is within 24h and result.geoConfigVersion matches active config.
 */
async function getCachedAnalysis(
  normalizedUrl: string,
  currentGeoConfigVersion: string | null
): Promise<AnalysisResult | null> {
  const reachable = await isSupabaseReachable();
  if (!reachable) return null;

  const { data, error } = await supabase
    .from('analysis_history')
    .select('result_json, updated_at')
    .eq('normalized_url', normalizedUrl)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  if (!data || !data.result_json) return null;

  const result = data.result_json as AnalysisResult;
  if (
    !isAnalysisCacheEntryValid({
      updatedAtIso: data.updated_at as string,
      cachedGeoConfigVersion: result.geoConfigVersion,
      currentActiveGeoConfigVersion: currentGeoConfigVersion,
    })
  ) {
    return null;
  }

  return result;
}

// TODO: analysis_history 테이블 컬럼명이 다를 경우 이 부분을 실제 스키마에 맞게 조정할 것
/**
 * 분석 결과를 Supabase에 저장합니다.
 * normalized_url을 기준으로 upsert합니다.
 */
async function saveAnalysisResult(result: AnalysisResult): Promise<void> {
  const reachable = await isSupabaseReachable();
  if (!reachable) return;

  const { url, normalizedUrl, scores } = result;
  // Strip any LLM user-facing messages before persisting to DB to avoid exposing them via cache.
  const safeResult = { ...result } as AnalysisResult;
  if (Array.isArray(safeResult.llmStatuses)) {
    safeResult.llmStatuses = safeResult.llmStatuses.map((s) => {
      const { message, ...rest } = s as any;
      return rest as any;
    });
  }

  const hist = await supabase
    .from('analysis_history')
    .upsert(
      {
        url,
        normalized_url: normalizedUrl,
        geo_score: scores.finalScore,
        question_coverage: scores.questionCoverage,
        result_json: safeResult,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'normalized_url',
      }
    );
  if (hist.error) {
    console.warn('analysis_history upsert error:', hist.error, { normalizedUrl });
  }

  try {
    const check = await supabase
      .from('analysis_history')
      .select('id,updated_at')
      .eq('normalized_url', normalizedUrl)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (check.error) {
      console.warn('Supabase analysis_history select error:', check.error, { normalizedUrl });
    }

    const analysisHistoryId: string | null = check.data?.id ?? null;

    const dbClient = supabaseAdmin ?? supabase;
    const cfgRes = await dbClient
      .from('geo_scoring_config')
      .select('version')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const configVersion = result.geoConfigVersion ?? cfgRes.data?.version ?? null;

    const persistResult = await saveGeoAnalysisResult({
      result,
      safeResult,
      sourceAnalysisId: analysisHistoryId,
      configVersion,
    });
    if (!persistResult.ok) {
      console.warn('[geo_analysis_results] persist failed', persistResult);
    }
  } catch (err) {
    console.warn('saveAnalysisResult geo_analysis_results follow-up threw:', err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    if (!body || typeof body.url !== 'string') {
      return NextResponse.json(
        { error: 'url 필드가 포함된 JSON body가 필요합니다.' },
        { status: 400 }
      );
    }

    const url = sanitizeIncomingAnalyzeUrl(body.url as string);
    const normalizedUrl = normalizeUrl(url);

    const forceRefresh = body.forceRefresh === true;

    // Fresh analysis must see latest geo_scoring_config (guideRules, issueRules). Server-side config cache is 5m TTL.
    if (forceRefresh) {
      invalidateConfigCache();
    }

    const currentGeoConfigVersion = (await loadActiveScoringConfig()).version ?? null;

    if (forceRefresh && shouldLogAnalyzeApiVerbose()) {
      console.log(
        '[CACHE] analyze',
        JSON.stringify({
          bypassReason: 'forceRefresh',
          normalizedUrl,
          memoryAndSupabaseCachesSkipped: true,
          geoScoringConfigCacheInvalidated: true,
        })
      );
    }

  if (!forceRefresh) {
      const memHit = getMemoryCachedAnalysis(normalizedUrl, currentGeoConfigVersion);
      if (memHit && memHit.scores?.answerabilityScore !== undefined) {
        if (shouldLogAnalyzeApiVerbose()) {
          console.log(
            '[CACHE]',
            JSON.stringify({
              endpoint: '/api/analyze',
              layer: 'memory',
              normalizedUrl,
              hit: true,
              contentImprovementGuideEmbedded: true,
            })
          );
          console.log(
            '[GEMINI_TRACE]',
            JSON.stringify({
              endpoint: '/api/analyze',
              normalizedUrl,
              apiAnalyzeCacheHit: true,
              cacheLayer: 'memory',
              skippedDueToCachedAnalysis: true,
              runAnalysisInvoked: false,
              allGeminiGenerateContentSkipped: true,
            })
          );
        }
        if (process.env.QUESTION_COVERAGE_TRACE === '1') {
          console.log(
            '[QUESTION_COVERAGE_TRACE]',
            JSON.stringify({
              stage: 'analyze_api',
              normalizedUrl,
              analysisResultCacheUsed: true,
              cacheLayer: 'memory',
              runAnalysisInvoked: false,
              note: 'Stale pipeline logs not emitted; use forceRefresh:true to re-run Question Coverage trace.',
            })
          );
        }
        const safeMem = { ...memHit } as AnalysisResult;
        if (Array.isArray(safeMem.llmStatuses)) {
          safeMem.llmStatuses = safeMem.llmStatuses.map((s) => {
            const { message, ...rest } = s as any;
            return rest as any;
          });
        }
        const memOut = withResolvedDisplayUrl(
          withResolvedGeoConfigVersion(safeMem, currentGeoConfigVersion),
          url
        );
        logGeoUrlTrace({
          layer: 'memory',
          inputUrl: url,
          normalizedUrl,
          fetchTargetUrl: memOut.analysisFetchTargetUrl,
          finalFetchedUrl: memOut.finalFetchedUrl,
          resultUrl: memOut.url,
        });
        return NextResponse.json(
          {
            fromCache: true,
            cacheLayer: 'memory',
            result: memOut,
          },
          { status: 200 }
        );
      }

      const cached = await getCachedAnalysis(normalizedUrl, currentGeoConfigVersion);
      if (cached && cached.scores?.answerabilityScore !== undefined) {
        setMemoryCachedAnalysis(normalizedUrl, cached);
        if (shouldLogAnalyzeApiVerbose()) {
          console.log(
            '[CACHE]',
            JSON.stringify({
              endpoint: '/api/analyze',
              layer: 'supabase',
              normalizedUrl,
              hit: true,
              contentImprovementGuideEmbedded: true,
            })
          );
          console.log(
            '[GEMINI_TRACE]',
            JSON.stringify({
              endpoint: '/api/analyze',
              normalizedUrl,
              apiAnalyzeCacheHit: true,
              cacheLayer: 'supabase',
              skippedDueToCachedAnalysis: true,
              runAnalysisInvoked: false,
              allGeminiGenerateContentSkipped: true,
            })
          );
        }
        if (process.env.QUESTION_COVERAGE_TRACE === '1') {
          console.log(
            '[QUESTION_COVERAGE_TRACE]',
            JSON.stringify({
              stage: 'analyze_api',
              normalizedUrl,
              analysisResultCacheUsed: true,
              cacheLayer: 'supabase',
              runAnalysisInvoked: false,
              note: 'Stale pipeline logs not emitted; use forceRefresh:true to re-run Question Coverage trace.',
            })
          );
        }
        // Strip any LLM user-facing messages from cached result to avoid showing quota text in UI.
        const safeCached = { ...cached } as AnalysisResult;
        if (Array.isArray(safeCached.llmStatuses)) {
          safeCached.llmStatuses = safeCached.llmStatuses.map((s) => {
            const { message, ...rest } = s as any;
            return rest as any;
          });
        }
        const sbOut = withResolvedDisplayUrl(
          withResolvedGeoConfigVersion(safeCached, currentGeoConfigVersion),
          url
        );
        logGeoUrlTrace({
          layer: 'supabase',
          inputUrl: url,
          normalizedUrl,
          fetchTargetUrl: sbOut.analysisFetchTargetUrl,
          finalFetchedUrl: sbOut.finalFetchedUrl,
          resultUrl: sbOut.url,
        });
        return NextResponse.json(
          {
            fromCache: true,
            cacheLayer: 'supabase',
            result: sbOut,
          },
          { status: 200 }
        );
      }
    }

    // 2) 캐시가 없으면 새로 분석 (appOrigin 전달 시 프록시 경유 → iframe과 동일 HTML 사용)
    if (shouldLogAnalyzeApiVerbose()) {
      console.log(
        '[GEMINI_TRACE]',
        JSON.stringify({
          endpoint: '/api/analyze',
          normalizedUrl,
          apiAnalyzeCacheHit: false,
          skippedDueToCachedAnalysis: false,
          runAnalysisInvoked: true,
          forceRefresh,
        })
      );
    }
    if (process.env.QUESTION_COVERAGE_TRACE === '1') {
      console.log(
        '[QUESTION_COVERAGE_TRACE]',
        JSON.stringify({
          stage: 'analyze_api',
          normalizedUrl,
          analysisResultCacheUsed: false,
          requestForceRefresh: forceRefresh,
          note: forceRefresh
            ? 'Memory/Supabase analysis cache skipped by forceRefresh; runAnalysis receives forceRefresh (question research cache read skipped).'
            : 'Cache miss or stale; full runAnalysis. Question research cache may still hit unless forceRefresh.',
        })
      );
    }
    const appOrigin = typeof req.url === 'string' ? new URL(req.url).origin : undefined;
    // Pass sanitized request URL so runAnalysis can keep inputUrl (display chain) distinct from normalizedUrl.
    const result = await runAnalysis(url, { appOrigin, forceRefresh });
    const displayResult = withResolvedDisplayUrl(result, url);
    logGeoUrlTrace({
      inputUrl: url,
      normalizedUrl,
      fetchTargetUrl: result.analysisFetchTargetUrl,
      finalFetchedUrl: result.finalFetchedUrl,
      resultUrl: displayResult.url,
    });

    setMemoryCachedAnalysis(normalizedUrl, displayResult);

    // 3) DB에 저장 (실패해도 분석 결과는 반환)
    try {
      await saveAnalysisResult(displayResult);
    } catch (saveErr) {
      console.warn('Supabase 저장 실패 (분석 결과는 반환):', saveErr);
    }

    return NextResponse.json(
      {
        fromCache: false,
        cacheLayer: 'none',
        result: withResolvedGeoConfigVersion(displayResult, currentGeoConfigVersion),
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error('[analyze] failed:', err);
    const detail = err instanceof Error ? err.message : String(err);
    const fetchFailed =
      /^(Failed to fetch|Fetch failed)/i.test(detail) ||
      /\b(ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|network|aborted|socket)/i.test(
        detail
      );

    return NextResponse.json(
      {
        error: fetchFailed ? 'Fetch failed' : '분석 중 오류가 발생했습니다.',
        detail,
      },
      { status: fetchFailed ? 502 : 500 }
    );
  }
}
