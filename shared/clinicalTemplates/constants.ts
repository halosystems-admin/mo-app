/** Halo Firebase user ids for bundled clinical templates. */
export const MO_HALO_USER_ID = '00b70e6e-26e5-422c-bf1e-ea51c658c55c';
export const HENK_HALO_USER_ID = '27825897106';

const MO_DOC_PREFIX = `users/${MO_HALO_USER_ID}/templates`;
const HENK_DOC_PREFIX = `users/${HENK_HALO_USER_ID}/templates`;

export function docPathForHaloUser(haloUserId: string, templateId: string): string {
  const prefix =
    haloUserId === HENK_HALO_USER_ID
      ? HENK_DOC_PREFIX
      : haloUserId === MO_HALO_USER_ID
        ? MO_DOC_PREFIX
        : `users/${haloUserId}/templates`;
  return `${prefix}/${templateId}/template.docx`;
}
