import React from 'react';
import { Loader, Mic, Pause, Play, Square } from 'lucide-react';
import { useConsultationRecorderUiState } from './consultationRecorderStore';

/** Mobile-only round mic FAB above bottom tab nav — triggers existing HeaderConsultationRecorder via events. */
export const MobileDictateFab: React.FC = () => {
  const { isLive, isPaused, isBusy, displayTime } = useConsultationRecorderUiState();

  const onDictate = () => {
    window.dispatchEvent(new Event('halo:toggle-consultation-dictation'));
  };

  const onPause = () => {
    window.dispatchEvent(new Event('halo:toggle-consultation-pause'));
  };

  return (
    <div
      className="md:hidden fixed inset-x-0 z-40 flex flex-col items-center justify-end gap-2 pointer-events-none px-4"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)',
        height: '5.5rem',
      }}
    >
      <div className="pointer-events-auto flex flex-col items-center gap-2">
      {isLive ? (
        <div className="flex items-center gap-2 rounded-full border border-red-200 bg-white px-3 py-1.5 shadow-lg">
          <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" aria-hidden />
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 tabular-nums">
            {displayTime}
          </span>
          <button
            type="button"
            onClick={onPause}
            className={`halo-touch-min flex h-11 w-11 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/35 ${
              isPaused ? 'bg-amber-500 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'
            }`}
            aria-label={isPaused ? 'Resume dictation' : 'Pause dictation'}
          >
            {isPaused ? <Play size={16} strokeWidth={2.25} /> : <Pause size={16} strokeWidth={2.25} />}
          </button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onDictate}
        disabled={isBusy}
        title={isLive ? 'Stop dictation' : isBusy ? 'Processing…' : 'Dictate'}
        className={`halo-touch-min flex h-14 w-14 items-center justify-center rounded-full shadow-lg ring-4 transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/35 disabled:opacity-60 ${
          isLive
            ? 'bg-rose-500 text-white ring-rose-200/80 animate-pulse'
            : 'bg-teal-600 text-white ring-[var(--color-halo-bg,#f7f9fb)] hover:bg-teal-700 hover:scale-105'
        }`}
        aria-label={isLive ? 'Stop dictation' : 'Start dictation'}
      >
        {isBusy ? (
          <Loader className="h-5 w-5 animate-spin" aria-hidden />
        ) : isLive ? (
          <Square className="h-4 w-4 fill-current" aria-hidden />
        ) : (
          <Mic className="h-5 w-5" aria-hidden />
        )}
      </button>
      </div>
    </div>
  );
};
