import { evaluateCheck } from './checkEvaluator';
import { loadActiveScoringConfig } from './scoringConfigLoader';
import { DEFAULT_SCORING_CONFIG } from './defaultScoringConfig';
import type {
  AnalysisResult,
  AuditIssue,
  ContentQuality,
  FixExample,
  IframePositionData,
  PageFeatures,
  PassedCheck,
  TrustSignals,
} from './analysisTypes';

export interface AuditResults {
  issues: AuditIssue[];
  passedChecks: PassedCheck[];
}

/** 유튜브 시 강제 삭제(Skip)할 이슈 — 일반 웹사이트용, 비디오에는 부적합 */
const YOUTUBE_SKIP_RULE_IDS = new Set([
  'first_para',      // 첫 문단 짧음
  'quotable',        // 인용 가능 문장 부족
  'content_short',   // 콘텐츠 분량 부족
  'no_tables',       // 테이블 없음
  'no_lists',        // 목록(ul/ol) 부족
  'h2_few', 'no_schema', 'questions',
]);

/** 유튜브에 부적합한 이슈 설명 패턴 — 해당 시 이슈 제외 */
const YOUTUBE_ISSUE_DESC_BLACKLIST = [
  /글자\s*수/i,
  /테이블\s*(없음|부족)/i,
  /목록\s*(ul|ol|없음|부족)/i,
  /콘텐츠\s*분량/i,
  /본문\s*(길이|분량)/i,
  /(?:content|본문)\s*length/i,
];

/** hasActualAiCitation일 때 웹 표준(H1~H3) 감점 무효화용 패턴 */
const STRUCTURE_ISSUE_PATTERNS = [
  /\bH1\b/i, /\bH2\b/i, /\bH3\b/i,
  /헤딩\s*구조/i, /헤딩\s*태그/i, /헤딩\s*(부족|없음)/i,
  /구조\s*화/i,
];

function isYouTubeInappropriateIssue(issue: AuditIssue): boolean {
  const text = [issue.label, issue.description].join(' ');
  return YOUTUBE_ISSUE_DESC_BLACKLIST.some((re) => re.test(text));
}

function isStructureRelatedIssue(issue: AuditIssue): boolean {
  const text = [issue.label, issue.description].join(' ');
  return STRUCTURE_ISSUE_PATTERNS.some((re) => re.test(text));
}

function isYouTubeResult(result: AnalysisResult): boolean {
  try {
    const host = new URL(result.url).hostname.toLowerCase().replace(/^www\./, '');
    return /youtube\.com$/i.test(host);
  } catch {
    return false;
  }
}

const DEFAULT_CONTENT_QUALITY: ContentQuality = {
  contentLength: 0, tableCount: 0, listCount: 0,
  h2Count: 0, h3Count: 0, imageCount: 0,
  hasStepStructure: false, quotableSentenceCount: 0,
  firstParagraphLength: 0, hasDefinitionPattern: false, hasPriceInfo: false,
};

const DEFAULT_TRUST_SIGNALS: TrustSignals = {
  hasAuthor: false, hasPublishDate: false, hasModifiedDate: false,
  hasContactLink: false, hasAboutLink: false,
};

function buildPageFeatures(result: AnalysisResult): PageFeatures {
  return {
    meta: result.meta,
    headings: result.headings ?? [],
    h1Count: result.h1Count ?? 0,
    pageQuestions: result.pageQuestions,
    seedKeywords: result.seedKeywords,
    questionCoverage: result.scores.questionCoverage,
    structureScore: result.scores.structureScore,
    hasFaqSchema: result.hasFaqSchema ?? false,
    hasStructuredData: result.hasStructuredData ?? false,
    descriptionLength: result.meta.description?.trim().length ?? 0,
    contentQuality: result.contentQuality ?? DEFAULT_CONTENT_QUALITY,
    trustSignals: result.trustSignals ?? DEFAULT_TRUST_SIGNALS,
  };
}

