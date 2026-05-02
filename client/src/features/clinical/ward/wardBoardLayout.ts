/**
 * Ward Kanban layout system — single source for column width, gap, and scroll behaviour.
 * Horizontal scroll only on the board row; columns are fixed width and stretch to equal height.
 */

/** Fixed column width (px). All ward columns use this width. */
export const WARD_COLUMN_WIDTH_PX = 300;

/** Tailwind: fixed width + no shrink (identical columns). */
export const wardColumnWidthClass = `md:w-[300px] md:min-w-[300px] md:max-w-[300px] shrink-0`;

/** Gap between columns (1.5rem = 24px). */
export const wardBoardGapClass = 'gap-6';

/** Horizontal padding inside column body (card area). */
export const wardColumnBodyPaddingClass = 'px-3';

/** Board-level horizontal scroller: only this element scrolls on x (desktop). Mobile overrides in index.css. */
/** Desktop (md+): horizontal scroll with snap. Mobile snap is set in `index.css` (max-width 768px). */
export const wardBoardScrollerClass = [
  'flex min-h-0 flex-1 flex-nowrap items-stretch',
  wardBoardGapClass,
  'overflow-x-auto overflow-y-hidden',
  'overscroll-x-contain',
  'pb-3 pt-2 pl-4 pr-6 sm:pl-5 sm:pr-8',
  'touch-pan-x md:snap-x md:snap-mandatory halo-hide-scrollbar-mobile',
].join(' ');
