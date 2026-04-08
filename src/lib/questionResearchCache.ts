/**
 * Persistence for search/question research (Tavily-backed) with QUESTION_CACHE_DAYS TTL.
 * Reads/writes geo_question_research_cache when Supabase is available; fails closed on errors.
 */

import { createHash } from 'crypto';
import type { PageType, SearchQuestion } from './analysisTypes';
import { isQuestionCacheValid } from './geoCacheTtl';
import { supabase, isSupabaseReachable } from './supabase';

export function buildQuestionResearchCacheKey(input: {
  normalizedUrl: string;
  primaryPhrase: string;
  essentialTokens: string[];
  pageType?: PageType;
  isEnglishPage: boolean;
}): string {
  const payload = JSON.stringify({
    u: input.normalizedUrl,
    p: input.primaryPhrase.toLowerCase().trim(),
    e: [...input.essentialTokens].map((t) => t.toLowerCase()).sort(),
    pt: input.pageType ?? 'default',
    en: input.isEnglishPage,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export async function getCachedQuestionResearch(
  cacheKey: string
): Promise<{ questions: SearchQuestion[]; updatedAt: string } | null> {
  const reachable = await isSupabaseReachable();
  if (!reachable) return null;

  try {
    const { data, error } = await supabase
      .from('geo_question_research_cache')
      .select('questions_json, updated_at')
      .eq('cache_key', cacheKey)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data?.questions_json || !data.updated_at) return null;
    if (!isQuestionCacheValid(data.updated_at as string)) return null;

    const raw = data.questions_json;
    if (!Array.isArray(raw)) return null;
    return {
      questions: raw as SearchQuestion[],
      updatedAt: data.updated_at as string,
    };
  } catch {
    return null;
  }
}

export async function saveQuestionResearchCache(input: {
  cacheKey: string;
  normalizedUrl: string;
  primaryPhrase: string;
  pageType?: PageType;
  questions: SearchQuestion[];
}): Promise<void> {
  const reachable = await isSupabaseReachable();
  if (!reachable) return;

  try {
    const { error } = await supabase.from('geo_question_research_cache').upsert(
      {
        cache_key: input.cacheKey,
        normalized_url: input.normalizedUrl || null,
        primary_phrase: input.primaryPhrase,
        page_type: input.pageType ?? null,
        questions_json: input.questions,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'cache_key' }
    );
    if (error) return;
  } catch {
    /* missing table or network — analysis continues without persistence */
  }
}
