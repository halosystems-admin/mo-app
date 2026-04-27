import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { AdmittedPatientKanban, Patient } from '../../../../../shared/types';
import type { InpatientRecord } from '../../../types/clinical';
import { clinicalWardToBoardColumn, findInpatientMatchingHaloPatient } from '../../../services/clinicalData';
import { CLINICAL_HEADER_BAND } from '../shared/tableScrollClasses';
import {
  WARD_BOARD_COLUMNS,
  emptyWardColumnMapForColumns,
} from '../shared/wardBoardColumns';
import {
  wardBoardScrollerClass,
  wardColumnBodyPaddingClass,
  wardColumnWidthClass,
} from './wardBoardLayout';
import { ExternalLink, GripVertical, Plus, X } from 'lucide-react';

const DROPPABLE_PREFIX = 'ward-col:';

function droppableId(col: string): string {
  return `${DROPPABLE_PREFIX}${col}`;
}

function cloneLayout(layout: Record<string, string[]>): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(layout)) next[k] = [...v];
  return next;
}

function findColumnForPatient(layout: Record<string, string[]>, patientId: string): string | null {
  for (const [col, ids] of Object.entries(layout)) {
    if (ids.includes(patientId)) return col;
  }
  return null;
}

function buildLayoutFromGrouped(
  columns: Array<{ id: string }>,
  grouped: Record<string, AdmittedPatientKanban[]>
): Record<string, string[]> {
  const layout: Record<string, string[]> = {};
  for (const c of columns) {
    layout[c.id] = (grouped[c.id] ?? []).map((r) => r.patientId);
  }
  return layout;
}

/** Apply drag result: reorder within column, move across columns, or drop onto column chrome. */
function applyDragToLayout(
  layout: Record<string, string[]>,
  activePid: string,
  overRaw: string
): Record<string, string[]> | null {
  const next = cloneLayout(layout);
  if (overRaw.startsWith(DROPPABLE_PREFIX)) {
    const targetCol = overRaw.slice(DROPPABLE_PREFIX.length);
    if (!Object.prototype.hasOwnProperty.call(next, targetCol)) return null;
    const fromCol = findColumnForPatient(next, activePid);
    if (!fromCol) return null;
    next[fromCol] = next[fromCol].filter((id) => id !== activePid);
    next[targetCol] = next[targetCol].filter((id) => id !== activePid);
    next[targetCol].push(activePid);
    return next;
  }
  const overPid = overRaw;
  if (activePid === overPid) return null;
  const fromCol = findColumnForPatient(next, activePid);
  const toCol = findColumnForPatient(next, overPid);
  if (!fromCol || !toCol) return null;
  if (fromCol === toCol) {
    const arr = [...next[fromCol]];
    const oldIndex = arr.indexOf(activePid);
    const newIndex = arr.indexOf(overPid);
    if (oldIndex < 0 || newIndex < 0) return null;
    next[fromCol] = arrayMove(arr, oldIndex, newIndex);
    return next;
  }
  next[fromCol] = next[fromCol].filter((id) => id !== activePid);
  const insertIdx = next[toCol].indexOf(overPid);
  const idx = insertIdx < 0 ? next[toCol].length : insertIdx;
  const merged = [...next[toCol]];
  merged.splice(idx, 0, activePid);
  next[toCol] = merged;
  return next;
}

function sortName(a: string, b: string): number {
  return a.toLowerCase().localeCompare(b.toLowerCase());
}

type WardColumnDef = { id: string; label: string };

type Props = {
  /** When set (e.g. from Supabase), drives column order and labels; otherwise uses static WARD_BOARD_COLUMNS. */
  wardColumns?: WardColumnDef[];
  admittedKanban: AdmittedPatientKanban[];
  unlinkedAdmittedInpatients?: InpatientRecord[];
  patientsById: Map<string, Patient>;
  inpatients: InpatientRecord[];
  kanbanSaving: boolean;
  onOpenPatient: (patientId: string) => void;
  onToggleTodoDone: (patientId: string, todoId: string, done: boolean) => void;
  /** Patient id order per ward column (persisted with column + sort index). */
  onApplyBoardLayout: (layout: Record<string, string[]>) => void;
  onUpdatePatientTags: (patientId: string, tags: string[]) => void;
  onAddTodo: (patientId: string, title: string) => void;
};

