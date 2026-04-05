import type { AdmittedPatientKanban, KanbanTodoItem, Patient, WardBoardColumnId } from '../../../shared/types';
import type {
  AslipSummaryFields,
  ClinicalWard,
  EndoscopyListFields,
  ExtractedStickerData,
  InpatientRecord,
  OtherSurgeonInpatientDraft,
  PendingProcedureBucket,
  PendingProcedureRow,
  SurgeonName,
  SurgeonRoundRow,
  TheatreBookingFields,
  VericlaimFields,
} from '../types/clinical';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

const WARDS: ClinicalWard[] = [
  'ICU',
  'F-ward (4th)',
  'S-ward (5th)',
  'medical ward',
  'paediatrics ward',
  'emergency department',
  'labour ward',
];

function ip(
  partial: Omit<InpatientRecord, 'id'> & { id: string }
): InpatientRecord {
  return { ...partial };
}

export const MOCK_INPATIENTS: InpatientRecord[] = [
  ip({
    id: 'in-1',
    currentlyAdmitted: true,
    bed: 'ICU-A1',
    surname: 'Naidoo',
    firstName: 'Priya',
    admissionDiagnosis: 'Acute cholecystitis',
    dateOfBirth: '1978-04-12',
    idNumber: '7804120080088',
    sex: 'F',
    age: 47,
    medicalAid: 'Discovery',
    medicalAidNumber: 'DISC-77821',
    medicalAidPhone: '+27821234567',
    ward: 'ICU',
    dateOfAdmission: '2026-03-28',
    icd10Diagnoses: 'K81.0',
    procedure: 'Laparoscopic cholecystectomy',
    procedureCodes: '30445',
    dateOfProcedure: '2026-03-30',
    complications: 'None',
    dateOfDischarge: '',
    followUpPlan: 'Bloods AM, physio review, OPD 2/52',
    dateOfFollowUp: '',
    inpatientNotes: 'Stable post-op.',
    furtherComment: '',
    folderNumber: 'HALO-ICU-1001',
    taskIndicators: [
      { label: 'Bloods due', urgent: true },
      { label: 'Physio', urgent: false },
      { label: 'OPD 2/52', urgent: false },
    ],
    assignedDoctor: 'Dr Patel',
  }),
  ip({
    id: 'in-2',
    currentlyAdmitted: true,
    bed: 'F4-12',
    surname: 'Venter',
    firstName: 'Willem',
    admissionDiagnosis: 'Inguinal hernia',
    dateOfBirth: '1965-11-02',
    idNumber: '6511025009087',
    sex: 'M',
    age: 60,
    medicalAid: 'Bonitas',
    medicalAidNumber: 'BON-99102',
    ward: 'F-ward (4th)',
    dateOfAdmission: '2026-03-31',
    icd10Diagnoses: 'K40.90',
    procedure: 'Mesh repair',
    procedureCodes: '49505',
    dateOfProcedure: '2026-04-01',
    complications: '',
    dateOfDischarge: '',
    followUpPlan: 'Pre-op checklist, consent, starve from midnight',
    dateOfFollowUp: '',
    inpatientNotes: 'Mobilising well.',
    furtherComment: '',
    folderNumber: 'HALO-F4-2201',
    taskIndicators: [{ label: 'Pre-op checklist', urgent: false }],
    assignedDoctor: 'Dr Hoosen',
  }),
  ip({
    id: 'in-3',
    currentlyAdmitted: true,
    bed: 'S5-08',
    surname: 'Dlamini',
    firstName: 'Thabo',
    admissionDiagnosis: 'Appendicitis',
    dateOfBirth: '1992-01-20',
    idNumber: '9201205009081',
    sex: 'M',
    age: 34,
    medicalAid: 'Fedhealth',
    medicalAidNumber: 'FH-332211',
    ward: 'S-ward (5th)',
    dateOfAdmission: '2026-04-01',
    icd10Diagnoses: 'K35.8',
    procedure: 'Appendicectomy',
    procedureCodes: '44950',
    dateOfProcedure: '2026-04-01',
    complications: 'None',
    dateOfDischarge: '',
    followUpPlan: 'FBC/CRP trend, GP 1/52 wound check',
    dateOfFollowUp: '',
    inpatientNotes: 'Oral diet.',
    furtherComment: '',
    folderNumber: 'HALO-S5-3300',
    taskIndicators: [
      { label: 'FBC and CRP today', urgent: true },
      { label: 'GP review 1/52 — wound and diet', urgent: false },
    ],
    assignedDoctor: 'Dr Stanley',
  }),
  ip({
    id: 'in-4',
    currentlyAdmitted: false,
    bed: 'MW-03',
    surname: 'Pillay',
    firstName: 'Anesh',
    admissionDiagnosis: 'Pneumonia',
    dateOfBirth: '1955-07-08',
    idNumber: '5507085009083',
    sex: 'M',
    age: 70,
    medicalAid: 'GEMS',
    medicalAidNumber: 'GEMS-44100',
    ward: 'medical ward',
    dateOfAdmission: '2026-03-15',
    icd10Diagnoses: 'J18.9',
    procedure: 'N/A',
    procedureCodes: '',
    dateOfProcedure: '',
    complications: '',
    dateOfDischarge: '2026-03-22',
    followUpPlan: '',
    dateOfFollowUp: '',
    inpatientNotes: 'Resolved.',
    furtherComment: 'Historical admission',
    folderNumber: 'HALO-MW-1100',
    taskIndicators: [{ label: 'Repeat CXR OPD', urgent: false }],
    assignedDoctor: 'Dr de Beer',
  }),
  ip({
    id: 'in-5',
    currentlyAdmitted: true,
    bed: 'PED-02',
    surname: 'Botha',
    firstName: 'Emma',
    admissionDiagnosis: 'Post tonsillectomy bleed',
    dateOfBirth: '2018-09-14',
    idNumber: '1809145009080',
    sex: 'F',
    age: 7,
    medicalAid: 'Medshield',
    medicalAidNumber: 'MS-88221',
    ward: 'paediatrics ward',
    dateOfAdmission: '2026-04-02',
    icd10Diagnoses: 'T81.0',
    procedure: 'Tonsillectomy',
    procedureCodes: '42820',
    dateOfProcedure: '2026-03-29',
    complications: 'Minor bleed',
    dateOfDischarge: '',
    followUpPlan: 'ENT review 2/52, analgesia chart',
    dateOfFollowUp: '',
    inpatientNotes: 'Obs stable.',
    furtherComment: '',
    folderNumber: 'HALO-PED-500',
    taskIndicators: [
      { label: 'Obs chart', urgent: true },
      { label: 'ENT follow-up', urgent: false },
    ],
    assignedDoctor: 'Dr Strydom',
  }),
  ip({
    id: 'in-6',
    currentlyAdmitted: true,
    bed: 'ED-01',
    surname: 'Khumalo',
    firstName: 'Sipho',
    admissionDiagnosis: 'Trauma — femur',
    dateOfBirth: '1989-12-01',
    idNumber: '8912015009085',
    sex: 'M',
    age: 36,
    medicalAid: 'None',
    medicalAidNumber: 'Cash',
    ward: 'emergency department',
    dateOfAdmission: '2026-04-02',
    icd10Diagnoses: 'S72.00',
    procedure: 'IM nail',
    procedureCodes: '27495',
    dateOfProcedure: '',
    complications: '',
    dateOfDischarge: '',
    followUpPlan: 'Orthopaedics review, DVT prophylaxis, physio when cleared',
    dateOfFollowUp: '',
    inpatientNotes: 'Awaiting theatre slot.',
    furtherComment: '',
    folderNumber: 'HALO-ED-77',
    taskIndicators: [
      { label: 'Orth review', urgent: true },
      { label: 'Cross-match bloods today', urgent: true },
    ],
    assignedDoctor: 'Dr Patel',
  }),
  ip({
    id: 'in-7',
    currentlyAdmitted: true,
    bed: 'LW-05',
    surname: 'Mokoena',
    firstName: 'Lerato',
    admissionDiagnosis: 'Elective CS',
    dateOfBirth: '1993-05-18',
    idNumber: '9305180080081',
    sex: 'F',
    age: 32,
    medicalAid: 'Momentum',
    medicalAidNumber: 'MM-221100',
    ward: 'labour ward',
    dateOfAdmission: '2026-04-02',
    icd10Diagnoses: 'O82',
    procedure: 'Caesarean section',
    procedureCodes: '59514',
    dateOfProcedure: '2026-04-02',
    complications: 'None',
    dateOfDischarge: '',
    followUpPlan: 'Wound check 1/52, contraception counselling',
    dateOfFollowUp: '',
    inpatientNotes: 'BF established.',
    furtherComment: '',
    folderNumber: 'HALO-LW-900',
    taskIndicators: [{ label: 'Wound check 1/52', urgent: false }],
    assignedDoctor: 'Dr Hoosen',
  }),
];

