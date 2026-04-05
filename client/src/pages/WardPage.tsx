import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AdmittedPatientKanban,
  DoctorDiaryEntry,
  Patient,
  UserSettings,
  WardBoardColumnId,
} from '../../../shared/types';
import { WardKanbanBoard } from '../features/clinical/ward/WardKanbanBoard';
import { ClinicalDashboard } from '../features/clinical/ClinicalDashboard';
import type { InpatientRecord } from '../types/clinical';
import {
  clinicalWardToBoardColumn,
  fetchCurrentInpatients,
  findInpatientMatchingHaloPatient,
  mergeAdmittedRowWithMockKanbanSeeds,
} from '../services/clinicalData';
import { fetchDoctorDiary, fetchDoctorKanban, saveDoctorDiary, saveDoctorKanban } from '../services/api';
import { syncAllHospitalWardTasksToKanban } from '../services/wardKanbanSync';
import { resolvePatientIdFromClinicalNames } from '../features/clinical/shared/clinicalDisplay';
import { Calendar as CalendarIcon, Layers, Plus, RefreshCw } from 'lucide-react';

/** Hospital ward tasks sync into kanban; checked = Done. */
const KANBAN_TODO_OPEN = 'To do';
const KANBAN_TODO_DONE = 'Done';

interface WardPageProps {
  patients: Patient[];
  /** Open a selected patient in the normal PatientWorkspace view. */
  onOpenPatient: (patientId: string) => void;
  userSettings?: UserSettings | null;
  onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
  /** Leave Ward and return to main HALO (patient list); clears selected patient for clean home. */
  onBackToPatientList?: () => void;
}

