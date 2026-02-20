import { NextResponse } from 'next/server';
import { normalizeUrl } from '@/lib/htmlAnalyzer';
import { runAnalysis } from '@/lib/runAnalysis';
import type { AnalysisResult } from '@/lib/analysisTypes';
import { supabase } from '@/lib/supabase';

// 타입들을 외부에서도 사용할 수 있도록 re-export
export type { 
  AnalysisMeta, 
  SeedKeyword, 
  SearchQuestion, 
  QuestionCluster, 
  GeoScores, 
  AnalysisResult,
  SearchSource 
} from '@/lib/analysisTypes';

// TODO: analysis_history 테이블 컬럼명이 다를 경우 이 부분을 실제 스키마에 맞게 조정할 것
/**
 * Supabase에서 캐시된 분석 결과를 조회합니다.
 * 24시간 이내의 결과만 캐시로 인정합니다.
 */
async function getCachedAnalysis(
  normalizedUrl: string
): Promise<AnalysisResult | null> {
  // updated_at이 24시간 이내인 레코드만 캐시로 인정
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

  if (error) {
    console.error('getCachedAnalysis error:', error);
    return null;
  }

  if (!data || !data.result_json) {
    return null;
  }

  // result_json은 AnalysisResult 형태라고 가정
  return data.result_json as AnalysisResult;
}

// TODO: analysis_history 테이블 컬럼명이 다를 경우 이 부분을 실제 스키마에 맞게 조정할 것
/**
 * 분석 결과를 Supabase에 저장합니다.
 * normalized_url을 기준으로 upsert합니다.
 */
async function saveAnalysisResult(result: AnalysisResult): Promise<void> {
  const { url, normalizedUrl, scores } = result;

  const { error } = await supabase
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
        onConflict: 'normalized_url', // normalized_url 기준으로 upsert
      }
    );

  if (error) {
    console.error('saveAnalysisResult error:', error);
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

    // 1) 캐시 조회
    const cached = await getCachedAnalysis(normalizedUrl);

    if (cached) {
      return NextResponse.json(
        { fromCache: true, result: cached },
        { status: 200 }
      );
    }

    // 2) 캐시가 없으면 새로 분석
    const result = await runAnalysis(url);

    // 3) DB에 저장 (에러 나도 분석 결과는 리턴)
    await saveAnalysisResult(result);

    return NextResponse.json(
      { fromCache: false, result },
      { status: 200 }
    );
  } catch (err: any) {
    console.error('analyze API error:', err);
    return NextResponse.json(
      { error: '분석 중 오류가 발생했습니다.', detail: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
