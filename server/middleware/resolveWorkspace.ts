import type { NextFunction, Request, Response } from 'express';
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from '../services/supabaseAdmin';

declare module 'express-serve-static-core' {
  interface Request {
    workspaceFolderName?: string;
    workspaceId?: string;
  }
}

const DEFAULT_FOLDER_NAME = 'Halo_Patients';

function slugWorkspaceId(folderName: string): string {
  return folderName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'workspace';
}

type WorkspaceRow = { drive_root_folder_name: string | null };

let cached: { at: number; folderNames: string[] } | null = null;
const CACHE_MS = 30_000;

async function listKnownFolderNames(): Promise<string[]> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.folderNames;

  if (!isSupabaseAdminConfigured()) return [DEFAULT_FOLDER_NAME];
  const sb = getSupabaseAdminClient();
  if (!sb) return [DEFAULT_FOLDER_NAME];

  const { data } = await sb
    .from('app_users')
    .select('drive_root_folder_name')
    .not('drive_root_folder_name', 'is', null)
    .returns<WorkspaceRow[]>();

  const names = [
    DEFAULT_FOLDER_NAME,
    ...((data || [])
      .map((r) => String(r.drive_root_folder_name || '').trim())
      .filter(Boolean)),
  ];

  const deduped = Array.from(new Set(names));
  cached = { at: now, folderNames: deduped };
  return deduped;
}

/**
 * Resolve the active workspace per request.
 *
 * Never blocks auth and never returns 401/403. Unknown/missing workspace falls back silently.
 */
export async function resolveWorkspace(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const requested = String(req.header('x-halo-workspace') || '').trim();

  const userDefault = req.appUser?.driveRootFolderName?.trim() || DEFAULT_FOLDER_NAME;
  let folderName = userDefault;

  if (requested) {
    try {
      const known = await listKnownFolderNames();
      const match =
        known.find((n) => slugWorkspaceId(n) === requested) ||
        known.find((n) => n.toLowerCase() === requested.toLowerCase());
      if (match) folderName = match;
    } catch {
      // ignore and fall back
    }
  }

  req.workspaceFolderName = folderName;
  req.workspaceId = slugWorkspaceId(folderName);
  next();
}

