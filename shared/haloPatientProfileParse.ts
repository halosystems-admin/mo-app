import type { HaloPatientProfile } from './types';

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v != null ? String(v).trim() : '';
}

function coerceSex(v: unknown): 'M' | 'F' {
  const s = str(v).toUpperCase();
  if (s === 'F' || s === 'FEMALE') return 'F';
  if (s === 'M' || s === 'MALE') return 'M';
  return 'M';
}

/**
 * Parse HALO_patient_profile.json leniently (legacy or partial files).
 * Returns null only when JSON is invalid or root is not an object.
 * Normalizes to version 1 with string fields suitable for prompts and UI.
 */
export function parseHaloPatientProfileJson(text: string): HaloPatientProfile | null {
  let o: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    o = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const fullName = str(o.fullName);
  const dob = str(o.dob);
  const sex = coerceSex(o.sex);
  const updatedAt = str(o.updatedAt) || new Date().toISOString();

  return {
    version: 1,
    fullName,
    dob,
    sex,
    idNumber: str(o.idNumber) || undefined,
    folderNumber: str(o.folderNumber) || undefined,
    ward: str(o.ward) || undefined,
    medicalAidName: str(o.medicalAidName) || undefined,
    medicalAidPackage: str(o.medicalAidPackage) || undefined,
    medicalAidMemberNumber: str(o.medicalAidMemberNumber) || undefined,
    medicalAidPhone: str(o.medicalAidPhone) || undefined,
    rawNotes: str(o.rawNotes) || undefined,
    email: str(o.email) || undefined,
    updatedAt,
  };
}
