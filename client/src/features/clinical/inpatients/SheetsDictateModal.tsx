import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square, Wand2, X } from 'lucide-react';
import { transcribeAudio } from '../../../services/api';
import type { InpatientRecord } from '../../../types/clinical';

export type SheetsDictateField = 'surgeonPlan' | 'managementPlan' | 'inpatientNotes' | 'wardTodos';

const FIELD_LABELS: Record<SheetsDictateField, string> = {
  surgeonPlan: 'Surgeon plan',
  managementPlan: 'Mx plan',
  inpatientNotes: 'Notes',
  wardTodos: 'Ward To do (comma-separated)',
};

function fieldValue(r: InpatientRecord, f: SheetsDictateField): string {
  if (f === 'wardTodos') return r.taskIndicators.map((t) => t.label).join(', ');
  return (r[f] as string) ?? '';
}

interface Props {
  open: boolean;
  onClose: () => void;
  patient: InpatientRecord | null;
  onApply: (patientId: string, patch: Partial<InpatientRecord>) => Promise<void>;
  onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export const SheetsDictateModal: React.FC<Props> = ({ open, onClose, patient, onApply, onToast }) => {
  const [field, setField] = useState<SheetsDictateField>('surgeonPlan');
  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [applying, setApplying] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef('audio/webm');

  useEffect(() => {
    if (!open) return;
    if (!patient) {
      setText('');
      return;
    }
    setText(fieldValue(patient, field));
  }, [open, patient, field]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current) {
        try {
          mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      setIsRecording(false);
    }
  }, [isRecording]);

  const startRecording = async () => {
    if (!patient) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
          ? 'audio/ogg;codecs=opus'
          : 'audio/webm';
      mimeRef.current = mimeType;
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        setIsProcessing(true);
        try {
          const blob = new Blob(chunksRef.current, { type: mimeRef.current });
          const reader = new FileReader();
          reader.readAsDataURL(blob);
          reader.onloadend = async () => {
            try {
              const base64 = (reader.result as string).split(',')[1];
              if (base64) {
                const transcript = await transcribeAudio(base64, mimeRef.current);
                setText((prev) => (prev.trim() ? `${prev.trim()}\n\n` : '') + transcript.trim());
                onToast?.('Transcription added — review text, then Apply.', 'success');
              }
            } catch (err) {
              onToast?.(
                `Transcription failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
                'error'
              );
            } finally {
              setIsProcessing(false);
            }
          };
        } catch (err) {
          onToast?.(
            `Audio processing failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
            'error'
          );
          setIsProcessing(false);
        }
      };
      mediaRecorder.start();
      setIsRecording(true);
    } catch {
      onToast?.('Could not access microphone. Check browser permissions.', 'error');
    }
  };

  const handleApply = async () => {
    if (!patient) return;
    const v = text.trim();
    setApplying(true);
    try {
      if (field === 'wardTodos') {
        const labels = v
          .split(/[,;\n]+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map((label) => ({ label }));
        await onApply(patient.id, { taskIndicators: labels });
      } else {
        await onApply(patient.id, { [field]: v } as Partial<InpatientRecord>);
      }
      onToast?.('Sheet updated.', 'success');
      onClose();
    } catch {
      onToast?.('Could not save changes.', 'error');
    } finally {
      setApplying(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sheets-dictate-title"
      onMouseDown={(e) => e.target === e.currentTarget && !isRecording && !isProcessing && !applying && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full border border-slate-200 max-h-[min(90dvh,640px)] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-slate-200 shrink-0">
          <h2 id="sheets-dictate-title" className="text-lg font-bold text-slate-800 pr-2">
            Dictate
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isRecording || isProcessing || applying}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 shrink-0"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto flex-1 text-sm">
          {!patient ? (
            <p className="text-slate-600">No row selected.</p>
          ) : (
            <>
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Update field</span>
                <select
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200"
                  value={field}
                  onChange={(e) => setField(e.target.value as SheetsDictateField)}
                >
                  {(Object.keys(FIELD_LABELS) as SheetsDictateField[]).map((k) => (
                    <option key={k} value={k}>
                      {FIELD_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <span className="text-xs font-semibold text-slate-600">Transcript</span>
                <textarea
                  className="mt-1 w-full min-h-[140px] px-3 py-2 rounded-lg border border-slate-200 text-sm"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Record with the mic, or type here. Edit before applying."
                  disabled={isRecording || isProcessing}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={!patient || isProcessing || applying}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-white ${
                    isRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-teal-600 hover:bg-teal-700'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {isProcessing ? (
                    <>
                      <Wand2 className="size-4 animate-spin" /> Transcribing…
                    </>
                  ) : isRecording ? (
                    <>
                      <Square className="size-4 fill-current" /> Stop
                    </>
                  ) : (
                    <>
                      <Mic className="size-4" /> Record
                    </>
                  )}
                </button>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void handleApply()}
                  disabled={applying || isRecording || isProcessing}
                  className="flex-1 min-h-[44px] px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50"
                >
                  {applying ? 'Saving…' : 'Apply to sheet'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isRecording || applying}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
