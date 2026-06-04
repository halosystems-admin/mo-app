import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Eye, FileDown, FileText, Loader2, X } from 'lucide-react';
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

function isHistoryOfPresentingComplaintLabel(label: string): boolean {
  const s = label.trim().toLowerCase();
  if (/\bhistory\s+of\s+presenting\s+complaint\b/.test(s)) return true;
  if (/\bhpc\b/.test(s)) return true;
  return s.includes('history') && s.includes('presenting') && s.includes('complaint');
}

function isPresentingComplaintLabel(label: string): boolean {
  if (isHistoryOfPresentingComplaintLabel(label)) return false;
  const s = label.trim().toLowerCase();
  return /\bpresenting\s+complaint\b/.test(s) || /\bchief\s+complaint\b/.test(s);
}

/** Merge HPC bodies into the first Presenting / Chief complaint field so DOCX pipelines see one block. */
function mergeHpcIntoPresentingComplaintFields(fields: NoteField[]): NoteField[] {
  const extras: string[] = [];
  const out: NoteField[] = [];
  let pcIndex = -1;
  for (const f of fields) {
    const lab = String(f.label || '');
    if (isHistoryOfPresentingComplaintLabel(lab)) {
      const b = String(f.body ?? '').trim();
      if (b) extras.push(b);
      continue;
    }
    if (isPresentingComplaintLabel(lab)) {
      if (pcIndex === -1) {
        pcIndex = out.length;
        out.push({ ...f });
      } else {
        out.push(f);
      }
      continue;
    }
    out.push(f);
  }
  if (pcIndex === -1 || extras.length === 0) return fields;
  const pc = out[pcIndex];
  const mergedBody = [String(pc.body ?? '').trim(), ...extras].filter(Boolean).join('\n\n');
  out[pcIndex] = { ...pc, body: mergedBody };
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
    sections.push(`## ${section}`);
    sections.push('');
    for (const it of items) {
      if (!it.label && it.body) {
        sections.push(it.body);
        sections.push('');
        continue;
      }
      sections.push(`**${it.label}**`);
      sections.push('');
      sections.push(it.body || '—');
      sections.push('');
    }
    sections.push('');
  }

  return sections.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function resizeTextareaElement(el: HTMLTextAreaElement | null, minHeight: number): void {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.max(el.scrollHeight, minHeight)}px`;
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
  savingNoteIndex: number | null;
  regeneratingPdfIndex: number | null;
  /** When false, hide internal note tabs (used when parent provides Transcript | Context | Note tabs) */
  showNoteTabs?: boolean;
  mobileSinglePanel?: boolean;
  hideFooter?: boolean;
  viewMode?: 'fields' | 'pdf';
  onViewModeChange?: (mode: 'fields' | 'pdf') => void;
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
  savingNoteIndex,
  regeneratingPdfIndex,
  showNoteTabs = true,
  mobileSinglePanel = false,
  hideFooter = false,
  viewMode: controlledViewMode,
  onViewModeChange,
}) => {
  const activeNote = notes[activeIndex];
  const [internalViewMode, setInternalViewMode] = useState<'fields' | 'pdf'>('fields');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [showMobilePdfPreview, setShowMobilePdfPreview] = useState(false);
  const blobUrlRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fieldTextareaRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const busy = status === AppStatus.FILING || status === AppStatus.SAVING;

  const [isMobileViewport, setIsMobileViewport] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 768px)');
    if (!mq) return;
    const apply = () => setIsMobileViewport(Boolean(mq.matches));
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, []);

  const fields = useMemo(() => {
    if (!activeNote) return [];
    return mergeHpcIntoPresentingComplaintFields(extractNoteFields(activeNote));
  }, [activeNote]);
  const embeddedMobileView = isMobileViewport && !showNoteTabs;
  const unifiedMobilePanel = embeddedMobileView && mobileSinglePanel;
  const mobileEmbeddedFieldsView = embeddedMobileView && !unifiedMobilePanel;
  const viewMode = controlledViewMode ?? internalViewMode;
  const setViewMode = (mode: 'fields' | 'pdf') => {
    if (controlledViewMode === undefined) {
      setInternalViewMode(mode);
    }
    onViewModeChange?.(mode);
  };

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

  /** Desktop can auto-grow, but mobile should keep a bounded editor that scrolls internally. */
  useLayoutEffect(() => {
    if (isMobileViewport || viewMode !== 'fields' || unifiedMobilePanel) return;
    resizeTextareaElement(textareaRef.current, 96);
    fieldTextareaRefs.current.forEach((el) => resizeTextareaElement(el, 56));
  }, [isMobileViewport, organizedText, viewMode, activeIndex, fields, unifiedMobilePanel]);

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

  const openPdfPreview = () => {
    if (isMobileViewport) {
      setShowMobilePdfPreview(true);
    } else {
      setViewMode('pdf');
    }
    if (!displayContent.trim()) return;
    if (activeNote?.dirty || !activeNote?.previewPdfBase64?.trim()) {
      onRegeneratePdf(activeIndex, displayContent);
    }
  };

  const handlePreviewAction = () => {
    if (isMobileViewport && showMobilePdfPreview) {
      setShowMobilePdfPreview(false);
      return;
    }
    if (!isMobileViewport && viewMode === 'pdf') {
      setViewMode('fields');
      return;
    }
    openPdfPreview();
  };
  const previewBusy = regeneratingPdfIndex === activeIndex;

  useEffect(() => {
    if (!isMobileViewport) {
      setShowMobilePdfPreview(false);
    }
  }, [isMobileViewport]);

  useEffect(() => {
    setShowMobilePdfPreview(false);
  }, [activeIndex]);

  const handleFieldBodyChange = (fieldIndex: number, body: string) => {
    const nextFields = fields.map((field, index) =>
      index === fieldIndex ? { ...field, body } : field
    );
    onNoteChange(activeIndex, {
      fields: nextFields,
      content: fieldsToOrganizedText(nextFields) || fieldsToContent(nextFields),
    });
  };

  return (
    <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${unifiedMobilePanel ? 'max-md:flex-1' : ''}`}>
      {/* Only show template picker + mini note tabs when used standalone */}
      {showNoteTabs && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 max-md:px-3 max-md:py-2">
          <div className="flex items-center gap-2 flex-wrap">
            {templateOptions.length > 0 && onTemplateChange && (
              <select
                value={templateId}
                onChange={(e) => onTemplateChange(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/35 max-md:min-h-[44px] max-md:px-3 max-md:py-2 max-md:text-sm"
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
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/35 max-md:min-h-[44px] max-md:px-3 max-md:py-2 max-md:text-sm ${
                  i === activeIndex ? 'bg-teal-500 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200/90'
                }`}
              >
                {note.title || `Note ${i + 1}`}
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        className={
          unifiedMobilePanel
            ? 'flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent px-0 pt-0'
            : `flex-1 min-h-0 bg-slate-50/70 p-3 [-webkit-overflow-scrolling:touch] ${embeddedMobileView ? 'overflow-hidden' : 'overflow-y-auto'} ${hideFooter ? 'pb-3' : 'pb-[calc(6.25rem+env(safe-area-inset-bottom,0px))]'} max-md:pt-1.5 ${embeddedMobileView ? `max-md:bg-transparent max-md:px-0.5 ${hideFooter ? 'max-md:pb-2' : 'max-md:pb-[calc(5.1rem+env(safe-area-inset-bottom,0px))]'}` : `max-md:px-2 ${hideFooter ? 'max-md:pb-2' : 'max-md:pb-[calc(5.1rem+env(safe-area-inset-bottom,0px))]'}`}`
        }
      >
        {viewMode === 'fields' ? (
          mobileEmbeddedFieldsView && fields.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white p-3 [-webkit-overflow-scrolling:touch] max-md:p-2.5">
              <textarea
                ref={textareaRef}
                value={organizedText}
                onChange={(e) => onNoteChange(activeIndex, { content: e.target.value })}
                onInput={(e) => {
                  if (!isMobileViewport && !unifiedMobilePanel) resizeTextareaElement(e.currentTarget, 96);
                }}
                placeholder=""
                className="min-h-[min(40vh,320px)] w-full flex-1 resize-y overflow-y-auto rounded-lg border border-slate-200/90 bg-slate-50/50 px-3 py-2.5 text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none focus:ring-0 [-webkit-overflow-scrolling:touch] max-md:min-h-[48dvh] max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-0.5 max-md:py-0 max-md:focus:border-0 max-md:focus:ring-0"
              />
            </div>
          ) : (
          <div className={`${unifiedMobilePanel ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'note-fields-shell flex min-h-0 flex-1 flex-col'}`}>
            <div className={`${unifiedMobilePanel ? 'flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent' : `note-fields-card flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white shadow-sm ${embeddedMobileView ? 'max-md:border-0 max-md:bg-transparent max-md:shadow-none' : ''}`}`}>
              <div className={`${unifiedMobilePanel ? 'flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-2.5 py-2' : `note-fields-scrollArea flex min-h-0 flex-1 flex-col gap-3 p-3 ${embeddedMobileView && fields.length === 0 ? 'overflow-hidden' : 'overflow-y-auto [-webkit-overflow-scrolling:touch]'} max-md:gap-2.5 ${embeddedMobileView ? 'max-md:p-0.5' : 'max-md:p-2.5'}`}`}>
                {fields.length > 0 ? (
                  fields.map((field, index) => (
                    <div key={`${field.label}-${index}`} className={`${unifiedMobilePanel ? 'px-0 py-0' : `rounded-xl border border-slate-200 bg-slate-50/65 p-3 ${embeddedMobileView ? 'max-md:bg-white' : ''}`}`}>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">
                        {field.label}
                      </label>
                      <textarea
                        ref={(el) => {
                          fieldTextareaRefs.current[index] = el;
                        }}
                        value={field.body ?? ''}
                        onChange={(e) => handleFieldBodyChange(index, e.target.value)}
                        onInput={(e) => {
                          if (!isMobileViewport && !unifiedMobilePanel) resizeTextareaElement(e.currentTarget, 56);
                        }}
                        className={`note-fields-editor-input min-h-[56px] w-full resize-none overflow-hidden rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm leading-relaxed text-slate-700 focus:border-teal-400 focus:outline-none focus:ring-0 focus-visible:border-teal-400 focus-visible:ring-0 [-webkit-overflow-scrolling:touch] ${unifiedMobilePanel ? 'max-md:min-h-[6rem] max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-0 max-md:py-0 max-md:focus:border-0' : 'max-md:min-h-[6rem] max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-0.5 max-md:py-0.5 max-md:focus:border-0'}`}
                      />
                    </div>
                  ))
                ) : (
                  <textarea
                    ref={textareaRef}
                    value={organizedText}
                    onChange={(e) => onNoteChange(activeIndex, { content: e.target.value })}
                    onInput={(e) => {
                      if (!isMobileViewport && !unifiedMobilePanel) resizeTextareaElement(e.currentTarget, 96);
                    }}
                    placeholder=""
                    className={`note-fields-editor-input min-h-[320px] w-full resize-none overflow-hidden rounded-xl border border-slate-200 bg-white p-4 font-sans text-sm leading-relaxed text-slate-700 focus:border-teal-400 focus:outline-none focus:ring-0 focus-visible:border-teal-400 focus-visible:ring-0 [-webkit-overflow-scrolling:touch] max-md:min-h-[17.5rem] max-md:focus:ring-0 ${unifiedMobilePanel ? 'max-md:h-full max-md:min-h-0 max-md:flex-1 max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-0 max-md:py-0 max-md:focus:border-0' : 'max-md:h-full max-md:flex-1 max-md:min-h-0 max-md:overflow-y-auto max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-0.5 max-md:py-0.5 max-md:focus:border-0'}`}
                  />
                )}
              </div>
            </div>
          </div>
          )
        ) : pdfUrl ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <iframe
              src={pdfUrl}
              title="PDF Preview"
              className="h-full min-h-0 w-full flex-1 rounded-xl border border-slate-200 bg-white max-md:rounded-lg"
            />
          </div>
        ) : (
          <div className="min-h-[320px] flex-1 rounded-xl border border-dashed border-slate-200 bg-white/80 max-md:min-h-0" aria-hidden />
        )}
      </div>

      {!hideFooter ? (
      <div className={`sticky bottom-0 z-10 border-t border-slate-200 bg-white/95 px-4 py-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm max-md:px-2.5 max-md:py-1 max-md:pb-[calc(0.35rem+env(safe-area-inset-bottom,0px))] ${embeddedMobileView ? 'max-md:mt-1' : ''} ${unifiedMobilePanel ? 'max-md:static max-md:border-t-0 max-md:bg-transparent max-md:px-1.5 max-md:pt-2 max-md:pb-1 max-md:backdrop-blur-none' : ''}`}>
        <div className="flex flex-wrap items-center justify-between gap-3 max-md:flex-col max-md:items-stretch max-md:gap-1.5">
        <div className="flex items-center gap-2 flex-wrap max-md:grid max-md:grid-cols-2 max-md:gap-1.5">
          <button
            type="button"
            onClick={handlePreviewAction}
            disabled={busy || !displayContent.trim() || previewBusy}
            className="halo-touch-min flex items-center justify-center gap-1.5 rounded-full bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-all hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/35 disabled:opacity-50 max-md:min-h-[34px] max-md:px-2.5 max-md:py-1.5 max-md:text-[11px]"
          >
            {previewBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : viewMode === 'pdf' ? <FileText className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {viewMode === 'pdf' ? 'Fields' : 'Preview'}
          </button>
          <button
            type="button"
            onClick={() => onSaveAsDocx(activeIndex)}
            disabled={busy || !displayContent.trim()}
            className="halo-touch-min flex items-center justify-center gap-1.5 rounded-full bg-teal-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/35 disabled:opacity-50 max-md:min-h-[34px] max-md:px-2.5 max-md:py-1.5 max-md:text-[11px]"
          >
            {savingNoteIndex === activeIndex ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            Save as DOCX
          </button>
        </div>
        {activeNote.lastSavedAt && (
          <span className="text-sm text-slate-400 max-md:text-center max-md:text-[11px]">
            Last saved: {new Date(activeNote.lastSavedAt).toLocaleString()}
          </span>
        )}
        </div>
      </div>
      ) : null}

      {isMobileViewport && showMobilePdfPreview ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 p-2 backdrop-blur-[1px]">
          <div className="flex w-full max-w-[24rem] max-h-[calc(100dvh-1rem)] flex-col overflow-hidden rounded-[1.2rem] border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">Preview</p>
                <p className="truncate text-[11px] text-slate-500">{activeNote.title || 'Document preview'}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowMobilePdfPreview(false)}
                className="halo-touch-min flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/35"
                aria-label="Close preview"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-start justify-center overflow-auto bg-slate-100 px-2 py-2">
              {pdfUrl ? (
                <div className="w-full max-w-full flex-none overflow-hidden rounded-[0.95rem] border border-slate-200 bg-white shadow-sm aspect-[210/297]">
                  <iframe
                    src={`${pdfUrl}#toolbar=0&zoom=page-width`}
                    title="PDF Preview"
                    className="h-full w-full bg-white"
                  />
                </div>
              ) : (
                <div className="flex aspect-[210/297] w-full max-w-full flex-none items-center justify-center rounded-[0.95rem] border border-dashed border-slate-300 bg-white">
                  {previewBusy ? (
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating preview...
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">Preview not available yet.</p>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 px-3 py-1.5 pb-[calc(0.35rem+env(safe-area-inset-bottom,0px))]">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setShowMobilePdfPreview(false)}
                  className="halo-touch-min flex items-center justify-center gap-1.5 rounded-full bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/35"
                >
                  <FileText className="h-4 w-4" />
                  Fields
                </button>
                <button
                  type="button"
                  onClick={() => onSaveAsDocx(activeIndex)}
                  disabled={busy || !displayContent.trim()}
                  className="halo-touch-min flex items-center justify-center gap-1.5 rounded-full bg-teal-600 px-3 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/35 disabled:opacity-50"
                >
                  {savingNoteIndex === activeIndex ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                  Save as DOCX
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
