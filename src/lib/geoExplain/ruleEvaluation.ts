import { evaluateCheck, evaluateCheckDetailed } from '../checkEvaluator';
import { SUPPLEMENTAL_EDITORIAL_ISSUE_RULE_IDS } from '../supplementalEditorialIssueRules';
import { DEFAULT_SCORING_CONFIG } from '../defaultScoringConfig';
import {
  loadActiveScoringConfig,
  resolveIssueRulesForPageType,
  type IssueRulesResolutionSource,
} from '../scoringConfigLoader';
import { isYouTubeUrl } from '../youtubeMetadataExtractor';
import type {
  AnalysisResult,
  GeoIssue,
  GeoIssueCategory,
  GeoAxis,
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
  /** Rules evaluated for this page (after commerce filter). Use for audit mapping / positions. */
  auditIssueRules: IssueRule[];
  /** @deprecated same as auditIssueRules */
  rulesSource: IssueRule[];
  rulesSourceLabel: 'config' | 'default';
  issueRulesResolutionSource: IssueRulesResolutionSource;
  profileOwnedRuleIds: string[];
  issueRulesToUse: IssueRule[];
  ytAllowResolved: { ids: string[]; source: 'config' | 'default' };
  skipTextOnlyRules: boolean;
}

function issueRuleCheckName(rule: IssueRule): string | null {
  const c = rule.check ?? rule.condition;
  if (typeof c === 'string' && c.trim()) return c.trim();
  return null;
}

function issueRuleGeoMeta(rule: IssueRule): { axis: GeoAxis; category: GeoIssueCategory } {
  if (rule.axis && rule.category) return { axis: rule.axis, category: rule.category };
  if (rule.axis)
    return { axis: rule.axis, category: resolveIssueRuleMeta(rule.id).category };
  return resolveIssueRuleMeta(rule.id);
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

  const pageType = (result.pageType as PageType) ?? 'editorial';
  const resolution = resolveIssueRulesForPageType(config, pageType);
  const rulesSourceLabel: 'config' | 'default' =
    resolution.source === 'fallback' ? 'default' : 'config';
  const rulesSource = resolution.rules;
  const profileOwnedRuleIds = resolution.profileOwnedRuleIds;

  const ytAllowResolved = resolveYoutubeAllowedIssueIds(config);
  const quotablePassed = evaluateCheck(
    'quotable_sentences_min',
    features,
    rulesSource.find((r) => r.id === 'quotable')?.threshold ?? 3
  );

  let issueRulesToUse = rulesSource;
  try {
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

  /** Per-rule diagnostics for monthly issueRules (editorial only; disable with GEO_ISSUE_RULE_EVAL_LOG=0). */
  const logIssueRuleEval =
    pageType === 'editorial' &&
    !skipTextOnlyRules &&
    process.env.GEO_ISSUE_RULE_EVAL_LOG !== '0';

  for (const rule of issueRulesToUse) {
    if (skipTextOnlyRules) {
      if (!ytAllowResolved.ids.includes(rule.id)) continue;
    }
    const checkName = issueRuleCheckName(rule);
    if (!checkName) {
      console.warn('[runGeoRuleLayer] issueRule missing check/condition:', rule.id);
      continue;
    }
    const evalDetail = evaluateCheckDetailed(checkName, features, rule.threshold);
    const passed = evalDetail.passed;

    if (logIssueRuleEval) {
      console.log('[ISSUE_RULE_EVAL]', {
        ruleId: rule.id,
        check: evalDetail.rawCheck,
        resolvedCheck: evalDetail.resolvedCheck,
        threshold: rule.threshold ?? null,
        effectiveThreshold: evalDetail.effectiveThreshold ?? null,
        measured: evalDetail.measured,
        passed: evalDetail.passed,
        supplemental: SUPPLEMENTAL_EDITORIAL_ISSUE_RULE_IDS.has(rule.id),
        url: result.url,
      });
    }

    if (!passed) {
      if (rule.id === 'content_short' && quotablePassed) continue;
      const meta = issueRuleGeoMeta(rule);
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
          checkExpression: checkName,
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
    auditIssueRules: issueRulesToUse,
    rulesSource: issueRulesToUse,
    rulesSourceLabel,
    issueRulesResolutionSource: resolution.source,
    profileOwnedRuleIds,
    issueRulesToUse,
    ytAllowResolved,
    skipTextOnlyRules,
  };
}
