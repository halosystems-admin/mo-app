import { config } from '../config';
import { isHenkOutboundEmail } from '../services/userOutboundMail';

export function resolveDriveRootFolderName(
  email: string,
  dbValue: string | null | undefined
): string | null {
  const fromDb = dbValue?.trim() || null;
  if (fromDb) return fromDb;
  if (isHenkOutboundEmail(email)) {
    return config.henkDriveRootFolderName.trim() || null;
  }
  return null;
}
