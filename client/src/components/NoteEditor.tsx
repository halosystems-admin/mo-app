import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Save, FileDown, Mail, Loader2, RefreshCw } from 'lucide-react';
import type { HaloNote, NoteField } from '../../../shared/types';
import { AppStatus } from '../../../shared/types';

/** Turn structured fields into a single open-text note. */
function fieldsToContent(fields: NoteField[]): string {
  return fields
    .map((f) => (f.label ? `${f.label}:\n${f.body ?? ''}` : f.body))
    .filter(Boolean)
    .join('\n\n');
}

// Keys that are NoteEditor bookkeeping — never surface as clinical fields.
const SKIP_KEYS = new Set([
  'noteId', 'id', 'title', 'name', 'template_id', 'templateId',
  'lastSavedAt', 'dirty', 'raw', 'previewPdfBase64', 'content',
  'text', 'note_content', 'message', 'output', 'generated_note',
]);

/**
 * Recursively walk an object and return NoteField[] of all leaf values
 * that are not internal bookkeeping keys.
 */
function flattenToFields(input: unknown, prefix = ''): NoteField[] {
  if (input == null) return [];
  if (typeof input === 'string') {
    try { return flattenToFields(JSON.parse(input), prefix); } catch { return []; }
  }
  if (typeof input !== 'object' || Array.isArray(input)) return [];

  const obj = input as Record<string, unknown>;
  const out: NoteField[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (SKIP_KEYS.has(key) || key.startsWith('_')) continue;
    const label = prefix ? `${prefix} › ${key}` : key;

    if (value == null) {
      out.push({ label, body: '' });
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out.push({ label, body: String(value) });
    } else if (Array.isArray(value)) {
      // Array of section/field objects — unpack them
      const sectionFields: NoteField[] = [];
      for (const item of value) {
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          const sectionLabel = String(o.label ?? o.name ?? o.title ?? '').trim();
          const sectionBody = String(o.body ?? o.value ?? o.content ?? o.text ?? '').trim();
          if (sectionLabel) {
            sectionFields.push({ label: sectionLabel, body: sectionBody });
            continue;
          }
        }
        // Non-standard array — stringify it
        out.push({ label, body: JSON.stringify(value, null, 2) });
        break;
      }
      if (sectionFields.length > 0) out.push(...sectionFields);
    } else if (typeof value === 'object') {
      out.push(...flattenToFields(value, label));
    }
  }
  return out;
}

/**
 * Extract editable NoteField[] from wherever the data lives on a HaloNote.
 * Priority: explicit fields array → parsed from raw → parsed from content JSON.
 */
function extractNoteFields(note: HaloNote): NoteField[] {
  // 1. Explicit fields array already on the note (set by server normalizer)
  if (note.fields && note.fields.length > 0) return note.fields;

  // 2. Original HALO API payload stored in `raw`
  if (note.raw !== undefined) {
    const fromRaw = flattenToFields(note.raw);
    if (fromRaw.length > 0) return fromRaw;
  }

  // 3. Try parsing content as JSON
  const text = note.content?.trim();
  if (text) {
    try {
      const fromContent = flattenToFields(JSON.parse(text));
      if (fromContent.length > 0) return fromContent;
    } catch { /* not JSON */ }
  }

  return [];
}

function labelParts(label: string): string[] {
  return label
    .split('›')
    .map((p) => p.trim())
    .filter(Boolean);
}