function buildMockRounds(): SurgeonRoundRow[] {
  return MOCK_INPATIENTS.filter((x) => x.currentlyAdmitted).map((p, i) => ({
    id: `rnd-${p.id}`,
    ward: p.ward,
    surname: p.surname,
    firstName: p.firstName,
    diagnosis: p.admissionDiagnosis,
    bed: p.bed,
    dateOfBirth: p.dateOfBirth,
    dateOfReview: `2026-04-0${(i % 5) + 1}`,
    age: p.age,
    sex: p.sex,
    medicalAid: p.medicalAid,
    medicalAidNumber: p.medicalAidNumber,
    contactNumber: p.medicalAidPhone ?? '',
    surgeon: (['Hoosain', 'Stanley', 'de Beer', 'Strydom'] as SurgeonName[])[i % 4],
    complications: p.complications || '—',
    surgeonPlan: 'Continue current management',
    managementPlan: 'Review labs AM',
    dateOfDischarge: p.dateOfDischarge || '—',
  }));
}

/** Mutable copy for mock edits (independent of live inpatient rows after load). */
let MOCK_ROUNDS: SurgeonRoundRow[] = buildMockRounds();

const sampleTheatreBooking = (urg: 'emergency' | 'elective'): TheatreBookingFields => ({
  surname: 'Khumalo',
  firstName: 'Sipho',
  dateOfBirth: '1989-12-01',
  age: '36',
  sex: 'M',
  medicalAid: 'None',
  medicalAidNumber: 'Cash',
  contactNumber: '+2782000111',
  urgencyOfBooking: urg,
  diagnosis: 'Trauma — femur',
  icd10: 'S72.00',
  plannedProcedure: 'IM nail',
  procedureCodes: '27495',
  consentObtained: 'Y',
  bookedWithTheatre: 'N',
  anaesthesiaArranged: 'N',
  anaesthetistName: '',
  assistantArranged: 'N',
  assistantName: '',
  status: 'pending',
  dateOfCompletion: '',
  startTime: '',
  endTime: '',
  weight: '82',
  height: '178',
  bmi: '25.9',
  dateOfPlannedProcedure: '2026-04-10',
});

