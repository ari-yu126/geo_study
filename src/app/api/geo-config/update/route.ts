import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabase, supabaseAdmin, isSupabaseReachable } from '@/lib/supabase';
import { getAuthorityLevel } from '@/lib/referenceHelper';
import { invalidateConfigCache } from '@/lib/scoringConfigLoader';
import { DEFAULT_SCORING_CONFIG } from '@/lib/defaultScoringConfig';
import type {
  GeoScoringConfig,
  GeoScoringProfile,
  OpportunityTemplate,
  PageType,
  PassedRule,
} from '@/lib/analysisTypes';
import type { ResearchBucket } from '@/lib/geoCriteriaResearch';
import {
  fetchGeoCriteriaResearch,
  formatPageTypeWeightedResearchForGemini,
  providerToSourceType,
  researchHasContent,
} from '@/lib/geoCriteriaResearch';
import { getGeminiPaidApiKey } from '@/lib/geminiEnv';
import { waitForGeminiRateLimitSlot } from '@/lib/geminiGlobalRateLimiter';
import {
  CONFIG_VALIDITY_DAYS,
  ageDaysFromCreatedAt,
  isConfigExpired,
} from '@/lib/geoCacheTtl';

export { CONFIG_VALIDITY_DAYS } from '@/lib/geoCacheTtl';

/** GET metadata: active row missing | within TTL | past TTL (still active until POST refresh). */
export type GeoConfigGetStatus = 'NO_ACTIVE_CONFIG' | 'CACHED' | 'STALE';

/** POST outcome: served existing | new config persisted. */
export type GeoConfigPostStatus = 'CACHED' | 'REBUILT';

function configJsonOrDefault(row: { config_json?: unknown } | null): GeoScoringConfig {
  const j = row?.config_json;
  if (j && typeof j === 'object') return j as GeoScoringConfig;
  return DEFAULT_SCORING_CONFIG;
}


/** When assembling research for Gemini, follow `docs/geo-project-state/09-geo-research-policy.md`: prioritize academic, then official docs, then authority industry; add Tavily trend only as optional supplement (see `fetchGeoCriteriaResearch`). */

// YouTube-specific checks are referenced by name in prompts where needed.

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

function buildGeminiPrompt(
  currentConfig: GeoScoringConfig,
  researchBuckets: ResearchBucket[]
): string {
  const researchBlock = formatPageTypeWeightedResearchForGemini(researchBuckets);

  return `당신은 GEO(Generative Engine Optimization) scoring system 설계자입니다.

핵심 철학은 정보 검색(Information Retrieval), 질의응답(QA), RAG의 근거·정렬, 문서·인용 랭킹, 의미적 정보 이득(information gain), 구조화·추출 가능한 콘텐츠, 사실 밀도와 정의형 서술, 출처 신뢰도에 두어야 합니다. 키워드 빈도나 순수 SEO 블로그 관행만으로는 가중치를 정당화하지 마세요.

아래는 **페이지 유형별로 서로 다른 비중**으로 잘린 리서치 코퍼스입니다. 각 프로필을 설계할 때는 **해당 섹션의 가중치(학술 / 공식·권위 업계 / 트렌드)**를 최우선으로 반영하세요. 학술(academic)이 전체 철학에서 항상 기반이지만, editorial·video·commerce마다 공식·업계·트렌드 비중이 다릅니다.

출처 태그:
- [academic]: 학술 문헌 — IR, QA, RAG, ranking, citation
- [official]: 공식 문서 (Google Search Central, Schema.org, W3C 등)
- [industry]: 권위 업계 자료
- [trend]: (있을 때만) Tavily 등 최근 웹 논의 — 보조 신호

**프로필별 규칙:** \`editorial\` 프로필은 "Weighted research corpus — editorial" 섹션을, \`video\`는 video 섹션을, \`commerce\`는 commerce 섹션을 각각 **주요 근거**로 삼으세요. \`default\`는 editorial 가중치와 동일한 코퍼스를 따르되 필요 시 중립적으로 조정하세요.

## 리서치 결과 (페이지 유형별 가중치·문자 예산 적용)

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
  },
  "passedRules": [
    {
      "id": "monthly_pass_quotable",
      "axis": "citation",
      "label": "인용 가능 문장 충분",
      "description": "짧은 인용 가능 문장이 기준 이상입니다.",
      "reasonTemplate": "구체적 수치·팩트 문장이 충분해 AI 인용에 유리합니다.",
      "check": "quotable_sentences_min",
      "threshold": 3,
      "pageTypes": ["editorial", "default"]
    }
  ],
  "opportunityTemplates": [
    {
      "id": "monthly_opp_schema_faq",
      "improvesAxis": "structure",
      "fixesIssueId": "no_schema",
      "impact": "medium",
      "title": "FAQ/HowTo 스키마 보강",
      "rationaleTemplate": "구조화 데이터로 엔티티 이해와 스니펫 후보를 넓힙니다."
    }
  ]
}
\`\`\`

루트 레벨 \`passedRules\`, \`opportunityTemplates\`는 **선택**입니다. 생략해도 됩니다. 포함할 때는 GEO Explain 레이어와 동일한 의미로 채웁니다.

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

5. **passedRules** (선택): 각 항목은 id, axis(citation|paragraph|answerability|structure|trust|questionMatch|questionCoverage|density|videoMetadata), label, description, reasonTemplate, check(반드시 evaluateCheck DSL에 맞는 식별자 — issueRules의 check와 동일한 네임스페이스: ${SUPPORTED_CHECKS.join(', ')}, quotable_sentences_min, first_paragraph_quality 등), 선택적으로 threshold(number), pageTypes(editorial|video|commerce|default 배열).

6. **opportunityTemplates** (선택): 각 항목은 id, improvesAxis(위 axis와 동일 집합), impact(high|medium|low), title, rationaleTemplate 필수. fixesIssueId는 선택(issue rule id와 연결).

7. 마크다운 코드블록 없이 순수 JSON만 응답하세요.`;
}

