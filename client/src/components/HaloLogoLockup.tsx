import React from 'react';

type Props = {
  className?: string;
  /** Sidebar default: ~40px tall, crisp on retina via srcSet to same asset (replace with @2x asset when available). */
  variant?: 'sidebar' | 'compact' | 'loading';
};

/**
 * Official HALO lockup — uses static raster asset only.
 * Replace `client/public/halo-brand-lockup-transparent.png` to update branding.
 */
export const HaloLogoLockup: React.FC<Props> = ({ className = '', variant = 'sidebar' }) => {
  const maxH =
    variant === 'sidebar' ? 'max-h-10' : variant === 'loading' ? 'max-h-11' : 'max-h-8';
  return (
    <img
      src="/halo-brand-lockup-transparent.png"
      alt="HALO"
      className={`block h-auto w-auto ${maxH} max-w-[min(220px,100%)] object-contain object-left bg-transparent [image-rendering:-webkit-optimize-contrast] ${className}`}
      decoding="async"
      draggable={false}
    />
  );
};
