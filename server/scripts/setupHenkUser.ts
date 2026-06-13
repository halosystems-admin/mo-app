/**
 * Configure Henk in Supabase app_users (email + OneDrive root folder).
 *
 * Usage (from repo root, .env loaded automatically):
 *   npm run setup:henk
 *
 * Optional env:
 *   HENK_SETUP_EMAIL=hjkrugersurgery@gmail.com
 *   HENK_SETUP_DRIVE_ROOT="Henk Kruger"
 *   HENK_SETUP_OLD_EMAIL=henk.kruger90@gmail.com   # match existing row to update
 *   HENK_SETUP_PASSWORD="..."                      # only when creating a new user (12+ chars)
 *   HENK_SETUP_FIRST_NAME=Henk
 *   HENK_SETUP_LAST_NAME=Kruger
 *   HENK_SETUP_HALO_USER_ID=27825897106             # Henk Firebase user id (default)
 */
import { HENK_HALO_USER_ID } from '../../shared/clinicalTemplates/constants';
import { config } from '../config';
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from '../services/supabaseAdmin';
import { findUserByEmail, hashPassword, normalizeEmail } from '../services/userStore';

const TARGET_EMAIL = normalizeEmail(process.env.HENK_SETUP_EMAIL || 'hjkrugersurgery@gmail.com');
const DRIVE_ROOT = (process.env.HENK_SETUP_DRIVE_ROOT || 'Henk Kruger').trim();
const OLD_EMAIL = process.env.HENK_SETUP_OLD_EMAIL
  ? normalizeEmail(process.env.HENK_SETUP_OLD_EMAIL)
  : normalizeEmail('henk.kruger90@gmail.com');

async function listKrugerUsers() {
  const sb = getSupabaseAdminClient();
  if (!sb) throw new Error('Supabase admin client unavailable.');
  const { data, error } = await sb
    .from('app_users')
    .select('id,email,first_name,last_name,role,drive_root_folder_name,is_active')
    .or(`email.ilike.%kruger%,email.eq.${TARGET_EMAIL}`);
  if (error) throw new Error(error.message);
  return data || [];
}

async function main(): Promise<void> {
  if (!isSupabaseAdminConfigured()) {
    throw new Error('Supabase admin is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  }
  const sb = getSupabaseAdminClient();
  if (!sb) throw new Error('Supabase admin client unavailable.');

  console.log('[setup-henk] Target email:', TARGET_EMAIL);
  console.log('[setup-henk] Drive root:', DRIVE_ROOT);

  const existingTarget = await findUserByEmail(TARGET_EMAIL);
  const existingOld = OLD_EMAIL !== TARGET_EMAIL ? await findUserByEmail(OLD_EMAIL) : null;

  const candidates = await listKrugerUsers();
  if (candidates.length) {
    console.log('[setup-henk] Users matching kruger / target:');
    for (const u of candidates) {
      console.log(
        `  - ${u.email} | ${u.first_name} ${u.last_name} | root=${u.drive_root_folder_name ?? '(null)'} | active=${u.is_active}`
      );
    }
  }

  const row = existingTarget || existingOld;
  const firstName = (process.env.HENK_SETUP_FIRST_NAME || 'Henk').trim();
  const lastName = (process.env.HENK_SETUP_LAST_NAME || 'Kruger').trim();
  const haloUserId = (process.env.HENK_SETUP_HALO_USER_ID || HENK_HALO_USER_ID).trim() || null;

  if (row) {
    const { data, error } = await sb
      .from('app_users')
      .update({
        email: TARGET_EMAIL,
        first_name: firstName,
        last_name: lastName,
        drive_root_folder_name: DRIVE_ROOT,
        is_active: true,
        ...(haloUserId ? { halo_user_id: haloUserId } : {}),
      })
      .eq('id', row.id)
      .select('id,email,first_name,last_name,role,drive_root_folder_name,is_active,halo_user_id')
      .single();

    if (error) throw new Error(error.message);
    console.log('[setup-henk] Updated existing user:', data);
    return;
  }

  const password = String(process.env.HENK_SETUP_PASSWORD || '');
  if (!password || password.length < 12) {
    console.error(
      '[setup-henk] No Henk user found. Create one in Supabase Table Editor, or re-run with:\n' +
        '  HENK_SETUP_PASSWORD="your-secure-password-12chars+" npm run setup:henk'
    );
    process.exit(1);
  }

  const password_hash = await hashPassword(password);
  const { data, error } = await sb
    .from('app_users')
    .insert({
      email: TARGET_EMAIL,
      password_hash,
      first_name: firstName,
      last_name: lastName,
      role: 'user',
      halo_user_id: haloUserId,
      drive_root_folder_name: DRIVE_ROOT,
      is_active: true,
    })
    .select('id,email,first_name,last_name,role,drive_root_folder_name,is_active,halo_user_id')
    .single();

  if (error) throw new Error(error.message);
  console.log('[setup-henk] Created new user:', data);
}

main().catch((err) => {
  console.error('[setup-henk] FAILED', err instanceof Error ? err.message : err);
  process.exit(1);
});