let MOCK_PENDING: PendingProcedureRow[] = [
  {
    id: 'pp-1',
    bucket: 'emergencies',
    patientDisplayName: 'Sipho Khumalo',
    folderNumber: 'EM-01',
    procedure: 'IM nail',
    urgency: 'urgent',
    notes: 'Theatre notified',
    theatreBooking: sampleTheatreBooking('emergency'),
  },
  {
    id: 'pp-2',
    bucket: 'elective',
    patientDisplayName: 'Willem Venter',
    folderNumber: 'HALO-F4-2201',
    procedure: 'Hernia mesh',
    scheduledDate: '2026-04-05',
    theatre: 'OT2',
    theatreBooking: sampleTheatreBooking('elective'),
  },
  {
    id: 'pp-3',
    bucket: 'endoscopy',
    patientDisplayName: 'Colonoscopy list',
    procedure: 'Diagnostic colonoscopy',
    scheduledDate: '2026-04-08',
    endoscopyCompleted: false,
    endoscopySheet: {
      surname: 'Pillay',
      firstName: 'Anesh',
      dateOfBirth: '1955-07-08',
      sex: 'M',
      age: '70',
      idNumber: '5507085009083',
      medicalAid: 'GEMS',
      medicalAidNumber: 'GEMS-44100',
      contactNumber: '+2782333444',
      admissionDiagnosis: 'Screening',
      icd10Diagnosis: 'Z12.1',
      procedure: 'Diagnostic colonoscopy',
      procedureCodes: '45378',
      dateOfProcedure: '2026-04-08',
      complications: 'None',
      inpatientNotes: 'OPD',
      dateOfDiscarded: '',
      followUpPlan: 'Results clinic',
      dateOfFollowUp: '2026-04-22',
      furtherComment: '',
      endoscopyCompleted: 'N',
    },
  },
  {
    id: 'pp-4',
    bucket: 'completed',
    patientDisplayName: 'Priya Naidoo',
    procedure: 'Lap chole',
    outcome: 'Uneventful',
    scheduledDate: '2026-03-30',
    theatreBooking: {
      ...sampleTheatreBooking('elective'),
      surname: 'Naidoo',
      firstName: 'Priya',
      plannedProcedure: 'Laparoscopic cholecystectomy',
      status: 'completed',
      dateOfCompletion: '2026-03-30',
      consentObtained: 'Y',
      bookedWithTheatre: 'Y',
      consentPdfFileName: 'Naidoo-Priya-signed-consent.pdf',
      consentPdfUploadedAt: '2026-03-28T08:15:00.000Z',
      consentPdfSizeBytes: 241_920,
    },
  },
  {
    id: 'pp-5',
    bucket: 'vericlaim',
    patientDisplayName: 'Thabo Dlamini',
    claimStatus: 'Pending coding',
    procedure: 'Appendicectomy',
    vericlaim: {
      surname: 'Dlamini',
      firstName: 'Thabo',
      dateOfBirth: '1992-01-20',
      sex: 'M',
      age: '34',
      idNumber: '9201205009081',
      medicalAid: 'Fedhealth',
      medicalAidNumber: 'FH-332211',
      contactNumber: '+2782555666',
      ward: 'S-ward (5th)',
      bed: 'S5-08',
      dateOfAdmission: '2026-04-01',
      admissionDiagnosis: 'Appendicitis',
      icd10Diagnosis: 'K35.8',
      procedure: 'Appendicectomy',
      procedureCodes: '44950',
      dateOfProcedure: '2026-04-01',
      complications: 'None',
      inpatientNotes: 'Oral diet',
      dateOfDischarge: '',
      followUpPlan: 'GP review',
      dateOfFollowUp: '2026-04-10',
      awaitingOutpatientEndoscopy: 'N',
      furtherComment: '',
      processPending: 'Vericlaim',
      followUpPending: 'N',
      stickerFileName: 'Dlamini-Thabo-ward-sticker.jpg',
      stickerUploadedAt: '2026-04-01T11:00:00.000Z',
      stickerSizeBytes: 98_304,
    },
  },
  {
    id: 'pp-6',
    bucket: 'aslip',
    patientDisplayName: 'A-slip — batch',
    procedure: 'A-slip authorization',
    notes: 'Download sample',
    aslip: {
      surname: 'Mokoena',
      firstName: 'Lerato',
      dateOfBirth: '1993-05-18',
      sex: 'F',
      age: '32',
      idNumber: '9305180080081',
      medicalAid: 'Momentum',
      medicalAidNumber: 'MM-221100',
      contactNumber: '+2782777888',
      ward: 'labour ward',
      bed: 'LW-05',
      dateOfAdmission: '2026-04-02',
      admissionDiagnosis: 'Elective CS',
      icd10Diagnosis: 'O82',
      inpatientNotes: 'BF established',
      awaitingOutpatientEndoscopy: 'N',
      processPending: 'HALO',
    },
  },
];

