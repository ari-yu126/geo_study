import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabase, isSupabaseReachable } from '@/lib/supabase';
import { loadActiveScoringConfig, invalidateConfigCache } from '@/lib/scoringConfigLoader';
import { DEFAULT_SCORING_CONFIG } from '@/lib/defaultScoringConfig';
import type { GeoScoringConfig } from '@/lib/analysisTypes';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY ?? '';
const GEMINI_API_KEY = process.env.GOOGLE_GENAI_API_KEY ?? '';

const SEARCH_QUERIES = [
  'GEO generative engine optimization ranking factors 2026',
  'AI overview search optimization best practices latest',
  'SGE SEO structured data FAQ schema importance',
  'how to optimize website for AI chatbot citations',
];

const YOUTUBE_SEARCH_QUERIES = [
  'YouTube video SEO AI citation optimization 2026',
  'YouTube description optimization for AI search ChatGPT Perplexity',
  'YouTube video discoverability generative AI recommendations',
];

const YOUTUBE_SUPPORTED_CHECKS = [
  'yt_title_opt',
  'yt_info_density',
  'yt_chapter',
  'yt_authority',
  'yt_gemini_factor',
] as const;

const SUPPORTED_CHECKS = [
  'title_exists',
  'desc_exists',
  'desc_length_min',
  'desc_length_range',
  'og_title_exists',
  'og_desc_exists',
  'og_tags_exist',
  'canonical_exists',
  'headings_min',
  'questions_min',
  'keywords_min',
  'h1_single',
  'schema_faq_exists',
  'structured_data_exists',
  'question_coverage_min',
  'structure_score_min',
  'content_length_min',
  'content_depth',
  'tables_min',
  'lists_min',
  'h2_count_min',
  'h3_count_min',
  'images_min',
  'has_step_structure',
];

async function searchTavily(query: string): Promise<string> {
  if (!TAVILY_API_KEY) return '';

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: 'advanced',
        max_results: 5,
        include_answer: true,
      }),
    });

    if (!res.ok) return '';

    const data = await res.json();
    const answer = data.answer ?? '';
    const snippets = (data.results ?? [])
      .map((r: { title: string; content: string }) => `- ${r.title}: ${r.content}`)
      .join('\n');

    return `[Query: ${query}]\nAnswer: ${answer}\nSources:\n${snippets}`;
  } catch {
    return '';
  }
}

