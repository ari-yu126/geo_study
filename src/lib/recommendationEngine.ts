import type {
  AnalysisMeta,
  AuditIssue,
  ContentQuality,
  EditorialSubtype,
  GeoAxisScores,
  GeoIssue,
  GeoOpportunity,
  GeoRecommendations,
  GeoScoringConfig,
  PageType,
  QuestionDisplayRules,
  SearchQuestion,
} from './analysisTypes';
import { buildGeoRecommendationsFromSignals } from './recommendations/buildGeoRecommendations';
import { filterRecommendationsByPageType } from './recommendations/filterRecommendationsByPageType';
import {
  guideRuleBasedOnRefs,
  mergeGuideRulesIntoRecommendations,
} from './recommendations/guideRulesMerge';
import { toRecommendationContext, type LegacyRecommendationInput } from './recommendations/legacyAdapter';
import {
  debugGuideRulesResolution,
  getProfileForPageType,
  GUIDE_RULE_LIST_KEYS,
  loadActiveScoringConfig,
  logGuideConfigBoundary,
  resolveGuideRulesForPageType,
} from './scoringConfigLoader';
import { DEFAULT_SCORING_CONFIG } from './defaultScoringConfig';

const GUIDE_MERGE_DEBUG = process.env.GEO_GUIDE_MERGE_DEBUG === '1';

function guideMergeDbg(...args: unknown[]): void {
  if (GUIDE_MERGE_DEBUG) console.log('[guideMerge]', ...args);
}

/** Issue ids for guideRules matching: geo issues + audit rows + sourceRefs.ruleId (trimmed). */
function addIssueId(set: Set<string>, raw: string | undefined): void {
  if (typeof raw !== 'string') return;
  const t = raw.trim();
  if (t) set.add(t);
}

function buildGuideMergeIssueIdSet(
  geoIssues: GeoIssue[] | undefined,
  auditIssues: AuditIssue[] | undefined
): Set<string> {
  const s = new Set<string>();
  for (const i of geoIssues ?? []) {
    addIssueId(s, i.id);
    addIssueId(s, i.sourceRefs?.ruleId);
  }
  for (const a of auditIssues ?? []) {
    addIssueId(s, a.id);
  }
  return s;
}

export type GeoRecommendationsOptions = {
  searchQuestions?: SearchQuestion[];
  pageQuestions?: string[];
  pageType?: PageType;
  editorialSubtype?: EditorialSubtype;
  geoOpportunities?: GeoOpportunity[];
  geoIssues?: GeoIssue[];
  /** Strength (passed) item ids — optional triggers for guideRules `basedOn`. */
  geoPassedIds?: string[];
  axisScores?: GeoAxisScores;
  /** Meta + body sample for locale/category (required for best results) */
  meta?: Pick<AnalysisMeta, 'title' | 'description' | 'ogTitle' | 'ogDescription'>;
  textSample?: string;
  contentQuality?: ContentQuality | null;
  reviewLike?: boolean;
  hasReviewSchema?: boolean;
  limitedAnalysis?: boolean;
  seedKeywords?: { value: string }[];
  /** From `profiles[pageType].questionRules` — optional display/ranking for gaps */
  questionRules?: QuestionDisplayRules | null;
  /**
   * When set (e.g. from runAnalysis), guide merge uses this object instead of calling
   * loadActiveScoringConfig() again — same snapshot as scoring/issue rules for this run.
   */
  activeScoringConfig?: GeoScoringConfig;
};

/**
 * Deterministic, signal-grounded recommendations (no Gemini).
 * Grounded in geoIssues, geoOpportunities, axisScores, uncoveredQuestions (+ context).
 * Second argument (AuditIssue[]) is kept for API compatibility; not fed into the rule engine.
 */
