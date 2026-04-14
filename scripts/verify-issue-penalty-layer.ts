/**
 * Issue-penalty layer: invariant checks + optional live runAnalysis samples.
 * Run: node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs scripts/verify-issue-penalty-layer.ts
 */

import { runAnalysis } from '../src/lib/runAnalysis';
import type { AnalysisResult, GeoIssue, GeoScores } from '../src/lib/analysisTypes';
import {
  applyIssueBasedFinalScorePenalty,
  verifyIssuePenaltyScoresInvariant,
} from '../src/lib/issueFinalScorePenalty';
import { getGeoGradeInfo } from '../src/app/utils/geoReportLabels';

/** Only `severity` is read by the penalty helper — minimal stubs for tests. */
function synthIssues(nHigh: number, nMed: number, nLow: number): GeoIssue[] {
  const out: GeoIssue[] = [];
  for (let k = 0; k < nHigh; k++)
    out.push({ severity: 'high' } as GeoIssue);
  for (let k = 0; k < nMed; k++)
    out.push({ severity: 'medium' } as GeoIssue);
  for (let k = 0; k < nLow; k++)
    out.push({ severity: 'low' } as GeoIssue);
  return out;
}

function runSyntheticInvariantTests(): { pass: boolean; errors: string[] } {
  const errors: string[] = [];

  const caseA: GeoScores = {
    structureScore: 50,
    answerabilityScore: 50,
    trustScore: 50,
    paragraphScore: 0,
    citationScore: 50,
    questionCoverage: 50,
    questionMatchScore: 50,
    finalScore: 73,
    extractionIncomplete: false,
    extractionSource: 'server',
  };
  applyIssueBasedFinalScorePenalty(caseA, synthIssues(2, 5, 0)); // raw 18 -> cap 15
  if (!verifyIssuePenaltyScoresInvariant(caseA)) errors.push('caseA invariant');
  if (caseA.finalScore !== 58) errors.push(`caseA final expected 58 got ${caseA.finalScore}`);
  if (caseA.preIssuePenaltyFinalScore !== 73) errors.push('caseA pre');
  if (caseA.issuePenaltyPoints !== 15) errors.push('caseA cap');
  if (!caseA.issuePenaltyDebug) errors.push('caseA missing debug when penalty>0');

  const caseB: GeoScores = { ...caseA, finalScore: 5 };
  applyIssueBasedFinalScorePenalty(caseB, synthIssues(10, 0, 0)); // raw 40 -> 15
  if (!verifyIssuePenaltyScoresInvariant(caseB)) errors.push('caseB invariant');
  if (caseB.finalScore !== 0) errors.push(`caseB clamp floor expected 0 got ${caseB.finalScore}`);

  const caseC: GeoScores = { ...caseA, finalScore: 88 };
  applyIssueBasedFinalScorePenalty(caseC, []); // 0 penalty
  if (!verifyIssuePenaltyScoresInvariant(caseC)) errors.push('caseC invariant');
  if (caseC.finalScore !== 88) errors.push('caseC no-op final');
  if (caseC.issuePenaltyPoints !== 0) errors.push('caseC pts');
  if (caseC.preIssuePenaltyFinalScore !== 88) errors.push('caseC pre should equal final when pts=0');
  if (caseC.issuePenaltyDebug !== undefined) errors.push('caseC debug should be omitted');

  return { pass: errors.length === 0, errors };
}

const LIVE_SAMPLES: { label: string; url: string; expectPageType: string }[] = [
  { label: 'editorial_tistory', url: 'https://jojoldu.tistory.com/676', expectPageType: 'editorial' },
  { label: 'editorial_brunch', url: 'https://brunch.co.kr/@needleworm/336', expectPageType: 'editorial' },
  { label: 'commerce_danawa', url: 'https://prod.danawa.com/list/?cate=112758', expectPageType: 'commerce' },
  {
    label: 'video_youtube',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    expectPageType: 'video',
  },
];

function summarizeLive(r: AnalysisResult) {
  const s = r.scores;
  const pre = s.preIssuePenaltyFinalScore;
  const pts = s.issuePenaltyPoints ?? 0;
  const ok = verifyIssuePenaltyScoresInvariant(s);
  const gi = getGeoGradeInfo(s.finalScore);
  const giPre =
    pre !== undefined ? getGeoGradeInfo(pre) : { grade: '—', label: '—' };
  return {
    pageType: r.pageType,
    finalScore: s.finalScore,
    preIssuePenaltyFinalScore: pre,
    issuePenaltyPoints: pts,
    issueCount: r.geoExplain?.issues?.length ?? 0,
    invariantOk: ok,
    gradeAfterPenalty: `${gi.grade} (${gi.label})`,
    gradeIfPreOnly: `${giPre.grade} (${giPre.label})`,
    hasIssuePenaltyDebug: s.issuePenaltyDebug !== undefined,
  };
}

async function main() {
  console.log('=== Synthetic invariant tests ===\n');
  const syn = runSyntheticInvariantTests();
  if (syn.pass) console.log('PASS');
  else {
    console.log('FAIL', syn.errors);
    process.exitCode = 1;
  }

  console.log('\n=== Live runAnalysis samples (network) ===\n');
  for (const { label, url, expectPageType } of LIVE_SAMPLES) {
    process.stdout.write(`${label} ... `);
    try {
      const r = await runAnalysis(url, {});
      const row = summarizeLive(r);
      if (r.pageType !== expectPageType) {
        console.log(`WARN pageType ${r.pageType} (expected ${expectPageType})`);
      } else {
        console.log('ok');
      }
      console.log(JSON.stringify({ label, url, ...row }, null, 2));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log('FAIL', msg);
    }
  }
}

main();
