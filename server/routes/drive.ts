import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { config } from '../config';
import { getStorageAdapter } from '../services/storage';
import mammoth from 'mammoth';
import {
  driveRequest,
  getHaloRootFolder,
  getOrCreatePatientNotesFolder,
  sanitizeString,
  isValidDate,
  isValidSex,
  parseFolderString,
  parsePatientFolder,
} from '../services/drive';
// Scheduler disabled; run-scheduler and scheduler-status kept for optional manual use
import { runSchedulerNow, getSchedulerStatus } from '../jobs/scheduler';
import type { ScribeSession } from '../../shared/types';
import { buildContextSectionPdf, mergePdfBuffers } from '../services/longitudinalPdf';

const router = Router();
router.use(requireAuth);

const { driveApi, uploadApi } = config;

const MAX_FILE_SIZE_MB = 25;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
/** Mammoth conversion is memory-heavy; cap preview size below full upload limit. */
const MAX_DOCX_PREVIEW_BYTES = 20 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'text/plain', 'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/json',
];
const DEFAULT_PAGE_SIZE = 50;

// Internal app file — never show in patient folder listing
const SESSIONS_FILE_NAME = 'halo_scribe_sessions.json';

// In-memory cache for first page of file list (per folder). Makes repeat views instant.
const FILES_CACHE_TTL_MS = 30_000; // 30 seconds
const filesListCache = new Map<string, { files: Array<{ id: string; name: string; mimeType: string; url: string; thumbnail?: string; createdTime: string }>; nextPage: string | null; cachedAt: number }>();

function invalidateFilesCacheForFolder(folderId: string): void {
  for (const key of filesListCache.keys()) {
    if (key.startsWith(`${folderId}:`)) filesListCache.delete(key);
  }
}

/** Express 5 types dynamic segments as `string | string[]`. */
function routeParam(value: string | string[] | undefined): string {
  if (value == null) return '';
  return Array.isArray(value) ? value[0] ?? '' : value;
}

function extensionFromMimeType(mimeType: string): string {
  const mt = (mimeType || '').toLowerCase();
  if (mt.includes('png')) return '.png';
  if (mt.includes('gif')) return '.gif';
  if (mt.includes('webp')) return '.webp';
  if (mt.includes('svg')) return '.svg';
  return '.jpg';
}

// --- Routes ---

// GET /patients?page=<token>&pageSize=<number>
router.get('/patients', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;

    const pageSize = Math.min(Number(req.query.pageSize) || DEFAULT_PAGE_SIZE, 100);
    const pageToken = typeof req.query.page === 'string' ? req.query.page : undefined;

    const { patients, nextPage } = await adapter.listPatients({
      token,
      page: pageToken,
      pageSize,
      microsoftStorageMode,
    });

    res.json({ patients, nextPage });
  } catch (err) {
    console.error('Fetch patients error:', err);
    res.status(500).json({ error: 'Failed to fetch patients.' });
  }
});

// POST /run-scheduler — run conversion jobs immediately (no wait for 5-min interval)
router.post('/run-scheduler', async (_req: Request, res: Response) => {
  try {
    await runSchedulerNow();
    res.json({ ok: true, message: 'Scheduler ran. Due conversions have been processed.' });
  } catch (err) {
    console.error('Run scheduler error:', err);
    res.status(500).json({ error: 'Scheduler run failed.' });
  }
});

// GET /scheduler-status — check pending conversion jobs count
router.get('/scheduler-status', async (_req: Request, res: Response) => {
  try {
    const status = getSchedulerStatus();
    const pendingJobs = status.jobs.filter(j => j.status !== 'done');
    const dueJobs = pendingJobs.filter(j => {
      const elapsed = Date.now() - new Date(j.savedAt).getTime();
      if (j.status === 'pending_docx') return elapsed >= 10 * 60 * 60 * 1000;
      if (j.status === 'pending_pdf') return elapsed >= 24 * 60 * 60 * 1000;
      return false;
    });
    res.json({
      totalPending: pendingJobs.length,
      totalDue: dueJobs.length,
      jobs: pendingJobs.map(j => ({
        fileId: j.fileId,
        status: j.status,
        savedAt: j.savedAt,
      })),
    });
  } catch (err) {
    console.error('Scheduler status error:', err);
    res.status(500).json({ error: 'Failed to get scheduler status.' });
  }
});

