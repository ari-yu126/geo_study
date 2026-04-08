/**
 * One-off validation: answerability profile across representative URLs.
 * Run: node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs scripts/validate-answerability-samples.ts
 */

import { runAnalysis } from '../src/lib/runAnalysis';
import type { AnalysisResult } from '../src/lib/analysisTypes';
import { usesDataHeavyAnswerability } from '../src/lib/editorialBlogAnswerability';
import { classifyDataPageAndHosting } from '../src/lib/dataPageClassification';

interface Sample {
  category: string;
  url: string;
}

/**
 * Public URLs chosen for category shape (may 403/404 over time — re-run with fresh URLs if needed).
 * Last checked: 2026-04-06 (HEAD 200 for all except noted).
 */
const SAMPLES: Sample[] = [
  {
    category: '1_naver_blog_corporate',
    url: 'https://blog.naver.com/samsungofficial',
  },
  {
    category: '2_tistory_guide',
    url: 'https://jojoldu.tistory.com/676',
  },
  {
    category: '3_brunch_editorial',
    url: 'https://brunch.co.kr/@needleworm/336',
  },
  {
    category: '4_comparison_tool_rtings',
    url: 'https://www.rtings.com/keyboard/tools/compare/',
  },
  {
    category: '5_commerce_data_heavy',
    url: 'https://prod.danawa.com/list/?cate=112758',
  },
];

function summarize(result: AnalysisResult) {
  const s = result.scores;
  const ad = s.answerabilityDebug;
  const pageType = result.pageType ?? 'unknown';
  const cq = result.contentQuality;
  const hasProductSchemaBroad = !!(
    cq.hasJsonLdProduct ||
    cq.hasJsonLdItemList ||
    cq.hasJsonLdOfferOrAggregate
  );
  const { isDataPage, dataDensity } = classifyDataPageAndHosting({
    url: result.url,
    normalizedUrl: result.normalizedUrl,
    pageType: (result.pageType ?? 'editorial') as 'editorial' | 'commerce' | 'video',
    contentQuality: cq,
    hasProductSchemaBroad,
  });
  const profile = usesDataHeavyAnswerability(pageType as 'editorial' | 'commerce' | 'video' | 'default', isDataPage)
    ? 'data_heavy_legacy'
    : 'editorial_blog';

  const rows = ad?.ruleRows ?? [];
  const passed = rows.filter((r) => r.passed && !r.skippedForPageType);
  const failed = rows.filter((r) => !r.passed && !r.skippedForPageType);

  return {
    pageType,
    profile,
    isDataPage,
    geo_score: s.finalScore,
    answerabilityScore: s.answerabilityScore,
    ruleEnginePercent: ad?.ruleEnginePercent ?? null,
    finalPercent: ad?.finalPercent ?? null,
    ruleEngine_vs_final: ad
      ? `${ad.ruleEnginePercent} → ${ad.finalPercent} (floor:${ad.dataPageFloorApplied} thin:${ad.editorialThinDomBoostApplied})`
      : null,
    passed_rules: passed.map((r) => r.id).join(', '),
    failed_rules: failed.map((r) => r.id).join(', '),
    failed_count: failed.length,
    passed_count: passed.length,
  };
}

async function main() {
  console.log('validate-answerability-samples — editorial vs data-heavy profile\n');
  const rows: Record<string, unknown>[] = [];

  for (const { category, url } of SAMPLES) {
    process.stdout.write(`Fetching ${category} ... `);
    try {
      const result = await runAnalysis(url);
      const row = { category, url, ...summarize(result), error: null };
      rows.push(row);
      console.log('ok');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log('FAIL', msg);
      rows.push({ category, url, error: msg });
    }
  }

  console.log('\n--- Summary table ---\n');
  console.table(
    rows.map((r) => ({
      category: r.category,
      profile: r.profile ?? '—',
      geo: r.geo_score ?? '—',
      ans: r.answerabilityScore ?? '—',
      rulePct: r.ruleEnginePercent ?? '—',
      fail_n: r.failed_count ?? '—',
      failed_ids: (r.failed_rules as string)?.slice(0, 80) || r.error || '—',
    }))
  );

  console.log('\n--- Full detail (JSON) ---\n');
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
