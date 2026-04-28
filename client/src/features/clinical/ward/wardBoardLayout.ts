/**
 * Ward Kanban layout system — single source for column width, gap, and scroll behaviour.
 * Horizontal scroll only on the board row; columns are fixed width and stretch to equal height.
 */

/** Fixed column width (px). All ward columns use this width. */
export const WARD_COLUMN_WIDTH_PX = 300;

/** Tailwind: fixed width + no shrink (identical columns). */
export const wardColumnWidthClass = `max-md:w-[100vw] max-md:min-w-[100vw] max-md:max-w-[100vw] md:w-[300px] md:min-w-[300px] md:max-w-[300px] shrink-0`;

/** Gap between columns (1.5rem = 24px). */
export const wardBoardGapClass = 'max-md:gap-0 md:gap-6';

/** Horizontal padding inside column body (card area). */
export const wardColumnBodyPaddingClass = 'px-3';

/** Board-level horizontal scroller: only this element scrolls on x. */
export const wardBoardScrollerClass = [
  'flex min-h-0 flex-1 flex-nowrap items-stretch',
  wardBoardGapClass,
  'overflow-x-auto overflow-y-hidden',
  'overscroll-x-contain',
  'max-md:px-0 md:pb-3 md:pt-2 md:pl-4 md:pr-6 lg:pl-5 lg:pr-8',
  'touch-pan-x snap-x snap-mandatory halo-hide-scrollbar-mobile',
].join(' ');
