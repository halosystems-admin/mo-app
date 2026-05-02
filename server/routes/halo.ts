import { Router, Request, Response } from 'express';
import nodemailer from 'nodemailer';
import { requireAuth } from '../middleware/requireAuth';
import { config } from '../config';
import { DEFAULT_HALO_TEMPLATE_ID } from '../../shared/haloTemplates';
import { getTemplates, generateNote, type HaloNote } from '../services/haloApi';
import { getStorageAdapter } from '../services/storage';
import { generateText } from '../services/gemini';
import {
  buildPatientDetailsBlock,
  clinicalNoteMarkdownStructurePrompt,
  fallbackOrganisedNoteMarkdown,
} from '../utils/prompts';
import {
  buildLetterReLine,
  displayNameFromProfile,
  renderPatientLetterDocx,
  type PatientLetterKind,
} from '../services/motivationLetter';

const router = Router();
router.use(requireAuth);

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';

function isSmtpConfigured(): boolean {
  return Boolean(config.smtpHost && config.smtpUser && config.smtpPass);
}

function resolveHaloUserId(req: Request, opts?: { userId?: string; useMobileConfig?: boolean }): string {
  if (opts?.useMobileConfig) return config.haloMobileUserId;
  return opts?.userId || req.appUser?.haloUserId || config.haloUserId;
}

/** Prepend sticker/profile block for Halo generate_note when patient folder id is known. */
async function prefixTextWithPatientProfile(
  req: Request,
  patientFolderId: string | undefined,
  text: string
): Promise<string> {
  if (!patientFolderId || !req.session.accessToken) return text;
  try {
    const adapter = getStorageAdapter(req.session.provider);
    const profile = await adapter.getPatientHaloProfile({
      token: req.session.accessToken,
      patientFolderId,
      microsoftStorageMode: req.session.microsoftStorageMode,
    });
    const block = buildPatientDetailsBlock(profile);
    return block ? `${block}\n\n${text}` : text;
  } catch (e) {
    console.warn('[Halo] Could not load HALO_patient_profile for prompt prefix:', e);
    return text;
  }
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
    const templates = await getTemplates(userId);
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
    const { user_id, template_id, text, return_type, patientId, fileName, useMobileConfig, template_name } = req.body as {
      user_id?: string;
      template_id?: string;
      text: string;
      return_type: 'note' | 'docx';
      patientId?: string;
      fileName?: string;
      useMobileConfig?: boolean;
      /** Display name for template (e.g. Admission) — forwarded into composed Halo prompt for Markdown sections. */
      template_name?: string;
    };

    if (typeof text !== 'string') {
      res.status(400).json({ error: 'text is required.' });
      return;
    }

    const composedText = await prefixTextWithPatientProfile(req, patientId, text);

    const userId = resolveHaloUserId(req, { userId: user_id, useMobileConfig });
    const templateId = useMobileConfig ? config.haloMobileTemplateId : (template_id || DEFAULT_HALO_TEMPLATE_ID);
    console.log('[Halo] generate-note request:', {
      userId: userId.slice(0, 8) + '…',
      templateId,
      return_type,
      textLength: composedText.length,
    });
    const result = await generateNote({
      user_id: userId,
      template_id: templateId,
      text: composedText,
      return_type,
      template_name: typeof template_name === 'string' && template_name.trim() ? template_name.trim() : undefined,
    });

    if (return_type === 'note') {
      let notes = result as HaloNote[];
      const tplLabel =
        (typeof template_name === 'string' && template_name.trim() ? template_name.trim() : null) || templateId;

      if (notes.length === 0 && composedText.trim()) {
        notes = [
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
        notes = await Promise.all(
          notes.map(async (note) => {
            if (!noteNeedsMarkdownStructure(note)) return note;
            try {
              const md = await generateText(
                clinicalNoteMarkdownStructurePrompt({
                  templateDisplayName: tplLabel,
                  templateId,
                  sourceText: composedText,
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

      notes = notes.map((note) => {
        if (noteHasDisplayableBody(note)) return note;
        const fb = fallbackOrganisedNoteMarkdown(composedText, tplLabel);
        return fb ? { ...note, content: fb } : note;
      });

      res.json({ notes });
      return;
    }

    // return_type === 'docx': result is Buffer
    const buffer = result as Buffer;
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
    const { user_id, template_id, text, useMobileConfig, template_name, patientId } = req.body as {
      user_id?: string;
      template_id?: string;
      text: string;
      useMobileConfig?: boolean;
      template_name?: string;
      patientId?: string;
    };

    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'text is required.' });
      return;
    }
    if (!req.session.accessToken) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }
    const composedText = await prefixTextWithPatientProfile(
      req,
      typeof patientId === 'string' ? patientId : undefined,
      text
    );
    const userId = resolveHaloUserId(req, { userId: user_id, useMobileConfig });
    const templateId = useMobileConfig ? config.haloMobileTemplateId : (template_id || DEFAULT_HALO_TEMPLATE_ID);

    const docx = await generateNote({
      user_id: userId,
      template_id: templateId,
      text: composedText,
      return_type: 'docx',
      template_name: typeof template_name === 'string' && template_name.trim() ? template_name.trim() : undefined,
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

    const composedText = await prefixTextWithPatientProfile(req, patientId, text);

    const userId = config.haloMobileUserId;
    const templateId = config.haloMobileTemplateId;
    const result = await generateNote({
      user_id: userId,
      template_id: templateId,
      text: composedText,
      return_type: 'docx',
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
        const transporter = nodemailer.createTransport({
          host: config.smtpHost,
          port: config.smtpPort,
          secure: config.smtpSecure,
          auth: { user: config.smtpUser, pass: config.smtpPass },
        });
        const subjectPatient = (patientName && patientName.trim()) || 'Patient';
        await transporter.sendMail({
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

export default router;
