/**
 * Deterministic template examples when Gemini is unavailable (e.g. quota).
 * Keeps the same shape as AiWritingExamplesData for UI reuse.
 * Copy varies by pageType so fallbacks feel less identical across pages.
 */

import type {
  AiWritingExamplesData,
  AiWritingExamplesRequestBody,
  AiWritingExamplesPageType,
} from './aiWritingExamplesTypes';

export type AiWritingLocale = 'ko' | 'en';

type FallbackKind = 'review' | 'commerce' | 'editorial' | 'general';

/** Maps analysis pageType to template family. `video` → general; `site_info` → editorial (info). */
function resolveFallbackKind(pageType: AiWritingExamplesPageType): FallbackKind {
  if (pageType === 'review') return 'review';
  if (pageType === 'commerce') return 'commerce';
  if (pageType === 'editorial') return 'editorial';
  if (pageType === 'site_info') return 'editorial';
  return 'general';
}

/**
 * Many articles append " - 매체명(EN)" to titles. Strip for shorter template placeholders.
 */
function stripTrailingPublicationSuffix(title: string): string {
  const t = title.trim();
  const withoutPub = t.replace(/\s+-\s+\S+\([A-Za-z0-9]+\)\s*$/u, '').trim();
  return withoutPub.length > 0 ? withoutPub : t;
}

/** First ':' or full-width '：' (single split — headline vs mall/campaign line). */
function indexOfHeadlineColon(s: string): number {
  const a = s.indexOf(':');
  const b = s.indexOf('：');
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}

/**
 * "기사 헤드라인 : 다나와 쇼핑기획전…" — keep headline only when the tail looks like
 * shop/campaign branding (not "비교: A vs B" style content).
 */
function stripColonShopOrCampaignTail(title: string): string {
  const t = title.trim();
  const idx = indexOfHeadlineColon(t);
  if (idx <= 0) return t;
  const head = t.slice(0, idx).trim();
  const tail = t.slice(idx + 1).trim();
  if (head.length < 4) return t;
  if (tail.length === 0) return head;
  const mallOrCampaign =
    /다나와|쇼핑기획|기획전|11번가|쿠팡|G마켓|옥션|특가|이벤트|쇼핑몰|Shop\b|Sale\b|Amazon|eBay/i;
  if (mallOrCampaign.test(tail)) return head;
  return t;
}

const MAX_TEMPLATE_TOPIC_LEN = 72;

function truncateTopicForTemplates(topic: string): string {
  const t = topic.replace(/\s+/g, ' ').trim();
  if (t.length <= MAX_TEMPLATE_TOPIC_LEN) return t;
  return `${t.slice(0, MAX_TEMPLATE_TOPIC_LEN - 1).trimEnd()}…`;
}

/**
 * Single place to normalize page titles for prompts + fallback copy (strip mall tail, publisher suffix, cap length).
 * Safe to use from generateAiWritingExamples so Gemini does not see raw og:title garbage.
 */
export function normalizeWritingExamplesTitle(title: string, url: string): string {
  let t = title.trim();
  if (!t) {
    try {
      return new URL(url).hostname;
    } catch {
      return 'this page';
    }
  }
  t = stripColonShopOrCampaignTail(t);
  t = stripTrailingPublicationSuffix(t);
  t = truncateTopicForTemplates(t);
  if (t) return t;
  try {
    return new URL(url).hostname;
  } catch {
    return 'this page';
  }
}

const MAX_FALLBACK_QUESTION_LEN = 100;

/** Clean API-provided questions (same title noise as page titles) and cap length for FAQ list. */
function cleanQuestionLineForFallback(raw: string): string {
  let t = raw.trim();
  if (!t) return '';
  t = stripColonShopOrCampaignTail(t);
  t = stripTrailingPublicationSuffix(t);
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > MAX_FALLBACK_QUESTION_LEN) {
    return `${t.slice(0, MAX_FALLBACK_QUESTION_LEN - 1).trimEnd()}…`;
  }
  return t;
}

function pickQuestions(input: AiWritingExamplesRequestBody, defaults: [string, string, string]): [string, string, string] {
  const q = input.questions;
  const pick = (i: number, d: string) => {
    const raw = q[i]?.trim();
    if (!raw) return d;
    const cleaned = cleanQuestionLineForFallback(raw);
    return cleaned.length > 0 ? cleaned : d;
  };
  return [pick(0, defaults[0]), pick(1, defaults[1]), pick(2, defaults[2])];
}

