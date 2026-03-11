/**
 * 규칙 기반 템플릿 추천 — Gemini 429/quota 시 대체.
 * uncoveredQuestions, issues, pageType으로 GeoRecommendations 생성.
 */

import type {
  GeoRecommendations,
  SearchQuestion,
  AuditIssue,
  PageType,
  GeoPredictedQuestion,
} from './analysisTypes';

function toText(q: SearchQuestion | string): string {
  return typeof q === 'string' ? q : q.text;
}

/** 토큰으로 그룹핑용 키워드 추출 (2글자 이상) */
function extractTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 2)
  );
}

/** 토큰 오버랩으로 질문 그룹핑 — 공통 토큰 있는 것끼리 */
function groupByKeywordOverlap(questions: string[]): string[][] {
  if (questions.length <= 3) return questions.map((q) => [q]);
  const groups: string[][] = [];
  const used = new Set<number>();

  const keywords: [string, Set<string>][] = questions.map((q, i) => [q, extractTokens(q)]);

  for (let i = 0; i < keywords.length; i++) {
    if (used.has(i)) continue;
    const [q, tokens] = keywords[i];
    const group = [q];
    used.add(i);
    for (let j = i + 1; j < keywords.length; j++) {
      if (used.has(j)) continue;
      const [, tokensJ] = keywords[j];
      const overlap = [...tokens].filter((t) => tokensJ.has(t)).length;
      if (overlap >= 1) {
        group.push(keywords[j][0]);
        used.add(j);
      }
    }
    groups.push(group);
  }
  for (let i = 0; i < questions.length; i++) {
    if (!used.has(i)) groups.push([questions[i]]);
  }
  return groups;
}

export interface GenerateTemplateRecommendationsParams {
  pageType: PageType | 'default';
  uncoveredQuestions: SearchQuestion[] | string[];
  issues: AuditIssue[];
  seedKeywords?: { value: string }[];
  metaTitle?: string | null;
}

export function generateTemplateRecommendations(
  params: GenerateTemplateRecommendationsParams
): GeoRecommendations {
  const { pageType, uncoveredQuestions, issues, seedKeywords = [], metaTitle } = params;
  const texts = uncoveredQuestions.map(toText).filter(Boolean);
  const top6 = texts.slice(0, 6);
  const hasTrustIssues = issues.some(
    (i) =>
      /author|date|source|신뢰|출처|작성자|날짜/i.test(i.label) ||
      /author|date|trust|pub_date|contact/.test(i.id)
  );

  let trendSummary: string;
  let contentGapSummary: string;
  let suggestedHeadings: string[];
  let suggestedBlocks: string[];
  let priorityNotes: string[] = [];

  if (pageType === 'video') {
    trendSummary = top6.length > 0
      ? `검색·커뮤니티에서 "${top6[0].slice(0, 40)}${top6[0].length > 40 ? '...' : ''}" 등 질문이 자주 발견됩니다.`
      : '영상 제목·설명을 바탕으로 사용자 관심사 파악이 필요합니다.';
    contentGapSummary =
      '설명란과 타임스탬프(챕터) 보강으로 AI 검색 인용력을 높일 수 있습니다.';
    suggestedHeadings = [
      '영상 요약',
      '타임스탬프(챕터)',
      '자주 묻는 질문(FAQ)',
      '관련 링크/자료',
    ];
    suggestedBlocks = [
      top6.length > 0
        ? 'Timestamp 블록: 00:00, 01:30 등 구간별 설명 (설명란에 추가)'
        : 'Timestamp 블록: 구간별 요약용 0:00 형태 타임라인 추가',
      top6.length > 0
        ? `FAQ 블록: 상위 미답변 질문 ${Math.min(6, top6.length)}개 (예: ${top6[0].slice(0, 50)}...)`
        : 'FAQ 블록: 자주 묻는 질문 5~6개 설명란에 요약',
      '설명란에 추가할 핵심 요약 bullet 5개 (키워드·비교·주의사항)',
    ];
    if (top6.length > 0) {
      const kw = [...new Set(top6.flatMap((t) => t.split(/\s+/).filter((w) => w.length >= 2)))].slice(0, 5);
      suggestedBlocks.push(`핵심 키워드 요약: ${kw.join(', ')}`);
    }
    priorityNotes = ['설명란 200자 이상, 타임스탬프·핵심 키워드 포함 권장'];
  } else if (pageType === 'commerce') {
    trendSummary = top6.length > 0
      ? `구매 전 "${top6[0].slice(0, 35)}${top6[0].length > 35 ? '...' : ''}" 등 질문이 빈번합니다.`
      : '스펙·배송·AS·호환 관련 질문 보강이 필요합니다.';
    contentGapSummary = '배송/반품/AS 정책, 스펙 표, 구매 전 FAQ 노출으로 전환율을 높일 수 있습니다.';
    suggestedHeadings = [
      '배송/반품/교환',
      'AS/보증',
      '호환/사이즈',
      '스펙 요약',
      '리뷰 요약(장단점)',
      '구매 전 FAQ',
    ];
    suggestedBlocks = [
      'Table 블록: 스펙 표(모델명, 용량, 크기, 지원 규격 등 필수 항목)',
      'Checklist 블록: 정책(배송/반품/AS) 노출 여부 체크',
      top6.length > 0
        ? `FAQ 블록: 상위 질문 ${Math.min(6, top6.length)}개 (배송/호환/스펙 등)`
        : 'FAQ 블록: 배송·AS·호환·사이즈 관련 질문 5~6개',
    ];
    priorityNotes = ['스펙 표와 정책 노출이 AI 인용·전환에 직결됩니다'];
  } else {
    // editorial | default
    trendSummary = top6.length > 0
      ? `검색/커뮤니티에서 "${top6[0].slice(0, 40)}${top6[0].length > 40 ? '...' : ''}" 등 질문이 자주 발견됩니다.`
      : metaTitle
        ? `"${metaTitle.slice(0, 40)}" 관련 사용자 관심사 파악이 필요합니다.`
        : '사용자 질문 데이터를 바탕으로 콘텐츠 보강이 필요합니다.';
    contentGapSummary =
      'FAQ·비교표·절차 블록 보강으로 AI 검색 인용 가능성을 높일 수 있습니다.';
    suggestedHeadings = [
      '자주 묻는 질문(FAQ)',
      '비용/가격',
      '비교/차이',
      '사용법/절차',
      '주의사항',
    ];
    if (groupByKeywordOverlap(texts).length > 3) {
      suggestedHeadings.push('추가 주제');
    }
    suggestedBlocks = [
      top6.length > 0
        ? `FAQ 블록: 상위 미답변 질문 ${Math.min(6, top6.length)}개`
        : 'FAQ 블록: 핵심 질문 5~6개',
    ];
    if (hasTrustIssues) {
      suggestedBlocks.push(
        'Checklist 블록: 신뢰 신호(작성자, 날짜, 출처 링크) 노출 여부'
      );
    }
  }

  const predictedQuestions: GeoPredictedQuestion[] = top6.slice(0, 5).map((q, i) => ({
    question: q,
    importanceReason: '검색/커뮤니티에서 자주 등장하는 질문',
    coveredByPage: false,
    isTopGap: i < 3,
  }));
  const predictedUncoveredTop3 = predictedQuestions.filter((_, i) => i < 3);

  return {
    trendSummary,
    contentGapSummary,
    actionPlan: {
      suggestedHeadings,
      suggestedBlocks,
      priorityNotes: priorityNotes.length > 0 ? priorityNotes : undefined,
    },
    predictedQuestions,
    predictedUncoveredTop3,
    isTemplateFallback: true,
  };
}