// POST /patients
router.post('/patients', async (req: Request, res: Response) => {
  try {
    const name = sanitizeString(req.body.name);
    const dob = sanitizeString(req.body.dob);
    const sex = sanitizeString(req.body.sex);

    if (!name || name.length < 2) {
      res.status(400).json({ error: 'Patient name must be at least 2 characters.' });
      return;
    }
    if (!dob || !isValidDate(dob)) {
      res.status(400).json({ error: 'Invalid date of birth. Use YYYY-MM-DD format.' });
      return;
    }
    if (!isValidSex(sex)) {
      res.status(400).json({ error: 'Sex must be M or F.' });
      return;
    }

    const token = req.session.accessToken!;
    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;

    const patient = await adapter.createPatient({
      token,
      name,
      dob,
      sex,
      microsoftStorageMode,
    });

    res.json(patient);
  } catch (err) {
    console.error('Create patient error:', err);
    res.status(500).json({ error: 'Failed to create patient.' });
  }
});

// GET /patients/:id/halo-profile — HALO_patient_profile.json from patient folder (sticker OCR / billing)
router.get('/patients/:id/halo-profile', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const id = routeParam(req.params.id);
    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;

    const profile = await adapter.getPatientHaloProfile({
      token,
      patientFolderId: id,
      microsoftStorageMode,
    });

    res.json({ profile });
  } catch (err) {
    console.error('Halo patient profile error:', err);
    res.status(500).json({ error: 'Failed to load patient profile.' });
  }
});

// PATCH /patients/:id
router.patch('/patients/:id', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const id = routeParam(req.params.id);

    const name = req.body.name ? sanitizeString(req.body.name) : undefined;
    const dob = req.body.dob ? sanitizeString(req.body.dob) : undefined;
    const sex = req.body.sex ? sanitizeString(req.body.sex) : undefined;

    if (name !== undefined && name.length < 2) {
      res.status(400).json({ error: 'Patient name must be at least 2 characters.' });
      return;
    }
    if (dob !== undefined && !isValidDate(dob)) {
      res.status(400).json({ error: 'Invalid date of birth. Use YYYY-MM-DD format.' });
      return;
    }
    if (sex !== undefined && !isValidSex(sex)) {
      res.status(400).json({ error: 'Sex must be M or F.' });
      return;
    }

    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;

    await adapter.updatePatient({
      token,
      patientId: id,
      name,
      dob,
      sex,
      microsoftStorageMode,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Update patient error:', err);
    res.status(500).json({ error: 'Failed to update patient.' });
  }
});

// DELETE /patients/:id
router.delete('/patients/:id', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;

    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;

    await adapter.trashPatient({
      token,
      patientId: routeParam(req.params.id),
      microsoftStorageMode,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete patient error:', err);
    res.status(500).json({ error: 'Failed to delete patient.' });
  }
});

// POST /patients/:id/folder - Create a subfolder
router.post('/patients/:id/folder', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const name = sanitizeString(req.body.name, 255);

    if (!name || name.length < 1) {
      res.status(400).json({ error: 'Folder name is required.' });
      return;
    }

    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;

    const folder = await adapter.createFolder({
      token,
      parentFolderId: Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
      name,
      microsoftStorageMode,
    });

    res.json(folder);
  } catch (err) {
    console.error('Create folder error:', err);
    res.status(500).json({ error: 'Failed to create folder.' });
  }
});

