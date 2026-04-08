/**
 * Best-effort persistence of finalized GEO analysis into geo_analysis_results.
 * Failures are non-fatal for /api/analyze — callers log and continue.
 */

import type { AnalysisResult } from './analysisTypes';
import { supabase, supabaseAdmin, isSupabaseReachable } from './supabase';

export type SaveGeoAnalysisResultInput = {
  /** Final analysis result (used for scalar mapping). */
  result: AnalysisResult;
  /**
   * Same result with sensitive fields stripped (e.g. llmStatuses.message) for JSON columns.
   */
  safeResult: AnalysisResult;
  /** analysis_history.id after upsert, if resolved. */
  sourceAnalysisId: string | null;
  /** result.geoConfigVersion ?? active DB config version */
  configVersion: string | null;
};

export type SaveGeoAnalysisResultOutcome =
  | { ok: true; id: string | null }
  | { ok: false; error: string; detail?: unknown };

function buildRow(input: SaveGeoAnalysisResultInput): Record<string, unknown> {
  const r = input.result;
  const s = input.safeResult;
  const scores = r.scores;

  const issuesPayload = r.auditIssues ?? null;
  const passedPayload = r.passedChecks ?? null;

  return {
    url: r.url,
    normalized_url: r.normalizedUrl,
    page_type: r.pageType ?? 'editorial',
    platform: r.platform ?? null,
    config_version: input.configVersion,
    geo_score: scores.finalScore ?? null,
    score_structure: scores.structureScore ?? null,
    score_answerability: scores.answerabilityScore ?? null,
    score_trust: scores.trustScore ?? null,
    score_citation: scores.citationScore ?? null,
    score_question_coverage: scores.questionCoverage ?? null,
    result_json: s,
    issues_json: issuesPayload,
    passed_checks_json: passedPayload,
    title: r.meta?.title?.trim() || r.meta?.ogTitle?.trim() || null,
    engine_version: process.env.GEO_ENGINE_VERSION ?? null,
    status: r.limitedAnalysis ? 'partial' : 'success',
    error_message: null,
    source_analysis_id: input.sourceAnalysisId,
    citation_likelihood: null,
    notes: null,
  };
}

/**
 * Inserts one row per successful analysis run (append-only when migration 004 applied).
 */
export async function saveGeoAnalysisResult(
  input: SaveGeoAnalysisResultInput
): Promise<SaveGeoAnalysisResultOutcome> {
  try {
    const reachable = await isSupabaseReachable();
    if (!reachable) {
      return { ok: false, error: 'supabase_unreachable', detail: 'isSupabaseReachable() false' };
    }

    const dbClient = supabaseAdmin ?? supabase;
    const payload = buildRow(input);

    const { data, error } = await dbClient
      .from('geo_analysis_results')
      .insert(payload)
      .select()
      .single();

    console.log('[geo_analysis_results] insert result', { data, error, payload });
    console.log('[geo_analysis_results] using admin client:', !!supabaseAdmin);
    console.log('[geo_analysis_results] target project url:', process.env.NEXT_PUBLIC_SUPABASE_URL);

    if (error) {
      return {
        ok: false,
        error: error.message,
        detail: error,
      };
    }

    const id = data && typeof data === 'object' && 'id' in data && data.id != null ? String(data.id) : null;
    return { ok: true, id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: 'saveGeoAnalysisResult threw', detail: msg };
  }
}
