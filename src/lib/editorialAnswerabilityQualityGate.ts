/**
 * Editorial answerability anti-inflation: cap raw answerability % unless enough quality signals pass the gate.
 *
 * - **Strict (article-like / mixed / site_info):** reco/conclusion, decisive sentences, pros/cons, audience —
 *   not question counts alone. Requires 3 of 4.
 * - **Blog relaxed (`editorialSubtype === 'blog'):** informational value without verdict prose — structure,
 *   question coverage (SERP intents or on-page questions/FAQ), and clarity (intro/definition/title↔intro).
 *   Requires 2 of 3 buckets. Does not count reco/decisive/pros-cons as mandatory.
 *
 * Does not change HTML extraction — only scoring (evaluateCheck + thresholds on PageFeatures).
 */

import type { PageFeatures, ScoringRule } from './analysisTypes';
import { evaluateCheck } from './checkEvaluator';

/** When the gate fails, cap raw answerability percent (anti-inflation for thin posts). */
export const EDITORIAL_ANSWERABILITY_QUALITY_CAP_PERCENT = 50;

/** Strict gate: strong verdict-style signals required (each at most once; max count = 4). */
export const MIN_EDITORIAL_STRONG_ANSWER_SIGNALS_STRICT = 3;

/** @deprecated Alias for MIN_EDITORIAL_STRONG_ANSWER_SIGNALS_STRICT */
export const MIN_EDITORIAL_STRONG_ANSWER_SIGNALS = MIN_EDITORIAL_STRONG_ANSWER_SIGNALS_STRICT;

/** @deprecated Use MIN_EDITORIAL_STRONG_ANSWER_SIGNALS_STRICT */
export const MIN_EDITORIAL_ANSWERABILITY_QUALITY_DIMENSIONS = MIN_EDITORIAL_STRONG_ANSWER_SIGNALS_STRICT;

/** Relaxed blog gate: buckets (structure / question surface / clarity) — need this many to lift cap. */
export const MIN_EDITORIAL_BLOG_QUALITY_BUCKETS = 2;

/** Minimum structure score to count as “structure” bucket when list checks fail (headings/sections without lists). */
export const BLOG_GATE_STRUCTURE_SCORE_MIN = 48;

/** Minimum search-question coverage % for the blog “question” bucket. */
export const BLOG_GATE_QUESTION_COVERAGE_MIN = 45;

/** Alternative to coverage: body ↔ query match when coverage is thin. */
export const BLOG_GATE_QUESTION_MATCH_MIN = 55;

const CHECK_RECO = 'editorial_reco_conclusion_min';
const CHECK_DECISIVE = 'editorial_decisive_sentences_min';
const CHECK_AUDIENCE = 'editorial_audience_guidance';
const CHECK_PROS_CONS = 'editorial_pros_cons_comparison';

function thresholdFor(rules: ScoringRule[], check: string, fallback: number): number {
  return rules.find((r) => r.check === check)?.threshold ?? fallback;
}

/** Fallbacks aligned with DEFAULT_EDITORIAL_ANSWERABILITY_RULES / checkEvaluator defaults. */
const FALLBACK_THRESHOLDS: Record<string, number> = {
  [CHECK_RECO]: 3,
  [CHECK_DECISIVE]: 6,
};

/**
 * Count strong answer signals (max 4). Weak editorial checks (length, lists, title-intro, definition, questions) do not count.
 */
export function countEditorialStrongAnswerSignals(
  features: PageFeatures,
  answerabilityRules: ScoringRule[]
): number {
  const thReco = thresholdFor(answerabilityRules, CHECK_RECO, FALLBACK_THRESHOLDS[CHECK_RECO] ?? 3);
  const thDecisive = thresholdFor(
    answerabilityRules,
    CHECK_DECISIVE,
    FALLBACK_THRESHOLDS[CHECK_DECISIVE] ?? 6
  );

  const reco = evaluateCheck(CHECK_RECO, features, thReco);
  const decisive = evaluateCheck(CHECK_DECISIVE, features, thDecisive);
  const audience = evaluateCheck(CHECK_AUDIENCE, features);
  const prosCons = evaluateCheck(CHECK_PROS_CONS, features);

  return [reco, decisive, prosCons, audience].filter(Boolean).length;
}

/**
 * Blog-style relaxed gate: up to 3 buckets (structure, question coverage/surface, clarity).
 * Each bucket counts at most once. Does not use reco/decisive/pros-cons.
 */
export function countEditorialBlogRelaxedQualityBuckets(
  features: PageFeatures,
  answerabilityRules: ScoringRule[],
  structureScore: number
): number {
  const thLists = thresholdFor(answerabilityRules, 'editorial_lists_min', 1);
  const thQuestions = thresholdFor(answerabilityRules, 'editorial_questions_or_faq_min', 2);
  const thFirstPara = thresholdFor(answerabilityRules, 'first_paragraph_quality', 30);

  const structureBucket =
    evaluateCheck('editorial_lists_min', features, thLists) ||
    evaluateCheck('editorial_list_or_choice_guidance', features) ||
    structureScore >= BLOG_GATE_STRUCTURE_SCORE_MIN;

  const qMatch = features.questionMatchScore ?? 0;
  const questionBucket =
    features.questionCoverage >= BLOG_GATE_QUESTION_COVERAGE_MIN ||
    qMatch >= BLOG_GATE_QUESTION_MATCH_MIN ||
    evaluateCheck('editorial_questions_or_faq_min', features, thQuestions);

  const clarityBucket =
    evaluateCheck('editorial_intro_takeaway', features) ||
    evaluateCheck('has_definition', features) ||
    evaluateCheck('editorial_title_intro_alignment', features) ||
    evaluateCheck('first_paragraph_quality', features, thFirstPara);

  return [structureBucket, questionBucket, clarityBucket].filter(Boolean).length;
}

/** @deprecated Use countEditorialStrongAnswerSignals */
export function countEditorialAnswerabilityQualityDimensions(
  features: PageFeatures,
  answerabilityRules: ScoringRule[]
): number {
  return countEditorialStrongAnswerSignals(features, answerabilityRules);
}

export function shouldCapEditorialAnswerabilityForWeakQuality(strongSignalsMet: number): boolean {
  return strongSignalsMet < MIN_EDITORIAL_STRONG_ANSWER_SIGNALS_STRICT;
}

export function shouldCapEditorialBlogRelaxedGate(bucketsMet: number): boolean {
  return bucketsMet < MIN_EDITORIAL_BLOG_QUALITY_BUCKETS;
}