function pickHeadings(
  input: AiWritingExamplesRequestBody,
  defaults: [string, string, string]
): [string, string, string] {
  const s = input.recommendedSections;
  return [
    s[0]?.trim() || defaults[0],
    s[1]?.trim() || defaults[1],
    s[2]?.trim() || defaults[2],
  ];
}

function buildKo(kind: FallbackKind, q: [string, string, string], h: [string, string, string]): AiWritingExamplesData {
  switch (kind) {
    case 'review':
      return {
        summaryExample: `리뷰에서는 직접 써본 경험과 비교 기준을 앞에 두고, 스펙 나열 대신 ‘누구에게 맞는지’가 드러나게 쓰면 좋습니다. 한눈에 결론·추천 대상·한계를 보이고, 본문에서 차이·사용 조건·대안과의 비교를 근거로 풀어 주세요.`,
        faqExamples: [
          {
            question: q[0],
            answer: `비슷한 가격대·용도의 대안과 비교했을 때 달라지는 점(소음, 배터리, 키감 등)을 기준으로 2~3문장으로 답합니다. 측정·체험 조건을 짧게 밝히면 신뢰가 올라갑니다.`,
          },
          {
            question: q[1],
            answer: `추천: ○○한 사용자 / 비추천: △△한 경우를 한 단락으로 나눠 적습니다. 과장 없이 경계만 짚어도 충분합니다.`,
          },
          {
            question: q[2],
            answer: `구매 전 확인할 스펙·호환·구성품·환불 가능 여부를 체크리스트 형태로 정리합니다.`,
          },
        ],
        prosConsExample: `장점: (1) … (2) …\n단점: (1) … (2) …\n대안 대비: ○○에서는 A가 유리, △△에서는 B가 나을 수 있음\n→ 추천 대상을 한 줄로 덧붙이세요.`,
        verdictExample: `종합하면 ○○이 가장 강점이며, △△을 중시한다면 대안을 고려하는 편이 좋습니다. 이런 독자에게 추천: … / 이런 경우엔 비추천: …`,
        headingSuggestions: h,
      };
    case 'commerce':
      return {
        summaryExample: `구매 페이지에서는 가격·옵션·배송·교환 조건이 한눈에 보이게 상단에 모으고, 호환·구성품·보증을 본문에서 짧게 확인할 수 있게 쓰면 전환에 유리합니다.`,
        faqExamples: [
          {
            question: q[0],
            answer: `판매가·할인·옵션별 차이(색상·용량·모델명)를 표나 불릿으로 답합니다. 세금·배송비 포함 여부를 명시하세요.`,
          },
          {
            question: q[1],
            answer: `배송 기간·무료배송 조건·교환·반품·A/S 창구를 한 단락에 정리합니다.`,
          },
          {
            question: q[2],
            answer: `기기 호환·필수 액세서리·사용 전 주의(전압·규격)를 짧게 안내합니다.`,
          },
        ],
        prosConsExample: `가격·옵션: …\n배송·교환: …\n호환·구성: …\n→ 망설이는 포인트를 한 줄로 요약하세요.`,
        verdictExample: `지금 조건에서 이 상품을 고른다면 ○○을 우선 확인하고, △△이면 다른 옵션과 비교해 보는 것이 좋습니다. 다음 단계: …`,
        headingSuggestions: h,
      };
    case 'editorial':
      return {
        summaryExample: `독자가 개념·배경·왜 중요한지를 빠르게 잡을 수 있도록 맨 앞에 핵심 정의와 범위를 두세요. 본문에서는 원리·맥락·예시 순으로 풀고, 마지막에 한 장면으로 정리하면 읽기 좋습니다.`,
        faqExamples: [
          {
            question: q[0],
            answer: `용어·개념을 비전문가도 이해하도록 2~3문장으로 정의하고, 흔한 오해 한 가지를 짚습니다.`,
          },
          {
            question: q[1],
            answer: `배경(왜 지금 이슈인지)·흐름을 짧게 설명하고, 필요하면 출처를 함께 적습니다.`,
          },
          {
            question: q[2],
            answer: `실생활·업무에 적용할 때 알아두면 좋은 점을 한 단락으로 정리합니다.`,
          },
        ],
        prosConsExample: `이 접근의 장점: …\n한계·주의점: …\n다른 관점과의 차이: …\n→ 균형 잡힌 결론으로 이어지게 쓰세요.`,
        verdictExample: `정리하면 ○○을 기억하면 되고, 독자가 다음에 할 일은 △△입니다. 더 알아볼 자료: …`,
        headingSuggestions: h,
      };
    default:
      return {
        summaryExample: `이 글은 독자가 빠르게 이해할 수 있도록 핵심 정보를 앞쪽에 모았습니다. 도입에서 주제와 범위를 밝히고, 본문에서 근거와 사례를 제시한 뒤, 마지막에 실무에 바로 쓸 수 있는 행동 제안으로 마무리하는 구성을 권장합니다.`,
        faqExamples: [
          {
            question: q[0],
            answer: `독자가 가장 먼저 알고 싶어 하는 점을 2~3문장으로 직접 답합니다. 출처나 조건이 있으면 함께 적어 신뢰를 보강하세요.`,
          },
          {
            question: q[1],
            answer: `선택·비교·사용 시 혼동이 생기기 쉬운 부분을 짚고, 피해야 할 오해 한 가지를 짧게 정리합니다.`,
          },
          {
            question: q[2],
            answer: `남은 궁금증을 해소하는 보조 정보(조건, 예외, 관련 링크 안내 등)를 한 단락으로 제공합니다.`,
          },
        ],
        prosConsExample: `장점: (1) … (2) …\n단점: (1) … (2) …\n→ 독자 유형별로 무엇이 중요한지 한 줄로 덧붙이면 좋습니다.`,
        verdictExample: `정리하면, 핵심은 ○○이며 상황에 따라 △△을 우선하는 것이 좋습니다. 다음 단계로는 …을 권합니다.`,
        headingSuggestions: h,
      };
  }
}

