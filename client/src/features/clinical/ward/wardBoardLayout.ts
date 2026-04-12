/**
 * Ward Kanban layout system — single source for column width, gap, and scroll behaviour.
 * Horizontal scroll only on the board row; columns are fixed width and stretch to equal height.
 */

/** Fixed column width (px). All ward columns use this width. */
export const WARD_COLUMN_WIDTH_PX = 300;

/** Tailwind: fixed width + no shrink (identical columns). */
export const wardColumnWidthClass = `w-[300px] min-w-[300px] max-w-[300px] shrink-0`;

/** Gap between columns (1.5rem = 24px). */
export const wardBoardGapClass = 'gap-6';

/** Horizontal padding inside column body (card area). */
export const wardColumnBodyPaddingClass = 'px-3';

/** Board-level horizontal scroller: only this element scrolls on x. */
export const wardBoardScrollerClass = [
  'flex min-h-0 flex-1 flex-nowrap items-stretch',
  wardBoardGapClass,
  'overflow-x-auto overflow-y-hidden',
  'overscroll-x-contain',
  'pb-3 pt-2 pl-4 pr-6 sm:pl-5 sm:pr-8',
  'touch-pan-x snap-x snap-mandatory',
].join(' ');
