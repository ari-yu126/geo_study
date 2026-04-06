/**
 * Editorial-only explainability tone (blog | site_info | mixed).
 * Wording only — no scoring, IDs, or detection changes.
 */

import type {
  AnalysisResult,
  EditorialSubtype,
  GeoAxis,
  GeoIssue,
  GeoOpportunity,
  GeoPassedItem,
} from '../analysisTypes';
import { CONTENT_FOCUS_LABEL } from '../recommendations/recommendationUiLabels';

export function getEditorialSubtypeTone(result: AnalysisResult): EditorialSubtype | null {
  if (result.pageType !== 'editorial' || !result.editorialSubtype) return null;
  return result.editorialSubtype;
}

export function parseAxisWeakScoreFromDescription(description: string): number {
  const m = description.match(/점수가\s*(\d+)/);
  return m ? parseInt(m[1]!, 10) : 0;
}

/** Problem + fix copy without scores, axes, or internal subtype labels. */
const WEAK_PROBLEM_KO: Partial<Record<GeoAxis, string>> = {
  citation: '숫자·출처·근거가 드러나는 문장이 부족해 보입니다.',
  paragraph: '앞부분 요약 없이 글이 길게 이어져 스캔하기 어렵습니다.',
  answerability: '질문에 바로 답하는 문장이 도입부에 약합니다.',
  structure: '소제목·목차 신호가 약해 한눈에 구조가 들어오지 않습니다.',
  trust: '작성자·갱신·출처 정보가 부족해 보입니다.',
  questionMatch: '검색 질문 표현이 제목·본문에 잘 드러나지 않습니다.',
  questionCoverage: '자주 묻는 질문에 직접 답하는 부분이 부족합니다.',
  density: '핵심 정보 밀도가 낮아 보입니다.',
  videoMetadata: '설명란 신호가 약합니다.',
};

const WEAK_FIX_KO: Partial<Record<GeoAxis, string>> = {
  citation: '짧은 근거 문단과 출처를 추가해 보세요.',
  paragraph: '맨 위에 3~4줄 요약과 불릿으로 핵심을 먼저 제시해 보세요.',
  answerability: '첫 문단에 결론과 범위를 넣어 질문에 바로 답하도록 다듬어 보세요.',
  structure: 'H2/H3와 한 줄 개요로 글의 뼈대를 드러내 보세요.',
  trust: '작성자·갱신일·출처·문의처를 한 블록에 정리해 보세요.',
  questionMatch: '검색 질문 문장을 소제목에 그대로 써 보세요.',
  questionCoverage: 'FAQ나 Q/A 블록으로 자주 묻는 질문에 답해 보세요.',
  density: '핵심 문장과 근거를 압축해 넣어 보세요.',
  videoMetadata: '설명란에 챕터·요약·FAQ를 채워 보세요.',
};

function toneWeakTail(tone: EditorialSubtype): string {
  if (tone === 'blog')
    return ' 도입 요약과 인용하기 좋은 문장·출처를 함께 다듬으면 읽기와 인용에 유리합니다.';
  if (tone === 'site_info')
    return ' 상단 요약과 스캔 가능한 목차를 갖추면 정보를 빠르게 찾을 수 있습니다.';
  return ' 섹션마다 역할을 나누어 정리하면 읽기와 인용에 도움이 됩니다.';
}

function axisWeakCopy(axis: GeoAxis, _v: number, tone: EditorialSubtype): { description: string; fix: string } {
  const problem = WEAK_PROBLEM_KO[axis] ?? '이 부분에서 보완 여지가 있습니다.';
  const fix = WEAK_FIX_KO[axis] ?? '문장과 구조를 위 가이드에 맞춰 다듬어 보세요.';
  return {
    description: problem + toneWeakTail(tone),
    fix,
  };
}

function issueSuffixes(tone: EditorialSubtype): { desc: string; fix: string } {
  if (tone === 'blog') {
    return {
      desc: ' 핵심 요약과 출처를 함께 제시하면 신뢰와 인용에 도움이 됩니다.',
      fix: ' 요약 문단과 근거·링크를 한데 묶어 보완해 보세요.',
    };
  }
  if (tone === 'site_info') {
    return {
      desc: ' 상단 요약과 일관된 목차가 있으면 정보를 찾기 쉬워집니다.',
      fix: ' 요약 블록과 목차를 점검하고 갱신 정보를 명시해 보세요.',
    };
  }
  return {
    desc: ' 섹션 역할이 분명하면 독자가 글을 따라가기 쉽습니다.',
    fix: ' 역할별로 요약과 근거를 나누어 정리해 보세요.',
  };
}

