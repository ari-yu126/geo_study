import { loadActiveScoringConfig, resolveIssueRulesForPageType } from './scoringConfigLoader';
import { DEFAULT_SCORING_CONFIG } from './defaultScoringConfig';
import {
  runEditorialIssueEngine,
  runEditorialPassedEngine,
  runGeoRuleLayer,
  runOpportunityEngine,
  runYoutubeIssueEngine,
  runYoutubePassedEngine,
  geoPassedToPassedChecks,
  resolvePrimaryGeoIssues,
  resolvePrimaryGeoPassed,
} from './geoExplain';
import type { GeoRuleLayerResult } from './geoExplain';
import { dedupeGeoIssuesById } from './geoExplain/issueEngine';
import type {
  AnalysisResult,
  AuditIssue,
  FixExample,
  GeoIssue,
  GeoOpportunity,
  GeoPassedItem,
  IframePositionData,
  IssueRule,
  IssueGenerationDebug,
  PageType,
  PassedCheck,
  PlatformConstraint,
  StrengthGenerationDebug,
} from './analysisTypes';
import {
  filterNaverBlogGeoPassed,
  filterNaverBlogOpportunities,
  partitionNaverBlogGeoIssues,
} from './naverBlogAuditConstraints';
import { isHostedBlogPlatform } from './geoExplain/platformIssueWording';

export interface AuditResults {
  issues: AuditIssue[];
  passedChecks: PassedCheck[];
  geoIssues: GeoIssue[];
  geoPassedItems: GeoPassedItem[];
  opportunities: GeoOpportunity[];
  /** Naver Blog: technical SEO items moved out of actionable issues */
  platformConstraints?: PlatformConstraint[];
  /** Editorial + naver_blog: injected `blog_low_info_density` fallback */
  weakBlogFallbackApplied?: boolean;
  /** Editorial: optional diagnostics for config-driven strengths */
  strengthGenerationDebug?: StrengthGenerationDebug;
  /** Issue rule resolution diagnostics */
  issueGenerationDebug?: IssueGenerationDebug;
}

/** Synthetic audit rows (no row in monthly issueRules). */
const SYNTHETIC_ISSUE_AUDIT_LAYOUT: Record<string, { targetSelector: string; targetIndex: number }> = {
  blog_low_info_density: { targetSelector: 'article', targetIndex: 0 },
};

const BLOG_LOW_INFO_OVERLAP_ISSUE_IDS = new Set([
  'quotable',
  'content_short',
  'first_para',
  'content_len',
  'questions',
  'blog_low_info_density',
]);

function hasOverlappingInformationalIssue(issues: GeoIssue[]): boolean {
  for (const g of issues) {
    if (BLOG_LOW_INFO_OVERLAP_ISSUE_IDS.has(g.id)) return true;
    if (
      g.id.startsWith('axis_weak_paragraph') ||
      g.id.startsWith('axis_weak_answerability') ||
      g.id.startsWith('axis_weak_citation')
    ) {
      return true;
    }
  }
  return false;
}

function shouldInjectNaverBlogLowInfoIssue(result: AnalysisResult, issues: GeoIssue[]): boolean {
  if (result.platform !== 'naver_blog' || result.pageType !== 'editorial') return false;
  if (hasOverlappingInformationalIssue(issues)) return false;
  const s = result.scores;
  const cq = result.contentQuality;
  const ebs = cq.editorialBlogSignals;
  const primaryWeak =
    s.paragraphScore < 60 && s.answerabilityScore < 60 && cq.quotableSentenceCount < 12;
  const secondaryWeak =
    (ebs?.decisiveNonNumericCount ?? 0) < 4 && (ebs?.pageQuestionCount ?? 0) < 5;
  return primaryWeak || secondaryWeak;
}

