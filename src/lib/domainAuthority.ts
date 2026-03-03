/**
 * Top Tier 도메인 — 전 세계 AI가 공통적으로 신뢰하는 '상식' 수준만 유지.
 * 그 외 권위는 fetchSearchQuestions(Tavily) 결과의 '검색 노출'로 증거 기반 판단.
 */
const TOP_TIER_DOMAINS = new Set([
  'naver.com', 'google.com', 'wikipedia.org', 'ko.wikipedia.org', 'en.wikipedia.org',
  'danawa.com', 'plan.danawa.com', 'coupang.com', 'amazon.com', 'amazon.co.kr',
]);

export function hasDomainAuthority(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (TOP_TIER_DOMAINS.has(host)) return true;
    for (const domain of TOP_TIER_DOMAINS) {
      if (host.endsWith('.' + domain) || host === domain) return true;
    }
  } catch {
    // invalid url
  }
  return false;
}