interface GeoScoringConfigV2 {
  version: string;
  updatedAt: string;
  source: 'ai-generated' | 'manual';
  researchSummary: string;
  reasoning?: string;
  source_summary?: string[];
  profiles: Record<PageType, GeoScoringProfile>;
  /** Monthly GEO Explain “strengths” seeds (evaluateCheck DSL); optional — omit or [] to rely on code defaults */
  passedRules?: PassedRule[];
  /** Monthly opportunity seeds merged by OpportunityEngine; optional */
  opportunityTemplates?: OpportunityTemplate[];
}

const PROFILE_WEIGHT_KEYS = [
  'citation',
  'questionCoverage',
  'answerability',
  'structure',
  'trust',
  'questionMatch',
  'density',
  'dataDensity',
] as const;

const REQUIRED_PROFILE_KEYS = ['editorial', 'video', 'commerce', 'default'] as const;

const ISSUE_RULE_STRING_FIELDS = [
  'id',
  'check',
  'label',
  'description',
  'targetSelector',
] as const;

const WEIGHT_SUM_TOLERANCE = 0.05;

const GEO_AXIS_VALUES = new Set<string>([
  'citation',
  'paragraph',
  'answerability',
  'structure',
  'trust',
  'questionMatch',
  'questionCoverage',
  'density',
  'videoMetadata',
]);

const PAGE_TYPE_VALUES = new Set<string>(['editorial', 'video', 'commerce', 'default']);

const MAX_PASSED_RULES = 80;
const MAX_OPPORTUNITY_TEMPLATES = 60;

