/**
 * Wide tables: use ClinicalTableScroll (outer card + inner scrollport) so rounded
 * corners do not clip the first/last columns, and overscroll stays on the table.
 */
export const CLINICAL_TABLE_CARD_OUTER =
  'rounded-xl border border-slate-200/90 bg-white max-w-full min-w-0 shadow-sm overflow-hidden';

export const CLINICAL_TABLE_SCROLL_INNER =
  'overflow-x-auto overscroll-x-none max-w-full';

/**
 * One accent for the whole clinical shell: teal-500 (sidebar, tabs, headers, buttons).
 * Kept slightly soft vs teal-600 for a lighter “clinical OS” feel.
 */
export const CLINICAL_HEADER_BAND =
  'bg-teal-500 text-left border-b border-white/15 shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.06)]';

/** Table thead — same token as ward column strip. */
export const CLINICAL_TABLE_THEAD = CLINICAL_HEADER_BAND;

/** Sheets / clinical table header cells — one consistent scale with ward strips. */
export const CLINICAL_TABLE_TH =
  'px-3 py-2 text-left font-semibold uppercase tracking-wider text-[10px] leading-tight text-white/95';

/** Primary Sheets tab / filter chip shape (sentence or caps — add `uppercase tracking-wider` for main dashboard tabs only). */
export const SHEETS_TAB_ACTIVE =
  'px-2.5 py-1.5 rounded-[10px] text-[11px] font-semibold bg-halo-primary text-white shadow-[var(--shadow-halo-soft)]';

export const SHEETS_TAB_IDLE =
  'px-2.5 py-1.5 rounded-[10px] text-[11px] font-semibold bg-halo-section text-halo-text-secondary hover:bg-halo-border/40';

/**
 * Body rows: light zebra striping + clearer line under each row + hover.
 */
export const CLINICAL_TABLE_TBODY_TR =
  'border-t border-slate-200/65 first:border-t-0 odd:bg-white even:bg-slate-50/90 cursor-pointer transition-colors hover:bg-teal-500/[0.06]';

/** @deprecated Use CLINICAL_TABLE_TBODY_TR (includes hover). */
export const CLINICAL_TABLE_TBODY_HOVER = 'hover:bg-teal-500/[0.06]';

/** Horizontal-only lists (e.g. ward board). */
export const CLINICAL_HORIZONTAL_SCROLL =
  'flex gap-3 overflow-x-auto max-w-full overscroll-x-none pb-2 -mx-1 px-1';

/** Small primary control — use across Sheets / Ward / sidebar actions. */
export const CLINICAL_BTN_PRIMARY =
  'inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-teal-500 text-white hover:bg-teal-500/90 disabled:opacity-50 shadow-sm transition-colors';

/** Muted outline control. */
export const CLINICAL_BTN_SECONDARY =
  'inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors';
