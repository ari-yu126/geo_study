import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder'
);

let _reachable: boolean | null = null;

export async function isSupabaseReachable(): Promise<boolean> {
  if (_reachable !== null) return _reachable;
  if (!supabaseUrl || !supabaseAnonKey) {
    _reachable = false;
    return false;
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'HEAD',
      headers: { apikey: supabaseAnonKey },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    _reachable = res.ok || res.status === 400;
  } catch {
    _reachable = false;
  }

  return _reachable;
}
