import React from 'react';
import { Captions, ExternalLink, Keyboard, Mic, X } from 'lucide-react';

type Props = {
  open: boolean;
  patientName: string;
  onClose: () => void;
  onOpenWorkspace: () => void;
  onType: () => void;
  onDictate: () => void;
};

/** Mobile-friendly launcher for patient-name actions in Ward / Sheets. */
export const ClinicalConsultationChoiceModal: React.FC<Props> = ({
  open,
  patientName,
  onClose,
  onOpenWorkspace,
  onType,
  onDictate,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/45 p-3 md:items-center">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close consultation options"
        onClick={onClose}
      />
      <div className="relative flex w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Patient actions</div>
            <h3 className="truncate text-sm font-semibold text-slate-900">{patientName}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-2 p-3">
          <button
            type="button"
            onClick={onDictate}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-teal-700"
          >
            <Mic className="size-4" aria-hidden />
            Dictate
          </button>
          <button
            type="button"
            onClick={onType}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            <Keyboard className="size-4" aria-hidden />
            Type
          </button>
          <button
            type="button"
            onClick={onOpenWorkspace}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            <ExternalLink className="size-4" aria-hidden />
            Open patient workspace
          </button>
        </div>

        <div className="border-t border-slate-100 px-4 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <Captions className="size-3.5 shrink-0" aria-hidden />
            Dictate opens the same consultation transcription flow used in Patient folders.
          </div>
        </div>
      </div>
    </div>
  );
};
