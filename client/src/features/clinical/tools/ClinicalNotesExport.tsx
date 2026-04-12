import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { DriveFile, Patient, UserSettings } from '../../../../../shared/types';
import { FOLDER_MIME_TYPE } from '../../../../../shared/types';
import { fetchFilesFirstPage, fetchPatientSessions } from '../../../services/api';
import { downloadClinicalNotesPdf } from './ClinicalExportMock';

interface Props {
  patients: Patient[];
  userSettings?: UserSettings | null;
  onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

type SessionNotePick = { sessionId: string; noteId: string; title: string; content: string };

export const ClinicalNotesExport: React.FC<Props> = ({ patients, userSettings, onToast }) => {
  const [patientId, setPatientId] = useState('');
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [sessionNotes, setSessionNotes] = useState<SessionNotePick[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [selectedNoteKeys, setSelectedNoteKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const patientLabel = useMemo(() => {
    if (!patientId) return '';
    return patients.find((p) => p.id === patientId)?.name ?? patientId;
  }, [patientId, patients]);

  const loadDocs = useCallback(async (pid: string) => {
    if (!pid) {
      setFiles([]);
      setSessionNotes([]);
      setSelectedFileIds(new Set());
      setSelectedNoteKeys(new Set());
      return;
    }
    setLoading(true);
    try {
      const [{ files: page }, sessRes] = await Promise.all([
        fetchFilesFirstPage(pid, 200),
        fetchPatientSessions(pid).catch(() => ({ sessions: [] })),
      ]);
      const nonFolders = page.filter((f) => f.mimeType !== FOLDER_MIME_TYPE);
      setFiles(nonFolders);
      const notes: SessionNotePick[] = [];
      for (const s of sessRes.sessions || []) {
        for (const n of s.notes || []) {
          notes.push({
            sessionId: s.id,
            noteId: n.noteId,
            title: n.title || 'Note',
            content: n.content || '',
          });
        }
      }
      setSessionNotes(notes);
      setSelectedFileIds(new Set(nonFolders.map((f) => f.id)));
      setSelectedNoteKeys(new Set(notes.map((n) => `${n.sessionId}:${n.noteId}`)));
    } catch {
      setFiles([]);
      setSessionNotes([]);
      onToast?.('Could not load patient documentation.', 'error');
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void loadDocs(patientId);
  }, [patientId, loadDocs]);

  const toggleFile = (id: string) => {
    setSelectedFileIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const toggleNote = (key: string) => {
    setSelectedNoteKeys((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  const buildBody = (): string => {
    const parts: string[] = [];
    for (const n of sessionNotes) {
      const key = `${n.sessionId}:${n.noteId}`;
      if (selectedNoteKeys.has(key) && n.content.trim()) {
        parts.push(`## ${n.title}\n\n${n.content.trim()}\n`);
      }
    }
    for (const f of files) {
      if (selectedFileIds.has(f.id)) {
        parts.push(`## ${f.name}\n\n(File in patient folder — open workspace for the full document.)\n`);
      }
    }
    if (!parts.length) return 'No sources selected.';
    return parts.join('\n---\n\n');
  };

  const download = () => {
    if (!patientId) {
      onToast?.('Select a patient.', 'info');
      return;
    }
    void downloadClinicalNotesPdf(patientLabel || 'Patient', buildBody(), userSettings)
      .then(() => onToast?.('PDF downloaded.', 'success'))
      .catch(() => onToast?.('Could not generate PDF.', 'error'));
  };

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <h3 className="text-sm font-bold text-slate-800">Export notes (PDF)</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-4xl">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Patient</label>
          <select
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-800"
          >
            <option value="">Select…</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {loading ? <p className="text-xs text-slate-500 mt-1">Loading…</p> : null}
        </div>
        <div className="flex items-end">
          <button
            type="button"
            disabled={!patientId || loading}
            onClick={download}
            className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 rounded-lg bg-slate-800 text-white text-sm disabled:opacity-50"
          >
            Download PDF
          </button>
        </div>
      </div>

      {patientId && !loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-4xl text-sm">
          <div>
            <div className="text-xs font-semibold text-slate-600 mb-2">Consult notes</div>
            <div className="border border-slate-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-slate-100">
              {sessionNotes.length === 0 ? (
                <div className="p-3 text-slate-500 text-xs">No saved consultation notes.</div>
              ) : (
                sessionNotes.map((n) => {
                  const key = `${n.sessionId}:${n.noteId}`;
                  return (
                    <label
                      key={key}
                      className="flex items-start gap-2 p-2 hover:bg-slate-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedNoteKeys.has(key)}
                        onChange={() => toggleNote(key)}
                        className="mt-1"
                      />
                      <span className="text-slate-800">{n.title}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-600 mb-2">Files in folder</div>
            <div className="border border-slate-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-slate-100">
              {files.length === 0 ? (
                <div className="p-3 text-slate-500 text-xs">No files listed.</div>
              ) : (
                files.map((f) => (
                  <label key={f.id} className="flex items-start gap-2 p-2 hover:bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedFileIds.has(f.id)}
                      onChange={() => toggleFile(f.id)}
                      className="mt-1"
                    />
                    <span className="text-slate-800 break-all">{f.name}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};
