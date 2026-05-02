import type { AdmittedPatientKanban, KanbanTodoItem, Patient } from '../../../../shared/types';
import { getSupabaseBrowserClient } from '../../lib/supabaseClient';

const KANBAN_TODO_OPEN = 'To do';
const KANBAN_TODO_DONE = 'Done';

function taskStatusToDb(status: string): 'open' | 'done' {
  return status === KANBAN_TODO_DONE ? 'done' : 'open';
}

function taskStatusFromDb(status: string): string {
  return status === 'done' ? KANBAN_TODO_DONE : KANBAN_TODO_OPEN;
}

type PatientEmbed = {
  id: string;
  halo_patient_id: string | null;
  full_name: string;
  dob: string | null;
  sex: string | null;
};

type BoardEntryRow = {
  id: string;
  ward_column_id: string;
  admitted: boolean;
  sort_order: number;
  bed: string | null;
  ward_label: string | null;
  notes: string | null;
  tags: string[] | null;
  patients: PatientEmbed | PatientEmbed[] | null;
  ward_tasks: Array<{
    id: string;
    title: string;
    status: string;
    created_at: string;
    updated_at: string;
  }> | null;
};

function relOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export type WardColumnRow = { id: string; label: string; sort_order: number };

export async function fetchWardBoardColumns(): Promise<Array<{ id: string; label: string }>> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('ward_columns')
    .select('id, label, sort_order')
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as WardColumnRow[];
  return rows.map(({ id, label }) => ({ id, label }));
}

export async function fetchWardKanbanFromSupabase(): Promise<AdmittedPatientKanban[]> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('board_entries')
    .select(
      `
      id,
      ward_column_id,
      admitted,
      sort_order,
      bed,
      ward_label,
      notes,
      tags,
      patients!inner (
        id,
        halo_patient_id,
        full_name,
        dob,
        sex
      ),
      ward_tasks (
        id,
        title,
        status,
        created_at,
        updated_at
      )
    `
    )
    .order('ward_column_id', { ascending: true })
    .order('sort_order', { ascending: true });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as BoardEntryRow[];
  const kanban: AdmittedPatientKanban[] = [];

  for (const row of rows) {
    const p = relOne(row.patients);
    if (!p) continue;
    const patientId = p.halo_patient_id?.trim() || p.id;
    const todos: KanbanTodoItem[] = (row.ward_tasks ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      status: taskStatusFromDb(t.status),
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    }));

    const tags = Array.isArray(row.tags)
      ? row.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim().toLowerCase()).filter(Boolean)
      : [];

    const bed = typeof row.bed === 'string' && row.bed.trim() ? row.bed.trim().slice(0, 40) : undefined;
    const wardLabel =
      typeof row.ward_label === 'string' && row.ward_label.trim()
        ? row.ward_label.trim().slice(0, 80)
        : undefined;
    const notes =
      typeof row.notes === 'string' && row.notes.trim() ? row.notes.trim().slice(0, 4000) : undefined;

    kanban.push({
      patientId,
      admitted: row.admitted,
      boardColumn: row.ward_column_id as AdmittedPatientKanban['boardColumn'],
      columnOrder: row.sort_order,
      ...(tags.length ? { tags } : {}),
      ...(bed ? { bed } : {}),
      ...(wardLabel ? { wardLabel } : {}),
      ...(notes ? { notes } : {}),
      todos,
    });
  }

  return kanban;
}

/**
 * Full replace of board state from the in-memory kanban model (matches prior JSON file behaviour).
 * Requires halo_patient_id on each row’s patientId for HALO-linked patients.
 */