// GET /patients/:id/files?page=<token>&pageSize=<number>
router.get('/patients/:id/files', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const folderId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;

    const pageSize = Math.min(Number(req.query.pageSize) || DEFAULT_PAGE_SIZE, 100);
    const pageToken = typeof req.query.page === 'string' ? req.query.page : undefined;

    const { files, nextPage } = await adapter.listFolderFiles({
      token,
      folderId,
      page: pageToken,
      pageSize,
      microsoftStorageMode,
    });

    res.json({ files, nextPage });
  } catch (err) {
    console.error('Fetch files error:', err);
    res.status(500).json({ error: 'Failed to fetch files.' });
  }
});

// Timeout for warm upload — if it hangs, we fall back to direct list
const WARM_UPLOAD_TIMEOUT_MS = 12_000;

// POST /patients/:id/warm-and-list — upload tiny temp file, list folder, delete temp (makes list load reliably)
// If warm upload times out, falls back to direct list so we never hang.
router.post('/patients/:id/warm-and-list', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const folderId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const pageSize = Math.min(Number(req.query.pageSize) || DEFAULT_PAGE_SIZE, 100);
    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;

    const { files, nextPage } = await adapter.warmAndListFolderFiles({
      token,
      folderId,
      pageSize,
      microsoftStorageMode,
    });

    res.json({ files, nextPage });
  } catch (err) {
    console.error('[warm-and-list] error:', err);
    res.status(500).json({ error: 'Failed to load files.' });
  }
});

// POST /patients/:id/upload
router.post('/patients/:id/upload', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const fileName = sanitizeString(req.body.fileName, 255);
    const fileType = sanitizeString(req.body.fileType, 100);
    const fileData = req.body.fileData as string;

    if (!fileName) {
      res.status(400).json({ error: 'File name is required.' });
      return;
    }
    if (!fileType || !ALLOWED_UPLOAD_TYPES.includes(fileType)) {
      res.status(400).json({ error: `File type not allowed. Accepted: ${ALLOWED_UPLOAD_TYPES.join(', ')}` });
      return;
    }
    if (!fileData || typeof fileData !== 'string') {
      res.status(400).json({ error: 'File data is required.' });
      return;
    }

    const estimatedSize = Math.ceil(fileData.length * 3 / 4);
    if (estimatedSize > MAX_FILE_SIZE_BYTES) {
      res.status(400).json({ error: `File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.` });
      return;
    }

    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;

    const parentFolderId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const uploaded = await adapter.uploadFile({
      token,
      parentFolderId,
      fileName,
      fileType,
      base64Data: fileData,
      microsoftStorageMode,
    });

    res.json(uploaded);
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Failed to upload file.' });
  }
});

function findCumulativeHistoryPdf(
  files: Array<{ id: string; name: string; mimeType: string }>,
  configuredName: string
): { id: string; name: string; mimeType: string } | undefined {
  const want = configuredName.trim().toLowerCase();
  const pdf = files.filter(
    (f) => f.mimeType === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
  );
  return pdf.find((f) => f.name.trim().toLowerCase() === want);
}

/** Canonical upload name from env (ensure .pdf). */
function cumulativeHistoryTargetFileName(configuredName: string): string {
  let n = configuredName.trim();
  if (!n.toLowerCase().endsWith('.pdf')) {
    n = `${n}.pdf`;
  }
  return n.slice(0, 255);
}

