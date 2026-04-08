import type { GeoIssue, GeoOpportunity, GeoPassedItem, PlatformConstraint } from './analysisTypes';

/**
 * Issue rule ids that are not actionable on Naver Blog (platform-controlled HTML / JSON-LD).
 * Scoring is unchanged; this is audit UI / recommendations display only.
 */
const NAVER_BLOG_NON_ACTIONABLE_ISSUE_IDS = new Set<string>([
  'desc',
  'desc_og_only',
  'og',
  'canonical',
  'no_schema',
  'faq_schema',
  'schema_faq',
  'schema_product',
  'schema_video',
  'video_schema',
]);

function looksLikeSchemaRuleId(id: string): boolean {
  const lower = id.toLowerCase();
  if (lower.includes('jsonld') || lower.includes('json_ld')) return true;
  if (!lower.includes('schema') && !lower.includes('structured')) return false;
  if (lower.includes('question') || lower.includes('lists')) return false;
  return (
    lower.includes('faq') ||
    lower.includes('product') ||
    lower.includes('video') ||
    lower.includes('json') ||
    lower === 'no_schema'
  );
}

export function isNaverBlogNonActionableIssueId(id: string): boolean {
  if (NAVER_BLOG_NON_ACTIONABLE_ISSUE_IDS.has(id)) return true;
  return looksLikeSchemaRuleId(id);
}

/** Stable constraint rows (deduped by PlatformConstraint.id). */
export function naverBlogPlatformConstraintForIssueId(issueId: string): PlatformConstraint | null {
  switch (issueId) {
    case 'desc':
    case 'desc_og_only':
      return {
        id: 'meta_desc_not_editable',
        label: 'Meta Description 수정 불가',
        description: '네이버 블로그는 meta description을 직접 수정할 수 없습니다.',
        alternative: '본문 첫 문단에 핵심 요약을 작성하세요.',
      };
    case 'og':
      return {
        id: 'og_meta_not_editable',
        label: 'OG 메타 태그 직접 수정 불가',
        description: '네이버 블로그는 og:title · og:description 등을 작성자가 자유롭게 편집하기 어렵습니다.',
        alternative: '글 제목·도입부에서 주제가 분명히 드러나게 작성하세요.',
      };
    case 'canonical':
      return {
        id: 'canonical_not_editable',
        label: 'Canonical 직접 설정 불가',
        description: '네이버 블로그는 canonical 링크를 작성자가 직접 지정할 수 없습니다.',
        alternative: '검색·인용에 필요한 맥락은 본문 구조와 내부 링크로 보완하세요.',
      };
    case 'no_schema':
      return {
        id: 'jsonld_not_editable',
        label: 'JSON-LD 구조화 데이터 직접 삽입 불가',
        description: '네이버 블로그에서는 JSON-LD를 페이지에 임의로 삽입하기 어렵습니다.',
        alternative: '질문·답변 형식의 소제목·목록으로 정보를 구조화해 보세요.',
      };
    case 'faq_schema':
    case 'schema_faq':
      return {
        id: 'faq_schema_not_editable',
        label: 'FAQ 스키마 직접 삽입 불가',
        description: 'FAQPage 등 스키마 마크업을 직접 넣기 어렵습니다.',
        alternative: '본문에 소제목·Q&A 블록으로 같은 정보를 드러내세요.',
      };
    case 'schema_product':
      return {
        id: 'product_schema_not_editable',
        label: '상품 스키마 직접 삽입 불가',
        description: 'Product 등 쇼핑 스키마를 블로그 본문에 자유롭게 넣기 어렵습니다.',
        alternative: '표·목록으로 스펙·가격 정보를 정리해 주세요.',
      };
    case 'schema_video':
    case 'video_schema':
      return {
        id: 'video_schema_not_editable',
        label: 'Video 스키마 직접 삽입 불가',
        description: 'VideoObject 등 영상 스키마를 직접 제어하기 어렵습니다.',
        alternative: '영상 주제·요지는 글 도입부와 캡션으로 설명하세요.',
      };
    default:
      if (looksLikeSchemaRuleId(issueId)) {
        return {
          id: 'structured_data_platform_limited',
          label: '구조화 데이터(스키마) 편집 제한',
          description: '네이버 블로그는 웹사이트처럼 JSON-LD·스키마를 자유롭게 편집하기 어렵습니다.',
          alternative: '목록·표·질문형 소제목으로 AI가 읽기 쉬운 구조를 만드세요.',
        };
      }
      return null;
  }
}

export function partitionNaverBlogGeoIssues(geoIssues: GeoIssue[]): {
  actionable: GeoIssue[];
  constraints: PlatformConstraint[];
} {
  const actionable: GeoIssue[] = [];
  const seenConstraintIds = new Set<string>();
  const constraints: PlatformConstraint[] = [];

  for (const g of geoIssues) {
    if (!isNaverBlogNonActionableIssueId(g.id)) {
      actionable.push(g);
      continue;
    }
    const c = naverBlogPlatformConstraintForIssueId(g.id);
    if (c && !seenConstraintIds.has(c.id)) {
      seenConstraintIds.add(c.id);
      constraints.push(c);
    }
  }
  return { actionable, constraints };
}

export function filterNaverBlogGeoPassed(items: GeoPassedItem[]): GeoPassedItem[] {
  return items.filter((p) => !isNaverBlogNonActionableIssueId(p.id));
}

const NAVER_TECH_OPPORTUNITY_IDS = new Set([
  'opp_fix_meta_description',
  'opp_meta_desc_consistency',
  'opp_add_jsonld',
]);

export function filterNaverBlogOpportunities(opportunities: GeoOpportunity[]): GeoOpportunity[] {
  return opportunities.filter((o) => {
    if (NAVER_TECH_OPPORTUNITY_IDS.has(o.id)) return false;
    const fromIssue = o.fixesIssueId ?? o.sourceRefs?.fromIssueId;
    if (fromIssue && isNaverBlogNonActionableIssueId(fromIssue)) return false;
    if (o.fixesIssueId && isNaverBlogNonActionableIssueId(o.fixesIssueId)) return false;
    return true;
  });
}
