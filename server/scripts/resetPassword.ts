import { findUserByEmail, hashPassword, normalizeEmail } from '../services/userStore';
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from '../services/supabaseAdmin';

async function main() {
  const email = normalizeEmail(process.env.RESET_EMAIL || '');
  const password = String(process.env.RESET_PASSWORD || '');
  if (!email || !password || password.length < 8) {
    throw new Error('Provide RESET_EMAIL and RESET_PASSWORD (8+ chars).');
  }
  if (!isSupabaseAdminConfigured()) {
    throw new Error('Supabase admin not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  }
  const sb = getSupabaseAdminClient();
  if (!sb) throw new Error('Supabase admin client unavailable.');

  const user = await findUserByEmail(email);
  if (!user) throw new Error(`User not found: ${email}`);

  const password_hash = await hashPassword(password);
  const { error } = await sb.from('app_users').update({ password_hash }).eq('id', user.id);
  if (error) throw new Error(error.message);

  // eslint-disable-next-line no-console
  console.log(`Password reset OK for ${email}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

