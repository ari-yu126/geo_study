import { supabase, isSupabaseReachable } from './supabase';
import { DEFAULT_SCORING_CONFIG } from './defaultScoringConfig';
import type { GeoScoringConfig } from './analysisTypes';

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
