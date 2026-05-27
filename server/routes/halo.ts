import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { resolveWorkspace } from '../middleware/resolveWorkspace';
import { config } from '../config';
import { DEFAULT_HALO_TEMPLATE_ID } from '../../shared/haloTemplates';
import { HENK_HALO_USER_ID } from '../../shared/clinicalTemplates/constants';
import { generateNote, type HaloNote } from '../services/haloApi';
import {
  getLocalTemplateDefinition,
  resolveTemplatesForUser,
} from '../services/clinicalTemplateRegistry';
import { getStorageAdapter } from '../services/storage';
import { generateText } from '../services/gemini';
import {
  generateMoClinicalNotes,
  canUseLocalClinicalTemplateUser,
} from '../services/moClinicalNoteGeneration';
import { renderPracticeClinicalDocx } from '../services/practiceDocxFromTemplate';
import {
  buildPatientDetailsBlock,
  clinicalNoteMarkdownStructurePrompt,
  fallbackOrganisedNoteMarkdown,
} from '../utils/prompts';
import type { HaloPatientProfile } from '../../shared/types';
import {
  buildLetterReLine,
  displayNameFromProfile,
  renderPatientLetterDocx,
  type PatientLetterKind,
} from '../services/motivationLetter';
import { isOutboundMailReadyForUser, isSmtpConfigured, sendOutboundMail } from '../services/email';
import { prepareTextForHaloDocx } from '../utils/noteTextForDocx';
import { isHenkOutboundEmail } from '../services/userOutboundMail';

const router = Router();
router.use(requireAuth);
router.use(resolveWorkspace);

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';

function resolveHaloUserId(req: Request, opts?: { userId?: string; useMobileConfig?: boolean }): string {
  if (opts?.useMobileConfig) return config.haloMobileUserId;
  if (opts?.userId?.trim()) return opts.userId.trim();
  const driveRoot = (req.appUser?.driveRootFolderName || '').trim().toLowerCase();
  if (
    (req.appUser?.email && isHenkOutboundEmail(req.appUser.email)) ||
    driveRoot === config.henkDriveRootFolderName.trim().toLowerCase()
  ) {
    return HENK_HALO_USER_ID;
  }
  if (req.appUser?.haloUserId?.trim()) return req.appUser.haloUserId.trim();
  return config.haloUserId;
}

function resolveBundledTemplateDefinition(req: Request, userId: string, templateId: string) {
  return getLocalTemplateDefinition(userId, templateId);
}

async function loadPatientProfile(
  req: Request,
  patientFolderId: string | undefined
): Promise<HaloPatientProfile | null> {
  if (!patientFolderId || !req.session.accessToken) return null;
  try {
    const adapter = getStorageAdapter(req.session.provider);
    return await adapter.getPatientHaloProfile({
      token: req.session.accessToken,
      patientFolderId,
      microsoftStorageMode: req.session.microsoftStorageMode,
    });
  } catch (e) {
    console.warn('[Halo] Could not load HALO_patient_profile:', e);
    return null;
  }
}

/** Prepend sticker/profile block for Halo generate_note when patient folder id is known. */
async function prefixTextWithPatientProfile(
  req: Request,
  patientFolderId: string | undefined,
  text: string
): Promise<string> {
  const profile = await loadPatientProfile(req, patientFolderId);
  const block = profile ? buildPatientDetailsBlock(profile) : '';
  return block ? `${block}\n\n${text}` : text;
}

