import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { config } from '../config';
import { isSmtpConfigured, sendOutboundMail } from '../services/email';

const router = Router();
router.use(requireAuth);

const ADMIN_EMAIL = config.adminEmail;

/**
 * POST /api/request-template
 * Body: { description: string, attachments?: Array<{ name: string, content: string }> }
 * content is base64-encoded file content.
 * Sends an email to admin@halo.africa with the request and optional attachments.
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const userEmail = req.session.userEmail;
  const { description, attachments } = req.body as {
    description?: string;
    attachments?: Array<{ name: string; content: string }>;
  };

  if (!description || typeof description !== 'string' || !description.trim()) {
    res.status(400).json({ error: 'Please provide a template description.' });
    return;
  }

  if (!isSmtpConfigured()) {
    console.warn(
      '[request-template] Outbound mail not configured. Set SMTP_* or SMTP_USE_MICROSOFT_GRAPH + MS_* + mailbox.'
    );
    res.status(503).json({
      error: 'Email is not configured. Your request was not sent. Please contact support.',
    });
    return;
  }

  try {
    const decodedAttachments: Array<{ filename: string; content: Buffer; contentType?: string }> = [];
    if (Array.isArray(attachments)) {
      for (const att of attachments.slice(0, 5)) {
        if (att?.name && att?.content && typeof att.content === 'string') {
          try {
            decodedAttachments.push({
              filename: String(att.name).replace(/[^a-zA-Z0-9._-]/g, '_'),
              content: Buffer.from(att.content, 'base64'),
            });
          } catch {
            // skip invalid attachment
          }
        }
      }
    }

    const subject = `[HALO] New template request from ${userEmail || 'signed-in user'}`;
    const text = [
      `A user has requested a new note template.`,
      ``,
      `From: ${userEmail || '(email not available)'}`,
      `Date: ${new Date().toISOString()}`,
      ``,
      `--- Template description / contents ---`,
      ``,
      description.trim(),
    ].join('\n');

    await sendOutboundMail({
      from: `${(config.smtpFromName || 'HALO').trim()} <${(config.smtpFrom || config.smtpUser).trim()}>`,
      to: ADMIN_EMAIL,
      subject,
      text,
      attachments: decodedAttachments.length > 0 ? decodedAttachments : undefined,
    });

    res.json({ ok: true, message: 'Request sent. We will get back to you.' });
  } catch (err) {
    console.error('[request-template] Send failed:', err);
    res.status(500).json({
      error: 'Failed to send your request. Please try again or contact support.',
    });
  }
});

export default router;
