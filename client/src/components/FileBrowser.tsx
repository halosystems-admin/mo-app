import React from 'react';
import type { DriveFile, BreadcrumbItem } from '../../../shared/types';
import { AppStatus, FOLDER_MIME_TYPE } from '../../../shared/types';
import {
  FileText, ChevronLeft, ChevronRight, Home, FolderOpen, FolderPlus,
  Pencil, Trash2, Eye, ExternalLink, CloudUpload,
  FileSpreadsheet, FileImage, File, Layers, Upload,
  CreditCard,
} from 'lucide-react';
import { getFriendlyFileType } from '../utils/formatting';

interface FileBrowserProps {
  files: DriveFile[];
  status: AppStatus;
  breadcrumbs: BreadcrumbItem[];
  onNavigateToFolder: (folder: DriveFile) => void;
  onNavigateBack: () => void;
  onNavigateToBreadcrumb: (index: number) => void;
  onStartEditFile: (file: DriveFile) => void;
  onDeleteFile: (file: DriveFile) => void;
  onViewFile: (file: DriveFile) => void;
  onCreateFolder: () => void;
  /** Opens upload picker for files into the current patient folder tree. */
  onPatientUpload?: () => void;
  uploadBusy?: boolean;
  /** Opens sticker / billing profile (HALO_patient_profile.json) — patient root crumb or small link when inside subfolders. */
  onOpenStickerProfile?: () => void;
}

const isFolder = (file: DriveFile): boolean => file.mimeType === FOLDER_MIME_TYPE;

const FileSkeleton: React.FC = () => (
  <div className="space-y-3">
    <div className="flex items-center justify-center gap-2 py-4 text-slate-500">
      <div className="h-5 w-5 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
      <span className="text-sm font-medium">Loading files…</span>
    </div>
    {[1, 2, 3].map((i) => (
      <div key={i} className="flex items-center p-4 bg-white border border-slate-200 rounded-xl animate-pulse">
        <div className="w-11 h-11 bg-slate-200 rounded-lg mr-4" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-slate-200 rounded w-2/3" />
          <div className="h-3 bg-slate-100 rounded w-1/3" />
        </div>
      </div>
    ))}
  </div>
);

