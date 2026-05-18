import React from 'react';
import { Keyboard, Loader, Mic, Pause, Play, Square } from 'lucide-react';
import type { ConsultationRecorderUiState } from './consultationRecorderStore';

type Props = {
  visible: boolean;
  recorder: ConsultationRecorderUiState;
  onType: () => void;
  onDictate: () => void;
  onPause: () => void;
};

/** Fixed strip above mobile tab nav — Dictate + Type (no overlap with modals). */
export const MobileConsultationActionBar: React.FC<Props> = ({
  visible,
  recorder,
  onType,
  onDictate,
  onPause,
}) => {
  if (!visible) return null;

  const { isLive, isPaused, isBusy, displayTime } = recorder;

  return (
    <div
      className="md:hidden fixed inset-x-0 z-40 flex items-stretch gap-2 border-t border-slate-200/90 bg-white/95 px-3 py-2 shadow-[0_-2px_12px_rgba(0,0,0,0.06)] backdrop-blur-sm"
      style={{ bottom: 'calc(3.25rem + env(safe-area-inset-bottom, 0px))' }}
      role="toolbar"
      aria-label="Consultation actions"
    >
      <button
        type="button"
        onClick={onType}
        disabled={isBusy || isLive}
        className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200/90 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm active:scale-[0.98] disabled:opacity-50"
      >
        <Keyboard size={18} strokeWidth={2} aria-hidden />
        Type
      </button>

      {isLive ? (
        <button
          type="button"
          onClick={onPause}
          className={`flex min-h-[44px] w-12 shrink-0 items-center justify-center rounded-xl border shadow-sm active:scale-[0.98] ${
            isPaused
              ? 'border-amber-200 bg-amber-500 text-white'
              : 'border-slate-200/90 bg-white text-slate-700'
          }`}
          aria-label={isPaused ? 'Resume dictation' : 'Pause dictation'}
        >
          {isPaused ? <Play size={20} strokeWidth={2.25} /> : <Pause size={20} strokeWidth={2.25} />}
        </button>
      ) : null}

      <button
        type="button"
        onClick={onDictate}
        disabled={isBusy}
        className={`flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold text-white shadow-md active:scale-[0.98] disabled:opacity-50 ${
          isLive ? (isPaused ? 'bg-amber-500' : 'bg-rose-500') : 'bg-teal-600'
        }`}
        aria-label={isLive ? 'Stop dictation' : 'Dictate'}
      >
        {isBusy ? (
          <Loader className="size-5 animate-spin" aria-hidden />
        ) : isLive ? (
          <>
            {!isPaused ? (
              <span className="inline-block h-2 w-2 rounded-full bg-white animate-pulse" aria-hidden />
            ) : null}
            <Square size={18} strokeWidth={2.75} aria-hidden />
            <span className="tabular-nums text-xs font-bold">{displayTime}</span>
          </>
        ) : (
          <>
            <Mic size={18} strokeWidth={2} aria-hidden />
            Dictate
          </>
        )}
      </button>
    </div>
  );
};

