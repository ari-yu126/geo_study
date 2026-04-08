/**
 * Validates Naver blog URL handling: same post via PC / PostView / mobile should share
 * normalized_url and yield similar scores and content length.
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs scripts/validate-naver-url-consistency.ts [blogId] [logNo]
 *
 * Env (optional): NAVER_VALIDATE_BLOG_ID, NAVER_VALIDATE_LOG_NO
 *
 * Example:
 *   NAVER_VALIDATE_BLOG_ID=jojoldu NAVER_VALIDATE_LOG_NO=221000000000 tsx scripts/validate-naver-url-consistency.ts
 */

import { runAnalysis } from '../src/lib/runAnalysis';
import { normalizeUrl } from '../src/lib/normalizeUrl';

function buildTriple(blogId: string, logNo: string) {
  const bid = encodeURIComponent(blogId);
  const ln = encodeURIComponent(logNo);
  return {
    pc: `https://blog.naver.com/${bid}/${ln}`,
    /** Simulates app `&debug=true` merged into the post path (must sanitize to same post as pc). */
    pcDebugPolluted: `https://blog.naver.com/${bid}/${ln}&debug=true`,
    postView: `https://blog.naver.com/PostView.naver?blogId=${bid}&logNo=${ln}`,
    mobile: `https://m.blog.naver.com/${bid}/${ln}`,
  };
}

function maxSpread(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.max(...nums) - Math.min(...nums);
}

async function main() {
  const blogId =
    process.argv[2] ?? process.env.NAVER_VALIDATE_BLOG_ID ?? 'jojoldu';
  const logNo =
    process.argv[3] ?? process.env.NAVER_VALIDATE_LOG_NO ?? '221000000000';

  const triple = buildTriple(blogId, logNo);
  const cases = [
    { label: 'PC', url: triple.pc },
    { label: 'PC+debugPolluted', url: triple.pcDebugPolluted },
    { label: 'PostView', url: triple.postView },
    { label: 'Mobile', url: triple.mobile },
  ] as const;

  const appOrigin = process.env.GEO_ANALYZER_BASE_URL;

  type Row = {
    label: string;
    inputUrl: string;
    expectedNormalized: string;
    normalizedUrl: string;
    analysisFetchTargetUrl?: string;
    naverFetchUsedPcFallback?: boolean;
    naverMobileFetchUsedHeadless?: boolean;
    analysisFetchWarning?: string | null;
    contentLength: number;
    answerabilityScore: number;
    finalScore: number;
  };

  const rows: Row[] = [];

  for (const c of cases) {
    console.log(`\n[validate-naver] running ${c.label}: ${c.url}`);
    const expectedNormalized = normalizeUrl(c.url);
    const result = await runAnalysis(c.url, { appOrigin });
    rows.push({
      label: c.label,
      inputUrl: c.url,
      expectedNormalized,
      normalizedUrl: result.normalizedUrl,
      analysisFetchTargetUrl: result.analysisFetchTargetUrl,
      naverFetchUsedPcFallback: result.naverFetchUsedPcFallback,
      naverMobileFetchUsedHeadless: result.naverMobileFetchUsedHeadless,
      analysisFetchWarning: result.analysisFetchWarning ?? null,
      contentLength: result.contentQuality.contentLength,
      answerabilityScore: result.scores.answerabilityScore,
      finalScore: result.scores.finalScore,
    });
  }

  console.log('\n=== Results (compare) ===\n');
  console.table(
    rows.map((r) => ({
      label: r.label,
      normalizedUrl: r.normalizedUrl,
      fetchTarget: r.analysisFetchTargetUrl ?? '(n/a)',
      pcFb: r.naverFetchUsedPcFallback === true ? 'yes' : 'no',
      mHeadless: r.naverMobileFetchUsedHeadless === true ? 'yes' : 'no',
      contentLen: r.contentLength,
      answerability: r.answerabilityScore,
      geo_score: r.finalScore,
    }))
  );
  for (const r of rows) {
    if (r.analysisFetchWarning) {
      console.log(`[${r.label}] warning:`, r.analysisFetchWarning);
    }
  }

  const nu = new Set(rows.map((r) => r.normalizedUrl));
  const okNormalized = nu.size === 1;
  console.log('\nChecks:');
  console.log(
    '  normalized_url identical across all inputs:',
    okNormalized ? 'PASS' : `FAIL (${[...nu].join(' | ')})`
  );

  if (!okNormalized) {
    process.exit(1);
  }

  const lens = rows.map((r) => r.contentLength);
  const ans = rows.map((r) => r.answerabilityScore);
  const fin = rows.map((r) => r.finalScore);

  const CONTENT_REL_TOL = 0.2;
  const SCORE_TOL = 8;

  const contentRelSpread = maxSpread(lens) / Math.max(...lens, 1);
  const okContent =
    maxSpread(lens) === 0 || contentRelSpread <= CONTENT_REL_TOL;
  console.log(
    '  contentLength similar (max relative spread ≤',
    CONTENT_REL_TOL,
    '):',
    okContent ? 'PASS' : `WARN (spread ${(contentRelSpread * 100).toFixed(1)}%)`
  );

  const okAns = maxSpread(ans) <= SCORE_TOL;
  const okFin = maxSpread(fin) <= SCORE_TOL;
  console.log(
    '  answerabilityScore similar (max spread ≤',
    SCORE_TOL,
    '):',
    okAns ? 'PASS' : `WARN (spread ${maxSpread(ans)})`
  );
  console.log(
    '  finalScore (geo_score) similar (max spread ≤',
    SCORE_TOL,
    '):',
    okFin ? 'PASS' : `WARN (spread ${maxSpread(fin)})`
  );

  console.log(
    '\nNote: [GEO_FETCH] logs show fetch_target_url per attempt; result.analysisFetchTargetUrl is the winning server fetch.'
  );

  if (okNormalized && okContent && okAns && okFin) {
    console.log('\nValidation: PASS (within tolerance).');
    process.exit(0);
  }
  console.log(
    '\nValidation: PARTIAL — LLM/citation variance or network may widen scores; check table and logs.'
  );
  process.exit(okNormalized ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