function validatePassedRulesField(value: unknown, reasons: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    reasons.push('passedRules must be an array when present');
    return;
  }
  if (value.length > MAX_PASSED_RULES) {
    reasons.push(`passedRules length ${value.length} exceeds max ${MAX_PASSED_RULES}`);
    return;
  }
  value.forEach((rule, i) => {
    if (!rule || typeof rule !== 'object') {
      reasons.push(`passedRules[${i}] is not an object`);
      return;
    }
    const r = rule as Record<string, unknown>;
    const stringFields = ['id', 'axis', 'label', 'description', 'reasonTemplate', 'check'] as const;
    for (const f of stringFields) {
      if (typeof r[f] !== 'string' || (r[f] as string).trim() === '') {
        reasons.push(`passedRules[${i}] missing or invalid ${f}`);
      }
    }
    if (typeof r.axis === 'string' && !GEO_AXIS_VALUES.has(r.axis)) {
      reasons.push(
        `passedRules[${i}] invalid axis (expected one of: ${[...GEO_AXIS_VALUES].join(', ')})`
      );
    }
    if (r.threshold !== undefined) {
      if (typeof r.threshold !== 'number' || Number.isNaN(r.threshold)) {
        reasons.push(`passedRules[${i}] invalid threshold`);
      }
    }
    if (r.pageTypes !== undefined) {
      if (!Array.isArray(r.pageTypes)) {
        reasons.push(`passedRules[${i}] pageTypes must be an array when present`);
      } else {
        r.pageTypes.forEach((pt, j) => {
          if (typeof pt !== 'string' || !PAGE_TYPE_VALUES.has(pt)) {
            reasons.push(
              `passedRules[${i}].pageTypes[${j}] invalid (expected editorial|video|commerce|default)`
            );
          }
        });
      }
    }
  });
}

function validateOpportunityTemplatesField(value: unknown, reasons: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    reasons.push('opportunityTemplates must be an array when present');
    return;
  }
  if (value.length > MAX_OPPORTUNITY_TEMPLATES) {
    reasons.push(
      `opportunityTemplates length ${value.length} exceeds max ${MAX_OPPORTUNITY_TEMPLATES}`
    );
    return;
  }
  value.forEach((t, i) => {
    if (!t || typeof t !== 'object') {
      reasons.push(`opportunityTemplates[${i}] is not an object`);
      return;
    }
    const o = t as Record<string, unknown>;
    for (const f of ['id', 'title', 'rationaleTemplate'] as const) {
      if (typeof o[f] !== 'string' || (o[f] as string).trim() === '') {
        reasons.push(`opportunityTemplates[${i}] missing or invalid ${f}`);
      }
    }
    const ax = o.improvesAxis;
    if (typeof ax !== 'string' || !GEO_AXIS_VALUES.has(ax)) {
      reasons.push(`opportunityTemplates[${i}] missing or invalid improvesAxis`);
    }
    const imp = o.impact;
    if (imp !== 'high' && imp !== 'medium' && imp !== 'low') {
      reasons.push(`opportunityTemplates[${i}] invalid impact (expected high|medium|low)`);
    }
    if (o.fixesIssueId !== undefined && typeof o.fixesIssueId !== 'string') {
      reasons.push(`opportunityTemplates[${i}] fixesIssueId must be a string when present`);
    }
  });
}

