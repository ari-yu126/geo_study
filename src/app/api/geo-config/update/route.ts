import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabase, isSupabaseReachable } from '@/lib/supabase';
import { loadActiveScoringConfig, invalidateConfigCache } from '@/lib/scoringConfigLoader';
import { DEFAULT_SCORING_CONFIG } from '@/lib/defaultScoringConfig';
import type {
  GeoScoringConfig,
  GeoScoringProfile,
  PageType,
} from '@/lib/analysisTypes';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY ?? '';
const GEMINI_API_KEY = process.env.GOOGLE_GENAI_API_KEY ?? '';

const QUERY_MAP = {
  editorial: [
    'Google AI Overview citation factors for editorial and FAQ pages 2026',
    'How Perplexity AI ranks authoritative blog posts and news articles',
    'Importance of expert bylines and first-person insights for GEO',
  ],
  video: [
    'How Google AI (SGE) summarizes and cites YouTube videos 2026',
    'Optimization of video descriptions and timestamps for AI search agents',
    'YouTube metadata SEO vs GEO: key differences in AI citation',
  ],
  commerce: [
    'Generative Engine Optimization (GEO) for e-commerce product pages',
    'How AI search engines extract specifications from product tables',
    'The role of customer reviews and shipping policies in AI search citations',
  ],
} as const;

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

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

async function tavilySearch(query: string): Promise<TavilyResponse> {
  if (!TAVILY_API_KEY) return {};

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

    if (!res.ok) return {};

    const data = (await res.json()) as TavilyResponse;
    return {
      answer: data.answer ?? '',
      results: data.results ?? [],
    };
  } catch {
    return {};
  }
}

function summarizeOrConcat(res: TavilyResponse, maxLength = 4000): string {
  const answer = res.answer ?? '';
  const snippets = (res.results ?? [])
    .slice(0, 5)
    .map((r) => `- ${r.title}: ${(r.content ?? '').slice(0, 500)}`)
    .join('\n');
  const combined = `[Answer]\n${answer}\n\n[Sources]\n${snippets}`;
  return combined.length > maxLength ? combined.slice(0, maxLength) + '...' : combined;
}

function pickSources(res: TavilyResponse): Array<{ title: string; url: string }> {
  return (res.results ?? []).slice(0, 5).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
  }));
}

export interface ResearchBucketItem {
  query: string;
  resultsText: string;
  sources: Array<{ title: string; url: string }>;
}

export interface ResearchBucket {
  category: PageType;
  items: ResearchBucketItem[];
}

async function fetchResearchBuckets(): Promise<ResearchBucket[]> {
  return Promise.all(
    (Object.entries(QUERY_MAP) as [keyof typeof QUERY_MAP, readonly string[]][]).map(
      async ([category, queries]) => {
        const items = await Promise.all(
          queries.map(async (q) => {
            const res = await tavilySearch(q);
            return {
              query: q,
              resultsText: summarizeOrConcat(res),
              sources: pickSources(res),
            };
          })
        );
        return { category: category as PageType, items };
      }
    )
  );
}

function buildGeminiPrompt(
  currentConfig: GeoScoringConfig,
  researchBuckets: ResearchBucket[]
): string {
  const researchBlock = researchBuckets
    .map(
      (b) =>
        `## ${b.category.toUpperCase()}\n${b.items
          .map(
            (i) =>
              `### Query: ${i.query}\n${i.resultsText}\nSources: ${i.sources.map((s) => s.title).join(', ')}`
          )
          .join('\n\n')}`
    )
    .join('\n\n---\n\n');

  return `당신은 GEO(Generative Engine Optimization) scoring system 설계자입니다.

입력은 editorial / video / commerce로 분리된 리서치 결과입니다.
각 카테고리별로 서로 다른 scoring profile을 생성하세요.

## 리서치 결과 (카테고리별 구분)

${researchBlock}

## 현재 적용 중인 설정 (참고용)
${JSON.stringify(currentConfig, null, 2)}

## 출력 요구사항

반드시 4개의 distinct scoring profile을 생성하세요:
- editorial: 블로그, 뉴스, FAQ 등 콘텐츠형 페이지
- video: 유튜브 등 비디오 콘텐츠
- commerce: 쇼핑몰, 상품 페이지
- default: fallback (editorial을 기반으로 복사하거나 평균값)

각 profile에는 다음이 포함되어야 합니다:

\`\`\`json
{
  "version": "geo-2.0",
  "updatedAt": "...",
  "source": "ai-generated",
  "researchSummary": "한국어 3~5줄 요약",
  "profiles": {
    "editorial": {
      "weights": {
        "citation": 0.40,
        "questionCoverage": 0.05,
        "answerability": 0.15,
        "structure": 0.15,
        "trust": 0.15,
        "questionMatch": 0.05,
        "density": 0.05
      },
      "issueRules": [ ... ],
      "queryTemplates": [
        "{keyword} 자주 묻는 질문",
        "{keyword} 방법",
        "{keyword} 비용",
        "{keyword} 비교"
      ]
    },
    "video": { ... },
    "commerce": { ... },
    "default": { ... }
  }
}
\`\`\`

### 제약사항

1. weights는 반드시 다음 키를 포함하고, 합이 1.0이 되도록:
   citation, questionCoverage, answerability, structure, trust, questionMatch, density
   (video/commerce에서 불필요하면 0으로)

2. issueRules는 profile 성격에 맞게:
   - editorial: byline/date/citations/FAQ/atomic answer 관련 (check는 ${SUPPORTED_CHECKS.slice(0, 10).join(', ')} 등)
   - video: timestamps/description/VideoObject/summary 관련 (yt_title_opt, yt_info_density, yt_chapter 등)
   - commerce: Product schema, reviews, shipping, returns, spec tables 관련

3. queryTemplates는 profile별로 완전히 다르게:
   - editorial: "{keyword} 자주 묻는 질문", "{keyword} 방법", "{keyword} 비용", "{keyword} 비교"
   - video: "{keyword} 영상 요약", "{keyword} 사용법 영상", "{keyword} 타임스탬프", "{keyword} 후기 영상"
   - commerce: "{keyword} 배송 반품", "{keyword} AS 보증", "{keyword} 정품", "{keyword} 사이즈 호환", "{keyword} 후기 단점"

4. issueRules 각 항목: id, check, label, description, priority('high'|'medium'|'low'), targetSelector, targetIndex 필수

5. 마크다운 코드블록 없이 순수 JSON만 응답하세요.`;
}

interface GeoScoringConfigV2 {
  version: string;
  updatedAt: string;
  source: 'ai-generated' | 'manual';
  researchSummary: string;
  profiles: Record<PageType, GeoScoringProfile>;
}

function validateProfileConfig(config: unknown): config is GeoScoringConfigV2 {
  if (!config || typeof config !== 'object') return false;
  const c = config as Record<string, unknown>;

  if (typeof c.version !== 'string') return false;
  if (!c.profiles || typeof c.profiles !== 'object') return false;

  const profiles = c.profiles as Record<string, unknown>;
  const required = ['editorial', 'video', 'commerce', 'default'];
  for (const key of required) {
    const p = profiles[key];
    if (!p || typeof p !== 'object') return false;
    const prof = p as Record<string, unknown>;
    if (!prof.weights || typeof prof.weights !== 'object') return false;
    if (!Array.isArray(prof.issueRules)) return false;
    if (!Array.isArray(prof.queryTemplates)) return false;

    const w = prof.weights as Record<string, unknown>;
    const weightKeys = ['citation', 'questionCoverage', 'answerability', 'structure', 'trust', 'questionMatch', 'density'];
    let sum = 0;
    for (const k of weightKeys) {
      if (typeof w[k] === 'number') sum += w[k] as number;
    }
    if (Math.abs(sum - 1.0) > 0.05) return false;
  }

  return true;
}

/** 프로필 기반 config를 기존 GeoScoringConfig 형식으로 호환 변환 (profiles.default + DEFAULT 기반) */
function toLegacyConfig(v2: GeoScoringConfigV2): GeoScoringConfig {
  const def = DEFAULT_SCORING_CONFIG;
  const defaultProfile = v2.profiles.default;
  const w = defaultProfile.weights;
  return {
    version: v2.version,
    updatedAt: v2.updatedAt,
    source: v2.source,
    researchSummary: v2.researchSummary,
    structureBaseScore: def.structureBaseScore,
    structureRules: def.structureRules,
    answerabilityRules: def.answerabilityRules,
    trustRules: def.trustRules,
    weights: {
      structure: (w.structure ?? 0.15) + (w.answerability ?? 0.15) * 0.5,
      coverage: (w.questionCoverage ?? 0.05) + (w.questionMatch ?? 0.05),
    },
    issueRules: defaultProfile.issueRules.length > 0
      ? (defaultProfile.issueRules as GeoScoringConfig['issueRules'])
      : def.issueRules,
    youtubePassedCheckRules: def.youtubePassedCheckRules,
    profiles: v2.profiles,
  };
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

    const researchBuckets = await fetchResearchBuckets();
    const hasAnyResearch = researchBuckets.some((b) =>
      b.items.some((i) => i.resultsText.trim().length > 0)
    );

    if (!hasAnyResearch) {
      return NextResponse.json(
        { error: '웹 리서치 결과를 가져오지 못했습니다. TAVILY_API_KEY를 확인하세요.' },
        { status: 502 }
      );
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = buildGeminiPrompt(currentConfig, researchBuckets);
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

    if (!validateProfileConfig(parsed)) {
      return NextResponse.json(
        {
          error: 'Gemini가 생성한 프로필 설정이 유효하지 않습니다.',
          raw: JSON.stringify(parsed).substring(0, 2000),
        },
        { status: 422 }
      );
    }

    const v2 = parsed as GeoScoringConfigV2;
    v2.updatedAt = new Date().toISOString();
    v2.source = 'ai-generated';

    const legacyConfig = toLegacyConfig(v2);

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
        version: legacyConfig.version,
        config_json: legacyConfig,
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
        config: legacyConfig,
        profiles: v2.profiles,
        researchSummary: legacyConfig.researchSummary,
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
