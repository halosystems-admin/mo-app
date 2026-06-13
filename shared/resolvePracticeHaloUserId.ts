import { HENK_HALO_USER_ID, MO_HALO_USER_ID } from './clinicalTemplates/constants';

/** Henk signs in with this Gmail only (see config.henkOutboundEmail on server). */
export const HENK_LOGIN_EMAIL = 'hjkrugersurgery@gmail.com';

/** Known Henk practice sign-ins (Gmail + OneDrive root folder name). */
export function isHenkPracticeIdentity(params: {
  email?: string | null;
  driveRootFolderName?: string | null;
  /** Defaults to {@link HENK_LOGIN_EMAIL} */
  henkLoginEmail?: string;
}): boolean {
  const email = (params.email ?? '').trim().toLowerCase();
  const driveRoot = (params.driveRootFolderName ?? '').trim().toLowerCase();
  const henkEmail = (params.henkLoginEmail ?? HENK_LOGIN_EMAIL).trim().toLowerCase();
  if (email && email === henkEmail) return true;
  return driveRoot === 'henk kruger';
}

/**
 * Resolve bundled-template Halo user id for Mo/Henk local note generation.
 * Matches server `resolveHaloUserId` defaults so client and server use the same templates.
 */
export function resolvePracticeHaloUserId(params: {
  haloUserId?: string | null;
  email?: string | null;
  driveRootFolderName?: string | null;
  henkLoginEmail?: string;
}): string {
  const explicit = params.haloUserId?.trim();
  if (explicit) return explicit;
  if (
    isHenkPracticeIdentity({
      email: params.email,
      driveRootFolderName: params.driveRootFolderName,
      henkLoginEmail: params.henkLoginEmail,
    })
  ) {
    return HENK_HALO_USER_ID;
  }
  return MO_HALO_USER_ID;
}
