/**
 * End-to-end question text pipeline logging (Tavily → UI).
 * Enable: QUESTION_PIPELINE_TRACE=1
 */

const TOP_N = 10;

export function shouldLogQuestionPipelineTrace(): boolean {
  return process.env.QUESTION_PIPELINE_TRACE === '1';
}

/** Full pipeline stage dump for one analysis (use with forceRefresh). */
export function shouldLogQuestionCoverageStageDebug(): boolean {
  return process.env.QUESTION_COVERAGE_STAGE_DEBUG === '1';
}

export type QuestionCoverageStagesDebugPayload = {
  normalizedUrl: string;
  pageType: string;
  note: string;
  /** Stages 1–3 also appear under QUESTION_PIPELINE_TRACE inside fetchSearchQuestions when QUESTION_PIPELINE_TRACE=1 */
  afterFetchTopicQuality: { count: number; sample: string[] };
  afterPageRelevanceFilter: { count: number; sample: string[] };
  afterCanonical: { count: number; sample: string[] };
  afterDisplaySelection: { count: number; sample: string[] };
  finalCoveredQuestions: string[];
  finalUncoveredQuestions: string[];
  filterMetaStatus?: string;
};

export function logQuestionCoverageStagesDebug(payload: QuestionCoverageStagesDebugPayload): void {
  if (!shouldLogQuestionCoverageStageDebug()) return;
  try {
    console.log(
      '[QUESTION_COVERAGE_STAGES]',
      JSON.stringify({
        ts: new Date().toISOString(),
        ...payload,
      })
    );
  } catch {
    console.log('[QUESTION_COVERAGE_STAGES]', { normalizedUrl: payload.normalizedUrl, error: 'serialize_failed' });
  }
}

export function logQuestionPipelineStage(
  stage: string,
  questions: { text: string }[],
  meta?: Record<string, unknown>
): void {
  if (!shouldLogQuestionPipelineTrace()) return;
  const topExamples = questions.slice(0, TOP_N).map((q) => q.text);
  try {
    console.log(
      '[QUESTION_PIPELINE_TRACE]',
      JSON.stringify({
        stage,
        count: questions.length,
        topExamples,
        ...meta,
      })
    );
  } catch {
    console.log('[QUESTION_PIPELINE_TRACE]', { stage, count: questions.length, error: 'serialize_failed' });
  }
}
