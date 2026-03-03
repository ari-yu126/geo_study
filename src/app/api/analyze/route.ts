import { NextResponse } from 'next/server';
import { normalizeUrl } from '@/lib/htmlAnalyzer';
import { runAnalysis } from '@/lib/runAnalysis';
import type { AnalysisResult } from '@/lib/analysisTypes';
import { supabase, isSupabaseReachable } from '@/lib/supabase';

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

  await supabase
    .from('analysis_history')
    .upsert(
      {
        url,
        normalized_url: normalizedUrl,
        geo_score: scores.finalScore,
        question_coverage: scores.questionCoverage,
        result_json: result,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'normalized_url',
      }
    );
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
        return NextResponse.json(
          { fromCache: true, result: cached },
          { status: 200 }
        );
      }
    }

    // 2) 캐시가 없으면 새로 분석 (appOrigin 전달 시 프록시 경유 → iframe과 동일 HTML 사용)
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
