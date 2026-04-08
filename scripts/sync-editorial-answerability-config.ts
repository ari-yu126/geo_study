/**
 * Compare active Supabase geo_scoring_config.answerabilityRulesEditorial to code defaults
 * (DEFAULT_EDITORIAL_ANSWERABILITY_RULES) and optionally patch the active row.
 *
 * Policy: keep the active DB config aligned with code for editorial answerability via this script
 * (dry-run in CI / local; --apply when thresholds or rule set ship). Avoid relying on empty-array
 * behavior alone — run sync after deploy when editorial rules change.
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs scripts/sync-editorial-answerability-config.ts
 *   node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs scripts/sync-editorial-answerability-config.ts --apply
 *   node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs scripts/sync-editorial-answerability-config.ts --apply "https://blog.naver.com/..."
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY for read.
 * --apply requires SUPABASE_SERVICE_ROLE_KEY (server updates RLS-blocked columns).
 *
 * Optional full monthly rebuild (also sets editorial rules from code in toLegacyConfig):
 *   POST /api/geo-config/update?force=true
 */

import { supabase, supabaseAdmin, isSupabaseReachable } from '../src/lib/supabase';
import { invalidateConfigCache } from '../src/lib/scoringConfigLoader';
import { DEFAULT_EDITORIAL_ANSWERABILITY_RULES } from '../src/lib/editorialBlogAnswerability';
import type { GeoScoringConfig, ScoringRule } from '../src/lib/analysisTypes';
import { runAnalysis } from '../src/lib/runAnalysis';

const CODE = DEFAULT_EDITORIAL_ANSWERABILITY_RULES;

function compareEditorialRules(
  db: ScoringRule[] | undefined | null
): { match: boolean; diffs: string[] } {
  const diffs: string[] = [];
  if (!db || !Array.isArray(db) || db.length === 0) {
    diffs.push(
      'DB answerabilityRulesEditorial is missing, null, or empty (runAnalysis now falls back to code defaults when length is 0).'
    );
    return { match: false, diffs };
  }

  const codeById = new Map(CODE.map((r) => [r.id, r]));
  for (const c of CODE) {
    const dbr = db.find((r) => r.id === c.id && r.check === c.check);
    if (!dbr) {
      diffs.push(`missing rule: ${c.id} check=${c.check}`);
      continue;
    }
    if (dbr.points !== c.points) {
      diffs.push(`${c.id}: points db=${dbr.points} code=${c.points}`);
    }
    const cTh = c.threshold;
    const dTh = dbr.threshold;
    if (cTh !== undefined || dTh !== undefined) {
      if (cTh !== dTh) {
        diffs.push(`${c.id}: threshold db=${dTh ?? '(none)'} code=${cTh ?? '(none)'}`);
      }
    }
  }
  for (const dbr of db) {
    if (!codeById.has(dbr.id)) {
      diffs.push(`extra rule in DB (not in code defaults): ${dbr.id}`);
    }
  }
  if (db.length !== CODE.length) {
    diffs.push(`rule count db=${db.length} code=${CODE.length}`);
  }
  return { match: diffs.length === 0, diffs };
}

function printThresholdSummary(label: string, rules: ScoringRule[]) {
  const pick = (id: string) => rules.find((r) => r.id === id);
  const reco = pick('ed_reco_conclusion');
  const dec = pick('ed_decisive');
  const q = pick('ed_questions');
  console.log(
    `\n${label} (ed_reco / ed_decisive / ed_questions thresholds):`,
    reco?.threshold ?? '—',
    '/',
    dec?.threshold ?? '—',
    '/',
    q?.threshold ?? '—'
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const sampleUrl = argv.find((a) => a.startsWith('http'));

  const okNet = await isSupabaseReachable();
  if (!okNet) {
    console.error('Supabase unreachable (check NEXT_PUBLIC_SUPABASE_URL / ANON_KEY).');
    process.exit(1);
  }

  const client = supabaseAdmin ?? supabase;
  const { data: rows, error } = await client
    .from('geo_scoring_config')
    .select('id, version, created_at, config_json')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('Select error:', error.message);
    process.exit(1);
  }
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  if (!row) {
    console.log('No active geo_scoring_config row. Engine uses DEFAULT_SCORING_CONFIG from code.');
    printThresholdSummary('Code defaults', CODE);
    process.exit(0);
  }

  const cfg = row.config_json as GeoScoringConfig;
  const dbEd = cfg.answerabilityRulesEditorial;
  const { match, diffs } = compareEditorialRules(dbEd);

  console.log('\n=== Active geo_scoring_config ===');
  console.log('id:', row.id);
  console.log('version:', row.version);
  console.log('created_at:', row.created_at);
  printThresholdSummary('DB', dbEd ?? []);
  printThresholdSummary('Code', CODE);

  if (match) {
    console.log('\nanswerabilityRulesEditorial matches code defaults (ids, points, thresholds).');
    if (sampleUrl) {
      console.log('\nRe-running sample analysis:', sampleUrl);
      const r = await runAnalysis(sampleUrl, {});
      console.log('finalScore:', r.scores.finalScore, 'answerability:', r.scores.answerabilityScore);
    }
    process.exit(0);
  }

  console.log('\n=== Diff (DB vs code) ===');
  for (const d of diffs) console.log(' -', d);

  if (!apply) {
    console.log('\nDry-run only. Re-run with --apply to patch active config (needs SERVICE_ROLE).');
    console.log('Or POST /api/geo-config/update?force=true to full Gemini rebuild (editorial rules from code in toLegacyConfig).');
    process.exit(2);
  }

  if (!supabaseAdmin) {
    console.error('\n--apply requires SUPABASE_SERVICE_ROLE_KEY in env.');
    process.exit(1);
  }

  const nextVersion = `${row.version}-ed-ab-${new Date().toISOString().slice(0, 10)}`;
  const nextConfig: GeoScoringConfig = {
    ...cfg,
    answerabilityRulesEditorial: CODE.map((r) => ({ ...r })),
    version: nextVersion,
  };

  const { error: upErr } = await supabaseAdmin
    .from('geo_scoring_config')
    .update({ version: nextVersion, config_json: nextConfig })
    .eq('id', row.id);

  if (upErr) {
    console.error('Update failed:', upErr.message);
    process.exit(1);
  }

  invalidateConfigCache();
  console.log('\nPatched active config: answerabilityRulesEditorial replaced with code defaults.');
  console.log('New version:', nextVersion);

  if (sampleUrl) {
    console.log('\n=== Post-sync sample run ===', sampleUrl);
    const r = await runAnalysis(sampleUrl, {});
    console.log(
      JSON.stringify(
        {
          finalScore: r.scores.finalScore,
          answerabilityScore: r.scores.answerabilityScore,
          editorialQualityDimensionsMet: r.scores.answerabilityDebug?.editorialQualityDimensionsMet,
          editorialQualityGateApplied: r.scores.answerabilityDebug?.editorialQualityGateApplied,
        },
        null,
        2
      )
    );
  } else {
    console.log('\n(Optional) Pass a blog URL after --apply to re-run analysis in this process.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
