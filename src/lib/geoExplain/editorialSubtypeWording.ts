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

export function getEditorialSubtypeTone(result: AnalysisResult): EditorialSubtype | null {
  if (result.pageType !== 'editorial' || !result.editorialSubtype) return null;
  return result.editorialSubtype;
}

const AXIS_KO: Partial<Record<GeoAxis, string>> = {
  citation: 'AI 인용',
  paragraph: '문단',
  answerability: '답변 적합성',
  structure: '구조·메타',
  trust: '신뢰',
  questionMatch: '질문 매칭',
  questionCoverage: '질문 커버리지',
};

export function parseAxisWeakScoreFromDescription(description: string): number {
  const m = description.match(/점수가\s*(\d+)/);
  return m ? parseInt(m[1]!, 10) : 0;
}

function axisWeakCopy(axis: GeoAxis, v: number, tone: EditorialSubtype): { description: string; fix: string } {
  const ak = AXIS_KO[axis] ?? axis;
  const base = `${ak} 축 점수가 ${v}로 낮아 AI 인용·요약에 불리할 수 있습니다.`;
  const baseFix = `${ak} 축과 맞는 콘텐츠·구조·신호를 보강하세요.`;
  if (tone === 'blog') {
    return {
      description: `${base} 독자·기사형 글이라면 도입 요약·인용 가능한 문장·출처를 함께 다듬는 것이 좋습니다.`,
      fix: `${baseFix} (글형: 한눈 요약·근거 문장·날짜·출처)`,
    };
  }
  if (tone === 'site_info') {
    return {
      description: `${base} 공식 안내·정책·서비스 설명 페이지라면 상단 요약·목차·일관된 톤을 맞추면 AI가 인용하기 쉽습니다.`,
      fix: `${baseFix} (안내형: 요약 블록·스캔 가능한 목차·갱신 정보)`,
    };
  }
  return {
    description: `${base} 글형과 안내형 요소가 함께 있다면 섹션별 역할을 나누어 정리하면 인용에 유리합니다.`,
    fix: `${baseFix} (일반정보형 맥락: 역할별 구역·요약)`,
  };
}

function issueSuffixes(tone: EditorialSubtype): { desc: string; fix: string } {
  if (tone === 'blog') {
    return {
      desc: ' 글·독자 중심 페이지라면 핵심 요약과 출처를 분명히 하면 인용에 유리합니다.',
      fix: ' (글형 맥락: 요약·출처 보강)',
    };
  }
  if (tone === 'site_info') {
    return {
      desc: ' 공식 안내·도움말·정책 문서라면 요약·목차·일관된 톤을 유지하는 것이 좋습니다.',
      fix: ' (안내형 맥락: 구조·공식 톤)',
    };
  }
  return {
    desc: ' 맥락이 혼합된 페이지는 섹션 역할을 나누면 AI가 인용하기 쉽습니다.',
    fix: ' (일반정보형 맥락: 역할별 정리)',
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
  if (tone === 'blog') return ' — 독자·글형 맥락에서 이 신호를 살리면 좋습니다.';
  if (tone === 'site_info') return ' — 공식 안내 맥락에서 이 신호를 살리면 좋습니다.';
  return ' — 일반정보형 맥락에서는 섹션 역할을 나누면 좋습니다.';
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
  const ak = AXIS_KO[axis] ?? axis;
  if (tone === 'blog') {
    return `${ak} 축이 높습니다. 독자용 글에서 이 강점을 유지·강화하면 인용 후보가 됩니다.`;
  }
  if (tone === 'site_info') {
    return `${ak} 축이 높습니다. 공식 안내·서비스 설명으로서 신뢰 신호를 유지하면 좋습니다.`;
  }
  return `${ak} 축이 높습니다. 글형·안내형이 섞인 페이지에서는 역할별로 이 신호를 살리면 인용에 유리합니다.`;
}

function opportunityRationaleSuffix(tone: EditorialSubtype): string {
  if (tone === 'blog') return ' 블로그·기사형이라면 도입 요약·출처와 함께 다듬으면 효과가 큽니다.';
  if (tone === 'site_info') return ' 공식 안내·정책 페이지라면 요약 블록·목차·일관 톤을 맞추면 좋습니다.';
  return ' 맥락이 혼합된 페이지는 섹션별 역할을 나누면 인용이 쉬워집니다.';
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
    const ak = AXIS_KO[axis] ?? axis;
    let title = opp.title;
    if (tone === 'blog') title = `${ak} 축 강화 (독자·글형)`;
    else if (tone === 'site_info') title = `${ak} 축 강화 (공식 안내)`;
    else title = `${ak} 축 강화 (일반정보형 맥락)`;
    return {
      ...opp,
      title,
      rationale: opp.rationale + extra,
    };
  }
  return { ...opp, rationale: opp.rationale + extra };
}

export function refineEditorialTrendSummaryForSubtype(trendSummary: string, tone: EditorialSubtype | null): string {
  if (!tone) return trendSummary;
  if (tone === 'blog') {
    return `${trendSummary} (글형: 독자 관점 요약·근거를 함께 보강하면 좋습니다.)`;
  }
  if (tone === 'site_info') {
    return `${trendSummary} (안내형: 공식 톤·목차·요약 블록을 점검하세요.)`;
  }
  return `${trendSummary} (일반정보형 맥락: 글형·안내형 섹션을 구분해 정리하면 좋습니다.)`;
}

/** English Gemini strategy line — short subtype context (editorial pages only). */
export function refineGeminiEditorialTrendSummary(trendSummary: string, tone: EditorialSubtype | null): string {
  if (!tone) return trendSummary;
  const tail =
    tone === 'blog'
      ? ' [Editorial subtype: article/reader context—favor takeaway, sourcing, quotable lines.]'
      : tone === 'site_info'
      ? ' [Editorial subtype: official/help context—favor scannable structure, policy clarity, summaries.]'
      : ' [Editorial subtype: mixed context—separate article-style vs documentation-style sections.]';
  return trendSummary + tail;
}
