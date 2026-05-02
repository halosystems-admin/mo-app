import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { config } from '../config';
import { requireAdmin } from '../middleware/requireAdmin';
import { createInvite, normalizeEmail } from '../services/userStore';
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from '../services/supabaseAdmin';
import { getSharedMicrosoftTokens, storeSharedMicrosoftTokens } from '../services/sharedOauth';
import { sendInviteEmail } from '../services/email';

const router = Router();
router.use(requireAdmin);

function getAdminOneDriveRedirectUri(req: Request): string {
  if (!config.isProduction) {
    // Reuse the existing OAuth callback URI so Entra doesn't need extra redirect URIs.
    return `http://localhost:${config.port}/api/auth/callback`;
  }
  const fromEnv = config.productionUrl || '';
  if (fromEnv) return `${fromEnv}/api/auth/callback`;
  const proto = ((req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0] || 'https').trim();
  const host = ((req.get('x-forwarded-host') || req.get('host') || '').split(',')[0] || '').trim();
  if (!host) throw new Error('Cannot determine public origin for OneDrive callback. Set PRODUCTION_URL.');
  return `${proto}://${host}/api/auth/callback`;
}

function supabaseOrThrow() {
  if (!isSupabaseAdminConfigured()) throw new Error('Supabase admin is not configured.');
  const sb = getSupabaseAdminClient();
  if (!sb) throw new Error('Supabase admin client unavailable.');
  return sb;
}

// ---------------------------------------------------------------------------
// Users / Invites
// ---------------------------------------------------------------------------

router.get('/users', async (_req: Request, res: Response) => {
  try {
    const sb = supabaseOrThrow();
    const { data, error } = await sb
      .from('app_users')
      .select('id,email,first_name,last_name,role,halo_user_id,default_ward_column_id,is_active,created_at,last_login_at')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    res.json({ users: data ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not load users.';
    res.status(500).json({ error: msg });
  }
});

router.post('/users/invite', async (req: Request, res: Response) => {
  const email = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
  const role = req.body?.role === 'admin' ? 'admin' : 'user';
  const firstName = typeof req.body?.firstName === 'string' ? req.body.firstName.trim() : '';
  const lastName = typeof req.body?.lastName === 'string' ? req.body.lastName.trim() : '';
  const haloUserId = typeof req.body?.haloUserId === 'string' ? req.body.haloUserId.trim() : null;
  if (!email) {
    res.status(400).json({ error: 'Email is required.' });
    return;
  }
  try {
    const { rawToken } = await createInvite({
      email,
      role,
      firstName,
      lastName,
      haloUserId,
      invitedBy: req.appUser?.id ?? null,
    });

    const base = config.clientUrl || 'http://localhost:5173';
    const inviteUrl = `${base.replace(/\/$/, '')}/accept-invite?token=${encodeURIComponent(rawToken)}`;

    const emailResult = await sendInviteEmail({
      to: email,
      invitedByEmail: req.appUser?.email ?? null,
      inviteUrl,
      role,
    }).catch((err) => ({ sent: false, reason: err instanceof Error ? err.message : 'Send failed' }));

    // Always return the link so Mo can copy/paste if SMTP isn't configured.
    res.json({ ok: true, inviteUrl, emailSent: emailResult.sent, ...(emailResult.reason ? { emailError: emailResult.reason } : {}) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invite failed.';
    res.status(500).json({ error: msg });
  }
});

router.patch('/users/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id || '').trim();
  if (!id) {
    res.status(400).json({ error: 'Missing user id.' });
    return;
  }
  const role = req.body?.role === 'admin' ? 'admin' : req.body?.role === 'user' ? 'user' : undefined;
  const haloUserId =
    typeof req.body?.haloUserId === 'string' ? req.body.haloUserId.trim() || null : undefined;
  const isActive = typeof req.body?.isActive === 'boolean' ? req.body.isActive : undefined;
  const firstName = typeof req.body?.firstName === 'string' ? req.body.firstName.trim() : undefined;
  const lastName = typeof req.body?.lastName === 'string' ? req.body.lastName.trim() : undefined;
  const hasDefaultWard = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'defaultWardColumnId');
  const defaultWardColumnId = hasDefaultWard
    ? ((v: unknown) => {
        if (v === null) return null;
        if (typeof v === 'string' && v.trim() === '') return null;
        if (typeof v === 'string') return v.trim();
        return undefined;
      })(req.body?.defaultWardColumnId)
    : undefined;

  const validWardColumnIds = new Set(['icu', 'f', 's', 'm', 'paeds', 'ed', 'labour']);

  const update: Record<string, unknown> = {};
  if (role) update.role = role;
  if (haloUserId !== undefined) update.halo_user_id = haloUserId;
  if (isActive !== undefined) update.is_active = isActive;
  if (firstName !== undefined) update.first_name = firstName;
  if (lastName !== undefined) update.last_name = lastName;
  if (defaultWardColumnId !== undefined) {
    if (defaultWardColumnId !== null && !validWardColumnIds.has(defaultWardColumnId)) {
      res.status(400).json({ error: 'Invalid default ward column id.' });
      return;
    }
    update.default_ward_column_id = defaultWardColumnId;
  }

  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: 'No changes provided.' });
    return;
  }

  try {
    const sb = supabaseOrThrow();
    const { error } = await sb.from('app_users').update(update).eq('id', id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Update failed.';
    res.status(500).json({ error: msg });
  }
});

router.delete('/users/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id || '').trim();
  if (!id) {
    res.status(400).json({ error: 'Missing user id.' });
    return;
  }
  try {
    const sb = supabaseOrThrow();
    const { error } = await sb.from('app_users').update({ is_active: false }).eq('id', id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Deactivate failed.';
    res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// OneDrive bootstrap (admin connects Mo's Microsoft account once)
// ---------------------------------------------------------------------------

router.get('/onedrive/status', async (_req: Request, res: Response) => {
  try {
    await getSharedMicrosoftTokens();
    res.json({ connected: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Not connected.';
    res.json({ connected: false, error: msg });
  }
});

router.get('/onedrive/connect-url', (req: Request, res: Response) => {
  if (!config.msTenantId || !config.msClientId) {
    res.status(500).json({ error: 'Server misconfigured: missing Microsoft credentials.' });
    return;
  }
  const redirectUri = getAdminOneDriveRedirectUri(req);
  const scopes = [
    'openid',
    'profile',
    'email',
    'offline_access',
    'Files.ReadWrite',
    'Sites.ReadWrite.All',
    'Calendars.ReadWrite',
    'User.Read',
  ].join(' ');
  const state = crypto.randomUUID();
  req.session.oauthState = state;
  req.session.provider = 'microsoft';
  req.session.oauthPurpose = 'shared_onedrive_bootstrap';
  const url =
    `https://login.microsoftonline.com/${config.msTenantId}/oauth2/v2.0/authorize?` +
    `client_id=${encodeURIComponent(config.msClientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&response_mode=query` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&prompt=select_account` +
    `&state=${encodeURIComponent(state)}`;
  res.json({ url });
});

// Callback now handled by /api/auth/callback (shared redirect URI).

export default router;

