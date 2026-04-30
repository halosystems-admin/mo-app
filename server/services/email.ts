import nodemailer from 'nodemailer';
import { config } from '../config';

export function isSmtpConfigured(): boolean {
  return Boolean(config.smtpHost && config.smtpUser && config.smtpPass);
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
    from: config.smtpUser,
    to: params.to,
    subject,
    text,
  });
  return { sent: true };
}

