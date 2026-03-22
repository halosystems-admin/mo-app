/**
 * Halo user and note template IDs for this deployment (Mo app).
 * IDs must match Firebase / Halo Functions for this user.
 */
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