export async function saveWardKanbanToSupabase(
  kanban: AdmittedPatientKanban[],
  patients: Patient[]
): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error('Supabase is not configured.');

  const byHaloId = new Map(patients.map((p) => [p.id, p] as const));
  const clientPatientIds = new Set(kanban.map((k) => k.patientId));

  const { data: existingEntries, error: exErr } = await supabase.from('board_entries').select(
    `
    id,
    patients!inner ( halo_patient_id )
  `
  );
  if (exErr) throw new Error(exErr.message);

  type Ex = { id: string; patients: { halo_patient_id: string | null } | { halo_patient_id: string | null }[] };
  for (const ex of (existingEntries ?? []) as Ex[]) {
    const pe = relOne(ex.patients);
    const hid = pe?.halo_patient_id?.trim();
    if (!hid || !clientPatientIds.has(hid)) {
      const { error: delErr } = await supabase.from('board_entries').delete().eq('id', ex.id);
      if (delErr) throw new Error(delErr.message);
    }
  }

  const { data: columnRows, error: colErr } = await supabase
    .from('ward_columns')
    .select('id, sort_order')
    .order('sort_order', { ascending: true });
  if (colErr) throw new Error(colErr.message);
  const columnOrder = ((columnRows ?? []) as { id: string }[]).map((c) => c.id);
  const defaultCol = columnOrder.includes('m') ? 'm' : columnOrder[0] ?? 'm';

  const byColumn = new Map<string, AdmittedPatientKanban[]>();
  for (const row of kanban) {
    const col = row.boardColumn && columnOrder.includes(row.boardColumn) ? row.boardColumn : defaultCol;
    if (!byColumn.has(col)) byColumn.set(col, []);
    byColumn.get(col)!.push(row);
  }

  const sortKey = (pid: string) => {
    const meta = patients.find((p) => p.id === pid);
    return (meta?.name || pid).toLowerCase();
  };
  for (const col of columnOrder) {
    const arr = byColumn.get(col);
    if (arr) {
      arr.sort((a, b) => {
        const oa = typeof a.columnOrder === 'number' ? a.columnOrder : 1e6;
        const ob = typeof b.columnOrder === 'number' ? b.columnOrder : 1e6;
        if (oa !== ob) return oa - ob;
        return sortKey(a.patientId).localeCompare(sortKey(b.patientId));
      });
    }
  }

  for (const col of columnOrder) {
    const rowsInCol = byColumn.get(col) ?? [];
    let sortIdx = 0;
    for (const row of rowsInCol) {
      const meta = byHaloId.get(row.patientId);
      const fullName = meta?.name?.trim() || 'Patient';
      const dob = meta?.dob ?? null;
      const sex = meta?.sex ?? null;

      const { data: patRow, error: pErr } = await supabase
        .from('patients')
        .upsert(
          {
            halo_patient_id: row.patientId,
            full_name: fullName,
            dob,
            sex,
          },
          { onConflict: 'halo_patient_id' }
        )
        .select('id')
        .single();

      if (pErr) throw new Error(pErr.message);
      const patientUuid = patRow?.id as string;

      const tagList = Array.isArray(row.tags)
        ? row.tags
            .filter((t): t is string => typeof t === 'string')
            .map((t) => t.trim().toLowerCase().slice(0, 40))
            .filter(Boolean)
            .filter((t, i, a) => a.indexOf(t) === i)
            .slice(0, 20)
        : [];

      const boardBed =
        typeof row.bed === 'string' && row.bed.trim() ? row.bed.trim().slice(0, 40) : null;
      const boardWardLabel =
        typeof row.wardLabel === 'string' && row.wardLabel.trim()
          ? row.wardLabel.trim().slice(0, 80)
          : null;
      const boardNotes =
        typeof row.notes === 'string' && row.notes.trim() ? row.notes.trim().slice(0, 4000) : null;

      const { data: entryRow, error: eErr } = await supabase
        .from('board_entries')
        .upsert(
          {
            patient_id: patientUuid,
            ward_column_id: col,
            admitted: row.admitted,
            sort_order: sortIdx,
            tags: tagList,
            bed: boardBed,
            ward_label: boardWardLabel,
            notes: boardNotes,
          },
          { onConflict: 'patient_id' }
        )
        .select('id')
        .single();

      if (eErr) throw new Error(eErr.message);
      const entryId = entryRow?.id as string;

      const { error: delTasksErr } = await supabase.from('ward_tasks').delete().eq('board_entry_id', entryId);
      if (delTasksErr) throw new Error(delTasksErr.message);

      const todos = Array.isArray(row.todos) ? row.todos : [];
      if (todos.length > 0) {
        const payload = todos.map((t) => ({
          id: t.id,
          board_entry_id: entryId,
          title: t.title.slice(0, 500),
          status: taskStatusToDb(t.status || KANBAN_TODO_OPEN),
          created_at: t.createdAt ?? new Date().toISOString(),
          updated_at: t.updatedAt ?? new Date().toISOString(),
        }));
        const { error: insErr } = await supabase.from('ward_tasks').insert(payload);
        if (insErr) throw new Error(insErr.message);
      }

      sortIdx += 1;
    }
  }
}
