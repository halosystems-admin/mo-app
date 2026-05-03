import type { ExtractedPatientSticker, HaloPatientProfile } from '../../../shared/types';
import { getPatientHaloProfile, uploadPatientHaloProfile } from './api';

function pick(next: string | undefined, prev: string | undefined): string {
  const n = next?.trim();
  if (n) return n;
  return (prev ?? '').trim();
}

/** Merge sticker OCR into HALO_patient_profile.json (preserves existing non-empty fields when OCR is blank). */
export async function mergeStickerExtractionIntoDriveProfile(
  patientFolderId: string,
  ex: ExtractedPatientSticker
): Promise<void> {
  const existing = await getPatientHaloProfile(patientFolderId);
  const fullName = pick(ex.name, existing?.fullName);
  let sex: 'M' | 'F' = existing?.sex ?? 'M';
  if (ex.sex === 'M' || ex.sex === 'F') sex = ex.sex;

  const profile: HaloPatientProfile = {
    version: 1,
    fullName,
    dob: pick(ex.dob, existing?.dob),
    sex,
    email: pick(ex.email, existing?.email) || undefined,
    idNumber: pick(ex.idNumber, existing?.idNumber) || undefined,
    folderNumber: pick(ex.folderNumber, existing?.folderNumber) || undefined,
    ward: pick(ex.ward, existing?.ward) || undefined,
    medicalAidName: pick(ex.medicalAidName, existing?.medicalAidName) || undefined,
    medicalAidPackage: pick(ex.medicalAidPackage, existing?.medicalAidPackage) || undefined,
    medicalAidMemberNumber: pick(ex.medicalAidMemberNumber, existing?.medicalAidMemberNumber) || undefined,
    medicalAidPhone: pick(ex.medicalAidPhone, existing?.medicalAidPhone) || undefined,
    rawNotes: pick(ex.rawNotes, existing?.rawNotes) || undefined,
    updatedAt: new Date().toISOString(),
  };

  await uploadPatientHaloProfile(patientFolderId, profile);
}
