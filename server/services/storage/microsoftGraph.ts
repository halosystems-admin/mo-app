import { config } from '../../config';
import {
  FOLDER_MIME_TYPE,
  type AdmittedPatientKanban,
  type DoctorDiaryEntry,
  type DriveFile,
  type Patient,
  type ScribeSession,
  type UserSettings,
} from '../../../shared/types';
import { refineMimeType } from '../../../shared/mimeFromFilename';
import type { MicrosoftStorageMode, StorageAdapter } from './types';
import { parseFolderString } from '../drive';

// Import the existing drive service module for its Node-side pdf-parse polyfills.
// We don't use its Google-specific network code.
import '../drive';

import mammoth from 'mammoth';

const graphBase = 'https://graph.microsoft.com/v1.0';

const MAX_FILE_SIZE_MB = 25;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const ALLOWED_UPLOAD_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

const DEFAULT_PAGE_SIZE = 50;

// Internal app file — never show in patient folder listing
const SESSIONS_FILE_NAME = 'halo_scribe_sessions.json';
const SETTINGS_FILE_NAME = 'halo_user_settings.json';

// Doctor-facing app state (stored in HALO root folder)
const DOCTOR_DIARY_FILE_NAME = 'halo_doctor_diary.json';
const DOCTOR_KANBAN_FILE_NAME = 'halo_doctor_kanban.json';

// In-memory cache for first page of file list (per folder).
const FILES_CACHE_TTL_MS = 30_000; // 30 seconds
const filesListCache = new Map<
  string,
  { files: DriveFile[]; nextPage: string | null; cachedAt: number }
>();

function invalidateFilesCacheForFolder(folderId: string): void {
  for (const key of filesListCache.keys()) {
    if (key.startsWith(`${folderId}:`)) filesListCache.delete(key);
  }
}

function getEffectiveStorageMode(mode?: MicrosoftStorageMode): MicrosoftStorageMode {
  return mode ?? 'onedrive';
}

function getDriveBase(storageMode: MicrosoftStorageMode): string {
  if (storageMode === 'onedrive') {
    return `${graphBase}/me/drive`;
  }

  if (!config.msSharePointSiteId || !config.msSharePointDriveId) {
    throw new Error('SharePoint is not configured (MS_SHAREPOINT_SITE_ID/MS_SHAREPOINT_DRIVE_ID).');
  }

  return `${graphBase}/sites/${encodeURIComponent(config.msSharePointSiteId)}/drives/${encodeURIComponent(
    config.msSharePointDriveId
  )}`;
}

