import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import type { AdmittedPatientKanban, Patient, WardBoardColumnId } from '../../../../../shared/types';
import type { InpatientRecord } from '../../../types/clinical';
import { clinicalWardToBoardColumn, findInpatientMatchingHaloPatient } from '../../../services/clinicalData';
import { CLINICAL_HEADER_BAND } from '../shared/tableScrollClasses';
import {
  WARD_BOARD_COLUMNS,
  WARD_BOARD_COLUMN_IDS,
  emptyWardColumnMap,
} from '../shared/wardBoardColumns';
import { ExternalLink, GripVertical, Plus, X } from 'lucide-react';

const VALID_COLUMN_IDS = WARD_BOARD_COLUMN_IDS;

const DROPPABLE_PREFIX = 'ward-col:';

function droppableId(col: WardBoardColumnId): string {
  return `${DROPPABLE_PREFIX}${col}`;
}

function parseDroppableCol(id: string): WardBoardColumnId | null {
  if (!id.startsWith(DROPPABLE_PREFIX)) return null;
  const col = id.slice(DROPPABLE_PREFIX.length) as WardBoardColumnId;
  return VALID_COLUMN_IDS.has(col) ? col : null;
}

const DRAG_PREFIX = 'ward-patient:';

function dragId(patientId: string): string {
  return `${DRAG_PREFIX}${patientId}`;
}

function parseDragPatientId(id: string | number): string | null {
  const s = String(id);
  return s.startsWith(DRAG_PREFIX) ? s.slice(DRAG_PREFIX.length) : null;
}

/** Prefer pointer-inside column hit-testing; falls back to rectangle overlap for smoother drops. */
const wardBoardCollision: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  if (pointerHits.length > 0) return pointerHits;
  return rectIntersection(args);
};

function sortName(a: string, b: string): number {
  return a.toLowerCase().localeCompare(b.toLowerCase());
}

type Props = {
  admittedKanban: AdmittedPatientKanban[];
  unlinkedAdmittedInpatients?: InpatientRecord[];
  patientsById: Map<string, Patient>;
  inpatients: InpatientRecord[];
  kanbanSaving: boolean;
  onOpenPatient: (patientId: string) => void;
  onToggleTodoDone: (patientId: string, todoId: string, done: boolean) => void;
  onSetBoardColumn: (patientId: string, column: WardBoardColumnId) => void;
  onAddTodo: (patientId: string, title: string) => void;
};

type ColumnProps = {
  col: (typeof WARD_BOARD_COLUMNS)[number];
  ptCount: number;
  children: React.ReactNode;
};

const WardColumnDropZone = memo(function WardColumnDropZone({ col, ptCount, children }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: droppableId(col.id) });
  return (
    <div
      ref={setNodeRef}
      className={`flex-1 basis-0 min-w-[min(100%,180px)] sm:min-w-[200px] md:min-w-[220px] max-w-full snap-start rounded-xl border bg-white flex flex-col min-h-0 h-full shadow-sm ${
        isOver ? 'border-teal-400 ring-2 ring-teal-300/50 shadow-md' : 'border-slate-200/90'
      }`}
    >
      <div className={`px-2.5 py-1.5 rounded-t-xl ${CLINICAL_HEADER_BAND}`}>
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
      className="w-[200px] sm:w-[220px] rounded-lg border-2 border-teal-500 bg-white px-2 py-2 shadow-xl cursor-grabbing select-none will-change-transform"
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
};