/** Halo sometimes echoes unstructured dictation — fill structured Markdown via Gemini when needed. */
function noteNeedsMarkdownStructure(note: Pick<HaloNote, 'content' | 'fields'>): boolean {
  if (note.fields && note.fields.length > 0) return false;
  const c = note.content?.trim() ?? '';
  if (!c) return true;
  if (/^#{1,3}\s/m.test(c)) return false;
  const lines = c.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (c.length > 180 && lines.length < 5) return true;
  return false;
}

function noteHasDisplayableBody(note: Pick<HaloNote, 'content' | 'fields'>): boolean {
  if (note.fields && note.fields.length > 0) return true;
  return Boolean(note.content?.trim());
}

async function finalizeGeneratedNotes(
  notes: HaloNote[],
  composedText: string,
  templateId: string,
  tplLabel: string,
  templateDefinition: ReturnType<typeof getLocalTemplateDefinition>
): Promise<HaloNote[]> {
  let result = notes;
  if (result.length === 0 && composedText.trim()) {
    result = [
      {
        noteId: `note-${Date.now()}`,
        title: tplLabel,
        content: '',
        template_id: templateId,
        lastSavedAt: new Date().toISOString(),
        dirty: false,
      },
    ];
  }

  if (config.geminiApiKey) {
    result = await Promise.all(
      result.map(async (note) => {
        if (!noteNeedsMarkdownStructure(note)) return note;
        try {
          const md = await generateText(
            clinicalNoteMarkdownStructurePrompt({
              templateDisplayName: tplLabel,
              templateId,
              sourceText: composedText,
              templateDefinition,
            })
          );
          const trimmed = md.trim();
          if (trimmed) return { ...note, content: trimmed };
        } catch (e) {
          console.warn('[Halo] Gemini Markdown structure fallback failed:', e);
        }
        return note;
      })
    );
  }

  return result.map((note) => {
    if (noteHasDisplayableBody(note)) return note;
    const fb = fallbackOrganisedNoteMarkdown(composedText, tplLabel);
    return fb ? { ...note, content: fb } : note;
  });
}

async function convertDocxBufferToPdfBuffer(token: string, docxBuffer: Buffer): Promise<Buffer> {
  const importMetadata = JSON.stringify({
    name: `halo_preview_${Date.now()}`,
    mimeType: GOOGLE_DOC_MIME,
  });
  const boundary = `halo_preview_${crypto.randomUUID()}`;
  const importBody = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${importMetadata}\r\n` +
      `--${boundary}\r\nContent-Type: ${DOCX_MIME}\r\n\r\n`
    ),
    docxBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const importRes = await fetch(`${config.uploadApi}/files?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: importBody,
  });
  if (!importRes.ok) {
    const body = await importRes.text().catch(() => '');
    throw new Error(`Failed to import DOCX for preview (${importRes.status}). ${body}`);
  }

  const imported = (await importRes.json()) as { id: string };
  try {
    const pdfRes = await fetch(
      `${config.driveApi}/files/${imported.id}/export?mimeType=${encodeURIComponent(PDF_MIME)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!pdfRes.ok) {
      const body = await pdfRes.text().catch(() => '');
      throw new Error(`Failed to export PDF preview (${pdfRes.status}). ${body}`);
    }
    return Buffer.from(await pdfRes.arrayBuffer());
  } finally {
    try {
      await fetch(`${config.driveApi}/files/${imported.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Best-effort cleanup for temp file.
    }
  }
}

function getMicrosoftDriveBase(storageMode?: 'onedrive' | 'sharepoint'): string {
  if (storageMode === 'sharepoint') {
    if (!config.msSharePointSiteId || !config.msSharePointDriveId) {
      throw new Error('SharePoint is not configured (MS_SHAREPOINT_SITE_ID/MS_SHAREPOINT_DRIVE_ID).');
    }
    return `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(config.msSharePointSiteId)}/drives/${encodeURIComponent(config.msSharePointDriveId)}`;
  }
  return 'https://graph.microsoft.com/v1.0/me/drive';
}