export function getClinicalWards(): ClinicalWard[] {
  return [...WARDS];
}

/** Maps Hospital ward to the matching board column. */
export function clinicalWardToBoardColumn(w: ClinicalWard): WardBoardColumnId {
  switch (w) {
    case 'ICU':
      return 'icu';
    case 'F-ward (4th)':
      return 'f';
    case 'S-ward (5th)':
      return 's';
    case 'medical ward':
      return 'm';
    case 'paediatrics ward':
      return 'paeds';
    case 'emergency department':
      return 'ed';
    case 'labour ward':
      return 'labour';
    default:
      return 'other';
  }
}

export function findInpatientMatchingHaloPatient(
  haloPatient: Patient | undefined,
  inpatients: InpatientRecord[]
): InpatientRecord | undefined {
  if (!haloPatient) return undefined;
  const linked = inpatients.find((i) => i.linkedDrivePatientId === haloPatient.id);
  if (linked) return linked;
  const n = haloPatient.name.trim().toLowerCase();
  return inpatients.find((i) => {
    const a = `${i.firstName} ${i.surname}`.toLowerCase();
    const b = `${i.surname}, ${i.firstName}`.toLowerCase();
    return a === n || b === n;
  });
}

export async function fetchCurrentInpatients(): Promise<InpatientRecord[]> {
  await delay(180);
  return clone(MOCK_INPATIENTS.filter((x) => x.currentlyAdmitted));
}

export async function fetchAdmissionsAll(): Promise<InpatientRecord[]> {
  await delay(180);
  return clone(MOCK_INPATIENTS);
}

export interface RoundFilters {
  startDate?: string;
  endDate?: string;
  surgeon?: SurgeonName | '';
  ward?: ClinicalWard | '';
}

export async function fetchSurgeonRounds(filters: RoundFilters): Promise<SurgeonRoundRow[]> {
  await delay(180);
  let rows = clone(MOCK_ROUNDS);
  if (filters.ward) rows = rows.filter((r) => r.ward === filters.ward);
  if (filters.surgeon) rows = rows.filter((r) => r.surgeon === filters.surgeon);
  if (filters.startDate) rows = rows.filter((r) => r.dateOfReview >= filters.startDate!);
  if (filters.endDate) rows = rows.filter((r) => r.dateOfReview <= filters.endDate!);
  return rows;
}