const KanbanCompactRow = memo(function KanbanCompactRow({
  row,
  patientsById,
  inpatients,
  onOpenTasks,
}: CompactRowProps) {
  const p = patientsById.get(row.patientId);
  const name = p?.name || row.patientId;
  const ip = findInpatientMatchingHaloPatient(p, inpatients);
  const folder = ip?.folderNumber ?? '—';
  const doctor = ip?.assignedDoctor ?? '—';
  const todos = row.todos || [];
  const openCount = todos.filter((t) => t.status !== 'Done').length;

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId(row.patientId),
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex items-stretch gap-0 rounded-xl border border-slate-200/90 bg-white shadow-sm mx-3 my-2 ${
        isDragging ? 'opacity-0 pointer-events-none' : ''
      }`}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        className="flex items-center justify-center w-9 shrink-0 cursor-grab active:cursor-grabbing touch-none text-slate-400 hover:text-teal-500 hover:bg-teal-50/60"
        style={{ touchAction: 'none' }}
        title="Drag to another ward"
        aria-label={`Drag ${name} to another ward`}
      >
        <GripVertical size={16} strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={onOpenTasks}
        className="min-w-0 flex-1 text-left py-3 pr-2 pl-0 hover:bg-slate-50/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-inset"
        aria-label={`Open ward tasks for ${name}`}
      >
        <div className="text-sm font-semibold text-slate-900 leading-tight truncate">{name}</div>
        <div className="text-[10px] text-slate-500 truncate mt-0.5">
          {folder} · {doctor}
        </div>
      </button>
      <div className="flex items-center pr-1.5 shrink-0">
        {openCount > 0 ? (
          <span
            className="min-w-[1.25rem] text-center text-[10px] font-bold tabular-nums px-1 py-0.5 rounded-full bg-teal-100 text-teal-900"
            title={`${openCount} open task(s)`}
          >
            {openCount}
          </span>
        ) : (
          <span className="w-6 text-center text-[10px] text-slate-300" title="No open tasks">
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
                  <p className="text-sm text-slate-400 py-2">No tasks yet — use Add.</p>
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
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 sm:max-w-[120px]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export const WardKanbanBoard: React.FC<Props> = ({
  admittedKanban,
  unlinkedAdmittedInpatients = [],
  patientsById,
  inpatients,
  kanbanSaving,
  onOpenPatient,
  onToggleTodoDone,
  onSetBoardColumn,
  onAddTodo,
}) => {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);

  const resolveColumn = useCallback(
    (row: AdmittedPatientKanban): WardBoardColumnId => {
      const p = patientsById.get(row.patientId);
      const ip = findInpatientMatchingHaloPatient(p, inpatients);
      const inferred = ip ? clinicalWardToBoardColumn(ip.ward) : 'm';
      if (row.boardColumn && VALID_COLUMN_IDS.has(row.boardColumn)) return row.boardColumn;
      return inferred;
    },
    [patientsById, inpatients]
  );

  const grouped = useMemo(() => {
    const m = emptyWardColumnMap<AdmittedPatientKanban>();
    for (const r of admittedKanban) {
      m[resolveColumn(r)].push(r);
    }
    for (const col of WARD_BOARD_COLUMNS) {
      m[col.id].sort((a, b) => {
        const na = patientsById.get(a.patientId)?.name || a.patientId;
        const nb = patientsById.get(b.patientId)?.name || b.patientId;
        return sortName(na, nb);
      });
    }
    return m;
  }, [admittedKanban, resolveColumn, patientsById]);

  const unlinkedGrouped = useMemo(() => {
    const m = emptyWardColumnMap<InpatientRecord>();
    for (const r of unlinkedAdmittedInpatients) {
      m[clinicalWardToBoardColumn(r.ward)].push(r);
    }
    for (const col of WARD_BOARD_COLUMNS) {
      m[col.id].sort((a, b) => sortName(`${a.surname} ${a.firstName}`, `${b.surname} ${b.firstName}`));
    }
    return m;
  }, [unlinkedAdmittedInpatients]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6, delay: 0, tolerance: 5 },
    })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      try {
        if (!over) return;
        const col = parseDroppableCol(String(over.id));
        const patientId = parseDragPatientId(active.id);
        if (!col || !patientId) return;
        const row = admittedKanban.find((r) => r.patientId === patientId);
        if (!row) return;
        if (resolveColumn(row) === col) return;
        onSetBoardColumn(patientId, col);
      } finally {
        setActiveDragId(null);
      }
    },
    [admittedKanban, onSetBoardColumn, resolveColumn]
  );

  const overlayPatientId = activeDragId ? parseDragPatientId(activeDragId) : null;

  return (
    <div className="flex flex-1 min-h-0 h-full min-w-0 flex-col">
      <DndContext
        sensors={sensors}
        collisionDetection={wardBoardCollision}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        autoScroll={false}
        onDragStart={({ active }) => setActiveDragId(String(active.id))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDragId(null)}
      >
      <div
        className="flex gap-3 sm:gap-4 md:gap-5 w-full h-full min-h-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden pb-2 pt-1 max-w-full min-w-0 -mx-0.5 px-0.5 snap-x snap-mandatory touch-pan-x"
        style={{ WebkitOverflowScrolling: 'touch' }}
        role="region"
        aria-label="Ward board — compact list; tap a name for tasks"
      >
        {WARD_BOARD_COLUMNS.map((col) => (
          <WardColumnDropZone
            key={col.id}
            col={col}
            ptCount={grouped[col.id].length + unlinkedGrouped[col.id].length}
          >
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-slate-50/40 px-2 pb-2">
              <div className="flex flex-col">
                {grouped[col.id].map((row) => (
                  <KanbanCompactRow
                    key={row.patientId}
                    row={row}
                    patientsById={patientsById}
                    inpatients={inpatients}
                    onOpenTasks={() => setDetailTarget({ kind: 'halo', patientId: row.patientId })}
                  />
                ))}
                {unlinkedGrouped[col.id].map((record) => (
                  <button
                    key={`unlinked-${record.id}`}
                    type="button"
                    onClick={() => setDetailTarget({ kind: 'unlinked', recordId: record.id })}
                    className="w-full text-left rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100/90 mx-3 my-2 px-3 py-2.5 shadow-sm"
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