export const WardPage: React.FC<WardPageProps> = ({
  patients,
  onOpenPatient,
  userSettings,
  onToast,
  onBackToPatientList,
}) => {
  const [wardMode, setWardMode] = useState<'diary' | 'hospital'>('diary');
  // --- Doctor diary ---
  const [diaryEntries, setDiaryEntries] = useState<DoctorDiaryEntry[]>([]);
  const [diaryLoading, setDiaryLoading] = useState(false);
  const [diaryDraft, setDiaryDraft] = useState<Partial<DoctorDiaryEntry> | null>(null);
  const [diarySaving, setDiarySaving] = useState(false);

  const todayIsoDate = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const loadDiary = useCallback(async () => {
    setDiaryLoading(true);
    try {
      const { entries } = await fetchDoctorDiary();
      setDiaryEntries(Array.isArray(entries) ? entries : []);
    } catch {
      setDiaryEntries([]);
    } finally {
      setDiaryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDiary();
  }, [loadDiary]);

  const startNewDiaryEntry = useCallback(() => {
    setDiaryDraft({
      id: undefined,
      date: todayIsoDate,
      title: '',
      body: '',
    });
  }, [todayIsoDate]);

  const saveDiaryDraft = useCallback(async () => {
    if (!diaryDraft) return;
    if (typeof diaryDraft.date !== 'string' || !diaryDraft.date.trim()) return;
    if (typeof diaryDraft.title !== 'string' || !diaryDraft.title.trim()) return;
    if (typeof diaryDraft.body !== 'string' || !diaryDraft.body.trim()) return;

    setDiarySaving(true);
    try {
      const { entries } = await saveDoctorDiary({ entry: diaryDraft });
      setDiaryEntries(Array.isArray(entries) ? entries : []);
      setDiaryDraft(null);
    } finally {
      setDiarySaving(false);
    }
  }, [diaryDraft]);

  // --- Admitted kanban ---
  const [kanban, setKanban] = useState<AdmittedPatientKanban[]>([]);
  const [kanbanLoading, setKanbanLoading] = useState(false);
  const [kanbanSaving, setKanbanSaving] = useState(false);
  const [hospitalSyncBusy, setHospitalSyncBusy] = useState(false);
  const [inpatients, setInpatients] = useState<InpatientRecord[]>([]);

  const patientsById = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);

  useEffect(() => {
    void fetchCurrentInpatients().then(setInpatients);
  }, []);

  const admittedKanban = useMemo(
    () => kanban.filter((p) => Boolean(p.admitted)),
    [kanban]
  );

  /** Mock admissions with no HALO folder match — still show WARD TO DO on the board (like the old Hospital ward view). */
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
      const { kanban } = await fetchDoctorKanban();
      setKanban(Array.isArray(kanban) ? kanban : []);
    } catch {
      setKanban([]);
    } finally {
      setKanbanLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadKanban();
  }, [loadKanban]);

  const persistKanban = useCallback(
    async (next: AdmittedPatientKanban[]) => {
      setKanbanSaving(true);
      try {
        const { kanban: saved } = await saveDoctorKanban(next);
        setKanban(Array.isArray(saved) ? saved : next);
      } finally {
        setKanbanSaving(false);
      }
    },
    []
  );

  const pullFromHospital = useCallback(async () => {
    setHospitalSyncBusy(true);
    try {
      const r = await syncAllHospitalWardTasksToKanban(patients);
      await loadKanban();
      if (r.linked > 0) {
        onToast?.(`Synced ${r.linked} admission(s).`, 'success');
      } else {
        onToast?.('No name match to HALO patients.', 'info');
      }
      if (r.skippedNoHaloMatch > 0) {
        onToast?.(`${r.skippedNoHaloMatch} row(s) skipped (no HALO match).`, 'info');
      }
    } catch {
      onToast?.('Could not sync from Hospital — check your connection.', 'error');
    } finally {
      setHospitalSyncBusy(false);
    }
  }, [patients, loadKanban, onToast]);

  // Admit patient to ward (creates kanban row if needed)
  const [admitPatientId, setAdmitPatientId] = useState('');

  const admitSelectedPatient = useCallback(() => {
    if (!admitPatientId) return;
    const patient = patientsById.get(admitPatientId);
    const next = [...kanban];
    const idx = next.findIndex((p) => p.patientId === admitPatientId);
    const seedStatus = KANBAN_TODO_OPEN;
    if (idx >= 0) {
      let row: AdmittedPatientKanban = {
        ...next[idx],
        admitted: true,
        todos: Array.isArray(next[idx].todos) ? next[idx].todos : [],
      };
      row = mergeAdmittedRowWithMockKanbanSeeds(row, patient, seedStatus);
      const ip = findInpatientMatchingHaloPatient(patient, inpatients);
      row = { ...row, boardColumn: row.boardColumn ?? (ip ? clinicalWardToBoardColumn(ip.ward) : 'other') };
      next[idx] = row;
    } else {
      let row: AdmittedPatientKanban = { patientId: admitPatientId, admitted: true, todos: [] };
      row = mergeAdmittedRowWithMockKanbanSeeds(row, patient, seedStatus);
      const ip = findInpatientMatchingHaloPatient(patient, inpatients);
      row = { ...row, boardColumn: row.boardColumn ?? (ip ? clinicalWardToBoardColumn(ip.ward) : 'other') };
      next.push(row);
    }
    void persistKanban(next);
    setAdmitPatientId('');
  }, [admitPatientId, kanban, patientsById, persistKanban, inpatients]);

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
    <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden overscroll-x-none p-3 sm:p-4 md:p-8 bg-slate-50/50">
      <div
        className={`mx-auto space-y-6 min-w-0 ${
          wardMode === 'hospital' ? 'max-w-[min(96rem,100%)]' : 'max-w-[min(96rem,100%)]'
        }`}
      >
        <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
          <button
            type="button"
            onClick={() => setWardMode('diary')}
            className={
              wardMode === 'diary'
                ? 'px-3 py-2 rounded-lg text-sm font-semibold bg-violet-600 text-white'
                : 'px-3 py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200'
            }
          >
            Ward board &amp; diary
          </button>
          <button
            type="button"
            onClick={() => setWardMode('hospital')}
            className={
              wardMode === 'hospital'
                ? 'px-3 py-2 rounded-lg text-sm font-semibold bg-violet-600 text-white'
                : 'px-3 py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200'
            }
          >
            Hospital sheets
          </button>
        </div>
        {wardMode === 'hospital' && onBackToPatientList ? (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2 text-sm text-slate-700">
            <span className="min-w-0">Live board: <strong>Ward board &amp; diary</strong>.</span>
            <button
              type="button"
              onClick={onBackToPatientList}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-white border border-violet-300 text-violet-800 font-semibold text-sm hover:bg-violet-50"
            >
              Patient list
            </button>
          </div>
        ) : null}
        {wardMode === 'hospital' ? (
          <ClinicalDashboard
            userSettings={userSettings}
            onToast={onToast}
            patients={patients}
            onOpenPatient={onOpenPatient}
            onOpenWardBoard={() => setWardMode('diary')}
          />
        ) : (
          <>
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-800 tracking-tight">Ward</h1>
            <p className="text-sm text-slate-500 mt-1">Tap a name for tasks. Drag the grip to change ward.</p>
          </div>

          <div className="flex items-center gap-3">
            {/* Admit patient */}
            <div className="flex items-center gap-2">
              <select
                value={admitPatientId}
                onChange={(e) => setAdmitPatientId(e.target.value)}
                className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400"
              >
                <option value="">Admit a patient...</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={admitSelectedPatient}
                disabled={!admitPatientId || kanbanSaving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 hover:bg-violet-700 text-white shadow-sm shadow-violet-500/30 disabled:opacity-60 disabled:cursor-not-allowed transition"
              >
                <Plus size={16} />
                Admit
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <section className="bg-white rounded-xl shadow-sm border border-slate-200 min-w-0">
            <div className="px-4 py-2.5 border-b border-violet-200/80 bg-violet-50/90 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Layers className="w-4 h-4 shrink-0 text-violet-700" />
                <h2 className="text-sm font-bold text-violet-950">Ward board</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void pullFromHospital()}
                  disabled={hospitalSyncBusy || kanbanLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-violet-300 text-violet-800 hover:bg-violet-50 disabled:opacity-50"
                >
                  <RefreshCw size={14} className={hospitalSyncBusy ? 'animate-spin' : ''} />
                  {hospitalSyncBusy ? '…' : 'Pull from Hospital'}
                </button>
                <span className="text-xs text-slate-500 tabular-nums">
                  {kanbanLoading ? '…' : `${admittedKanban.length}`}
                </span>
              </div>
            </div>

            <div className="p-2 sm:p-3 min-w-0">
              {(kanbanSaving || hospitalSyncBusy) && (
                <div className="mb-2 text-xs text-slate-600">{hospitalSyncBusy ? 'Syncing…' : 'Saving…'}</div>
              )}

              {admittedKanban.length === 0 && unlinkedAdmittedInpatients.length === 0 ? (
                <div className="text-sm text-slate-500 py-6 px-1">
                  <p>Admit a patient or pull from Hospital.</p>
                </div>
              ) : (
                <WardKanbanBoard
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
              )}
            </div>
          </section>

          <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-violet-200/80 bg-violet-50/90 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-violet-700" />
                <div>
                  <h2 className="text-sm font-bold text-violet-950">Doctor diary</h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => startNewDiaryEntry()}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white shadow-sm shadow-violet-500/30 transition"
                disabled={diaryLoading}
              >
                <Plus size={14} />
                New
              </button>
            </div>

            <div className="p-4">
              {diaryLoading ? (
                <p className="text-sm text-slate-500">Loading diary...</p>
              ) : diaryEntries.length === 0 ? (
                <p className="text-sm text-slate-500">No diary entries yet.</p>
              ) : (
                <div className="space-y-2">
                  {diaryEntries
                    .slice()
                    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
                    .map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => setDiaryDraft(e)}
                        className={`w-full text-left px-3 py-2 rounded-xl border transition ${
                          diaryDraft?.id === e.id
                            ? 'border-violet-300 bg-violet-50 text-violet-900'
                            : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-semibold truncate">{e.title}</div>
                            <div className="text-xs text-slate-500">{e.date}</div>
                          </div>
                          <span className="text-xs text-slate-400">Edit</span>
                        </div>
                      </button>
                    ))}
                </div>
              )}

              {/* Draft editor */}
              {diaryDraft && (
                <div className="mt-4 border border-slate-200 rounded-xl p-3 bg-slate-50/50">
                  <div className="grid grid-cols-1 gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Entry
                      </div>
                      <button
                        type="button"
                        onClick={() => setDiaryDraft(null)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                        aria-label="Close diary editor"
                      >
                        <XIcon />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                          Date
                        </label>
                        <input
                          type="date"
                          value={typeof diaryDraft.date === 'string' ? diaryDraft.date.slice(0, 10) : todayIsoDate}
                          onChange={(ev) => setDiaryDraft((prev) => ({ ...(prev || {}), date: ev.target.value }))}
                          className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                          Title
                        </label>
                        <input
                          type="text"
                          value={typeof diaryDraft.title === 'string' ? diaryDraft.title : ''}
                          onChange={(ev) => setDiaryDraft((prev) => ({ ...(prev || {}), title: ev.target.value }))}
                          className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400"
                          placeholder="e.g. Ward round notes"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                        Body
                      </label>
                      <textarea
                        rows={8}
                        value={typeof diaryDraft.body === 'string' ? diaryDraft.body : ''}
                        onChange={(ev) => setDiaryDraft((prev) => ({ ...(prev || {}), body: ev.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400 resize-none"
                        placeholder="Write the diary entry..."
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setDiaryDraft(null)}
                        className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
                        disabled={diarySaving}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveDiaryDraft()}
                        disabled={diarySaving}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white shadow-sm shadow-violet-500/30 disabled:opacity-60 disabled:cursor-not-allowed transition"
                      >
                        {diarySaving ? 'Saving...' : 'Save entry'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
          </>
        )}
      </div>
    </div>
  );
};

function XIcon() {
  return (
    <span className="inline-block w-4 h-4 relative">
      <span className="absolute left-1 top-1 w-2 h-px bg-slate-400 rotate-45" />
      <span className="absolute left-1 top-1 w-2 h-px bg-slate-400 -rotate-45" />
    </span>
  );
}
