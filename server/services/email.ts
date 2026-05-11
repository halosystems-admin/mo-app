import nodemailer from 'nodemailer';
import { config } from '../config';

const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const TOKEN_URL_TPL = 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token';

export type OutboundAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

let graphTokenCache: { token: string; expiresAtMs: number } | null = null;

function legacySmtpConfigured(): boolean {
  return Boolean(config.smtpHost && config.smtpUser && config.smtpPass);
}

/** Mailbox UPN used as Graph sender (application Mail.Send sends as this user). */
function graphSendAsAddress(): string {
  return (config.graphMailSendAs || config.smtpFrom || config.smtpUser || '').trim();
}

function graphMailReady(): boolean {
  return Boolean(
    config.msTenantId &&
      config.msClientId &&
      config.msClientSecret &&
      graphSendAsAddress()
  );
}

/**
 * True when HALO can send outbound mail: either classic SMTP or Graph mode (flag + Entra app).
 * Existing callers keep using this name; Graph mode does not require SMTP_PASS.
 */
export function isSmtpConfigured(): boolean {
  if (config.smtpUseMicrosoftGraph) {
    return graphMailReady();
  }
  return legacySmtpConfigured();
}

function getFrom(): string {
  const addr = (config.smtpFrom || config.smtpUser || '').trim();
  const name = (config.smtpFromName || 'HALO').trim();
  if (!addr) return '';
  return name ? `${name} <${addr}>` : addr;
}

function getTransport() {
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
  });
}

async function fetchGraphAccessToken(): Promise<{ access_token: string; expires_in?: number }> {
  const tenant = config.msTenantId.trim();
  const url = TOKEN_URL_TPL.replace('{tenant}', encodeURIComponent(tenant));
  const body = new URLSearchParams({
    client_id: config.msClientId.trim(),
    client_secret: config.msClientSecret.trim(),
    scope: GRAPH_SCOPE,
    grant_type: 'client_credentials',
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !json.access_token) {
    const detail = json.error_description || res.statusText || 'token request failed';
    throw new Error(detail);
  }
  return { access_token: json.access_token, expires_in: json.expires_in };
}

async function getGraphAccessTokenCached(): Promise<string> {
  const now = Date.now();
  if (graphTokenCache && graphTokenCache.expiresAtMs > now + 60_000) {
    return graphTokenCache.token;
  }
  const t = await fetchGraphAccessToken();
  const ttlSec = typeof t.expires_in === 'number' ? t.expires_in : 3600;
  graphTokenCache = {
    token: t.access_token,
    expiresAtMs: now + Math.max(120, ttlSec - 120) * 1000,
  };
  return t.access_token;
}

function normalizeRecipients(to: string | string[]): Array<{ emailAddress: { address: string } }> {
  const list = Array.isArray(to) ? to : [to];
  return list
    .map((x) => x.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

async function sendViaMicrosoftGraph(params: {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: OutboundAttachment[];
}): Promise<void> {
  const sendAs = graphSendAsAddress();
  if (!sendAs) throw new Error('Graph mail: set GRAPH_MAIL_SEND_AS or SMTP_FROM / SMTP_USER');

  const token = await getGraphAccessTokenCached();
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sendAs)}/sendMail`;

  const attachments =
    params.attachments?.map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.filename,
      contentType: a.contentType || 'application/octet-stream',
      contentBytes: a.content.toString('base64'),
    })) ?? [];

  const bodyContent = params.html
    ? { contentType: 'HTML', content: params.html }
    : { contentType: 'Text', content: params.text ?? '' };

  const payload = {
    message: {
      subject: params.subject,
      body: bodyContent,
      toRecipients: normalizeRecipients(params.to),
      ...(attachments.length ? { attachments } : {}),
    },
    saveToSentItems: true,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errJson = (await res.json()) as { error?: { message?: string } };
      if (errJson?.error?.message) detail = errJson.error.message;
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Graph sendMail failed (${res.status})`);
  }
}

/**
 * Unified outbound send: Graph when `SMTP_USE_MICROSOFT_GRAPH=true`, otherwise legacy SMTP.
 * For Graph, mail is always sent **as** `GRAPH_MAIL_SEND_AS` (or SMTP_FROM / SMTP_USER); the optional
 * `from` field is ignored in Graph mode (Microsoft ties identity to the mailbox in the URL).
 */
export async function sendOutboundMail(params: {
  /** Ignored when using Microsoft Graph (sender is the configured mailbox). */
  from?: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: OutboundAttachment[];
}): Promise<void> {
  if (config.smtpUseMicrosoftGraph) {
    if (!graphMailReady()) {
      throw new Error(
        'Microsoft Graph mail is enabled but MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET or sender mailbox is missing.'
      );
    }
    await sendViaMicrosoftGraph(params);
    return;
  }

  if (!legacySmtpConfigured()) {
    throw new Error('SMTP not configured');
  }

  const transporter = getTransport();
  const from = params.from ?? getFrom();
  await transporter.sendMail({
    from,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
    attachments:
      params.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })) ?? undefined,
  });
}

export async function verifySmtp(): Promise<{ ok: boolean; error?: string }> {
  if (!isSmtpConfigured()) return { ok: false, error: 'SMTP not configured' };

  if (config.smtpUseMicrosoftGraph) {
    try {
      await getGraphAccessTokenCached();
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Graph token failed';
      return { ok: false, error: msg };
    }
  }

  try {
    const transporter = getTransport();
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SMTP verify failed';
    return { ok: false, error: msg };
  }
}

export async function sendTestEmail(params: { to: string }): Promise<{ sent: boolean; error?: string }> {
  if (!isSmtpConfigured()) return { sent: false, error: 'SMTP not configured' };
  try {
    await sendOutboundMail({
      to: params.to,
      subject: '[HALO] SMTP test email',
      text: `If you received this, outbound mail is configured correctly for HALO.\n\nSent at: ${new Date().toISOString()}\n`,
    });
    return { sent: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SMTP send failed';
    return { sent: false, error: msg };
  }
}

export async function sendInviteEmail(params: {
  to: string;
  invitedByEmail?: string | null;
  inviteUrl: string;
  role: 'admin' | 'user';
}): Promise<{ sent: boolean; reason?: string }> {
  if (!isSmtpConfigured()) {
    return { sent: false, reason: 'SMTP not configured' };
  }

  const subject = `[HALO] You’re invited to HALO`;
  const text = [
    `You have been invited to HALO.`,
    ``,
    params.invitedByEmail ? `Invited by: ${params.invitedByEmail}` : '',
    `Role: ${params.role}`,
    ``,
    `Activate your account and set your password:`,
    params.inviteUrl,
    ``,
    `This link will expire. If it does, ask the admin to resend your invite.`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    await sendOutboundMail({
      to: params.to,
      subject,
      text,
    });
    return { sent: true };
  } catch {
    return { sent: false, reason: 'Send failed' };
  }
}
