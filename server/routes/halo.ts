import { Router, Request, Response } from 'express';
import nodemailer from 'nodemailer';
import { requireAuth } from '../middleware/requireAuth';
import { config } from '../config';
import { DEFAULT_HALO_TEMPLATE_ID } from '../../shared/haloTemplates';
import { getTemplates, generateNote } from '../services/haloApi';
import { getStorageAdapter } from '../services/storage';

const router = Router();
router.use(requireAuth);

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';

function isSmtpConfigured(): boolean {
  return Boolean(config.smtpHost && config.smtpUser && config.smtpPass);
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
    const userId = (req.body?.user_id as string) || config.haloUserId;
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
    const { user_id, template_id, text, return_type, patientId, fileName, useMobileConfig } = req.body as {
      user_id?: string;
      template_id?: string;
      text: string;
      return_type: 'note' | 'docx';
      patientId?: string;
      fileName?: string;
      useMobileConfig?: boolean;
    };

    if (typeof text !== 'string') {
      res.status(400).json({ error: 'text is required.' });
      return;
    }

    const userId = useMobileConfig ? config.haloMobileUserId : (user_id || config.haloUserId);
    const templateId = useMobileConfig ? config.haloMobileTemplateId : (template_id || DEFAULT_HALO_TEMPLATE_ID);
    console.log('[Halo] generate-note request:', { userId: userId.slice(0, 8) + '…', templateId, return_type, textLength: text.length });
    const result = await generateNote({ user_id: userId, template_id: templateId, text, return_type });

    if (return_type === 'note') {
      res.json({ notes: result });
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
    const { user_id, template_id, text, useMobileConfig } = req.body as {
      user_id?: string;
      template_id?: string;
      text: string;
      useMobileConfig?: boolean;
    };

    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'text is required.' });
      return;
    }
    if (!req.session.accessToken) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }
    const userId = useMobileConfig ? config.haloMobileUserId : (user_id || config.haloUserId);
    const templateId = useMobileConfig ? config.haloMobileTemplateId : (template_id || DEFAULT_HALO_TEMPLATE_ID);

    const docx = await generateNote({
      user_id: userId,
      template_id: templateId,
      text,
      return_type: 'docx',
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

    const userId = config.haloMobileUserId;
    const templateId = config.haloMobileTemplateId;
    const result = await generateNote({
      user_id: userId,
      template_id: templateId,
      text,
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

export default router;
