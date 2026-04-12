import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdmittedPatientKanban, Patient, WardBoardColumnId } from '../../../shared/types';
import { WardKanbanBoard } from '../features/clinical/ward/WardKanbanBoard';
import type { InpatientRecord } from '../types/clinical';
import { fetchCurrentInpatients, mergeAdmittedRowWithMockKanbanSeeds } from '../services/clinicalData';
import { isSupabaseConfigured } from '../lib/supabaseClient';
import { fetchWardBoardColumns, fetchWardKanban, saveWardKanban } from '../services/wardBoardBackend';
import { syncAllHospitalWardTasksToKanban } from '../services/wardKanbanSync';
import { resolvePatientIdFromClinicalNames } from '../features/clinical/shared/clinicalDisplay';
import { Layers } from 'lucide-react';
import { WARD_BOARD_COLUMNS } from '../features/clinical/shared/wardBoardColumns';
import { CLINICAL_BTN_PRIMARY } from '../features/clinical/shared/tableScrollClasses';

function migrateKanbanFromStorage(rows: AdmittedPatientKanban[]): AdmittedPatientKanban[] {
  return rows.map((r) => {
    const bc = r.boardColumn as string | undefined;
    if (bc === 'other') return { ...r, boardColumn: 'm' };
    return r;
  });
}

/** Hospital ward tasks sync into kanban; checked = Done. */
const KANBAN_TODO_OPEN = 'To do';
const KANBAN_TODO_DONE = 'Done';

interface WardPageProps {
  patients: Patient[];
  onOpenPatient: (patientId: string) => void;
  onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export const WardPage: React.FC<WardPageProps> = ({ patients, onOpenPatient, onToast }) => {
  const [kanban, setKanban] = useState<AdmittedPatientKanban[]>([]);
  const [kanbanLoading, setKanbanLoading] = useState(false);
  const [kanbanSaving, setKanbanSaving] = useState(false);
  const [hospitalSyncBusy, setHospitalSyncBusy] = useState(false);
  const [inpatients, setInpatients] = useState<InpatientRecord[]>([]);

  const patientsRef = useRef(patients);
  patientsRef.current = patients;

  const patientsById = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);

  useEffect(() => {
    void fetchCurrentInpatients().then(setInpatients);
  }, []);

  const admittedKanban = useMemo(() => kanban.filter((p) => Boolean(p.admitted)), [kanban]);

  const unlinkedAdmittedInpatients = useMemo(
    () =>
      inpatients.filter((r) => {
        if (!r.currentlyAdmitted) return false;
        const pid =
          r.linkedDrivePatientId?.trim() ||
          resolvePatientIdFromClinicalNames(patients, r.firstName, r.surname);
        return !pid;
      }),
    [inpatients, patients]
  );

  const loadKanban = useCallback(async () => {
    setKanbanLoading(true);
    try {
      const k = await fetchWardKanban();
      setKanban(Array.isArray(k) ? migrateKanbanFromStorage(k) : []);
    } catch {
      setKanban([]);
    } finally {
      setKanbanLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadKanban();
  }, [loadKanban]);

  /** Auto-sync hospital ward tasks when ward opens (no manual “Pull”). */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadKanban();
      const p = patientsRef.current;
      if (p.length === 0) return;
      setHospitalSyncBusy(true);
      try {
        const r = await syncAllHospitalWardTasksToKanban(p);
        if (cancelled) return;
        await loadKanban();
        if (r.linked > 0) {
          onToast?.(`Synced ${r.linked} admission(s).`, 'success');
        }
      } catch {
        if (!cancelled) onToast?.('Could not sync ward data.', 'error');
      } finally {
        if (!cancelled) setHospitalSyncBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadKanban, onToast]);

  const persistKanban = useCallback(
    async (next: AdmittedPatientKanban[]) => {
      setKanban(migrateKanbanFromStorage(next));
      setKanbanSaving(true);
      try {
        const saved = await saveWardKanban(next, patientsRef.current);
        setKanban(migrateKanbanFromStorage(saved));
      } catch {
        onToast?.('Could not save ward board.', 'error');
        try {
          const k = await fetchWardKanban();
          setKanban(Array.isArray(k) ? migrateKanbanFromStorage(k) : []);
        } catch {
          setKanban([]);
        }
      } finally {
        setKanbanSaving(false);
      }
    },
    [onToast]
  );

