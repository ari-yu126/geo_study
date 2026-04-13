/**
 * Opt-in pipeline logs for Question Coverage debugging.
 * Enable: QUESTION_COVERAGE_TRACE=1 (server env)
 */

export function shouldLogQuestionCoverageTrace(): boolean {
  return process.env.QUESTION_COVERAGE_TRACE === '1';
}

export function logQuestionCoverageTrace(
  stage: string,
  payload: Record<string, unknown>
): void {
  if (!shouldLogQuestionCoverageTrace()) return;
  try {
    console.log(
      '[QUESTION_COVERAGE_TRACE]',
      JSON.stringify({ stage, ts: new Date().toISOString(), ...payload })
    );
  } catch {
    console.log('[QUESTION_COVERAGE_TRACE]', { stage, error: 'serialize_failed' });
  }
}
