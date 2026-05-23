/**
 * Active HALO workspace (OneDrive root folder scope). Stored in localStorage only — no auth coupling.
 * Must match key used by clinical mock sheets: see getActiveWorkspaceKey in clinicalData.
 */
const STORAGE_KEY = 'halo_activeWorkspace';

export type WorkspaceInfo = {
  id: string;
  folderName: string;
  label: string;
  ownerUserId: string | null;
  isOwn: boolean;
  isDefault: boolean;
};

/** Prefer the logged-in user's workspace (Mo vs Henk). */
export function pickOwnWorkspaceId(list: WorkspaceInfo[]): string {
  const own = list.find((w) => w.isOwn);
  if (own) return own.id;
  const def = list.find((w) => w.isDefault);
  if (def) return def.id;
  return list[0]?.id ?? '';
}

export function getActiveWorkspaceId(): string {
  try {
    return (typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : '') || '';
  } catch {
    return '';
  }
}

export function setActiveWorkspaceId(id: string): void {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('halo:workspace-changed', { detail: id }));
  }
}

export function clearActiveWorkspaceId(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('halo:workspace-changed', { detail: '' }));
  }
}

/** Raw fetch — never uses api.request() (avoids 401 redirect side effects). */
export async function fetchWorkspaces(): Promise<WorkspaceInfo[]> {
  try {
    const r = await fetch('/api/workspaces', { credentials: 'include' });
    if (!r.ok) return [];
    const d = (await r.json()) as { workspaces?: WorkspaceInfo[] };
    return Array.isArray(d.workspaces) ? d.workspaces : [];
  } catch {
    return [];
  }
}