type ColumnProps = {
  col: WardColumnDef;
  ptCount: number;
  children: React.ReactNode;
};

const WardColumnDropZone = memo(function WardColumnDropZone({ col, ptCount, children }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: droppableId(col.id) });
  return (
    <div
      ref={setNodeRef}
      className={`flex snap-start flex-col ${wardColumnWidthClass} min-h-0 h-full overflow-hidden rounded-xl border bg-halo-card shadow-[var(--shadow-halo-soft)] ${
        isOver ? 'border-halo-primary ring-2 ring-halo-primary/35 shadow-md' : 'border-halo-border'
      }`}
    >
      <div className={`shrink-0 rounded-t-xl px-2.5 py-1.5 ${CLINICAL_HEADER_BAND}`}>
        <div className="text-[9px] font-bold uppercase tracking-wide text-white/95 leading-tight">{col.label}</div>
        <div className="text-[9px] font-medium text-white/80 tabular-nums mt-0.5">{ptCount} pts</div>
      </div>
      {children}
    </div>
  );
});

function WardDragOverlayCard({
  patientId,
  patientsById,
  inpatients,
}: {
  patientId: string;
  patientsById: Map<string, Patient>;
  inpatients: InpatientRecord[];
}) {
  const p = patientsById.get(patientId);
  const name = p?.name || patientId;
  const ip = findInpatientMatchingHaloPatient(p, inpatients);
  const folder = ip?.folderNumber ?? '—';
  const doctor = ip?.assignedDoctor ?? '—';
  return (
    <div
      className="w-[268px] rounded-lg border-2 border-teal-500 bg-white px-2 py-2 shadow-xl cursor-grabbing select-none will-change-transform"
      style={{ touchAction: 'none' }}
    >
      <div className="flex items-center gap-1.5">
        <GripVertical size={14} className="text-teal-500 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900 truncate">{name}</div>
          <div className="text-[10px] text-slate-600 truncate">
            {folder} · {doctor}
          </div>
        </div>
      </div>
    </div>
  );
}

type CompactRowProps = {
  row: AdmittedPatientKanban;
  patientsById: Map<string, Patient>;
  inpatients: InpatientRecord[];
  onOpenTasks: () => void;
  onTogglePresetTag: (patientId: string, preset: 'seen' | 'unseen') => void;
  onRemoveTag: (patientId: string, tag: string) => void;
  tagDraftPatientId: string | null;
  tagDraftValue: string;
  onTagDraftChange: (patientId: string, value: string) => void;
  onOpenTagDraft: (patientId: string) => void;
  onCloseTagDraft: () => void;
  onSubmitTagDraft: (patientId: string) => void;
};

