/**
 * Rename patient folders under a OneDrive root to `Surname, Given__YYYY-MM-DD__M|F`.
 *
 * Token sources (pick one):
 *   RENAME_ACCESS_TOKEN="..."  — paste a delegated Graph token manually
 *   --use-shared-oauth           — Mo/shared OneDrive from app_oauth_tokens (Halo_Patients)
 *   --use-session                — latest HALO browser session in Supabase `session` table
 *   --use-session --session-email hjkrugersurgery@gmail.com  — Henk's session after he signs in + connects Microsoft
 *
 * Examples:
 *   npm run rename:patient-folders -- --root "Henk Kruger" --use-session --session-email hjkrugersurgery@gmail.com --dry-run
 *   npm run rename:patient-folders -- --root "Halo_Patients" --use-shared-oauth --dry-run
 *   npm run rename:patient-folders -- --root "Henk Kruger" --use-session --session-email hjkrugersurgery@gmail.com --apply
 */
import '../config';
import { parseFolderString } from '../services/drive';
import { getSharedMicrosoftTokens } from '../services/sharedOauth';
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from '../services/supabaseAdmin';
import { normalizeEmail } from '../services/userStore';
import { buildPatientFolderDiskName } from '../utils/patientFolderName';

type HaloSessionPayload = {
  accessToken?: string;
  provider?: string;
  userEmail?: string;
};

const graphBase = 'https://graph.microsoft.com/v1.0/me/drive';

type DriveItem = { id: string; name: string; folder?: Record<string, unknown> };

async function graphGet(url: string, token: string): Promise<Response> {
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
}

async function findRootFolderId(token: string, rootName: string): Promise<string | null> {
  let next: string | undefined;
  while (true) {
    const qs = new URLSearchParams({ $top: '200' });
    if (next) qs.set('$skiptoken', next);
    const res = await graphGet(`${graphBase}/root/children?${qs}`, token);
    if (!res.ok) throw new Error(`List root children failed (${res.status}): ${await res.text()}`);
    const data = (await res.json()) as { value?: DriveItem[]; '@odata.nextLink'?: string };
    for (const item of data.value || []) {
      if (item.folder && item.name === rootName) return item.id;
    }
    if (!data['@odata.nextLink']) break;
    const u = new URL(data['@odata.nextLink']);
    next = u.searchParams.get('$skiptoken') || undefined;
    if (!next) break;
  }
  return null;
}

async function listPatientFolders(token: string, rootId: string): Promise<DriveItem[]> {
  const folders: DriveItem[] = [];
  let next: string | undefined;
  while (true) {
    const qs = new URLSearchParams({ $top: '200' });
    if (next) qs.set('$skiptoken', next);
    const res = await graphGet(
      `${graphBase}/items/${encodeURIComponent(rootId)}/children?${qs}`,
      token
    );
    if (!res.ok) throw new Error(`List patients failed (${res.status}): ${await res.text()}`);
    const data = (await res.json()) as { value?: DriveItem[]; '@odata.nextLink'?: string };
    for (const item of data.value || []) {
      if (item.folder && item.name.includes('__')) folders.push(item);
    }
    if (!data['@odata.nextLink']) break;
    const u = new URL(data['@odata.nextLink']);
    next = u.searchParams.get('$skiptoken') || undefined;
    if (!next) break;
  }
  return folders;
}