function generateFixExamples(
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

const PASSED_REASONS: Record<string, { label: string; reason: string }> = {
  // AI Answerability
  first_para: { label: '첫 문단 품질 우수', reason: '첫 문단에 충분한 정보가 포함되어 AI가 인용 여부를 빠르게 판단할 수 있습니다.' },
  quotable: { label: '인용 가능 문장 충분', reason: '구체적 수치가 포함된 짧은 문장이 충분히 있어 AI가 직접 인용하기 쉽습니다.' },
  content_short: { label: '충분한 콘텐츠 분량', reason: '콘텐츠가 포괄적으로 작성되어 AI가 깊이 있는 정보원으로 판단합니다.' },
  no_tables: { label: '비교표 활용', reason: '비교표가 포함되어 AI가 구조화된 데이터를 쉽게 추출합니다.' },
  no_lists: { label: '목록 활용 양호', reason: '핵심 포인트가 목록으로 정리되어 AI가 정보를 추출하기 쉽습니다.' },
  // SEO Structure
  title: { label: 'Title 태그 설정됨', reason: 'AI가 페이지 주제를 빠르게 파악할 수 있습니다.' },
  desc: { label: 'Meta Description 작성됨', reason: 'SGE 답변 생성 시 직접 인용될 수 있습니다.' },
  og: { label: 'OG 태그 설정됨', reason: 'AI 크롤러가 페이지 컨텍스트를 정확히 파악합니다.' },
  canonical: { label: 'Canonical URL 설정됨', reason: '중복 콘텐츠 문제 없이 AI가 페이지를 신뢰합니다.' },
  no_schema: { label: '구조화 데이터 존재', reason: 'JSON-LD로 AI가 콘텐츠 의미를 정확하게 해석합니다.' },
  // Trust
  author: { label: '저자 정보 존재', reason: '저자 정보가 있어 AI가 E-E-A-T 기준으로 신뢰도를 높게 평가합니다.' },
  pub_date: { label: '발행일 표시됨', reason: '콘텐츠 발행일이 표시되어 AI가 정보의 최신성을 확인할 수 있습니다.' },
  contact: { label: '연락처 링크 존재', reason: '고객 상담/연락처가 있어 신뢰도가 높게 평가됩니다.' },
};

export async function deriveAuditIssues(
  result: AnalysisResult,
  positionData?: IframePositionData
): Promise<AuditResults> {
  // 유튜브 전용: 이슈 + 잘된 점(PassedCheck) — config 기반(월별 업데이트 대상)
  if (result.auditIssues !== undefined) {
    const config = await loadActiveScoringConfig();
    const ytRules =
      config.youtubePassedCheckRules ?? DEFAULT_SCORING_CONFIG.youtubePassedCheckRules ?? [];

    let rawIssues = result.auditIssues.filter((issue) => !isYouTubeInappropriateIssue(issue));
    if (result.trustSignals?.hasActualAiCitation) {
      rawIssues = rawIssues.filter((issue) => !isStructureRelatedIssue(issue));
    }
    const issues = rawIssues.map((issue, i) => ({
      ...issue,
      position: { top: 80 + i * 50, left: 12, width: 200, height: 28 },
    }));

    const passedChecks: PassedCheck[] = [];
    const title = result.meta.title ?? result.meta.ogTitle ?? '';
    const desc = result.meta.description ?? result.meta.ogDescription ?? '';
    const descLen = desc.length;
    const hasTimestamp = /\d{1,2}:\d{2}/.test(desc);
    const titleLower = title.toLowerCase();
    const hasSeedInTitle = result.seedKeywords.some(
      (kw) => kw.value.length >= 2 && titleLower.includes(kw.value.toLowerCase())
    );

    const infoDensityThreshold = ytRules.find((r) => r.check === 'yt_info_density')?.threshold ?? 300;

    for (const rule of ytRules) {
      let passed = false;
      if (rule.check === 'yt_title_opt') passed = hasSeedInTitle;
      else if (rule.check === 'yt_info_density') passed = descLen >= infoDensityThreshold;
      else if (rule.check === 'yt_chapter') passed = hasTimestamp;
      else if (rule.check === 'yt_authority') passed = result.trustSignals?.hasActualAiCitation === true;
      else if (rule.check === 'yt_gemini_factor') passed = Boolean(result.youtubeSuccessFactor);

      if (passed) {
        passedChecks.push({
          id: rule.id,
          label: rule.label,
          reason: rule.check === 'yt_gemini_factor' && result.youtubeSuccessFactor
            ? result.youtubeSuccessFactor
            : rule.reason,
        });
      }
    }

    return { issues, passedChecks };
  }

  const config = await loadActiveScoringConfig();
  const features = buildPageFeatures(result);
  const issues: AuditIssue[] = [];
  const passedChecks: PassedCheck[] = [];
  let num = 1;
  const skipTextOnlyRules = isYouTubeResult(result);

  for (const rule of config.issueRules) {
    if (skipTextOnlyRules && YOUTUBE_SKIP_RULE_IDS.has(rule.id)) continue;
    const passed = evaluateCheck(rule.check, features, rule.threshold);
    if (!passed) {
      issues.push({
        id: rule.id,
        number: num++,
        label: rule.label,
        description: rule.description,
        priority: rule.priority,
        targetSelector: rule.targetSelector,
        targetIndex: rule.targetIndex,
        fixExamples: generateFixExamples(rule.id, result),
      });
    } else {
      const info = PASSED_REASONS[rule.id];
      if (info) {
        passedChecks.push({
          id: rule.id,
          label: info.label,
          reason: info.reason,
        });
      }
    }
  }

  // 검색 상위 노출 확인 (증거 기반 권위)
  if (result.trustSignals?.hasSearchExposure) {
    passedChecks.push({
      id: 'search_exposure',
      label: '검색 상위 노출 확인',
      reason: 'Tavily 검색 결과에 해당 도메인이 노출되어 있어 증거 기반 권위 점수를 받았습니다.',
    });
  }

  // 정보 밀도 가산점: 숫자+단위 포함 블록 N개 → 1개당 +3점 (최대 50점)
  const dataDense = result.paragraphStats?.dataDenseBlockCount ?? 0;
  if (dataDense >= 1) {
    const bonus = Math.min(50, dataDense * 3);
    passedChecks.push({
      id: 'data_density_bonus',
      label: '정보 밀도 가산점',
      reason: `핵심 데이터(숫자/단위)가 ${dataDense}개 블록 포함되어 +${bonus}점 가산받았습니다.`,
    });
  }

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
    const rule = config.issueRules.find((r) => r.id === pc.id);
    if (rule) {
      const pos = assignPosition(rule.targetSelector, rule.targetIndex);
      if (pos) pc.position = pos;
    }
  }

  // 유튜브 시 웹 전용 이슈 강제 삭제 (fallback 경로 등에서 남아 있을 수 있음)
  const finalIssues = skipTextOnlyRules
    ? issues.filter((i) => !YOUTUBE_SKIP_RULE_IDS.has(i.id))
    : issues;

  for (const issue of finalIssues) {
    const pos = assignPosition(issue.targetSelector, issue.targetIndex);
    if (pos) {
      issue.position = pos;
    } else {
      const idx = finalIssues.indexOf(issue);
      issue.position = { top: 80 + idx * 50, left: 12, width: 200, height: 28 };
    }
  }

  return { issues: finalIssues, passedChecks };
}