export async function fetchPendingByBucket(bucket: PendingProcedureBucket): Promise<PendingProcedureRow[]> {
  await delay(120);
  return clone(MOCK_PENDING.filter((p) => p.bucket === bucket));
}

export async function addPendingRow(
  row: Omit<PendingProcedureRow, 'id'>
): Promise<PendingProcedureRow> {
  await delay(200);
  const created: PendingProcedureRow = { ...row, id: `pp-${Date.now()}` };
  MOCK_PENDING = [...MOCK_PENDING, created];
  return clone(created);
}

function mergePendingRow(base: PendingProcedureRow, patch: Partial<PendingProcedureRow>): PendingProcedureRow {
  const next: PendingProcedureRow = { ...base, ...patch };
  if (patch.theatreBooking !== undefined) {
    next.theatreBooking = base.theatreBooking
      ? { ...base.theatreBooking, ...patch.theatreBooking }
      : patch.theatreBooking;
  }
  if (patch.vericlaim !== undefined) {
    next.vericlaim = base.vericlaim
      ? { ...base.vericlaim, ...patch.vericlaim }
      : patch.vericlaim;
  }
  if (patch.endoscopySheet !== undefined) {
    next.endoscopySheet = base.endoscopySheet
      ? { ...base.endoscopySheet, ...patch.endoscopySheet }
      : patch.endoscopySheet;
  }
  if (patch.aslip !== undefined) {
    next.aslip = base.aslip ? { ...base.aslip, ...patch.aslip } : patch.aslip;
  }
  return next;
}

export async function updateInpatientRecord(
  id: string,
  patch: Partial<InpatientRecord>
): Promise<InpatientRecord | null> {
  await delay(120);
  const idx = MOCK_INPATIENTS.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  MOCK_INPATIENTS[idx] = { ...MOCK_INPATIENTS[idx], ...patch } as InpatientRecord;
  return clone(MOCK_INPATIENTS[idx]);
}

export async function updateSurgeonRound(
  id: string,
  patch: Partial<SurgeonRoundRow>
): Promise<SurgeonRoundRow | null> {
  await delay(120);
  const idx = MOCK_ROUNDS.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  MOCK_ROUNDS[idx] = { ...MOCK_ROUNDS[idx], ...patch };
  return clone(MOCK_ROUNDS[idx]);
}

export async function updatePendingProcedureRow(
  id: string,
  patch: Partial<PendingProcedureRow>
): Promise<PendingProcedureRow | null> {
  await delay(120);
  const idx = MOCK_PENDING.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  MOCK_PENDING[idx] = mergePendingRow(MOCK_PENDING[idx], patch);
  return clone(MOCK_PENDING[idx]);
}

export async function mockExtractFromSticker(file: File): Promise<ExtractedStickerData> {
  await delay(700);
  const n = file.name.toLowerCase();
  if (n.includes('icu')) {
    return {
      firstName: 'Jane',
      surname: 'Sticker',
      folderNumber: 'ICU-ST-77',
      dateOfBirth: '1982-06-15',
      ward: 'ICU',
      idNumber: '8206155009088',
    };
  }
  return {
    firstName: 'John',
    surname: 'Sticker',
    folderNumber: `FN-${Math.floor(10000 + Math.random() * 89999)}`,
    dateOfBirth: '1975-03-22',
    ward: 'S-ward (5th)',
    idNumber: '7503225009082',
  };
}

