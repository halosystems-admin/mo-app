import { config } from '../config';
import { normalizeEmail } from './userStore';

export function isHenkOutboundEmail(email: string): boolean {
  const target = config.henkOutboundEmail.trim();
  if (!target) return false;
  return normalizeEmail(email) === normalizeEmail(target);
}

export function isHenkSmtpConfigured(): boolean {
  return Boolean(config.henkSmtpHost && config.henkSmtpUser && config.henkSmtpPass);
}

export function getHenkFromHeader(): string {
  const addr = (config.henkSmtpFromEmail || config.henkSmtpUser).trim();
  const name = (config.henkSmtpFromName || 'HALO').trim();
  return name ? `${name} <${addr}>` : addr;
}