async function convertDocxBufferToPdfBufferMicrosoft(
  token: string,
  docxBuffer: Buffer,
  storageMode?: 'onedrive' | 'sharepoint'
): Promise<Buffer> {
  const driveBase = getMicrosoftDriveBase(storageMode);
  const tempName = `halo_preview_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.docx`;
  const uploadUrl = `${driveBase}/root:/${encodeURIComponent(tempName)}:/content`;

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': DOCX_MIME,
    },
    body: docxBuffer,
  });
  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => '');
    throw new Error(`Failed to upload DOCX for Microsoft preview (${uploadRes.status}). ${body}`);
  }
  const uploaded = (await uploadRes.json()) as { id: string };

  try {
    const pdfRes = await fetch(`${driveBase}/items/${encodeURIComponent(uploaded.id)}/content?format=pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!pdfRes.ok) {
      const body = await pdfRes.text().catch(() => '');
      throw new Error(`Failed to convert DOCX to PDF via Microsoft Graph (${pdfRes.status}). ${body}`);
    }
    return Buffer.from(await pdfRes.arrayBuffer());
  } finally {
    try {
      await fetch(`${driveBase}/items/${encodeURIComponent(uploaded.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Best-effort cleanup for temp file.
    }
  }
}

// POST /api/halo/templates
router.post('/templates', async (req: Request, res: Response) => {
  try {
    const userId = resolveHaloUserId(req, { userId: req.body?.user_id as string | undefined });
    const templates = await resolveTemplatesForUser(userId);
    res.json(templates);
  } catch (err) {
    console.error('Halo get_templates error:', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch templates.';
    res.status(err instanceof Error && message.includes('502') ? 502 : 400).json({ error: message });
  }
});

// POST /api/halo/generate-note
// Body: { user_id?, template_id?, text, return_type: 'note' | 'docx', patientId?, fileName?, useMobileConfig? }
// If useMobileConfig is true, use config.haloMobileUserId and config.haloMobileTemplateId (for mobile preview).
// If return_type === 'docx' and patientId is set, uploads DOCX to patient's Patient Notes folder and returns { success, fileId, name }.
router.post('/generate-note', async (req: Request, res: Response) => {
  try {
    const { user_id, template_id, text, return_type, patientId, fileName, useMobileConfig, template_name, mergeFields } = req.body as {
      user_id?: string;
      template_id?: string;
      text: string;
      return_type: 'note' | 'docx';
      patientId?: string;
      fileName?: string;
      useMobileConfig?: boolean;
      mergeFields?: Record<string, string>;
      /** Display name for template (e.g. Admission) — forwarded into composed Halo prompt for Markdown sections. */
      template_name?: string;
    };

    if (typeof text !== 'string') {
      res.status(400).json({ error: 'text is required.' });
      return;
    }

    const localSourceText = prepareTextForHaloDocx(text);
    const composedText = prepareTextForHaloDocx(await prefixTextWithPatientProfile(req, patientId, text));

    const userId = resolveHaloUserId(req, { userId: user_id, useMobileConfig });
    const templateId = useMobileConfig ? config.haloMobileTemplateId : (template_id || DEFAULT_HALO_TEMPLATE_ID);
    const templateDefinition = resolveBundledTemplateDefinition(req, userId, templateId);
    const tplLabel =
      (typeof template_name === 'string' && template_name.trim() ? template_name.trim() : null) ||
      templateDefinition?.name ||
      templateId;
    const templateNameOpt =
      typeof template_name === 'string' && template_name.trim() ? template_name.trim() : undefined;
    const patientProfile = await loadPatientProfile(req, patientId);

    console.log('[Halo] generate-note request:', {
      userId: userId.slice(0, 8) + '…',
      templateId,
      return_type,
      textLength: canUseLocalClinicalTemplateUser(userId, templateId) ? localSourceText.length : composedText.length,
    });

    if (return_type === 'note') {
      let notes: HaloNote[];
      if (canUseLocalClinicalTemplateUser(userId, templateId)) {
        notes = await generateMoClinicalNotes({
          composedText: localSourceText,
          templateId,
          templateDisplayName: tplLabel,
          templateDefinition,
          patientProfile,
        });
      } else {
        const result = await generateNote({
          user_id: userId,
          template_id: templateId,
          text: composedText,
          return_type,
          template_name: templateNameOpt,
          templateDefinition,
        });
        notes = result as HaloNote[];
      }
      notes = await finalizeGeneratedNotes(notes, composedText, templateId, tplLabel, templateDefinition);
      res.json({ notes });
      return;
    }

    const { buffer } = await renderPracticeClinicalDocx({
      haloUserId: userId,
      templateId,
      templateDefinition,
      template_name: templateNameOpt,
      text,
      haloText: composedText,
      mergeFields:
        mergeFields && typeof mergeFields === 'object' && !Array.isArray(mergeFields)
          ? Object.fromEntries(
              Object.entries(mergeFields).map(([k, v]) => [String(k), typeof v === 'string' ? v : String(v ?? '')])
            )
          : undefined,
      patientProfile,
    });
    if (!patientId || !req.session.accessToken) {
      res.status(400).json({ error: 'patientId is required to save DOCX to Drive.' });
      return;
    }

    const token = req.session.accessToken;
    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;

    const patientNotesFolderId = await adapter.getOrCreatePatientNotesFolder({
      token,
      patientFolderId: patientId,
      microsoftStorageMode,
    });
    const baseName = fileName && fileName.trim() ? fileName.replace(/\.docx$/i, '') : `Clinical_Note_${new Date().toISOString().split('T')[0]}`;
    const finalFileName = baseName.endsWith('.docx') ? baseName : `${baseName}.docx`;

    const base64Data = buffer.toString('base64');
    let uploaded: { id: string; name: string } | null = null;
    let lastUploadErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        uploaded = await adapter.uploadFile({
          token,
          parentFolderId: patientNotesFolderId,
          fileName: finalFileName,
          fileType: DOCX_MIME,
          base64Data,
          microsoftStorageMode,
        });
        break;
      } catch (e) {
        lastUploadErr = e;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 650 * (attempt + 1)));
      }
    }
    if (!uploaded) throw lastUploadErr instanceof Error ? lastUploadErr : new Error('DOCX upload failed.');

    res.json({ success: true, fileId: uploaded.id, name: uploaded.name });
  } catch (err) {
    console.error('[Halo] generate-note error:', err);
    const message = err instanceof Error ? err.message : 'Note generation failed.';
    const status = message.includes('502') ? 502 : message.includes('404') ? 404 : message.includes('Invalid') ? 400 : message.includes('too long') ? 504 : 500;
    res.status(status).json({ error: message });
  }
});

