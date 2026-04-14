import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder'
);

/** Only cache successful reachability so transient failures are retried (see isSupabaseReachable). */
let _supabaseReachabilityConfirmed = false;

// Optional service-role client for server-side safe writes.
// Provide SUPABASE_SERVICE_ROLE_KEY in deployment environment for admin writes.
export const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(supabaseUrl || 'https://placeholder.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

/**
 * Lightweight connectivity check for the REST API (same project as `supabase` client).
 * Uses raw `fetch` to `/rest/v1/` — not a table query, so RLS on app tables does not apply here.
 * Sends `apikey` + `Authorization: Bearer` like @supabase/supabase-js (HEAD-only was missing Bearer and often got 401).
 */
export async function isSupabaseReachable(): Promise<boolean> {
  if (_supabaseReachabilityConfirmed) return true;

  const supabaseUrlPresent = Boolean(supabaseUrl);
  const anonKeyPresent = Boolean(supabaseAnonKey);
  const dbg = process.env.GEO_SUPABASE_DEBUG === '1';
  if (dbg) {
    console.log('[SUPABASE REACHABILITY]', {
      supabaseUrlPresent,
      anonKeyPresent,
      usesServiceRoleForReachability: false,
      checkDescription: 'raw fetch to PostgREST root /rest/v1/ (HEAD then optional GET); not supabase-js table read',
    });
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    if (dbg) {
      console.log('[SUPABASE REACHABILITY]', {
        outcome: 'unreachable',
        reason: 'missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY',
      });
    }
    return false;
  }

  const restRoot = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/`;
  const restHeaders: HeadersInit = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${supabaseAnonKey}`,
  };

  const runCheck = async (method: 'HEAD' | 'GET'): Promise<Response> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    try {
      return await fetch(restRoot, {
        method,
        headers: restHeaders,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    let res = await runCheck('HEAD');
    const headAccepted = res.ok || res.status === 400;
    if (dbg) {
      console.log('[SUPABASE REACHABILITY]', {
        step: 'HEAD',
        requestUrl: restRoot,
        status: res.status,
        acceptedAsReachable: headAccepted,
      });
    }

    if (!headAccepted) {
      res = await runCheck('GET');
      const getAccepted = res.ok || res.status === 400;
      if (dbg) {
        console.log('[SUPABASE REACHABILITY]', {
          step: 'GET_fallback',
          requestUrl: restRoot,
          status: res.status,
          acceptedAsReachable: getAccepted,
        });
      }
      if (getAccepted) {
        _supabaseReachabilityConfirmed = true;
      }
      return getAccepted;
    }

    _supabaseReachabilityConfirmed = true;
    return true;
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    if (dbg) {
      console.log('[SUPABASE REACHABILITY]', {
        outcome: 'fetch_threw',
        errorMessage,
      });
    }
    return false;
  }
}
