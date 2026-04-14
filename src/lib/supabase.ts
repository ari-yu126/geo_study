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
 * Lightweight connectivity check (same credentials as `supabase` client).
 * Uses `GET /auth/v1/health` with anon JWT — not PostgREST `/rest/v1/` root, because many projects
 * return 401 for anonymous access to the REST root even when table queries work.
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
      checkDescription: 'GET /auth/v1/health with apikey + Bearer (anon)',
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

  const base = supabaseUrl.replace(/\/$/, '');
  const healthUrl = `${base}/auth/v1/health`;
  const restHeaders: HeadersInit = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${supabaseAnonKey}`,
  };

  const runCheck = async (): Promise<Response> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    try {
      return await fetch(healthUrl, {
        method: 'GET',
        headers: restHeaders,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const res = await runCheck();
    const ok = res.ok;
    if (dbg) {
      console.log('[SUPABASE REACHABILITY]', {
        step: 'GET_auth_health',
        requestUrl: healthUrl,
        status: res.status,
        ok,
      });
    }
    if (ok) {
      _supabaseReachabilityConfirmed = true;
    }
    return ok;
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