// POST /patients/:id/longitudinal-append — merge into existing cumulative PDF in Patient Notes
router.post('/patients/:id/longitudinal-append', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const patientFolderId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const textRaw = req.body?.text;
    if (typeof textRaw !== 'string' || !textRaw.trim()) {
      res.status(400).json({ error: 'text is required.' });
      return;
    }
    const text = textRaw.trim().slice(0, 50_000);

    const configuredName = config.cumulativeHistoryPdfName;

    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;

    const notesFolderId = await adapter.getOrCreatePatientNotesFolder({
      token,
      patientFolderId,
      microsoftStorageMode,
    });

    const { files } = await adapter.listFolderFiles({
      token,
      folderId: notesFolderId,
      pageSize: 100,
      microsoftStorageMode,
    });

    const existing = findCumulativeHistoryPdf(files, configuredName);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const sectionTitle = `Smart context — ${stamp}`;
    const smartContextBaseName = `Smart_context_${stamp}`;

    const attRaw = req.body?.attachments;
    const images: { data: Uint8Array; mimeType: string; label?: string }[] = [];
    const imageUploads: Array<{ base64Data: string; mimeType: string; fileName: string }> = [];
    if (Array.isArray(attRaw)) {
      for (const a of attRaw.slice(0, 4)) {
        if (!a || typeof a.base64 !== 'string') continue;
        try {
          const b64 = a.base64.includes(',') ? a.base64.split(',')[1] || '' : a.base64;
          const buf = Buffer.from(b64, 'base64');
          if (!buf.length || buf.length > 12 * 1024 * 1024) continue;
          const mimeType = typeof a.mimeType === 'string' && a.mimeType ? a.mimeType : 'image/jpeg';
          const label = typeof a.fileName === 'string' ? a.fileName : 'Context image';
          images.push({ data: new Uint8Array(buf), mimeType, label });
          const safeName = sanitizeString(label, 120).replace(/\.[A-Za-z0-9]+$/, '') || 'source';
          imageUploads.push({
            base64Data: b64,
            mimeType,
            fileName: `${smartContextBaseName}_${safeName}${extensionFromMimeType(mimeType)}`,
          });
        } catch {
          /* skip */
        }
      }
    }

    for (const image of imageUploads) {
      try {
        await adapter.uploadFile({
          token,
          parentFolderId: notesFolderId,
          fileName: image.fileName,
          fileType: image.mimeType,
          base64Data: image.base64Data,
          microsoftStorageMode,
        });
      } catch (uploadErr) {
        console.error('[longitudinal-append] failed to upload source image to Patient Notes', uploadErr);
        res.status(500).json({
          error: 'Could not save the uploaded context image into Patient Notes.',
          detail: uploadErr instanceof Error ? uploadErr.message : String(uploadErr),
        });
        return;
      }
    }

    const sectionPdf = await buildContextSectionPdf(sectionTitle, text, images);

    try {
      await adapter.uploadFile({
        token,
        parentFolderId: notesFolderId,
        fileName: `${smartContextBaseName}.pdf`,
        fileType: 'application/pdf',
        base64Data: Buffer.from(sectionPdf).toString('base64'),
        microsoftStorageMode,
      });
    } catch (uploadErr) {
      console.error('[longitudinal-append] failed to upload Smart Context PDF to Patient Notes', uploadErr);
      res.status(500).json({
        error: 'Could not save the Smart Context PDF into Patient Notes.',
        detail: uploadErr instanceof Error ? uploadErr.message : String(uploadErr),
      });
      return;
    }

    let outBytes: Uint8Array;
    let outName: string;

    if (existing) {
      const proxy = await adapter.proxyFile({
        token,
        fileId: existing.id,
        microsoftStorageMode,
      });
      try {
        outBytes = await mergePdfBuffers(proxy.data, sectionPdf);
      } catch (mergeErr) {
        console.error('[longitudinal-append] merge failed', mergeErr);
        res.status(500).json({
          error: 'Could not merge into the cumulative history PDF.',
          detail: mergeErr instanceof Error ? mergeErr.message : String(mergeErr),
        });
        return;
      }
      await adapter.trashFile({
        token,
        fileId: existing.id,
        microsoftStorageMode,
      });
      outName = existing.name || cumulativeHistoryTargetFileName(configuredName);
    } else {
      console.log('[longitudinal-append] creating new cumulative history pdf', {
        patientFolderId,
        notesFolderId,
        configuredName,
      });
      outBytes = sectionPdf;
      outName = cumulativeHistoryTargetFileName(configuredName);
    }

    const b64 = Buffer.from(outBytes).toString('base64');
    const uploaded = await adapter.uploadFile({
      token,
      parentFolderId: notesFolderId,
      fileName: outName,
      fileType: 'application/pdf',
      base64Data: b64,
      microsoftStorageMode,
    });

    res.json({ ok: true, file: uploaded, created: !existing });
  } catch (err) {
    console.error('longitudinal-append error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to save to cumulative history.', detail });
  }
});

