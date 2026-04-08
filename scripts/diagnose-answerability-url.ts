/**
 * Single-URL answerability audit: rule set selection, ed_* rows, signals, floors.
 * Usage: node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs scripts/diagnose-answerability-url.ts <url>
 */

import { loadActiveScoringConfig } from '../src/lib/scoringConfigLoader';
import { runAnalysis } from '../src/lib/runAnalysis';
import {
  DEFAULT_EDITORIAL_ANSWERABILITY_RULES,
  usesDataHeavyAnswerability,
} from '../src/lib/editorialBlogAnswerability';
import type { ContentQuality, PageType } from '../src/lib/analysisTypes';
import { classifyDataPageAndHosting } from '../src/lib/dataPageClassification';

function hasProductSchemaFromContentQuality(cq: ContentQuality): boolean {
  return !!(cq.hasJsonLdProduct || cq.hasJsonLdItemList || cq.hasJsonLdOfferOrAggregate);
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: diagnose-answerability-url.ts <url>');
    process.exit(1);
  }

  const appOrigin = process.env.GEO_ANALYZER_BASE_URL;
  const config = await loadActiveScoringConfig();
  const result = await runAnalysis(url, { appOrigin });

  const cq = result.contentQuality;
  const hasProductSchema = hasProductSchemaFromContentQuality(cq);
  const pageType: PageType | undefined = result.pageType;
  if (!pageType) {
    console.warn('[WARN] result.pageType is missing — using "editorial" only for branch preview.');
  }
  const { isDataPage, dataDensity } = classifyDataPageAndHosting({
    url: result.url,
    normalizedUrl: result.normalizedUrl,
    pageType: pageType ?? 'editorial',
    contentQuality: cq,
    hasProductSchemaBroad: hasProductSchema,
  });

  const dataHeavy = usesDataHeavyAnswerability(pageType ?? 'editorial', isDataPage);
  const rulesFromConfig = dataHeavy
    ? (config.answerabilityRules ?? [])
    : Array.isArray(config.answerabilityRulesEditorial) && config.answerabilityRulesEditorial.length > 0
      ? config.answerabilityRulesEditorial
      : DEFAULT_EDITORIAL_ANSWERABILITY_RULES;
  const expectedFirstRuleId = rulesFromConfig[0]?.id ?? '(empty)';

  const ad = result.scores.answerabilityDebug;
  const rowIds = ad?.ruleRows.map((r) => r.id) ?? [];
  const hasEdPrefix = rowIds.some((id) => id.startsWith('ed_'));
  const hasLegacyShape = rowIds.some((id) =>
    ['first_para', 'quotable', 'tables', 'data_dense', 'price'].includes(id)
  );

  console.log('\n=== URL ===\n', result.normalizedUrl);
  console.log('\n=== Editorial subtype & quality gate (runAnalysis result) ===');
  console.log(
    JSON.stringify(
      {
        editorialSubtype: result.editorialSubtype ?? null,
        editorialSubtypeDebug: result.editorialSubtypeDebug ?? null,
        platform: result.platform ?? null,
        editorialQualityDimensionsMet: ad?.editorialQualityDimensionsMet ?? null,
        editorialQualityGateApplied: ad?.editorialQualityGateApplied ?? null,
      },
      null,
      2
    )
  );
  console.log('\n=== Branch (recomputed from result.contentQuality — matches runAnalysis formula) ===');
  console.log(
    JSON.stringify(
      {
        pageTypeFromResult: result.pageType,
        pageTypeUsedForBranch: pageType,
        isDataPage,
        dataDensity,
        hasProductSchema,
        dataHeavy,
      },
      null,
      2
    )
  );
  console.log(
    'usesDataHeavyAnswerability(pageType, isDataPage) =>',
    dataHeavy
      ? 'LEGACY config.answerabilityRules (commerce or data-heavy page)'
      : 'EDITORIAL non-empty answerabilityRulesEditorial else DEFAULT_EDITORIAL_ANSWERABILITY_RULES'
  );
  console.log('Expected active rule[0].id:', expectedFirstRuleId);
  console.log('config.answerabilityRulesEditorial is non-empty array:', Array.isArray(config.answerabilityRulesEditorial) && (config.answerabilityRulesEditorial?.length ?? 0) > 0);
  if (config.answerabilityRulesEditorial?.length) {
    console.log('config editorial rules count:', config.answerabilityRulesEditorial.length);
  }

  console.log('\n=== answerabilityDebug (from runAnalysis) ===');
  if (!ad) {
    console.log('(no answerabilityDebug — e.g. video pipeline)');
  } else {
    console.log(
      JSON.stringify(
        {
          rawEarned: ad.rawEarned,
          rawMax: ad.rawMax,
          ruleEnginePercent: ad.ruleEnginePercent,
          finalPercent: ad.finalPercent,
          dataPageFloorApplied: ad.dataPageFloorApplied,
          editorialThinDomBoostApplied: ad.editorialThinDomBoostApplied,
        },
        null,
        2
      )
    );
    console.log('\nruleRow ids:', rowIds.join(', '));
    console.log('Contains ed_*:', hasEdPrefix);
    console.log('Contains legacy-shaped ids (first_para/quotable/tables/...):', hasLegacyShape);

    console.log('\nFailed rules (not skipped):');
    const failed = ad.ruleRows.filter((r) => !r.passed && !r.skippedForPageType);
    console.log(
      failed.map((r) => `${r.id} (${r.check}) earned ${r.earnedPoints}/${r.maxPoints}`).join('\n') || '(none)'
    );

    console.log('\nanswerabilityDebug.signals (heuristic audit — not editorialBlogSignals):');
    console.log(JSON.stringify(ad.signals, null, 2));
  }

  console.log('\n=== contentQuality.editorialBlogSignals (blog heuristics for checks) ===');
  console.log(JSON.stringify(cq.editorialBlogSignals ?? null, null, 2));

  console.log('\n=== canonicalSearchQuestions (scoring intents; fresh run via CLI = no /api/analyze cache) ===');
  console.log(
    JSON.stringify(
      (result.canonicalSearchQuestions ?? []).map((q, i) => ({ i: i + 1, text: q.text })),
      null,
      2
    )
  );

  console.log('\n=== Scores ===');
  console.log(
    JSON.stringify(
      {
        answerabilityScore: result.scores.answerabilityScore,
        finalScore: result.scores.finalScore,
        questionCoverage: result.scores.questionCoverage,
        questionMatchScore: result.scores.questionMatchScore,
        extractionIncomplete: result.extractionIncomplete,
        extractionSource: result.extractionSource,
      },
      null,
      2
    )
  );

  if (ad) {
    if (!dataHeavy && !hasEdPrefix) {
      console.log('\n[WARN] Editorial branch expected ed_* rule IDs but none found.');
    } else if (dataHeavy && hasEdPrefix) {
      console.log('\n[WARN] Legacy branch expected but rule rows look editorial (ed_*).');
    } else {
      console.log('\n[OK] Rule id shape matches dataHeavy branch expectation.');
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
