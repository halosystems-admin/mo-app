import type { Patient } from '../../../shared/types';
import type { ClinicalTaskIndicator, InpatientRecord } from '../types/clinical';
import type { AdmittedPatientKanban, KanbanTodoItem } from '../../../shared/types';
import { resolvePatientIdFromClinicalNames } from '../features/clinical/shared/clinicalDisplay';
import { clinicalWardToBoardColumn, fetchCurrentInpatients } from './clinicalData';
import { fetchWardKanban, saveWardKanban } from './wardBoardBackend';

/** Kanban column fed from Hospital admission "Tasks" field. */
export const KANBAN_FROM_ADMISSION_COLUMN = 'To do';

export function mergeKanbanToDoFromClinicalIndicators(
  row: AdmittedPatientKanban,
  indicators: ClinicalTaskIndicator[],
  todoColumn: string = KANBAN_FROM_ADMISSION_COLUMN
): AdmittedPatientKanban {
  const todos = Array.isArray(row.todos) ? row.todos : [];
  const elsewhere = todos.filter((t) => t.status !== todoColumn);
  const previousInColumn = todos.filter((t) => t.status === todoColumn);
  const byTitle = new Map(previousInColumn.map((t) => [t.title.trim().toLowerCase(), t]));
  const now = new Date().toISOString();
  const rebuilt: KanbanTodoItem[] = [];
  for (const ind of indicators) {
    const title = ind.label.trim().slice(0, 200);
    if (!title) continue;
    const key = title.toLowerCase();
    const prev = byTitle.get(key);
    if (prev) {
      rebuilt.push({ ...prev, updatedAt: now });
    } else {
      rebuilt.push({
        id: crypto.randomUUID(),
        title,
        status: todoColumn,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  return { ...row, admitted: true, todos: [...elsewhere, ...rebuilt] };
}

export type SyncInpatientTasksResult =
  | { outcome: 'synced'; patientId: string }
  | { outcome: 'skipped_not_admitted' }
  | { outcome: 'skipped_no_halo_patient'; message: string }
  | { outcome: 'error'; message: string };

/**
 * When an admission is marked currently admitted, push Tasks (comma-separated in UI)
 * into that HALO patient's Ward kanban **To do** list. Completed (**Done**) items are left as-is.
 */
export async function syncInpatientTasksToWardKanban(
  record: InpatientRecord,
  patients: Patient[]
): Promise<SyncInpatientTasksResult> {
  if (!record.currentlyAdmitted) {
    return { outcome: 'skipped_not_admitted' };
  }
  const patientId =
    record.linkedDrivePatientId?.trim() ||
    resolvePatientIdFromClinicalNames(patients, record.firstName, record.surname);
  if (!patientId) {
    return {
      outcome: 'skipped_no_halo_patient',
      message:
        'Add a HALO patient whose name matches this admission (First Last or Last, First) to sync tasks to Ward.',
    };
  }
  try {
    const k = await fetchWardKanban();
    const list: AdmittedPatientKanban[] = Array.isArray(k) ? [...k] : [];
    const idx = list.findIndex((r) => r.patientId === patientId);
    let row: AdmittedPatientKanban =
      idx >= 0 ? { ...list[idx], admitted: true } : { patientId, admitted: true, todos: [] };
    row = mergeKanbanToDoFromClinicalIndicators(row, record.taskIndicators ?? []);
    row = { ...row, boardColumn: row.boardColumn ?? clinicalWardToBoardColumn(record.ward) };
    if (idx >= 0) list[idx] = row;
    else list.push(row);
    await saveWardKanban(list, patients);
    return { outcome: 'synced', patientId };
  } catch {
    return { outcome: 'error', message: 'Could not update Ward kanban — check your connection.' };
  }
}

/**
 * Batch-merge every **currently admitted** mock inpatient’s Ward To do into the kanban (one save).
 * Use from Ward **Pull from Hospital** so the board matches Hospital without re-saving each profile.
 */
export async function syncAllHospitalWardTasksToKanban(
  patients: Patient[]
): Promise<{ linked: number; skippedNoHaloMatch: number }> {
  const rows = await fetchCurrentInpatients();
  const k = await fetchWardKanban();
  let list: AdmittedPatientKanban[] = Array.isArray(k) ? [...k] : [];
  let linked = 0;
  let skippedNoHaloMatch = 0;

  for (const record of rows) {
    if (!record.currentlyAdmitted) continue;
    const patientId =
      record.linkedDrivePatientId?.trim() ||
      resolvePatientIdFromClinicalNames(patients, record.firstName, record.surname);
    if (!patientId) {
      skippedNoHaloMatch++;
      continue;
    }
    const idx = list.findIndex((r) => r.patientId === patientId);
    let row: AdmittedPatientKanban =
      idx >= 0 ? { ...list[idx], admitted: true } : { patientId, admitted: true, todos: [] };
    const indicators = record.taskIndicators ?? [];
    if (indicators.length > 0) {
      row = mergeKanbanToDoFromClinicalIndicators(row, indicators);
    }
    row = { ...row, boardColumn: row.boardColumn ?? clinicalWardToBoardColumn(record.ward) };
    if (idx >= 0) list[idx] = row;
    else list.push(row);
    linked++;
  }

  await saveWardKanban(list, patients);
  return { linked, skippedNoHaloMatch };
}