const GEO_PASSED_IDS = new Set([
  'geo_first_summary',
  'geo_quotable',
  'geo_list_structure',
  'geo_comparison',
  'geo_topical_focus',
]);

function passedRuleReasonTail(tone: EditorialSubtype): string {
  if (tone === 'blog') return ' 이 신호를 유지하면서 도입 요약과 근거를 함께 키우면 좋습니다.';
  if (tone === 'site_info') return ' 이 신호를 유지하면서 요약과 목차를 주기적으로 맞추면 좋습니다.';
  return ' 섹션별로 요약과 근거를 정리하면 인용에 유리합니다.';
}

/** Built-in strengths we fully rephrase for editorial tone (ids stable). */
function passedGeoCopy(id: string, tone: EditorialSubtype): { description: string; reason: string } {
  if (tone === 'blog') {
    if (id === 'geo_first_summary')
      return {
        description: '도입부에 독자용 요약·결론 신호가 있습니다.',
        reason: '앞부분 요약이 있으면 AI가 기사형 본문에서 인용 포인트를 빠르게 고릅니다.',
      };
    if (id === 'geo_quotable')
      return {
        description: '인용하기 좋은 팩트·수치 문장이 충분합니다.',
        reason: '짧고 구체적인 문장은 AI 직접 인용에 유리합니다.',
      };
    if (id === 'geo_list_structure')
      return {
        description: '독자가 훑기 쉬운 목록 구조가 있습니다.',
        reason: '목록은 글형 콘텐츠에서 핵심을 추출하기 좋습니다.',
      };
    if (id === 'geo_comparison')
      return {
        description: '비교·정리용 표가 있습니다.',
        reason: '표는 글 안에서 근거를 구조화해 인용 가능성을 높입니다.',
      };
    if (id === 'geo_topical_focus')
      return {
        description: '기사·글의 주제 초점이 분명합니다.',
        reason: '핵심 토픽이 드러나 AI가 주제에 맞게 인용하기 쉽습니다.',
      };
  }
  if (tone === 'site_info') {
    if (id === 'geo_first_summary')
      return {
        description: '상단에 안내·요약 성격의 도입이 있습니다.',
        reason: '방문자가 빠르게 이해할 수 있는 요약은 공식 페이지에서도 인용 신호가 됩니다.',
      };
    if (id === 'geo_quotable')
      return {
        description: '정책·사실을 짧게 전달하는 문장이 있습니다.',
        reason: '명확한 문장은 AI가 안내·정책 답변에 인용하기 좋습니다.',
      };
    if (id === 'geo_list_structure')
      return {
        description: '절차·항목을 목록으로 정리했습니다.',
        reason: '목록형 구조는 도움말·FAQ형 페이지에서 추출이 쉽습니다.',
      };
    if (id === 'geo_comparison')
      return {
        description: '비교·규격을 표로 정리했습니다.',
        reason: '표는 서비스·요금·옵션 설명에서 근거로 인용되기 좋습니다.',
      };
    if (id === 'geo_topical_focus')
      return {
        description: '페이지 주제(서비스·정책)가 분명합니다.',
        reason: '주제 신호가 뚜렷하면 AI가 해당 안내를 선택하기 쉽습니다.',
      };
  }
  if (id === 'geo_first_summary')
    return {
      description: '도입부 요약 신호가 있습니다.',
      reason: '요약이 있으면 글형·안내형 모두에서 인용 판단이 빨라질 수 있습니다.',
    };
  if (id === 'geo_quotable')
    return {
      description: '인용 후보 문장이 충분합니다.',
      reason: '구체적 문장은 AI 인용에 유리합니다.',
    };
  if (id === 'geo_list_structure')
    return {
      description: '목록 구조가 있습니다.',
      reason: '목록은 핵심 추출에 용이합니다.',
    };
  if (id === 'geo_comparison')
    return {
      description: '테이블이 있습니다.',
      reason: '표는 구조화된 근거로 인용에 유리합니다.',
    };
  if (id === 'geo_topical_focus')
    return {
      description: '주제 초점이 분명합니다.',
      reason: '핵심 토큰이 명확해 AI가 주제 중심으로 인용하기 쉽습니다.',
    };
  return {
    description: '강점 신호가 있습니다.',
    reason: '이 신호는 AI 인용·요약에 도움이 됩니다.',
  };
}

