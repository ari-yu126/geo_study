import { NextResponse } from 'next/server';
import { normalizeUrl } from '@/lib/normalizeUrl';
import { runAnalysis } from '@/lib/runAnalysis';
import type { AnalysisResult } from '@/lib/analysisTypes';
import {
  getMemoryCachedAnalysis,
  setMemoryCachedAnalysis,
} from '@/lib/serverAnalysisMemoryCache';
import { supabase, supabaseAdmin, isSupabaseReachable } from '@/lib/supabase';
import { isAnalysisCacheEntryValid } from '@/lib/geoCacheTtl';
import { loadActiveScoringConfig } from '@/lib/scoringConfigLoader';
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
} from '@/lib/analysisTypes';

// Analysis uses only loadActiveScoringConfig() (read active row). It never rebuilds GEO config,
// never POSTs /api/geo-config/update, and never runs Gemini for monthly criteria generation.

/** Normalize `geoConfigVersion` on API responses (legacy cached rows may omit the field). */
function withResolvedGeoConfigVersion(
  r: AnalysisResult,
  currentGeoConfigVersion: string | null
): AnalysisResult {
  return { ...r, geoConfigVersion: r.geoConfigVersion ?? currentGeoConfigVersion ?? null };
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

    const url = body.url as string;
    const normalizedUrl = normalizeUrl(url);

    const forceRefresh = body.forceRefresh === true;

    const currentGeoConfigVersion = (await loadActiveScoringConfig()).version ?? null;

    if (forceRefresh) {
      console.log(
        '[CACHE] analyze',
        JSON.stringify({
          bypassReason: 'forceRefresh',
          normalizedUrl,
          memoryAndSupabaseCachesSkipped: true,
        })
      );
    }

  if (!forceRefresh) {
      const memHit = getMemoryCachedAnalysis(normalizedUrl, currentGeoConfigVersion);
      if (memHit && memHit.scores?.answerabilityScore !== undefined) {
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
        const safeMem = { ...memHit } as AnalysisResult;
        if (Array.isArray(safeMem.llmStatuses)) {
          safeMem.llmStatuses = safeMem.llmStatuses.map((s) => {
            const { message, ...rest } = s as any;
            return rest as any;
          });
        }
        return NextResponse.json(
          {
            fromCache: true,
            cacheLayer: 'memory',
            result: withResolvedGeoConfigVersion(safeMem, currentGeoConfigVersion),
          },
          { status: 200 }
        );
      }

      const cached = await getCachedAnalysis(normalizedUrl, currentGeoConfigVersion);
      if (cached && cached.scores?.answerabilityScore !== undefined) {
        setMemoryCachedAnalysis(normalizedUrl, cached);
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
        // Strip any LLM user-facing messages from cached result to avoid showing quota text in UI.
        const safeCached = { ...cached } as AnalysisResult;
        if (Array.isArray(safeCached.llmStatuses)) {
          safeCached.llmStatuses = safeCached.llmStatuses.map((s) => {
            const { message, ...rest } = s as any;
            return rest as any;
          });
        }
        return NextResponse.json(
          {
            fromCache: true,
            cacheLayer: 'supabase',
            result: withResolvedGeoConfigVersion(safeCached, currentGeoConfigVersion),
          },
          { status: 200 }
        );
      }
    }

    // 2) 캐시가 없으면 새로 분석 (appOrigin 전달 시 프록시 경유 → iframe과 동일 HTML 사용)
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
    const appOrigin = typeof req.url === 'string' ? new URL(req.url).origin : undefined;
    const result = await runAnalysis(url, { appOrigin });

    setMemoryCachedAnalysis(normalizedUrl, result);

    // 3) DB에 저장 (실패해도 분석 결과는 반환)
    try {
      await saveAnalysisResult(result);
    } catch (saveErr) {
      console.warn('Supabase 저장 실패 (분석 결과는 반환):', saveErr);
    }

    return NextResponse.json(
      {
        fromCache: false,
        cacheLayer: 'none',
        result: withResolvedGeoConfigVersion(result, currentGeoConfigVersion),
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error('analyze API error:', err);
    const detail = err?.message ?? String(err);
    return NextResponse.json(
      {
        error: '분석 중 오류가 발생했습니다.',
        detail: process.env.NODE_ENV === 'development' ? detail : undefined,
      },
      { status: 500 }
    );
  }
}
