/**
 * Answerability scoring audit: per-rule breakdown + heuristic signals for editorial/blog debugging.
 * Scoring itself stays in runAnalysis + evaluateCheck; this module only observes and explains.
 */

import { evaluateCheck } from './checkEvaluator';
import type {
  AnswerabilityDebug,
  AnswerabilityRuleDebugRow,
  AnswerabilitySignalsDebug,
  PageFeatures,
  PageType,
  ScoringRule,
} from './analysisTypes';

const FAQ_HEADING = /\?|faq|q\s*[.&:)]|묻는\s*질문|자주\s*묻|질문과\s*답|q&a/i;
const RECO_OR_CONCLUSION =
  /추천|권장|결론|verdict|recommend|best\s+choice|top\s+pick|요약|정리하자면|따라서|정리하면|in\s+conclusion|to\s+sum\s+up|in\s+summary/i;

/** Same IDs skipped for commerce maxScore as calculateRuleScore in runAnalysis.ts */
const EDITORIAL_RULES_SKIPPED_ON_COMMERCE = new Set([
  'content_short',
  'first_para',
  'quotable',
  'content_len',
  'content_deep',
  'questions',
]);

function countFaqLikeHeadings(headings: string[]): number {
  return headings.filter((h) => FAQ_HEADING.test(h)).length;
}

/** Same heuristic as `AnswerabilitySignalsDebug.recommendationOrConclusionSentenceCount` — exported for blog paragraph scoring. */
export function countRecoOrConclusionSentences(contentText: string): number {
  const chunk = contentText.slice(0, 12000);
  const parts = chunk.split(/[.!?\n]+/).map((s) => s.trim()).filter((s) => s.length >= 12);
  return parts.filter((s) => RECO_OR_CONCLUSION.test(s)).length;
}

function introDirectAnswerHeuristic(
  signals: Pick<
    AnswerabilitySignalsDebug,
    'firstParagraphLength' | 'hasDefinitionPattern' | 'firstParagraphMeetsMinLength'
  >,
  firstSnippet: string
): boolean {
  if (signals.hasDefinitionPattern) return true;
  if (signals.firstParagraphLength >= 120) return true;
  if (/(방법|가이드|추천|고르는|선택|이용).{2,25}(가지|팁|정리|요약)/.test(firstSnippet)) return true;
  if (/\b(how\s+to|here('?s| is)|we('ll| will)|today)\b/i.test(firstSnippet.slice(0, 400))) return true;
  return false;
}

/** Build heuristic signals — needs same content sample used for scoring (body text) */
export function buildAnswerabilitySignals(
  features: PageFeatures,
  contentTextSample: string
): AnswerabilitySignalsDebug {
  const cq = features.contentQuality;
  const firstSnippet =
    contentTextSample.slice(0, 900) ||
    (features.headings[0] ?? '') + '\n' + contentTextSample.slice(0, 400);

  const firstParagraphMeetsMinLength = evaluateCheck('first_paragraph_quality', features, 30);

  const signals: AnswerabilitySignalsDebug = {
    firstParagraphLength: cq.firstParagraphLength,
    firstParagraphMeetsMinLength,
    hasDefinitionPattern: cq.hasDefinitionPattern,
    quotableSentenceCount: cq.quotableSentenceCount,
    faqLikeHeadingCount: countFaqLikeHeadings(features.headings),
    recommendationOrConclusionSentenceCount: countRecoOrConclusionSentences(contentTextSample),
    introDirectAnswerHeuristic: false,
    pageQuestionsExtractedCount: features.pageQuestions.length,
  };
  signals.introDirectAnswerHeuristic = introDirectAnswerHeuristic(signals, firstSnippet);
  return signals;
}

/**
 * Per-rule answerability breakdown (mirrors calculateRuleScore + commerce skip).
 * Caller sets finalPercent and floor flags after runAnalysis mitigations.
 */
export function buildAnswerabilityDebug(
  features: PageFeatures,
  rules: ScoringRule[],
  pageType: PageType | undefined,
  contentTextSample: string
): Omit<AnswerabilityDebug, 'finalPercent' | 'dataPageFloorApplied' | 'editorialThinDomBoostApplied'> {
  let rawEarned = 0;
  let rawMax = 0;
  const ruleRows: AnswerabilityRuleDebugRow[] = [];

  for (const rule of rules) {
    const skip =
      pageType === 'commerce' && EDITORIAL_RULES_SKIPPED_ON_COMMERCE.has(rule.id);
    if (skip) {
      ruleRows.push({
        id: rule.id,
        label: rule.label,
        check: rule.check,
        threshold: rule.threshold,
        maxPoints: rule.points,
        earnedPoints: 0,
        passed: false,
        skippedForPageType: true,
      });
      continue;
    }
    rawMax += rule.points;
    const passed = evaluateCheck(rule.check, features, rule.threshold);
    const earned = passed ? rule.points : 0;
    rawEarned += earned;
    ruleRows.push({
      id: rule.id,
      label: rule.label,
      check: rule.check,
      threshold: rule.threshold,
      maxPoints: rule.points,
      earnedPoints: earned,
      passed,
    });
  }

  const ruleEnginePercent = rawMax > 0 ? Math.round((rawEarned / rawMax) * 100) : 0;

  return {
    rawEarned,
    rawMax,
    ruleEnginePercent,
    ruleRows,
    signals: buildAnswerabilitySignals(features, contentTextSample),
  };
}
