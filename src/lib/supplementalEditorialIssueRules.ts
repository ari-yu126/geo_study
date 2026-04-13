import type { IssueRule } from './analysisTypes';

/**
 * Code-supplied editorial rules merged after monthly `profiles.editorial.issueRules`
 * (see `resolveIssueRulesForPageType`). Same JSON shape as Supabase rows for portability.
 */
export const SUPPLEMENTAL_EDITORIAL_ISSUE_RULES: IssueRule[] = [
  {
    id: 'missing_clear_verdict',
    check: 'clear_verdict_exists',
    label: '명확한 결론 부족',
    description: '추천/비추천 또는 선택 기준이 명확히 드러나지 않습니다.',
    priority: 'high',
    targetSelector: '_top',
    targetIndex: 0,
    axis: 'answerability',
    category: 'weak_signals',
  },
  {
    id: 'missing_comparison_logic',
    check: 'comparison_logic_exists',
    label: '비교/선택 기준 부족',
    description: '제품/옵션 간 비교 또는 선택 기준이 부족합니다.',
    priority: 'high',
    targetSelector: '_top',
    targetIndex: 0,
    axis: 'answerability',
    category: 'weak_signals',
  },
  {
    id: 'weak_claim_evidence',
    check: 'claim_with_evidence',
    label: '근거 없는 주장',
    description: '주장에 대한 구체적인 근거나 이유가 부족합니다.',
    priority: 'medium',
    targetSelector: '_top',
    targetIndex: 0,
    axis: 'citation',
    category: 'weak_signals',
  },
  {
    id: 'missing_user_context',
    check: 'user_context_exists',
    label: '사용자 상황 설명 부족',
    description: '어떤 사용자에게 적합한지에 대한 설명이 부족합니다.',
    priority: 'medium',
    targetSelector: '_top',
    targetIndex: 0,
    axis: 'answerability',
    category: 'weak_signals',
  },
];

export const SUPPLEMENTAL_EDITORIAL_ISSUE_RULE_IDS = new Set(
  SUPPLEMENTAL_EDITORIAL_ISSUE_RULES.map((r) => r.id)
);