// PATCH /files/:fileId
router.patch('/files/:fileId', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const name = sanitizeString(req.body.name, 255);

    if (!name) {
      res.status(400).json({ error: 'File name is required.' });
      return;
    }

    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;
    await adapter.renameFile({
      token,
      fileId: routeParam(req.params.fileId),
      newName: name,
      microsoftStorageMode,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Update file error:', err);
    res.status(500).json({ error: 'Failed to update file.' });
  }
});

// DELETE /files/:fileId - Trash a file
router.delete('/files/:fileId', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;

    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;
    await adapter.trashFile({
      token,
      fileId: routeParam(req.params.fileId),
      microsoftStorageMode,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete file error:', err);
    res.status(500).json({ error: 'Failed to delete file.' });
  }
});

// GET /files/:fileId/download - Get download URL
router.get('/files/:fileId/download', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;

    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;

    const info = await adapter.downloadFileInfo({
      token,
      fileId: routeParam(req.params.fileId),
      microsoftStorageMode,
    });

    res.json(info);
  } catch (err) {
    console.error('Download file error:', err);
    res.status(500).json({ error: 'Failed to get download link.' });
  }
});

// GET /files/:fileId/proxy — stream file content for in-app viewer
router.get('/files/:fileId/proxy', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const fileId = routeParam(req.params.fileId);
    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;

    const proxy = await adapter.proxyFile({
      token,
      fileId,
      microsoftStorageMode,
    });

    res.setHeader('Content-Type', proxy.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(proxy.filename)}"`);
    res.send(proxy.data);
  } catch (err) {
    console.error('File proxy error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to proxy file.', detail });
  }
});

// GET /files/:fileId/preview-docx-html — .docx → HTML for in-app preview (mammoth)
router.get('/files/:fileId/preview-docx-html', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const fileId = routeParam(req.params.fileId);
    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;

    const proxy = await adapter.proxyFile({
      token,
      fileId,
      microsoftStorageMode,
    });

    const name = (proxy.filename || '').toLowerCase();
    const mime = (proxy.mimeType || '').toLowerCase();
    const isDocx =
      mime.includes('wordprocessingml') ||
      mime.includes('officedocument.wordprocessingml.document') ||
      name.endsWith('.docx');

    if (!isDocx) {
      res.status(400).json({ error: 'Preview is only available for .docx Word files.' });
      return;
    }

    if (proxy.data.length > MAX_DOCX_PREVIEW_BYTES) {
      res.status(413).json({ error: 'File is too large to preview in the app. Open in a new tab instead.' });
      return;
    }

    const { value: html } = await mammoth.convertToHtml({ buffer: proxy.data });
    res.json({ html });
  } catch (err) {
    console.error('DOCX preview error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to build Word preview.', detail });
  }
});

// --- SCRIBE SESSIONS PER PATIENT (JSON file in patient folder) ---

// GET /patients/:id/sessions
router.get('/patients/:id/sessions', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const folderId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;

    const { sessions } = await adapter.getPatientSessions({
      token,
      patientFolderId: folderId,
      microsoftStorageMode,
    });

    res.json({ sessions });
  } catch (err) {
    console.error('Load sessions error:', err);
    res.status(500).json({ error: 'Failed to load sessions.' });
  }
});

