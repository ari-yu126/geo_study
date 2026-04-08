/**
 * Blog/editorial-friendly answerability: signals + default rule set.
 * Data-heavy & commerce pages keep legacy answerabilityRules (runAnalysis branch).
 */

import type { EditorialBlogSignals, ScoringRule } from './analysisTypes';

/**
 * Recommendation / verdict / wrap-up language only (scoring signal — not HTML extraction).
 * Excludes bare "따라서/요약" filler common in thin posts.
 */
const RECO_OR_CONCLUSION_STRICT =
  /(추천|비추천|권장|결론(?:은|을|이)?|verdict|recommend(?:s|ation|ed)?|best\s+choice|top\s+pick|총평|한줄\s*평|정리하면(?:\s*말하면)?|요약하면|한마디로|Overall|TL;DR|in\s+conclusion|to\s+sum\s+up|in\s+summary)/i;

/**
 * Structured contrast or verdict framing — not lone "장점/비교/차이" filler common in thin blogs.
 */
const PROS_CONS_COMPARE =
  /장단점|pros?\s+and\s*cons|pros?\s*&\s*cons|versus\b|\bvs\.?\s+|비교\s*(?:표|분석|정리|후기|리뷰|해보|해\s*보|해드|하면|해서)|(?:장점)[\s\S]{0,160}(?:단점)|(?:단점)[\s\S]{0,160}(?:장점)|어느(?:것|게)\s*(?:이|가)\s*(?:더\s*)?(?:좋|나음|낫|추천|적합)|which\s+(?:one\s+)?(?:is\s+)?better|compared\s+to|차이(?:점)?\s*(?:를|을|는)\s*(?:정리|비교|분석|살펴)/i;

/**
 * Explicit who-for / not-for or decision support — not bare "누구에게/입문자/이런 분" alone.
 */
const AUDIENCE =
  /맞는\s*사람|안\s*맞는(?:\s*사람)?|추천\s*대상|비추천(?:\s*대상)?|입문자(?:에게|용)\s*(?:은|는|에게|엔|에)|전문가(?:에게|용)\s*(?:은|는|에게|엔|에)|초보(?:에게|용)\s*(?:은|는|에게|엔|에)|누구에게(?:는)?\s*(?:맞|안\s*맞|추천|비추천)|if\s+you\s*'re\s+(?:a\s+)?(?:new|beginner)|if\s+you\s+are\s+(?:a\s+)?(?:new|beginner|looking|trying)|not\s+for\s+everyone|recommended\s+for/i;

const CHOICE_GUIDE =
  /고르는\s*법|선택\s*기준|어떻게\s*고르|pick\s+the\s+right|choose\s+between|결정하는|체크\s*포인트|고려\s*할|참고\s*할/i;

const INTRO_TAKEAWAY =
  /요약|결론부터|핵심|먼저\s*말하면|한\s*줄로|정리하면|TL;DR|in\s+short|first\s*,|to\s+start|시작하기\s*전에/i;

/**
 * Judgment / comparison / verdict phrasing — excludes generic polite endings ("합니다" alone).
 * Used only for decisiveNonNumericCount (answerability scoring), not HTML extraction.
 */
const DECISIVE_STRICT =
  /(추천|비추천|권장|결론|총평|한줄\s*평|정리하면|요약하면|한마디로|판단|적합|부적합|비추|장점(?:은|이)|단점(?:은|이)|차이(?:는|점)|vs\.?|versus|비교해\s*보면|recommend|conclusion|verdict|prefer|avoid|worth|suggest|TL;DR)/i;

function isBoilerplateOnlySentence(s: string): boolean {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length < 12) return true;
  // Polite stock endings without substantive judgment (common in thin posts)
  if (/^(네|예|아니요|감사합니다|참고로|그럼|자|이상)\b/i.test(t)) return true;
  if (/^[가-힣\s]{0,40}(입니다|습니다|해요|예요|네요)[.!?…]*$/i.test(t) && !DECISIVE_STRICT.test(t)) return true;
  return false;
}

function countStrongDecisiveSentences(bodySample: string): number {
  let n = 0;
  for (const part of bodySample.split(/[.!?。]\s+/)) {
    const s = part.trim();
    if (s.length < 20 || s.length > 220) continue;
    if (isBoilerplateOnlySentence(s)) continue;
    if (!DECISIVE_STRICT.test(s)) continue;
    n++;
  }
  return n;
}

const GENERIC_STOP = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'you', 'your', 'are', 'was', 'from', 'have', 'has',
  '그리고', '하지만', '있는', '없는', '하는', '것은', '때문',
]);

function tokenizeMeaningful(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !GENERIC_STOP.has(t));
}

