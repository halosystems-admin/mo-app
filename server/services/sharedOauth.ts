import crypto from 'crypto';
import { config } from '../config';
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from './supabaseAdmin';

export type SharedOAuthProvider = 'microsoft';

type SharedTokenRow = {
  provider: SharedOAuthProvider;
  access_token: string | null;
  refresh_token: string | null;
  expiry: string | null; // timestamptz
  account_email: string | null;
  updated_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function msTokenEndpoint(): string {
  if (!config.msTenantId) throw new Error('Microsoft tenant id missing.');
  return `https://login.microsoftonline.com/${config.msTenantId}/oauth2/v2.0/token`;
}

export async function getSharedMicrosoftTokens(): Promise<{
  accessToken: string;
  refreshToken: string;
  tokenExpiryMs: number | null;
  accountEmail?: string | null;
}> {
  if (!isSupabaseAdminConfigured()) {
    throw new Error('Supabase admin is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY).');
  }
  const sb = getSupabaseAdminClient();
  if (!sb) throw new Error('Supabase admin client unavailable.');

  const { data, error } = await sb
    .from('app_oauth_tokens')
    .select('provider,access_token,refresh_token,expiry,account_email,updated_at')
    .eq('provider', 'microsoft')
    .maybeSingle<SharedTokenRow>();
  if (error) throw new Error(`Could not load shared OAuth tokens: ${error.message}`);
  if (!data?.refresh_token) throw new Error('Shared Microsoft token not connected. Admin must connect OneDrive.');

  const expiryMs = data.expiry ? Date.parse(data.expiry) : NaN;
  const isExpired = Number.isFinite(expiryMs) ? Date.now() >= expiryMs - 30_000 : true; // refresh 30s early

  // If we have a non-expired access token, use it.
  if (data.access_token && !isExpired) {
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenExpiryMs: Number.isFinite(expiryMs) ? expiryMs : null,
      accountEmail: data.account_email,
    };
  }

  // Refresh using the stored refresh token.
  const tokenResponse = await fetch(msTokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.msClientId,
      client_secret: config.msClientSecret,
      refresh_token: data.refresh_token,
      grant_type: 'refresh_token',
    }).toString(),
  });

  const tokens = (await tokenResponse.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!tokenResponse.ok || tokens.error || !tokens.access_token) {
    throw new Error(tokens.error_description || tokens.error || 'Shared Microsoft token refresh failed.');
  }

  const nextExpiryMs = Date.now() + (tokens.expires_in ?? 3600) * 1000;
  const nextRefresh = tokens.refresh_token || data.refresh_token;

  const { error: upsertErr } = await sb.from('app_oauth_tokens').upsert(
    {
      provider: 'microsoft',
      access_token: tokens.access_token,
      refresh_token: nextRefresh,
      expiry: new Date(nextExpiryMs).toISOString(),
      updated_at: nowIso(),
    },
    { onConflict: 'provider' }
  );
  if (upsertErr) throw new Error(`Could not persist shared OAuth token refresh: ${upsertErr.message}`);

  return {
    accessToken: tokens.access_token,
    refreshToken: nextRefresh,
    tokenExpiryMs: nextExpiryMs,
    accountEmail: data.account_email,
  };
}

export async function storeSharedMicrosoftTokens(params: {
  accessToken: string;
  refreshToken: string | null;
  expiresInSec: number | null;
  accountEmail?: string | null;
}): Promise<void> {
  if (!isSupabaseAdminConfigured()) {
    throw new Error('Supabase admin is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY).');
  }
  const sb = getSupabaseAdminClient();
  if (!sb) throw new Error('Supabase admin client unavailable.');

  const expiryMs = params.expiresInSec ? Date.now() + params.expiresInSec * 1000 : null;
  const { error } = await sb.from('app_oauth_tokens').upsert(
    {
      provider: 'microsoft',
      access_token: params.accessToken,
      refresh_token: params.refreshToken,
      expiry: expiryMs ? new Date(expiryMs).toISOString() : null,
      account_email: params.accountEmail ?? null,
      updated_at: nowIso(),
    },
    { onConflict: 'provider' }
  );
  if (error) throw new Error(`Could not store shared OAuth tokens: ${error.message}`);
}

export function hashInviteToken(token: string): string {
  // Use SHA-256 hex for invite token storage.
  return crypto.createHash('sha256').update(token).digest('hex');
}

