/**
 * Stricter quotable sentence counting for editorial pages (htmlAnalyzer).
 * Filters vague praise / testimonials without information-bearing signals.
 */

function hasNumericOrSpecSignal(s: string): boolean {
  if (/\d/.test(s)) return true;
  if (/[%₩$€£원만천억mgkg㎏ml㎖cm㎡°C㎾VHzW분초시간개종류명대]/i.test(s)) return true;
  if (/\d+[가-힣a-z]/i.test(s)) return true;
  return false;
}

/** Comparison / decision-support phrasing (structured "추천" only, not bare endorsements). */
function hasComparisonDecisionSignal(s: string): boolean {
  return /보다|반면|차이|장점|단점|적합|경우|환경|사용자|비교|versus|\bvs\.?\b|대비|고르는\s*법|선택\s*기준|체크\s*포인트|A\/B|추천\s*이유|추천\s*순위|비교\s*추천|상황별\s*추천|추천\s*대상/i.test(
    s
  );
}

function hasDefinitionExplainSignal(s: string): boolean {
  return /(?:이)?란\s|의미|특징|구조|방식|기준|원리|정의|설명하자면|이유는/i.test(s);
}

function hasAnyInformationSignal(s: string): boolean {
  return (
    hasNumericOrSpecSignal(s) ||
    hasComparisonDecisionSignal(s) ||
    hasDefinitionExplainSignal(s)
  );
}

/**
 * Subjective / testimonial phrasing without numeric, comparison, or definitional support.
 */
function isPraiseOrTestimonialWithoutSignals(s: string): boolean {
  if (hasAnyInformationSignal(s)) return false;
  return /좋았|좋아요|좋습니다|좋네요|너무\s*좋|만족|예쁘|편하|줄었|괜찮|추천해요|추천합니다|추천하고\s*싶|추천드려요|스트레스|감사해요|감사합니다|최고예요|완전\s*좋|진짜\s*좋|정말\s*좋/i.test(
    s
  );
}

export interface QuotableCountResult {
  accepted: number;
  rejected: number;
}

/**
 * Split on sentence boundaries; count sentences that pass strict quotable rules.
 */
export function countQuotableSentencesStrict(contentText: string): QuotableCountResult {
  const sentences = contentText.split(/[.!?。]\s+/);
  let accepted = 0;
  let rejected = 0;

  for (const raw of sentences) {
    const s = raw.trim();
    if (s.length < 12) continue;
    const words = s.split(/\s+/);
    const wc = words.length;
    if (wc < 3 || wc > 35) continue;

    if (isPraiseOrTestimonialWithoutSignals(s)) {
      rejected++;
      continue;
    }
    if (!hasAnyInformationSignal(s)) {
      rejected++;
      continue;
    }
    accepted++;
  }

  return { accepted, rejected };
}
