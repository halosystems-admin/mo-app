import { formatPatientDisplayName } from './patientDisplay';

/** OneDrive/Drive folder name: `Surname, Given__YYYY-MM-DD__M|F` */
export function buildPatientFolderDiskName(name: string, dob: string, sex: string): string {
  const trimmedName = String(name).trim();
  const display = formatPatientDisplayName(trimmedName) || trimmedName;
  return `${display}__${String(dob).trim()}__${String(sex).trim()}`;
}