// POST /api/halo/generate-preview-pdf
// Body: { user_id?, template_id?, text, useMobileConfig? }
// Generates a DOCX with Halo and converts to PDF for in-app preview only (no Drive save).
router.post('/generate-preview-pdf', async (req: Request, res: Response) => {
  try {
    const { user_id, template_id, text, useMobileConfig, template_name, patientId, mergeFields } = req.body as {
      user_id?: string;
      template_id?: string;
      text: string;
      useMobileConfig?: boolean;
      template_name?: string;
      patientId?: string;
      mergeFields?: Record<string, string>;
    };

    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'text is required.' });
      return;
    }
    if (!req.session.accessToken) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }
    const composedText = prepareTextForHaloDocx(
      await prefixTextWithPatientProfile(req, typeof patientId === 'string' ? patientId : undefined, text)
    );
    const userId = resolveHaloUserId(req, { userId: user_id, useMobileConfig });
    const templateId = useMobileConfig ? config.haloMobileTemplateId : (template_id || DEFAULT_HALO_TEMPLATE_ID);
    const templateDefinition = resolveBundledTemplateDefinition(req, userId, templateId);
    const patientProfile = await loadPatientProfile(req, typeof patientId === 'string' ? patientId : undefined);

    const { buffer: docx } = await renderPracticeClinicalDocx({
      haloUserId: userId,
      templateId,
      templateDefinition,
      template_name: typeof template_name === 'string' && template_name.trim() ? template_name.trim() : undefined,
      text,
      haloText: composedText,
      mergeFields:
        mergeFields && typeof mergeFields === 'object' && !Array.isArray(mergeFields)
          ? Object.fromEntries(
              Object.entries(mergeFields).map(([k, v]) => [String(k), typeof v === 'string' ? v : String(v ?? '')])
            )
          : undefined,
      patientProfile,
    });
    let pdfBuffer: Buffer;
    if (req.session.provider === 'microsoft') {
      pdfBuffer = await convertDocxBufferToPdfBufferMicrosoft(
        req.session.accessToken,
        docx as Buffer,
        req.session.microsoftStorageMode
      );
    } else {
      pdfBuffer = await convertDocxBufferToPdfBuffer(req.session.accessToken, docx as Buffer);
    }
    res.json({ pdfBase64: pdfBuffer.toString('base64') });
  } catch (err) {
    console.error('[Halo] generate-preview-pdf error:', err);
    const message = err instanceof Error ? err.message : 'Preview generation failed.';
    const status = message.includes('Invalid') ? 400 : message.includes('404') ? 404 : message.includes('502') ? 502 : 500;
    res.status(status).json({ error: message });
  }
});

