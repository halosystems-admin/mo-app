import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import DOMPurify from 'dompurify';
import { X, ExternalLink, Loader2, FileText, AlertCircle } from 'lucide-react';
import { refineMimeType } from '../../../shared/mimeFromFilename';

interface FileViewerProps {
  fileId: string;
  fileName: string;
  mimeType: string;
  fileUrl: string;
  onClose: () => void;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

/** Renders markdown like a document (headings, lists, emphasis) — not monospace “source” view. */
const markdownDocumentComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-2xl font-semibold text-slate-900 tracking-tight mt-8 mb-3 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-xl font-semibold text-slate-900 mt-7 mb-2.5 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-lg font-semibold text-slate-800 mt-6 mb-2 first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => <h4 className="text-base font-semibold text-slate-800 mt-5 mb-2 first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="text-slate-700 leading-relaxed mb-4 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="list-disc list-outside ml-5 mb-4 space-y-1.5 text-slate-700 leading-relaxed">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-outside ml-5 mb-4 space-y-1.5 text-slate-700 leading-relaxed">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-slate-300 pl-4 my-4 text-slate-600 italic leading-relaxed">{children}</blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-teal-600 underline underline-offset-2 hover:text-teal-800"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
  em: ({ children }) => <em className="italic text-slate-800">{children}</em>,
  hr: () => <hr className="my-8 border-slate-200" />,
  table: ({ children }) => (
    <div className="my-5 overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-slate-100">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-slate-200">{children}</tbody>,
  tr: ({ children }) => <tr className="border-slate-200">{children}</tr>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-semibold text-slate-800 border-b border-slate-200">{children}</th>
  ),
  td: ({ children }) => <td className="px-3 py-2 text-slate-700 align-top">{children}</td>,
  pre: ({ children }) => (
    <pre className="my-4 p-4 bg-slate-100 border border-slate-200 rounded-lg text-[13px] text-slate-800 overflow-x-auto leading-relaxed font-mono">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const isBlock = Boolean(className?.startsWith('language-'));
    if (isBlock) {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="bg-slate-100 text-slate-900 px-1.5 py-0.5 rounded text-[0.9em] font-mono border border-slate-200/80">
        {children}
      </code>
    );
  },
};

/**
 * Determine if a file type can be previewed in-app.
 * Returns the type of viewer to use.
 */
function getViewerType(mimeType: string, fileName: string): 'pdf' | 'image' | 'text' | 'markdown' | 'docx' | 'google-embed' | 'unsupported' {
  const lower = fileName.toLowerCase();

  // Images (extension fallback when Drive sends application/octet-stream)
  if (mimeType.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(lower)) return 'image';

  // PDFs
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';

  // Markdown — rendered document preview (GFM tables, lists, etc.)
  if (
    mimeType === 'text/markdown' ||
    mimeType === 'text/x-markdown' ||
    mimeType === 'application/markdown' ||
    lower.endsWith('.md') ||
    lower.endsWith('.markdown')
  ) {
    return 'markdown';
  }

  // Word .docx — HTML preview via server (mammoth); legacy .doc not supported
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.docx')
  ) {
    return 'docx';
  }

  // Text-based files
  if (
    mimeType === 'text/plain' ||
    mimeType === 'text/csv' ||
    mimeType === 'text/html' ||
    mimeType === 'application/json' ||
    lower.endsWith('.txt') ||
    lower.endsWith('.csv') ||
    lower.endsWith('.json')
  ) return 'text';

  // Google Workspace files (Docs, Sheets, Slides) — export as PDF for viewer
  if (
    mimeType === 'application/vnd.google-apps.document' ||
    mimeType === 'application/vnd.google-apps.spreadsheet' ||
    mimeType === 'application/vnd.google-apps.presentation'
  ) return 'pdf';

  return 'unsupported';
}