function buildEn(kind: FallbackKind, q: [string, string, string], h: [string, string, string]): AiWritingExamplesData {
  switch (kind) {
    case 'review':
      return {
        summaryExample: `Lead with your verdict, then support it with hands-on observations, comparisons, and who it’s for (or not). Keep specs secondary to usefulness and trade-offs.`,
        faqExamples: [
          {
            question: q[0],
            answer: `Contrast with close alternatives on the criteria readers care about (noise, battery, feel, etc.). State your test conditions in one short line.`,
          },
          {
            question: q[1],
            answer: `Split into “best for…” and “skip if…” without hype. Clear boundaries build trust.`,
          },
          {
            question: q[2],
            answer: `Pre-purchase checklist: compatibility, in-box contents, return window, and support channels.`,
          },
        ],
        prosConsExample: `Pros: (1) … (2) …\nCons: (1) … (2) …\nvs alternatives: when A wins vs when B wins\nAdd one line: who should buy.`,
        verdictExample: `Overall, it shines when …; look elsewhere if …. Recommended for: … / Not ideal for: …`,
        headingSuggestions: h,
      };
    case 'commerce':
      return {
        summaryExample: `Surface price, variants, shipping, and policy early. Follow with compatibility, what’s in the box, and warranty—short sections readers can scan before buying.`,
        faqExamples: [
          {
            question: q[0],
            answer: `List price, discounts, and variant differences (color, size, SKU). Clarify tax/shipping inclusivity.`,
          },
          {
            question: q[1],
            answer: `Delivery ETA, free-shipping thresholds, returns, exchanges, and support in one paragraph.`,
          },
          {
            question: q[2],
            answer: `Compatibility, required accessories, and cautions (voltage, fit, OS).`,
          },
        ],
        prosConsExample: `Price & options: …\nShipping & returns: …\nCompatibility: …\nOne-line tie-breaker for hesitant buyers.`,
        verdictExample: `If you’re choosing this product now, prioritize ○○; if △△ matters more, compare with …. Next step: …`,
        headingSuggestions: h,
      };
    case 'editorial':
      return {
        summaryExample: `Open with definition, scope, and why it matters. Unpack background and mechanics in the body, then close with a crisp takeaway readers can reuse.`,
        faqExamples: [
          {
            question: q[0],
            answer: `Define the concept in plain language in 2–3 sentences and address one common misconception.`,
          },
          {
            question: q[1],
            answer: `Brief context—why now, how it evolved—with citations where helpful.`,
          },
          {
            question: q[2],
            answer: `Practical implications: what to do, watch for, or read next.`,
          },
        ],
        prosConsExample: `Strengths of this framing: …\nLimits & caveats: …\nHow it differs from other views: …`,
        verdictExample: `In short, the topic boils down to ○○; readers should next △△. Further reading: …`,
        headingSuggestions: h,
      };
    default:
      return {
        summaryExample: `Front-load the answer readers came for. State scope in the intro, support claims in the body, and end with a short, actionable takeaway.`,
        faqExamples: [
          {
            question: q[0],
            answer: `Answer directly in 2–3 sentences. Add one concrete detail or condition that builds trust.`,
          },
          {
            question: q[1],
            answer: `Clarify a common misconception or trade-off readers should know before they decide.`,
          },
          {
            question: q[2],
            answer: `Offer a short follow-up (exceptions, links, or “when to choose something else”).`,
          },
        ],
        prosConsExample: `Pros: (1) … (2) …\nCons: (1) … (2) …\nAdd one line on who this is best for.`,
        verdictExample: `Overall, this angle is a strong fit when …; consider alternatives if …. Next step: …`,
        headingSuggestions: h,
      };
  }
}