export const FileBrowser: React.FC<FileBrowserProps> = ({
  files, status, breadcrumbs,
  onNavigateToFolder, onNavigateBack, onNavigateToBreadcrumb,
  onStartEditFile, onDeleteFile, onViewFile, onCreateFolder,
  onPatientUpload,
  uploadBusy = false,
  onOpenStickerProfile,
}) => {
  const isAtRoot = breadcrumbs.length <= 1;
  const folders = files.filter(isFolder);
  const regularFiles = files.filter(f => !isFolder(f));

  return (
    <div>
      {/* Breadcrumb navigation + New Folder button */}
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {!isAtRoot && (
            <button
              onClick={onNavigateBack}
              className="p-1.5 text-slate-500 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors mr-1"
              title="Go back"
            >
              <ChevronLeft size={18} />
            </button>
          )}
          {breadcrumbs.map((crumb, index) => (
            <React.Fragment key={crumb.id}>
              {index > 0 && <ChevronRight size={14} className="text-slate-300 shrink-0" />}
              <button
                type="button"
                onClick={() => {
                  if (
                    onOpenStickerProfile &&
                    breadcrumbs.length === 1 &&
                    index === breadcrumbs.length - 1
                  ) {
                    onOpenStickerProfile();
                    return;
                  }
                  onNavigateToBreadcrumb(index);
                }}
                title={
                  onOpenStickerProfile && breadcrumbs.length === 1 && index === breadcrumbs.length - 1
                    ? 'View sticker / billing details'
                    : undefined
                }
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                  index === breadcrumbs.length - 1
                    ? 'text-teal-700 bg-teal-50'
                    : 'text-slate-500 hover:text-teal-600 hover:bg-slate-100'
                } ${
                  onOpenStickerProfile && breadcrumbs.length === 1 && index === breadcrumbs.length - 1
                    ? 'cursor-pointer underline-offset-2 hover:underline'
                    : ''
                }`}
              >
                {index === 0 && <Home size={13} className="shrink-0" />}
                {index === 0 && breadcrumbs.length > 1 ? 'Root' : crumb.name}
              </button>
            </React.Fragment>
          ))}
          {onOpenStickerProfile && breadcrumbs.length > 1 ? (
            <button
              type="button"
              onClick={onOpenStickerProfile}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 hover:underline"
              title="Sticker scan / billing profile"
            >
              <CreditCard size={13} className="shrink-0" />
              Profile
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {onPatientUpload && isAtRoot ? (
            <button
              type="button"
              onClick={onPatientUpload}
              disabled={uploadBusy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-halo-primary/35 bg-halo-primary px-2.5 py-1.5 text-[12px] font-semibold text-white shadow-[var(--shadow-halo-soft)] transition hover:bg-halo-primary-hover disabled:opacity-60"
            >
              <Upload size={14} className="shrink-0" />
              Upload
            </button>
          ) : null}
          <button
            onClick={onCreateFolder}
            className="flex items-center gap-1.5 rounded-lg border border-teal-500/25 bg-teal-500/8 px-2.5 py-1.5 text-[12px] font-semibold text-teal-800 transition hover:bg-teal-500/12"
          >
            <FolderPlus size={14} /> New folder
          </button>
        </div>
      </div>

      {/* File / folder listing */}
      <div className="grid grid-cols-1 gap-3">
        {status === AppStatus.LOADING ? (
          <FileSkeleton />
        ) : folders.length === 0 && regularFiles.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-lg">
            {status === AppStatus.UPLOADING ? (
              <div className="flex flex-col items-center gap-3">
                <CloudUpload className="w-12 h-12 text-teal-200 animate-bounce" />
                <p className="text-teal-600 font-medium">Adding file to drive...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <FolderOpen className="w-10 h-10 text-slate-300" />
                <p className="text-slate-400 font-medium">This folder is empty</p>
                <p className="text-slate-300 text-sm">Upload files using the button above</p>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Folders first */}
            {folders.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-1 pt-1">
                  <FolderOpen size={13} className="text-slate-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Folders ({folders.length})</span>
                </div>
                {folders.map(folder => (
                  <div
                    key={folder.id}
                    className="group flex items-center p-4 bg-white border border-slate-200 rounded-xl hover:shadow-md hover:border-teal-200 transition-all duration-200 cursor-pointer"
                    onClick={() => onNavigateToFolder(folder)}
                  >
                    <div className="p-3 rounded-lg mr-4 bg-teal-100 text-teal-600">
                      <FolderOpen className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-slate-800 group-hover:text-teal-700 transition-colors truncate">{folder.name}</h4>
                      <p className="text-xs text-slate-500 mt-1">Folder &bull; {folder.createdTime}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); onStartEditFile(folder); }}
                        className="p-2 text-slate-400 hover:text-teal-600 hover:bg-slate-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                        title="Rename"
                      >
                        <Pencil size={16} />
                      </button>
                      <ChevronRight size={18} className="text-slate-300 group-hover:text-teal-500 transition-colors" />
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* Files */}
            {regularFiles.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-1 pt-2">
                  <FileText size={13} className="text-slate-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Files ({regularFiles.length})</span>
                </div>
                {regularFiles.map(file => {
                  const isImage = file.mimeType.includes('image');
                  const isSpreadsheet = file.mimeType.includes('spreadsheet') || file.mimeType.includes('excel') || file.mimeType.includes('csv');
                  const isPdf = file.mimeType === 'application/pdf';
                  const iconClass = isImage
                    ? 'bg-teal-500/12 text-teal-700'
                    : isSpreadsheet
                      ? 'bg-slate-100 text-slate-700'
                      : isPdf
                        ? 'bg-teal-500/10 text-teal-800'
                        : 'bg-slate-100 text-slate-600';
                  const IconComponent = isImage ? FileImage
                    : isSpreadsheet ? FileSpreadsheet
                    : isPdf ? FileText
                    : File;
                  return (
                    <div key={file.id} className="group flex items-center p-4 bg-white border border-slate-200 rounded-xl hover:shadow-md hover:border-teal-200 transition-all duration-200">
                      <div className={`p-3 rounded-lg mr-4 ${iconClass}`}>
                        <IconComponent className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-slate-800 group-hover:text-teal-700 transition-colors truncate">{file.name}</h4>
                        <p className="text-xs text-slate-500 mt-1 truncate">{file.createdTime} &bull; {getFriendlyFileType(file.mimeType)}</p>
                      </div>
                      <div className="relative z-[5] flex items-center gap-1 sm:z-auto">
                        <button onClick={() => onStartEditFile(file)} className="p-2 text-slate-400 hover:text-teal-600 hover:bg-slate-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100 max-md:opacity-100" title="Rename">
                          <Pencil size={16} />
                        </button>
                        <button onClick={() => onDeleteFile(file)} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100 max-md:opacity-100" title="Delete">
                          <Trash2 size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onViewFile(file)}
                          className="sm:hidden p-2 text-slate-500 hover:text-teal-700 hover:bg-teal-50 rounded-lg transition-colors"
                          title="Preview"
                        >
                          <Eye size={18} />
                        </button>
                        <button onClick={() => onViewFile(file)} className="hidden sm:inline-flex items-center gap-1.5 text-sm bg-slate-50 text-slate-600 px-3 py-1.5 rounded-md font-medium hover:bg-teal-50 hover:text-teal-700 transition-colors" title="Preview">
                          <Eye size={14} /> View
                        </button>
                        <a href={file.url} target="_blank" rel="noreferrer" className="p-2 text-slate-400 hover:text-teal-600 hover:bg-slate-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="Open in new tab">
                          <ExternalLink size={16} />
                        </a>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};