function buildGeminiPrompt(
  currentConfig: GeoScoringConfig,
  researchResults: string,
  youtubeResearchResults: string
): string {
  return `당신은 GEO(Generative Engine Optimization) 전문가입니다.

아래는 최신 GEO/SGE 관련 웹 리서치 결과입니다:

---
${researchResults}
---

아래는 유튜브 비디오 AI 인용·GEO 최적화 관련 리서치 결과입니다:

---
${youtubeResearchResults}
---

현재 적용 중인 GEO 점수 기준 설정:
${JSON.stringify(currentConfig, null, 2)}

시스템이 지원하는 check 종류와 설명:
- title_exists: Title 태그 존재 여부
- desc_exists: Meta Description 존재 여부
- desc_length_min: Description 최소 길이 (threshold=글자수)
- desc_length_range: Description 50~160자 범위
- og_title_exists / og_desc_exists / og_tags_exist: OG 태그
- canonical_exists: Canonical URL 존재
- headings_min: 헤딩 태그 최소 개수 (threshold)
- h1_single: H1 태그 1개만 존재
- h2_count_min / h3_count_min: H2/H3 최소 개수 (threshold)
- questions_min: 페이지 내 질문형 표현 개수 (threshold)
- keywords_min: 키워드 밀도 (threshold)
- content_length_min: 본문 길이 최소 글자수 (threshold, 예: 3000)
- content_depth: 심층 콘텐츠 (threshold, 예: 8000자 이상)
- tables_min: 비교표/테이블 최소 개수 (threshold)
- lists_min: ul/ol 목록 최소 개수 (threshold)
- images_min: 이미지 최소 개수 (threshold)
- has_step_structure: STEP/단계 구조 존재 여부
- schema_faq_exists: FAQ 구조화 데이터
- structured_data_exists: JSON-LD 구조화 데이터
- question_coverage_min: 질문 커버리지 최소 비율 (threshold)
- structure_score_min: 구조 점수 최소값 (threshold)

위 리서치 결과를 분석하여, AI(ChatGPT, Gemini, Perplexity 등)가 실제로 웹 콘텐츠를 인용할 때 중요하게 보는 기준을 반영한 점수 설정을 생성하세요.

핵심 원칙:
- AI 인용에 가장 영향을 미치는 요소: 콘텐츠 깊이, 비교표, 구조화된 정보, 직접 답변, 단계별 가이드
- 메타 태그만으로는 높은 점수를 받을 수 없어야 합니다
- 콘텐츠 품질(content_length_min, content_depth, tables_min, lists_min, h2_count_min 등)을 적극 반영하세요

규칙:
1. structureRules/issueRules의 check 값은 위 목록에서만 선택
2. structureBaseScore는 10~20 사이 (개별 항목이 의미 있도록 낮게)
3. 각 rule의 points는 3~8 사이
4. weights.structure는 0.5~0.6, weights.coverage는 0.4~0.5 (합계=1.0)
5. issueRules의 priority는 'high' | 'medium' | 'low'
6. researchSummary에 업데이트 근거를 한국어 3~5줄로 요약
7. version은 날짜 기반 (예: "2026.02.20")
8. issueRules에는 targetSelector("_top","_bottom","h1","h2" 등)와 targetIndex(숫자) 필수

9. youtubePassedCheckRules: 유튜브 비디오 전용 잘된 점 기준. 위 유튜브 리서치를 반영하여 아래 5종을 반드시 포함하세요:
   - yt_title_opt: 제목에 시드 키워드 포함 (label, reason 한국어)
   - yt_info_density: 설명란 최소 글자수 (threshold=300 권장, label, reason)
   - yt_chapter: 00:00 형태 타임스탬프(챕터) 존재 (label, reason)
   - yt_authority: AI 인용 확인 (label, reason)
   - yt_gemini_factor: AI 평가 문구 (label, reason은 "영상의 정보 전달력이 명확함" 같은 예시로)
   check 값은 yt_title_opt | yt_info_density | yt_chapter | yt_authority | yt_gemini_factor 만 사용

다음 JSON 형식으로만 응답하세요 (마크다운 코드블록 없이 순수 JSON):
{
  "version": "...",
  "updatedAt": "...",
  "source": "ai-generated",
  "researchSummary": "...",
  "structureBaseScore": ...,
  "structureRules": [...],
  "weights": { "structure": ..., "coverage": ... },
  "issueRules": [...],
  "youtubePassedCheckRules": [
    { "id": "yt_title_opt", "label": "...", "reason": "...", "check": "yt_title_opt" },
    { "id": "yt_info_density", "label": "...", "reason": "...", "check": "yt_info_density", "threshold": 300 },
    { "id": "yt_chapter", "label": "...", "reason": "...", "check": "yt_chapter" },
    { "id": "yt_authority", "label": "...", "reason": "...", "check": "yt_authority" },
    { "id": "yt_gemini_factor", "label": "...", "reason": "...", "check": "yt_gemini_factor" }
  ]
}`;
}