export function buildEditorialBlogSignals(input: {
  contentText: string;
  headings: string[];
  title: string | null;
  effectiveFirst: string;
  firstParagraphLength: number;
  hasDefinitionPattern: boolean;
  listCount: number;
  pageQuestionCount: number;
}): EditorialBlogSignals {
  const { contentText, headings, title, effectiveFirst, firstParagraphLength, hasDefinitionPattern, listCount, pageQuestionCount } =
    input;
  const headBlob = headings.join('\n').slice(0, 4000);
  const bodySample = contentText.slice(0, 12000);
  const firstSample = effectiveFirst.slice(0, 1200);

  let recoConclusionCount = 0;
  for (const part of bodySample.split(/[.!?\n]+/)) {
    const s = part.trim();
    if (s.length < 18 || s.length > 400) continue;
    if (RECO_OR_CONCLUSION_STRICT.test(s)) recoConclusionCount++;
  }

  const prosConsOrComparison =
    PROS_CONS_COMPARE.test(headBlob) || PROS_CONS_COMPARE.test(bodySample.slice(0, 6000));

  const audienceGuidance = AUDIENCE.test(bodySample);

  const choiceLanguage = CHOICE_GUIDE.test(bodySample);
  const guidanceInContent = /추천|선택|고려|체크|포인트|정리|팁/i.test(bodySample);
  const listWithGuidance = listCount >= 1 && guidanceInContent;

  const introTakeaway =
    (firstParagraphLength >= 40 &&
      (hasDefinitionPattern || INTRO_TAKEAWAY.test(firstSample) || firstParagraphLength >= 100)) ||
    (firstParagraphLength >= 55 && guidanceInContent);

  const decisiveNonNumericCount = countStrongDecisiveSentences(bodySample);

  const titleTokens = new Set(tokenizeMeaningful(title ?? ''));
  const introTokens = tokenizeMeaningful(firstSample.slice(0, 500));
  let overlap = 0;
  for (const t of introTokens) {
    if (titleTokens.has(t)) overlap++;
  }
  const titleIntroAligned =
    titleTokens.size > 0 && overlap >= Math.min(2, Math.ceil(titleTokens.size * 0.35));

  const faqLikeHeadingCount = headings.filter((h) => /\?|faq|q\s*[.&:)]|자주\s*묻|질문과\s*답/i.test(h)).length;

  return {
    introTakeaway,
    recoConclusionCount,
    prosConsOrComparison,
    audienceGuidance,
    listWithGuidance,
    choiceLanguage,
    titleIntroAligned,
    decisiveNonNumericCount,
    pageQuestionCount,
    listCount,
    faqLikeHeadingCount,
  };
}

/** Legacy commerce/data-heavy answerability — unchanged list */
export function usesDataHeavyAnswerability(pageType: import('./analysisTypes').PageType, isDataPage: boolean): boolean {
  return pageType === 'commerce' || isDataPage;
}

/**
 * Default blog/editorial answerability rules (max raw points = 100).
 * Replaces dependence on tables, price, spec blocks, numeric-only quotables.
 */
/** Sum of points = 100 (normalized percent = earned/100) */
export const DEFAULT_EDITORIAL_ANSWERABILITY_RULES: ScoringRule[] = [
  { id: 'ed_first_para', label: 'Opening block length', check: 'first_paragraph_quality', points: 12, threshold: 30 },
  { id: 'ed_definition', label: 'Definition / lead pattern', check: 'has_definition', points: 10 },
  { id: 'ed_intro_takeaway', label: 'Clear intro / takeaway', check: 'editorial_intro_takeaway', points: 8 },
  { id: 'ed_reco_conclusion', label: 'Recommendation / conclusion lines', check: 'editorial_reco_conclusion_min', points: 8, threshold: 3 },
  { id: 'ed_pros_cons', label: 'Pros/cons or comparison wording', check: 'editorial_pros_cons_comparison', points: 8 },
  { id: 'ed_audience', label: 'Who it is / is not for', check: 'editorial_audience_guidance', points: 8 },
  { id: 'ed_decisive', label: 'Answer-like sentences (not numeric-only)', check: 'editorial_decisive_sentences_min', points: 8, threshold: 6 },
  { id: 'ed_title_intro', label: 'Title ↔ intro topic alignment', check: 'editorial_title_intro_alignment', points: 8 },
  { id: 'ed_lists', label: 'List-based structure', check: 'editorial_lists_min', points: 6, threshold: 1 },
  { id: 'ed_list_or_choice', label: 'Lists + guidance OR choice language', check: 'editorial_list_or_choice_guidance', points: 6 },
  { id: 'ed_content_len', label: 'Substantial article body', check: 'editorial_content_substantial', points: 8, threshold: 2000 },
  { id: 'ed_questions', label: 'Question lines or FAQ headings', check: 'editorial_questions_or_faq_min', points: 6, threshold: 2 },
  { id: 'ed_images', label: 'Visual support', check: 'images_min', points: 4, threshold: 1 },
];
