import { supabase, isSupabaseReachable } from './supabase';
import { DEFAULT_SCORING_CONFIG } from './defaultScoringConfig';
import type { GeoScoringConfig, GeoScoringProfile, IssueRule, PageType } from './analysisTypes';

/** pageType에 따라 활성 프로필 반환. profiles 없으면 null */
export function getProfileForPageType(
  config: GeoScoringConfig,
  pageType: PageType
): GeoScoringProfile | null {
  const profiles = config.profiles;
  if (!profiles) return null;
  return profiles[pageType] ?? profiles.default ?? null;
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
  if (fromProfile && fromProfile.length > 0) {
    return {
      rules: fromProfile,
      source: 'profile',
      profileOwnedRuleIds: fromProfile.map((r) => r.id),
    };
  }
  const root = config.issueRules;
  if (root && root.length > 0) {
    return { rules: root, source: 'root', profileOwnedRuleIds: [] };
  }
  return {
    rules: DEFAULT_SCORING_CONFIG.issueRules,
    source: 'fallback',
    profileOwnedRuleIds: [],
  };
}

const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedConfig: GeoScoringConfig | null = null;
let cachedAt = 0;

export async function loadActiveScoringConfig(): Promise<GeoScoringConfig> {
  const now = Date.now();
  if (cachedConfig && now - cachedAt < CACHE_TTL_MS) {
    return cachedConfig;
  }

  const reachable = await isSupabaseReachable();
  if (!reachable) {
    cachedConfig = DEFAULT_SCORING_CONFIG;
    cachedAt = now;
    return DEFAULT_SCORING_CONFIG;
  }

  try {
    const { data, error } = await supabase
      .from('geo_scoring_config')
      .select('config_json')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data?.config_json) {
      cachedConfig = DEFAULT_SCORING_CONFIG;
      cachedAt = now;
      return DEFAULT_SCORING_CONFIG;
    }

    cachedConfig = data.config_json as GeoScoringConfig;
    cachedAt = now;
    return cachedConfig;
  } catch {
    cachedConfig = DEFAULT_SCORING_CONFIG;
    cachedAt = now;
    return DEFAULT_SCORING_CONFIG;
  }
}

export function invalidateConfigCache(): void {
  cachedConfig = null;
  cachedAt = 0;
}
