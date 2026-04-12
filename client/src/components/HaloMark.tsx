import React from 'react';

const TEAL = '#4FB6B2';
const BAR = '#1F2937';

/**
 * HALO brand mark (icon only): teal halo as left/right arc segments with clear gaps
 * beside the bars — bars sit in front. Matches official lockup proportions; pair with
 * teal “HALO” wordmark in the sidebar/header.
 */
export const HaloMark: React.FC<{ className?: string; size?: number }> = ({
  className = '',
  size = 32,
}) => {
  const h = size;
  const w = Math.round(h * (56 / 44));
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 56 44"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      {/* Halo ring — behind bars; two strokes read as one ellipse with bar clearance */}
      <path
        d="M 12.5 16.5 A 15.5 8.2 0 0 0 9 22.2 A 15.5 8.2 0 0 0 12.5 27.8"
        fill="none"
        stroke={TEAL}
        strokeWidth={2.35}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 43.5 16.5 A 15.5 8.2 0 0 1 47 22.2 A 15.5 8.2 0 0 1 43.5 27.8"
        fill="none"
        stroke={TEAL}
        strokeWidth={2.35}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Vertical bars — rounded caps, aligned centre */}
      <rect x="19.25" y="4.5" width="6.25" height="35" rx="3.125" fill={BAR} />
      <rect x="30.5" y="4.5" width="6.25" height="35" rx="3.125" fill={BAR} />
    </svg>
  );
};
