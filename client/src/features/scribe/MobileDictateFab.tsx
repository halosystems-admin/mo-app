import React from 'react';
import { Loader2, Mic, Pause, Play, Square } from 'lucide-react';
import { useConsultationRecorderUiState } from './consultationRecorderStore';

/** Mobile-only round mic FAB above bottom tab nav — triggers existing HeaderConsultationRecorder via events. */
export const MobileDictateFab: React.FC = () => {
  const { isLive, isPaused, isBusy, isFinalizing, displayTime } = useConsultationRecorderUiState();

  const onDictate = () => {
    if (isBusy || isFinalizing) return;
    window.dispatchEvent(new Event('halo:toggle-consultation-dictation'));
  };

  const onPause = () => {
    if (isFinalizing) return;
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
        {isLive && !isFinalizing ? (
          <div className="flex items-center gap-2 rounded-full border border-red-200 bg-white px-3 py-1.5 shadow-lg">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" aria-hidden />
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 tabular-nums">
              {displayTime}
            </span>
            <button
              type="button"
              onClick={onPause}
              className="halo-touch-min flex h-11 w-11 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/35"
              aria-label={isPaused ? 'Resume dictation' : 'Pause dictation'}
              style={
                isPaused
                  ? { backgroundColor: '#f59e0b', color: '#fff' }
                  : { backgroundColor: '#fff', color: '#334155', boxShadow: 'inset 0 0 0 1px #e2e8f0' }
              }
            >
              {isPaused ? <Play size={16} strokeWidth={2.25} /> : <Pause size={16} strokeWidth={2.25} />}
            </button>
          </div>
        ) : null}

        <button
          type="button"
          onClick={onDictate}
          disabled={isBusy}
          title={
            isFinalizing
              ? 'Finalizing transcript…'
              : isLive
                ? 'Stop dictation (Done)'
                : isBusy
                  ? 'Connecting…'
                  : 'Dictate'
          }
          className={`halo-touch-min flex h-14 w-14 items-center justify-center rounded-full shadow-lg ring-4 transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/35 disabled:cursor-wait disabled:opacity-70 ${
            isFinalizing
              ? 'bg-amber-500 text-white ring-amber-200/80'
              : isLive
                ? 'bg-rose-500 text-white ring-rose-200/80'
                : 'bg-teal-600 text-white ring-[var(--color-halo-bg,#f7f9fb)] hover:bg-teal-700 hover:scale-105'
          }`}
          aria-label={
            isFinalizing
              ? 'Finalizing transcript'
              : isLive
                ? 'Stop dictation'
                : 'Start dictation'
          }
        >
          {isFinalizing ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          ) : isBusy && !isLive ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
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
