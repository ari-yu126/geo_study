/**
 * Platform-aware remediation copy (hosted blogs vs self-hosted).
 * Wording only — no scoring changes.
 */

import type { AnalysisResult, GeoIssue, GeoOpportunity, PlatformType } from '../analysisTypes';

export function isHostedBlogPlatform(platform: PlatformType | undefined): boolean {
  return (
    platform === 'naver_blog' ||
    platform === 'tistory' ||
    platform === 'brunch' ||
    platform === 'wordpress'
  );
}

const HOSTED_META_SCHEMA_NOTE =
  ' 이 플랫폼에서는 HTML 메타·JSON-LD를 직접 편집하기 어렵습니다. 편집기에서 조정 가능한 범위(제목, 도입 요약, 목차, 본문 표·목록, 질문형 소제목)에서 보완하세요.';

function hostedFixForRuleId(id: string, defaultFix: string): string {
  switch (id) {
    case 'desc':
      return '도입부 첫 문단에 검색 의도에 맞는 요약과 핵심 키워드를 넣고, 본문을 질문형 소제목(H2/H3)으로 나누어 스캔하기 쉽게 정리하세요.' + HOSTED_META_SCHEMA_NOTE;
    case 'desc_og_only':
      return (
        '제목을 검색 의도에 맞게 명확히 하고, 본문 맨 앞에 핵심 요약(2~4문장)과 주요 정보를 드러내세요. 호스팅 플랫폼에서는 HTML meta description을 직접 넣기 어려운 경우가 많습니다.' +
        HOSTED_META_SCHEMA_NOTE
      );
    case 'og':
      return '제목과 도입부 요약에 검색 질문에 가까운 표현을 넣고, 대표 이미지·첫 단락이 주제를 분명히 드러내도록 다듬으세요.' + HOSTED_META_SCHEMA_NOTE;
    case 'no_schema':
      return '본문 안에 목차·비교 표·불릿 목록·Q&A 형식 섹션을 추가해 정보를 눈에 보이게 구조화하세요. 스키마 코드 삽입은 플랫폼에서 보통 지원하지 않습니다.';
    case 'pub_date':
      return '상단에 발행일·갱신일이 독자에게 보이는지 확인하세요. 이미 노출 중이면 유지해도 됩니다.';
    case 'title':
      return '검색 질문에 가깝게 제목에 핵심 키워드와 범위(대상·연도 등)를 담아 AI가 주제를 빠르게 파악하도록 하세요.';
    case 'author':
      return '프로필·필명·소개 문구가 글 상단이나 하단에 드러나도록 정리하세요. (플랫폼 설정에서 제공하는 저자 표시를 활용하세요.)';
    default:
      return defaultFix + HOSTED_META_SCHEMA_NOTE;
  }
}

/** Narrow editorial/geo issues for Naver/Tistory/Brunch — avoid meta/JSON-LD-centric fixes. */
export function refineGeoIssueForPlatform(issue: GeoIssue, platform: PlatformType | undefined): GeoIssue {
  if (!isHostedBlogPlatform(platform)) {
    return issue;
  }
  if (issue.id.startsWith('axis_weak_')) {
    return {
      ...issue,
      fix: issue.fix + HOSTED_META_SCHEMA_NOTE,
    };
  }
  return {
    ...issue,
    fix: hostedFixForRuleId(issue.id, issue.fix),
  };
}

function hostedOpportunityOverride(opp: GeoOpportunity): GeoOpportunity | null {
  switch (opp.id) {
    case 'opp_fix_meta_description':
      return {
        ...opp,
        title: '도입부·상단 요약 보강',
        rationale:
          '호스팅 편집기에서 본문 상단에 검색 의도에 맞는 요약과 키워드를 넣으면 AI가 주제를 파악하기 쉬워집니다. (메타 description 직접 편집은 이 플랫폼에서 제한적일 수 있습니다.)',
      };
    case 'opp_meta_desc_consistency':
      return {
        ...opp,
        title: '제목·도입 요약·상단 정보 보강',
        rationale:
          'og:description이 있는 경우에도, 본문 첫 단락에 핵심 요약과 키 정보를 두면 AI가 스니펫 외에 본문 근거를 더 잘 활용합니다. 표준 meta 태그는 플랫폼에서 편집이 어려울 수 있습니다.',
      };
    case 'opp_add_jsonld':
      return {
        ...opp,
        title: '본문 구조·표·목록으로 정보 명확화',
        rationale:
          'JSON-LD 삽입이 어려운 경우, 목차·비교 표·Q&A 블록으로 본문 안에서 정보를 구조화하는 편이 현실적입니다.',
      };
    case 'opp_fix_title':
      return {
        ...opp,
        rationale:
          '제목에 핵심 키워드와 글의 범위가 드러나도록 다듬으세요. 호스팅에서 제공하는 제목 필드를 활용합니다.',
      };
    default:
      return null;
  }
}

export function refineOpportunityForPlatform(
  opp: GeoOpportunity,
  platform: PlatformType | undefined
): GeoOpportunity {
  if (!isHostedBlogPlatform(platform)) {
    return opp;
  }
  const o = hostedOpportunityOverride(opp);
  if (o) return o;
  if (opp.id.startsWith('opp_boost_')) {
    return { ...opp, rationale: opp.rationale + HOSTED_META_SCHEMA_NOTE };
  }
  return opp;
}
