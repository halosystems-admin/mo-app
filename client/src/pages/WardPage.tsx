import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdmittedPatientKanban, DoctorDiaryEntry, Patient } from '../../../shared/types';
import { fetchDoctorDiary, fetchDoctorKanban, saveDoctorDiary, saveDoctorKanban } from '../services/api';
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  FileText,
  Layers,
  Plus,
  Trash2,
} from 'lucide-react';

type KanbanStatus = string;

const DEFAULT_STATUSES: KanbanStatus[] = ['To do', 'Doing', 'Done'];

interface WardPageProps {
  patients: Patient[];
  /** Open a selected patient in the normal PatientWorkspace view. */
  onOpenPatient: (patientId: string) => void;
}

export const WardPage: React.FC<WardPageProps> = ({ patients, onOpenPatient }) => {
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

  const patientsById = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);

  const admittedKanban = useMemo(
    () => kanban.filter((p) => Boolean(p.admitted)),
    [kanban]
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

  // Admit patient to ward (creates kanban row if needed)
  const [admitPatientId, setAdmitPatientId] = useState('');

  const admitSelectedPatient = useCallback(() => {
    if (!admitPatientId) return;
    const now = new Date().toISOString();
    const next = [...kanban];
    const idx = next.findIndex((p) => p.patientId === admitPatientId);
    if (idx >= 0) {
      next[idx] = { ...next[idx], admitted: true, todos: Array.isArray(next[idx].todos) ? next[idx].todos : [] };
    } else {
      next.push({ patientId: admitPatientId, admitted: true, todos: [] });
    }
    void persistKanban(next);
    setAdmitPatientId('');
  }, [admitPatientId, kanban, persistKanban]);

  const dischargePatient = useCallback(
    (patientId: string) => {
      const next = kanban.map((p) => (p.patientId === patientId ? { ...p, admitted: false } : p));
      void persistKanban(next);
    },
    [kanban, persistKanban]
  );

  // Task drafts keyed by patient/status so you can add tasks directly in a column
  const [taskDrafts, setTaskDrafts] = useState<Record<string, string>>({});

  const addTodo = useCallback(
    (patientId: string, status: KanbanStatus, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      const now = new Date().toISOString();
      const next = kanban.map((p) => {
        if (p.patientId !== patientId) return p;
        const todos = Array.isArray(p.todos) ? p.todos : [];
        const nextTodo = {
          id: crypto.randomUUID(),
          title: trimmed.slice(0, 200),
          status,
          updatedAt: now,
          createdAt: now,
        };
        return { ...p, admitted: true, todos: [...todos, nextTodo] };
      });
      void persistKanban(next);
    },
    [kanban, persistKanban]
  );

  const moveTodoToStatus = useCallback(
    async (patientId: string, todoId: string, toStatus: KanbanStatus) => {
      const now = new Date().toISOString();
      const next = kanban.map((p) => {
        if (p.patientId !== patientId) return p;
        const todos = Array.isArray(p.todos) ? p.todos : [];
        const updatedTodos = todos.map((t) => (t.id === todoId ? { ...t, status: toStatus, updatedAt: now } : t));
        return { ...p, todos: updatedTodos };
      });
      void persistKanban(next);
    },
    [kanban, persistKanban]
  );

  // Native DnD payload
  const handleDragStartTodo = useCallback((e: React.DragEvent, payload: { patientId: string; todoId: string }) => {
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDropColumn = useCallback(
    (e: React.DragEvent, toStatus: KanbanStatus) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as { patientId: string; todoId: string };
        if (!parsed.patientId || !parsed.todoId) return;
        void moveTodoToStatus(parsed.patientId, parsed.todoId, toStatus);
      } catch {
        // ignore
      }
    },
    [moveTodoToStatus]
  );

  const handleDragOverColumn = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const statuses = DEFAULT_STATUSES;

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-slate-50/50">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-800 tracking-tight">
              Ward
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Doctor diary and admitted-patient kanban with todo lists.
            </p>
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

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Diary */}
          <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/60 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-violet-600" />
                <div>
                  <h2 className="text-sm font-bold text-slate-800">Doctor Diary</h2>
                  <p className="text-xs text-slate-500">Global entries by date</p>
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

          {/* Kanban */}
          <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/60 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-violet-600" />
                <div>
                  <h2 className="text-sm font-bold text-slate-800">Admitted Kanban</h2>
                  <p className="text-xs text-slate-500">Drag todo items between columns</p>
                </div>
              </div>
              <div className="text-xs text-slate-500">
                {kanbanLoading ? 'Loading...' : `${admittedKanban.length} admitted patient(s)`}
              </div>
            </div>

            <div className="p-4">
              {kanbanSaving && (
                <div className="mb-3 text-xs text-violet-700 font-semibold">
                  Saving ward state...
                </div>
              )}

              {admittedKanban.length === 0 ? (
                <div className="text-sm text-slate-500 py-6">
                  Admit a patient to see their todo list here.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {statuses.map((status) => (
                    <div
                      key={status}
                      onDragOver={(e) => handleDragOverColumn(e)}
                      onDrop={(e) => handleDropColumn(e, status)}
                      className="rounded-xl border border-slate-200 bg-slate-50/60"
                    >
                      <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
                        <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                          {status}
                        </div>
                      </div>

                      <div className="p-3 space-y-3 max-h-[70vh] overflow-auto">
                        {admittedKanban
                          .map((p) => {
                            const tasks = (Array.isArray(p.todos) ? p.todos : []).filter((t) => t.status === status);
                            return { patient: p, tasks };
                          })
                          .filter((x) => x.tasks.length > 0)
                          .map(({ patient, tasks }) => {
                            const patientInfo = patientsById.get(patient.patientId);
                            const patientName = patientInfo?.name || patient.patientId;
                            return (
                              <div
                                key={patient.patientId}
                                className="border border-slate-200 bg-white rounded-xl p-3"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <button
                                    type="button"
                                    onClick={() => onOpenPatient(patient.patientId)}
                                    className="text-sm font-semibold text-slate-800 hover:text-violet-700 truncate"
                                    title="Open patient"
                                  >
                                    {patientName}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => dischargePatient(patient.patientId)}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                                    title="Discharge / remove from ward"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>

                                <div className="mt-2 space-y-2">
                                  {tasks.map((t) => (
                                    <div
                                      key={t.id}
                                      draggable
                                      onDragStart={(e) => handleDragStartTodo(e, { patientId: patient.patientId, todoId: t.id })}
                                      className="flex items-start gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-violet-50 transition-colors cursor-move"
                                      title="Drag to another column"
                                    >
                                      <FileText size={14} className="text-violet-600 mt-0.5" />
                                      <div className="min-w-0 flex-1">
                                        <div className="text-xs font-semibold text-slate-800 truncate">{t.title}</div>
                                      </div>
                                    </div>
                                  ))}
                                </div>

                                <div className="mt-3">
                                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                                    Add todo to {status}
                                  </label>
                                  <div className="flex gap-2">
                                    <input
                                      type="text"
                                      value={taskDrafts[`${patient.patientId}:${status}`] || ''}
                                      onChange={(e) =>
                                        setTaskDrafts((prev) => ({
                                          ...prev,
                                          [`${patient.patientId}:${status}`]: e.target.value,
                                        }))
                                      }
                                      placeholder="e.g. Review MRI results"
                                      className="flex-1 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const draftKey = `${patient.patientId}:${status}`;
                                        const title = taskDrafts[draftKey] || '';
                                        void addTodo(patient.patientId, status, title);
                                        setTaskDrafts((prev) => ({ ...prev, [draftKey]: '' }));
                                      }}
                                      disabled={kanbanSaving}
                                      className="inline-flex items-center justify-center px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-60 transition"
                                      title="Add todo"
                                    >
                                      <Plus size={16} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

function XIcon() {
  // Small inline icon to avoid adding another lucide import.
  return (
    <span className="inline-block w-4 h-4 relative">
      <span className="absolute left-1 top-1 w-2 h-px bg-slate-400 rotate-45" />
      <span className="absolute left-1 top-1 w-2 h-px bg-slate-400 -rotate-45" />
    </span>
  );
}