function passedAxisStrongReason(axis: GeoAxis, _v: number, tone: EditorialSubtype): string {
  const label = CONTENT_FOCUS_LABEL.ko[axis] ?? axis;
  if (tone === 'blog') {
    return `${label}에서 좋은 신호가 있습니다. 앞부분 요약과 함께 이 강점을 유지해 보세요.`;
  }
  if (tone === 'site_info') {
    return `${label}에서 좋은 신호가 있습니다. 요약과 목차와 함께 유지하면 방문자에게 신뢰를 줍니다.`;
  }
  return `${label}에서 좋은 신호가 있습니다. 섹션별로 이 흐름을 살려 보세요.`;
}

function opportunityRationaleSuffix(tone: EditorialSubtype): string {
  if (tone === 'blog') return ' 도입부 요약과 출처·근거를 함께 다듬으면 효과가 큽니다.';
  if (tone === 'site_info') return ' 요약 블록과 목차·일관된 설명 톤을 맞추면 좋습니다.';
  return ' 섹션별 역할을 나누면 읽기와 인용이 쉬워집니다.';
}

export function refineGeoIssueForEditorialSubtype(issue: GeoIssue, tone: EditorialSubtype): GeoIssue {
  if (issue.id.startsWith('axis_weak_')) {
    const axis = issue.axis as GeoAxis;
    const v = parseAxisWeakScoreFromDescription(issue.description);
    const { description, fix } = axisWeakCopy(axis, v, tone);
    return { ...issue, description, fix };
  }
  const { desc, fix } = issueSuffixes(tone);
  return {
    ...issue,
    description: issue.description + desc,
    fix: issue.fix + fix,
  };
}

export function refinePassedItemForEditorialSubtype(item: GeoPassedItem, tone: EditorialSubtype): GeoPassedItem {
  if (GEO_PASSED_IDS.has(item.id)) {
    const { description, reason } = passedGeoCopy(item.id, tone);
    return { ...item, description, reason };
  }
  if (item.id.startsWith('axis_strong_')) {
    const axis = item.axis as GeoAxis;
    const m = item.description.match(/(\d+)/);
    const v = m ? parseInt(m[1]!, 10) : 0;
    return {
      ...item,
      reason: passedAxisStrongReason(axis, v, tone),
    };
  }
  if (item.id === 'search_exposure' || item.id === 'data_density_bonus') {
    const s = issueSuffixes(tone);
    return {
      ...item,
      description: item.description + s.desc,
      reason: item.reason + passedRuleReasonTail(tone),
    };
  }
  return {
    ...item,
    reason: item.reason + passedRuleReasonTail(tone),
  };
}

export function refineOpportunityForEditorialSubtype(opp: GeoOpportunity, tone: EditorialSubtype): GeoOpportunity {
  const extra = opportunityRationaleSuffix(tone);
  if (opp.id.startsWith('opp_boost_')) {
    const axis = opp.improvesAxis;
    const label = CONTENT_FOCUS_LABEL.ko[axis] ?? axis;
    const title = `${label} 보강하기`;
    return {
      ...opp,
      title,
      rationale: opp.rationale + extra,
    };
  }
  return { ...opp, rationale: opp.rationale + extra };
}

function joinSummarySentence(base: string, addition: string): string {
  const t = base.trimEnd();
  if (!addition.startsWith(' ')) addition = ` ${addition}`;
  if (/[.!?…]$/.test(t)) return `${t}${addition}`;
  return `${t}.${addition}`;
}

export function refineEditorialTrendSummaryForSubtype(trendSummary: string, tone: EditorialSubtype | null): string {
  if (!tone) return trendSummary;
  if (tone === 'blog') {
    return joinSummarySentence(
      trendSummary,
      '핵심 요약과 근거를 분명히 하면 독자가 빠르게 이해하고 인용하기 좋습니다.'
    );
  }
  if (tone === 'site_info') {
    return joinSummarySentence(
      trendSummary,
      '구조를 정리하면 핵심 정보를 빠르게 찾고 이해하기 쉬워집니다.'
    );
  }
  return joinSummarySentence(trendSummary, '서로 다른 성격의 내용은 섹션을 나누어 정리하면 읽기와 인용에 유리합니다.');
}

/** English — natural closing sentence (no subtype labels). */
export function refineGeminiEditorialTrendSummary(trendSummary: string, tone: EditorialSubtype | null): string {
  if (!tone) return trendSummary;
  if (tone === 'blog') {
    return joinSummarySentence(
      trendSummary,
      'Focus on adding clear summaries and supporting evidence so readers can quickly understand the key points.'
    );
  }
  if (tone === 'site_info') {
    return joinSummarySentence(
      trendSummary,
      'Make the structure clearer so key information can be scanned and understood quickly.'
    );
  }
  return joinSummarySentence(
    trendSummary,
    'Clarify each section’s role so narrative and reference-style content stay easy to follow and cite.'
  );
}