function validateGeoScoringConfigV2(
  config: unknown
): { ok: true; data: GeoScoringConfigV2 } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];

  if (!config || typeof config !== 'object') {
    return { ok: false, reasons: ['config root is not a non-null object'] };
  }

  const c = config as Record<string, unknown>;

  if (typeof c.version !== 'string') {
    reasons.push('top-level version is missing or not a string');
  }

  if (c.reasoning !== undefined && typeof c.reasoning !== 'string') {
    reasons.push('reasoning must be a string when present');
  }

  if (c.source_summary !== undefined && !Array.isArray(c.source_summary)) {
    reasons.push('source_summary must be an array when present');
  }

  if (!c.profiles || typeof c.profiles !== 'object') {
    reasons.push('profiles is missing or not an object');
    return { ok: false, reasons };
  }

  const profiles = c.profiles as Record<string, unknown>;

  for (const profileKey of REQUIRED_PROFILE_KEYS) {
    const p = profiles[profileKey];
    if (!p || typeof p !== 'object') {
      reasons.push(`missing or invalid profile: ${profileKey}`);
      continue;
    }
    const prof = p as Record<string, unknown>;

    if (!prof.weights || typeof prof.weights !== 'object') {
      reasons.push(`${profileKey}.weights missing or not an object`);
    } else {
      const w = prof.weights as Record<string, unknown>;
      let sum = 0;
      const nonNumericWeightKeys: string[] = [];
      for (const k of PROFILE_WEIGHT_KEYS) {
        const v = w[k];
        if (v === undefined) continue;
        if (typeof v === 'number' && !Number.isNaN(v)) {
          sum += v;
        } else {
          nonNumericWeightKeys.push(k);
        }
      }
      if (nonNumericWeightKeys.length > 0) {
        reasons.push(
          `${profileKey}.weights non-numeric or invalid: ${nonNumericWeightKeys.join(', ')}`
        );
      }
      if (Math.abs(sum - 1.0) > WEIGHT_SUM_TOLERANCE) {
        reasons.push(
          `${profileKey}.weights sum ${sum.toFixed(4)} !== 1.0 (tolerance ${WEIGHT_SUM_TOLERANCE})`
        );
      }
    }

    if (!Array.isArray(prof.issueRules)) {
      reasons.push(`${profileKey}.issueRules is not an array`);
    } else {
      prof.issueRules.forEach((rule, i) => {
        if (!rule || typeof rule !== 'object') {
          reasons.push(`${profileKey}.issueRules[${i}] is not an object`);
          return;
        }
        const r = rule as Record<string, unknown>;
        for (const field of ISSUE_RULE_STRING_FIELDS) {
          if (typeof r[field] !== 'string' || (r[field] as string).trim() === '') {
            reasons.push(`${profileKey}.issueRules[${i}] missing or invalid ${field}`);
          }
        }
        const pr = r.priority;
        if (pr !== 'high' && pr !== 'medium' && pr !== 'low') {
          reasons.push(
            `${profileKey}.issueRules[${i}] invalid priority (expected high|medium|low, got ${JSON.stringify(pr)})`
          );
        }
        if (typeof r.targetIndex !== 'number' || Number.isNaN(r.targetIndex)) {
          reasons.push(`${profileKey}.issueRules[${i}] missing or invalid targetIndex`);
        }
      });
    }

    if (!Array.isArray(prof.queryTemplates)) {
      reasons.push(`${profileKey}.queryTemplates is not an array`);
    } else {
      prof.queryTemplates.forEach((qt, i) => {
        if (typeof qt !== 'string') {
          reasons.push(`${profileKey}.queryTemplates[${i}] is not a string`);
        }
      });
    }
  }

  validatePassedRulesField(c.passedRules, reasons);
  validateOpportunityTemplatesField(c.opportunityTemplates, reasons);

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }

  return { ok: true, data: config as GeoScoringConfigV2 };
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
    // Optional AI-provided explanation and source list
    reasoning: v2.reasoning,
    source_summary: v2.source_summary,
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
    ...(v2.passedRules !== undefined ? { passedRules: v2.passedRules } : {}),
    ...(v2.opportunityTemplates !== undefined
      ? { opportunityTemplates: v2.opportunityTemplates }
      : {}),
    youtubePassedCheckRules: def.youtubePassedCheckRules,
    youtubeAllowedIssueIds: def.youtubeAllowedIssueIds,
    profiles: v2.profiles,
  };
}

