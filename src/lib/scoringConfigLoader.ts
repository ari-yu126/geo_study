import { supabase } from './supabase';
import { DEFAULT_SCORING_CONFIG } from './defaultScoringConfig';
import { SUPPLEMENTAL_EDITORIAL_ISSUE_RULES } from './supplementalEditorialIssueRules';
import type { GeoScoringConfig, GeoScoringProfile, GuideRule, IssueRule, PageType } from './analysisTypes';

/** pageType에 따라 활성 프로필 반환. profiles 없으면 null */
export function getProfileForPageType(
  config: GeoScoringConfig,
  pageType: PageType
): GeoScoringProfile | null {
  const profiles = config.profiles;
  if (!profiles) return null;
  return profiles[pageType] ?? profiles.default ?? null;
}

/** Keys that may hold guide-rule arrays on a profile or at config root (runtime JSON varies). */
export const GUIDE_RULE_LIST_KEYS = [
  'guideRules',
  'guide_rules',
  'guides',
  'contentGuideRules',
  'content_guide_rules',
  'monthlyGuideRules',
  'monthly_guide_rules',
] as const;

/** Unwrap JSON arrays sometimes stored as stringified JSON in config_json. */
function unwrapJsonArray(raw: unknown): unknown {
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.startsWith('[')) {
      try {
        return JSON.parse(t) as unknown;
      } catch {
        return raw;
      }
    }
  }
  return raw;
}

/** Coerce one JSON row into GuideRule (id / basedOn / message field aliases). */
function coerceGuideRuleFromJson(row: unknown): GuideRule | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const idRaw = r.id ?? r.rule_id ?? r.ruleId;
  if (idRaw === undefined || idRaw === null) return null;
  const id = String(idRaw).trim();
  if (!id) return null;

  const trig = r.basedOn ?? r.based_on ?? r.triggers ?? r.trigger_issues ?? r.issue_ids ?? r.issueIds;
  let basedOn: string[] | undefined;
  if (typeof trig === 'string' && trig.trim()) {
    basedOn = [trig.trim()];
  } else if (Array.isArray(trig) && trig.length > 0) {
    basedOn = trig.map((x) => String(x).trim()).filter(Boolean);
  }

  const message = typeof r.message === 'string' ? r.message : '';
  const priority = r.priority === 'high' || r.priority === 'medium' || r.priority === 'low' ? r.priority : undefined;
  const pnRaw = r.priorityNotes ?? r.priority_notes;
  const priorityNotes = Array.isArray(pnRaw)
    ? (pnRaw as unknown[]).filter((x): x is string => typeof x === 'string')
    : undefined;
  const suggestedHeadings = Array.isArray(r.suggestedHeadings)
    ? (r.suggestedHeadings as unknown[]).filter((x): x is string => typeof x === 'string')
    : undefined;
  const suggestedBlocks = Array.isArray(r.suggestedBlocks)
    ? (r.suggestedBlocks as unknown[]).filter((x): x is string => typeof x === 'string')
    : undefined;

  const out: GuideRule = {
    id,
    message,
    ...(basedOn?.length ? { basedOn } : {}),
    ...(priority ? { priority } : {}),
    ...(priorityNotes?.length ? { priorityNotes } : {}),
    ...(suggestedHeadings?.length ? { suggestedHeadings } : {}),
    ...(suggestedBlocks?.length ? { suggestedBlocks } : {}),
  };
  return out;
}

function normalizeGuideRuleArray(raw: unknown): GuideRule[] | undefined {
  const unwrapped = unwrapJsonArray(raw);
  if (!Array.isArray(unwrapped) || unwrapped.length === 0) return undefined;
  const out: GuideRule[] = [];
  for (const item of unwrapped) {
    const g = coerceGuideRuleFromJson(item);
    if (g) out.push(g);
  }
  return out.length ? out : undefined;
}

/** First non-empty guide-rule list found on object (profiles.* or root). */
function pickGuideRulesFromRecord(obj: Record<string, unknown> | null | undefined): GuideRule[] | undefined {
  if (!obj) return undefined;
  for (const k of GUIDE_RULE_LIST_KEYS) {
    const n = normalizeGuideRuleArray(obj[k]);
    if (n?.length) return n;
  }
  return undefined;
}

