import React from 'react';

/**
 * HALO brand mark: soft teal oval “halo” behind two dark vertical bars (reference logo).
 * Bars use halo text colour; ring uses primary accent.
 */
export const HaloMark: React.FC<{ className?: string; size?: number }> = ({
  className = '',
  size = 32,
}) => {
  const w = Math.round(size * 1.05);
  const h = size;
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 36 40"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      {/* Ring behind bars */}
      <ellipse
        cx="18"
        cy="20"
        rx="15"
        ry="7.5"
        fill="none"
        stroke="#4FB6B2"
        strokeWidth="1.35"
        transform="rotate(-6 18 20)"
        opacity="0.95"
      />
      {/* Left bar */}
      <rect x="8" y="8" width="5.5" height="24" rx="2.75" fill="#1F2937" />
      {/* Right bar, slightly shorter / offset for H feel */}
      <rect x="22.5" y="6" width="5.5" height="24" rx="2.75" fill="#1F2937" />
    </svg>
  );
};
