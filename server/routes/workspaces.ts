import { Router, Request, Response } from 'express';
import { requireUser } from '../middleware/requireUser';
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from '../services/supabaseAdmin';

const router = Router();
router.use(requireUser);

const DEFAULT_FOLDER_NAME = 'Halo_Patients';

function slugWorkspaceId(folderName: string): string {
  return folderName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'workspace';
}

function doctorLabel(firstName: string, lastName: string, fallback: string): string {
  const f = (firstName || '').trim();
  const l = (lastName || '').trim();
  if (!f && !l) return fallback;
  /** Formal display for Mo's account when DB stores nickname "Mo". */
  if (f.toLowerCase() === 'mo' && l.toLowerCase() === 'patel') return 'Dr Mohamed Patel';
  const initial = f ? f[0]!.toUpperCase() : '';
  const last = l || fallback;
  return `Dr ${[initial, last].filter(Boolean).join(' ')}`.trim();
}

router.get('/', async (req: Request, res: Response) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      res.json({
        workspaces: [
          {
            id: slugWorkspaceId(DEFAULT_FOLDER_NAME),
            folderName: DEFAULT_FOLDER_NAME,
            label: DEFAULT_FOLDER_NAME,
            ownerUserId: null,
            isOwn: true,
            isDefault: true,
          },
        ],
      });
      return;
    }

    const sb = getSupabaseAdminClient();
    if (!sb) {
      res.json({ workspaces: [] });
      return;
    }

    const { data } = await sb
      .from('app_users')
      .select('id,first_name,last_name,drive_root_folder_name')
      .eq('is_active', true)
      .returns<
        Array<{
          id: string;
          first_name: string;
          last_name: string;
          drive_root_folder_name: string | null;
        }>
      >();

    const rows = Array.isArray(data) ? data : [];
    const known = rows
      .map((u) => {
        const folderName = (u.drive_root_folder_name || '').trim();
        if (!folderName) return null;
        const label = doctorLabel(u.first_name, u.last_name, folderName);
        return {
          id: slugWorkspaceId(folderName),
          folderName,
          label,
          ownerUserId: u.id,
          isOwn: u.id === req.appUser?.id,
          isDefault: folderName === (req.appUser?.driveRootFolderName || DEFAULT_FOLDER_NAME),
        };
      })
      .filter(Boolean) as Array<{
      id: string;
      folderName: string;
      label: string;
      ownerUserId: string | null;
      isOwn: boolean;
      isDefault: boolean;
    }>;

    const hasDefault = known.some((w) => w.folderName === DEFAULT_FOLDER_NAME);
    const all = hasDefault
      ? known
      : [
          {
            id: slugWorkspaceId(DEFAULT_FOLDER_NAME),
            folderName: DEFAULT_FOLDER_NAME,
            label: 'Dr Mohamed Patel',
            ownerUserId: null,
            isOwn: (req.appUser?.driveRootFolderName || DEFAULT_FOLDER_NAME) === DEFAULT_FOLDER_NAME,
            isDefault: (req.appUser?.driveRootFolderName || DEFAULT_FOLDER_NAME) === DEFAULT_FOLDER_NAME,
          },
          ...known,
        ];

    res.json({ workspaces: all });
  } catch (err) {
    console.error('[workspaces] list error:', err);
    res.json({ workspaces: [] });
  }
});

export default router;

