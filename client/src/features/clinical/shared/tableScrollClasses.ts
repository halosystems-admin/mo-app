/**
 * Wide tables: use ClinicalTableScroll (outer card + inner scrollport) so rounded
 * corners do not clip the first/last columns, and overscroll stays on the table.
 */
export const CLINICAL_TABLE_CARD_OUTER =
  'rounded-xl border border-slate-200/90 bg-white max-w-full min-w-0 shadow-sm overflow-hidden';

export const CLINICAL_TABLE_SCROLL_INNER =
  'overflow-x-auto overscroll-x-none max-w-full';

/** Coloured header strip for clinical spreadsheet tables (Hospital mock). */
export const CLINICAL_TABLE_THEAD =
  'bg-violet-700 text-left border-b-2 border-violet-900/25 shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.08)]';

export const CLINICAL_TABLE_TH =
  'px-3 py-2.5 text-left font-bold uppercase tracking-wide text-[10px] text-white/95';

/**
 * Body rows: light zebra striping + clearer line under each row + hover.
 * Slightly warmer hover so it reads on both odd/even bands.
 */
export const CLINICAL_TABLE_TBODY_TR =
  'border-t border-slate-200/65 first:border-t-0 odd:bg-white even:bg-slate-50/90 cursor-pointer transition-colors hover:bg-violet-50/85';

/** @deprecated Use CLINICAL_TABLE_TBODY_TR (includes hover). */
export const CLINICAL_TABLE_TBODY_HOVER = 'hover:bg-violet-50/85';

/** Horizontal-only lists (e.g. ward board). */
export const CLINICAL_HORIZONTAL_SCROLL =
  'flex gap-3 overflow-x-auto max-w-full overscroll-x-none pb-2 -mx-1 px-1';
