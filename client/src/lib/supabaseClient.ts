import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client. Only created when URL + anon key are set.
 * See `.env.example` for `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
 * Prefer gating features with `isSupabaseConfigured()` before calling `getSupabaseBrowserClient()`.
 */
let cached: SupabaseClient | null | undefined;

export function isSupabaseConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return Boolean(url?.trim() && key?.trim());
}

export function getSupabaseBrowserClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url?.trim() || !key?.trim()) {
    cached = null;
    return null;
  }
  if (cached !== undefined) return cached;
  cached = createClient(url.trim(), key.trim());
  return cached;
}

export function resetSupabaseClientForTests(): void {
  cached = undefined;
}