// POST /patients/:id/sessions
router.post('/patients/:id/sessions', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const folderId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const sessionIdRaw = req.body?.sessionId;
    const transcriptRaw = req.body?.transcript;
    const contextRaw = req.body?.context;
    const templatesRaw = req.body?.templates;
    const noteTitlesRaw = req.body?.noteTitles;
    const notesRaw = req.body?.notes;
    const mainComplaintRaw = req.body?.mainComplaint;

    const transcript =
      typeof transcriptRaw === 'string' ? transcriptRaw.trim().slice(0, 20000) : '';
    if (!transcript) {
      res.status(400).json({ error: 'transcript is required.' });
      return;
    }

    const context =
      typeof contextRaw === 'string' ? contextRaw.trim().slice(0, 5000) : undefined;
    const templates = Array.isArray(templatesRaw)
      ? templatesRaw.map((t: unknown) => String(t)).slice(0, 20)
      : undefined;
    const noteTitles = Array.isArray(noteTitlesRaw)
      ? noteTitlesRaw.map((t: unknown) => String(t)).slice(0, 20)
      : undefined;
    const notes = Array.isArray(notesRaw)
      ? notesRaw.slice(0, 20).map((n: unknown) => {
          const o = n && typeof n === 'object' ? (n as Record<string, unknown>) : {};
          const fields = Array.isArray(o.fields)
            ? o.fields
                .slice(0, 100)
                .map((f: unknown) => {
                  const fo = f && typeof f === 'object' ? (f as Record<string, unknown>) : {};
                  return {
                    label: String(fo.label ?? '').slice(0, 200),
                    body: String(fo.body ?? '').slice(0, 20000),
                  };
                })
                .filter((f) => f.label.length > 0)
            : undefined;
          let raw: unknown;
          if (o.raw !== undefined) {
            try {
              const s = JSON.stringify(o.raw);
              if (typeof s === 'string' && s.length <= 200_000) {
                raw = JSON.parse(s);
              }
            } catch {
              raw = undefined;
            }
          }
          return {
            noteId: String(o.noteId ?? ''),
            title: String(o.title ?? ''),
            content: String(o.content ?? '').slice(0, 100000),
            template_id: String(o.template_id ?? ''),
            ...(raw !== undefined ? { raw } : {}),
            ...(fields && fields.length > 0 ? { fields } : {}),
          };
        })
      : undefined;
    const mainComplaint =
      typeof mainComplaintRaw === 'string' ? mainComplaintRaw.trim().slice(0, 200) : undefined;

    const nowIso = new Date().toISOString();
    const providedId =
      typeof sessionIdRaw === 'string' && sessionIdRaw.trim()
        ? sessionIdRaw.trim()
        : undefined;
    const sessionId =
      providedId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;

    const { sessions } = await adapter.savePatientSessions({
      token,
      patientFolderId: folderId,
      payload: {
        sessionId,
        transcript,
        context,
        templates,
        noteTitles,
        notes,
        mainComplaint: mainComplaint || undefined,
      },
      microsoftStorageMode,
    });

    res.json({ sessions });
  } catch (err) {
    console.error('Save sessions error:', err);
    res.status(500).json({ error: 'Failed to save session.' });
  }
});

// --- USER SETTINGS & SCRIBE SESSIONS (stored as JSON files in Drive) ---

const SETTINGS_FILE_NAME = 'halo_user_settings.json';

async function findSettingsFile(token: string, rootId: string): Promise<string | null> {
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
        ? obj.notes
          .slice(0, 20)
          .map((n: unknown) => {
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
        mainComplaint: typeof obj.mainComplaint === 'string' ? obj.mainComplaint.trim().slice(0, 200) : undefined,
      } as ScribeSession;
    })
    .filter((s): s is ScribeSession => s !== null);
}

// GET /settings
router.get('/settings', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;

    const { settings } = await adapter.getUserSettings({ token, microsoftStorageMode });
    res.json({ settings });
  } catch (err) {
    console.error('Load settings error:', err);
    res.status(500).json({ error: 'Failed to load settings.' });
  }
});

// PUT /settings
router.put('/settings', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const settings = req.body;

    if (!settings || typeof settings !== 'object') {
      res.status(400).json({ error: 'Settings object is required.' });
      return;
    }

    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;
    await adapter.saveUserSettings({ token, settings, microsoftStorageMode });

    res.json({ success: true });
  } catch (err) {
    console.error('Save settings error:', err);
    res.status(500).json({ error: 'Failed to save settings.' });
  }
});

export default router;
