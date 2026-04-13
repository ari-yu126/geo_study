import type { SearchQuestionKind } from './analysisTypes';

/**
 * Heuristic question kind for display ranking (no LLM).
 * Prefer cheap pattern checks; unknown is safe default.
 */
export function classifySearchQuestionKind(text: string): SearchQuestionKind {
  const t = text.trim();
  if (!t) return 'unknown';

  const lower = t.toLowerCase();

  if (
    /자주\s*묻는|faq|f\.a\.q|질문\s*모음|궁금한\s*점/i.test(t) ||
    /\bfaq\b/i.test(lower)
  ) {
    return 'faq';
  }

  if (/비교|vs\.?|versus|차이(점)?|어느\s*쪽|뭐가\s*나을|which\s+(is\s+)?better/i.test(t)) {
    return 'comparison';
  }

  if (/뭐(야|예요|죠)|무엇|이란|정의|what\s+is|what's|meaning\s+of/i.test(t)) {
    return 'definition';
  }

  if (/가격|원\)|원\]|얼마|비용|할인|세일|price|cost|\$\d|￦/i.test(t)) {
    return 'price';
  }

  if (/스펙|사양|규격|치수|용량|hz|mm|inch|gb|ram|cpu|배터리\s*용량/i.test(t)) {
    return 'spec';
  }

  if (/추천|적합|누구에게|입문|초보|전문가|사용자\s*유형|for\s+whom|worth\s+it/i.test(t)) {
    return 'buyer_fit';
  }

  if (/방법|사용법|설치|하려면|how\s+to|tutorial|단계|가이드/i.test(t)) {
    return 'how_to';
  }

  if (/요약|정리|핵심|한눈에|summary|tl;dr|tldr/i.test(t)) {
    return 'summary';
  }

  if (/타임스탬프|챕터|몇\s*분|시간대|timestamp|chapter/i.test(t)) {
    return 'timestamp';
  }

  if (/구매|주문|배송|반품|재고|쿠폰|결제|장바구니|where\s+to\s+buy|buy\s+online/i.test(t)) {
    return 'transactional';
  }

  return 'unknown';
}