function buildBlogLowInfoDensityGeoIssue(): GeoIssue {
  return {
    id: 'blog_low_info_density',
    category: 'weak_signals',
    axis: 'answerability',
    severity: 'high',
    label: '정보 밀도 부족',
    description:
      '경험·감상 위주의 문장이 많고, 검색자가 바로 활용할 수 있는 기준·비교·근거 정보가 부족합니다.',
    fix: '측정 가능한 기준, 비교 포인트, 근거·수치, 독자 상황별 선택 가이드를 본문에 보강하세요.',
    sourceRefs: { ruleId: 'blog_low_info_density' },
  };
}

export function generateFixExamples(
  ruleId: string,
  result: AnalysisResult
): FixExample[] {
  const url = result.url;
  const topKw = result.seedKeywords.slice(0, 3).map((k) => k.value);
  const kwStr = topKw.join(', ') || '주요 키워드';
  const domain = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return 'example.com';
    }
  })();

  const hosted = isHostedBlogPlatform(result.platform);

  switch (ruleId) {
    case 'title':
      return [
        {
          language: 'html',
          code: `<title>${kwStr} - ${domain} | 핵심 가이드</title>`,
        },
      ];

    case 'desc':
      if (hosted) {
        return [
          {
            language: 'markdown',
            code: [
              `## 도입 요약 (본문 상단)`,
              ``,
              `**핵심:** ${kwStr}에 대해 독자가 먼저 알아야 할 결론·범위·전제를 2~4문장으로 적습니다.`,
              ``,
              `아래 목차가 이어진다는 안내를 한 줄 넣어 스캔하기 쉽게 합니다.`,
            ].join('\n'),
          },
        ];
      }
      return [
        {
          language: 'html',
          code: `<meta name="description" content="${topKw[0] || '서비스'}에 대한 자주 묻는 질문과 답변을 확인하세요. ${kwStr} 관련 핵심 정보를 한눈에 정리했습니다." />`,
        },
      ];

    case 'desc_og_only':
      if (hosted) {
        return [
          {
            language: 'markdown',
            code: [
              `## 제목·첫 문단 (og 외 본문 신호 강화)`,
              ``,
              `- **제목:** 검색 질문에 가깝게 범위·대상을 드러내기`,
              `- **첫 단락:** ${kwStr} 관련 핵심 결론·요약을 2~4문장으로`,
              `- **상단:** 숫자·조건·대상 독자 등 키 정보를 불릿으로`,
            ].join('\n'),
          },
        ];
      }
      return [
        {
          language: 'html',
          code: `<meta name="description" content="${(result.meta.ogDescription || '').slice(0, 155) || `${kwStr}에 대한 핵심 요약`}" />`,
        },
      ];

    case 'struct':
      return [
        {
          language: 'html',
          code: [
            `<h1>${topKw[0] || '주제'} 완벽 가이드</h1>`,
            `<p>${topKw[0] || '주제'}에 대해 가장 많이 묻는 질문과 전문가 답변을 정리했습니다.</p>`,
            ``,
            `<h2>${topKw[0] || '주제'}란 무엇인가요?</h2>`,
            `<p>답변 내용을 여기에 작성...</p>`,
            ``,
            `<h2>${topKw[0] || '주제'} 선택 시 주의할 점은?</h2>`,
            `<p>답변 내용을 여기에 작성...</p>`,
          ].join('\n'),
        },
      ];

    case 'qcov': {
      const uncovered = result.searchQuestions
        .filter((sq) => {
          const tokens = sq.text
            .toLowerCase()
            .split(/\s+/)
            .filter((t) => t.length >= 2);
          const pageText = result.pageQuestions.join(' ').toLowerCase();
          const matches = tokens.filter((t) => pageText.includes(t)).length;
          return matches < Math.max(1, Math.ceil(tokens.length * 0.4));
        })
        .slice(0, 4);

      const faqItems = uncovered.length > 0
        ? uncovered
            .map(
              (q) =>
                `  <div itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">\n    <h3 itemprop="name">${q.text}</h3>\n    <div itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">\n      <p itemprop="text">답변을 여기에 작성하세요.</p>\n    </div>\n  </div>`
            )
            .join('\n\n')
        : `  <div itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">\n    <h3 itemprop="name">${kwStr} 관련 자주 묻는 질문은?</h3>\n    <div itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">\n      <p itemprop="text">답변을 여기에 작성하세요.</p>\n    </div>\n  </div>`;

      return [
        {
          language: 'html',
          code: `<section itemscope itemtype="https://schema.org/FAQPage">\n  <h2>자주 묻는 질문 (FAQ)</h2>\n\n${faqItems}\n</section>`,
        },
      ];
    }

    case 'og':
      if (hosted) {
        return [
          {
            language: 'markdown',
            code: [
              `## 공유·미리보기에 쓰이는 정보`,
              ``,
              `- **제목:** 검색 질문에 가깝게 키워드와 범위를 드러내기`,
              `- **첫 단락:** 요약·결론이 바로 보이게 작성 (플랫폼 편집기 상단 본문)`,
              `- **대표 이미지:** 주제가 한눈에 드러나는 이미지 선택`,
            ].join('\n'),
          },
        ];
      }
      return [
        {
          language: 'html',
          code: [
            `<meta property="og:title" content="${result.meta.title || `${kwStr} 가이드`}" />`,
            `<meta property="og:description" content="${result.meta.description || `${kwStr}에 대한 핵심 정보와 FAQ`}" />`,
            `<meta property="og:type" content="website" />`,
            `<meta property="og:url" content="${url}" />`,
          ].join('\n'),
        },
      ];

    case 'canonical':
      return [
        {
          language: 'html',
          code: `<link rel="canonical" href="${url}" />`,
        },
      ];

    case 'questions':
      return [
        {
          language: 'html',
          code: [
            `<!-- 소제목을 질문형으로 변경하세요 -->`,
            `<h2>${topKw[0] || '제품'}은 어떻게 사용하나요?</h2>`,
            `<p>구체적인 사용 방법을 단계별로 설명...</p>`,
            ``,
            `<h2>${topKw[0] || '제품'}의 수명은 얼마나 되나요?</h2>`,
            `<p>평균 수명과 관리 팁을 설명...</p>`,
            ``,
            `<h2>${topKw[1] || '서비스'} 비용은 어느 정도인가요?</h2>`,
            `<p>가격대와 옵션별 비교 설명...</p>`,
          ].join('\n'),
        },
      ];

    case 'kw':
      return [
        {
          language: 'html',
          code: [
            `<!-- 핵심 키워드를 제목과 도입부에 자연스럽게 배치 -->`,
            `<h1>${kwStr} 완벽 정리</h1>`,
            `<p>`,
            `  ${topKw[0] || '키워드'}에 대해 알아야 할 모든 것을 정리했습니다.`,
            `  ${topKw[1] ? `${topKw[1]}과의 차이점부터 ` : ''}${topKw[2] ? `${topKw[2]} 활용법까지, ` : ''}`,
            `  전문가의 시각으로 해설합니다.`,
            `</p>`,
          ].join('\n'),
        },
      ];

    case 'content_short':
      return [
        {
          language: 'html',
          code: [
            `<!-- 각 섹션에 충분한 설명을 추가하세요 -->`,
            `<h2>${topKw[0] || '주제'} 개요</h2>`,
            `<p>${topKw[0] || '주제'}의 기본 개념과 핵심 특징을 설명합니다...</p>`,
            ``,
            `<h2>${topKw[0] || '주제'} 비교 분석</h2>`,
            `<p>주요 옵션별 장단점을 비교 분석합니다...</p>`,
            `<table>`,
            `  <tr><th>항목</th><th>옵션 A</th><th>옵션 B</th></tr>`,
            `  <tr><td>특징</td><td>설명</td><td>설명</td></tr>`,
            `</table>`,
            ``,
            `<h2>전문가 추천</h2>`,
            `<p>상황별 최적의 선택을 안내합니다...</p>`,
          ].join('\n'),
        },
      ];

    case 'no_tables':
      return [
        {
          language: 'html',
          code: [
            `<!-- 비교표를 추가하면 AI가 데이터를 쉽게 추출할 수 있습니다 -->`,
            `<h2>${topKw[0] || '항목'} 비교</h2>`,
            `<table>`,
            `  <thead>`,
            `    <tr>`,
            `      <th>구분</th>`,
            `      <th>옵션 A</th>`,
            `      <th>옵션 B</th>`,
            `      <th>옵션 C</th>`,
            `    </tr>`,
            `  </thead>`,
            `  <tbody>`,
            `    <tr><td>가격</td><td>10만원대</td><td>20만원대</td><td>30만원대</td></tr>`,
            `    <tr><td>성능</td><td>보통</td><td>좋음</td><td>매우 좋음</td></tr>`,
            `    <tr><td>추천 대상</td><td>입문자</td><td>일반 사용자</td><td>전문가</td></tr>`,
            `  </tbody>`,
            `</table>`,
          ].join('\n'),
        },
      ];

    case 'h2_few':
      return [
        {
          language: 'html',
          code: [
            `<!-- H2로 콘텐츠를 명확하게 섹션으로 나누세요 -->`,
            `<h2>${topKw[0] || '주제'}란?</h2>`,
            `<p>기본 개념 설명...</p>`,
            ``,
            `<h2>${topKw[0] || '주제'} 종류와 특징</h2>`,
            `<p>유형별 특징 비교...</p>`,
            ``,
            `<h2>${topKw[0] || '주제'} 선택 가이드</h2>`,
            `<p>상황별 추천...</p>`,
            ``,
            `<h2>자주 묻는 질문</h2>`,
            `<p>FAQ 항목들...</p>`,
          ].join('\n'),
        },
      ];

    case 'no_lists':
      return [
        {
          language: 'html',
          code: [
            `<!-- 핵심 포인트를 목록으로 정리하세요 -->`,
            `<h3>${topKw[0] || '주제'} 선택 시 확인할 점</h3>`,
            `<ul>`,
            `  <li>첫 번째 핵심 포인트</li>`,
            `  <li>두 번째 핵심 포인트</li>`,
            `  <li>세 번째 핵심 포인트</li>`,
            `</ul>`,
            ``,
            `<h3>추천 순서</h3>`,
            `<ol>`,
            `  <li>1단계: 기본 조건 확인</li>`,
            `  <li>2단계: 옵션 비교</li>`,
            `  <li>3단계: 최종 선택</li>`,
            `</ol>`,
          ].join('\n'),
        },
      ];

    case 'no_schema':
      if (hosted) {
        return [
          {
            language: 'markdown',
            code: [
              `## 본문에서 정보 구조화하기`,
              ``,
              `### ${topKw[0] || '주제'} 한눈에 보기`,
              `- 항목 A: 요약`,
              `- 항목 B: 요약`,
              ``,
              `### 자주 묻는 질문`,
              `**Q.** ${topKw[0] || '주제'}는 언제 필요한가요?`,
              `**A.** 짧게 답하고, 아래 표에서 비교합니다.`,
              ``,
              `| 구분 | 옵션 1 | 옵션 2 |`,
              `| --- | --- | --- |`,
              `| 특징 | | |`,
            ].join('\n'),
          },
        ];
      }
      return [
        {
          language: 'html',
          code: [
            `<script type="application/ld+json">`,
            `{`,
            `  "@context": "https://schema.org",`,
            `  "@type": "Article",`,
            `  "headline": "${result.meta.title || `${kwStr} 가이드`}",`,
            `  "description": "${result.meta.description || `${kwStr}에 대한 종합 가이드`}",`,
            `  "author": {`,
            `    "@type": "Organization",`,
            `    "name": "${domain}"`,
            `  }`,
            `}`,
            `</script>`,
          ].join('\n'),
        },
      ];

    case 'first_para':
      return [
        {
          language: 'html',
          code: [
            `<!-- 첫 문단에 주제 + 가치를 담으세요. 기존 문장을 확장하는 방식 권장 -->`,
            `<p>`,
            `  ${topKw[0] || '주제'}에 대해 ${topKw[1] ? `${topKw[1]}를 고려한 ` : ''}실질적인 선택 기준과 활용 팁을 정리했습니다.`,
            `  구체적인 수치나 비교 데이터를 추가하면 AI 인용 확률이 높아집니다.`,
            `</p>`,
          ].join('\n'),
        },
      ];

    case 'quotable':
      return [
        {
          language: 'html',
          code: [
            `<!-- AI가 인용할 수 있는 짧고 구체적인 문장 예시 -->`,
            `<p>${topKw[0] || '제품'}의 평균 수명은 약 5~7년입니다.</p>`,
            `<p>2026년 기준 시장 점유율은 약 35%로 업계 1위입니다.</p>`,
            `<p>소비전력은 1,500W 이상을 추천하며, 가격대는 5~20만원입니다.</p>`,
          ].join('\n'),
        },
      ];

    case 'blog_low_info_density':
      return [
        {
          language: 'markdown',
          code: [
            `## 정보 밀도 올리기`,
            ``,
            `- **비교:** A와 B의 차이를 2~3가지 기준(가격·내구성·사용 환경 등)으로 표나 목록으로 정리`,
            `- **근거:** 가능한 한 수치·범위·조건(예: "주 3회 이상 사용 시")을 문장에 포함`,
            `- **선택 가이드:** "이런 분에게 맞음 / 덜 맞음"을 구체적 조건과 함께 작성`,
          ].join('\n'),
        },
      ];

    case 'author':
      return [
        {
          language: 'html',
          code: [
            `<meta name="author" content="홍길동" />`,
            ``,
            `<!-- 본문 내 저자 표시 -->`,
            `<div class="author">`,
            `  <span itemprop="author">홍길동</span>`,
            `  <span>| ${domain} 전문 에디터</span>`,
            `</div>`,
          ].join('\n'),
        },
      ];

    case 'pub_date':
      if (hosted) {
        return [
          {
            language: 'markdown',
            code: [
              `## 발행·갱신 정보`,
              ``,
              `- 글 상단 또는 하단에 **발행일**(및 필요 시 **수정일**)이 독자에게 보이는지 확인합니다.`,
              `- 플랫폼에서 제공하는 발행일·공개 범위 설정을 활용합니다.`,
            ].join('\n'),
          },
        ];
      }
      return [
        {
          language: 'html',
          code: [
            `<meta property="article:published_time" content="2026-02-21T00:00:00Z" />`,
            `<meta property="article:modified_time" content="2026-02-21T00:00:00Z" />`,
            ``,
            `<!-- 본문 내 날짜 표시 -->`,
            `<time datetime="2026-02-21">2026년 2월 21일 작성</time>`,
          ].join('\n'),
        },
      ];

    case 'contact':
      return [
        {
          language: 'html',
          code: `<a href="/contact">문의하기</a> | <a href="/about">회사 소개</a>`,
        },
      ];

    case 'missing_clear_verdict':
    case 'missing_comparison_logic':
    case 'weak_claim_evidence':
    case 'missing_user_context':
      return [
        {
          language: 'markdown',
          code: [
            `## 보강 포인트`,
            `- 상단 또는 하단에 **한 줄 결론/추천**을 명시합니다.`,
            `- **비교 기준·장단점** 또는 선택 체크리스트를 추가합니다.`,
            `- 주장마다 **근거·수치·출처**를 붙입니다.`,
            `- **어떤 독자/상황**에 맞는지 한 단락으로 설명합니다.`,
          ].join('\n'),
        },
      ];

    default:
      return [];
  }
}

