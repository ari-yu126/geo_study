/**
 * Central TTL policy for GEO cache layers (config, analysis, question research).
 * Benchmark caching is intentionally out of scope.
 */

export const CONFIG_VALIDITY_DAYS = 30;

export const ANALYSIS_CACHE_HOURS = 24;

export const QUESTION_CACHE_DAYS = 7;

export const ANALYSIS_CACHE_TTL_MS = ANALYSIS_CACHE_HOURS * 60 * 60 * 1000;

export const QUESTION_CACHE_TTL_MS = QUESTION_CACHE_DAYS * 24 * 60 * 60 * 1000;

/** Full days since created_at ISO (floor). Null if missing or invalid. */
export function ageDaysFromCreatedAt(createdAtIso: string | null | undefined): number | null {
  if (!createdAtIso) return null;
  const t = new Date(createdAtIso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
}

/**
 * Active GEO config is "expired" when older than CONFIG_VALIDITY_DAYS or when created_at is missing/invalid.
 * (Invalid/missing dates require rebuild — same as the geo-config POST policy.)
 */
export function isConfigExpired(createdAtIso: string | null | undefined): boolean {
  const age = ageDaysFromCreatedAt(createdAtIso);
  if (age === null) return true;
  return age >= CONFIG_VALIDITY_DAYS;
}

/** True when analysis_history.updated_at (or equivalent) is within ANALYSIS_CACHE_HOURS. */
export function isAnalysisCacheValid(updatedAtIso: string | null | undefined): boolean {
  if (!updatedAtIso) return false;
  const t = new Date(updatedAtIso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= Date.now() - ANALYSIS_CACHE_TTL_MS;
}

function normalizeGeoConfigVersion(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/**
 * True when cached analysis was scored with the same active GEO config version.
 * Missing version on one side only matches when both are missing (legacy unknown).
 */
export function analysisGeoConfigVersionsMatch(
  cachedGeoConfigVersion: string | null | undefined,
  currentActiveGeoConfigVersion: string | null | undefined
): boolean {
  const c = normalizeGeoConfigVersion(cachedGeoConfigVersion);
  const cur = normalizeGeoConfigVersion(currentActiveGeoConfigVersion);
  if (c === null && cur === null) return true;
  if (c === null || cur === null) return false;
  return c === cur;
}

/** Analysis cache hit only when time window is valid AND config version matches active. */
export function isAnalysisCacheEntryValid(args: {
  updatedAtIso: string | null | undefined;
  cachedGeoConfigVersion: string | null | undefined;
  currentActiveGeoConfigVersion: string | null | undefined;
}): boolean {
  return (
    isAnalysisCacheValid(args.updatedAtIso) &&
    analysisGeoConfigVersionsMatch(args.cachedGeoConfigVersion, args.currentActiveGeoConfigVersion)
  );
}

/** True when question research row updated_at is within QUESTION_CACHE_DAYS. */
export function isQuestionCacheValid(updatedAtIso: string | null | undefined): boolean {
  if (!updatedAtIso) return false;
  const t = new Date(updatedAtIso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= Date.now() - QUESTION_CACHE_TTL_MS;
}