async function renameFolder(token: string, itemId: string, newName: string): Promise<void> {
  const res = await fetch(`${graphBase}/items/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: newName }),
  });
  if (!res.ok) {
    throw new Error(`Rename failed (${res.status}): ${await res.text()}`);
  }
}

function parseArgs(argv: string[]): {
  root: string;
  dryRun: boolean;
  useSharedOauth: boolean;
  useSession: boolean;
  sessionEmail: string;
} {
  let root = 'Halo_Patients';
  let dryRun = true;
  let useSharedOauth = false;
  let useSession = false;
  let sessionEmail = '';
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root' && argv[i + 1]) {
      root = argv[++i]!;
    } else if (a === '--apply') {
      dryRun = false;
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--use-shared-oauth') {
      useSharedOauth = true;
    } else if (a === '--use-session') {
      useSession = true;
    } else if (a === '--session-email' && argv[i + 1]) {
      sessionEmail = normalizeEmail(argv[++i]!);
    }
  }
  return { root, dryRun, useSharedOauth, useSession, sessionEmail };
}

async function resolveAccessToken(opts: {
  useSharedOauth: boolean;
  useSession: boolean;
  sessionEmail: string;
}): Promise<{ token: string; source: string }> {
  const manual = (process.env.RENAME_ACCESS_TOKEN || '').trim();
  if (manual) return { token: manual, source: 'RENAME_ACCESS_TOKEN' };

  if (opts.useSharedOauth) {
    const shared = await getSharedMicrosoftTokens();
    const who = shared.accountEmail ? ` (${shared.accountEmail})` : '';
    return { token: shared.accessToken, source: `shared OAuth${who}` };
  }

  if (opts.useSession) {
    if (!isSupabaseAdminConfigured()) {
      throw new Error('Supabase required for --use-session (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
    }
    const sb = getSupabaseAdminClient();
    if (!sb) throw new Error('Supabase admin client unavailable.');

    const { data, error } = await sb
      .from('session')
      .select('sess,expire')
      .gt('expire', new Date().toISOString())
      .order('expire', { ascending: false })
      .limit(50);
    if (error) throw new Error(`Could not read sessions: ${error.message}`);

    const wantEmail = opts.sessionEmail;
    for (const row of data || []) {
      const sess = row.sess as HaloSessionPayload;
      if (sess?.provider !== 'microsoft' || !sess.accessToken) continue;
      if (wantEmail) {
        const sessionMail = sess.userEmail ? normalizeEmail(sess.userEmail) : '';
        if (sessionMail && sessionMail !== wantEmail) continue;
      }
      const who = sess.userEmail ? ` (${sess.userEmail})` : '';
      return { token: sess.accessToken, source: `browser session${who}` };
    }

    throw new Error(
      wantEmail
        ? `No active Microsoft session for ${wantEmail}. Sign in to HALO as Henk, connect Microsoft OneDrive, then retry.`
        : 'No active Microsoft session found. Sign in to HALO and connect Microsoft OneDrive, then retry.'
    );
  }

  throw new Error(
    'No access token. Use RENAME_ACCESS_TOKEN, --use-shared-oauth, or --use-session (see script header).'
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const { token, source } = await resolveAccessToken(args);
  const { root, dryRun } = args;
  console.log(`Token: ${source}`);
  console.log(`Root: "${root}" | mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);

  const rootId = await findRootFolderId(token, root);
  if (!rootId) {
    console.error(`Root folder "${root}" not found in OneDrive.`);
    process.exit(1);
  }

  const folders = await listPatientFolders(token, rootId);
  const existingNames = new Set(folders.map((f) => f.name));
  let wouldRename = 0;
  let skipped = 0;

  for (const folder of folders) {
    const parsed = parseFolderString(folder.name);
    if (!parsed) {
      skipped++;
      continue;
    }
    const target = buildPatientFolderDiskName(parsed.pName, parsed.pDob, parsed.pSex);
    if (target === folder.name) continue;

    if (existingNames.has(target) && target !== folder.name) {
      console.warn(`SKIP collision: "${folder.name}" -> "${target}" (name already exists)`);
      skipped++;
      continue;
    }

    wouldRename++;
    console.log(`${dryRun ? '[dry-run]' : '[rename]'} "${folder.name}" -> "${target}"`);
    if (!dryRun) {
      await renameFolder(token, folder.id, target);
      existingNames.delete(folder.name);
      existingNames.add(target);
    }
  }

  console.log(`Done. ${wouldRename} folder(s) ${dryRun ? 'would be' : ''} renamed, ${skipped} skipped.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
