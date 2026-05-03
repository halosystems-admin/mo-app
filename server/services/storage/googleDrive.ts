import { config } from '../../config';
import { refineMimeType } from '../../../shared/mimeFromFilename';
import type {
  AdmittedPatientKanban,
  DoctorDiaryEntry,
  DriveFile,
  HaloPatientProfile,
  Patient,
  ScribeSession,
  UserSettings,
} from '../../../shared/types';
import { FOLDER_MIME_TYPE } from '../../../shared/types';
import { parseHaloPatientProfileJson } from '../../../shared/haloPatientProfileParse';
import type { MicrosoftStorageMode, StorageAdapter, StorageProvider } from './types';
import {
  driveRequest,
  extractTextFromFile,
  fetchAllFilesInFolder,
  fetchWithTimeout,
  getHaloRootFolder,
  getOrCreatePatientNotesFolder,
  isValidDate,
  isValidSex,
  parseFolderString,
  parsePatientFolder,
  sanitizeString,
  downloadFileBuffer,
  uploadToDrive,
} from '../drive';

const provider: StorageProvider = 'google';

/** Large photos / PDF proxy; Drive can be slow for big binaries. */
const PROXY_MEDIA_TIMEOUT_MS = 120_000;

/** GET file metadata without application/json Content-Type (matches Drive examples; avoids rare proxy rejections). */
async function driveGetFileMetaForProxy(
  token: string,
  fileId: string
): Promise<{ name?: string; mimeType?: string; shortcutDetails?: { targetId?: string } }> {
  const url = `${config.driveApi}/files/${encodeURIComponent(fileId)}?fields=name,mimeType,shortcutDetails&supportsAllDrives=true`;
  const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } }, 25_000);
  const data = (await res.json()) as { error?: { message?: string }; name?: string; mimeType?: string; shortcutDetails?: { targetId?: string } };
  if (!res.ok) {
    const msg = data.error?.message || `Drive API error ${res.status}`;
    throw new Error(`[Drive ${res.status}] ${msg}`);
  }
  return data;
}

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

// Doctor-facing app state (stored in HALO root folder)
const DOCTOR_DIARY_FILE_NAME = 'halo_doctor_diary.json';
const DOCTOR_KANBAN_FILE_NAME = 'halo_doctor_kanban.json';
const HALO_PATIENT_PROFILE_FILE = 'HALO_patient_profile.json';
const MOTIVATION_TEMPLATE_DOCX = 'motivational_template.docx';
const MOTIVATION_TEMPLATE_FOLDER = 'Templates';

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

