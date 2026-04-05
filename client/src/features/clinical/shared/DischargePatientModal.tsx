import React, { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { InpatientRecord } from '../../../types/clinical';
import {
  draftDischargeSummary,
  fetchDoctorKanban,
  saveDoctorKanban,
  uploadFile,
} from '../../../services/api';
import { updateInpatientRecord } from '../../../services/clinicalData';

export type DischargePatientModalProps = {
  open: boolean;
  onClose: () => void;
  /** HALO patient folder id — ward kanban + optional summary upload */
  haloPatientId: string | null;
  patientDisplayName: string;
  clinicalContext: string;
  initialSummaryText: string;
  /** Mock admission — marks not admitted + discharge date */
  inpatientRecord: InpatientRecord | null;
  onFinished: () => void | Promise<void>;
  onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
};

export const DischargePatientModal: React.FC<DischargePatientModalProps> = ({
  open,
  onClose,
  haloPatientId,
  patientDisplayName,
  clinicalContext,
  initialSummaryText,
  inpatientRecord,
  onFinished,
  onToast,
}) => {
  const [summaryText, setSummaryText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setSummaryText(initialSummaryText);
  }, [open, initialSummaryText]);

  const todayIso = new Date().toISOString().slice(0, 10);

  const removeFromKanbanIfLinked = useCallback(async () => {
    if (!haloPatientId) return;
    try {
      const { kanban } = await fetchDoctorKanban();
      const list = Array.isArray(kanban) ? kanban : [];
      const next = list.map((r) =>
        r.patientId === haloPatientId ? { ...r, admitted: false } : r
      );
      await saveDoctorKanban(next);
    } catch {
      onToast?.('Could not update ward board — check connection.', 'error');
    }
  }, [haloPatientId, onToast]);

  const markInpatientDischarged = useCallback(async () => {
    if (!inpatientRecord?.id) return;
    const d = inpatientRecord.dateOfDischarge?.trim();
    await updateInpatientRecord(inpatientRecord.id, {
      currentlyAdmitted: false,
      dateOfDischarge: d || todayIso,
    });
  }, [inpatientRecord, todayIso]);

  const handleDraft = useCallback(async () => {
    const ctx = clinicalContext.trim();
    if (!ctx || ctx.length < 8) {
      onToast?.('Not enough linked data to draft — edit the summary manually.', 'info');
      return;
    }
    setBusy(true);
    try {
      const { text } = await draftDischargeSummary({
        patientName: patientDisplayName,
        clinicalContext: ctx,
      });
      setSummaryText(text || '');
      onToast?.('Draft ready — review before saving.', 'success');
    } catch {
      onToast?.('Could not draft summary — check server and GEMINI_API_KEY.', 'error');
    } finally {
      setBusy(false);
    }
  }, [clinicalContext, patientDisplayName, onToast]);

  const handleBoardOnly = useCallback(async () => {
    setBusy(true);
    try {
      await markInpatientDischarged();
      await removeFromKanbanIfLinked();
      await onFinished();
      onClose();
      onToast?.('Patient discharged from Hospital sheet and ward board.', 'success');
    } catch {
      onToast?.('Discharge failed — try again.', 'error');
    } finally {
      setBusy(false);
    }
  }, [markInpatientDischarged, removeFromKanbanIfLinked, onFinished, onClose, onToast]);

  const handleSaveSummaryAndDischarge = useCallback(async () => {
    setBusy(true);
    try {
      await markInpatientDischarged();
      if (haloPatientId && summaryText.trim()) {
        const iso = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const file = new File([summaryText.trim()], `Discharge_summary_${iso}.txt`, {
          type: 'text/plain;charset=utf-8',
        });
        await uploadFile(haloPatientId, file);
      }
      await removeFromKanbanIfLinked();
      await onFinished();
      onClose();
      onToast?.(
        summaryText.trim() && haloPatientId
          ? 'Summary saved, patient discharged from Hospital and ward board.'
          : 'Patient discharged from Hospital and ward board.',
        'success'
      );
    } catch {
      onToast?.('Could not complete discharge — check connection.', 'error');
    } finally {
      setBusy(false);
    }
  }, [
    markInpatientDischarged,
    haloPatientId,
    summaryText,
    removeFromKanbanIfLinked,
    onFinished,
    onClose,
    onToast,
  ]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/50 overscroll-contain"
      role="dialog"
      aria-modal="true"
      aria-labelledby="discharge-patient-modal-title"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl border border-slate-200 p-4 sm:p-5 max-h-[min(90dvh,720px)] overflow-y-auto">
        <div className="flex items-start justify-between gap-2 mb-3">
          <h2 id="discharge-patient-modal-title" className="text-lg font-bold text-slate-900 pr-2">
            Discharge patient
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
        <p className="text-sm font-semibold text-slate-800">{patientDisplayName}</p>
        <p className="text-xs text-slate-500 mt-1 mb-3">
          Marks the admission as not admitted, removes them from the ward board if linked to HALO, and optionally saves a discharge
          summary to the patient folder.
        </p>
        <label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="discharge-summary-modal-ta">
          Discharge summary
        </label>
        <textarea
          id="discharge-summary-modal-ta"
          rows={10}
          value={summaryText}
          onChange={(e) => setSummaryText(e.target.value)}
          disabled={busy}
          placeholder="Type or use Draft with AI."
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 resize-y min-h-[140px]"
        />
        <div className="flex flex-col gap-2 mt-4">
          <button
            type="button"
            onClick={() => void handleDraft()}
            disabled={busy}
            className="min-h-[44px] px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Draft with AI'}
          </button>
          <div className="flex flex-col sm:flex-row flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleBoardOnly()}
              disabled={busy}
              className="min-h-[44px] flex-1 px-4 py-2 rounded-lg text-sm font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Discharge (no file)
            </button>
            <button
              type="button"
              onClick={() => void handleSaveSummaryAndDischarge()}
              disabled={busy}
              className="min-h-[44px] flex-1 px-4 py-2 rounded-lg text-sm font-semibold bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-50"
            >
              Save summary &amp; discharge
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-[44px] px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
