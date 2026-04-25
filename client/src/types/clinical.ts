/** Mock clinical / inpatient types — future Supabase can mirror these shapes. */

export type ClinicalWard =
  | 'ICU'
  | 'F-ward (4th)'
  | 'S-ward (5th)'
  | 'medical ward'
  | 'paediatrics ward'
  | 'emergency department'
  | 'labour ward';

export type SurgeonName = 'Hoosain' | 'Stanley' | 'de Beer' | 'Strydom';

export interface ClinicalTaskIndicator {
  label: string;
  urgent?: boolean;
}

/** Sheets row status (dropdown + column filter). */
export type InpatientSheetStatus =
  | 'elective'
  | 'completed'
  | 'emergency'
  | 'outpatient endoscopy';

/** Single sheet date column: DOA = date of admission, F/U = follow-up / review date. */
export type SheetAdmissionDateKind = 'doa' | 'fu';

export interface InpatientRecord {
  id: string;
  currentlyAdmitted: boolean;
  bed: string;
  surname: string;
  firstName: string;
  admissionDiagnosis: string;
  dateOfBirth: string;
  idNumber: string;
  sex: 'M' | 'F';
  age: number;
  medicalAid: string;
  medicalAidNumber: string;
  medicalAidPhone?: string;
  ward: ClinicalWard;
  dateOfAdmission: string;
  /** Follow-up / review date (used when sheet column is set to F/U). */
  dateOfReview: string;
  /** Which date the main sheet’s single “DOA / F/U” cell edits. */
  sheetAdmissionDateKind: SheetAdmissionDateKind;
  icd10Diagnoses: string;
  procedure: string;
  procedureCodes: string;
  dateOfProcedure: string;
  complications: string;
  surgeonPlan: string;
  managementPlan: string;
  dateOfDischarge: string;
  followUpPlan: string;
  dateOfFollowUp: string;
  inpatientNotes: string;
  furtherComment: string;
  folderNumber: string;
  taskIndicators: ClinicalTaskIndicator[];
  assignedDoctor: string;
  linkedDrivePatientId?: string;
  /** Primary contact for Sheets (defaults from medical aid phone when blank). */
  contactNumber: string;
  sheetStatus: InpatientSheetStatus;
  /** When checked, Pending Vericlaim task is done. */
  taskPendingVericlaimDone: boolean;
  /** When checked, Download-a-Slip task is done. */
  taskDownloadSlipDone: boolean;
}

export interface OtherSurgeonInpatientDraft extends InpatientRecord {
  surgeon: SurgeonName;
  weekendRoundComplete: boolean;
}

export interface SurgeonRoundRow {
  id: string;
  ward: ClinicalWard;
  surname: string;
  firstName: string;
  diagnosis: string;
  bed: string;
  dateOfBirth: string;
  dateOfReview: string;
  age: number;
  sex: 'M' | 'F';
  medicalAid: string;
  medicalAidNumber: string;
  /** Patient contact for Call / SMS (from mock inpatient phone). */
  contactNumber: string;
  surgeon: SurgeonName;
  complications: string;
  surgeonPlan: string;
  managementPlan: string;
  dateOfDischarge: string;
}

export type PendingProcedureBucket =
  | 'emergencies'
  | 'elective'
  | 'endoscopy'
  | 'completed'
  | 'vericlaim'
  | 'aslip';

/** Shared by Emergencies, Elective bookings, Procedures completed (theatre pathway). */
export type BookingUrgencyLevel = 'emergency' | 'elective';