export async function generateGeoRecommendations(
  uncoveredQuestions: SearchQuestion[],
  _auditIssues: AuditIssue[],
  options?: GeoRecommendationsOptions
): Promise<GeoRecommendations> {
  console.log('[GUIDE ENTRY]', {
    pageType: options?.pageType,
    optionConfigVersion: options?.activeScoringConfig?.version,
    optionProfileKeys: Object.keys(options?.activeScoringConfig?.profiles ?? {}),
    optionIsDefaultSingleton: options?.activeScoringConfig === DEFAULT_SCORING_CONFIG,
  });
  const pageType = options?.pageType ?? 'editorial';
  const meta = options?.meta ?? {
    title: null,
    description: null,
    ogTitle: null,
    ogDescription: null,
  };
  const legacy: LegacyRecommendationInput = {
    pageType,
    editorialSubtype: options?.editorialSubtype,
    meta,
    textSample: options?.textSample ?? '',
    axisScores: options?.axisScores ?? null,
    geoIssues: options?.geoIssues ?? [],
    geoOpportunities: options?.geoOpportunities ?? [],
    uncoveredQuestions,
    searchQuestions: options?.searchQuestions ?? [],
    contentQuality: options?.contentQuality ?? null,
    reviewLike: options?.reviewLike ?? false,
    hasReviewSchema: options?.hasReviewSchema ?? false,
    limitedAnalysis: options?.limitedAnalysis ?? false,
    questionRules: options?.questionRules,
  };
  const config =
    options?.activeScoringConfig ?? (await loadActiveScoringConfig());
  console.log('[GUIDE CONFIG SELECTED]', {
    selectedVersion: config?.version,
    selectedProfileKeys: Object.keys(config?.profiles ?? {}),
    selectedIsDefaultSingleton: config === DEFAULT_SCORING_CONFIG,
  });
  logGuideConfigBoundary('generateGeoRecommendations entry', pageType, config);
  const base = buildGeoRecommendationsFromSignals(
    toRecommendationContext(legacy),
    config
  );
  const profile = getProfileForPageType(config, pageType);
  const guideRules = resolveGuideRulesForPageType(config, pageType);
  const issueIdSet = buildGuideMergeIssueIdSet(options?.geoIssues, _auditIssues);
  const passedIdSet = new Set(
    (options?.geoPassedIds ?? []).map((id) => (typeof id === 'string' ? id.trim() : String(id))).filter(Boolean)
  );

  guideMergeDbg('generateGeoRecommendations', {
    pageType,
    profileExists: !!profile,
    guideRulesResolvedCount: guideRules?.length ?? 0,
    resolvedGuideRuleIds: guideRules?.map((g) => g.id) ?? [],
    layers: debugGuideRulesResolution(config, pageType),
    guideRuleListKeysTried: [...GUIDE_RULE_LIST_KEYS],
    issueIdSet: [...issueIdSet].sort(),
    issueIdSetSize: issueIdSet.size,
    passedIdSet: [...passedIdSet].sort(),
    geoIssuesPassed: options?.geoIssues !== undefined,
    geoIssuesLength: options?.geoIssues?.length ?? 0,
    geoIssueIds: (options?.geoIssues ?? []).map((i) => i.id),
    auditIssuesLength: _auditIssues?.length ?? 0,
    auditIssueIds: (_auditIssues ?? []).map((i) => i.id),
  });

  for (const gr of guideRules ?? []) {
    const refs = guideRuleBasedOnRefs(gr);
    const hitDetail = refs.map((raw) => {
      const id = String(raw).trim();
      return {
        ref: id,
        inIssueIdSet: issueIdSet.has(id),
        inPassedIdSet: passedIdSet.has(id),
      };
    });
    guideMergeDbg('guideRule trigger check', {
      normalizedRuleId: String(gr.id ?? '').trim(),
      normalizedBasedOnRefs: refs,
      hitDetail,
      anyHit: hitDetail.some((h) => h.inIssueIdSet || h.inPassedIdSet),
    });
  }

  const merged = mergeGuideRulesIntoRecommendations(base, {
    guideRules,
    issueIdSet,
    passedIdSet,
    pageType,
  });

  guideMergeDbg('after merge (before filterRecommendationsByPageType)', {
    guideGenerationDebug: merged.guideGenerationDebug,
    traceGuideRuleEntries: merged.trace?.entries?.filter((e) => e.target === 'guideRule') ?? [],
  });

  const filtered = filterRecommendationsByPageType(merged, pageType);

  guideMergeDbg('after filterRecommendationsByPageType', {
    guideGenerationDebug: filtered.guideGenerationDebug,
    traceGuideRuleEntries: filtered.trace?.entries?.filter((e) => e.target === 'guideRule') ?? [],
  });

  return filtered;
}