/** Read guide rules from a profile — supports multiple list keys and row shapes. */
function pickGuideRulesFromProfile(p: GeoScoringProfile | null | undefined): GuideRule[] | undefined {
  if (!p) return undefined;
  return pickGuideRulesFromRecord(p as unknown as Record<string, unknown>);
}

/** Optional list at config root (merged before profile layers). */
function pickRootGuideRules(config: GeoScoringConfig): GuideRule[] | undefined {
  return pickGuideRulesFromRecord(config as unknown as Record<string, unknown>);
}

function mergeGuideRuleListsById(
  base: GuideRule[] | undefined,
  overlay: GuideRule[] | undefined
): GuideRule[] | undefined {
  if (!overlay?.length) return base?.length ? base : undefined;
  if (!base?.length) return overlay;
  const byId = new Map<string, GuideRule>();
  for (const g of base) byId.set(g.id, g);
  for (const g of overlay) byId.set(g.id, g);
  return [...byId.values()];
}

/**
 * Merge guide rules: root config → profiles.default → profiles[pageType] (later wins per id).
 * Reads `guideRules` or `guide_rules` on each layer (runtime Supabase JSON often uses snake_case).
 */
function unwrapProfiles(
  config: GeoScoringConfig
): Partial<Record<PageType, GeoScoringProfile>> | undefined {
  const p = config.profiles as unknown;
  if (p == null) return undefined;
  if (typeof p === 'string') {
    try {
      return JSON.parse(p) as Partial<Record<PageType, GeoScoringProfile>>;
    } catch {
      return undefined;
    }
  }
  if (typeof p === 'object') return p as Partial<Record<PageType, GeoScoringProfile>>;
  return undefined;
}

export function resolveGuideRulesForPageType(
  config: GeoScoringConfig,
  pageType: PageType
): GuideRule[] | undefined {
  const root = pickRootGuideRules(config);
  const profiles = unwrapProfiles(config);
  if (!profiles) {
    return root;
  }
  const defaultR = pickGuideRulesFromProfile(profiles.default ?? null);
  const pageR = pickGuideRulesFromProfile(profiles[pageType] ?? null);
  return mergeGuideRuleListsById(mergeGuideRuleListsById(root, defaultR), pageR);
}

/** For GEO_GUIDE_MERGE_DEBUG=1 — inspect why guide rules resolved empty */
export function debugGuideRulesResolution(
  config: GeoScoringConfig,
  pageType: PageType
): {
  rootIds: string[];
  defaultIds: string[];
  pageIds: string[];
  mergedIds: string[];
  profileKeys: string[];
} {
  const profiles = unwrapProfiles(config);
  const root = pickRootGuideRules(config);
  const defaultR = pickGuideRulesFromProfile(profiles?.default ?? null);
  const pageR = pickGuideRulesFromProfile(profiles?.[pageType] ?? null);
  const merged = resolveGuideRulesForPageType(config, pageType);
  return {
    rootIds: root?.map((g) => g.id) ?? [],
    defaultIds: defaultR?.map((g) => g.id) ?? [],
    pageIds: pageR?.map((g) => g.id) ?? [],
    mergedIds: merged?.map((g) => g.id) ?? [],
    profileKeys: profiles ? Object.keys(profiles) : [],
  };
}

export type IssueRulesResolutionSource = 'profile' | 'root' | 'fallback';

export type IssueRulesResolution = {
  rules: IssueRule[];
  source: IssueRulesResolutionSource;
  /** profiles[pageType].issueRules ids when source === profile — slot ownership for axis defaults */
  profileOwnedRuleIds: string[];
};

/**
 * Issue rules for the active page type: profile first, then root config, then code defaults.
 */
export function resolveIssueRulesForPageType(
  config: GeoScoringConfig,
  pageType: PageType
): IssueRulesResolution {
  const profile = getProfileForPageType(config, pageType);
  const fromProfile = profile?.issueRules;
  let rules: IssueRule[];
  let source: IssueRulesResolutionSource;
  let profileOwnedRuleIds: string[];

  if (fromProfile && fromProfile.length > 0) {
    rules = fromProfile;
    source = 'profile';
    profileOwnedRuleIds = fromProfile.map((r) => r.id);
  } else {
    const root = config.issueRules;
    if (root && root.length > 0) {
      rules = root;
      source = 'root';
      profileOwnedRuleIds = [];
    } else {
      rules = DEFAULT_SCORING_CONFIG.issueRules;
      source = 'fallback';
      profileOwnedRuleIds = [];
    }
  }

  if (pageType === 'editorial') {
    const seen = new Set(rules.map((r) => r.id));
    const extras = SUPPLEMENTAL_EDITORIAL_ISSUE_RULES.filter((r) => !seen.has(r.id));
    if (extras.length > 0) {
      rules = [...rules, ...extras];
    }
  }

  return { rules, source, profileOwnedRuleIds };
}

