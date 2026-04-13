/**
 * Question Coverage: pass through Tavily-sourced lines with **no rewriting** —
 * exact dedupe, order preserved, cap only. No alignment re-filter, no templates.
 */

import type { AnalysisMeta, PageType, SearchQuestion, SeedKeyword } from './analysisTypes';
import type { PrimaryTopic } from './searchQuestions';
import { shouldLogQuestionPipelineTrace } from './questionPipelineTrace';

const MAX_CANONICAL = 12;

function dedupeExactPreserveOrder(questions: SearchQuestion[]): SearchQuestion[] {
  const seen = new Set<string>();
  const out: SearchQuestion[] = [];
  for (const q of questions) {
    const norm = q.text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(q);
    if (out.length >= MAX_CANONICAL) break;
  }
  return out;
}

function logStage3VsStage5Canonical(evidence: SearchQuestion[], canonical: SearchQuestion[]): void {
  if (!shouldLogQuestionPipelineTrace()) return;
  try {
    console.log(
      '[QUESTION_PIPELINE_TRACE]',
      JSON.stringify({
        stage: 'compare_stage3_evidence_to_stage5_canonical',
        stage3FilteredTavilyCount: evidence.length,
        stage3Top10: evidence.slice(0, 10).map((e) => e.text),
        stage5CanonicalCount: canonical.length,
        stage5Top10: canonical.slice(0, 10).map((q) => q.text),
        note: 'Preserve mode: trim-only pass-through + exact dedupe + max 12; no topic rewrite.',
      })
    );
  } catch {
    // ignore
  }
}

export interface BuildCanonicalSearchQuestionsParams {
  evidence: SearchQuestion[];
  seedKeywords: SeedKeyword[];
  meta: Pick<AnalysisMeta, 'title' | 'ogTitle'>;
  topic: PrimaryTopic;
  pageType?: PageType;
}

/**
 * Tavily lines unchanged except `.trim()` — dedupe, cap 12. No synthetic questions.
 */
export function buildCanonicalSearchQuestions(params: BuildCanonicalSearchQuestionsParams): SearchQuestion[] {
  const { evidence } = params;
  const trimmed: SearchQuestion[] = [];
  for (const ev of evidence) {
    const text = (ev.text ?? '').trim();
    if (text.length < 1) continue;
    trimmed.push({ source: ev.source, text, url: ev.url });
  }
  const merged = dedupeExactPreserveOrder(trimmed);
  logStage3VsStage5Canonical(evidence, merged);
  return merged;
}