const KanbanCompactRow = memo(function KanbanCompactRow({
  row,
  patientsById,
  inpatients,
  onOpenTasks,
  onTogglePresetTag,
  onRemoveTag,
  tagDraftPatientId,
  tagDraftValue,
  onTagDraftChange,
  onOpenTagDraft,
  onCloseTagDraft,
  onSubmitTagDraft,
}: CompactRowProps) {
  const p = patientsById.get(row.patientId);
  const name = p?.name || row.patientId;
  const ip = findInpatientMatchingHaloPatient(p, inpatients);
  const folder = ip?.folderNumber ?? '—';
  const doctor = ip?.assignedDoctor ?? '—';
  const todos = row.todos || [];
  const openCount = todos.filter((t) => t.status !== 'Done').length;
  const tags = (row.tags || []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  const hasSeen = tags.includes('seen');
  const hasUnseen = tags.includes('unseen');
  const customTags = tags.filter((t) => t !== 'seen' && t !== 'unseen');
  const draftOpen = tagDraftPatientId === row.patientId;

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: row.patientId,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`grid w-full min-w-0 grid-cols-[40px_minmax(0,1fr)_48px] items-stretch gap-0 rounded-[10px] border border-halo-border bg-white shadow-[var(--shadow-halo-soft)] my-2 overflow-hidden ${
        isDragging ? 'opacity-40 ring-2 ring-teal-400/50 z-10' : ''
      } max-md:!touch-manipulation`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...listeners}
        {...attributes}
        className="flex h-full min-h-[3.5rem] items-center justify-center cursor-grab active:cursor-grabbing touch-none text-halo-muted hover:text-halo-primary hover:bg-halo-primary-muted"
        style={{ touchAction: 'none' }}
        aria-label={`Drag ${name}`}
      >
        <GripVertical size={16} strokeWidth={2} />
      </button>
      <div className="min-w-0 flex flex-col min-h-[3.5rem]">
        <button
          type="button"
          onClick={onOpenTasks}
          className="min-w-0 px-1 py-2 text-left hover:bg-halo-section/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-halo-primary/40 focus-visible:ring-inset"
          aria-label={`Open ward tasks for ${name}`}
        >
          <div className="text-sm font-semibold text-halo-text leading-tight truncate">{name}</div>
          <div className="text-[10px] text-halo-text-secondary truncate mt-0.5">
            {folder} · {doctor}
          </div>
        </button>
        <div className="flex flex-wrap items-center gap-1 px-1 pb-2 pt-0.5 border-t border-halo-border/60 bg-halo-section/30">
          <button
            type="button"
            onClick={() => onTogglePresetTag(row.patientId, 'seen')}
            className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide border ${
              hasSeen
                ? 'bg-teal-600 text-white border-teal-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-teal-400'
            }`}
          >
            Seen
          </button>
          <button
            type="button"
            onClick={() => onTogglePresetTag(row.patientId, 'unseen')}
            className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide border ${
              hasUnseen
                ? 'bg-amber-600 text-white border-amber-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-amber-400'
            }`}
          >
            Unseen
          </button>
          {customTags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-0.5 rounded-md bg-slate-200/90 px-1.5 py-0.5 text-[9px] font-bold text-slate-800 max-w-[5.5rem]"
            >
              <span className="truncate">{t}</span>
              <button
                type="button"
                onClick={() => onRemoveTag(row.patientId, t)}
                className="shrink-0 rounded p-0.5 text-slate-600 hover:bg-slate-300/80"
                aria-label={`Remove tag ${t}`}
              >
                <X className="w-3 h-3" strokeWidth={2.5} />
              </button>
            </span>
          ))}
          {!draftOpen ? (
            <button
              type="button"
              onClick={() => onOpenTagDraft(row.patientId)}
              className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-slate-300 bg-white px-1.5 py-0.5 text-[9px] font-bold text-teal-700 hover:bg-teal-50/80"
            >
              <Plus className="w-3 h-3" strokeWidth={2.5} /> tag
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 max-w-full">
              <input
                type="text"
                value={tagDraftValue}
                onChange={(e) => onTagDraftChange(row.patientId, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onSubmitTagDraft(row.patientId);
                  }
                  if (e.key === 'Escape') onCloseTagDraft();
                }}
                className="min-w-0 w-20 max-w-[7rem] rounded border border-slate-200 px-1 py-0.5 text-[9px] text-slate-800"
                autoFocus
              />
              <button
                type="button"
                onClick={() => onSubmitTagDraft(row.patientId)}
                className="rounded bg-teal-600 px-1 py-0.5 text-[9px] font-bold text-white"
              >
                Add
              </button>
              <button type="button" onClick={onCloseTagDraft} className="text-[9px] font-semibold text-slate-500 px-0.5">
                ×
              </button>
            </span>
          )}
        </div>
      </div>
      <div
        className="flex h-full min-h-[3.5rem] items-center justify-end border-l border-halo-border bg-halo-section/50 pr-2.5 pl-1 box-border"
        aria-hidden={openCount === 0}
      >
        {openCount > 0 ? (
          <span
            className="inline-flex min-h-[1.5rem] min-w-[1.5rem] max-w-[2rem] shrink-0 items-center justify-center px-1 text-[10px] font-bold tabular-nums rounded-full bg-halo-primary-muted text-halo-text ring-1 ring-halo-primary/30"
          >
            {openCount > 9 ? '9+' : openCount}
          </span>
        ) : (
          <span
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-[10px] text-halo-muted tabular-nums select-none"
            aria-hidden
          >
            ·
          </span>
        )}
      </div>
    </div>
  );
});