export async function GET() {
  try {
    const reachable = await isSupabaseReachable();
    if (!reachable) {
      return NextResponse.json({ error: 'Supabase에 연결할 수 없습니다.' }, { status: 503 });
    }

    const dbClient = supabaseAdmin ?? supabase;
    const { data, error } = await dbClient
      .from('geo_scoring_config')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      const serr = error as { message?: string; details?: string; hint?: string } | null;
      console.error('Supabase select error (GET):', { message: serr?.message, details: serr?.details, hint: serr?.hint });
      return NextResponse.json({ error: 'DB 조회 실패' }, { status: 500 });
    }

    const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
    if (!row) {
      return NextResponse.json(
        {
          status: 'NO_ACTIVE_CONFIG' satisfies GeoConfigGetStatus,
          message: 'No active geo_scoring_config row',
          version: null,
          created_at: null,
          expires_at: null,
          days_until_next_update: null,
        },
        { status: 200 }
      );
    }

    const createdAt = row.created_at ? new Date(row.created_at) : null;
    const ageDays = ageDaysFromCreatedAt(row.created_at);
    const withinTtl = ageDays !== null && !isConfigExpired(row.created_at);
    const getStatus: GeoConfigGetStatus =
      ageDays === null ? 'STALE' : withinTtl ? 'CACHED' : 'STALE';

    let daysUntilNextUpdate: number | null = null;
    let expiresAt: string | null = null;
    if (createdAt && ageDays !== null) {
      daysUntilNextUpdate = Math.max(0, CONFIG_VALIDITY_DAYS - ageDays);
      expiresAt = new Date(
        createdAt.getTime() + CONFIG_VALIDITY_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();
    }

    const daysInt = typeof daysUntilNextUpdate === 'number' ? Math.floor(daysUntilNextUpdate) : null;
    return NextResponse.json(
      {
        status: getStatus,
        message:
          getStatus === 'CACHED'
            ? `Active config is within ${CONFIG_VALIDITY_DAYS}-day window`
            : ageDays === null
              ? 'Active config has missing or invalid created_at — POST to rebuild'
              : `Active config is past ${CONFIG_VALIDITY_DAYS}-day window — POST to refresh`,
        version: row.version ?? null,
        created_at: createdAt ? createdAt.toISOString() : null,
        expires_at: expiresAt,
        days_until_next_update: daysInt,
        config: row.config_json ?? null,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('geo-config GET error:', err);
    return NextResponse.json({ error: '서버 오류' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const url = typeof req?.url === 'string' ? new URL(req.url) : null;
    const force = url ? url.searchParams.get('force') === 'true' : false;

    /**
     * POST /api/geo-config/update — GEO config refresh only (never called from /api/analyze).
     * - force=true → always rebuild (Gemini + DB).
     * - else no active row → rebuild.
     * - else missing/invalid created_at → rebuild.
     * - else age < CONFIG_VALIDITY_DAYS → CACHED (no Gemini, no DB writes).
     * - else age >= CONFIG_VALIDITY_DAYS → rebuild.
     */

    const reachable = await isSupabaseReachable();
    if (!reachable) {
      return NextResponse.json(
        { error: 'Supabase에 연결할 수 없습니다. 프로젝트 상태를 확인하세요.' },
        { status: 503 }
      );
    }

    const dbClient = supabaseAdmin ?? supabase;
    const { data: rows, error: selectErr } = await dbClient
      .from('geo_scoring_config')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1);

    if (selectErr) {
      const serr = selectErr as { message?: string; details?: string; hint?: string } | null;
      console.error('Supabase select error (POST):', serr?.message, serr?.details, serr?.hint);
      return NextResponse.json(
        { error: 'DB 조회 실패', detail: serr?.message },
        { status: 500 }
      );
    }

    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    const ageDays = ageDaysFromCreatedAt(row?.created_at);

    let rebuildReason: 'force' | 'no_active_config' | 'expired' | 'missing_created_at';
    if (force) {
      rebuildReason = 'force';
    } else if (!row) {
      rebuildReason = 'no_active_config';
    } else if (ageDays === null) {
      rebuildReason = 'missing_created_at';
    } else if (ageDays !== null && !isConfigExpired(row.created_at)) {
      const createdAt = new Date(row.created_at as string);
      const daysUntilNext = Math.max(0, CONFIG_VALIDITY_DAYS - ageDays);
      return NextResponse.json(
        {
          status: 'CACHED' satisfies GeoConfigPostStatus,
          message: `Active config is within ${CONFIG_VALIDITY_DAYS}-day window`,
          version: row.version ?? null,
          days_until_next_update: daysUntilNext,
          created_at: createdAt.toISOString(),
          expires_at: new Date(
            createdAt.getTime() + CONFIG_VALIDITY_DAYS * 24 * 60 * 60 * 1000
          ).toISOString(),
          config: row.config_json ?? null,
          forced: false,
        },
        { status: 200 }
      );
    } else {
      rebuildReason = 'expired';
    }

    const paidGeminiKey = getGeminiPaidApiKey();
    if (!paidGeminiKey) {
      return NextResponse.json(
        {
          error:
            '유료 Gemini API 키가 필요합니다. GEMINI_PAID_API_KEY, GEMINI_API_KEY, GOOGLE_GENAI_API_KEY 중 하나를 설정하세요.',
        },
        { status: 500 }
      );
    }

    // Prompt seed: DB active row only — never the in-memory analyze cache (invalidateConfigCache is separate).
    const currentConfig = configJsonOrDefault(row);

    // Buckets ordered academic → official → industry → [trend]; weighting policy: 09-geo-research-policy.md
    const researchBuckets = await fetchGeoCriteriaResearch();

    if (!researchHasContent(researchBuckets)) {
      return NextResponse.json(
        {
          error:
            'GEO 기준 리서치 결과가 비어 있습니다. 공식·업계 URL 수집 또는 Semantic Scholar 응답을 확인하세요. (Tavily는 페이지 분석용이며, 월간 기준 보조만 필요하면 GEO_CONFIG_TAVILY_SUPPLEMENT=true 와 TAVILY_API_KEY를 설정하세요.)',
        },
        { status: 502 }
      );
    }

    const genAI = new GoogleGenerativeAI(paidGeminiKey);

    // Choose model from env with sensible fallbacks; log chosen model for diagnostics
    const chosenModel =
      process.env.GEMINI_MODEL ??
      process.env.GENERATIVE_MODEL ??
      process.env.DEFAULT_GEMINI_MODEL ??
      'text-bison-001';
    console.log('[GEMINI] chosen model for geo-config update:', chosenModel);

    const model = genAI.getGenerativeModel({ model: chosenModel });

    // Optional: try to validate model availability if API exposes a listing method
    async function validateModelAvailability(): Promise<boolean | null> {
      try {
        // Some SDKs expose listModels / getModels; try defensively
        const maybeListFn = (genAI as any).listModels ?? (genAI as any).getModels;
        if (typeof maybeListFn === 'function') {
          const list = await maybeListFn.call(genAI);
          if (Array.isArray(list)) {
            const found = list.some((m: any) => {
              const name = (m?.name ?? m?.id ?? String(m)).toString();
              return name.includes(chosenModel);
            });
            return found;
          }
        }
      } catch (err) {
        console.warn('[GEMINI] model list validation failed:', err);
        return null;
      }
      return null;
    }

    const prompt = buildGeminiPrompt(currentConfig, researchBuckets);

    // Validate configured model if possible
    try {
      const available = await validateModelAvailability();
      if (available === false) {
        console.error('[GEMINI] configured model not available:', chosenModel);
        return NextResponse.json(
          {
            error: 'Configured Gemini model is not available.',
            detail: `Configured model "${chosenModel}" was not found among available models. Please check GEMINI_MODEL / GENERATIVE_MODEL environment variables.`,
          },
          { status: 500 }
        );
      }
    } catch (e) {
      console.warn('[GEMINI] model availability check threw:', e);
    }

    let responseText: string;
    try {
      await waitForGeminiRateLimitSlot('geoConfigUpdate');
      const geminiResult = await model.generateContent(prompt);
      responseText = geminiResult.response.text().trim();
    } catch (err: any) {
      console.error('[GoogleGenerativeAI Error]:', err?.message ?? err);
      return NextResponse.json(
        {
          error: 'GEO 기준 업데이트 중 오류가 발생했습니다.',
          detail:
            err?.message ??
            String(err) ??
            `Failed to call generateContent on model ${chosenModel}.`,
        },
        { status: 500 }
      );
    }

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

    const validated = validateGeoScoringConfigV2(parsed);
    if (!validated.ok) {
      const detail = `Validation failed: ${validated.reasons.join('; ')}`;
      console.error('[geo-config/update] Gemini profile validation failed:', detail);
      console.error('[geo-config/update] validation_reasons:', validated.reasons);
      return NextResponse.json(
        {
          error: 'Gemini가 생성한 프로필 설정이 유효하지 않습니다.',
          detail,
          validation_reasons: validated.reasons,
          raw: JSON.stringify(parsed).substring(0, 2000),
        },
        { status: 422 }
      );
    }

    const v2 = validated.data;
    v2.updatedAt = new Date().toISOString();
    v2.source = 'ai-generated';

    const legacyConfig = toLegacyConfig(v2);

    // Reuse dbClient from the start of POST (already verified Supabase reachable).
    const rlsAdviceSql = `-- Recommended: perform server-side writes using SUPABASE_SERVICE_ROLE_KEY (do NOT expose this key to clients).
-- If you absolutely must allow authenticated inserts, consider a restrictive policy using a custom JWT claim:
-- CREATE POLICY allow_service_insert ON public.geo_scoring_config
--   FOR INSERT
--   USING ((current_setting('jwt.claims.is_service', true))::boolean = true);`;

    // Sequential approach: deactivate previous active configs, then insert new active config.
    try {
      const { error: deactivateErr } = await dbClient
        .from('geo_scoring_config')
        .update({ is_active: false })
        .eq('is_active', true);
      if (deactivateErr) {
        const derr = deactivateErr as { message?: string; details?: string; hint?: string } | null;
        console.error('Failed to deactivate previous configs:', derr?.message, derr?.details);
        // proceed — we still attempt to insert
      }

      const { data: insertData, error: insertErr } = await dbClient
        .from('geo_scoring_config')
        .insert({
          version: legacyConfig.version,
          config_json: legacyConfig,
          is_active: true,
        })
        .select()
        .limit(1);

      if (insertErr) {
        const ierr = insertErr as { message?: string; details?: string; hint?: string } | null;
        console.error('Supabase insert error:', ierr?.message, ierr?.details, ierr?.hint);
        return NextResponse.json(
          {
            error: 'DB 저장에 실패했습니다.',
            detail: ierr?.message,
            details: ierr?.details,
            hint: ierr?.hint,
            rls_advice: rlsAdviceSql,
          },
          { status: 500 }
        );
      }

      const persisted = Array.isArray(insertData) && insertData.length > 0 ? insertData[0] : null;
      if (!persisted) {
        console.error('Supabase insert succeeded but no row returned', { version: legacyConfig.version });
        return NextResponse.json(
          {
            error: 'DB에 데이터가 저장되었는지 확인할 수 없습니다.',
            rls_advice: rlsAdviceSql,
          },
          { status: 500 }
        );
      }

      // Compute metadata fields
      const createdAt = persisted.created_at ? new Date(persisted.created_at) : new Date();
      const expiresAt = new Date(createdAt.getTime() + CONFIG_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
      const ageMs = Date.now() - createdAt.getTime();
      const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
      const daysUntilNext = Math.max(0, CONFIG_VALIDITY_DAYS - ageDays);

      // Persist research sources (reference_sources) - ensure sources are saved and linked to config_version
      try {
        const sourcesToUpsert: Array<Record<string, unknown>> = [];
        for (const bucket of researchBuckets) {
          for (const item of bucket.items) {
            for (const s of item.sources ?? []) {
              if (!s || !s.url) continue;
              sourcesToUpsert.push({
                title: s.title ?? null,
                url: s.url ?? null,
                snippet: (item.resultsText ?? '').slice(0, 2000),
                source_type: providerToSourceType(bucket.provider),
                provider: bucket.provider,
                authority_level: getAuthorityLevel(String(s.url)),
                fetched_at: new Date().toISOString(),
                config_version: persisted.version ?? legacyConfig.version,
              });
            }
          }
        }

        if (sourcesToUpsert.length > 0) {
          const up = await dbClient
            .from('reference_sources')
            .upsert(sourcesToUpsert, { onConflict: 'url' })
            .select();
          if (up.error) {
            console.warn('reference_sources upsert error:', up.error.message, (up.error as any).details);
          }
        }
      } catch (srcErr) {
        console.warn('Failed to persist reference_sources:', srcErr);
      }

      invalidateConfigCache();

      return NextResponse.json(
        {
          status: 'REBUILT',
          version: persisted.version ?? legacyConfig.version,
          created_at: createdAt.toISOString(),
          expires_at: expiresAt.toISOString(),
          days_until_next_update: Math.floor(daysUntilNext),
          forced: force,
          rebuild_reason: rebuildReason,
        },
        { status: 200 }
      );
    } catch (dbErr) {
      console.error('DB transaction error:', dbErr);
      return NextResponse.json({ error: 'DB 처리 중 오류' }, { status: 500 });
    }

    // unreachable
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