  const [wardColumns, setWardColumns] = useState<Array<{ id: string; label: string }>>(WARD_BOARD_COLUMNS);
  const [admitPatientId, setAdmitPatientId] = useState('');
  const [admitWardColumn, setAdmitWardColumn] = useState<WardBoardColumnId>(
    (WARD_BOARD_COLUMNS[0]?.id as WardBoardColumnId) ?? 'm'
  );

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let cancelled = false;
    void fetchWardBoardColumns()
      .then((cols) => {
        if (cancelled || !cols.length) return;
        setWardColumns(cols);
        setAdmitWardColumn((prev) =>
          cols.some((c) => c.id === prev) ? prev : ((cols[0]!.id as WardBoardColumnId) ?? 'm')
        );
      })
      .catch(() => {
        /* keep static columns */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submitAdmit = useCallback(() => {
    const patientId = admitPatientId;
    if (!patientId || kanbanSaving) return;
    const patient = patientsById.get(patientId);
    const next = [...kanban];
    const idx = next.findIndex((p) => p.patientId === patientId);
    const seedStatus = KANBAN_TODO_OPEN;
    if (idx >= 0) {
      let row: AdmittedPatientKanban = {
        ...next[idx],
        admitted: true,
        todos: Array.isArray(next[idx].todos) ? next[idx].todos : [],
      };
      row = mergeAdmittedRowWithMockKanbanSeeds(row, patient, seedStatus);
      row = { ...row, boardColumn: admitWardColumn };
      next[idx] = row;
    } else {
      let row: AdmittedPatientKanban = { patientId, admitted: true, todos: [] };
      row = mergeAdmittedRowWithMockKanbanSeeds(row, patient, seedStatus);
      row = { ...row, boardColumn: admitWardColumn };
      next.push(row);
    }
    void persistKanban(next);
    setAdmitPatientId('');
  }, [admitPatientId, admitWardColumn, kanban, kanbanSaving, patientsById, persistKanban]);

  const addKanbanTodo = useCallback(
    (patientId: string, title: string) => {
      const trimmed = title.trim().slice(0, 200);
      if (!trimmed) return;
      const now = new Date().toISOString();
      const next = kanban.map((p) => {
        if (p.patientId !== patientId) return p;
        const todos = Array.isArray(p.todos) ? p.todos : [];
        return {
          ...p,
          todos: [
            ...todos,
            {
              id: crypto.randomUUID(),
              title: trimmed,
              status: KANBAN_TODO_OPEN,
              createdAt: now,
              updatedAt: now,
            },
          ],
        };
      });
      void persistKanban(next);
    },
    [kanban, persistKanban]
  );

  const toggleTodoDone = useCallback(
    (patientId: string, todoId: string, done: boolean) => {
      const now = new Date().toISOString();
      const status = done ? KANBAN_TODO_DONE : KANBAN_TODO_OPEN;
      const next = kanban.map((p) => {
        if (p.patientId !== patientId) return p;
        const todos = Array.isArray(p.todos) ? p.todos : [];
        const updatedTodos = todos.map((t) =>
          t.id === todoId ? { ...t, status, updatedAt: now } : t
        );
        return { ...p, todos: updatedTodos };
      });
      void persistKanban(next);
    },
    [kanban, persistKanban]
  );

  const setBoardColumn = useCallback(
    (patientId: string, column: WardBoardColumnId) => {
      const next = kanban.map((r) => (r.patientId === patientId ? { ...r, boardColumn: column } : r));
      void persistKanban(next);
    },
    [kanban, persistKanban]
  );

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden overscroll-x-none px-5 py-5 md:px-10 md:py-6 lg:px-12 bg-halo-bg">
      <div className="w-full max-w-[1600px] mx-auto flex flex-col flex-1 min-h-0 gap-5 md:gap-6">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 shrink-0">
          <h1 className="text-xl md:text-2xl font-semibold text-halo-text tracking-tight">Ward</h1>
          <div className="flex flex-wrap items-end gap-2 min-w-0">
            <label className="flex flex-col gap-0.5 min-w-[min(100%,200px)] flex-1">
              <span className="text-[10px] font-medium text-slate-500">Patient</span>
              <select
                value={admitPatientId}
                onChange={(e) => setAdmitPatientId(e.target.value)}
                disabled={kanbanSaving || patients.length === 0}
                className="text-[12px] px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/25 disabled:opacity-50"
              >
                <option value="">Select…</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 min-w-[min(100%,160px)]">
              <span className="text-[10px] font-medium text-slate-500">Ward</span>
              <select
                value={admitWardColumn}
                onChange={(e) => setAdmitWardColumn(e.target.value as WardBoardColumnId)}
                disabled={kanbanSaving}
                className="text-[12px] px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/25 disabled:opacity-50"
              >
                {wardColumns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!admitPatientId || kanbanSaving}
              onClick={() => submitAdmit()}
              className={`${CLINICAL_BTN_PRIMARY} shrink-0`}
            >
              Admit
            </button>
          </div>
        </div>

        <section className="flex-1 min-h-0 flex flex-col bg-halo-card rounded-xl border border-halo-border shadow-[var(--shadow-halo-soft)] min-w-0 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-halo-border flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <Layers className="w-4 h-4 shrink-0 text-teal-500" />
              <h2 className="text-xs font-semibold text-slate-800 uppercase tracking-wide">Ward board</h2>
            </div>
            <span className="text-[11px] text-slate-400 tabular-nums">
              {kanbanLoading || hospitalSyncBusy ? '…' : `${admittedKanban.length} admitted`}
            </span>
          </div>

          <div className="flex-1 min-h-0 flex flex-col px-2 pt-2 pb-3 sm:px-3 sm:pb-4 md:px-4 md:pb-5 overflow-hidden">
            {(kanbanSaving || hospitalSyncBusy) && (
              <div className="mb-2 text-[11px] text-slate-500 shrink-0">
                {hospitalSyncBusy ? 'Syncing…' : 'Saving…'}
              </div>
            )}

            {admittedKanban.length === 0 && unlinkedAdmittedInpatients.length === 0 ? (
              <div className="text-sm text-slate-500 py-6 px-1 shrink-0">Admit a patient or wait for a hospital match after sync.</div>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <WardKanbanBoard
                  wardColumns={wardColumns}
                  admittedKanban={admittedKanban}
                  unlinkedAdmittedInpatients={unlinkedAdmittedInpatients}
                  patientsById={patientsById}
                  inpatients={inpatients}
                  kanbanSaving={kanbanSaving}
                  onOpenPatient={onOpenPatient}
                  onToggleTodoDone={toggleTodoDone}
                  onSetBoardColumn={setBoardColumn}
                  onAddTodo={addKanbanTodo}
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
