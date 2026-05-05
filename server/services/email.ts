import nodemailer from 'nodemailer';
import { config } from '../config';

export function isSmtpConfigured(): boolean {
  return Boolean(config.smtpHost && config.smtpUser && config.smtpPass);
}

function getFrom(): string {
  const addr = (config.smtpFrom || config.smtpUser || '').trim();
  const name = (config.smtpFromName || 'HALO').trim();
  if (!addr) return '';
  // Keep it simple and robust; nodemailer will format as needed.
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

export async function verifySmtp(): Promise<{ ok: boolean; error?: string }> {
  if (!isSmtpConfigured()) return { ok: false, error: 'SMTP not configured' };
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
    const transporter = getTransport();
    const from = getFrom();
    await transporter.sendMail({
      from,
      to: params.to,
      subject: '[HALO] SMTP test email',
      text: `If you received this, SMTP is configured correctly for HALO.\n\nSent at: ${new Date().toISOString()}\n`,
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
  const transporter = getTransport();
  const from = getFrom();
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

  await transporter.sendMail({
    from,
    to: params.to,
    subject,
    text,
  });
  return { sent: true };
}