function geoIssuesToAuditIssues(
  geoIssues: GeoIssue[],
  result: AnalysisResult,
  rulesSource: IssueRule[]
): AuditIssue[] {
  let num = 1;
  return geoIssues.map((g) => {
    const rule = rulesSource.find((r) => r.id === g.id);
    const synthetic = SYNTHETIC_ISSUE_AUDIT_LAYOUT[g.id];
    return {
      id: g.id,
      number: num++,
      label: g.label,
      description: g.description,
      priority: g.severity,
      targetSelector: synthetic?.targetSelector ?? rule?.targetSelector ?? '_top',
      targetIndex: synthetic?.targetIndex ?? rule?.targetIndex ?? 0,
      fixExamples: generateFixExamples(g.id, result),
    };
  });
}

export async function deriveAuditIssues(
  result: AnalysisResult,
  positionData?: IframePositionData
): Promise<AuditResults> {
  let strengthGenerationDebug: StrengthGenerationDebug | undefined;
  let issueGenerationDebug: IssueGenerationDebug | undefined;
  const config = await loadActiveScoringConfig();
  const pageTypeKey = (result.pageType ?? 'editorial') as PageType;

  let rulesSource: IssueRule[];
  let rulesSourceLabel: 'config' | 'default';
  let geoIssues: GeoIssue[];
  let geoPassed: GeoPassedItem[];
  let skipTextOnlyRules: boolean;
  let ytAllowResolved: { ids: string[]; source: 'config' | 'default' };
  let issueRulesToUseLen: number;
  let ruleLayer: GeoRuleLayerResult | undefined;

  // Video pipeline only: web/editorial results also set `auditIssues` from rule engines — must not use YouTube mappers.
  if (result.pageType === 'video') {
    const issueRes = resolveIssueRulesForPageType(config, 'video');
    rulesSource = issueRes.rules;
    rulesSourceLabel = issueRes.source === 'fallback' ? 'default' : 'config';
    geoIssues = runYoutubeIssueEngine(result);
    geoPassed = await runYoutubePassedEngine(result);
    skipTextOnlyRules = false;
    ytAllowResolved = { ids: [], source: 'default' };
    issueRulesToUseLen = issueRes.rules.length;
  } else {
    ruleLayer = await runGeoRuleLayer(result);
    rulesSource = ruleLayer.auditIssueRules;
    rulesSourceLabel = ruleLayer.rulesSourceLabel;
    geoIssues = await runEditorialIssueEngine(result, ruleLayer);
    const editorialPassed = await runEditorialPassedEngine(result, ruleLayer);
    geoPassed = editorialPassed.items;
    strengthGenerationDebug = editorialPassed.strengthGenerationDebug;
    skipTextOnlyRules = ruleLayer.skipTextOnlyRules;
    ytAllowResolved = ruleLayer.ytAllowResolved;
    issueRulesToUseLen = ruleLayer.issueRulesToUse.length;
  }

  const { primary: finalGeoIssues, source: geoIssueSource } = resolvePrimaryGeoIssues(result, geoIssues);
  const useExplainIssues = geoIssueSource === 'geoExplain';

  const { primary: finalGeoPassed, source: geoPassedSource } = resolvePrimaryGeoPassed(result, geoPassed);

  let workingGeoIssues = finalGeoIssues;
  let workingGeoPassed = finalGeoPassed;
  let platformConstraints: PlatformConstraint[] | undefined;

  if (result.platform === 'naver_blog') {
    const partitioned = partitionNaverBlogGeoIssues(finalGeoIssues);
    workingGeoIssues = partitioned.actionable;
    platformConstraints =
      partitioned.constraints.length > 0 ? partitioned.constraints : undefined;
    workingGeoPassed = filterNaverBlogGeoPassed(finalGeoPassed);
  }

  let weakBlogFallbackApplied = false;
  if (shouldInjectNaverBlogLowInfoIssue(result, workingGeoIssues)) {
    workingGeoIssues = dedupeGeoIssuesById([
      ...workingGeoIssues,
      buildBlogLowInfoDensityGeoIssue(),
    ]);
    weakBlogFallbackApplied = true;
  }

  let opportunities = runOpportunityEngine(result, workingGeoIssues, config);
  if (result.platform === 'naver_blog') {
    opportunities = filterNaverBlogOpportunities(opportunities);
  }

  {
    const matchedRuleIds = workingGeoIssues
      .filter((g) => !g.id.startsWith('axis_weak'))
      .map((g) => g.id);
    const hasAxisWeak = workingGeoIssues.some((g) => g.id.startsWith('axis_weak'));
    const resSrc =
      ruleLayer?.issueRulesResolutionSource ??
      resolveIssueRulesForPageType(config, pageTypeKey).source;
    let src: IssueGenerationDebug['source'];
    if ((resSrc === 'profile' || resSrc === 'root') && hasAxisWeak) src = 'mixed';
    else if (resSrc === 'profile') src = 'profile';
    else if (resSrc === 'root') src = 'root';
    else src = 'fallback';
    issueGenerationDebug = {
      source: src,
      matchedRuleIds,
      pageType: String(result.pageType ?? 'editorial'),
    };
  }

  const issues = geoIssuesToAuditIssues(workingGeoIssues, result, rulesSource);
  const passedChecks = geoPassedToPassedChecks(workingGeoPassed);

  const scrollHeight = positionData?.scrollHeight ?? 3000;

  const assignPosition = (
    targetSelector: string,
    targetIndex: number
  ): { top: number; left: number; width: number; height: number } | undefined => {
    if (targetSelector === '_top') {
      return { top: 8 + targetIndex * 36, left: 8, width: 200, height: 28 };
    }
    if (targetSelector === '_bottom') {
      return { top: Math.max(scrollHeight - 200, 400), left: 8, width: 200, height: 28 };
    }
    if (positionData) {
      const match = positionData.elements.find((el) => el.selector === targetSelector);
      if (match) return { ...match.rect };
    }
    return undefined;
  };

  for (const pc of passedChecks) {
    const rule = rulesSource.find((r) => r.id === pc.id);
    if (rule) {
      const pos = assignPosition(rule.targetSelector, rule.targetIndex);
      if (pos) pc.position = pos;
    }
  }

  const finalIssues =
    skipTextOnlyRules && !useExplainIssues
      ? issues.filter((i) => ytAllowResolved.ids.includes(i.id) || i.id.startsWith('axis_weak'))
      : issues;

  console.log(
    `[deriveAuditIssues] geoIssueSource=${geoIssueSource} geoPassedSource=${geoPassedSource} rulesSource=${rulesSourceLabel} youtubeAllowedIssueIdsSource=${ytAllowResolved.source} issueRulesCount=${issueRulesToUseLen} allowedIssueIdsCount=${skipTextOnlyRules ? ytAllowResolved.ids.length : 0} derivedIssuesCount=${finalIssues.length} skipYouTubeWhitelist=${skipTextOnlyRules} url=${result.url}`
  );
  
  console.log('[DEBUG] finalIssueIds:', finalIssues.map((i) => i.id));

  for (const issue of finalIssues) {
    const pos = assignPosition(issue.targetSelector, issue.targetIndex);
    if (pos) {
      issue.position = pos;
    } else {
      const idx = finalIssues.indexOf(issue);
      issue.position = { top: 80 + idx * 50, left: 12, width: 200, height: 28 };
    }
  }

  return {
    issues: finalIssues,
    passedChecks,
    geoIssues: workingGeoIssues,
    geoPassedItems: workingGeoPassed,
    opportunities,
    platformConstraints,
    ...(weakBlogFallbackApplied ? { weakBlogFallbackApplied: true } : {}),
    ...(strengthGenerationDebug ? { strengthGenerationDebug } : {}),
    ...(issueGenerationDebug ? { issueGenerationDebug } : {}),
  };
}
