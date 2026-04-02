import { loadActiveScoringConfig } from './scoringConfigLoader';
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
import type {
  AnalysisResult,
  AuditIssue,
  FixExample,
  GeoIssue,
  GeoOpportunity,
  GeoPassedItem,
  IframePositionData,
  IssueRule,
  PassedCheck,
} from './analysisTypes';

export interface AuditResults {
  issues: AuditIssue[];
  passedChecks: PassedCheck[];
  geoIssues: GeoIssue[];
  geoPassedItems: GeoPassedItem[];
  opportunities: GeoOpportunity[];
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

  switch (ruleId) {
    case 'title':
      return [
        {
          language: 'html',
          code: `<title>${kwStr} - ${domain} | 핵심 가이드</title>`,
        },
      ];

    case 'desc':
      return [
        {
          language: 'html',
          code: `<meta name="description" content="${topKw[0] || '서비스'}에 대한 자주 묻는 질문과 답변을 확인하세요. ${kwStr} 관련 핵심 정보를 한눈에 정리했습니다." />`,
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
    return {
      id: g.id,
      number: num++,
      label: g.label,
      description: g.description,
      priority: g.severity,
      targetSelector: rule?.targetSelector ?? '_top',
      targetIndex: rule?.targetIndex ?? 0,
      fixExamples: generateFixExamples(g.id, result),
    };
  });
}

export async function deriveAuditIssues(
  result: AnalysisResult,
  positionData?: IframePositionData
): Promise<AuditResults> {
  const config = await loadActiveScoringConfig();
  const rulesSourceLabel: 'config' | 'default' =
    config.issueRules && config.issueRules.length > 0 ? 'config' : 'default';
  const rulesSource =
    rulesSourceLabel === 'config' ? config.issueRules! : DEFAULT_SCORING_CONFIG.issueRules;

  let geoIssues: GeoIssue[];
  let geoPassed: GeoPassedItem[];
  let skipTextOnlyRules: boolean;
  let ytAllowResolved: { ids: string[]; source: 'config' | 'default' };
  let issueRulesToUseLen: number;

  if (result.auditIssues !== undefined) {
    geoIssues = runYoutubeIssueEngine(result);
    geoPassed = await runYoutubePassedEngine(result);
    skipTextOnlyRules = false;
    ytAllowResolved = { ids: [], source: 'default' };
    issueRulesToUseLen = rulesSource.length;
  } else {
    const ruleLayer = await runGeoRuleLayer(result);
    geoIssues = await runEditorialIssueEngine(result, ruleLayer);
    geoPassed = await runEditorialPassedEngine(result, ruleLayer);
    skipTextOnlyRules = ruleLayer.skipTextOnlyRules;
    ytAllowResolved = ruleLayer.ytAllowResolved;
    issueRulesToUseLen = ruleLayer.issueRulesToUse.length;
  }

  const { primary: finalGeoIssues, source: geoIssueSource } = resolvePrimaryGeoIssues(result, geoIssues);
  const useExplainIssues = geoIssueSource === 'geoExplain';

  const { primary: finalGeoPassed, source: geoPassedSource } = resolvePrimaryGeoPassed(result, geoPassed);

  const opportunities = runOpportunityEngine(result, finalGeoIssues, config);

  const issues = geoIssuesToAuditIssues(finalGeoIssues, result, rulesSource);
  const passedChecks = geoPassedToPassedChecks(finalGeoPassed);

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
    geoIssues: finalGeoIssues,
    geoPassedItems: finalGeoPassed,
    opportunities,
  };
}