const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedConfig: GeoScoringConfig | null = null;
let cachedAt = 0;

/** Set GEO_GUIDE_CONFIG_TRACE=1 to log config.profiles shape at recommendation boundaries. */
export function logGuideConfigBoundary(
  tag: string,
  pageType: PageType,
  config: GeoScoringConfig
): void {
  if (process.env.GEO_GUIDE_CONFIG_TRACE !== '1') return;
  const prof = config.profiles ?? {};
  console.log(`[GUIDE TRACE] ${tag}`, {
    pageType,
    profileKeys: Object.keys(prof),
    editorialGuideRuleIds: (prof.editorial?.guideRules ?? []).map((x) => x.id),
    videoGuideRuleIds: (prof.video?.guideRules ?? []).map((x) => x.id),
    commerceGuideRuleIds: (prof.commerce?.guideRules ?? []).map((x) => x.id),
    configVersion: config.version,
    usesDefaultCodeFallbackSingleton: config === DEFAULT_SCORING_CONFIG,
  });
}

export async function loadActiveScoringConfig(): Promise<GeoScoringConfig> {
  const now = Date.now();
  if (cachedConfig && now - cachedAt < CACHE_TTL_MS) {
    return cachedConfig;
  }

  const supabaseUrlConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKeyConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  console.log('[CONFIG LOAD START]', {
    loadPath: 'direct_table_query_geo_scoring_config',
    note: 'does not use isSupabaseReachable / PostgREST root',
    supabaseUrlConfigured,
    anonKeyConfigured,
  });

  if (!supabaseUrlConfigured || !anonKeyConfigured) {
    cachedConfig = DEFAULT_SCORING_CONFIG;
    cachedAt = now;
    console.log('[CONFIG FALLBACK BRANCH]', 'missing_supabase_env');
    return DEFAULT_SCORING_CONFIG;
  }

  try {
    const { data, error } = await supabase
      .from('geo_scoring_config')
      .select('id, config_json')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    console.log('[CONFIG TABLE QUERY]', {
      queryRan: true,
      hasError: !!error,
      errorMessage: error?.message ?? null,
      errorCode: (error as { code?: string } | null)?.code ?? null,
      hasData: !!data,
      hasConfigJson: !!data?.config_json,
      rowId: data?.id ?? null,
    });

    if (error || !data?.config_json) {
      cachedConfig = DEFAULT_SCORING_CONFIG;
      cachedAt = now;
      console.log('[CONFIG FALLBACK BRANCH]', 'query_error_or_missing_config');
      return DEFAULT_SCORING_CONFIG;
    }

    /* eslint-disable @typescript-eslint/no-explicit-any -- debug: raw row shape from Supabase */
    console.log('[CONFIG SUCCESS]', {
      version: (data?.config_json as any)?.version,
      profileKeys: Object.keys(((data?.config_json as any)?.profiles ?? {}) as object),
    });
    console.log('[CONFIG META]', {
      version: (data?.config_json as any)?.version,
      profileKeys: Object.keys(((data?.config_json as any)?.profiles ?? {}) as object),
      editorialGuideRuleIds: ((data?.config_json as any)?.profiles?.editorial?.guideRules ?? []).map((x: any) => x.id),
      videoGuideRuleIds: ((data?.config_json as any)?.profiles?.video?.guideRules ?? []).map((x: any) => x.id),
      commerceGuideRuleIds: ((data?.config_json as any)?.profiles?.commerce?.guideRules ?? []).map((x: any) => x.id),
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */

    cachedConfig = data.config_json as GeoScoringConfig;
    cachedAt = now;
    return cachedConfig;
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    cachedConfig = DEFAULT_SCORING_CONFIG;
    cachedAt = now;
    console.log('[CONFIG FALLBACK BRANCH]', 'catch', { errorMessage });
    return DEFAULT_SCORING_CONFIG;
  }
}

export function invalidateConfigCache(): void {
  cachedConfig = null;
  cachedAt = 0;
}