export function routeTranscriptToPatients(
  segment: string,
  list: InpatientRecord[]
): { patientId: string; displayName: string } | null {
  const lower = segment.toLowerCase();
  const scored = list
    .map((p) => {
      const full = `${p.firstName} ${p.surname}`.toLowerCase();
      const sur = p.surname.toLowerCase();
      const first = p.firstName.toLowerCase();
      let score = 0;
      if (lower.includes(full)) score += 100 + full.length;
      else if (sur.length > 2 && lower.includes(sur)) score += 50 + sur.length;
      else if (first.length > 2 && lower.includes(first)) score += 25;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return null;
  return { patientId: best.p.id, displayName: `${best.p.firstName} ${best.p.surname}` };
}

/** Split on sentence boundaries and route each fragment (ward round dictation). */
export function routeTranscriptSegments(
  text: string,
  list: InpatientRecord[]
): { patientId: string; displayName: string; segment: string }[] {
  const raw = text
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .flatMap((line) => line.split(/[.!?]+\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
  const out: { patientId: string; displayName: string; segment: string }[] = [];
  for (const segment of raw) {
    const hit = routeTranscriptToPatients(segment, list);
    if (hit) out.push({ ...hit, segment });
  }
  return out;
}

export function getInpatientById(id: string): InpatientRecord | undefined {
  return MOCK_INPATIENTS.find((p) => p.id === id);
}

function newInpatientId(): string {
  return `in-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Blank admission row for the mock Hospital sheet (before autofill). */
export function createEmptyInpatientRecord(): InpatientRecord {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: newInpatientId(),
    currentlyAdmitted: true,
    bed: '',
    surname: '',
    firstName: '',
    admissionDiagnosis: '',
    dateOfBirth: today,
    idNumber: '',
    sex: 'M',
    age: 0,
    medicalAid: '',
    medicalAidNumber: '',
    medicalAidPhone: undefined,
    ward: 'medical ward',
    dateOfAdmission: today,
    icd10Diagnoses: '',
    procedure: '',
    procedureCodes: '',
    dateOfProcedure: '',
    complications: '',
    dateOfDischarge: '',
    followUpPlan: '',
    dateOfFollowUp: '',
    inpatientNotes: '',
    furtherComment: '',
    folderNumber: '',
    taskIndicators: [],
    assignedDoctor: '',
  };
}

/** Append a new mock inpatient (in-memory until page reload). */
export async function addInpatientRecord(record: InpatientRecord): Promise<InpatientRecord> {
  await delay(120);
  const id = record.id?.trim() || newInpatientId();
  const next: InpatientRecord = { ...record, id };
  MOCK_INPATIENTS.push(next);
  return clone(next);
}

/** Merge HALO folder metadata into an admission draft (name, DOB, sex, link id). */
export function applyHaloPatientToAdmissionDraft(
  base: InpatientRecord,
  patient: Patient | null
): InpatientRecord {
  if (!patient) return { ...base, linkedDrivePatientId: undefined };
  const parts = patient.name.trim().split(/\s+/);
  const firstName = parts[0] || '';
  const surname = parts.length > 1 ? parts.slice(1).join(' ') : '';
  let age = base.age;
  if (patient.dob && /^\d{4}-\d{2}-\d{2}$/.test(patient.dob)) {
    const y = new Date(`${patient.dob}T12:00:00`);
    if (!Number.isNaN(y.getTime())) {
      age = Math.max(
        0,
        Math.floor((Date.now() - y.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
      );
    }
  }
  return {
    ...base,
    firstName,
    surname,
    dateOfBirth: patient.dob || base.dateOfBirth,
    sex: patient.sex === 'F' ? 'F' : 'M',
    age: age || base.age,
    linkedDrivePatientId: patient.id,
  };
}

/** Copy an existing demo admission as a new row (new id, optional link cleared). */
export function duplicateInpatientFromTemplate(templateId: string): InpatientRecord {
  const t = MOCK_INPATIENTS.find((p) => p.id === templateId);
  if (!t) return createEmptyInpatientRecord();
  const copy = clone(t);
  const next: InpatientRecord = {
    ...copy,
    id: newInpatientId(),
    currentlyAdmitted: true,
    dateOfAdmission: new Date().toISOString().slice(0, 10),
    linkedDrivePatientId: undefined,
  };
  return next;
}

/** All mock inpatients (admissions + current) for picklists / autofill. */
export function listMockInpatientsForPicker(): InpatientRecord[] {
  return clone(MOCK_INPATIENTS);
}

export function findInpatientAutofill(surname: string, firstName: string): InpatientRecord | undefined {
  const s = surname.trim().toLowerCase();
  const f = firstName.trim().toLowerCase();
  const exact = MOCK_INPATIENTS.find(
    (p) => p.surname.toLowerCase() === s && p.firstName.toLowerCase() === f
  );
  if (exact) return clone(exact);
  return clone(MOCK_INPATIENTS.find((p) => p.surname.toLowerCase() === s));
}

export function emptyTheatreBooking(defaultUrgency: 'emergency' | 'elective'): TheatreBookingFields {
  return {
    surname: '',
    firstName: '',
    dateOfBirth: '',
    age: '',
    sex: 'M',
    medicalAid: '',
    medicalAidNumber: '',
    contactNumber: '',
    urgencyOfBooking: defaultUrgency,
    diagnosis: '',
    icd10: '',
    plannedProcedure: '',
    procedureCodes: '',
    consentObtained: '',
    bookedWithTheatre: '',
    anaesthesiaArranged: '',
    anaesthetistName: '',
    assistantArranged: '',
    assistantName: '',
    status: 'pending',
    dateOfCompletion: '',
    startTime: '',
    endTime: '',
    weight: '',
    height: '',
    bmi: '',
    dateOfPlannedProcedure: '',
  };
}

export function inpatientToTheatreBooking(p: InpatientRecord, urg: 'emergency' | 'elective'): TheatreBookingFields {
  const base = emptyTheatreBooking(urg);
  return {
    ...base,
    surname: p.surname,
    firstName: p.firstName,
    dateOfBirth: p.dateOfBirth,
    age: String(p.age),
    sex: p.sex,
    medicalAid: p.medicalAid,
    medicalAidNumber: p.medicalAidNumber,
    contactNumber: p.medicalAidPhone || '',
    diagnosis: p.admissionDiagnosis,
    icd10: p.icd10Diagnoses,
    plannedProcedure: p.procedure,
    procedureCodes: p.procedureCodes,
    dateOfPlannedProcedure: p.dateOfProcedure,
  };
}

export function emptyVericlaim(): VericlaimFields {
  return {
    surname: '',
    firstName: '',
    dateOfBirth: '',
    sex: 'M',
    age: '',
    idNumber: '',
    medicalAid: '',
    medicalAidNumber: '',
    contactNumber: '',
    ward: 'S-ward (5th)',
    bed: '',
    dateOfAdmission: '',
    admissionDiagnosis: '',
    icd10Diagnosis: '',
    procedure: '',
    procedureCodes: '',
    dateOfProcedure: '',
    complications: '',
    inpatientNotes: '',
    dateOfDischarge: '',
    followUpPlan: '',
    dateOfFollowUp: '',
    awaitingOutpatientEndoscopy: '',
    furtherComment: '',
    processPending: 'HALO',
    followUpPending: '',
  };
}

export function inpatientToVericlaim(p: InpatientRecord): VericlaimFields {
  const v = emptyVericlaim();
  return {
    ...v,
    surname: p.surname,
    firstName: p.firstName,
    dateOfBirth: p.dateOfBirth,
    sex: p.sex,
    age: String(p.age),
    idNumber: p.idNumber,
    medicalAid: p.medicalAid,
    medicalAidNumber: p.medicalAidNumber,
    contactNumber: p.medicalAidPhone || '',
    ward: p.ward,
    bed: p.bed,
    dateOfAdmission: p.dateOfAdmission,
    admissionDiagnosis: p.admissionDiagnosis,
    icd10Diagnosis: p.icd10Diagnoses,
    procedure: p.procedure,
    procedureCodes: p.procedureCodes,
    dateOfProcedure: p.dateOfProcedure,
    complications: p.complications,
    inpatientNotes: p.inpatientNotes,
    dateOfDischarge: p.dateOfDischarge,
    followUpPlan: p.followUpPlan,
    dateOfFollowUp: p.dateOfFollowUp,
    furtherComment: p.furtherComment,
  };
}

export function emptyEndoscopySheet(): EndoscopyListFields {
  return {
    surname: '',
    firstName: '',
    dateOfBirth: '',
    sex: 'M',
    age: '',
    idNumber: '',
    medicalAid: '',
    medicalAidNumber: '',
    contactNumber: '',
    admissionDiagnosis: '',
    icd10Diagnosis: '',
    procedure: '',
    procedureCodes: '',
    dateOfProcedure: '',
    complications: '',
    inpatientNotes: '',
    dateOfDiscarded: '',
    followUpPlan: '',
    dateOfFollowUp: '',
    furtherComment: '',
    endoscopyCompleted: '',
  };
}

export function inpatientToEndoscopySheet(p: InpatientRecord): EndoscopyListFields {
  const e = emptyEndoscopySheet();
  return {
    ...e,
    surname: p.surname,
    firstName: p.firstName,
    dateOfBirth: p.dateOfBirth,
    sex: p.sex,
    age: String(p.age),
    idNumber: p.idNumber,
    medicalAid: p.medicalAid,
    medicalAidNumber: p.medicalAidNumber,
    contactNumber: p.medicalAidPhone || '',
    admissionDiagnosis: p.admissionDiagnosis,
    icd10Diagnosis: p.icd10Diagnoses,
    procedure: p.procedure,
    procedureCodes: p.procedureCodes,
    dateOfProcedure: p.dateOfProcedure,
    complications: p.complications,
    inpatientNotes: p.inpatientNotes,
    followUpPlan: p.followUpPlan,
    dateOfFollowUp: p.dateOfFollowUp,
    furtherComment: p.furtherComment,
  };
}

export function emptyAslipSummary(): AslipSummaryFields {
  return {
    surname: '',
    firstName: '',
    dateOfBirth: '',
    sex: 'M',
    age: '',
    idNumber: '',
    medicalAid: '',
    medicalAidNumber: '',
    contactNumber: '',
    ward: '',
    bed: '',
    dateOfAdmission: '',
    admissionDiagnosis: '',
    icd10Diagnosis: '',
    inpatientNotes: '',
    awaitingOutpatientEndoscopy: '',
    processPending: '',
  };
}

export function inpatientToAslipSummary(p: InpatientRecord): AslipSummaryFields {
  return {
    surname: p.surname,
    firstName: p.firstName,
    dateOfBirth: p.dateOfBirth,
    sex: p.sex,
    age: String(p.age),
    idNumber: p.idNumber,
    medicalAid: p.medicalAid,
    medicalAidNumber: p.medicalAidNumber,
    contactNumber: p.medicalAidPhone || '',
    ward: p.ward,
    bed: p.bed,
    dateOfAdmission: p.dateOfAdmission,
    admissionDiagnosis: p.admissionDiagnosis,
    icd10Diagnosis: p.icd10Diagnoses,
    inpatientNotes: p.inpatientNotes,
    awaitingOutpatientEndoscopy: '',
    processPending: 'HALO',
  };
}

export function createEmptyOtherSurgeonDraft(): OtherSurgeonInpatientDraft {
  return {
    id: 'draft',
    currentlyAdmitted: true,
    bed: '',
    surname: '',
    firstName: '',
    admissionDiagnosis: '',
    dateOfBirth: '',
    idNumber: '',
    sex: 'M',
    age: 0,
    medicalAid: '',
    medicalAidNumber: '',
    ward: 'S-ward (5th)',
    dateOfAdmission: new Date().toISOString().slice(0, 10),
    icd10Diagnoses: '',
    procedure: '',
    procedureCodes: '',
    dateOfProcedure: '',
    complications: '',
    dateOfDischarge: '',
    followUpPlan: '',
    dateOfFollowUp: '',
    inpatientNotes: '',
    furtherComment: '',
    folderNumber: '',
    taskIndicators: [],
    assignedDoctor: '',
    surgeon: 'Hoosain',
    surgeonPlan: '',
    weekendRoundComplete: false,
    managementPlan: '',
  };
}

function normalizedNameKeys(displayName: string): string[] {
  const n = displayName.trim().toLowerCase().replace(/\s+/g, ' ');
  const keys = new Set<string>();
  if (n) keys.add(n);
  if (n.includes(',')) {
    const [a, b] = n.split(',').map((s) => s.trim());
    if (a && b) keys.add(`${b} ${a}`.toLowerCase().replace(/\s+/g, ' '));
  }
  return [...keys];
}

/**
 * Task titles from the Hospital (mock) inpatient row — seeded into Diary & kanban when this Drive patient is admitted.
 * Matches patient folder name to mock first name + surname.
 */
export function getMockWardKanbanSeed(patient: Patient): string[] {
  const keys = normalizedNameKeys(patient.name);
  if (!keys.length) return [];
  for (const r of MOCK_INPATIENTS) {
    const k1 = `${r.firstName} ${r.surname}`.trim().toLowerCase().replace(/\s+/g, ' ');
    const k2 = `${r.surname}, ${r.firstName}`.trim().toLowerCase().replace(/\s+/g, ' ');
    if (keys.includes(k1) || keys.includes(k2)) {
      return r.taskIndicators.map((t) => t.label);
    }
  }
  return [];
}

/** Add missing mock seed todos to a kanban row (idempotent by title, case-insensitive). */
export function mergeAdmittedRowWithMockKanbanSeeds(
  row: AdmittedPatientKanban,
  patient: Patient | undefined,
  todoStatus: string
): AdmittedPatientKanban {
  if (!patient?.name) return row;
  const seeds = getMockWardKanbanSeed(patient);
  if (!seeds.length) return row;
  const todos = Array.isArray(row.todos) ? row.todos : [];
  const existing = new Set(todos.map((t) => t.title.trim().toLowerCase()));
  const now = new Date().toISOString();
  const additions: KanbanTodoItem[] = seeds
    .filter((s) => s.trim() && !existing.has(s.trim().toLowerCase()))
    .map((title) => ({
      id: crypto.randomUUID(),
      title: title.slice(0, 200),
      status: todoStatus,
      updatedAt: now,
      createdAt: now,
    }));
  if (!additions.length) return { ...row, admitted: true, todos };
  return { ...row, admitted: true, todos: [...todos, ...additions] };
}