// POST /api/halo/confirm-and-send (mobile)
// Body: { patientId, text, fileName?, patientName? }
// Generates DOCX with mobile Halo config, saves to patient Patient Notes folder, emails DOCX to signed-in user from admin@halo.africa.
router.post('/confirm-and-send', async (req: Request, res: Response) => {
  try {
    const { patientId, text, fileName, patientName } = req.body as {
      patientId?: string;
      text?: string;
      fileName?: string;
      patientName?: string;
    };

    if (!patientId || typeof text !== 'string') {
      res.status(400).json({ error: 'patientId and text are required.' });
      return;
    }

    if (!req.session.accessToken) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }

    const composedText = prepareTextForHaloDocx(await prefixTextWithPatientProfile(req, patientId, text));

    const userId = config.haloMobileUserId;
    const templateId = config.haloMobileTemplateId;
    const templateDefinition = getLocalTemplateDefinition(userId, templateId);
    const result = await generateNote({
      user_id: userId,
      template_id: templateId,
      text: composedText,
      return_type: 'docx',
      templateDefinition,
    });

    const buffer = result as Buffer;
    const token = req.session.accessToken;
    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;

    const patientNotesFolderId = await adapter.getOrCreatePatientNotesFolder({
      token,
      patientFolderId: patientId,
      microsoftStorageMode,
    });
    const baseName =
      fileName && fileName.trim()
        ? fileName.replace(/\.docx$/i, '')
        : `Report_${new Date().toISOString().split('T')[0]}`;
    const finalFileName = baseName.endsWith('.docx') ? baseName : `${baseName}.docx`;

    const uploaded = await adapter.uploadFile({
      token,
      parentFolderId: patientNotesFolderId,
      fileName: finalFileName,
      fileType: DOCX_MIME,
      base64Data: buffer.toString('base64'),
      microsoftStorageMode,
    });

    let emailSent = false;
    const toEmail = req.session.userEmail;
    if (toEmail && isSmtpConfigured()) {
      try {
        const subjectPatient = (patientName && patientName.trim()) || 'Patient';
        await sendOutboundMail({
          from: config.adminEmail,
          to: toEmail,
          subject: `Your report: ${subjectPatient}`,
          text: `Please find the attached report for ${subjectPatient}.`,
          attachments: [{ filename: finalFileName, content: buffer }],
        });
        emailSent = true;
      } catch (emailErr) {
        console.error('Halo confirm-and-send email error:', emailErr);
        // Drive save already succeeded; respond with success and emailSent: false
      }
    }

    res.json({ success: true, fileId: uploaded.id, name: finalFileName, emailSent });
  } catch (err) {
    console.error('Halo confirm-and-send error:', err);
    const message = err instanceof Error ? err.message : 'Confirm and send failed.';
    const status = message.includes('502') ? 502 : message.includes('Invalid') ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

// POST /api/halo/generate-letter-docx
// Body: { patientId, letterKind: 'motivation' | 'referral', body } — fills motivational_template.docx and uploads to Patient Notes.
router.post('/generate-letter-docx', async (req: Request, res: Response) => {
  try {
    const { patientId, letterKind, body: letterBody } = req.body as {
      patientId?: string;
      letterKind?: PatientLetterKind;
      body?: string;
    };

    if (!patientId || typeof letterBody !== 'string' || !letterBody.trim()) {
      res.status(400).json({ error: 'patientId and body are required.' });
      return;
    }
    if (letterKind !== 'motivation' && letterKind !== 'referral') {
      res.status(400).json({ error: 'letterKind must be motivation or referral.' });
      return;
    }
    if (!req.session.accessToken || !req.appUser) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }

    const token = req.session.accessToken;
    const adapter = getStorageAdapter(req.session.provider);
    const microsoftStorageMode = req.session.microsoftStorageMode;

    const templateBuf = await adapter.getMotivationLetterTemplateDocxBuffer({
      token,
      rootFolderName: req.workspaceFolderName,
      microsoftStorageMode,
    });
    if (!templateBuf) {
      res.status(404).json({ error: 'motivational_template.docx not found in Halo_Patients root.' });
      return;
    }

    const profile = await adapter.getPatientHaloProfile({
      token,
      patientFolderId: patientId,
      microsoftStorageMode,
    });

    const doctorName =
      [req.appUser.firstName, req.appUser.lastName].filter(Boolean).join(' ').trim() || 'Clinician';
    const patientName = profile ? displayNameFromProfile(profile.fullName) : 'Patient';
    const dob = profile?.dob?.trim() ?? '';

    const docxBuffer = renderPatientLetterDocx(templateBuf, {
      patient_name: patientName,
      dob,
      body: letterBody.trim(),
      re: buildLetterReLine(letterKind),
      doctor_name: doctorName,
    });

    const patientNotesFolderId = await adapter.getOrCreatePatientNotesFolder({
      token,
      patientFolderId: patientId,
      microsoftStorageMode,
    });

    const dateStamp = new Date().toISOString().split('T')[0];
    const baseLabel = letterKind === 'referral' ? 'Referral_Letter' : 'Motivation_Letter';
    const finalFileName = `${baseLabel}_${dateStamp}.docx`;

    const uploaded = await adapter.uploadFile({
      token,
      parentFolderId: patientNotesFolderId,
      fileName: finalFileName,
      fileType: DOCX_MIME,
      base64Data: docxBuffer.toString('base64'),
      microsoftStorageMode,
    });

    res.json({ success: true, fileId: uploaded.id, name: uploaded.name });
  } catch (err) {
    console.error('[Halo] generate-letter-docx error:', err);
    const message = err instanceof Error ? err.message : 'Letter generation failed.';
    res.status(500).json({ error: message });
  }
});

/** Ensure fileId is a direct child of Patient Notes (where motivation/referral letters are saved). */
async function assertFileIdInPatientNotesFolder(
  req: Request,
  adapter: ReturnType<typeof getStorageAdapter>,
  patientFolderId: string,
  fileId: string
): Promise<void> {
  const token = req.session.accessToken!;
  const microsoftStorageMode = req.session.microsoftStorageMode;
  const notesFolderId = await adapter.getOrCreatePatientNotesFolder({
    token,
    patientFolderId,
    microsoftStorageMode,
  });
  let page: string | undefined;
  for (let i = 0; i < 50; i++) {
    const { files, nextPage } = await adapter.listFolderFiles({
      token,
      folderId: notesFolderId,
      page,
      pageSize: 100,
      microsoftStorageMode,
    });
    if (files.some((f) => f.id === fileId)) return;
    if (!nextPage) break;
    page = nextPage;
  }
  throw new Error('That file is not in this patient’s Patient Notes folder.');
}

// POST /api/halo/email-patient-file — attach a file from Patient Notes (e.g. motivation/referral DOCX). Requires outbound mail.
router.post('/email-patient-file', async (req: Request, res: Response) => {
  try {
    if (!req.appUser) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }
    if (!isOutboundMailReadyForUser(req.appUser.email)) {
      res.status(503).json({
        error:
          'Outbound email is not configured. Set SMTP or Microsoft Graph mail in the server .env (see README) and restart the Node server.',
      });
      return;
    }

    const { patientId, fileId, to: toRaw, subject: subjectRaw } = req.body as {
      patientId?: string;
      fileId?: string;
      to?: string;
      subject?: string;
    };

    if (!patientId?.trim() || !fileId?.trim()) {
      res.status(400).json({ error: 'patientId and fileId are required.' });
      return;
    }

    const adapter = getStorageAdapter(req.session.provider);
    const pid = patientId.trim();
    const fid = fileId.trim();

    await assertFileIdInPatientNotesFolder(req, adapter, pid, fid);

    const token = req.session.accessToken!;
    const microsoftStorageMode = req.session.microsoftStorageMode;

    let to = typeof toRaw === 'string' ? toRaw.trim() : '';
    if (!to) {
      const profile = await adapter.getPatientHaloProfile({
        token,
        patientFolderId: pid,
        microsoftStorageMode,
      });
      to = profile?.email?.trim() ?? '';
    }
    if (!to) {
      res.status(400).json({
        error: 'No recipient email. Add patient email in Sticker & billing details (HALO_patient_profile.json) or pass "to".',
      });
      return;
    }

    const proxy = await adapter.proxyFile({
      token,
      fileId: fid,
      microsoftStorageMode,
    });
    if (!proxy.data?.length) {
      res.status(400).json({ error: 'Could not read file content.' });
      return;
    }

    const fname = (proxy.filename || 'document.docx').trim() || 'document.docx';
    const ctype = proxy.mimeType?.trim() || DOCX_MIME;

    const subject =
      typeof subjectRaw === 'string' && subjectRaw.trim()
        ? subjectRaw.trim().slice(0, 300)
        : `${fname.replace(/\.[^.]+$/, '')} — HALO`;

    await sendOutboundMail(
      {
        to,
        subject,
        text: 'Please find the attached document from HALO.',
        attachments: [{ filename: fname, content: proxy.data, contentType: ctype }],
      },
      { appUserEmail: req.appUser.email }
    );

    res.json({ ok: true, smtpSent: true });
  } catch (err) {
    console.error('[Halo] email-patient-file error:', err);
    const message = err instanceof Error ? err.message : 'Email failed.';
    const status = message.includes('Patient Notes folder') ? 403 : 500;
    res.status(status).json({ error: message });
  }
});

