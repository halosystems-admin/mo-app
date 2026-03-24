/**
 * Halo user and note template IDs for this deployment (Mo app).
 * IDs must match Firebase / Halo Functions for this user.
 */

/** ─── Louis Leipoldt ──────────────────────────────────────── */
export const HALO_USER_ID = '00b70e6e-26e5-422c-bf1e-ea51c658c55c';

/** Default template when none is selected (must exist for HALO_USER_ID). */
export const DEFAULT_HALO_TEMPLATE_ID = 'outpt_consult' as const;

/** Template picker: API id + human-readable label. */
export const HALO_TEMPLATE_OPTIONS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'Admission', name: 'Admission' },
  { id: 'Colonoscopy', name: 'Colonoscopy' },
  { id: 'Gastroscopy', name: 'Gastroscopy' },
  { id: 'Inpatient_fu', name: 'Inpatient follow-up' },
  { id: 'operation', name: 'Operation' },
  { id: 'outpt_consult', name: 'Outpatient consult' },
  { id: 'script', name: 'Script' },
  { id: 'sick_note', name: 'Sick note' },
  { id: 'ward_dictation', name: 'Ward dictation' },
];

/** ─── Tygerberg ───────────────────────────────────────────── */
export const TYGERBERG_USER_ID = '68fa633b-98ad-45d4-9f44-cecd84fe2a28';

export const TYGERBERG_TEMPLATE_OPTIONS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'op_report', name: 'Op Report' },
  { id: 'acute_care', name: 'Acute Care' },
];

/** ─── Hospital registry (for UI) ─────────────────────────── */
export type HospitalKey = 'louis_leipoldt' | 'tygerberg';

export interface HospitalConfig {
  key: HospitalKey;
  label: string;
  userId: string;
  templates: ReadonlyArray<{ id: string; name: string }>;
  defaultTemplateId: string;
}

export const HOSPITALS: ReadonlyArray<HospitalConfig> = [
  {
    key: 'louis_leipoldt',
    label: 'Louis Leipoldt',
    userId: HALO_USER_ID,
    templates: HALO_TEMPLATE_OPTIONS,
    defaultTemplateId: DEFAULT_HALO_TEMPLATE_ID,
  },
  {
    key: 'tygerberg',
    label: 'Tygerberg',
    userId: TYGERBERG_USER_ID,
    templates: TYGERBERG_TEMPLATE_OPTIONS,
    defaultTemplateId: 'op_report',
  },
];

