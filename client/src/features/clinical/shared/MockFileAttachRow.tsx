import React, { useId, useRef } from 'react';
import { FileUp, FolderOpen } from 'lucide-react';
import { formatUploadedDocSummary } from './clinicalDisplay';

export interface MockFileAttachRowProps {
  label: string;
  description?: string;
  accept: string;
  fileName?: string;
  uploadedAt?: string;
  sizeBytes?: number;
  onChooseFile: (file: File) => void;
  onClear?: () => void;
  openFolderAction?: { label: string; onClick: () => void };
}

export const MockFileAttachRow: React.FC<MockFileAttachRowProps> = ({
  label,
  description,
  accept,
  fileName,
  uploadedAt,
  sizeBytes,
  onChooseFile,
  onClear,
  openFolderAction,
}) => {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const summary = formatUploadedDocSummary(fileName, uploadedAt, sizeBytes);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-slate-800">{label}</p>
          {description ? <p className="text-xs text-slate-500 mt-0.5 max-w-xl">{description}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {openFolderAction ? (
            <button
              type="button"
              onClick={openFolderAction.onClick}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-teal-50 hover:border-teal-200"
            >
              <FolderOpen size={14} className="text-teal-600" />
              {openFolderAction.label}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700"
          >
            <FileUp size={14} />
            {summary ? 'Replace file' : 'Browse…'}
          </button>
          {summary && onClear ? (
            <button
              type="button"
              onClick={onClear}
              className="px-2 py-1.5 text-xs text-slate-600 hover:text-slate-900"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onChooseFile(f);
          e.target.value = '';
        }}
      />
      {summary ? (
        <p className="text-xs text-slate-700 rounded-lg bg-white border border-slate-100 px-3 py-2">{summary}</p>
      ) : (
        <p className="text-xs text-slate-400 italic">No file attached yet.</p>
      )}
    </div>
  );
};
