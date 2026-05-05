import type { AdmittedPatientKanban, Patient } from '../../../shared/types';
import { isSupabaseConfigured } from '../lib/supabaseClient';
import { fetchDoctorKanban, saveDoctorKanban } from './api';
import {
  fetchWardBoardColumns,
  fetchWardKanbanFromSupabase,
  saveWardKanbanToSupabase,
} from './wardBoard/wardBoardSupabase';
import { getActiveWorkspaceId } from './workspace';

export { fetchWardBoardColumns };

function activeWorkspaceSlug(): string {
  return getActiveWorkspaceId().trim() || 'halo_patients';
}

/**
 * Ward kanban persistence: Supabase when VITE_SUPABASE_* is set, otherwise legacy Drive/Graph JSON file.
 */
export async function fetchWardKanban(): Promise<AdmittedPatientKanban[]> {
  if (isSupabaseConfigured()) {
    return fetchWardKanbanFromSupabase(activeWorkspaceSlug());
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
    const slug = activeWorkspaceSlug();
    await saveWardKanbanToSupabase(kanban, patients, slug);
    return fetchWardKanbanFromSupabase(slug);
  }
  const { kanban: saved } = await saveDoctorKanban(kanban);
  return Array.isArray(saved) ? saved : kanban;
}