export const googleDriveAdapter: StorageAdapter = {
  provider,

  async listPatients({ token, page, pageSize }: { token: string; page?: string; pageSize: number }): Promise<{
    patients: Patient[];
    nextPage: string | null;
  }> {
    const rootId = await getHaloRootFolder(token);

    const actualPageSize = Math.min(pageSize || DEFAULT_PAGE_SIZE, 100);
    const pageToken = page;

    let url = `/files?q=${encodeURIComponent(
      `'${rootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    )}&fields=files(id,name,appProperties,createdTime,webViewLink),nextPageToken&pageSize=${actualPageSize}`;

    if (pageToken) {
      url += `&pageToken=${encodeURIComponent(pageToken)}`;
    }

    const data = await driveRequest(token, url);
    const patients: Patient[] = (data.files || []).map((f: any) => {
      const p = parsePatientFolder(f);
      const sex: 'M' | 'F' = p.sex === 'F' ? 'F' : 'M';
      return { ...p, sex, webUrl: f.webViewLink ?? '' };
    });

    // Auto-heal: update appProperties if folder name was changed in Drive
    for (const f of data.files || []) {
      if (!f.name.includes('__')) continue;
      const parsed = parseFolderString(f.name);
      if (!parsed) continue;
      const storedName = f.appProperties?.patientName;
      const storedDob = f.appProperties?.patientDob;
      const storedSex = f.appProperties?.patientSex;
      if (parsed.pName !== storedName || parsed.pDob !== storedDob || parsed.pSex !== storedSex) {
        fetch(`${config.driveApi}/files/${f.id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            appProperties: {
              patientName: parsed.pName,
              patientDob: parsed.pDob,
              patientSex: parsed.pSex,
            },
          }),
        }).catch(() => {});
      }
    }

    return { patients, nextPage: data.nextPageToken || null };
  },

  async createPatient({
    token,
    name,
    dob,
    sex,
  }: {
    token: string;
    name: string;
    dob: string;
    sex: 'M' | 'F';
  }): Promise<Patient> {
    const finalName = sanitizeString(name);
    const finalDob = sanitizeString(dob);
    const finalSex = sanitizeString(sex);

    if (!finalName || finalName.length < 2) {
      throw new Error('Patient name must be at least 2 characters.');
    }
    if (!finalDob || !isValidDate(finalDob)) {
      throw new Error('Invalid date of birth. Use YYYY-MM-DD format.');
    }
    if (!isValidSex(finalSex)) {
      throw new Error('Sex must be M or F.');
    }

    const rootId = await getHaloRootFolder(token);

    const createRes = await fetch(`${config.driveApi}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `${finalName}__${finalDob}__${finalSex}`,
        parents: [rootId],
        mimeType: 'application/vnd.google-apps.folder',
        appProperties: {
          type: 'patient_folder',
          patientName: finalName,
          patientDob: finalDob,
          patientSex: finalSex,
        },
      }),
    });

    if (!createRes.ok) {
      throw new Error(`[Drive ${createRes.status}] Failed to create patient folder.`);
    }

    const folder = (await createRes.json()) as { id: string };
    return {
      id: folder.id,
      name: finalName,
      dob: finalDob,
      sex: finalSex,
      lastVisit: new Date().toISOString().split('T')[0],
      alerts: [],
    };
  },

  async updatePatient({
    token,
    patientId,
    name,
    dob,
    sex,
  }: {
    token: string;
    patientId: string;
    name?: string;
    dob?: string;
    sex?: 'M' | 'F';
  }): Promise<{ success: true }> {
    const current = await driveRequest(token, `/files/${patientId}?fields=name,appProperties`);

    let currentName = current.appProperties?.patientName;
    let currentDob = current.appProperties?.patientDob;
    let currentSex = current.appProperties?.patientSex;

    const needsParsing = !currentName || currentName === 'Unknown' || currentName?.includes('_');
    if (needsParsing && current.name?.includes('__')) {
      const parsed = parseFolderString(current.name);
      if (parsed) {
        currentName = parsed.pName;
        currentDob = parsed.pDob;
        currentSex = parsed.pSex;
      }
    }

    const finalName = name ? sanitizeString(name) : currentName || 'Unknown';
    const finalDob = dob ? sanitizeString(dob) : currentDob || 'Unknown';
    const finalSex = sex ? sanitizeString(sex) : (currentSex || 'M');

    if (finalName && finalName.length < 2) {
      throw new Error('Patient name must be at least 2 characters.');
    }
    if (finalDob && !isValidDate(finalDob)) {
      throw new Error('Invalid date of birth. Use YYYY-MM-DD format.');
    }
    if (!isValidSex(finalSex)) {
      throw new Error('Sex must be M or F.');
    }

    const patchRes = await fetch(`${config.driveApi}/files/${patientId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `${finalName}__${finalDob}__${finalSex}`,
        appProperties: {
          patientName: finalName,
          patientDob: finalDob,
          patientSex: finalSex,
        },
      }),
    });

    if (!patchRes.ok) {
      throw new Error(`[Drive ${patchRes.status}] Failed to update patient folder.`);
    }

    return { success: true };
  },

  async trashPatient({ token, patientId }: { token: string; patientId: string }): Promise<{ success: true }> {
    const res = await fetch(`${config.driveApi}/files/${patientId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });

    if (!res.ok) {
      throw new Error(`[Drive ${res.status}] Failed to delete patient folder.`);
    }
    return { success: true };
  },

  async createFolder({
    token,
    parentFolderId,
    name,
  }: {
    token: string;
    parentFolderId: string;
    name: string;
  }): Promise<DriveFile> {
    const safeName = sanitizeString(name, 255);
    if (!safeName || safeName.length < 1) {
      throw new Error('Folder name is required.');
    }

    const createRes = await fetch(`${config.driveApi}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: safeName,
        parents: [parentFolderId],
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });

    if (!createRes.ok) {
      throw new Error(`[Drive ${createRes.status}] Failed to create folder.`);
    }

    const folder = (await createRes.json()) as {
      id: string;
      name: string;
      mimeType: string;
      createdTime?: string;
    };

    invalidateFilesCacheForFolder(parentFolderId);

    return {
      id: folder.id,
      name: folder.name,
      mimeType: folder.mimeType,
      url: '',
      createdTime: folder.createdTime?.split('T')[0] ?? new Date().toISOString().split('T')[0],
    };
  },

  async listFolderFiles({
    token,
    folderId,
    page,
    pageSize,
  }: {
    token: string;
    folderId: string;
    page?: string;
    pageSize: number;
  }): Promise<{ files: DriveFile[]; nextPage: string | null }> {
    const actualPageSize = Math.min(Number(pageSize) || DEFAULT_PAGE_SIZE, 100);
    const pageToken = page;

    // First page only: serve from cache if fresh
    if (!pageToken) {
      const cacheKey = `${folderId}:${actualPageSize}`;
      const cached = filesListCache.get(cacheKey);
      if (cached && Date.now() - cached.cachedAt < FILES_CACHE_TTL_MS) {
        return { files: cached.files, nextPage: cached.nextPage };
      }
    }

    let url = `/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}` +
      `&fields=files(id,name,mimeType,webViewLink,createdTime),nextPageToken&pageSize=${actualPageSize}`;

    if (pageToken) {
      url += `&pageToken=${encodeURIComponent(pageToken)}`;
    }

    const data = await driveRequest(token, url);

    const files = (data.files || [])
      .filter((f) => f.name !== SESSIONS_FILE_NAME)
      .map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        url: f.webViewLink ?? '',
        thumbnail: undefined,
        createdTime: f.createdTime?.split('T')[0] ?? '',
      }));

    if (!pageToken) {
      const cacheKey = `${folderId}:${actualPageSize}`;
      filesListCache.set(cacheKey, { files, nextPage: data.nextPageToken || null, cachedAt: Date.now() });
      if (filesListCache.size > 50) {
        const oldest = [...filesListCache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt)[0];
        if (oldest) filesListCache.delete(oldest[0]);
      }
    }

    return { files, nextPage: data.nextPageToken || null };
  },

  async warmAndListFolderFiles({
    token,
    folderId,
    pageSize,
  }: {
    token: string;
    folderId: string;
    pageSize: number;
  }): Promise<{ files: DriveFile[]; nextPage: string | null }> {
    const actualPageSize = Math.min(Number(pageSize) || DEFAULT_PAGE_SIZE, 100);

    // Timeout for warm upload — if it hangs, we fall back to direct list.
    const WARM_UPLOAD_TIMEOUT_MS = 12_000;
    const listUrl = `/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}` +
      `&fields=files(id,name,mimeType,webViewLink,createdTime),nextPageToken&pageSize=${actualPageSize}`;

    let tempFileId: string | null = null;

    try {
      const warmFileName = `.halo-warm-${Date.now()}.tmp`;
      const warmContentBase64 = Buffer.from(' ', 'utf8').toString('base64');
      const boundary = 'halo_warm_boundary';
      const metadata = { name: warmFileName, parents: [folderId], mimeType: 'text/plain' };
      const multipartBody = Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
          `--${boundary}\r\nContent-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\n${warmContentBase64}\r\n` +
          `--${boundary}--`
      );

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), WARM_UPLOAD_TIMEOUT_MS);

      const uploadRes = await fetch(`${config.uploadApi}/files?uploadType=multipart`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
      });

      clearTimeout(timeoutId);

      if (uploadRes.ok) {
        const created = (await uploadRes.json()) as { id: string };
        tempFileId = created.id;
      }
    } catch (warmErr) {
      // Warm upload failed or timed out — fall through to direct list.
      void warmErr;
    }

    const data = await driveRequest(token, listUrl);

    if (tempFileId) {
      fetch(`${config.driveApi}/files/${tempFileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }

    const rawFiles = (data.files || []).filter(
      (f) =>
        f.name !== SESSIONS_FILE_NAME &&
        !(f.name.startsWith('.halo-warm-') && f.name.endsWith('.tmp'))
    );

    const files = rawFiles.map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      url: f.webViewLink ?? '',
      thumbnail: undefined,
      createdTime: f.createdTime?.split('T')[0] ?? '',
    }));

    const nextPage = data.nextPageToken || null;
    const cacheKey = `${folderId}:${actualPageSize}`;
    filesListCache.set(cacheKey, { files, nextPage, cachedAt: Date.now() });
    if (filesListCache.size > 50) {
      const oldest = [...filesListCache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt)[0];
      if (oldest) filesListCache.delete(oldest[0]);
    }

    return { files, nextPage };
  },

  async uploadFile({
    token,
    parentFolderId,
    fileName,
    fileType,
    base64Data,
  }: {
    token: string;
    parentFolderId: string;
    fileName: string;
    fileType: string;
    base64Data: string;
  }): Promise<DriveFile> {
    const safeFileName = sanitizeString(fileName, 255);
    const safeFileType = sanitizeString(fileType, 100);

    if (!safeFileName) {
      throw new Error('File name is required.');
    }
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

    const fileId = await uploadToDrive(token, safeFileName, safeFileType, parentFolderId, buffer);
    invalidateFilesCacheForFolder(parentFolderId);

    const meta = await driveRequest(token, `/files/${fileId}?fields=name,mimeType,webViewLink,createdTime`);
    const resolvedName = meta.name ?? safeFileName;

    return {
      id: fileId,
      name: resolvedName,
      mimeType: refineMimeType(meta.mimeType ?? safeFileType, resolvedName),
      url: meta.webViewLink ?? '',
      createdTime: meta.createdTime?.split('T')[0] ?? new Date().toISOString().split('T')[0],
    };
  },

  async renameFile({
    token,
    fileId,
    newName,
  }: {
    token: string;
    fileId: string;
    newName: string;
  }): Promise<{ success: true }> {
    const safeName = sanitizeString(newName, 255);
    if (!safeName) {
      throw new Error('File name is required.');
    }

    const res = await fetch(`${config.driveApi}/files/${fileId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: safeName }),
    });

    if (!res.ok) {
      throw new Error(`[Drive ${res.status}] Failed to update file.`);
    }

    return { success: true };
  },

  async trashFile({ token, fileId }: { token: string; fileId: string }): Promise<{ success: true }> {
    const res = await fetch(`${config.driveApi}/files/${fileId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });

    if (!res.ok) {
      throw new Error(`[Drive ${res.status}] Failed to delete file.`);
    }

    return { success: true };
  },

  async downloadFileInfo({
    token,
    fileId,
  }: {
    token: string;
    fileId: string;
  }) : Promise<{
    downloadUrl: string;
    viewUrl: string;
    name: string;
    mimeType: string;
  }> {
    const data = await driveRequest(token, `/files/${fileId}?fields=webContentLink,webViewLink,name,mimeType`);
    const rec = data as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    return {
      downloadUrl: str(rec.webContentLink),
      viewUrl: str(rec.webViewLink),
      name: str(rec.name),
      mimeType: str(rec.mimeType),
    };
  },

  async proxyFile({
    token,
    fileId,
  }: {
    token: string;
    fileId: string;
  }) : Promise<{ mimeType: string; filename: string; data: Buffer }> {
    const trimmedId = fileId.trim();
    if (!trimmedId) {
      throw new Error('Invalid file id');
    }

    // Resolve shortcut → target (up to a few hops). Use supportsAllDrives for team/shared drives.
    let resolvedId = trimmedId;
    for (let i = 0; i < 6; i++) {
      const meta = await driveGetFileMetaForProxy(token, resolvedId);
      const rawMime = typeof meta.mimeType === 'string' ? meta.mimeType : '';
      if (rawMime === 'application/vnd.google-apps.shortcut') {
        const details = (meta as { shortcutDetails?: { targetId?: string } }).shortcutDetails;
        const targetId = details?.targetId?.trim();
        if (!targetId) {
          throw new Error('Drive shortcut has no target file');
        }
        resolvedId = targetId;
        continue;
      }
      const name = meta.name ?? 'file';
      const mimeType = refineMimeType(meta.mimeType ?? 'application/octet-stream', name);

      let contentResponse: globalThis.Response;
      const authHeader = { Authorization: `Bearer ${token}` };
      const sd = 'supportsAllDrives=true';

      // Google Workspace files need export, not direct download.
      if (mimeType === 'application/vnd.google-apps.document') {
        contentResponse = await fetchWithTimeout(
          `${config.driveApi}/files/${encodeURIComponent(resolvedId)}/export?mimeType=application/pdf&${sd}`,
          { headers: authHeader },
          PROXY_MEDIA_TIMEOUT_MS
        );
        if (!contentResponse.ok) {
          throw new Error(`Failed to export Google Doc (${contentResponse.status})`);
        }
        const arrayBuffer = await contentResponse.arrayBuffer();
        return { mimeType: 'application/pdf', filename: name, data: Buffer.from(arrayBuffer) };
      }

      if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        contentResponse = await fetchWithTimeout(
          `${config.driveApi}/files/${encodeURIComponent(resolvedId)}/export?mimeType=application/pdf&${sd}`,
          { headers: authHeader },
          PROXY_MEDIA_TIMEOUT_MS
        );
        if (!contentResponse.ok) {
          throw new Error(`Failed to export Google Sheet (${contentResponse.status})`);
        }
        const arrayBuffer = await contentResponse.arrayBuffer();
        return { mimeType: 'application/pdf', filename: name, data: Buffer.from(arrayBuffer) };
      }

      if (mimeType === 'application/vnd.google-apps.presentation') {
        contentResponse = await fetchWithTimeout(
          `${config.driveApi}/files/${encodeURIComponent(resolvedId)}/export?mimeType=application/pdf&${sd}`,
          { headers: authHeader },
          PROXY_MEDIA_TIMEOUT_MS
        );
        if (!contentResponse.ok) {
          throw new Error(`Failed to export Google Slides (${contentResponse.status})`);
        }
        const arrayBuffer = await contentResponse.arrayBuffer();
        return { mimeType: 'application/pdf', filename: name, data: Buffer.from(arrayBuffer) };
      }

      contentResponse = await fetchWithTimeout(
        `${config.driveApi}/files/${encodeURIComponent(resolvedId)}?alt=media&${sd}`,
        { headers: authHeader },
        PROXY_MEDIA_TIMEOUT_MS
      );

      if (!contentResponse.ok) {
        const errText = await contentResponse.text().catch(() => '');
        throw new Error(`Failed to fetch file content (${contentResponse.status}) ${errText.slice(0, 200)}`);
      }

      const arrayBuffer = await contentResponse.arrayBuffer();
      return { mimeType, filename: name, data: Buffer.from(arrayBuffer) };
    }

    throw new Error('Too many shortcut hops');
  },

  async getPatientSessions({
    token,
    patientFolderId,
  }: {
    token: string;
    patientFolderId: string;
  }): Promise<{ sessions: ScribeSession[] }> {
    const query = encodeURIComponent(
      `'${patientFolderId}' in parents and name='${SESSIONS_FILE_NAME}' and mimeType='application/json' and trashed=false`
    );
    const data = await driveRequest(token, `/files?q=${query}&fields=files(id)`);
    const fileId = data.files?.[0]?.id;

    if (!fileId) return { sessions: [] };

    const dlRes = await fetch(`${config.driveApi}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!dlRes.ok) {
      throw new Error(`Failed to load sessions (${dlRes.status}).`);
    }

    const raw = (await dlRes.json()) as unknown;
    return { sessions: parseSessionsJson(raw) };
  },

  async savePatientSessions({
    token,
    patientFolderId,
    payload,
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
  }): Promise<{ sessions: ScribeSession[] }> {
    const transcript = typeof payload.transcript === 'string' ? payload.transcript.trim().slice(0, 20000) : '';
    if (!transcript) {
      throw new Error('transcript is required.');
    }

    const context =
      typeof payload.context === 'string' ? payload.context.trim().slice(0, 5000) : undefined;
    const templates =
      Array.isArray(payload.templates) ? payload.templates.map(String).slice(0, 20) : undefined;
    const noteTitles =
      Array.isArray(payload.noteTitles) ? payload.noteTitles.map(String).slice(0, 20) : undefined;

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

    const existingFileId = await findSessionsFile(token, patientFolderId);
    let sessions: ScribeSession[] = [];

    if (existingFileId) {
      try {
        const dlRes = await fetch(`${config.driveApi}/files/${existingFileId}?alt=media`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (dlRes.ok) {
          const raw = (await dlRes.json()) as unknown;
          sessions = parseSessionsJson(raw);
        }
      } catch {
        // Best-effort; start fresh.
      }
    }

    if (providedId) {
      const idx = sessions.findIndex((s) => s.id === providedId);
      if (idx >= 0) {
        sessions[idx] = newSession;
      } else {
        sessions.push(newSession);
      }
    } else {
      sessions.push(newSession);
    }

    if (sessions.length > 30) {
      sessions = sessions.slice(-30);
    }

    const content = JSON.stringify(sessions);

    if (existingFileId) {
      await fetch(`${config.uploadApi}/files/${existingFileId}?uploadType=media`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: content,
      });
    } else {
      const metadata = {
        name: SESSIONS_FILE_NAME,
        parents: [patientFolderId],
        mimeType: 'application/json',
      };
      const boundary = 'halo_sessions_boundary';
      const body = Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
          `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n` +
          `--${boundary}--`
      );
      await fetch(`${config.uploadApi}/files?uploadType=multipart`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      });
    }

    return { sessions };
  },

  async getUserSettings({
    token,
  }: {
    token: string;
  }): Promise<{ settings: UserSettings | null }> {
    const rootId = await getHaloRootFolder(token);
    const fileId = await findSettingsFile(token, rootId);
    if (!fileId) return { settings: null };

    const dlRes = await fetch(`${config.driveApi}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!dlRes.ok) throw new Error(`Failed to load settings (${dlRes.status}).`);
    const settings = (await dlRes.json()) as UserSettings;
    return { settings };
  },

  async saveUserSettings({
    token,
    settings,
  }: {
    token: string;
    settings: UserSettings;
  }): Promise<{ success: true }> {
    const rootId = await getHaloRootFolder(token);
    const existingFileId = await findSettingsFile(token, rootId);
    const content = JSON.stringify(settings);

    if (existingFileId) {
      await fetch(`${config.uploadApi}/files/${existingFileId}?uploadType=media`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: content,
      });
    } else {
      const metadata = {
        name: 'halo_user_settings.json',
        parents: [rootId],
        mimeType: 'application/json',
      };
      const boundary = 'halo_settings_boundary';
      const body = Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
          `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n` +
          `--${boundary}--`
      );
      await fetch(`${config.uploadApi}/files?uploadType=multipart`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      });
    }

    return { success: true };
  },

  async getDoctorDiary({
    token,
  }: {
    token: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ entries: DoctorDiaryEntry[] }> {
    const rootId = await getHaloRootFolder(token);
    const fileId = await findDoctorJsonFile(token, rootId, DOCTOR_DIARY_FILE_NAME);
    if (!fileId) return { entries: [] };

    const dlRes = await fetch(`${config.driveApi}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!dlRes.ok) throw new Error(`Failed to load doctor diary (${dlRes.status}).`);
    const raw = (await dlRes.json()) as unknown;

    const entries = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' && 'entries' in raw ? (raw as any).entries : []);
    const safe = (entries as unknown[]).filter((e) => e && typeof e === 'object') as DoctorDiaryEntry[];
    return { entries: safe };
  },

  async saveDoctorDiary({
    token,
    entries,
  }: {
    token: string;
    entries: DoctorDiaryEntry[];
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ success: true }> {
    const rootId = await getHaloRootFolder(token);
    const existingFileId = await findDoctorJsonFile(token, rootId, DOCTOR_DIARY_FILE_NAME);
    const content = JSON.stringify(entries);

    if (existingFileId) {
      await fetch(`${config.uploadApi}/files/${existingFileId}?uploadType=media`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: content,
      });
    } else {
      const metadata = {
        name: DOCTOR_DIARY_FILE_NAME,
        parents: [rootId],
        mimeType: 'application/json',
      };
      const boundary = 'halo_doctor_diary_boundary';
      const body = Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
          `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n` +
          `--${boundary}--`
      );
      await fetch(`${config.uploadApi}/files?uploadType=multipart`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      });
    }

    return { success: true };
  },

  async getDoctorKanban({
    token,
  }: {
    token: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ kanban: AdmittedPatientKanban[] }> {
    const rootId = await getHaloRootFolder(token);
    const fileId = await findDoctorJsonFile(token, rootId, DOCTOR_KANBAN_FILE_NAME);
    if (!fileId) return { kanban: [] };

    const dlRes = await fetch(`${config.driveApi}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!dlRes.ok) throw new Error(`Failed to load doctor kanban (${dlRes.status}).`);
    const raw = (await dlRes.json()) as unknown;

    const kanban = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' && 'kanban' in raw ? (raw as any).kanban : []);
    const safe = (kanban as unknown[]).filter((p) => p && typeof p === 'object') as AdmittedPatientKanban[];
    return { kanban: safe };
  },

  async saveDoctorKanban({
    token,
    kanban,
  }: {
    token: string;
    kanban: AdmittedPatientKanban[];
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<{ success: true }> {
    const rootId = await getHaloRootFolder(token);
    const existingFileId = await findDoctorJsonFile(token, rootId, DOCTOR_KANBAN_FILE_NAME);
    const content = JSON.stringify(kanban);

    if (existingFileId) {
      await fetch(`${config.uploadApi}/files/${existingFileId}?uploadType=media`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: content,
      });
    } else {
      const metadata = {
        name: DOCTOR_KANBAN_FILE_NAME,
        parents: [rootId],
        mimeType: 'application/json',
      };
      const boundary = 'halo_doctor_kanban_boundary';
      const body = Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
          `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n` +
          `--${boundary}--`
      );
      await fetch(`${config.uploadApi}/files?uploadType=multipart`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      });
    }

    return { success: true };
  },

  async getOrCreatePatientNotesFolder({
    token,
    patientFolderId,
  }: {
    token: string;
    patientFolderId: string;
  }): Promise<string> {
    return getOrCreatePatientNotesFolder(token, patientFolderId);
  },

  async getPatientHaloProfile({
    token,
    patientFolderId,
  }: {
    token: string;
    patientFolderId: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<HaloPatientProfile | null> {
    const fileId = await findPatientProfileFile(token, patientFolderId);
    if (!fileId) return null;
    const dlRes = await fetch(`${config.driveApi}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!dlRes.ok) return null;
    const text = await dlRes.text();
    return parseHaloPatientProfileJson(text);
  },

  async getMotivationLetterTemplateDocxBuffer({
    token,
  }: {
    token: string;
    microsoftStorageMode?: MicrosoftStorageMode;
  }): Promise<Buffer | null> {
    const rootId = await getHaloRootFolder(token);
    const templatesId = await findTemplatesFolderId(token, rootId);
    let fileId = templatesId
      ? await findDocxByNameInFolder(token, templatesId, MOTIVATION_TEMPLATE_DOCX)
      : null;
    if (!fileId) {
      fileId = await findDocxByNameInFolder(token, rootId, MOTIVATION_TEMPLATE_DOCX);
    }
    if (!fileId) return null;
    try {
      return await downloadFileBuffer(token, fileId);
    } catch {
      return null;
    }
  },

  async fetchAllFilesInFolder({
    token,
    folderId,
  }: {
    token: string;
    folderId: string;
  }): Promise<Array<{ id: string; name: string; mimeType: string }>> {
    return fetchAllFilesInFolder(token, folderId);
  },

  async extractTextFromFile({
    token,
    file,
    maxChars,
  }: {
    token: string;
    file: { id: string; name: string; mimeType: string };
    maxChars?: number;
  }): Promise<string> {
    return extractTextFromFile(token, file, maxChars ?? 2000);
  },
};

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

async function findSettingsFile(token: string, rootId: string): Promise<string | null> {
  const SETTINGS_FILE_NAME = 'halo_user_settings.json';
  const query = encodeURIComponent(
    `'${rootId}' in parents and name='${SETTINGS_FILE_NAME}' and mimeType='application/json' and trashed=false`
  );
  const data = await driveRequest(token, `/files?q=${query}&fields=files(id)`);
  return data.files && data.files.length > 0 ? data.files[0].id : null;
}

async function findSessionsFile(token: string, patientFolderId: string): Promise<string | null> {
  const query = encodeURIComponent(
    `'${patientFolderId}' in parents and name='${SESSIONS_FILE_NAME}' and mimeType='application/json' and trashed=false`
  );
  const data = await driveRequest(token, `/files?q=${query}&fields=files(id)`);
  return data.files && data.files.length > 0 ? data.files[0].id : null;
}

async function findDoctorJsonFile(token: string, rootId: string, fileName: string): Promise<string | null> {
  const query = encodeURIComponent(
    `'${rootId}' in parents and name='${fileName}' and mimeType='application/json' and trashed=false`
  );
  const data = await driveRequest(token, `/files?q=${query}&fields=files(id)`);
  return data.files && data.files.length > 0 ? data.files[0].id : null;
}

async function findPatientProfileFile(token: string, patientFolderId: string): Promise<string | null> {
  const query = encodeURIComponent(
    `'${patientFolderId}' in parents and name='${HALO_PATIENT_PROFILE_FILE}' and mimeType='application/json' and trashed=false`
  );
  const data = await driveRequest(token, `/files?q=${query}&fields=files(id)`);
  return data.files && data.files.length > 0 ? data.files[0].id : null;
}

async function findTemplatesFolderId(token: string, rootId: string): Promise<string | null> {
  const query = encodeURIComponent(
    `'${rootId}' in parents and name='${MOTIVATION_TEMPLATE_FOLDER}' and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`
  );
  const data = await driveRequest(token, `/files?q=${query}&fields=files(id)`);
  return data.files && data.files.length > 0 ? data.files[0].id : null;
}

async function findDocxByNameInFolder(token: string, folderId: string, fileName: string): Promise<string | null> {
  const query = encodeURIComponent(
    `'${folderId}' in parents and name='${fileName}' and trashed=false`
  );
  const data = await driveRequest(token, `/files?q=${query}&fields=files(id,mimeType)`);
  const files = data.files as Array<{ id: string; mimeType?: string }> | undefined;
  if (!files?.length) return null;
  const docx =
    files.find((f) => f.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') ??
    files[0];
  return docx?.id ?? null;
}

