import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Eye, FileDown, FileText, Loader2, X } from 'lucide-react';
import type { HaloNote, NoteField } from '../../../shared/types';
import { AppStatus } from '../../../shared/types';
import {
  fieldValuesToOrganizedMarkdown,
  fieldsToOrganizedText,
  markdownHasDuplicateSectionLabels,
} from '../../../shared/clinicalNoteOrganizedText';

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
  onViewModeChange,
}) => {
  const activeNote = notes[activeIndex];
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [showPdfPreviewOverlay, setShowPdfPreviewOverlay] = useState(false);
  const blobUrlRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fieldTextareaRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const busy = status === AppStatus.FILING || status === AppStatus.SAVING;

  /** Patient workspace embed (Mo + Henk) — same editor shell, scrollable note fields. */
  const embeddedInWorkspace = !showNoteTabs;

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
  const usePerFieldEditor = showNoteTabs && fields.length > 0;
  const embeddedMobileView = isMobileViewport && embeddedInWorkspace;
  const unifiedMobilePanel = embeddedMobileView && mobileSinglePanel;

  const displayContent = useMemo(() => {
    if (activeNote?.content?.trim()) return activeNote.content;
    if (fields.length > 0) return fieldsToContent(fields);
    return '';
  }, [activeNote?.content, fields]);

  const organizedText = useMemo(() => {
    const saved = activeNote?.content?.trim() ?? '';

    const rawFields =
      activeNote?.raw &&
      typeof activeNote.raw === 'object' &&
      !Array.isArray(activeNote.raw) &&
      'fields' in activeNote.raw &&
      typeof (activeNote.raw as { fields?: unknown }).fields === 'object' &&
      (activeNote.raw as { fields?: unknown }).fields !== null &&
      !Array.isArray((activeNote.raw as { fields?: unknown }).fields)
        ? ((activeNote.raw as { fields: Record<string, string> }).fields)
        : undefined;

    if (rawFields && Object.keys(rawFields).length > 0) {
      const fromTemplate = fieldValuesToOrganizedMarkdown(templateId, rawFields);
      if (fromTemplate && (!saved || markdownHasDuplicateSectionLabels(saved))) {
        return fromTemplate;
      }
    }

    if (saved && /^#{1,3}\s/m.test(saved)) return saved;

    if (fields.length > 0) {
      return fieldsToOrganizedText(fields) || saved || displayContent;
    }
    return saved || displayContent;
  }, [fields, displayContent, activeNote?.content, activeNote?.raw, templateId]);

  /** Auto-grow for standalone editor; workspace embed uses flex-height textarea with internal scroll. */
  useLayoutEffect(() => {
    if (embeddedInWorkspace || unifiedMobilePanel) return;
    resizeTextareaElement(textareaRef.current, 96);
    fieldTextareaRefs.current.forEach((el) => resizeTextareaElement(el, 56));
  }, [embeddedInWorkspace, organizedText, activeIndex, fields, unifiedMobilePanel]);

  const embeddedNoteFields = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <textarea
        ref={textareaRef}
        value={organizedText}
        onChange={(e) => onNoteChange(activeIndex, { content: e.target.value })}
        placeholder=""
        className="min-h-[min(40vh,320px)] w-full flex-1 resize-none overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 font-sans text-sm leading-relaxed text-slate-700 focus:border-teal-400 focus:outline-none focus:ring-0 focus-visible:border-teal-400 focus-visible:ring-0 [-webkit-overflow-scrolling:touch] touch-pan-y max-md:min-h-[48dvh] max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-0.5 max-md:py-0.5 max-md:focus:border-0 max-md:focus:ring-0"
      />
    </div>
  );

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
    setShowPdfPreviewOverlay(true);
    if (!displayContent.trim()) return;
    if (activeNote?.dirty || !activeNote?.previewPdfBase64?.trim()) {
      onRegeneratePdf(activeIndex, displayContent);
    }
  };

  const closePdfPreview = () => {
    setShowPdfPreviewOverlay(false);
    onViewModeChange?.('fields');
  };

  const handlePreviewAction = () => {
    if (showPdfPreviewOverlay) {
      closePdfPreview();
      return;
    }
    openPdfPreview();
  };
  const previewBusy = regeneratingPdfIndex === activeIndex;
  const pdfPreviewUrl = pdfUrl
    ? `${pdfUrl}#toolbar=0&navpanes=0&scrollbar=1&view=FitH&zoom=page-width`
    : null;

  useEffect(() => {
    setShowPdfPreviewOverlay(false);
  }, [activeIndex]);

  useEffect(() => {
    if (!showPdfPreviewOverlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowPdfPreviewOverlay(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPdfPreviewOverlay]);

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
            : embeddedInWorkspace
              ? 'flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent p-2 max-md:p-1'
              : `flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50/70 p-3 [-webkit-overflow-scrolling:touch] ${hideFooter ? 'pb-3' : 'pb-[calc(6.25rem+env(safe-area-inset-bottom,0px))]'} max-md:pt-1.5 max-md:px-2 ${hideFooter ? 'max-md:pb-2' : 'max-md:pb-[calc(5.1rem+env(safe-area-inset-bottom,0px))]'}`
        }
      >
        {usePerFieldEditor ? (
          <div className={`${unifiedMobilePanel ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'note-fields-shell flex min-h-0 flex-1 flex-col'}`}>
            <div className={`${unifiedMobilePanel ? 'flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent' : `note-fields-card flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white shadow-sm ${embeddedMobileView ? 'max-md:border-0 max-md:bg-transparent max-md:shadow-none' : ''}`}`}>
              <div className="note-fields-scrollArea flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 [-webkit-overflow-scrolling:touch] max-md:gap-2.5 max-md:p-2.5">
                {fields.map((field, index) => (
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
                        if (!isMobileViewport && !unifiedMobilePanel && !embeddedInWorkspace) {
                          resizeTextareaElement(e.currentTarget, 56);
                        }
                      }}
                      className={`note-fields-editor-input min-h-[56px] w-full resize-none overflow-hidden rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm leading-relaxed text-slate-700 focus:border-teal-400 focus:outline-none focus:ring-0 focus-visible:border-teal-400 focus-visible:ring-0 [-webkit-overflow-scrolling:touch] ${unifiedMobilePanel ? 'max-md:min-h-[6rem] max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-0 max-md:py-0 max-md:focus:border-0' : 'max-md:min-h-[6rem] max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-0.5 max-md:py-0.5 max-md:focus:border-0'}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : embeddedInWorkspace ? (
          embeddedNoteFields
        ) : (
          <div className="note-fields-shell flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              className={`note-fields-card flex min-h-0 flex-1 flex-col overflow-hidden ${
                unifiedMobilePanel
                  ? 'bg-transparent'
                  : `rounded-xl border border-slate-200 bg-white shadow-sm ${embeddedMobileView ? 'max-md:border-0 max-md:bg-transparent max-md:shadow-none' : ''}`
              }`}
            >
              <div className="note-fields-scrollArea flex min-h-0 flex-1 flex-col overflow-y-auto p-3 max-md:p-2.5">
                <textarea
                  ref={textareaRef}
                  value={organizedText}
                  onChange={(e) => onNoteChange(activeIndex, { content: e.target.value })}
                  onInput={(e) => {
                    if (!isMobileViewport && !unifiedMobilePanel) {
                      resizeTextareaElement(e.currentTarget, 96);
                    }
                  }}
                  placeholder=""
                  className={`note-fields-editor-input block w-full resize-none overflow-hidden rounded-xl border border-slate-200 bg-white p-4 font-sans text-sm leading-relaxed text-slate-700 focus:border-teal-400 focus:outline-none focus:ring-0 focus-visible:border-teal-400 focus-visible:ring-0 min-h-[320px] max-md:min-h-[17.5rem] ${unifiedMobilePanel ? 'max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-0 max-md:py-0' : 'max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-0.5 max-md:py-0.5'}`}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {!hideFooter ? (
      <div className={`${embeddedInWorkspace ? 'shrink-0' : 'sticky bottom-0'} z-10 border-t border-slate-200 bg-white/95 px-4 py-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm max-md:px-2.5 max-md:py-1 max-md:pb-[calc(0.35rem+env(safe-area-inset-bottom,0px))] ${embeddedMobileView ? 'max-md:mt-1' : ''} ${unifiedMobilePanel ? 'max-md:static max-md:border-t-0 max-md:bg-transparent max-md:px-1.5 max-md:pt-2 max-md:pb-1 max-md:backdrop-blur-none' : ''}`}>
        <div className="flex flex-wrap items-center justify-between gap-3 max-md:flex-col max-md:items-stretch max-md:gap-1.5">
        <div className="flex items-center gap-2 flex-wrap max-md:grid max-md:grid-cols-2 max-md:gap-1.5">
          <button
            type="button"
            onClick={handlePreviewAction}
            disabled={busy || !displayContent.trim() || previewBusy}
            className="halo-touch-min flex items-center justify-center gap-1.5 rounded-full bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-all hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/35 disabled:opacity-50 max-md:min-h-[34px] max-md:px-2.5 max-md:py-1.5 max-md:text-[11px]"
          >
            {previewBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
            {showPdfPreviewOverlay ? 'Close preview' : 'Preview'}
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

      {showPdfPreviewOverlay ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/70 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="note-pdf-preview-title"
          onClick={closePdfPreview}
        >
          <div
            className="flex h-[min(92vh,calc(100dvh-1.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom)))] w-[95vw] max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl max-md:h-[calc(100dvh-1rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] max-md:w-full max-md:rounded-[20px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3 max-md:px-3 max-md:py-2.5">
              <div className="flex min-w-0 items-center gap-3">
                <FileText size={18} className="shrink-0 text-teal-600" aria-hidden />
                <div className="min-w-0">
                  <h3 id="note-pdf-preview-title" className="truncate text-sm font-semibold text-slate-800">
                    {activeNote.title || 'Document preview'}
                  </h3>
                  <p className="truncate text-xs text-slate-500">Template preview — scroll to read all pages</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closePdfPreview}
                className="halo-touch-min shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close preview"
              >
                <X size={20} />
              </button>
            </div>

            <div className="pdf-preview-scroll min-h-0 flex-1 overflow-auto bg-slate-100 [-webkit-overflow-scrolling:touch] touch-pan-y">
              {pdfPreviewUrl ? (
                <iframe
                  src={pdfPreviewUrl}
                  title="PDF Preview"
                  className="pdf-preview-frame block h-full min-h-[72vh] w-full border-0 bg-white max-md:min-h-[calc(100dvh-10.75rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]"
                  scrolling="yes"
                />
              ) : (
                <div className="flex h-full min-h-[320px] items-center justify-center">
                  {previewBusy ? (
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <Loader2 className="h-5 w-5 animate-spin text-teal-600" aria-hidden />
                      Generating preview…
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">Preview not available yet.</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] max-md:px-3 max-md:py-2">
              {pdfUrl ? (
                <a
                  href={pdfPreviewUrl ?? pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="halo-touch-min rounded-full bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 shadow-sm hover:bg-slate-50 max-md:px-3 max-md:text-xs"
                >
                  Open PDF
                </a>
              ) : null}
              <button
                type="button"
                onClick={closePdfPreview}
                className="halo-touch-min rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-200 max-md:px-3 max-md:text-xs"
              >
                Back to note fields
              </button>
              <button
                type="button"
                onClick={() => onSaveAsDocx(activeIndex)}
                disabled={busy || !displayContent.trim()}
                className="halo-touch-min rounded-full bg-teal-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-700 disabled:opacity-50 max-md:px-3 max-md:text-xs"
              >
                Save as DOCX
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
