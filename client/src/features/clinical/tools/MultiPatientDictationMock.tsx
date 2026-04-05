import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { InpatientRecord } from '../../../types/clinical';
import {
  fetchCurrentInpatients,
  routeTranscriptSegments,
  routeTranscriptToPatients,
} from '../../../services/clinicalData';
import { Mic, Square } from 'lucide-react';

interface Props {
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

type SpeechRecInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: { resultIndex: number; results: SpeechRecResultList }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecResultList = {
  length: number;
  [i: number]: {
    isFinal: boolean;
    [j: number]: { transcript: string };
  };
};

function getSpeechRecognitionCtor(): (new () => SpeechRecInstance) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecInstance;
    webkitSpeechRecognition?: new () => SpeechRecInstance;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const MultiPatientDictationMock: React.FC<Props> = ({ onToast }) => {
  const [rows, setRows] = useState<InpatientRecord[]>([]);
  const [buckets, setBuckets] = useState<Record<string, string>>({});
  const [segment, setSegment] = useState('');
  const [listening, setListening] = useState(false);
  const [liveLine, setLiveLine] = useState('');
  const recRef = useRef<SpeechRecInstance | null>(null);

  const load = useCallback(async () => {
    setRows(await fetchCurrentInpatients());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stopRecognition = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    recRef.current = null;
    setListening(false);
  }, []);

  useEffect(() => () => stopRecognition(), [stopRecognition]);

  const routeAndAppend = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      const multi = routeTranscriptSegments(t, rows);
      if (multi.length) {
        setBuckets((prev) => {
          const next = { ...prev };
          for (const m of multi) {
            next[m.patientId] = (next[m.patientId] || '') + m.segment.trim() + '\n\n';
          }
          return next;
        });
        onToast?.(`Routed ${multi.length} segment(s)`, 'success');
        return;
      }
      const one = routeTranscriptToPatients(t, rows);
      if (one) {
        setBuckets((prev) => ({
          ...prev,
          [one.patientId]: (prev[one.patientId] || '') + t + '\n\n',
        }));
        onToast?.(`Routed to ${one.displayName}`, 'info');
      } else {
        onToast?.('No name match — include surname.', 'info');
      }
    },
    [rows, onToast]
  );

  const startRecognition = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      onToast?.('Speech recognition not available in this browser.', 'error');
      return;
    }
    stopRecognition();
    const rec = new Ctor();
    rec.lang = 'en-ZA';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev: { resultIndex: number; results: SpeechRecResultList }) => {
      let interim = '';
      let final = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      setLiveLine((final + interim).trim());
      if (final.trim()) routeAndAppend(final);
    };
    rec.onerror = () => {
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      setLiveLine('');
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
      onToast?.('Listening…', 'info');
    } catch {
      onToast?.('Could not start microphone.', 'error');
    }
  }, [onToast, routeAndAppend, stopRecognition]);

  const flushManual = () => {
    routeAndAppend(segment);
    setSegment('');
  };

  return (
    <div className="space-y-3 bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {!listening ? (
          <button
            type="button"
            onClick={startRecognition}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold"
          >
            <Mic size={16} />
            Round dictation
          </button>
        ) : (
          <button
            type="button"
            onClick={stopRecognition}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold"
          >
            <Square size={14} />
            Stop
          </button>
        )}
        <span className="text-xs text-slate-500">
          Speak patient names; each phrase is routed to that patient&apos;s note (like a consultation).
        </span>
      </div>
      {listening && liveLine ? (
        <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono">{liveLine}</p>
      ) : null}

      <div className="flex flex-wrap gap-2 items-end">
        <textarea
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-slate-200 text-sm min-h-[80px]"
          placeholder="Or type: e.g. Review Naidoo — drain output satisfactory."
          value={segment}
          onChange={(e) => setSegment(e.target.value)}
        />
        <button
          type="button"
          onClick={flushManual}
          className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold shrink-0"
        >
          Add
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rows.map((p) => (
          <div key={p.id} className="rounded-lg border border-slate-100 p-3 bg-slate-50/80">
            <div className="text-xs font-bold text-slate-800">
              {p.firstName} {p.surname}
            </div>
            <pre className="mt-2 text-xs text-slate-700 whitespace-pre-wrap font-sans max-h-40 overflow-y-auto">
              {buckets[p.id]?.trim() || '—'}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
};
