import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from './supabaseAdmin';
import { hashInviteToken } from './sharedOauth';

export type AppRole = 'admin' | 'user';

export type AppUserRow = {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  role: AppRole;
  halo_user_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function requireSupabase() {
  if (!isSupabaseAdminConfigured()) {
    throw new Error('Supabase admin is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY).');
  }
  const sb = getSupabaseAdminClient();
  if (!sb) throw new Error('Supabase admin client unavailable.');
  return sb;
}

export async function findUserByEmail(email: string): Promise<AppUserRow | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('app_users')
    .select('*')
    .eq('email', normalizeEmail(email))
    .maybeSingle<AppUserRow>();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function findUserById(id: string): Promise<AppUserRow | null> {
  const sb = requireSupabase();
  const { data, error } = await sb.from('app_users').select('*').eq('id', id).maybeSingle<AppUserRow>();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function verifyPassword(user: AppUserRow, password: string): Promise<boolean> {
  return await bcrypt.compare(password, user.password_hash);
}

export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 12;
  return await bcrypt.hash(password, saltRounds);
}

export async function updateLastLogin(userId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.from('app_users').update({ last_login_at: new Date().toISOString() }).eq('id', userId);
  if (error) throw new Error(error.message);
}

export async function createInvite(params: {
  email: string;
  role: AppRole;
  firstName?: string;
  lastName?: string;
  haloUserId?: string | null;
  invitedBy?: string | null;
  expiresAtIso?: string | null;
}): Promise<{ inviteId: string; rawToken: string }> {
  const sb = requireSupabase();
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashInviteToken(rawToken);
  const { data, error } = await sb
    .from('app_invites')
    .insert({
      email: normalizeEmail(params.email),
      role: params.role,
      first_name: params.firstName ?? '',
      last_name: params.lastName ?? '',
      halo_user_id: params.haloUserId ?? null,
      token_hash: tokenHash,
      invited_by: params.invitedBy ?? null,
      ...(params.expiresAtIso ? { expires_at: params.expiresAtIso } : {}),
    })
    .select('id')
    .single<{ id: string }>();
  if (error) throw new Error(error.message);
  return { inviteId: data.id, rawToken };
}

export async function getInviteByToken(rawToken: string): Promise<{
  id: string;
  email: string;
  role: AppRole;
  first_name: string;
  last_name: string;
  halo_user_id: string | null;
  expires_at: string;
  accepted_at: string | null;
} | null> {
  const sb = requireSupabase();
  const tokenHash = hashInviteToken(rawToken);
  const { data, error } = await sb
    .from('app_invites')
    .select('id,email,role,first_name,last_name,halo_user_id,expires_at,accepted_at')
    .eq('token_hash', tokenHash)
    .maybeSingle<{
      id: string;
      email: string;
      role: AppRole;
      first_name: string;
      last_name: string;
      halo_user_id: string | null;
      expires_at: string;
      accepted_at: string | null;
    }>();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function acceptInvite(params: {
  rawToken: string;
  password: string;
  firstName: string;
  lastName: string;
}): Promise<{ userId: string; email: string; role: AppRole }> {
  const sb = requireSupabase();
  const inv = await getInviteByToken(params.rawToken);
  if (!inv) throw new Error('Invite not found.');
  if (inv.accepted_at) throw new Error('Invite already used.');
  if (Date.now() > Date.parse(inv.expires_at)) throw new Error('Invite expired.');

  const email = normalizeEmail(inv.email);
  const existing = await findUserByEmail(email);
  if (existing) throw new Error('Account already exists for this email.');

  const passwordHash = await hashPassword(params.password);

  const { data: user, error: createErr } = await sb
    .from('app_users')
    .insert({
      email,
      password_hash: passwordHash,
      first_name: params.firstName.trim(),
      last_name: params.lastName.trim(),
      role: inv.role,
      halo_user_id: inv.halo_user_id,
      is_active: true,
    })
    .select('id,email,role')
    .single<{ id: string; email: string; role: AppRole }>();
  if (createErr) throw new Error(createErr.message);

  const { error: invErr } = await sb.from('app_invites').update({ accepted_at: new Date().toISOString() }).eq('id', inv.id);
  if (invErr) throw new Error(invErr.message);

  return { userId: user.id, email: user.email, role: user.role };
}

