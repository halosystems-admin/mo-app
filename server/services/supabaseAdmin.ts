import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

/**
 * Lazy server-side Supabase client with the service role key (bypasses RLS).
 * Returns null when URL or key are unset — callers must handle that.
 *
 * Never import this from client code. Browser code should use
 * `getSupabaseBrowserClient()` in client/src/lib/supabaseClient.ts with the anon key only.
 */
let adminClient: SupabaseClient | null | undefined;

export function isSupabaseAdminConfigured(): boolean {
  return Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
}

export function getSupabaseAdminClient(): SupabaseClient | null {
  if (!isSupabaseAdminConfigured()) {
    adminClient = null;
    return null;
  }
  if (adminClient !== undefined) return adminClient;
  adminClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

export function resetSupabaseAdminForTests(): void {
  adminClient = undefined;
}