type DetailTarget =
  | { kind: 'halo'; patientId: string }
  | { kind: 'unlinked'; recordId: string };

function WardPatientDetailSheet({
  target,
  onClose,
  admittedKanban,
  unlinkedList,
  patientsById,
  inpatients,
  kanbanSaving,
  onOpenPatient,
  onToggleTodoDone,
  onAddTodo,
}: {
  target: DetailTarget | null;
  onClose: () => void;
  admittedKanban: AdmittedPatientKanban[];
  unlinkedList: InpatientRecord[];
  patientsById: Map<string, Patient>;
  inpatients: InpatientRecord[];
  kanbanSaving: boolean;
  onOpenPatient: (patientId: string) => void;
  onToggleTodoDone: (patientId: string, todoId: string, done: boolean) => void;
  onAddTodo: (patientId: string, title: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  const row =
    target?.kind === 'halo'
      ? admittedKanban.find((r) => r.patientId === target.patientId)
      : undefined;
  const unlinked =
    target?.kind === 'unlinked' ? unlinkedList.find((r) => r.id === target.recordId) : undefined;

  const resetAdd = () => {
    setAdding(false);
    setNewTitle('');
  };

  useEffect(() => {
    setAdding(false);
    setNewTitle('');
  }, [target]);

  useEffect(() => {
    if (!target) return;
    if (target.kind === 'halo') {
      if (!admittedKanban.some((r) => r.patientId === target.patientId)) onClose();
    } else if (!unlinkedList.some((r) => r.id === target.recordId)) {
      onClose();
    }
  }, [target, admittedKanban, unlinkedList, onClose]);

  if (!target) return null;

  if (target.kind === 'halo' && !row) return null;
  if (target.kind === 'unlinked' && !unlinked) return null;

  const submitNew = () => {
    if (!row) return;
    const t = newTitle.trim().slice(0, 200);
    if (!t) return;
    onAddTodo(row.patientId, t);
    resetAdd();
  };

  const p = row ? patientsById.get(row.patientId) : undefined;
  const haloName = row ? p?.name || row.patientId : '';
  const ip = row ? findInpatientMatchingHaloPatient(p, inpatients) : undefined;
  const folder = ip?.folderNumber ?? '—';
  const doctor = ip?.assignedDoctor ?? '—';
  const todos = row?.todos || [];

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-slate-900/45 p-0 sm:p-4 pb-[env(safe-area-inset-bottom)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ward-detail-sheet-title"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl border border-slate-200 max-h-[min(88dvh,620px)] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-slate-100 shrink-0">
          <div className="min-w-0">
            <h2 id="ward-detail-sheet-title" className="text-base font-bold text-slate-900 truncate">
              {target.kind === 'halo' ? haloName : `${unlinked!.firstName} ${unlinked!.surname}`}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {target.kind === 'halo' ? (
                <>
                  {folder} · {doctor}
                </>
              ) : (
                <>
                  Hospital (no HALO) · {unlinked!.folderNumber || '—'} · {unlinked!.assignedDoctor || '—'}
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-3 overscroll-contain">
          {target.kind === 'halo' && row ? (
            <>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Ward tasks</span>
                <button
                  type="button"
                  disabled={kanbanSaving}
                  onClick={() => setAdding((v) => !v)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-200 bg-white text-teal-500 text-[11px] font-semibold hover:bg-teal-50/80 disabled:opacity-50"
                >
                  <Plus size={14} strokeWidth={2.5} /> Add
                </button>
              </div>
              {adding ? (
                <div className="flex flex-col gap-2 mb-3 p-2 rounded-lg bg-slate-50 border border-slate-100">
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        submitNew();
                      }
                      if (e.key === 'Escape') resetAdd();
                    }}
                    placeholder="New task…"
                    disabled={kanbanSaving}
                    className="w-full text-sm px-2 py-2 rounded-lg border border-slate-200"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={kanbanSaving || !newTitle.trim()}
                      onClick={submitNew}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-teal-500 text-white disabled:opacity-50"
                    >
                      Add task
                    </button>
                    <button type="button" onClick={resetAdd} className="text-xs px-3 py-1.5 text-slate-600">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="space-y-1">
                {todos.length === 0 && !adding ? (
                  <p className="text-sm text-slate-400 py-2">No tasks yet.</p>
                ) : null}
                {todos.map((t) => {
                  const done = t.status === 'Done';
                  return (
                    <label
                      key={t.id}
                      className="flex items-start gap-2 cursor-pointer select-none rounded-lg px-1 py-1.5 hover:bg-slate-50 border border-transparent hover:border-slate-100"
                    >
                      <input
                        type="checkbox"
                        checked={done}
                        disabled={kanbanSaving}
                        onChange={() => onToggleTodoDone(row.patientId, t.id, !done)}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-500"
                      />
                      <span
                        className={`text-sm leading-snug min-w-0 flex-1 ${
                          done ? 'text-slate-400 line-through' : 'text-slate-800'
                        }`}
                      >
                        {t.title}
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          ) : unlinked ? (
            <div className="space-y-2">
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-2">
                Link a HALO folder to edit board tasks and open the workspace.
              </p>
              {unlinked.taskIndicators?.length ? (
                <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
                  {unlinked.taskIndicators.map((c, i) => (
                    <li key={i}>{c.label}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-400">No tasks in Hospital row.</p>
              )}
            </div>
          ) : null}
        </div>

        <div className="border-t border-slate-100 px-4 py-3 flex flex-col sm:flex-row gap-2 shrink-0 bg-slate-50/80">
          {target.kind === 'halo' && row ? (
            <button
              type="button"
              onClick={() => {
                onOpenPatient(row.patientId);
                onClose();
              }}
              className="inline-flex items-center justify-center gap-1.5 min-h-[36px] flex-1 px-3 py-1.5 rounded-lg bg-teal-500 text-white text-[11px] font-semibold hover:bg-teal-500/90"
            >
              <ExternalLink size={16} /> Open HALO workspace
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function cyclePresetTag(tags: string[] | undefined, preset: 'seen' | 'unseen'): string[] {
  const cur = (tags || []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  const has = cur.includes(preset);
  const rest = cur.filter((t) => t !== 'seen' && t !== 'unseen');
  if (has) return rest;
  return [...rest, preset];
}

export const WardKanbanBoard: React.FC<Props> = ({
  wardColumns,
  admittedKanban,
  unlinkedAdmittedInpatients = [],
  patientsById,
  inpatients,
  kanbanSaving,
  onOpenPatient,
  onToggleTodoDone,
  onApplyBoardLayout,
  onUpdatePatientTags,
  onAddTodo,
}) => {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);
  const [tagDraftPatientId, setTagDraftPatientId] = useState<string | null>(null);
  const [tagDraftValue, setTagDraftValue] = useState('');

  const columns = wardColumns?.length ? wardColumns : WARD_BOARD_COLUMNS;
  const validColumnIds = useMemo(() => new Set(columns.map((c) => c.id)), [columns]);
  const defaultColId = columns[0]?.id ?? 'm';

  const resolveColumn = useCallback(
    (row: AdmittedPatientKanban): string => {
      const p = patientsById.get(row.patientId);
      const ip = findInpatientMatchingHaloPatient(p, inpatients);
      const inferred = ip ? clinicalWardToBoardColumn(ip.ward) : defaultColId;
      if (row.boardColumn && validColumnIds.has(row.boardColumn)) return row.boardColumn;
      return validColumnIds.has(inferred) ? inferred : defaultColId;
    },
    [patientsById, inpatients, validColumnIds, defaultColId]
  );

  const grouped = useMemo(() => {
    const m = emptyWardColumnMapForColumns<AdmittedPatientKanban>(columns);
    for (const r of admittedKanban) {
      m[resolveColumn(r)]!.push(r);
    }
    for (const col of columns) {
      m[col.id]!.sort((a, b) => {
        const oa = typeof a.columnOrder === 'number' ? a.columnOrder : 1e6;
        const ob = typeof b.columnOrder === 'number' ? b.columnOrder : 1e6;
        if (oa !== ob) return oa - ob;
        const na = patientsById.get(a.patientId)?.name || a.patientId;
        const nb = patientsById.get(b.patientId)?.name || b.patientId;
        return sortName(na, nb);
      });
    }
    return m;
  }, [admittedKanban, resolveColumn, patientsById, columns]);

  const unlinkedGrouped = useMemo(() => {
    const m = emptyWardColumnMapForColumns<InpatientRecord>(columns);
    for (const r of unlinkedAdmittedInpatients) {
      const target = clinicalWardToBoardColumn(r.ward);
      const col = validColumnIds.has(target) ? target : defaultColId;
      m[col]!.push(r);
    }
    for (const col of columns) {
      m[col.id]!.sort((a, b) => sortName(`${a.surname} ${a.firstName}`, `${b.surname} ${b.firstName}`));
    }
    return m;
  }, [unlinkedAdmittedInpatients, columns, validColumnIds, defaultColId]);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 768px)');
    if (!mq) return;
    const apply = () => setIsMobile(Boolean(mq.matches));
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, []);

  const sensors = useSensors(
    ...(isMobile
      ? [
          useSensor(TouchSensor, {
            activationConstraint: { delay: 250, tolerance: 5 },
          }),
        ]
      : [
          useSensor(PointerSensor, {
            activationConstraint: { distance: 6, delay: 0, tolerance: 5 },
          }),
        ])
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveDragId(null);
      if (!over) return;
      const activePid = String(active.id);
      const overRaw = String(over.id);
      const layout = buildLayoutFromGrouped(columns, grouped);
      const next = applyDragToLayout(layout, activePid, overRaw);
      if (next) onApplyBoardLayout(next);
    },
    [columns, grouped, onApplyBoardLayout]
  );

  const handleTogglePresetTag = useCallback(
    (patientId: string, preset: 'seen' | 'unseen') => {
      const row = admittedKanban.find((r) => r.patientId === patientId);
      if (!row) return;
      onUpdatePatientTags(patientId, cyclePresetTag(row.tags, preset));
    },
    [admittedKanban, onUpdatePatientTags]
  );

  const handleRemoveTag = useCallback(
    (patientId: string, tag: string) => {
      const row = admittedKanban.find((r) => r.patientId === patientId);
      if (!row) return;
      const t = tag.trim().toLowerCase();
      const next = (row.tags || []).map((x) => x.trim().toLowerCase()).filter((x) => x && x !== t);
      onUpdatePatientTags(patientId, next);
    },
    [admittedKanban, onUpdatePatientTags]
  );

  const handleSubmitTagDraft = useCallback(
    (patientId: string) => {
      const raw = tagDraftValue.trim().slice(0, 32).toLowerCase();
      if (!raw || raw === 'seen' || raw === 'unseen') {
        setTagDraftPatientId(null);
        setTagDraftValue('');
        return;
      }
      const row = admittedKanban.find((r) => r.patientId === patientId);
      if (!row) return;
      const cur = new Set((row.tags || []).map((x) => x.trim().toLowerCase()).filter(Boolean));
      cur.add(raw);
      onUpdatePatientTags(patientId, Array.from(cur));
      setTagDraftPatientId(null);
      setTagDraftValue('');
    },
    [tagDraftValue, admittedKanban, onUpdatePatientTags]
  );

  const overlayPatientId = activeDragId;

  return (
    <div className="flex flex-1 min-h-0 h-full min-w-0 flex-col">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        autoScroll={false}
        onDragStart={({ active }) => setActiveDragId(String(active.id))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDragId(null)}
      >
      <div
        className={`${wardBoardScrollerClass} max-md:[scroll-padding-inline:12px]`}
        style={
          isMobile
            ? { WebkitOverflowScrolling: 'touch', touchAction: 'pan-x' }
            : { touchAction: 'auto' }
        }
        role="region"
        aria-label="Ward board — compact list; tap a name for tasks"
      >
        {columns.map((col) => (
          <WardColumnDropZone
            key={col.id}
            col={col}
            ptCount={(grouped[col.id] ?? []).length + (unlinkedGrouped[col.id] ?? []).length}
          >
            <div
              className={`flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-y-contain bg-halo-section/50 pb-3 pt-2 ${wardColumnBodyPaddingClass}`}
              style={{ touchAction: 'pan-y' }}
            >
              <div className="flex min-w-0 max-w-full flex-col items-stretch">
                <SortableContext
                  items={(grouped[col.id] ?? []).map((r) => r.patientId)}
                  strategy={verticalListSortingStrategy}
                >
                  {(grouped[col.id] ?? []).map((row) => (
                    <KanbanCompactRow
                      key={row.patientId}
                      row={row}
                      patientsById={patientsById}
                      inpatients={inpatients}
                      onOpenTasks={() => setDetailTarget({ kind: 'halo', patientId: row.patientId })}
                      onTogglePresetTag={handleTogglePresetTag}
                      onRemoveTag={handleRemoveTag}
                      tagDraftPatientId={tagDraftPatientId}
                      tagDraftValue={tagDraftValue}
                      onTagDraftChange={(pid, v) => {
                        setTagDraftPatientId(pid);
                        setTagDraftValue(v.slice(0, 32));
                      }}
                      onOpenTagDraft={(pid) => {
                        setTagDraftPatientId(pid);
                        setTagDraftValue('');
                      }}
                      onCloseTagDraft={() => {
                        setTagDraftPatientId(null);
                        setTagDraftValue('');
                      }}
                      onSubmitTagDraft={handleSubmitTagDraft}
                    />
                  ))}
                </SortableContext>
                {(unlinkedGrouped[col.id] ?? []).map((record) => (
                  <button
                    key={`unlinked-${record.id}`}
                    type="button"
                    onClick={() => setDetailTarget({ kind: 'unlinked', recordId: record.id })}
                    className="my-2 w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left shadow-sm hover:bg-slate-100/90"
                  >
                    <div className="text-[9px] font-bold uppercase text-teal-600">No HALO link</div>
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {record.firstName} {record.surname}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </WardColumnDropZone>
        ))}
      </div>

      <DragOverlay adjustScale={false} dropAnimation={null}>
        {overlayPatientId ? (
          <WardDragOverlayCard
            patientId={overlayPatientId}
            patientsById={patientsById}
            inpatients={inpatients}
          />
        ) : null}
      </DragOverlay>

      <WardPatientDetailSheet
        target={detailTarget}
        onClose={() => setDetailTarget(null)}
        admittedKanban={admittedKanban}
        unlinkedList={unlinkedAdmittedInpatients}
        patientsById={patientsById}
        inpatients={inpatients}
        kanbanSaving={kanbanSaving}
        onOpenPatient={onOpenPatient}
        onToggleTodoDone={onToggleTodoDone}
        onAddTodo={onAddTodo}
      />
      </DndContext>
    </div>
  );
};
