import React from 'react';
import { Keyboard, Mic } from 'lucide-react';

type Props = {
  onType: () => void;
  onDictate: () => void;
  disabled?: boolean;
  /** Compact styling for ward sheet footers */
  compact?: boolean;
  className?: string;
};

/** Type + Dictate for clinical notes (PatientWorkspace transcript flow). */
export const ConsultationTypeDictateButtons: React.FC<Props> = ({
  onType,
  onDictate,
  disabled = false,
  compact = false,
  className = '',
}) => {
  const btn = compact
    ? 'inline-flex items-center justify-center gap-1 min-h-[36px] flex-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-50'
    : 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50';

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={onType}
        className={`${btn} border border-slate-200/90 bg-white text-slate-700 shadow-sm hover:bg-slate-50`}
      >
        <Keyboard size={compact ? 14 : 16} strokeWidth={2} aria-hidden />
        Type
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onDictate}
        className={`${btn} border border-teal-200/80 bg-teal-600 text-white shadow-sm hover:bg-teal-700`}
      >
        <Mic size={compact ? 14 : 16} strokeWidth={2} aria-hidden />
        Dictate
      </button>
    </div>
  );
};