export interface TheatreBookingFields {
  surname: string;
  firstName: string;
  dateOfBirth: string;
  age: string;
  sex: 'M' | 'F';
  medicalAid: string;
  medicalAidNumber: string;
  contactNumber: string;
  urgencyOfBooking: BookingUrgencyLevel;
  diagnosis: string;
  icd10: string;
  plannedProcedure: string;
  procedureCodes: string;
  consentObtained: '' | 'Y' | 'N';
  consentPdfFileName?: string;
  consentPdfUploadedAt?: string;
  consentPdfSizeBytes?: number;
  bookedWithTheatre: '' | 'Y' | 'N';
  anaesthesiaArranged: '' | 'Y' | 'N';
  anaesthetistName: string;
  assistantArranged: '' | 'Y' | 'N';
  assistantName: string;
  status: 'pending' | 'completed' | 'cancelled';
  dateOfCompletion: string;
  startTime: string;
  endTime: string;
  weight: string;
  height: string;
  bmi: string;
  theatreSheetFileName?: string;
  theatreSheetUploadedAt?: string;
  theatreSheetSizeBytes?: number;
  dateOfPlannedProcedure: string;
}

export type VericlaimProcessPending = 'HALO' | 'Vericlaim' | 'Download A-slip';

export interface VericlaimFields {
  surname: string;
  firstName: string;
  dateOfBirth: string;
  sex: 'M' | 'F';
  age: string;
  idNumber: string;
  medicalAid: string;
  medicalAidNumber: string;
  contactNumber: string;
  ward: ClinicalWard;
  bed: string;
  dateOfAdmission: string;
  admissionDiagnosis: string;
  icd10Diagnosis: string;
  procedure: string;
  procedureCodes: string;
  dateOfProcedure: string;
  complications: string;
  inpatientNotes: string;
  dateOfDischarge: string;
  followUpPlan: string;
  dateOfFollowUp: string;
  awaitingOutpatientEndoscopy: '' | 'Y' | 'N';
  furtherComment: string;
  processPending: VericlaimProcessPending;
  followUpPending: '' | 'Y' | 'N';
  stickerFileName?: string;
  stickerUploadedAt?: string;
  stickerSizeBytes?: number;
}

/** Outpatient endoscopy list row. */
export interface EndoscopyListFields {
  surname: string;
  firstName: string;
  dateOfBirth: string;
  sex: 'M' | 'F';
  age: string;
  idNumber: string;
  medicalAid: string;
  medicalAidNumber: string;
  contactNumber: string;
  admissionDiagnosis: string;
  icd10Diagnosis: string;
  procedure: string;
  procedureCodes: string;
  dateOfProcedure: string;
  complications: string;
  inpatientNotes: string;
  dateOfDiscarded: string;
  followUpPlan: string;
  dateOfFollowUp: string;
  furtherComment: string;
  endoscopyCompleted?: '' | 'Y' | 'N';
}

/** A-slip download summary (mini patient summary). */
export interface AslipSummaryFields {
  surname: string;
  firstName: string;
  dateOfBirth: string;
  sex: 'M' | 'F';
  age: string;
  idNumber: string;
  medicalAid: string;
  medicalAidNumber: string;
  contactNumber: string;
  ward: ClinicalWard | '';
  bed: string;
  dateOfAdmission: string;
  admissionDiagnosis: string;
  icd10Diagnosis: string;
  inpatientNotes: string;
  awaitingOutpatientEndoscopy: '' | 'Y' | 'N';
  processPending: VericlaimProcessPending | '';
}

export interface PendingProcedureRow {
  id: string;
  bucket: PendingProcedureBucket;
  patientDisplayName: string;
  folderNumber?: string;
  procedure: string;
  scheduledDate?: string;
  theatre?: string;
  endoscopyCompleted?: boolean | null;
  claimStatus?: string;
  outcome?: string;
  notes?: string;
  urgency?: 'routine' | 'urgent';
  theatreBooking?: TheatreBookingFields;
  vericlaim?: VericlaimFields;
  endoscopySheet?: EndoscopyListFields;
  aslip?: AslipSummaryFields;
}

export interface ExtractedStickerData {
  firstName?: string;
  surname?: string;
  dateOfBirth?: string;
  folderNumber?: string;
  idNumber?: string;
  ward?: ClinicalWard;
}