export const FileViewer: React.FC<FileViewerProps> = ({ fileId, fileName, mimeType, fileUrl, onClose }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const blobUrlRef = useRef<string | null>(null);

  const effectiveMime = useMemo(() => refineMimeType(mimeType, fileName), [mimeType, fileName]);
  const viewerType = getViewerType(effectiveMime, fileName);

  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 768px)');
    if (!mq) return;
    const apply = () => setIsMobileViewport(Boolean(mq.matches));
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, []);

  useEffect(() => {
    if (viewerType === 'unsupported') {
      setLoading(false);
      return;
    }

    // Revoke any previous blob URL before loading a new file
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    let cancelled = false;

    const loadFile = async () => {
      setLoading(true);
      setError(null);
      setBlobUrl(null);
      setTextContent(null);
      setDocxHtml(null);

      try {
        if (viewerType === 'docx') {
          const loadHtmlPreview = async (): Promise<boolean> => {
            const htmlPreviewUrl = `${API_BASE}/api/drive/files/${fileId}/preview-docx-html`;
            const htmlRes = await fetch(htmlPreviewUrl, { credentials: 'include' });

            if (cancelled) return true;
            if (!htmlRes.ok) return false;

            const data = (await htmlRes.json()) as { html?: string };
            const raw = typeof data.html === 'string' ? data.html : '';
            if (!cancelled) {
              if (!raw.trim()) {
                setDocxHtml(
                  DOMPurify.sanitize(
                    '<p>No readable text found in this document. Try opening it in a new tab.</p>',
                    { USE_PROFILES: { html: true } }
                  )
                );
              } else {
                setDocxHtml(DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } }));
              }
            }
            return true;
          };

          // Mobile Safari handles embedded PDF blobs poorly. Use responsive HTML first on phones.
          if (isMobileViewport && await loadHtmlPreview()) return;

          const previewUrl = `${API_BASE}/api/drive/files/${fileId}/preview-docx-pdf`;
          const res = await fetch(previewUrl, { credentials: 'include' });

          if (cancelled) return;

          if (!res.ok) {
            const htmlLoaded = await loadHtmlPreview();
            if (!htmlLoaded) {
              let msg = `Failed to load preview (${res.status})`;
              try {
                const errBody = (await res.clone().json()) as { error?: string; detail?: string };
                if (errBody && typeof errBody.error === 'string' && errBody.error.trim()) {
                  msg = errBody.error.trim();
                  if (typeof errBody.detail === 'string' && errBody.detail.trim()) {
                    msg = `${msg} ${errBody.detail.trim()}`;
                  }
                }
              } catch {
                /* keep status message */
              }
              throw new Error(msg);
            }
            return;
          }

          const buf = await res.arrayBuffer();
          const blob = new Blob([buf], { type: 'application/pdf' });
          if (!cancelled) {
            const url = URL.createObjectURL(blob);
            blobUrlRef.current = url;
            setBlobUrl(url);
          }
          return;
        }

        const proxyUrl = `${API_BASE}/api/drive/files/${fileId}/proxy`;
        const res = await fetch(proxyUrl, { credentials: 'include' });

        if (cancelled) return;

        if (!res.ok) {
          let msg = `Failed to load file (${res.status})`;
          try {
            const errBody = await res.clone().json() as { error?: string; detail?: string };
            if (errBody && typeof errBody.error === 'string' && errBody.error.trim()) {
              msg = errBody.error.trim();
              if (typeof errBody.detail === 'string' && errBody.detail.trim()) {
                msg = `${msg} ${errBody.detail.trim()}`;
              }
            }
          } catch {
            /* keep status message */
          }
          throw new Error(msg);
        }

        if (viewerType === 'text' || viewerType === 'markdown') {
          const text = await res.text();
          if (!cancelled) setTextContent(text);
        } else {
          const headerType = res.headers.get('Content-Type')?.split(';')[0]?.trim() || '';
          const blobType =
            headerType && headerType !== 'application/octet-stream' ? headerType : effectiveMime;
          const buf = await res.arrayBuffer();
          const blob = new Blob([buf], { type: blobType || 'application/octet-stream' });
          if (!cancelled) {
            const url = URL.createObjectURL(blob);
            blobUrlRef.current = url;
            setBlobUrl(url);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load file');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadFile();

    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [fileId, viewerType, effectiveMime, isMobileViewport]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4">
          <Loader2 className="w-10 h-10 text-teal-500 animate-spin" />
          <p className="text-slate-500 text-sm font-medium">Loading preview...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4">
          <AlertCircle className="w-12 h-12 text-rose-400" />
          <p className="text-slate-600 font-medium">{error}</p>
          <a
            href={fileUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-teal-600 hover:text-teal-700 underline"
          >
            Open in storage instead
          </a>
        </div>
      );
    }

    if (viewerType === 'unsupported') {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4">
          <FileText className="w-12 h-12 text-slate-300" />
          <p className="text-slate-600 font-medium">Preview not available for this file type</p>
          <p className="text-slate-400 text-sm">({effectiveMime})</p>
          <a
            href={fileUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition flex items-center gap-2 text-sm font-semibold"
          >
            <ExternalLink size={16} /> Open in New Tab
          </a>
        </div>
      );
    }

    if (viewerType === 'image' && blobUrl) {
      return (
        <div className="flex items-center justify-center h-full p-4 overflow-auto">
          <img src={blobUrl} alt={fileName} className="max-w-full max-h-full object-contain rounded-lg shadow-sm" />
        </div>
      );
    }

    if ((viewerType === 'pdf' || viewerType === 'docx') && blobUrl) {
      return (
        <div className="file-preview-scroll h-full overflow-auto bg-slate-100 [-webkit-overflow-scrolling:touch] touch-pan-y">
          <iframe
            src={`${blobUrl}#toolbar=0&navpanes=0&scrollbar=1&view=FitH&zoom=page-width`}
            title={fileName}
            className="file-preview-frame block h-full min-h-[72vh] w-full rounded-b-xl border-0 bg-white max-md:min-h-[calc(100dvh-9.75rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]"
            scrolling="yes"
          />
        </div>
      );
    }

    if (viewerType === 'markdown' && textContent !== null) {
      return (
        <div className="h-full overflow-auto px-8 py-8 max-md:px-3 max-md:py-3">
          <article className="max-w-3xl mx-auto bg-white rounded-xl border border-slate-200/80 shadow-sm px-8 py-10 text-[15px] max-md:px-4 max-md:py-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownDocumentComponents}>
              {textContent}
            </ReactMarkdown>
          </article>
        </div>
      );
    }

    if (viewerType === 'docx' && docxHtml !== null) {
      return (
        <div className="file-preview-scroll h-full overflow-auto px-8 py-8 [-webkit-overflow-scrolling:touch] touch-pan-y max-md:px-2 max-md:py-2">
          <article
            className="docx-preview mx-auto max-w-3xl bg-white rounded-xl border border-slate-200/80 shadow-sm px-8 py-10 text-[15px] text-slate-800 max-md:w-full max-md:max-w-none max-md:rounded-lg max-md:px-3 max-md:py-4 max-md:text-[12px] [&_p]:mb-3 [&_p]:leading-relaxed [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:mt-6 [&_h1]:mb-2 [&_h1:first-child]:mt-0 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2:first-child]:mt-0 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_ul]:list-disc [&_ul]:ml-5 [&_ul]:my-3 [&_ul]:space-y-1 [&_ol]:list-decimal [&_ol]:ml-5 [&_ol]:my-3 [&_ol]:space-y-1 [&_table]:w-full [&_table]:table-fixed [&_table]:text-sm [&_table]:my-4 max-md:[&_table]:text-[9px] [&_td]:border [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top max-md:[&_td]:px-1 max-md:[&_td]:py-0.5 [&_th]:border [&_th]:border-slate-200 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:bg-slate-50 max-md:[&_th]:px-1 max-md:[&_th]:py-0.5 [&_a]:text-teal-600 [&_strong]:font-semibold"
            dangerouslySetInnerHTML={{ __html: docxHtml }}
          />
        </div>
      );
    }

    if (viewerType === 'text' && textContent !== null) {
      return (
        <div className="h-full overflow-auto p-6 max-md:px-3 max-md:py-3">
          <pre className="whitespace-pre-wrap font-mono text-sm text-slate-700 leading-relaxed">
            {textContent}
          </pre>
        </div>
      );
    }

    return null;
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/70 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[min(90vh,calc(100dvh-1.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom)))] w-[95vw] max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl max-md:h-[calc(100dvh-1rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] max-md:w-full max-md:rounded-[20px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3 shrink-0 rounded-t-2xl max-md:flex-col max-md:items-stretch max-md:px-3 max-md:py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <FileText size={18} className="text-teal-600 shrink-0" />
            <h3 className="min-w-0 flex-1 break-all text-sm font-semibold text-slate-800 md:truncate">{fileName}</h3>
            <span className="hidden shrink-0 rounded-full bg-slate-100 px-2 py-1 text-sm text-slate-400 md:inline-flex">
              {effectiveMime.split('/').pop()?.toUpperCase() || 'FILE'}
            </span>
          </div>
          <div className="flex items-center justify-end gap-2 shrink-0 max-md:w-full">
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              className="halo-touch-min inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-teal-50 hover:text-teal-700 max-md:flex-1 max-md:justify-center"
              title="Open in new tab"
            >
              <ExternalLink size={15} /> New Tab
            </a>
            <button
              onClick={onClose}
              className="halo-touch-min shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 bg-slate-50">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};
