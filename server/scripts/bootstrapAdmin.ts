import { config } from '../config';
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from '../services/supabaseAdmin';
import { hashPassword, normalizeEmail } from '../services/userStore';

async function main() {
  if (!isSupabaseAdminConfigured()) {
    throw new Error('Supabase admin is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY).');
  }
  const sb = getSupabaseAdminClient();
  if (!sb) throw new Error('Supabase admin client unavailable.');

  const emailRaw = process.env.BOOTSTRAP_ADMIN_EMAIL || process.env.ADMIN_EMAIL || '';
  const passwordRaw = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
  const haloUserId = (process.env.BOOTSTRAP_ADMIN_HALO_USER_ID || config.haloUserId || '').trim();

  const email = normalizeEmail(emailRaw);
  const password = String(passwordRaw);
  if (!email) throw new Error('Missing BOOTSTRAP_ADMIN_EMAIL (or ADMIN_EMAIL).');
  if (!password || password.length < 12) {
    throw new Error('Missing BOOTSTRAP_ADMIN_PASSWORD (min 12 chars).');
  }
  if (!haloUserId) {
    throw new Error('Missing BOOTSTRAP_ADMIN_HALO_USER_ID (or HALO_USER_ID).');
  }

  const passwordHash = await hashPassword(password);

  // Upsert by email: make admin active; set halo user id; do not overwrite names unless provided.
  const firstName = (process.env.BOOTSTRAP_ADMIN_FIRST_NAME || 'Mo').trim();
  const lastName = (process.env.BOOTSTRAP_ADMIN_LAST_NAME || '').trim();

  const { data, error } = await sb
    .from('app_users')
    .upsert(
      {
        email,
        password_hash: passwordHash,
        first_name: firstName,
        last_name: lastName,
        role: 'admin',
        halo_user_id: haloUserId,
        is_active: true,
      },
      { onConflict: 'email' }
    )
    .select('id,email,role,halo_user_id,is_active')
    .single<{ id: string; email: string; role: string; halo_user_id: string | null; is_active: boolean }>();

  if (error) throw new Error(error.message);

  // Never print password. Print only the minimal confirmation.
  console.log('[bootstrap-admin] OK', {
    id: data.id,
    email: data.email,
    role: data.role,
    haloUserId: data.halo_user_id,
    isActive: data.is_active,
  });
}

main().catch((err) => {
  console.error('[bootstrap-admin] FAILED', err instanceof Error ? err.message : err);
  process.exit(1);
});