function defaultQuestionsKo(kind: FallbackKind): [string, string, string] {
  switch (kind) {
    case 'review':
      return [
        '비슷한 대안·경쟁 제품과 비교했을 때 가장 큰 차이는 무엇인가요?',
        '어떤 사용자에게 추천하고, 비추천하는 경우는 언제인가요?',
        '구매·사용 전 꼭 확인해야 할 스펙이나 조건은?',
      ];
    case 'commerce':
      return [
        `가격대와 옵션(모델·색상·규격)은 어떻게 되나요?`,
        `배송·교환·반품·A/S는 어떻게 안내되나요?`,
        `호환 기기·필수 구성품·구매 전 체크할 점은?`,
      ];
    case 'editorial':
      return [
        '이 글의 핵심 개념이나 정의를 한 줄로 말하면?',
        '배경이나 왜 중요한지 알아야 할 맥락은?',
        '실제로 적용하거나 주의할 때 알아두면 좋은 점은?',
      ];
    default:
      return [
        '이 글의 핵심은 무엇인가요?',
        '선택·비교 시 주의할 점은?',
        '추가로 자주 묻는 질문',
      ];
  }
}

function defaultHeadingsKo(kind: FallbackKind): [string, string, string] {
  switch (kind) {
    case 'review':
      return ['자주 묻는 질문(FAQ)', '비교 / 차이', '장점 / 단점'];
    case 'commerce':
      return ['구매 전 체크포인트', '가격 / 옵션', '배송 / 교환'];
    case 'editorial':
      return ['핵심 요약', '개념 정리', '자주 묻는 질문'];
    default:
      return ['핵심 요약', '자주 묻는 질문', '정리 / 결론'];
  }
}

function defaultQuestionsEn(kind: FallbackKind): [string, string, string] {
  switch (kind) {
    case 'review':
      return [
        'How does it compare to the closest alternatives?',
        'Who should buy it—and who should skip it?',
        'What specs or conditions must I check before buying?',
      ];
    case 'commerce':
      return [
        `What are the price points and variants (model, color, size)?`,
        `What are shipping, returns, exchanges, and support policies?`,
        `Compatibility, in-box contents, and pre-purchase checks?`,
      ];
    case 'editorial':
      return [
        'What is the main idea in one sentence?',
        'What background or context should readers know?',
        'What should I do or watch for in practice?',
      ];
    default:
      return [
        'What is the main takeaway?',
        'What should I watch out for?',
        'What else do readers often ask?',
      ];
  }
}

function defaultHeadingsEn(kind: FallbackKind): [string, string, string] {
  switch (kind) {
    case 'review':
      return ['FAQ', 'Comparison', 'Pros & cons'];
    case 'commerce':
      return ['Before you buy', 'Price & options', 'Shipping & returns'];
    case 'editorial':
      return ['Key summary', 'Concepts', 'FAQ'];
    default:
      return ['Key summary', 'FAQ', 'Conclusion'];
  }
}

/**
 * Editor-style placeholders using page title, questions, and recommended sections.
 * Template set is chosen from analysis pageType (review / commerce / editorial / general).
 */
export function buildFallbackAiWritingExamples(
  input: AiWritingExamplesRequestBody,
  locale: AiWritingLocale
): AiWritingExamplesData {
  const kind = resolveFallbackKind(input.pageType);

  if (locale === 'ko') {
    const dq = defaultQuestionsKo(kind);
    const dh = defaultHeadingsKo(kind);
    const q = pickQuestions(input, dq);
    const h = pickHeadings(input, dh);
    return buildKo(kind, q, h);
  }

  const dq = defaultQuestionsEn(kind);
  const dh = defaultHeadingsEn(kind);
  const q = pickQuestions(input, dq);
  const h = pickHeadings(input, dh);
  return buildEn(kind, q, h);
}
