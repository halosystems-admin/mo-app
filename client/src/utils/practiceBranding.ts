import type { CurrentUser } from '../services/api';

type UserLike = Pick<CurrentUser, 'firstName' | 'lastName' | 'email'> | null | undefined;

/** Mo's app login often stores first name as "Mo"; show full formal name in UI. */
function moPatelDisplayNameParts(user: NonNullable<UserLike>): { firstName: string; lastName: string } | null {
  const email = (user.email || '').toLowerCase().trim();
  const fn = (user.firstName || '').trim();
  const ln = (user.lastName || '').trim();
  if (email === 'mo@practice.halo.africa') return { firstName: 'Mohamed', lastName: 'Patel' };
  if (fn.toLowerCase() === 'mo' && ln.toLowerCase() === 'patel') return { firstName: 'Mohamed', lastName: 'Patel' };
  return null;
}

/** Full name for account line (no "Dr" prefix); used where raw `firstName`/`lastName` are shown. */
export function displayDoctorLegalName(user: UserLike): string {
  if (!user) return '';
  const mo = moPatelDisplayNameParts(user);
  if (mo) return `${mo.firstName} ${mo.lastName}`.trim();
  const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return name || user.email?.trim() || '';
}

/** “Dr First Last” for sidebar / watermarks; falls back to email or HALO */
export function formatDoctorSidebarTitle(user: UserLike): string {
  if (!user) return 'HALO';
  const mo = moPatelDisplayNameParts(user);
  if (mo) return `Dr ${mo.firstName} ${mo.lastName}`;
  const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  if (name) return `Dr ${name}`;
  return user.email?.trim() || 'HALO';
}

export function isLikelyKrugerAccount(user: Pick<CurrentUser, 'firstName' | 'lastName' | 'email'>): boolean {
  const ln = (user.lastName || '').toLowerCase();
  const em = (user.email || '').toLowerCase();
  return (
    em === 'henk@halo.africa' ||
    ln.includes('kruger') ||
    em.includes('kruger') ||
    em.includes('henk')
  );
}

/** Large centre / watermark image: Kruger → HK circle mark; default → existing MP-style mark */
export function getPracticeMarkImageSrc(user: UserLike): string {
  if (user && isLikelyKrugerAccount(user)) return '/hk-mark.png';
  return '/halo-logo.png';
}