// POST /api/halo/email-patient-doc — attach preview PDF; SMTP or mailto fallback
router.post('/email-patient-doc', async (req: Request, res: Response) => {
  try {
    if (!req.appUser) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }
    const { patientId, to, subject, pdfBase64, attachmentName } = req.body as {
      patientId?: string;
      to?: string;
      subject?: string;
      pdfBase64?: string;
      attachmentName?: string;
    };
    if (!patientId?.trim() || !to?.trim() || !subject?.trim() || !pdfBase64?.trim()) {
      res.status(400).json({ error: 'patientId, to, subject, and pdfBase64 are required.' });
      return;
    }
    let fname = String(attachmentName || 'clinical_note.pdf').trim() || 'clinical_note.pdf';
    if (!fname.toLowerCase().endsWith('.pdf')) fname = `${fname}.pdf`;

    const buf = Buffer.from(String(pdfBase64).trim(), 'base64');
    if (!buf.length) {
      res.status(400).json({ error: 'Invalid PDF data.' });
      return;
    }

    if (isOutboundMailReadyForUser(req.appUser.email)) {
      await sendOutboundMail(
        {
          to: to.trim(),
          subject: subject.trim(),
          text: 'Please find the attached document from your HALO consultation.',
          attachments: [{ filename: fname, content: buf, contentType: PDF_MIME }],
        },
        { appUserEmail: req.appUser.email }
      );
      res.json({ ok: true, smtpSent: true });
      return;
    }

    // Avoid mailto by default: browsers block async mailto navigation and cannot attach PDFs.
    if (process.env.HALO_ENABLE_MAILTO_FALLBACK !== 'true') {
      res.status(503).json({
        error:
          'Outbound email is not configured on the server. Set Microsoft Graph (SMTP_USE_MICROSOFT_GRAPH, MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, GRAPH_MAIL_SEND_AS) or classic SMTP (SMTP_HOST, SMTP_USER, SMTP_PASS), then restart the API. For local testing without mail, set HALO_ENABLE_MAILTO_FALLBACK=true to open a mailto draft (attachment must be added manually).',
      });
      return;
    }

    const body =
      'Please attach the PDF clinical note from HALO (Patient workspace — Note fields — PDF Preview) before sending.';
    const mailtoUrl = `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(subject.trim())}&body=${encodeURIComponent(body)}`;
    res.json({ ok: true, smtpSent: false, mailtoUrl });
  } catch (err) {
    console.error('[Halo] email-patient-doc error:', err);
    const message = err instanceof Error ? err.message : 'Email failed.';
    res.status(500).json({ error: message });
  }
});

export default router;
