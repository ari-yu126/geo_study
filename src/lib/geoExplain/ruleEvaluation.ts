import { evaluateCheck } from '../checkEvaluator';
import { DEFAULT_SCORING_CONFIG } from '../defaultScoringConfig';
import { loadActiveScoringConfig } from '../scoringConfigLoader';
import { isYouTubeUrl } from '../youtubeMetadataExtractor';
import type {
  AnalysisResult,
  GeoIssue,
  GeoPassedItem,
  IssueRule,
  PageType,
} from '../analysisTypes';
import { buildPageFeaturesFromResult } from './buildPageFeatures';
import {
  PASSED_REASON_INFO,
  resolveIssueRuleMeta,
  passedRuleIdToAxis,
} from './ruleMeta';

function resolveYoutubeAllowedIssueIds(config: {
  youtubeAllowedIssueIds?: string[];
}): { ids: string[]; source: 'config' | 'default' } {
  const fromConfig = config.youtubeAllowedIssueIds;
  if (fromConfig && fromConfig.length > 0) return { ids: fromConfig, source: 'config' };
  return {
    ids: DEFAULT_SCORING_CONFIG.youtubeAllowedIssueIds ?? [],
    source: 'default',
  };
}

function isYouTubeResult(result: AnalysisResult): boolean {
  try {
    return isYouTubeUrl(result.url);
  } catch {
    return false;
  }
}

export interface GeoRuleLayerResult {
  ruleFailures: GeoIssue[];
  rulePasses: GeoPassedItem[];
  rulesSource: IssueRule[];
  rulesSourceLabel: 'config' | 'default';
  issueRulesToUse: IssueRule[];
  ytAllowResolved: { ids: string[]; source: 'config' | 'default' };
  skipTextOnlyRules: boolean;
}

/**
 * Core configured issue rules: failures → GeoIssue, passes → GeoPassedItem (PASSED_REASON_INFO only).
 */
export async function runGeoRuleLayer(
  result: AnalysisResult
): Promise<GeoRuleLayerResult> {
  const config = await loadActiveScoringConfig();
  const features = buildPageFeaturesFromResult(result);
  const skipTextOnlyRules = isYouTubeResult(result);

  const rulesSourceLabel: 'config' | 'default' =
    config.issueRules && config.issueRules.length > 0 ? 'config' : 'default';
  const rulesSource =
    rulesSourceLabel === 'config' ? config.issueRules! : DEFAULT_SCORING_CONFIG.issueRules;

  const ytAllowResolved = resolveYoutubeAllowedIssueIds(config);
  const quotablePassed = evaluateCheck(
    'quotable_sentences_min',
    features,
    rulesSource.find((r) => r.id === 'quotable')?.threshold ?? 3
  );

  let issueRulesToUse = rulesSource;
  try {
    const pageType = (result.pageType as PageType) ?? undefined;
    if (pageType === 'commerce') {
      const editorialRuleIdsToSkip = new Set([
        'content_short',
        'first_para',
        'quotable',
        'content_len',
        'content_deep',
        'questions',
      ]);
      issueRulesToUse = issueRulesToUse.filter((r) => {
        if (['author', 'pub_date'].includes(r.id)) return false;
        if (editorialRuleIdsToSkip.has(r.id)) return false;
        return true;
      });
    }
  } catch {
    // keep issueRulesToUse
  }

  const axisSnapshot = result.axisScores;
  const ruleFailures: GeoIssue[] = [];
  const rulePasses: GeoPassedItem[] = [];

  for (const rule of issueRulesToUse) {
    if (skipTextOnlyRules) {
      if (!ytAllowResolved.ids.includes(rule.id)) continue;
    }
    const passed = evaluateCheck(rule.check, features, rule.threshold);
    if (!passed) {
      if (rule.id === 'content_short' && quotablePassed) continue;
      const meta = resolveIssueRuleMeta(rule.id);
      ruleFailures.push({
        id: rule.id,
        category: meta.category,
        axis: meta.axis,
        severity: rule.priority,
        label: rule.label,
        description: rule.description,
        fix: `${rule.description} 관련 섹션을 보강하세요.`,
        sourceRefs: {
          ruleId: rule.id,
          axisScoreAtEmit: axisSnapshot,
          checkExpression: rule.check,
        },
      });
    } else {
      const info = PASSED_REASON_INFO[rule.id];
      if (info && !rule.id.startsWith('no_')) {
        rulePasses.push({
          id: rule.id,
          axis: passedRuleIdToAxis(rule.id),
          label: info.label,
          description: info.label,
          reason: info.reason,
          sourceRefs: { ruleId: rule.id, axisScoreAtEmit: axisSnapshot },
        });
      }
    }
  }

  return {
    ruleFailures,
    rulePasses,
    rulesSource,
    rulesSourceLabel,
    issueRulesToUse,
    ytAllowResolved,
    skipTextOnlyRules,
  };
}