function fieldsToOrganizedText(fields: NoteField[]): string {
  if (!fields.length) return '';

  // Group by top-level section (derived from template structure, not hard-coded).
  const groups = new Map<string, Array<{ label: string; body: string }>>();
  for (const f of fields) {
    const rawLabel = String(f.label || '').trim();
    const body = String(f.body ?? '').trim();
    if (!rawLabel && !body) continue;
    const parts = labelParts(rawLabel);
    const top = parts[0] || 'Note';
    const leaf = parts.length > 1 ? parts.slice(1).join(' › ') : rawLabel || 'Text';
    const arr = groups.get(top) ?? [];
    arr.push({ label: leaf, body });
    groups.set(top, arr);
  }

  const sections: string[] = [];
  for (const [section, items] of groups.entries()) {
    // Section header (template-derived)
    sections.push(section.toUpperCase());
    for (const it of items) {
      if (!it.label && it.body) {
        sections.push(it.body);
        continue;
      }
      sections.push(`${it.label}:`);
      sections.push(it.body || '—');
      sections.push(''); // spacer
    }
    sections.push(''); // spacer between sections
  }

  return sections.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

interface NoteEditorProps {
  notes: HaloNote[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onNoteChange: (noteIndex: number, updates: { title?: string; content?: string; fields?: NoteField[] }) => void;
  onRegeneratePdf: (noteIndex: number, text: string) => void;
  status: AppStatus;
  templateId: string;
  templateOptions: Array<{ id: string; name: string }>;
  onTemplateChange?: (templateId: string) => void;
  onSaveAsDocx: (noteIndex: number) => void;
  onSaveAll: () => void;
  onEmail: (noteIndex: number) => void;
  savingNoteIndex: number | null;
  regeneratingPdfIndex: number | null;
  /** When false, hide internal note tabs (used when parent provides Transcript | Context | Note tabs) */
  showNoteTabs?: boolean;
}

export const NoteEditor: React.FC<NoteEditorProps> = ({
  notes,
  activeIndex,
  onActiveIndexChange,
  onNoteChange,
  onRegeneratePdf,
  status,
  templateId,
  templateOptions,
  onTemplateChange,
  onSaveAsDocx,
  onSaveAll,
  onEmail,
  savingNoteIndex,
  regeneratingPdfIndex,
  showNoteTabs = true,
}) => {
  const activeNote = notes[activeIndex];
  const [viewMode, setViewMode] = useState<'fields' | 'pdf'>('fields');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const busy = status === AppStatus.FILING || status === AppStatus.SAVING;

  const fields = useMemo(() => (activeNote ? extractNoteFields(activeNote) : []), [activeNote]);

  const displayContent = useMemo(() => {
    if (activeNote?.content?.trim()) return activeNote.content;
    if (fields.length > 0) return fieldsToContent(fields);
    return '';
  }, [activeNote?.content, fields]);

  const organizedText = useMemo(() => {
    if (!fields.length) return displayContent;
    // If the user has already edited/typed a note, keep their content.
    if (activeNote?.content?.trim()) return activeNote.content;
    return fieldsToOrganizedText(fields) || displayContent;
  }, [fields, displayContent, activeNote?.content]);

  // Rebuild blob URL whenever the PDF base64 changes
  useEffect(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    const base64 = activeNote?.previewPdfBase64?.trim();
    if (!base64) { setPdfUrl(null); return; }
    try {
      const bytes = atob(base64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const blob = new Blob([arr], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setPdfUrl(url);
    } catch {
      setPdfUrl(null);
    }
    return () => {
      if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    };
  }, [activeNote?.previewPdfBase64]);

  if (notes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400">
        <p className="text-sm">No notes yet.</p>
      </div>
    );
  }

  const handleRegenerate = () => {
    onRegeneratePdf(activeIndex, displayContent);
    setViewMode('pdf');
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Only show template picker + mini note tabs when used standalone */}
      {showNoteTabs && (
        <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {templateOptions.length > 0 && onTemplateChange && (
              <select
                value={templateId}
                onChange={(e) => onTemplateChange(e.target.value)}
                className="text-xs font-medium border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-700 shadow-sm"
              >
                {templateOptions.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex gap-1 flex-wrap">
            {notes.map((note, i) => (
              <button
                key={note.noteId}
                type="button"
                onClick={() => onActiveIndexChange(i)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                  i === activeIndex ? 'bg-teal-500 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200/90'
                }`}
              >
                {note.title || `Note ${i + 1}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 2-tab toggle: Note Fields | PDF Preview */}
      <div className="px-4 py-2 bg-white border-b border-slate-100 flex items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100/70 p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('fields')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition ${
              viewMode === 'fields' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Note Fields
          </button>
          <button
            type="button"
            onClick={() => setViewMode('pdf')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition ${
              viewMode === 'pdf' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            PDF Preview
          </button>
        </div>
      </div>

      {/* Content area */}
      {viewMode === 'fields' ? (
        <div className="note-fields-shell flex-1 bg-slate-50/70 p-3">
          <div className="note-fields-card rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col min-h-0">
            <div className="px-4 py-3 border-b border-slate-100 shrink-0">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Note fields</div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {fields.length > 0 ? 'Formatted from the selected template fields.' : 'Type or paste your note here.'}
              </div>
            </div>

            <div className="note-fields-scrollArea min-h-0 flex-1 overflow-y-auto p-3">
              <textarea
                value={organizedText}
                onChange={(e) => onNoteChange(activeIndex, { content: e.target.value })}
                placeholder="Note content will appear here after generation..."
                className="w-full h-full min-h-[320px] p-4 focus:outline-none resize-none text-sm leading-relaxed text-slate-700 border border-slate-200 rounded-xl bg-white"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto bg-slate-50/70 p-3">
          {pdfUrl ? (
            <iframe
              src={pdfUrl}
              title="PDF Preview"
              className="w-full h-full min-h-[420px] rounded-xl border border-slate-200 bg-white"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full min-h-[320px] text-slate-400 gap-2">
              <p className="text-sm">No PDF preview yet.</p>
              <p className="text-xs">Click <span className="font-semibold text-teal-600">Regenerate PDF</span> to generate one.</p>
            </div>
          )}
        </div>
      )}

      {/* Footer actions */}
      <div className="bg-slate-50 border-t border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => onSaveAsDocx(activeIndex)}
            disabled={busy || !displayContent.trim()}
            className="flex items-center gap-1.5 bg-teal-600 text-white px-3 py-2 rounded-lg hover:bg-teal-700 disabled:opacity-50 font-medium transition-all shadow-sm text-sm"
          >
            {savingNoteIndex === activeIndex ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            Save as DOCX
          </button>
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={busy || !displayContent.trim() || regeneratingPdfIndex === activeIndex}
            className="flex items-center gap-1.5 bg-slate-700 text-white px-3 py-2 rounded-lg hover:bg-slate-800 disabled:opacity-50 font-medium transition-all shadow-sm text-sm"
          >
            {regeneratingPdfIndex === activeIndex ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Regenerate PDF
          </button>
          <button
            type="button"
            onClick={() => onEmail(activeIndex)}
            disabled={busy || !displayContent.trim()}
            className="flex items-center gap-1.5 bg-slate-600 text-white px-3 py-2 rounded-lg hover:bg-slate-700 disabled:opacity-50 font-medium transition-all shadow-sm text-sm"
          >
            <Mail className="w-4 h-4" /> Email
          </button>
          {notes.length > 1 && (
            <button
              type="button"
              onClick={onSaveAll}
              disabled={busy}
              className="flex items-center gap-1.5 bg-teal-700 text-white px-3 py-2 rounded-lg hover:bg-teal-800 disabled:opacity-50 font-medium transition-all shadow-sm text-sm"
            >
              {status === AppStatus.SAVING ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save All
            </button>
          )}
        </div>
        {activeNote.lastSavedAt && (
          <span className="text-xs text-slate-400">
            Last saved: {new Date(activeNote.lastSavedAt).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
};