async function fetchWithTimeout(
  url: string,
  token: string,
  options: RequestInit = {},
  timeoutMs = 25_000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractSkipToken(nextLink: string | undefined): string | null {
  if (!nextLink) return null;
  // nextLink is a full URL; Graph includes `$skiptoken=...`
  const match = nextLink.match(/[$&]skiptoken=([^&]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

async function listChildren({
  token,
  parentId,
  storageMode,
  pageToken,
  pageSize,
}: {
  token: string;
  parentId?: string;
  storageMode: MicrosoftStorageMode;
  pageToken?: string;
  pageSize: number;
}): Promise<{ items: any[]; nextPageToken: string | null }> {
  const driveBase = getDriveBase(storageMode);

  const endpoint = parentId
    ? `${driveBase}/items/${encodeURIComponent(parentId)}/children`
    : `${driveBase}/root/children`;

  // Note: Graph paging uses `$skiptoken` (token is opaque). We pass it through unchanged.
  // Some tenants/accounts reject `$select` on `/children` with:
  // "Select options are not supported."
  // We try the narrower query first, then fall back to no `$select`.
  const baseParams = new URLSearchParams({
    $top: String(pageSize),
  } as any);

  if (pageToken) baseParams.set('$skiptoken', pageToken);

  const selectParams = new URLSearchParams(baseParams.toString());
  selectParams.set(
    '$select',
    ['id', 'name', 'webUrl', 'createdDateTime', 'lastModifiedDateTime', 'fileSystemInfo', 'file', 'folder'].join(',')
  );

  let res = await fetchWithTimeout(`${endpoint}?${selectParams.toString()}`, token);
  if (!res.ok) {
    const firstErrorText = await res.text().catch(() => '');
    const shouldRetryWithoutSelect =
      res.status === 400 && /Select options are not supported/i.test(firstErrorText);

    if (!shouldRetryWithoutSelect) {
      throw new Error(`[Graph ${res.status}] Failed to list children: ${firstErrorText}`);
    }

    res = await fetchWithTimeout(`${endpoint}?${baseParams.toString()}`, token);
    if (!res.ok) {
      const retryErrorText = await res.text().catch(() => '');
      throw new Error(`[Graph ${res.status}] Failed to list children: ${retryErrorText}`);
    }
  }

  const data = (await res.json()) as {
    value?: any[];
    '@odata.nextLink'?: string;
  };

  return {
    items: data.value || [],
    nextPageToken: extractSkipToken(data['@odata.nextLink']),
  };
}

async function findChildFolderIdByName({
  token,
  parentFolderId,
  storageMode,
  name,
}: {
  token: string;
  parentFolderId: string;
  storageMode: MicrosoftStorageMode;
  name: string;
}): Promise<string | null> {
  let pageToken: string | undefined;
  const pageSize = 100;
  while (true) {
    const { items, nextPageToken } = await listChildren({
      token,
      parentId: parentFolderId,
      storageMode,
      pageToken,
      pageSize,
    });

    for (const item of items) {
      if (item?.name === name && item?.folder) return item.id as string;
    }

    if (!nextPageToken) break;
    pageToken = nextPageToken;
  }

  return null;
}

async function findChildFileIdByName({
  token,
  parentFolderId,
  storageMode,
  name,
}: {
  token: string;
  parentFolderId: string;
  storageMode: MicrosoftStorageMode;
  name: string;
}): Promise<string | null> {
  let pageToken: string | undefined;
  const pageSize = 100;
  while (true) {
    const { items, nextPageToken } = await listChildren({
      token,
      parentId: parentFolderId,
      storageMode,
      pageToken,
      pageSize,
    });

    for (const item of items) {
      if (item?.name === name && item?.file) return item.id as string;
    }

    if (!nextPageToken) break;
    pageToken = nextPageToken;
  }

  return null;
}

async function getOrCreateHaloRootFolderId({
  token,
  storageMode,
}: {
  token: string;
  storageMode: MicrosoftStorageMode;
}): Promise<string> {
  let pageToken: string | undefined;
  const pageSize = 100;
  while (true) {
    const { items, nextPageToken } = await listChildren({
      token,
      parentId: undefined,
      storageMode,
      pageToken,
      pageSize,
    });

    for (const item of items) {
      if (item?.name === 'Halo_Patients' && item?.folder) return item.id as string;
    }

    if (!nextPageToken) break;
    pageToken = nextPageToken;
  }

  const driveBase = getDriveBase(storageMode);
  const res = await fetchWithTimeout(`${driveBase}/root/children`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Halo_Patients', folder: {} }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[Graph ${res.status}] Failed to create Halo_Patients folder: ${text}`);
  }
  const created = (await res.json()) as { id: string };
  return created.id;
}

function toDriveFileFromItem(item: any): DriveFile {
  const isFolder = Boolean(item?.folder);
  const mimeType = isFolder ? FOLDER_MIME_TYPE : item?.file?.mimeType ?? 'application/octet-stream';
  const createdTime =
    item?.fileSystemInfo?.createdDateTime ||
    item?.createdDateTime ||
    item?.lastModifiedDateTime ||
    '';

  return {
    id: item.id as string,
    name: item.name as string,
    mimeType,
    url: item.webUrl ?? '',
    thumbnail: undefined,
    createdTime: createdTime ? String(createdTime).split('T')[0] : '',
  };
}

function parseSessionsJson(raw: unknown): ScribeSession[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .map((item): ScribeSession | null => {
      const obj = item as Partial<ScribeSession> & { notes?: unknown[] };
      if (!obj || typeof obj !== 'object') return null;
      if (
        typeof obj.id !== 'string' ||
        typeof obj.patientId !== 'string' ||
        typeof obj.createdAt !== 'string' ||
        typeof obj.transcript !== 'string'
      ) {
        return null;
      }
      const notes = Array.isArray(obj.notes)
        ? obj.notes.slice(0, 20).map((n: unknown) => {
            const o = n && typeof n === 'object' ? (n as Record<string, unknown>) : {};
            const fields = Array.isArray(o.fields)
              ? o.fields
                  .slice(0, 100)
                  .map((f: unknown) => {
                    const fo = f && typeof f === 'object' ? (f as Record<string, unknown>) : {};
                    return {
                      label: String(fo.label ?? ''),
                      body: String(fo.body ?? ''),
                    };
                  })
                  .filter((f) => f.label.length > 0)
              : undefined;
            return {
              noteId: String(o.noteId ?? ''),
              title: String(o.title ?? ''),
              content: String(o.content ?? ''),
              template_id: String(o.template_id ?? ''),
              ...(o.raw !== undefined ? { raw: o.raw } : {}),
              ...(fields && fields.length > 0 ? { fields } : {}),
            };
          })
        : undefined;

      return {
        id: obj.id,
        patientId: obj.patientId,
        createdAt: obj.createdAt,
        transcript: obj.transcript,
        context: typeof obj.context === 'string' ? obj.context : undefined,
        templates: Array.isArray(obj.templates) ? obj.templates.map(String) : undefined,
        noteTitles: Array.isArray(obj.noteTitles) ? obj.noteTitles.map(String) : undefined,
        notes,
        mainComplaint:
          typeof obj.mainComplaint === 'string' ? obj.mainComplaint.trim().slice(0, 200) : undefined,
      } as ScribeSession;
    })
    .filter((s): s is ScribeSession => s !== null);
}

async function downloadItemContentAsText({
  token,
  fileId,
  storageMode,
}: {
  token: string;
  fileId: string;
  storageMode: MicrosoftStorageMode;
}): Promise<string> {
  const driveBase = getDriveBase(storageMode);
  const res = await fetchWithTimeout(`${driveBase}/items/${encodeURIComponent(fileId)}/content`, token, {
    method: 'GET',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[Graph ${res.status}] Failed to download text: ${text}`);
  }
  return res.text();
}

async function downloadItemContentAsBuffer({
  token,
  fileId,
  storageMode,
}: {
  token: string;
  fileId: string;
  storageMode: MicrosoftStorageMode;
}): Promise<Buffer> {
  const driveBase = getDriveBase(storageMode);
  const res = await fetchWithTimeout(`${driveBase}/items/${encodeURIComponent(fileId)}/content`, token, {
    method: 'GET',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[Graph ${res.status}] Failed to download content: ${text}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function ensureFolderNameParts(name: string): Promise<string> {
  // Keep behavior close to Google: just trim; Graph doesn't support Drive appProperties anyway.
  return String(name).trim();
}

export const microsoftGraphAdapter: StorageAdapter = {
  provider: 'microsoft',

  async listPatients({
    token,
    page,
    pageSize,
    microsoftStorageMode,
  }: {
    token: string;
    page?: string;
    pageSize: number;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ patients: Patient[]; nextPage: string | null }> {
    const storageMode = getEffectiveStorageMode(microsoftStorageMode);
    const rootId = await getOrCreateHaloRootFolderId({ token, storageMode });

    const actualPageSize = Math.min(Number(pageSize) || DEFAULT_PAGE_SIZE, 100);

    let pageToken = page;
    const { items, nextPageToken } = await listChildren({
      token,
      parentId: rootId,
      storageMode,
      pageToken,
      pageSize: actualPageSize,
    });

    const patients: Patient[] = [];
    for (const item of items) {
      if (!item?.folder) continue;
      const id = item.id as string;
      const folderName = String(item.name ?? '');

      const parsed = parseFolderString(folderName);
      const name = parsed?.pName ?? folderName;
      const dob = parsed?.pDob ?? 'Unknown';
      const sex = (parsed?.pSex === 'F' ? 'F' : 'M') as 'M' | 'F';

      const createdTime =
        item?.fileSystemInfo?.createdDateTime ||
        item?.createdDateTime ||
        item?.lastModifiedDateTime ||
        '';

      patients.push({
        id,
        name,
        dob,
        sex,
        lastVisit: createdTime ? String(createdTime).split('T')[0] : '',
        webUrl: item.webUrl ?? '',
        alerts: [],
      });
    }

    return { patients, nextPage: nextPageToken };
  },

  async createPatient({
    token,
    name,
    dob,
    sex,
    microsoftStorageMode,
  }: {
    token: string;
    name: string;
    dob: string;
    sex: 'M' | 'F';
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<Patient> {
    const storageMode = getEffectiveStorageMode(microsoftStorageMode);
    const rootId = await getOrCreateHaloRootFolderId({ token, storageMode });

    const safeName = await ensureFolderNameParts(name);
    const safeDob = await ensureFolderNameParts(dob);
    const safeSex = await ensureFolderNameParts(sex);
    if (!safeName || safeName.length < 2) throw new Error('Patient name must be at least 2 characters.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDob) || Number.isNaN(Date.parse(safeDob))) {
      throw new Error('Invalid date of birth. Use YYYY-MM-DD format.');
    }
    if (safeSex !== 'M' && safeSex !== 'F') throw new Error('Sex must be M or F.');

    const folderName = `${safeName}__${safeDob}__${safeSex}`;
    const driveBase = getDriveBase(storageMode);
    const res = await fetchWithTimeout(`${driveBase}/items/${encodeURIComponent(rootId)}/children`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: folderName, folder: {} }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[Graph ${res.status}] Failed to create patient folder: ${text}`);
    }
    const created = (await res.json()) as { id: string; name: string };

    const now = new Date().toISOString().split('T')[0];
    return {
      id: created.id,
      name: safeName,
      dob: safeDob,
      sex: safeSex as 'M' | 'F',
      lastVisit: now,
      alerts: [],
    };
  },

  async updatePatient({
    token,
    patientId,
    name,
    dob,
    sex,
    microsoftStorageMode,
  }: {
    token: string;
    patientId: string;
    name?: string;
    dob?: string;
    sex?: 'M' | 'F';
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ success: true }> {
    const storageMode = getEffectiveStorageMode(microsoftStorageMode);
    const driveBase = getDriveBase(storageMode);

    // Best-effort: parse current name to fill missing fields.
    const metaRes = await fetchWithTimeout(
      `${driveBase}/items/${encodeURIComponent(patientId)}?$select=name,fileSystemInfo`,
      token
    );
    if (!metaRes.ok) throw new Error(`Failed to read patient folder (${metaRes.status}).`);
    const meta = (await metaRes.json()) as { name?: string };

    const folderName = String(meta.name ?? '');
    const parsed = parseFolderString(folderName);

    const finalName = name ?? parsed?.pName ?? 'Unknown';
    const finalDob = dob ?? parsed?.pDob ?? 'Unknown';
    const finalSex = sex ?? (parsed?.pSex ?? 'M');

    if (finalName.length < 2) throw new Error('Patient name must be at least 2 characters.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(finalDob) || Number.isNaN(Date.parse(finalDob))) {
      throw new Error('Invalid date of birth. Use YYYY-MM-DD format.');
    }
    if (finalSex !== 'M' && finalSex !== 'F') throw new Error('Sex must be M or F.');

    const newFolderName = `${finalName}__${finalDob}__${finalSex}`;
    const patchRes = await fetchWithTimeout(
      `${driveBase}/items/${encodeURIComponent(patientId)}`,
      token,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newFolderName }),
      }
    );
    if (!patchRes.ok) {
      const text = await patchRes.text().catch(() => '');
      throw new Error(`[Graph ${patchRes.status}] Failed to rename patient folder: ${text}`);
    }

    return { success: true };
  },

  async trashPatient({
    token,
    patientId,
    microsoftStorageMode,
  }: {
    token: string;
    patientId: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ success: true }> {
    const storageMode = getEffectiveStorageMode(microsoftStorageMode);
    const driveBase = getDriveBase(storageMode);

    const trashRes = await fetchWithTimeout(
      `${driveBase}/items/${encodeURIComponent(patientId)}/trash`,
      token,
      { method: 'POST' }
    );

    if (trashRes.ok) return { success: true };

    // Fallback: permanent delete
    const delRes = await fetchWithTimeout(
      `${driveBase}/items/${encodeURIComponent(patientId)}`,
      token,
      { method: 'DELETE' }
    );
    if (!delRes.ok) {
      const text = await delRes.text().catch(() => '');
      throw new Error(`[Graph ${delRes.status}] Failed to delete patient folder: ${text}`);
    }

    return { success: true };
  },

  async createFolder({
    token,
    parentFolderId,
    name,
    microsoftStorageMode,
  }: {
    token: string;
    parentFolderId: string;
    name: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<DriveFile> {
    const storageMode = getEffectiveStorageMode(microsoftStorageMode);
    const safeName = String(name).trim().replace(/[<>]/g, '').slice(0, 255);
    if (!safeName) throw new Error('Folder name is required.');

    const driveBase = getDriveBase(storageMode);
    const res = await fetchWithTimeout(`${driveBase}/items/${encodeURIComponent(parentFolderId)}/children`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: safeName, folder: {} }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[Graph ${res.status}] Failed to create folder: ${text}`);
    }

    invalidateFilesCacheForFolder(parentFolderId);

    const created = (await res.json()) as any;
    return toDriveFileFromItem(created);
  },

  async listFolderFiles({
    token,
    folderId,
    page,
    pageSize,
    microsoftStorageMode,
  }: {
    token: string;
    folderId: string;
    page?: string;
    pageSize: number;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ files: DriveFile[]; nextPage: string | null }> {
    const storageMode = getEffectiveStorageMode(microsoftStorageMode);
    const actualPageSize = Math.min(Number(pageSize) || DEFAULT_PAGE_SIZE, 100);

    // First page only: serve from cache if fresh.
    if (!page) {
      const cacheKey = `${folderId}:${actualPageSize}`;
      const cached = filesListCache.get(cacheKey);
      if (cached && Date.now() - cached.cachedAt < FILES_CACHE_TTL_MS) {
        return { files: cached.files, nextPage: cached.nextPage };
      }
    }

    const { items, nextPageToken } = await listChildren({
      token,
      parentId: folderId,
      storageMode,
      pageToken: page,
      pageSize: actualPageSize,
    });

    const files = items
      .filter((item) => item?.name !== SESSIONS_FILE_NAME)
      .map((item) => toDriveFileFromItem(item));

    if (!page) {
      const cacheKey = `${folderId}:${actualPageSize}`;
      filesListCache.set(cacheKey, { files, nextPage: nextPageToken, cachedAt: Date.now() });
      if (filesListCache.size > 50) {
        const oldest = [...filesListCache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt)[0];
        if (oldest) filesListCache.delete(oldest[0]);
      }
    }

    return { files, nextPage: nextPageToken };
  },

  async warmAndListFolderFiles({
    token,
    folderId,
    pageSize,
    microsoftStorageMode,
  }: {
    token: string;
    folderId: string;
    pageSize: number;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ files: DriveFile[]; nextPage: string | null }> {
    // Google-specific warm upload trick isn't needed for Graph.
    return this.listFolderFiles({
      token,
      folderId,
      page: undefined,
      pageSize,
      microsoftStorageMode,
    });
  },

  async uploadFile({
    token,
    parentFolderId,
    fileName,
    fileType,
    base64Data,
    microsoftStorageMode,
  }: {
    token: string;
    parentFolderId: string;
    fileName: string;
    fileType: string;
    base64Data: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<DriveFile> {
    const storageMode = getEffectiveStorageMode(microsoftStorageMode);
    const safeFileName = String(fileName).trim().replace(/[<>]/g, '').slice(0, 255);
    const safeFileType = String(fileType).trim().slice(0, 100);

    if (!safeFileName) throw new Error('File name is required.');
    if (!safeFileType || !ALLOWED_UPLOAD_TYPES.includes(safeFileType)) {
      throw new Error(`File type not allowed. Accepted: ${ALLOWED_UPLOAD_TYPES.join(', ')}`);
    }
    if (!base64Data || typeof base64Data !== 'string') {
      throw new Error('File data is required.');
    }

    const estimatedSize = Math.ceil((base64Data.length * 3) / 4);
    if (estimatedSize > MAX_FILE_SIZE_BYTES) {
      throw new Error(`File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`);
    }

    const buffer = Buffer.from(base64Data, 'base64');

    const driveBase = getDriveBase(storageMode);
    const uploadUrl = `${driveBase}/items/${encodeURIComponent(parentFolderId)}:/${encodeURIComponent(
      safeFileName
    )}:/content`;

    const res = await fetchWithTimeout(uploadUrl, token, {
      method: 'PUT',
      headers: { 'Content-Type': safeFileType },
      body: buffer,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[Graph ${res.status}] Upload failed for "${safeFileName}": ${text}`);
    }

    invalidateFilesCacheForFolder(parentFolderId);

    const created = (await res.json()) as any;
    const mimeType = created?.file?.mimeType ?? safeFileType;
    return {
      id: created.id as string,
      name: created.name as string,
      mimeType,
      url: created.webUrl ?? '',
      thumbnail: undefined,
      createdTime: created?.fileSystemInfo?.createdDateTime
        ? String(created.fileSystemInfo.createdDateTime).split('T')[0]
        : new Date().toISOString().split('T')[0],
    };
  },

  async renameFile({
    token,
    fileId,
    newName,
    microsoftStorageMode,
  }: {
    token: string;
    fileId: string;
    newName: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ success: true }> {
    const storageMode = getEffectiveStorageMode(microsoftStorageMode);
    const driveBase = getDriveBase(storageMode);
    const safeName = String(newName).trim().replace(/[<>]/g, '').slice(0, 255);
    if (!safeName) throw new Error('File name is required.');

    const res = await fetchWithTimeout(`${driveBase}/items/${encodeURIComponent(fileId)}`, token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: safeName }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[Graph ${res.status}] Failed to rename file: ${text}`);
    }

    // Invalidate caches best-effort. We don't know the parent folder id, so just clear all.
    filesListCache.clear();

    return { success: true };
  },

  async trashFile({
    token,
    fileId,
    microsoftStorageMode,
  }: {
    token: string;
    fileId: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ success: true }> {
    const storageMode = getEffectiveStorageMode(microsoftStorageMode);
    const driveBase = getDriveBase(storageMode);

    const trashRes = await fetchWithTimeout(`${driveBase}/items/${encodeURIComponent(fileId)}/trash`, token, {
      method: 'POST',
    });
    if (trashRes.ok) {
      filesListCache.clear();
      return { success: true };
    }

    // Fallback: permanent delete
    const delRes = await fetchWithTimeout(`${driveBase}/items/${encodeURIComponent(fileId)}`, token, {
      method: 'DELETE',
    });
    if (!delRes.ok) {
      const text = await delRes.text().catch(() => '');
      throw new Error(`[Graph ${delRes.status}] Failed to delete file: ${text}`);
    }

    filesListCache.clear();
    return { success: true };
  },

  async downloadFileInfo({
    token,
    fileId,
    microsoftStorageMode,
  }: {
    token: string;
    fileId: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ downloadUrl: string; viewUrl: string; name: string; mimeType: string }> {
    const storageMode = getEffectiveStorageMode(microsoftStorageMode);
    const driveBase = getDriveBase(storageMode);

    // No $select: some SharePoint/tenant drive endpoints return 400 "Select options are not supported."
    const res = await fetchWithTimeout(`${driveBase}/items/${encodeURIComponent(fileId)}`, token);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[Graph ${res.status}] Failed to load file metadata: ${text}`);
    }

    const item = (await res.json()) as any;
    return {
      downloadUrl: item['@microsoft.graph.downloadUrl'] ?? '',
      viewUrl: item.webUrl ?? '',
      name: item.name ?? '',
      mimeType: item?.file?.mimeType ?? '',
    };
  },

  async proxyFile({
    token,
    fileId,
    microsoftStorageMode,
  }: {
    token: string;
    fileId: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ mimeType: string; filename: string; data: Buffer }> {
    const storageMode = getEffectiveStorageMode(microsoftStorageMode);
    const driveBase = getDriveBase(storageMode);

    // Full item (no $select) — Graph rejects $select=file/mimeType on some drive bases.
    const metaRes = await fetchWithTimeout(`${driveBase}/items/${encodeURIComponent(fileId)}`, token);
    if (!metaRes.ok) {
      const text = await metaRes.text().catch(() => '');
      throw new Error(`[Graph ${metaRes.status}] Failed to load file metadata: ${text}`);
    }
    const meta = (await metaRes.json()) as any;
    const filename = meta.name ?? 'file';
    const mimeType = refineMimeType(meta?.file?.mimeType ?? 'application/octet-stream', filename);

    const data = await downloadItemContentAsBuffer({ token, fileId, storageMode });
    return { mimeType, filename, data };
  },

  async getPatientSessions({
    token,
    patientFolderId,
    microsoftStorageMode,
  }: {
    token: string;
    patientFolderId: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ sessions: ScribeSession[] }> {
    const storageMode = getEffectiveStorageMode(microsoftStorageMode);
    const fileId = await findChildFileIdByName({
      token,
      parentFolderId: patientFolderId,
      storageMode,
      name: SESSIONS_FILE_NAME,
    });

    if (!fileId) return { sessions: [] };

    const content = await downloadItemContentAsText({ token, fileId, storageMode });
    const raw = safeJsonParse(content);
    return { sessions: parseSessionsJson(raw) };
  },

  async savePatientSessions({
    token,
    patientFolderId,
    payload,
    microsoftStorageMode,
  }: {
    token: string;
    patientFolderId: string;
    payload: {
      sessionId?: string;
      transcript: string;
      context?: string;
      templates?: string[];
      noteTitles?: string[];
      notes?: Array<{
        noteId: string;
        title: string;
        content: string;
        template_id: string;
        raw?: unknown;
        fields?: Array<{ label: string; body: string }>;
      }>;
      mainComplaint?: string;
    };
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ sessions: ScribeSession[] }> {
    const storageMode = getEffectiveStorageMode(microsoftStorageMode);
    const fileId = await findChildFileIdByName({
      token,
      parentFolderId: patientFolderId,
      storageMode,
      name: SESSIONS_FILE_NAME,
    });

    const transcript = typeof payload.transcript === 'string' ? payload.transcript.trim().slice(0, 20000) : '';
    if (!transcript) throw new Error('transcript is required.');

    const context = typeof payload.context === 'string' ? payload.context.trim().slice(0, 5000) : undefined;
    const templates = Array.isArray(payload.templates) ? payload.templates.map(String).slice(0, 20) : undefined;
    const noteTitles = Array.isArray(payload.noteTitles) ? payload.noteTitles.map(String).slice(0, 20) : undefined;
    const notes = Array.isArray(payload.notes)
      ? payload.notes.slice(0, 20).map((n) => ({
          noteId: String(n.noteId ?? ''),
          title: String(n.title ?? ''),
          content: String(n.content ?? '').slice(0, 100000),
          template_id: String(n.template_id ?? ''),
          ...(n.raw !== undefined ? { raw: n.raw } : {}),
          ...(Array.isArray(n.fields) && n.fields.length > 0
            ? {
                fields: n.fields
                  .slice(0, 100)
                  .map((f) => ({
                    label: String(f.label ?? '').slice(0, 200),
                    body: String(f.body ?? '').slice(0, 20000),
                  }))
                  .filter((f) => f.label.length > 0),
              }
            : {}),
        }))
      : undefined;
    const mainComplaint =
      typeof payload.mainComplaint === 'string' ? payload.mainComplaint.trim().slice(0, 200) : undefined;

    const nowIso = new Date().toISOString();
    const providedId = typeof payload.sessionId === 'string' && payload.sessionId.trim() ? payload.sessionId.trim() : undefined;
    const sessionId = providedId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const newSession: ScribeSession = {
      id: sessionId,
      patientId: patientFolderId,
      createdAt: nowIso,
      transcript,
      context,
      templates,
      noteTitles,
      notes,
      mainComplaint: mainComplaint || undefined,
    };

    let sessions: ScribeSession[] = [];
    if (fileId) {
      try {
        const content = await downloadItemContentAsText({ token, fileId, storageMode });
        const raw = safeJsonParse(content);
        sessions = parseSessionsJson(raw);
      } catch {
        sessions = [];
      }
    }

    if (providedId) {
      const idx = sessions.findIndex((s) => s.id === providedId);
      if (idx >= 0) sessions[idx] = newSession;
      else sessions.push(newSession);
    } else {
      sessions.push(newSession);
    }

    if (sessions.length > 30) sessions = sessions.slice(-30);

    const content = JSON.stringify(sessions);
    const driveBase = getDriveBase(storageMode);

    if (fileId) {
      const putRes = await fetchWithTimeout(`${driveBase}/items/${encodeURIComponent(fileId)}/content`, token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(content, 'utf8'),
      });
      if (!putRes.ok) {
        const text = await putRes.text().catch(() => '');
        throw new Error(`[Graph ${putRes.status}] Failed to update sessions JSON: ${text}`);
      }
    } else {
      const uploadUrl = `${driveBase}/items/${encodeURIComponent(patientFolderId)}:/${encodeURIComponent(
        SESSIONS_FILE_NAME
      )}:/content`;
      const putRes = await fetchWithTimeout(uploadUrl, token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(content, 'utf8'),
      });
      if (!putRes.ok) {
        const text = await putRes.text().catch(() => '');
        throw new Error(`[Graph ${putRes.status}] Failed to create sessions JSON: ${text}`);
      }
    }

    return { sessions };
  },

  async getUserSettings({
    token,
    microsoftStorageMode,
  }: {
    token: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ settings: UserSettings | null }> {
    const storageMode = getEffectiveStorageMode(microsoftStorageMode);
    const rootId = await getOrCreateHaloRootFolderId({ token, storageMode });
    const fileId = await findChildFileIdByName({
      token,
      parentFolderId: rootId,
      storageMode,
      name: SETTINGS_FILE_NAME,
    });
    if (!fileId) return { settings: null };

    const content = await downloadItemContentAsText({ token, fileId, storageMode });
    const raw = safeJsonParse(content);
    return { settings: (raw as UserSettings) ?? null };
  },

  async saveUserSettings({
    token,
    settings,
    microsoftStorageMode,
  }: {
    token: string;
    settings: UserSettings;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ success: true }> {
    const storageMode = getEffectiveStorageMode(microsoftStorageMode);
    const rootId = await getOrCreateHaloRootFolderId({ token, storageMode });

    const existingFileId = await findChildFileIdByName({
      token,
      parentFolderId: rootId,
      storageMode,
      name: SETTINGS_FILE_NAME,
    });

    const content = JSON.stringify(settings);
    const driveBase = getDriveBase(storageMode);

    if (existingFileId) {
      const putRes = await fetchWithTimeout(`${driveBase}/items/${encodeURIComponent(existingFileId)}/content`, token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(content, 'utf8'),
      });
      if (!putRes.ok) {
        const text = await putRes.text().catch(() => '');
        throw new Error(`[Graph ${putRes.status}] Failed to update user settings: ${text}`);
      }
    } else {
      const uploadUrl = `${driveBase}/items/${encodeURIComponent(rootId)}:/${encodeURIComponent(SETTINGS_FILE_NAME)}:/content`;
      const putRes = await fetchWithTimeout(uploadUrl, token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(content, 'utf8'),
      });
      if (!putRes.ok) {
        const text = await putRes.text().catch(() => '');
        throw new Error(`[Graph ${putRes.status}] Failed to create user settings: ${text}`);
      }
    }

    return { success: true };
  },

  async getDoctorDiary({
    token,
    microsoftStorageMode,
  }: {
    token: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ entries: DoctorDiaryEntry[] }> {
    const storageMode = getEffectiveStorageMode(microsoftStorageMode);
    const rootId = await getOrCreateHaloRootFolderId({ token, storageMode });
    const fileId = await findChildFileIdByName({
      token,
      parentFolderId: rootId,
      storageMode,
      name: DOCTOR_DIARY_FILE_NAME,
    });

    if (!fileId) return { entries: [] };

    const content = await downloadItemContentAsText({ token, fileId, storageMode });
    const raw = safeJsonParse(content) as unknown;

    const entries = Array.isArray(raw)
      ? raw
      : (raw && typeof raw === 'object' && 'entries' in (raw as any))
        ? (raw as any).entries
        : [];

    const safe = (entries as unknown[]).filter((e) => e && typeof e === 'object') as DoctorDiaryEntry[];
    return { entries: safe };
  },

  async saveDoctorDiary({
    token,
    entries,
    microsoftStorageMode,
  }: {
    token: string;
    entries: DoctorDiaryEntry[];
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ success: true }> {
    const storageMode = getEffectiveStorageMode(microsoftStorageMode);
    const rootId = await getOrCreateHaloRootFolderId({ token, storageMode });

    const existingFileId = await findChildFileIdByName({
      token,
      parentFolderId: rootId,
      storageMode,
      name: DOCTOR_DIARY_FILE_NAME,
    });

    const content = JSON.stringify(entries);
    const driveBase = getDriveBase(storageMode);

    if (existingFileId) {
      const putRes = await fetchWithTimeout(`${driveBase}/items/${encodeURIComponent(existingFileId)}/content`, token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(content, 'utf8'),
      });
      if (!putRes.ok) {
        const text = await putRes.text().catch(() => '');
        throw new Error(`[Graph ${putRes.status}] Failed to update doctor diary: ${text}`);
      }
    } else {
      const uploadUrl = `${driveBase}/items/${encodeURIComponent(rootId)}:/${encodeURIComponent(DOCTOR_DIARY_FILE_NAME)}:/content`;
      const putRes = await fetchWithTimeout(uploadUrl, token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(content, 'utf8'),
      });
      if (!putRes.ok) {
        const text = await putRes.text().catch(() => '');
        throw new Error(`[Graph ${putRes.status}] Failed to create doctor diary: ${text}`);
      }
    }

    return { success: true };
  },

  async getDoctorKanban({
    token,
    microsoftStorageMode,
  }: {
    token: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ kanban: AdmittedPatientKanban[] }> {
    const storageMode = getEffectiveStorageMode(microsoftStorageMode);
    const rootId = await getOrCreateHaloRootFolderId({ token, storageMode });
    const fileId = await findChildFileIdByName({
      token,
      parentFolderId: rootId,
      storageMode,
      name: DOCTOR_KANBAN_FILE_NAME,
    });

    if (!fileId) return { kanban: [] };

    const content = await downloadItemContentAsText({ token, fileId, storageMode });
    const raw = safeJsonParse(content) as unknown;

    const kanban = Array.isArray(raw)
      ? raw
      : (raw && typeof raw === 'object' && 'kanban' in (raw as any))
        ? (raw as any).kanban
        : [];

    const safe = (kanban as unknown[]).filter((p) => p && typeof p === 'object') as AdmittedPatientKanban[];
    return { kanban: safe };
  },

  async saveDoctorKanban({
    token,
    kanban,
    microsoftStorageMode,
  }: {
    token: string;
    kanban: AdmittedPatientKanban[];
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ success: true }> {
    const storageMode = getEffectiveStorageMode(microsoftStorageMode);
    const rootId = await getOrCreateHaloRootFolderId({ token, storageMode });

    const existingFileId = await findChildFileIdByName({
      token,
      parentFolderId: rootId,
      storageMode,
      name: DOCTOR_KANBAN_FILE_NAME,
    });

    const content = JSON.stringify(kanban);
    const driveBase = getDriveBase(storageMode);

    if (existingFileId) {
      const putRes = await fetchWithTimeout(`${driveBase}/items/${encodeURIComponent(existingFileId)}/content`, token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(content, 'utf8'),
      });
      if (!putRes.ok) {
        const text = await putRes.text().catch(() => '');
        throw new Error(`[Graph ${putRes.status}] Failed to update doctor kanban: ${text}`);
      }
    } else {
      const uploadUrl = `${driveBase}/items/${encodeURIComponent(rootId)}:/${encodeURIComponent(DOCTOR_KANBAN_FILE_NAME)}:/content`;
      const putRes = await fetchWithTimeout(uploadUrl, token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(content, 'utf8'),
      });
      if (!putRes.ok) {
        const text = await putRes.text().catch(() => '');
        throw new Error(`[Graph ${putRes.status}] Failed to create doctor kanban: ${text}`);
      }
    }

    return { success: true };
  },

  async getOrCreatePatientNotesFolder({
    token,
    patientFolderId,
    microsoftStorageMode,
  }: {
    token: string;
    patientFolderId: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<string> {
    const storageMode = getEffectiveStorageMode(microsoftStorageMode);
    const existingId = await findChildFolderIdByName({
      token,
      parentFolderId: patientFolderId,
      storageMode,
      name: 'Patient Notes',
    });
    if (existingId) return existingId;

    const driveBase = getDriveBase(storageMode);
    const res = await fetchWithTimeout(`${driveBase}/items/${encodeURIComponent(patientFolderId)}/children`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Patient Notes', folder: {} }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[Graph ${res.status}] Failed to create Patient Notes folder: ${text}`);
    }
    const created = (await res.json()) as { id: string };
    return created.id;
  },

  async fetchAllFilesInFolder({
    token,
    folderId,
    microsoftStorageMode,
  }: {
    token: string;
    folderId: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<Array<{ id: string; name: string; mimeType: string }>> {
    const storageMode = getEffectiveStorageMode(microsoftStorageMode);
    const allFiles: Array<{ id: string; name: string; mimeType: string }> = [];

    async function walk(currentFolderId: string) {
      let pageToken: string | undefined;
      while (true) {
        const { items, nextPageToken } = await listChildren({
          token,
          parentId: currentFolderId,
          storageMode,
          pageToken,
          pageSize: 100,
        });

        for (const item of items) {
          if (item?.name === SESSIONS_FILE_NAME) continue;
          const isFolder = Boolean(item?.folder);
          allFiles.push({
            id: item.id as string,
            name: item.name as string,
            mimeType: isFolder ? FOLDER_MIME_TYPE : item?.file?.mimeType ?? 'application/octet-stream',
          });
          if (isFolder) await walk(item.id as string);
        }

        if (!nextPageToken) break;
        pageToken = nextPageToken;
      }
    }

    await walk(folderId);
    return allFiles;
  },

  async extractTextFromFile({
    token,
    file,
    maxChars,
    microsoftStorageMode,
  }: {
    token: string;
    file: { id: string; name: string; mimeType: string };
    maxChars?: number;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<string> {
    const storageMode = getEffectiveStorageMode(microsoftStorageMode);
    const max = maxChars ?? 2000;
    try {
      const name = file.name ?? '';
      const mimeType = file.mimeType ?? '';

      // Text
      if (
        mimeType === 'text/plain' ||
        mimeType === 'text/csv' ||
        name.toLowerCase().endsWith('.txt') ||
        name.toLowerCase().endsWith('.csv')
      ) {
        const text = await downloadItemContentAsText({ token, fileId: file.id, storageMode });
        return text.substring(0, max);
      }

      // PDFs
      if (mimeType === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
        const buffer = await downloadItemContentAsBuffer({ token, fileId: file.id, storageMode });
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: new Uint8Array(buffer) });
        const result = await parser.getText();
        await parser.destroy();
        return (result.text || '').substring(0, max);
      }

      // Word
      if (
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mimeType === 'application/msword' ||
        name.toLowerCase().endsWith('.docx') ||
        name.toLowerCase().endsWith('.doc')
      ) {
        const buffer = await downloadItemContentAsBuffer({ token, fileId: file.id, storageMode });
        const result = await mammoth.extractRawText({ buffer });
        return (result.value || '').substring(0, max);
      }

      return '';
    } catch (err) {
      console.error('[extractTextFromFile/ms] Failed for', file.name, err);
      return '';
    }
  },
};

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

