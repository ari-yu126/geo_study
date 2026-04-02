import type { GeoAxis, GeoIssueCategory } from '../analysisTypes';

export const ISSUE_RULE_GEO_META: Record<
  string,
  { axis: GeoAxis; category: GeoIssueCategory }
> = {
  first_para: { axis: 'answerability', category: 'weak_signals' },
  quotable: { axis: 'citation', category: 'weak_signals' },
  content_short: { axis: 'answerability', category: 'weak_signals' },
  no_tables: { axis: 'answerability', category: 'missing_signals' },
  title: { axis: 'structure', category: 'missing_signals' },
  desc: { axis: 'structure', category: 'missing_signals' },
  author: { axis: 'trust', category: 'missing_signals' },
  pub_date: { axis: 'trust', category: 'missing_signals' },
  og: { axis: 'structure', category: 'weak_signals' },
  canonical: { axis: 'structure', category: 'missing_signals' },
  no_schema: { axis: 'structure', category: 'missing_signals' },
  no_lists: { axis: 'answerability', category: 'weak_signals' },
  contact: { axis: 'trust', category: 'missing_signals' },
  questions: { axis: 'answerability', category: 'missing_signals' },
  content_len: { axis: 'answerability', category: 'weak_signals' },
  content_deep: { axis: 'answerability', category: 'opportunities' },
};

export function resolveIssueRuleMeta(ruleId: string): {
  axis: GeoAxis;
  category: GeoIssueCategory;
} {
  return (
    ISSUE_RULE_GEO_META[ruleId] ?? {
      axis: 'answerability',
      category: 'weak_signals',
    }
  );
}

/** Labels for rule-id passed checks (aligned with issueDetector PASSED_REASONS) */
export const PASSED_REASON_INFO: Record<string, { label: string; reason: string }> = {
  first_para: {
    label: '첫 문단 품질 우수',
    reason: '첫 문단에 충분한 정보가 포함되어 AI가 인용 여부를 빠르게 판단할 수 있습니다.',
  },
  quotable: {
    label: '인용 가능 문장 충분',
    reason: '구체적 수치가 포함된 짧은 문장이 충분히 있어 AI가 직접 인용하기 쉽습니다.',
  },
  content_short: {
    label: '충분한 콘텐츠 분량',
    reason: '콘텐츠가 포괄적으로 작성되어 AI가 깊이 있는 정보원으로 판단합니다.',
  },
  no_tables: {
    label: '비교표 활용',
    reason: '비교표가 포함되어 AI가 구조화된 데이터를 쉽게 추출합니다.',
  },
  title: {
    label: 'Title 태그 설정됨',
    reason: 'AI가 페이지 주제를 빠르게 파악할 수 있습니다.',
  },
  desc: {
    label: 'Meta Description 작성됨',
    reason: 'SGE 답변 생성 시 직접 인용될 수 있습니다.',
  },
  og: {
    label: 'OG 태그 설정됨',
    reason: 'AI 크롤러가 페이지 컨텍스트를 정확히 파악합니다.',
  },
  canonical: {
    label: 'Canonical URL 설정됨',
    reason: '중복 콘텐츠 문제 없이 AI가 페이지를 신뢰합니다.',
  },
  no_schema: {
    label: '구조화 데이터 존재',
    reason: 'JSON-LD로 AI가 콘텐츠 의미를 정확하게 해석합니다.',
  },
  author: {
    label: '저자 정보 존재',
    reason: '저자 정보가 있어 AI가 E-E-A-T 기준으로 신뢰도를 높게 평가합니다.',
  },
  pub_date: {
    label: '발행일 표시됨',
    reason: '콘텐츠 발행일이 표시되어 AI가 정보의 최신성을 확인할 수 있습니다.',
  },
  contact: {
    label: '연락처 링크 존재',
    reason: '고객 상담/연락처가 있어 신뢰도가 높게 평가됩니다.',
  },
  no_lists: {
    label: '목록 활용 양호',
    reason: '핵심 포인트가 목록으로 정리되어 AI가 정보를 추출하기 쉽습니다.',
  },
};

export function passedRuleIdToAxis(ruleId: string): GeoAxis {
  return resolveIssueRuleMeta(ruleId).axis;
}
