import type { WardBoardColumnId } from '../../../../../shared/types';

/** Single source of truth for ward board lanes (Ward + drag targets + admit picker). */
export const WARD_BOARD_COLUMNS: { id: WardBoardColumnId; label: string }[] = [
  { id: 'icu', label: 'ICU' },
  { id: 'f', label: 'F ward' },
  { id: 's', label: 'S ward' },
  { id: 'm', label: 'Medical' },
  { id: 'paeds', label: 'Paediatrics' },
  { id: 'ed', label: 'Emergency' },
  { id: 'labour', label: 'Labour' },
];

export const WARD_BOARD_COLUMN_IDS = new Set<WardBoardColumnId>(WARD_BOARD_COLUMNS.map((c) => c.id));

export function emptyWardColumnMap<T>(): Record<WardBoardColumnId, T[]> {
  const m = {} as Record<WardBoardColumnId, T[]>;
  for (const { id } of WARD_BOARD_COLUMNS) m[id] = [];
  return m;
}

/** Dynamic board columns from Supabase (or any source) — same shape as WARD_BOARD_COLUMNS rows. */
export function emptyWardColumnMapForColumns<T>(cols: Array<{ id: string }>): Record<string, T[]> {
  const m: Record<string, T[]> = {};
  for (const { id } of cols) m[id] = [];
  return m;
}
