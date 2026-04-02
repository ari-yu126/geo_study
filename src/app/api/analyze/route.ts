import { NextResponse } from 'next/server';
import { normalizeUrl } from '@/lib/htmlAnalyzer';
import { runAnalysis } from '@/lib/runAnalysis';
import type { AnalysisResult } from '@/lib/analysisTypes';
import { supabase, supabaseAdmin, isSupabaseReachable } from '@/lib/supabase';

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

// TODO: analysis_history 테이블 컬럼명이 다를 경우 이 부분을 실제 스키마에 맞게 조정할 것
/**
 * Supabase에서 캐시된 분석 결과를 조회합니다.
 * 24시간 이내의 결과만 캐시로 인정합니다.
 */
async function getCachedAnalysis(
  normalizedUrl: string
): Promise<AnalysisResult | null> {
  const reachable = await isSupabaseReachable();
  if (!reachable) return null;

  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  const { data, error } = await supabase
    .from('analysis_history')
    .select('result_json, updated_at')
    .eq('normalized_url', normalizedUrl)
    .gte('updated_at', oneDayAgo.toISOString())
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  if (!data || !data.result_json) return null;

  return data.result_json as AnalysisResult;
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

  await supabase
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
  // Check upsert result for errors and log details to help debugging when saves silently fail.
  try {
    // supabase-js returns { data, error } — re-run a lightweight select to verify persistence if needed.
    const check = await supabase
      .from('analysis_history')
      .select('id,updated_at')
      .eq('normalized_url', normalizedUrl)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (check.error) {
      console.warn('Supabase upsert/check error:', check.error, { normalizedUrl });
    }
    // If we have a persisted analysis_history id, attempt to insert normalized result row.
    const analysisHistoryId: string | null = check.data?.id ?? null;
    try {
      const dbClient = supabaseAdmin ?? supabase;

      // Read active config version (prefer admin client)
      const cfgRes = await dbClient
        .from('geo_scoring_config')
        .select('version')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const configVersion = cfgRes.data?.version ?? null;

      // Build insert payload for geo_analysis_results
      const insertPayload: any = {
        url,
        normalized_url: normalizedUrl,
        page_type: result.pageType ?? 'editorial',
        config_version: configVersion,
        geo_score: scores.finalScore,
        score_structure: scores.structureScore ?? null,
        score_answerability: scores.answerabilityScore ?? null,
        score_trust: scores.trustScore ?? null,
        score_citation: scores.citationScore ?? null,
        score_question_coverage: scores.questionCoverage ?? null,
        result_json: safeResult,
        issues_json: (result.auditIssues ?? null),
        passed_checks_json: (result.passedChecks ?? null),
        title: result.meta?.title ?? null,
        engine_version: process.env.GEO_ENGINE_VERSION ?? null,
        status: result.limitedAnalysis ? 'partial' : 'success',
        error_message: null,
        source_analysis_id: analysisHistoryId,
        citation_likelihood: null,
        notes: null,
        created_at: new Date().toISOString(),
      };

      const ins = await dbClient
        .from('geo_analysis_results')
        .insert(insertPayload)
        .select('id')
        .limit(1);

      if (ins.error) {
        console.warn('Failed to insert geo_analysis_results:', {
          message: ins.error.message,
          details: (ins.error as any).details,
        });
      }
    } catch (err) {
      console.warn('geo_analysis_results insert threw:', err);
    }
  } catch (err) {
    console.warn('Supabase upsert/check threw:', err);
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

  if (!forceRefresh) {
      const cached = await getCachedAnalysis(normalizedUrl);
      if (cached && cached.scores?.answerabilityScore !== undefined) {
        console.log(
          '[GEMINI_TRACE]',
          JSON.stringify({
            endpoint: '/api/analyze',
            normalizedUrl,
            apiAnalyzeCacheHit: true,
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
          { fromCache: true, result: safeCached },
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

    // 3) DB에 저장 (실패해도 분석 결과는 반환)
    try {
      await saveAnalysisResult(result);
    } catch (saveErr) {
      console.warn('Supabase 저장 실패 (분석 결과는 반환):', saveErr);
    }

    return NextResponse.json(
      { fromCache: false, result },
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