function validateConfig(config: unknown): config is GeoScoringConfig {
  if (!config || typeof config !== 'object') return false;
  const c = config as Record<string, unknown>;

  if (typeof c.version !== 'string') return false;
  if (typeof c.structureBaseScore !== 'number') return false;
  if (!Array.isArray(c.structureRules)) return false;
  if (!c.weights || typeof c.weights !== 'object') return false;
  if (!Array.isArray(c.issueRules)) return false;

  const w = c.weights as Record<string, unknown>;
  if (typeof w.structure !== 'number' || typeof w.coverage !== 'number') return false;

  const weightSum = (w.structure as number) + (w.coverage as number);
  if (Math.abs(weightSum - 1.0) > 0.01) return false;

  for (const rule of c.structureRules as Array<Record<string, unknown>>) {
    if (!rule.id || !rule.check || typeof rule.points !== 'number') return false;
    if (!SUPPORTED_CHECKS.includes(rule.check as string)) return false;
  }

  for (const rule of c.issueRules as Array<Record<string, unknown>>) {
    if (!rule.id || !rule.check || !rule.label || !rule.description) return false;
    if (!SUPPORTED_CHECKS.includes(rule.check as string)) return false;
    if (!['high', 'medium', 'low'].includes(rule.priority as string)) return false;
  }

  // youtubePassedCheckRules: 선택적. 있으면 검증
  if (Array.isArray(c.youtubePassedCheckRules)) {
    for (const r of c.youtubePassedCheckRules as Array<Record<string, unknown>>) {
      if (!r.id || !r.label || !r.reason || !r.check) return false;
      if (!(YOUTUBE_SUPPORTED_CHECKS as readonly string[]).includes(r.check as string)) return false;
    }
  }

  return true;
}

export async function POST() {
  try {
    if (!GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'GOOGLE_GENAI_API_KEY가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    const currentConfig = await loadActiveScoringConfig();

    const [researchChunks, youtubeChunks] = await Promise.all([
      Promise.all(SEARCH_QUERIES.map((q) => searchTavily(q))),
      Promise.all(YOUTUBE_SEARCH_QUERIES.map((q) => searchTavily(q))),
    ]);
    const researchResults = researchChunks.filter(Boolean).join('\n\n');
    const youtubeResearchResults = youtubeChunks.filter(Boolean).join('\n\n');

    if (!researchResults.trim()) {
      return NextResponse.json(
        { error: '웹 리서치 결과를 가져오지 못했습니다. Tavily API 키를 확인하세요.' },
        { status: 502 }
      );
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = buildGeminiPrompt(currentConfig, researchResults, youtubeResearchResults);
    const geminiResult = await model.generateContent(prompt);
    const responseText = geminiResult.response.text().trim();

    let parsed: unknown;
    try {
      const cleaned = responseText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        {
          error: 'Gemini 응답을 JSON으로 파싱하지 못했습니다.',
          raw: responseText.substring(0, 2000),
        },
        { status: 502 }
      );
    }

    if (!validateConfig(parsed)) {
      return NextResponse.json(
        {
          error: 'Gemini가 생성한 설정이 유효하지 않습니다.',
          raw: JSON.stringify(parsed).substring(0, 2000),
        },
        { status: 422 }
      );
    }

    const newConfig = parsed as GeoScoringConfig;
    newConfig.updatedAt = new Date().toISOString();
    newConfig.source = 'ai-generated';

    // 유튜브 기준이 없으면 기존 설정 유지, 없으면 기본값 사용
    if (
      !Array.isArray(newConfig.youtubePassedCheckRules) ||
      newConfig.youtubePassedCheckRules.length === 0
    ) {
      newConfig.youtubePassedCheckRules =
        currentConfig.youtubePassedCheckRules ?? DEFAULT_SCORING_CONFIG.youtubePassedCheckRules;
    }

    const reachable = await isSupabaseReachable();
    if (!reachable) {
      return NextResponse.json(
        { error: 'Supabase에 연결할 수 없습니다. 프로젝트 상태를 확인하세요.' },
        { status: 503 }
      );
    }

    const { error: insertError } = await supabase
      .from('geo_scoring_config')
      .insert({
        version: newConfig.version,
        config_json: newConfig,
        is_active: true,
      });

    if (insertError) {
      console.error('Supabase insert error:', insertError);
      return NextResponse.json(
        { error: 'DB 저장에 실패했습니다.', detail: insertError.message },
        { status: 500 }
      );
    }

    invalidateConfigCache();

    return NextResponse.json(
      {
        success: true,
        config: newConfig,
        researchSummary: newConfig.researchSummary,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error('geo-config update error:', err);
    return NextResponse.json(
      {
        error: 'GEO 기준 업데이트 중 오류가 발생했습니다.',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
