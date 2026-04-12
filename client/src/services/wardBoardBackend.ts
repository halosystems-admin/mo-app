import type { AdmittedPatientKanban, Patient } from '../../../shared/types';
import { isSupabaseConfigured } from '../lib/supabaseClient';
import { fetchDoctorKanban, saveDoctorKanban } from './api';
import {
  fetchWardBoardColumns,
  fetchWardKanbanFromSupabase,
  saveWardKanbanToSupabase,
} from './wardBoard/wardBoardSupabase';

export { fetchWardBoardColumns };

/**
 * Ward kanban persistence: Supabase when VITE_SUPABASE_* is set, otherwise legacy Drive/Graph JSON file.
 */
export async function fetchWardKanban(): Promise<AdmittedPatientKanban[]> {
  if (isSupabaseConfigured()) {
    return fetchWardKanbanFromSupabase();
  }
  const { kanban } = await fetchDoctorKanban();
  return Array.isArray(kanban) ? kanban : [];
}

/**
 * @param patients HALO folder patients — used to upsert names/dob/sex into Supabase when using DB backend.
 */
export async function saveWardKanban(
  kanban: AdmittedPatientKanban[],
  patients: Patient[]
): Promise<AdmittedPatientKanban[]> {
  if (isSupabaseConfigured()) {
    await saveWardKanbanToSupabase(kanban, patients);
    return fetchWardKanbanFromSupabase();
  }
  const { kanban: saved } = await saveDoctorKanban(kanban);
  return Array.isArray(saved) ? saved : kanban;
}
