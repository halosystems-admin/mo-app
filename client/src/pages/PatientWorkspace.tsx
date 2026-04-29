import React, { useState, useEffect, useCallback, useRef } from 'react';
import type {
  Patient,
  DriveFile,
  LabAlert,
  BreadcrumbItem,
  ChatMessage,
  HaloNote,
  NoteField,
  CalendarEvent,
  ScribeSession,
} from '../../../shared/types';
import { DEFAULT_HALO_TEMPLATE_ID, HALO_TEMPLATE_OPTIONS, HOSPITALS, type HospitalKey } from '../../../shared/haloTemplates';
import { AppStatus, FOLDER_MIME_TYPE } from '../../../shared/types';

import {
  fetchFiles,
  fetchFilesFirstPage,
  fetchFilesPage,
  fetchFolderContents,
  warmAndListFiles,
  uploadFile,
  updatePatient,
  updateFileMetadata,
  generatePatientSummary,
  analyzeAndRenameImage,
  extractLabAlerts,
  deleteFile,
  createFolder,
  askHaloStream,
  askHalo,
  generateNotePreview,
  generateNotePreviewPdf,
  saveNoteAsDocx,
  generatePrepNote,
  getHaloTemplates,
  describeFile,
  appendLongitudinalContextPdf,
  fetchPatientSessions,
  savePatientSession,
} from '../services/api';
import { uploadAndExtractSmartContext } from '../services/smartContext';
import {
  Upload, CheckCircle2, ChevronLeft, Loader2, Camera,
  CloudUpload, Pencil, X, Trash2, FolderOpen, MessageCircle,
  FolderPlus, ChevronRight, ExternalLink, FileText, Layers, Plus,
  History,
  Captions,
} from 'lucide-react';
import { SmartSummary } from '../features/smart-summary/SmartSummary';
import { LabAlerts } from '../features/lab-alerts/LabAlerts';
import { HeaderConsultationRecorder } from '../features/scribe/HeaderConsultationRecorder';
import { FileViewer } from '../components/FileViewer';
import { FileBrowser } from '../components/FileBrowser';
import { NoteEditor } from '../components/NoteEditor';
import { PatientChat } from '../components/PatientChat';
import { getErrorMessage } from '../utils/formatting';
import { CLINICAL_BTN_PRIMARY } from '../features/clinical/shared/tableScrollClasses';

const MAX_MAIN_COMPLAINT_LEN = 80;

/** Shared shell for Note fields / Transcription / Smart context (visual parity). */
const EDITOR_VIEW_SHELL =
  'flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200/60';
const EDITOR_VIEW_HEADER =
  'flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2.5';
const EDITOR_VIEW_TITLE = 'text-[11px] font-semibold uppercase tracking-wide text-slate-500';

/** Internal scribe state file — never list in browser/context picker (still stored in cloud). */
const SCRIBE_SESSIONS_FILE_NAME = 'halo_scribe_sessions.json';

function excludeHiddenPatientFiles(files: DriveFile[]): DriveFile[] {
  return files.filter((f) => f.name !== SCRIBE_SESSIONS_FILE_NAME);
}

/** Extract a short main complaint from note content for session list title (e.g. "Ankle Fracture"). */
function extractMainComplaint(content: string): string {
  if (!content || typeof content !== 'string') return '';
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const complaintHeaders = /^(?:presenting complaint|chief complaint|reason for visit|main complaint|now):\s*/i;
  for (const line of lines) {
    const match = line.match(complaintHeaders);
    if (match) {
      const after = line.slice(match[0].length).trim();
      if (after) return after.slice(0, MAX_MAIN_COMPLAINT_LEN);
    }
    if (line.startsWith('-') && line.length > 1) {
      const text = line.slice(1).trim();
      if (text && text.length < 120) return text.slice(0, MAX_MAIN_COMPLAINT_LEN);
    }
  }
  const first = lines[0];
  if (first && first.length < 120) return first.slice(0, MAX_MAIN_COMPLAINT_LEN);
  return '';
}

/** Effective note text for save/email: content or decoded from fields. */
function getNoteText(note: HaloNote): string {
  if (note.content?.trim()) return note.content;
  if (note.fields?.length) {
    return (note.fields as NoteField[])
      .map((f) => (f.label ? `${f.label}:\n${f.body ?? ''}` : f.body))
      .filter(Boolean)
      .join('\n\n');
  }
  return '';
}

function buildNoteGenerationInput(transcript: string, consultContext: string): string {
  const cleanTranscript = transcript.trim();
  const cleanContext = consultContext.trim();
  if (!cleanContext) return cleanTranscript;
  return [
    'Additional clinical context for note generation:',
    cleanContext,
    '',
    'Transcript:',
    cleanTranscript,
  ].join('\n');
}

/** Fallback when Halo get_templates fails or returns empty (must match shared/haloTemplates). */
/** Server uses HALO_USER_ID from env / shared when user_id is not sent. */
function getHaloUserForTemplate(_templateId: string | undefined): string | undefined {
  return undefined;
}

function normalizeHaloTemplates(raw: Record<string, unknown>): Array<{ id: string; name: string }> {
  if (!raw || typeof raw !== 'object') return [];
  const arr = Array.isArray(raw)
    ? raw
    : raw.templates && Array.isArray(raw.templates)
      ? raw.templates
      : raw;
  // Array: [ { id, name } or { template_id, name } ]
  if (Array.isArray(arr)) {
    return (arr as Array<Record<string, unknown>>)
      .map((t) => {
        const id = (t.id ?? t.template_id ?? t.templateId) as string;
        const name = (t.name ?? t.title ?? id ?? '') as string;
        return id && name ? { id: String(id), name: String(name) } : null;
      })
      .filter((t): t is { id: string; name: string } => t != null);
  }
  // Object: { "templateId": { name: "..." } } (e.g. Firebase users/{id}/templates)
  return Object.entries(arr as Record<string, unknown>).map(([id, val]) => {
    const o = val && typeof val === 'object' ? (val as Record<string, unknown>) : {};
    const name = (o.name ?? o.title ?? id) as string;
    return { id, name: String(name || id) };
  });
}

interface Props {
  patient: Patient;
  onBack: () => void;
  onDataChange: () => void;
  onToast: (message: string, type: 'success' | 'error' | 'info') => void;
  templateId?: string;
  calendarPrepEvent?: CalendarEvent | null;
}

export const PatientWorkspace: React.FC<Props> = ({ patient, onBack, onDataChange, onToast, templateId: propTemplateId, calendarPrepEvent }) => {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [summary, setSummary] = useState<string[]>([]);
  const [alerts, setAlerts] = useState<LabAlert[]>([]);
  const [notes, setNotes] = useState<HaloNote[]>([]);
  const [activeNoteIndex, setActiveNoteIndex] = useState(0);
  const [templateId, setTemplateId] = useState(propTemplateId || DEFAULT_HALO_TEMPLATE_ID);
  const [pendingTranscript, setPendingTranscript] = useState<string | null>(null);
  /** Full transcript for the current session (all completed segments). */
  const [lastTranscript, setLastTranscript] = useState<string>('');
  /** Live transcript for the current in-progress recording segment (not yet merged into lastTranscript). */
  const [liveTranscriptSegment, setLiveTranscriptSegment] = useState<string>('');
  const [isLiveStreaming, setIsLiveStreaming] = useState(false);
  const [showAddNoteModal, setShowAddNoteModal] = useState(false);
  const [consultSubTab, setConsultSubTab] = useState<'transcript' | 'context' | number>('transcript');
  const [templateOptions, setTemplateOptions] = useState<Array<{ id: string; name: string }>>([...HALO_TEMPLATE_OPTIONS]);
  const [selectedTemplatesForGenerate, setSelectedTemplatesForGenerate] = useState<string[]>([]);
  /** Last Smart Context image to embed in cumulative PDF on “Save to record”. */
  const [pendingLongitudinalImage, setPendingLongitudinalImage] = useState<{
    base64: string;
    mimeType: string;
    fileName: string;
  } | null>(null);
  const [templateSearch, setTemplateSearch] = useState('');
  const [selectedHospital, setSelectedHospital] = useState<HospitalKey>('louis_leipoldt');
  const activeHospitalConfig = HOSPITALS.find(h => h.key === selectedHospital) ?? HOSPITALS[0];
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [activeTab, setActiveTab] = useState<'overview' | 'notes' | 'chat' | 'sessions'>('overview');
  const [savingNoteIndex, setSavingNoteIndex] = useState<number | null>(null);
  const [regeneratingPdfIndex, setRegeneratingPdfIndex] = useState<number | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showAiPanel, setShowAiPanel] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [isGeneratingNotes, setIsGeneratingNotes] = useState(false);
  const [showCustomAiNoteModal, setShowCustomAiNoteModal] = useState(false);
  const [customAiPrompt, setCustomAiPrompt] = useState('');
  const [customAiLoading, setCustomAiLoading] = useState(false);
  const [consultContext, setConsultContext] = useState('');
  const [didCopyTranscript, setDidCopyTranscript] = useState(false);
  const [noteGenerationStep, setNoteGenerationStep] = useState(0);
  const [sessions, setSessions] = useState<ScribeSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Derived "current" transcript that the UI shows and copies:
  // any completed segments (lastTranscript) plus the current live segment (if recording).
  const currentTranscript = liveTranscriptSegment
    ? (lastTranscript ? `${lastTranscript}\n\n${liveTranscriptSegment}` : liveTranscriptSegment)
    : lastTranscript;

  // Folder navigation state
  const [currentFolderId, setCurrentFolderId] = useState<string>(patient.id);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([
    { id: patient.id, name: patient.name },
  ]);

  const [editingPatient, setEditingPatient] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDob, setEditDob] = useState("");
  const [editSex, setEditSex] = useState<'M' | 'F'>('M');

  const [editingFile, setEditingFile] = useState<DriveFile | null>(null);
  const [editFileName, setEditFileName] = useState("");

  const [fileToDelete, setFileToDelete] = useState<DriveFile | null>(null);

  // File viewer state
  const [viewingFile, setViewingFile] = useState<DriveFile | null>(null);

  // Chat state — use a ref to always have the latest messages for API calls
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatLongWait, setChatLongWait] = useState(false);
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  const chatLongWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  chatMessagesRef.current = chatMessages;

  useEffect(() => {
    if (typeof consultSubTab === 'number' && (consultSubTab < 0 || consultSubTab >= notes.length)) {
      setConsultSubTab(0);
    }
  }, [consultSubTab, notes.length]);

  // Create folder state
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // Upload destination picker state
  const [showUploadPicker, setShowUploadPicker] = useState(false);
  const [uploadTargetFolderId, setUploadTargetFolderId] = useState<string>(patient.id);
  const [uploadTargetLabel, setUploadTargetLabel] = useState<string>(patient.name);
  const [uploadPickerFolders, setUploadPickerFolders] = useState<DriveFile[]>([]);
  const [uploadPickerLoading, setUploadPickerLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showContextDrivePicker, setShowContextDrivePicker] = useState(false);
  const [contextDriveFiles, setContextDriveFiles] = useState<DriveFile[]>([]);
  const [contextDriveLoading, setContextDriveLoading] = useState(false);
  const [contextDriveSelectedIds, setContextDriveSelectedIds] = useState<string[]>([]);
  const contextUploadInputRef = useRef<HTMLInputElement>(null);
  const [showContextUploadChooser, setShowContextUploadChooser] = useState(false);
  const contextCameraInputRef = useRef<HTMLInputElement>(null);
  const contextPhotoInputRef = useRef<HTMLInputElement>(null);
  const [contextEnrichBusy, setContextEnrichBusy] = useState(false);
  const [contextSaveBusy, setContextSaveBusy] = useState(false);
  /** Editor sub-view: template note, raw transcript, or smart context (toolbar switches). */
  const [editorPanelView, setEditorPanelView] = useState<'noteFields' | 'transcription' | 'smartContext'>(
    'noteFields'
  );

  const isFolder = (file: DriveFile): boolean => file.mimeType === FOLDER_MIME_TYPE;

  useEffect(() => {
    if (activeTab !== 'notes') setEditorPanelView('noteFields');
  }, [activeTab]);

  // Load folder contents (with loading indicator)
  const loadFolderContents = useCallback(async (folderId: string) => {
    setStatus(AppStatus.LOADING);
    try {
      const contents = folderId === patient.id
        ? await fetchFiles(patient.id)
        : await fetchFolderContents(folderId);
      setFiles(excludeHiddenPatientFiles(contents));
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
    }
    setStatus(AppStatus.IDLE);
  }, [patient.id, onToast]);

  // Silent refresh (no loading indicator — used for periodic polling)
  const silentRefresh = useCallback(async () => {
    try {
      const contents = currentFolderId === patient.id
        ? await fetchFiles(patient.id)
        : await fetchFolderContents(currentFolderId);
      setFiles(excludeHiddenPatientFiles(contents));
    } catch {
      // Silent — don't show errors for background refreshes
    }
  }, [currentFolderId, patient.id]);

  // Poll for external changes every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      silentRefresh();
      onDataChange();
    }, 30_000);
    return () => clearInterval(interval);
  }, [silentRefresh, onDataChange]);

  // Clean up upload progress interval on unmount
  useEffect(() => {
    return () => {
      if (uploadIntervalRef.current) clearInterval(uploadIntervalRef.current);
    };
  }, []);

  // Initial load + AI summary (only at root patient folder)
  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      setStatus(AppStatus.LOADING);
      setFiles([]);
      setSummary([]);
      setAlerts([]);
      setChatMessages([]);
      setChatInput("");
      setUploadMessage(null);
      setCurrentFolderId(patient.id);
      setBreadcrumbs([{ id: patient.id, name: patient.name }]);
      setUploadTargetFolderId(patient.id);
      setUploadTargetLabel(patient.name);

      try {
        // Try direct list first (fast when Drive responds). Fall back to warm-and-list if it fails
        // (warm upload can help with Drive API cold start; server has timeouts so we never hang)
        let firstFiles: DriveFile[];
        let nextPage: string | null;
        try {
          const direct = await fetchFilesFirstPage(patient.id, 100);
          firstFiles = direct.files;
          nextPage = direct.nextPage;
        } catch {
          const warm = await warmAndListFiles(patient.id, 100);
          firstFiles = warm.files;
          nextPage = warm.nextPage;
        }
        firstFiles = excludeHiddenPatientFiles(firstFiles);
        if (!isMounted) return;
        setFiles(firstFiles);
        setStatus(AppStatus.IDLE);

        // Fetch remaining pages in background and append (so full list appears without blocking UI)
        if (nextPage) {
          (async () => {
            const all = [...firstFiles];
            let page: string | null = nextPage;
            while (page && isMounted) {
              try {
                const data = await fetchFilesPage(patient.id, page);
                all.push(...excludeHiddenPatientFiles(data.files));
                if (isMounted) setFiles([...all]);
                page = data.nextPage;
              } catch {
                break;
              }
            }
          })();
        }
      } catch (err) {
        if (isMounted) {
          onToast(getErrorMessage(err), 'error');
        }
        if (isMounted) setStatus(AppStatus.IDLE);
      }
    };

    loadData();
    return () => { isMounted = false; };
  }, [patient.id, patient.name, onToast]);

  // Load template list from Halo when user opens Editor & Scribe (use real template IDs to avoid 404)
  // Also load sessions when opening Editor & Scribe or Previous Sessions tab
  useEffect(() => {
    if (activeTab !== 'notes' && activeTab !== 'sessions') return;

    if (activeTab === 'notes') {
      getHaloTemplates()
        .then((raw) => {
          const list = normalizeHaloTemplates(raw as Record<string, unknown>);
          if (list.length > 0) {
            setTemplateOptions(list);
            setSelectedTemplatesForGenerate((prev) =>
              prev.filter((id) => list.some((t) => t.id === id))
            );
          }
        })
        .catch(() => {
          // Keep HALO_TEMPLATE_OPTIONS on failure
        });
    }

    setSessionsLoading(true);
    fetchPatientSessions(patient.id)
      .then((res) => {
        const items = Array.isArray(res.sessions) ? res.sessions : [];
        const sorted = [...items].sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
        setSessions(sorted);
      })
      .catch(() => {
        setSessions([]);
        setActiveSessionId(null);
      })
      .finally(() => {
        setSessionsLoading(false);
      });
  }, [activeTab, patient.id]);

  // Navigate into a subfolder
  const navigateToFolder = async (folder: DriveFile) => {
    setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name }]);
    setCurrentFolderId(folder.id);
    await loadFolderContents(folder.id);
  };

  const navigateBack = async () => {
    if (breadcrumbs.length <= 1) return;
    const newBreadcrumbs = breadcrumbs.slice(0, -1);
    const parentId = newBreadcrumbs[newBreadcrumbs.length - 1].id;
    setBreadcrumbs(newBreadcrumbs);
    setCurrentFolderId(parentId);
    await loadFolderContents(parentId);
  };

  const navigateToBreadcrumb = async (index: number) => {
    if (index === breadcrumbs.length - 1) return;
    const newBreadcrumbs = breadcrumbs.slice(0, index + 1);
    const targetId = newBreadcrumbs[newBreadcrumbs.length - 1].id;
    setBreadcrumbs(newBreadcrumbs);
    setCurrentFolderId(targetId);
    await loadFolderContents(targetId);
  };

  const handleContextUploadClick = () => {
    setShowContextUploadChooser(true);
  };

  const handleConsultContextFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const isAccepted =
      file.type.startsWith('image/') ||
      file.type === 'application/pdf' ||
      /\.(jpe?g|png|gif|webp|bmp|heic|heif|svg|pdf)$/i.test(file.name);
    if (!isAccepted) {
      onToast('Please choose an image (scan/photo) or PDF.', 'info');
      return;
    }
    setContextEnrichBusy(true);
    try {
      const result = await uploadAndExtractSmartContext(patient.id, file);
      setConsultContext((prev) => {
        const next = prev ? `${prev}\n\n${result.panelBlock}` : result.panelBlock;
        console.log('[smart-context-client] context panel updated', {
          patientId: patient.id,
          panelLength: next.length,
        });
        return next;
      });
      setPendingLongitudinalImage(result.imageAttachment);
      onToast('Saved to folder and context panel.', 'success');
      await loadFolderContents(currentFolderId);
      onDataChange();
    } catch (err) {
      console.error('[smart-context-client] upload flow failed', err);
      onToast(getErrorMessage(err), 'error');
    } finally {
      setContextEnrichBusy(false);
    }
  };

  /** Append Context into the existing cumulative history PDF in Patient Notes (server: CUMULATIVE_HISTORY_PDF_NAME). */
  const handleContextDoneSave = async () => {
    const text = consultContext.trim();
    if (!text) {
      onToast('Context is empty — add text or upload first.', 'info');
      return;
    }
    setContextSaveBusy(true);
    try {
      const canEmbed =
        pendingLongitudinalImage &&
        (/image\/png/i.test(pendingLongitudinalImage.mimeType) ||
          /image\/jpe?g/i.test(pendingLongitudinalImage.mimeType));
      const att = canEmbed
        ? [
            {
              base64: pendingLongitudinalImage!.base64,
              mimeType: /image\/png/i.test(pendingLongitudinalImage!.mimeType) ? 'image/png' : 'image/jpeg',
              fileName: pendingLongitudinalImage!.fileName,
            },
          ]
        : undefined;
      await appendLongitudinalContextPdf(patient.id, text, att);
      setPendingLongitudinalImage(null);
      await silentRefresh();
      onDataChange();
      onToast('Appended to record PDF.', 'success');
      if (notes.length > 0) setConsultSubTab(0);
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
    } finally {
      setContextSaveBusy(false);
    }
  };

  // Upload destination picker — always default to current patient so switching profiles doesn't show previous patient
  const openUploadPicker = async () => {
    setUploadTargetFolderId(patient.id);
    setUploadTargetLabel(patient.name);
    setShowUploadPicker(true);
    setUploadPickerLoading(true);
    try {
      const contents = await fetchFiles(patient.id);
      setUploadPickerFolders(contents.filter(f => f.mimeType === FOLDER_MIME_TYPE));
    } catch {
      setUploadPickerFolders([]);
    }
    setUploadPickerLoading(false);
  };

  const selectUploadFolder = async (folder: DriveFile) => {
    setUploadTargetFolderId(folder.id);
    setUploadTargetLabel(folder.name);
    setUploadPickerLoading(true);
    try {
      const contents = await fetchFolderContents(folder.id);
      setUploadPickerFolders(contents.filter(f => f.mimeType === FOLDER_MIME_TYPE));
    } catch {
      setUploadPickerFolders([]);
    }
    setUploadPickerLoading(false);
  };

  const confirmUploadDestination = () => {
    setShowUploadPicker(false);
    fileInputRef.current?.click();
  };

  const openContextDrivePicker = async () => {
    setShowContextDrivePicker(true);
    setContextDriveLoading(true);
    setContextDriveSelectedIds([]);
    try {
      const rootFiles = await fetchFiles(patient.id);
      setContextDriveFiles(excludeHiddenPatientFiles(rootFiles));
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
      setContextDriveFiles([]);
    }
    setContextDriveLoading(false);
  };

  const toggleContextDriveSelection = (fileId: string) => {
    setContextDriveSelectedIds(prev =>
      prev.includes(fileId) ? prev.filter(id => id !== fileId) : [...prev, fileId]
    );
  };

  const applyContextDriveSelection = () => {
    const selectedFiles = contextDriveFiles.filter(
      (file) => contextDriveSelectedIds.includes(file.id) && !isFolder(file)
    );
    if (selectedFiles.length === 0) {
      setShowContextDrivePicker(false);
      return;
    }
    const fileList = selectedFiles.map((f) => `- ${f.name}`).join('\n');
    const prefix = 'Files to review:\n';
    setConsultContext((prev) =>
      prev ? `${prev}\n\n${prefix}${fileList}` : `${prefix}${fileList}`
    );
    setShowContextDrivePicker(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const targetId = uploadTargetFolderId;
    e.target.value = '';

    setStatus(AppStatus.UPLOADING);
    setUploadProgress(8);
    setUploadMessage(`Uploading ${file.name}…`);

    if (uploadIntervalRef.current) clearInterval(uploadIntervalRef.current);
    uploadIntervalRef.current = setInterval(() => {
      setUploadProgress((prev) => (prev >= 85 ? 85 : prev + 7));
    }, 140);

    try {
      let finalName = file.name;

      if (file.type.startsWith('image/')) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const r = reader.result as string;
            resolve(r.includes(',') ? r.split(',')[1] : r);
          };
          reader.onerror = () => reject(new Error('Could not read file'));
          reader.readAsDataURL(file);
        });
        setStatus(AppStatus.ANALYZING);
        setUploadMessage('Suggesting filename…');
        try {
          finalName = await analyzeAndRenameImage(base64);
        } catch {
          /* keep original name */
        }
        setStatus(AppStatus.UPLOADING);
        setUploadMessage(`Uploading ${finalName}…`);
      }

      const uploaded = await uploadFile(targetId, file, finalName);

      if (uploadIntervalRef.current) {
        clearInterval(uploadIntervalRef.current);
        uploadIntervalRef.current = null;
      }
      setUploadProgress(100);

      await silentRefresh();
      onDataChange();
      onToast(`File uploaded to "${uploadTargetLabel}".`, 'success');

      try {
        const description = await describeFile(patient.id, uploaded);
        if (description && description.trim()) {
          setConsultContext((prev) =>
            prev
              ? `${prev}\n\n${uploaded.name} — AI description:\n${description}`
              : `${uploaded.name} — AI description:\n${description}`
          );
        }
      } catch {
        /* optional */
      }
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
    } finally {
      if (uploadIntervalRef.current) {
        clearInterval(uploadIntervalRef.current);
        uploadIntervalRef.current = null;
      }
      setUploadProgress(0);
      setUploadMessage(null);
      setStatus(AppStatus.IDLE);
    }
  };

  useEffect(() => {
    if (propTemplateId) setTemplateId(propTemplateId);
  }, [propTemplateId]);

  const handleNoteChange = useCallback((noteIndex: number, updates: { title?: string; content?: string; fields?: NoteField[] }) => {
    setNotes(prev => prev.map((n, i) => i !== noteIndex ? n : {
      ...n,
      ...(updates.title !== undefined && { title: updates.title }),
      ...(updates.content !== undefined && { content: updates.content }),
      ...(updates.fields !== undefined && { fields: updates.fields }),
      dirty: true,
    }));
  }, []);

  const buildNoteFileName = useCallback(
    (tplId: string | undefined, fallbackTitle: string) => {
      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10);
      const templateName =
        templateOptions.find(t => t.id === tplId)?.name ||
        tplId ||
        fallbackTitle ||
        'Note';
      const raw = `${patient.name} - ${dateStr} - ${templateName}`;
      return raw.replace(/[^\w\s-]/g, '').trim() || undefined;
    },
    [patient.name, templateOptions]
  );

  const handleSaveAsDocx = useCallback(async (noteIndex: number) => {
    const note = notes[noteIndex];
    const text = note ? getNoteText(note) : '';
    if (!text.trim()) return;
    setSavingNoteIndex(noteIndex);
    setStatus(AppStatus.SAVING);
    try {
      const tplId = note.template_id || templateId;
      const fileName = buildNoteFileName(tplId, note.title || 'Note');
      await saveNoteAsDocx({
        patientId: patient.id,
        template_id: tplId,
        text,
        fileName,
        user_id: getHaloUserForTemplate(tplId),
      });
      setNotes(prev => prev.map((n, i) => i !== noteIndex ? n : { ...n, lastSavedAt: new Date().toISOString(), dirty: false }));
      await loadFolderContents(currentFolderId);
      onDataChange();
      onToast('Note saved as DOCX to Patient Notes folder.', 'success');
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
    }
    setSavingNoteIndex(null);
    setStatus(AppStatus.IDLE);
  }, [notes, patient.id, templateId, currentFolderId, loadFolderContents, onDataChange, onToast, buildNoteFileName]);

  const handleSaveAll = useCallback(async () => {
    setStatus(AppStatus.SAVING);
    let saved = 0;
    try {
      for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        const text = getNoteText(note);
        if (!text.trim()) continue;
        const tplId = note.template_id || templateId;
        const fileName = buildNoteFileName(tplId, note.title || `Note ${i + 1}`);
        await saveNoteAsDocx({
          patientId: patient.id,
          template_id: tplId,
          text,
          fileName,
          user_id: getHaloUserForTemplate(tplId),
        });
        setNotes(prev => prev.map((n, j) => j !== i ? n : { ...n, lastSavedAt: new Date().toISOString(), dirty: false }));
        saved++;
      }
      if (saved > 0) {
        await loadFolderContents(currentFolderId);
        onDataChange();
        onToast(`Saved ${saved} note(s) as DOCX.`, 'success');
      }
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
    }
    setStatus(AppStatus.IDLE);
  }, [notes, patient.id, templateId, currentFolderId, loadFolderContents, onDataChange, onToast, buildNoteFileName]);

  const handleEmail = useCallback((_noteIndex: number) => {
    onToast('Email not implemented yet.', 'info');
  }, [onToast]);

  const handleRegeneratePdf = useCallback(async (noteIndex: number, text: string) => {
    const note = notes[noteIndex];
    const payloadText = text.trim();
    if (!note || !payloadText) return;
    const tplId = note.template_id || templateId;
    setRegeneratingPdfIndex(noteIndex);
    try {
      const [{ pdfBase64 }, preview] = await Promise.all([
        generateNotePreviewPdf({
          template_id: tplId,
          text: payloadText,
          user_id: getHaloUserForTemplate(tplId),
        }),
        generateNotePreview({
          template_id: tplId,
          text: payloadText,
          user_id: getHaloUserForTemplate(tplId),
        }),
      ]);
      const first = preview.notes?.[0];
      setNotes((prev) =>
        prev.map((n, i) =>
          i !== noteIndex
            ? n
            : {
                ...n,
                content: first?.content?.trim() || payloadText,
                ...(first?.raw !== undefined ? { raw: first.raw } : {}),
                ...(first?.fields && first.fields.length > 0 ? { fields: first.fields } : {}),
                previewPdfBase64: pdfBase64,
                dirty: true,
              }
        )
      );
      onToast('PDF preview regenerated from updated note fields.', 'success');
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
    } finally {
      setRegeneratingPdfIndex(null);
    }
  }, [notes, onToast, templateId]);

  const GENERATE_TIMEOUT_MS = 95_000;

  const generateNotesFromTranscript = useCallback(
    async (transcriptToUse: string, isAddNote: boolean) => {
      const trimmedTranscript = transcriptToUse.trim();
      const noteInput = buildNoteGenerationInput(trimmedTranscript, consultContext);
      if (selectedTemplatesForGenerate.length === 0) {
        onToast('Choose at least one template.', 'info');
        return;
      }
      if (!trimmedTranscript) {
        onToast('No transcript to generate from. Use the Scribe to dictate first.', 'info');
        return;
      }
      setPendingTranscript(null);
      setShowAddNoteModal(false);
      setIsGeneratingNotes(true);
      setNoteGenerationStep(0);
      const templateIds = selectedTemplatesForGenerate;
      const templateNames = Object.fromEntries(templateOptions.map(t => [t.id, t.name]));
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Note generation is taking too long. Please try again.')), GENERATE_TIMEOUT_MS)
      );
      try {
        const results = await Promise.race([
          Promise.all(
            templateIds.map(async (id) => {
              const [noteResult, pdfResult] = await Promise.all([
                generateNotePreview({
                  template_id: id,
                  text: noteInput,
                  user_id: selectedHospital === 'louis_leipoldt' ? undefined : activeHospitalConfig.userId,
                }),
                generateNotePreviewPdf({
                  template_id: id,
                  text: noteInput,
                  user_id: selectedHospital === 'louis_leipoldt' ? undefined : activeHospitalConfig.userId,
                }),
              ]);
              return { noteResult, pdfBase64: pdfResult.pdfBase64 };
            })
          ),
          timeoutPromise,
        ]);
        const combined: HaloNote[] = results.map((res, i) => {
          const tid = templateIds[i];
          const name = templateNames[tid] ?? tid;
          const first = res.noteResult.notes?.[0];
          const fromFields =
            first?.fields && first.fields.length > 0
              ? first.fields
                  .map((f) => (f.label ? `${f.label}:\n${f.body ?? ''}` : f.body))
                  .filter(Boolean)
                  .join('\n\n')
              : '';
          const content =
            first?.content?.trim() || fromFields || trimmedTranscript;
          return {
            noteId: first?.noteId ?? `note-${tid}-${Date.now()}`,
            title: first?.title ?? name,
            content,
            ...(first?.raw !== undefined ? { raw: first.raw } : {}),
            ...(res.pdfBase64 ? { previewPdfBase64: res.pdfBase64 } : {}),
            template_id: tid,
            lastSavedAt: new Date().toISOString(),
            dirty: false,
            ...(first?.fields && first.fields.length > 0 ? { fields: first.fields } : {}),
          };
        });
        if (isAddNote) {
          setNotes(prev => [...prev, ...combined]);
          setActiveNoteIndex(notes.length);
          setConsultSubTab(notes.length);
        } else {
          setLastTranscript(trimmedTranscript);
          setNotes(combined);
          setActiveNoteIndex(0);
          setConsultSubTab(0);
        }

        // Persist this consultation as a scribe session for this patient (including generated note content)
        try {
          const firstNoteContent = combined[0]?.content ?? '';
          const mainComplaint = extractMainComplaint(firstNoteContent);
          const payload = {
            sessionId: activeSessionId || undefined,
            transcript: trimmedTranscript,
            context: consultContext || undefined,
            templates: templateIds,
            noteTitles: combined.map((n) => n.title).filter(Boolean),
            notes: combined.map((n) => ({
              noteId: n.noteId,
              title: n.title,
              content: n.content,
              template_id: n.template_id,
              ...(n.raw !== undefined ? { raw: n.raw } : {}),
              ...(n.fields && n.fields.length > 0 ? { fields: n.fields } : {}),
            })),
            ...(mainComplaint ? { mainComplaint } : {}),
          };
          const res = await savePatientSession(patient.id, payload);
          const items = Array.isArray(res.sessions) ? res.sessions : [];
          const sorted = [...items].sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
          setSessions(sorted);
          setActiveSessionId(sorted[0]?.id ?? null);
        } catch {
          // Session history is best-effort; ignore failures
        }

        onToast('Note generated. You can edit and save as DOCX.', 'success');
      } catch (err) {
        onToast(getErrorMessage(err), 'error');
      }
      setIsGeneratingNotes(false);
      setNoteGenerationStep(0);
    },
    [
      GENERATE_TIMEOUT_MS,
      activeSessionId,
      consultContext,
      onToast,
      patient.id,
      selectedTemplatesForGenerate,
      templateOptions,
    ]
  );

  const handleScribeResult = useCallback(
    (transcript: string) => {
      const clean = transcript.trim();
      if (!clean) {
        onToast('No speech detected.', 'info');
        return;
      }
      const base = lastTranscript.trim();
      const combined = base ? `${base}\n\n${clean}` : clean;
      setLastTranscript(combined);
      setLiveTranscriptSegment('');
      setPendingTranscript(combined);
      setSelectedTemplatesForGenerate([]);
      setActiveTab('notes');
    },
    [lastTranscript, onToast]
  );

  const handleLiveTranscriptUpdate = useCallback((segment: string) => {
    // While recording, keep the live segment separate so we can append it
    // to any existing transcript once the doctor stops the recording.
    setIsLiveStreaming(true);
    setLiveTranscriptSegment(segment);
  }, []);

  const handleLiveStopped = useCallback(
    (transcript: string) => {
      setIsLiveStreaming(false);
      setLiveTranscriptSegment('');

      const clean = transcript.trim();
      if (!clean) {
        return;
      }

      const base = lastTranscript.trim();
      const isResume = notes.length > 0 || !!activeSessionId;

      let combined: string;
      if (isResume && base) {
        const timestamp = new Date().toLocaleString();
        const header = `\n\n[Consultation resumed ${timestamp}]\n\n`;
        combined = `${base}${header}${clean}`;
      } else if (base) {
        combined = `${base}\n\n${clean}`;
      } else {
        combined = clean;
      }

      setLastTranscript(combined);

      if (isResume) {
        setPendingTranscript(null);
        setActiveTab('notes');
        void generateNotesFromTranscript(combined, false);
      } else {
        setPendingTranscript(combined);
        setSelectedTemplatesForGenerate([]);
        setActiveTab('notes');
      }
    },
    [activeSessionId, generateNotesFromTranscript, lastTranscript, notes.length]
  );

  const toggleTemplateForGenerate = useCallback((id: string) => {
    setSelectedTemplatesForGenerate((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);
  const NOTE_GENERATION_STEPS = [
    'Looking at context',
    'Decoding transcript',
    'Analyzing transcript',
    'Perfecting your style',
    'Making your notes',
  ] as const;

  const handleGenerateFromTemplates = useCallback(async () => {
    const sourceTranscript = (pendingTranscript ?? lastTranscript) || '';
    const isAddNote = showAddNoteModal;
    await generateNotesFromTranscript(sourceTranscript, isAddNote);
  }, [generateNotesFromTranscript, lastTranscript, pendingTranscript, showAddNoteModal]);

  // Autosave: every 30s mark dirty notes as saved (client-side only; no DOCX generation)
  useEffect(() => {
    if (notes.length === 0) return;
    const interval = setInterval(() => {
      setNotes(prev => {
        const hasDirty = prev.some(n => n.dirty);
        if (!hasDirty) return prev;
        return prev.map(note => note.dirty ? { ...note, lastSavedAt: new Date().toISOString(), dirty: false } : note);
      });
    }, 30_000);
    return () => clearInterval(interval);
  }, [notes.length]);

  // Chat handler — uses streaming for progressive response display
  const handleSendChat = async () => {
    const question = chatInput.trim();
    if (!question || chatLoading) return;

    const userMessage: ChatMessage = { role: 'user', content: question, timestamp: Date.now() };
    setChatMessages(prev => [...prev, userMessage]);
    setChatInput("");
    setChatLoading(true);
    setChatLongWait(false);

    if (chatLongWaitTimerRef.current) clearTimeout(chatLongWaitTimerRef.current);
    chatLongWaitTimerRef.current = setTimeout(() => setChatLongWait(true), 8000);

    const assistantPlaceholder: ChatMessage = { role: 'assistant', content: '', timestamp: Date.now() };
    setChatMessages(prev => [...prev, assistantPlaceholder]);

    try {
      await askHaloStream(
        patient.id,
        question,
        chatMessagesRef.current,
        (chunk) => {
          setChatMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') {
              return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
            }
            return prev;
          });
        }
      );
    } catch (err) {
      setChatMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.content === '') {
          return [...prev.slice(0, -1), {
            ...last,
            content: 'Sorry, I encountered an error. Please try again.',
          }];
        }
        return prev;
      });
      onToast(getErrorMessage(err), 'error');
    } finally {
      setChatLoading(false);
      setChatLongWait(false);
      if (chatLongWaitTimerRef.current) {
        clearTimeout(chatLongWaitTimerRef.current);
        chatLongWaitTimerRef.current = null;
      }
    }
  };

  // If opened from a calendar booking, generate a light prep note and start in the editor
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!calendarPrepEvent || calendarPrepEvent.patientId !== patient.id) return;
      if (notes.length > 0) return; // don’t overwrite existing work

      setActiveTab('notes');
      setStatus(AppStatus.LOADING);
      try {
        const { prepNote } = await generatePrepNote(patient.id, patient.name);
        if (cancelled) return;
        const title = calendarPrepEvent.title || `Prep for ${patient.name}`;
        const newNote: HaloNote = {
          noteId: `prep-${Date.now()}`,
          title,
          content: prepNote,
          template_id: templateId,
          lastSavedAt: new Date().toISOString(),
          dirty: true,
        };
        setNotes([newNote]);
        setActiveNoteIndex(0);
        setUploadMessage(null);
      } catch (err) {
        if (!cancelled) onToast(getErrorMessage(err), 'error');
      }
      if (!cancelled) setStatus(AppStatus.IDLE);
    };
    run();
    return () => { cancelled = true; };
  }, [calendarPrepEvent?.id, calendarPrepEvent?.patientId, calendarPrepEvent?.title, patient.id, patient.name, templateId, notes.length, onToast]);

  // Create folder handler
  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      await createFolder(currentFolderId, name);
      setShowCreateFolderModal(false);
      setNewFolderName("");
      await loadFolderContents(currentFolderId);
      onToast(`Folder "${name}" created.`, 'success');
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
    }
  };

  const startEditPatient = () => {
    setEditName(patient.name);
    setEditDob(patient.dob);
    setEditSex(patient.sex || 'M');
    setEditingPatient(true);
  };

  const savePatientEdit = async () => {
    if (!editName.trim() || !editDob) return;
    try {
      await updatePatient(patient.id, { name: editName, dob: editDob, sex: editSex });
      setEditingPatient(false);
      onDataChange();
      onToast('Patient details updated.', 'success');
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
    }
  };

  const startEditFile = (file: DriveFile) => {
    setEditingFile(file);
    setEditFileName(file.name);
  };

  const saveFileEdit = async () => {
    if (!editingFile || !editFileName.trim()) return;
    try {
      await updateFileMetadata(patient.id, editingFile.id, editFileName);

      const crumbIndex = breadcrumbs.findIndex(b => b.id === editingFile.id);
      if (crumbIndex >= 0) {
        setBreadcrumbs(prev => prev.map((b, i) => i === crumbIndex ? { ...b, name: editFileName } : b));
      }

      setEditingFile(null);
      await loadFolderContents(currentFolderId);
      onDataChange();
      onToast('Item renamed.', 'success');
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
    }
  };

  const confirmDeleteFile = async () => {
    if (!fileToDelete) return;
    try {
      await deleteFile(fileToDelete.id);
      setFileToDelete(null);
      await loadFolderContents(currentFolderId);
      onToast('File moved to trash.', 'success');
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
    }
  };

  const hasAiContent = alerts.length > 0 || summary.length > 0;

  const handleGenerateAiInsights = useCallback(async () => {
    if (aiLoading) return;
    if (!files.length) {
      onToast('No patient files available to analyze yet.', 'info');
      return;
    }
    setAiLoading(true);
    try {
      const currentFiles = [...files];
      const summaryResult = await generatePatientSummary(patient.name, currentFiles, patient.id);
      setSummary(summaryResult);

      const labFiles = currentFiles.filter(f =>
        f.name.toLowerCase().includes('lab') ||
        f.name.toLowerCase().includes('blood') ||
        f.name.toLowerCase().includes('result')
      );
      if (labFiles.length > 0) {
        const labContext = labFiles.map(f => f.name).join(', ');
        const alertsResult = await extractLabAlerts(`Patient files indicate lab results: ${labContext}`);
        setAlerts(alertsResult);
      } else {
        setAlerts([]);
      }
      setShowAiPanel(true);
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
    }
    setAiLoading(false);
  }, [aiLoading, files, patient.name, patient.id, onToast]);

  const handleCopyTranscript = useCallback(() => {
    const text = currentTranscript.trim();
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setDidCopyTranscript(true);
          setTimeout(() => setDidCopyTranscript(false), 1500);
        })
        .catch(() => {
          onToast('Unable to copy transcript to clipboard.', 'error');
        });
    } else {
      onToast('Copy is not supported in this browser.', 'error');
    }
  }, [currentTranscript, onToast]);

  const handleLoadSession = useCallback(
    (session: ScribeSession | null) => {
      // When selecting "Start new session" or clearing, reset to a blank editor state.
      if (!session) {
        setActiveSessionId(null);
        setLastTranscript('');
        setLiveTranscriptSegment('');
        setPendingTranscript(null);
        setShowAddNoteModal(false);
        setConsultContext('');
        setNotes([]);
        setConsultSubTab(0);
        setActiveTab('notes');
        setPendingLongitudinalImage(null);
        setSelectedTemplatesForGenerate([]);
        return;
      }

      // Load the exact data that was stored for this session (no automatic regeneration).
      setActiveSessionId(session.id);
      const tx = session.transcript || '';
      setLastTranscript(tx);
      setLiveTranscriptSegment('');
      setPendingTranscript(null);
      setShowAddNoteModal(false);
      setConsultContext(session.context || '');

      if (Array.isArray(session.templates) && session.templates.length > 0) {
        setSelectedTemplatesForGenerate(session.templates.filter((t): t is string => typeof t === 'string' && !!t.trim()));
      } else {
        setSelectedTemplatesForGenerate([]);
      }
      setPendingLongitudinalImage(null);

      if (session.notes && session.notes.length > 0) {
        const restoredNotes: HaloNote[] = session.notes.map((n) => ({
          noteId: n.noteId,
          title: n.title,
          content: n.content,
          ...(n.raw !== undefined ? { raw: n.raw } : {}),
          ...(n.fields && n.fields.length > 0 ? { fields: n.fields } : {}),
          template_id: n.template_id,
          lastSavedAt: new Date().toISOString(),
          dirty: false,
        }));
        setNotes(restoredNotes);
        setActiveNoteIndex(0);
        setConsultSubTab(0);
      } else {
        setNotes([]);
        setConsultSubTab(0);
      }

      setActiveTab('notes');
    },
    []
  );

  useEffect(() => {
    if (!isGeneratingNotes) {
      setNoteGenerationStep(0);
      return;
    }
    setNoteGenerationStep(0);
    const lastIndex = NOTE_GENERATION_STEPS.length - 1;
    const stepMs = 2800;
    const id = setInterval(() => {
      setNoteGenerationStep(prev => {
        if (prev >= lastIndex) return prev;
        return prev + 1;
      });
    }, stepMs);
    return () => clearInterval(id);
  }, [isGeneratingNotes]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-halo-bg relative w-full">
      {/* Header — mobile: single compact row (back + actions); desktop: unchanged title left / actions right */}
      <div className="border-b border-halo-border px-3 md:px-6 py-2.5 flex flex-row flex-wrap items-center gap-x-2 gap-y-2 bg-halo-card shadow-[var(--shadow-halo-soft)] z-10 md:flex-nowrap md:items-center md:justify-between md:gap-4">
        {/* Mobile: shrink-wrap group (back + actions sit tight); Desktop: title takes remaining space */}
        <div className="flex min-w-0 shrink-0 items-center gap-2 md:min-w-0 md:flex-1">
          <button
            type="button"
            onClick={onBack}
            className="md:hidden shrink-0 p-1.5 text-slate-500 hover:text-teal-500 rounded-full"
            aria-label="Back"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="group relative hidden min-w-0 md:block md:flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h1 className="text-2xl font-semibold text-halo-text tracking-tight leading-snug truncate">{patient.name}</h1>
              <button onClick={startEditPatient} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-halo-text-secondary hover:text-halo-primary hover:bg-halo-primary-muted rounded-full shrink-0">
                <Pencil size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-row flex-wrap items-center justify-end gap-2 md:shrink-0">
          {status === AppStatus.UPLOADING ? (
            <div className="w-full md:w-44">
              <div className="mb-0.5 flex justify-between text-[10px] font-semibold text-teal-700/90">
                <span>Uploading</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-1.5 rounded-full bg-teal-500/90 transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-row flex-wrap items-center justify-end gap-2">
                <HeaderConsultationRecorder
                  onLiveTranscriptUpdate={handleLiveTranscriptUpdate}
                  onLiveStopped={handleLiveStopped}
                  onError={(msg: string) => onToast(msg, 'error')}
                />
                <button
                  type="button"
                  onClick={handleGenerateAiInsights}
                  disabled={aiLoading || status === AppStatus.LOADING}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-teal-500/20 bg-teal-500/10 px-3 py-1.5 text-xs font-semibold text-teal-800 transition hover:bg-teal-500/14 disabled:opacity-50"
                >
                  {aiLoading ? '…' : 'AI insights'}
                </button>
                {hasAiContent ? (
                  <button
                    type="button"
                    onClick={() => setShowAiPanel((prev) => !prev)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2 py-1.5 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-50"
                  >
                    {showAiPanel ? 'Hide' : 'Show'}
                  </button>
                ) : null}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileUpload}
                accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
              />
              <input
                ref={contextUploadInputRef}
                type="file"
                className="hidden"
                accept="image/*,application/pdf,.pdf,.doc,.docx,.txt,.csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
                onChange={(ev) => void handleConsultContextFileUpload(ev)}
              />
              <input
                ref={contextCameraInputRef}
                type="file"
                className="hidden"
                accept="image/*"
                capture="environment"
                onChange={(ev) => void handleConsultContextFileUpload(ev)}
              />
              <input
                ref={contextPhotoInputRef}
                type="file"
                className="hidden"
                accept="image/*"
                onChange={(ev) => void handleConsultContextFileUpload(ev)}
              />
            </>
          )}
          {uploadMessage && status !== AppStatus.UPLOADING && (
            <div className="flex w-full items-center gap-1.5 rounded-md border border-teal-500/15 bg-teal-500/8 px-2 py-1 text-[10px] font-medium text-teal-800 sm:w-auto">
              <CheckCircle2 className="h-3 w-3 shrink-0" /> <span className="truncate">{uploadMessage}</span>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-halo-bg p-3 md:p-4">
        <div className="mx-auto flex w-full max-w-[min(96rem,100%)] min-h-0 flex-1 flex-col">
          {/* AI Panel */}
          {activeTab === 'overview' && hasAiContent && showAiPanel && (
            <div className="mb-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">AI Insights</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleGenerateAiInsights}
                    disabled={aiLoading}
                    className="text-xs font-medium text-teal-600 hover:text-teal-700 flex items-center gap-1 transition-colors px-2 py-1 rounded hover:bg-teal-50 disabled:opacity-50"
                  >
                    {aiLoading ? 'Updating…' : 'Refresh'}
                  </button>
                  <button
                    onClick={() => setShowAiPanel(false)}
                    className="text-xs font-medium text-slate-400 hover:text-slate-600 flex items-center gap-1 transition-colors px-2 py-1 rounded hover:bg-slate-100"
                  >
                    <X size={12} /> Hide
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <SmartSummary summary={summary} loading={aiLoading} />
                {alerts.length > 0 && (
                  <div>
                    <LabAlerts alerts={alerts} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* CTA to generate insights (only when not yet generated) */}
          {/* Tabs */}
          <div className="mt-2 flex flex-wrap items-end justify-between gap-x-3 gap-y-1 border-b border-slate-200/70 mb-4">
            <div className="flex gap-2 md:gap-4 overflow-x-auto items-center min-w-0">
              <button onClick={() => setActiveTab('overview')} className={`py-2 text-[11px] md:text-xs font-bold border-b-2 transition-colors uppercase tracking-wide whitespace-nowrap ${activeTab === 'overview' ? 'border-halo-primary text-halo-text' : 'border-transparent text-halo-muted hover:text-halo-text-secondary'}`}>Files</button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('notes');
                }}
                className={`py-2 text-[11px] md:text-xs font-bold border-b-2 transition-colors uppercase tracking-wide whitespace-nowrap ${
                  activeTab === 'notes'
                    ? 'border-halo-primary text-halo-text'
                    : 'border-transparent text-halo-muted hover:text-halo-text-secondary'
                }`}
              >
                Editor
              </button>
              <button onClick={() => setActiveTab('chat')} className={`py-2 text-[11px] md:text-xs font-bold border-b-2 transition-colors uppercase tracking-wide whitespace-nowrap flex items-center gap-1.5 ${activeTab === 'chat' ? 'border-halo-primary text-halo-text' : 'border-transparent text-halo-muted hover:text-halo-text-secondary'}`}>
              <MessageCircle size={14} className="shrink-0" /> Ask HALO
              </button>
              <button onClick={() => setActiveTab('sessions')} className={`py-2 text-[11px] md:text-xs font-bold border-b-2 transition-colors uppercase tracking-wide whitespace-nowrap flex items-center gap-1.5 ${activeTab === 'sessions' ? 'border-halo-primary text-halo-text' : 'border-transparent text-halo-muted hover:text-halo-text-secondary'}`}>
              <History size={14} className="shrink-0" /> Sessions
              </button>
              {patient.webUrl ? (
                <a
                  href={patient.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mb-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-[10px] border border-halo-border bg-halo-section text-[10px] font-semibold text-halo-text-secondary hover:text-halo-primary hover:border-halo-primary/40 transition-colors whitespace-nowrap shrink-0"
                  title="Open cloud folder (Drive / OneDrive)"
                >
                  <FolderOpen className="w-3 h-3 opacity-90" aria-hidden />
                  Folder
                  <ExternalLink className="w-2.5 h-2.5 opacity-70" aria-hidden />
                </a>
              ) : null}
            </div>
            {(() => {
              const hasSessionContent =
                Boolean(activeSessionId) ||
                notes.length > 0 ||
                Boolean(lastTranscript?.trim()) ||
                Boolean(consultContext?.trim()) ||
                Boolean(pendingTranscript?.trim());
              if (!hasSessionContent) return null;
              return (
                <button
                  type="button"
                  onClick={() => handleLoadSession(null)}
                  className="mb-0.5 text-[10px] font-semibold text-halo-text flex items-center gap-1 px-2 py-0.5 rounded-[10px] border border-halo-border bg-halo-card hover:bg-halo-primary-muted transition whitespace-nowrap"
                >
                  <Plus className="w-3 h-3" /> New session
                </button>
              );
            })()}
          </div>

          {activeTab === 'notes' && showContextUploadChooser ? (
            <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 p-3 md:items-center">
              <div
                className="absolute inset-0"
                onClick={() => setShowContextUploadChooser(false)}
                role="button"
                tabIndex={0}
              />
              <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => setShowContextUploadChooser(false)}
                    className="p-2 rounded-lg text-slate-400 hover:bg-slate-100"
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="p-3 space-y-2">
                  <button
                    type="button"
                    disabled={contextEnrichBusy}
                    onClick={() => {
                      setShowContextUploadChooser(false);
                      contextCameraInputRef.current?.click();
                    }}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-teal-600/20 disabled:opacity-50"
                  >
                    <Camera className="w-4 h-4" /> Take photo
                  </button>
                  <button
                    type="button"
                    disabled={contextEnrichBusy}
                    onClick={() => {
                      setShowContextUploadChooser(false);
                      contextPhotoInputRef.current?.click();
                    }}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Upload className="w-4 h-4" /> Choose photo
                  </button>
                  <button
                    type="button"
                    disabled={contextEnrichBusy}
                    onClick={() => {
                      setShowContextUploadChooser(false);
                      contextUploadInputRef.current?.click();
                    }}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <CloudUpload className="w-4 h-4" /> Browse files
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === 'overview' ? (
            <FileBrowser
              files={files}
              status={status}
              breadcrumbs={breadcrumbs}
              onNavigateToFolder={navigateToFolder}
              onNavigateBack={navigateBack}
              onNavigateToBreadcrumb={navigateToBreadcrumb}
              onStartEditFile={startEditFile}
              onDeleteFile={setFileToDelete}
              onViewFile={setViewingFile}
              onCreateFolder={() => setShowCreateFolderModal(true)}
              onPatientUpload={openUploadPicker}
              uploadBusy={status === AppStatus.UPLOADING}
            />
          ) : activeTab === 'sessions' ? (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/80">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Previous Sessions
                </span>
              </div>
              <div className="p-4">
                {sessionsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 text-teal-500 animate-spin" />
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="py-12" aria-hidden />
                ) : (
                  <ul className="space-y-2">
                    {sessions.map((session) => {
                      const createdDate = session.createdAt ? new Date(session.createdAt) : null;
                      const formattedDate = createdDate
                        ? createdDate.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
                        : 'Unknown date';
                      const mainComplaint =
                        session.mainComplaint?.trim() ||
                        (session.notes && session.notes.length > 0
                          ? extractMainComplaint(session.notes[0].content)
                          : '');
                      const listTitle = mainComplaint
                        ? `${formattedDate}, ${mainComplaint}`
                        : formattedDate;
                      const hasNotes = session.notes && session.notes.length > 0;
                      const labelTime = createdDate
                        ? createdDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                        : '';
                      return (
                        <li key={session.id}>
                          <button
                            type="button"
                            onClick={() => handleLoadSession(session)}
                            className="w-full flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-slate-200 bg-white text-left hover:bg-teal-50 hover:border-teal-200 transition-colors group"
                          >
                            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                              <span className="font-medium text-slate-800 truncate">{listTitle}</span>
                              <span className="text-xs text-slate-500">
                                {labelTime ? `${labelTime}` : ''}
                                {hasNotes ? ` • ${session.notes!.length} note(s)` : ' • transcript only'}
                              </span>
                            </div>
                            <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-teal-600 shrink-0" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          ) : activeTab === 'notes' ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Editor workspace: fills remaining viewport height */}
              <div className="relative flex min-h-[min(60vh,calc(100dvh-220px))] flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-[0_4px_24px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/70">
                {pendingTranscript ? (
                  <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-slate-50/90 p-4">
                    <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">{pendingTranscript}</p>
                  </div>
                ) : (
                  <>
                    <div className="flex w-full min-w-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/80 px-3 py-2.5">
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        {notes.length > 0 ? (
                          <>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Notes</span>
                            <div className="hidden h-4 w-px bg-slate-200 sm:block" aria-hidden />
                            {notes.map((note, i) => (
                              <button
                                key={note.noteId}
                                type="button"
                                onClick={() => {
                                  setConsultSubTab(i);
                                  setActiveNoteIndex(i);
                                }}
                                className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-semibold transition-all ${
                                  consultSubTab === i
                                    ? 'bg-teal-600 text-white shadow-sm shadow-teal-600/20'
                                    : 'bg-white text-slate-600 ring-1 ring-slate-200/80 hover:ring-teal-300/60'
                                }`}
                              >
                                {note.title || `Note ${i + 1}`}
                              </button>
                            ))}
                          </>
                        ) : null}
                        <div
                          className="flex flex-wrap items-center gap-1.5"
                          role="tablist"
                          aria-label="Editor view"
                        >
                          <button
                            type="button"
                            role="tab"
                            aria-selected={editorPanelView === 'noteFields'}
                            onClick={() => setEditorPanelView('noteFields')}
                            className={`inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-semibold shadow-[var(--shadow-halo-soft)] transition-all ${
                              editorPanelView === 'noteFields'
                                ? 'bg-white text-teal-900 ring-2 ring-teal-500/45'
                                : 'bg-white/90 text-slate-600 ring-1 ring-slate-200/80 hover:bg-white hover:ring-teal-300/50'
                            }`}
                          >
                            <FileText className="size-3.5 shrink-0" aria-hidden />
                            Note fields
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={editorPanelView === 'transcription'}
                            onClick={() => setEditorPanelView('transcription')}
                            className={`inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-semibold shadow-[var(--shadow-halo-soft)] transition-all ${
                              editorPanelView === 'transcription'
                                ? 'bg-white text-teal-900 ring-2 ring-teal-500/45'
                                : 'bg-white/90 text-slate-600 ring-1 ring-slate-200/80 hover:bg-white hover:ring-teal-300/50'
                            }`}
                          >
                            <Captions className="size-3.5 shrink-0" aria-hidden />
                            Transcription
                          </button>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={editorPanelView === 'smartContext'}
                          id="editor-smart-context-tab"
                          aria-controls="editor-smart-context-panel"
                          onClick={() => setEditorPanelView('smartContext')}
                          className={`inline-flex items-center gap-2 rounded-[10px] px-3 py-1.5 text-xs font-semibold text-white shadow-[var(--shadow-halo-soft)] transition-all bg-halo-primary hover:bg-halo-primary-hover ${
                            editorPanelView === 'smartContext'
                              ? 'ring-2 ring-white/90 ring-offset-2 ring-offset-slate-100'
                              : ''
                          }`}
                        >
                          <Layers className="size-3.5 shrink-0 text-white" aria-hidden />
                          Smart context
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddNoteModal(true);
                            setSelectedTemplatesForGenerate([]);
                          }}
                          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-teal-700 ring-1 ring-teal-200/80 bg-teal-50/80 hover:bg-teal-100/90 transition"
                          title="Add note"
                          aria-label="Add note"
                        >
                          <Plus className="size-4" />
                        </button>
                      </div>
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col bg-slate-100/50 p-2 md:p-3">
                      {editorPanelView === 'noteFields' ? (
                        <div className={`${EDITOR_VIEW_SHELL} min-h-[240px] lg:min-h-0`}>
                          <div className={EDITOR_VIEW_HEADER}>
                            <span className={EDITOR_VIEW_TITLE}>Note fields</span>
                          </div>
                          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
                            {typeof consultSubTab === 'number' && notes[consultSubTab] ? (
                              <NoteEditor
                                notes={notes}
                                activeIndex={consultSubTab}
                                onActiveIndexChange={(i) => {
                                  setConsultSubTab(i);
                                  setActiveNoteIndex(i);
                                }}
                                onNoteChange={handleNoteChange}
                                onRegeneratePdf={handleRegeneratePdf}
                                status={status}
                                templateId={templateId}
                                templateOptions={templateOptions}
                                onTemplateChange={setTemplateId}
                                onSaveAsDocx={handleSaveAsDocx}
                                onSaveAll={handleSaveAll}
                                onEmail={handleEmail}
                                savingNoteIndex={savingNoteIndex}
                                regeneratingPdfIndex={regeneratingPdfIndex}
                                showNoteTabs={false}
                              />
                            ) : (
                              <div className="flex min-h-0 flex-1 bg-slate-50/80" aria-hidden />
                            )}
                          </div>
                        </div>
                      ) : editorPanelView === 'transcription' ? (
                        <div className={EDITOR_VIEW_SHELL}>
                          <div className={EDITOR_VIEW_HEADER}>
                            <div className="flex items-center gap-2">
                              <span className={EDITOR_VIEW_TITLE}>Transcription</span>
                              {isLiveStreaming ? (
                                <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-teal-800">
                                  Live
                                </span>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={handleCopyTranscript}
                              disabled={!currentTranscript.trim()}
                              className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200/80 hover:bg-slate-50 disabled:opacity-40"
                            >
                              {didCopyTranscript ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                          <div className="min-h-0 flex-1 overflow-auto bg-white p-3 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
                            {isGeneratingNotes ? (
                              <span className="inline-flex items-center gap-2 text-slate-500">
                                <Loader2 className="size-4 animate-spin text-teal-600" aria-hidden />
                              </span>
                            ) : (
                              currentTranscript
                            )}
                          </div>
                        </div>
                      ) : (
                        <div
                          id="editor-smart-context-panel"
                          role="tabpanel"
                          aria-labelledby="editor-smart-context-tab"
                          className={EDITOR_VIEW_SHELL}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className={EDITOR_VIEW_HEADER}>
                            <span className={EDITOR_VIEW_TITLE}>Smart context</span>
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              <button
                                type="button"
                                disabled={contextEnrichBusy}
                                onClick={handleContextUploadClick}
                                className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200/80 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                              >
                                {contextEnrichBusy ? <Loader2 className="size-3 animate-spin" /> : <CloudUpload className="size-3" />}
                                {contextEnrichBusy ? '…' : 'Upload'}
                              </button>
                              <button
                                type="button"
                                onClick={openContextDrivePicker}
                                className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200/80 shadow-sm hover:bg-slate-50"
                              >
                                <FolderOpen className="size-3" /> Drive
                              </button>
                              {consultContext.trim() ? (
                                <button
                                  type="button"
                                  disabled={contextSaveBusy || contextEnrichBusy}
                                  onClick={() => void handleContextDoneSave()}
                                  title="Append to cumulative history PDF in Patient Notes"
                                  className={CLINICAL_BTN_PRIMARY}
                                >
                                  {contextSaveBusy ? (
                                    <>
                                      <Loader2 className="size-3 animate-spin" /> …
                                    </>
                                  ) : (
                                    'Save to record'
                                  )}
                                </button>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex min-h-0 flex-1 flex-col bg-white p-3">
                            <textarea
                              value={consultContext}
                              onChange={(e) => setConsultContext(e.target.value)}
                              className="min-h-0 w-full flex-1 resize-y rounded-lg border border-slate-200/90 bg-slate-50/50 px-3 py-2.5 text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-teal-400/60 focus:outline-none focus:ring-2 focus:ring-teal-500/20 md:min-h-[12rem]"
                              placeholder="Paste or upload context for this consultation…"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Template choice modal — when new transcript or "+" add note; hide while generating */}
              {(pendingTranscript != null || showAddNoteModal) && !isGeneratingNotes && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 backdrop-blur-[2px] p-4">
                  <div
                    className="bg-white rounded-xl shadow-xl border border-slate-200/90 w-full max-w-md overflow-hidden"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="template-modal-title"
                  >
                    <div className="px-4 pt-3 pb-2 border-b border-halo-border">
                      <h3 id="template-modal-title" className="text-sm font-semibold text-halo-text">
                        {showAddNoteModal ? 'Add note' : 'Templates'}
                      </h3>
                    </div>
                    <div className="px-4 pb-4 pt-3 space-y-3">
                      {/* Hospital toggle */}
                      <div className="flex rounded-lg bg-slate-100/90 p-0.5 gap-0.5">
                        {HOSPITALS.map(h => (
                          <button
                            key={h.key}
                            type="button"
                            onClick={() => {
                              setSelectedHospital(h.key);
                              setSelectedTemplatesForGenerate([]);
                              setTemplateSearch('');
                            }}
                            className={`flex-1 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                              selectedHospital === h.key
                                ? 'bg-white text-teal-800 shadow-sm border border-slate-200/60'
                                : 'text-slate-500 hover:text-slate-700'
                            }`}
                          >
                            {h.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={templateSearch}
                          onChange={e => setTemplateSearch(e.target.value)}
                          className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200/90 bg-slate-50/80 text-xs text-slate-800 focus:bg-white focus:border-teal-500/40 focus:ring-1 focus:ring-teal-500/15 outline-none"
                        />
                      </div>
                      <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200/80 bg-slate-50/40 divide-y divide-slate-100/90">
                        {(selectedHospital === 'louis_leipoldt' ? templateOptions : activeHospitalConfig.templates as Array<{ id: string; name: string }>)
                          .filter(t => {
                            if (!templateSearch.trim()) return true;
                            const q = templateSearch.toLowerCase();
                            return t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q);
                          })
                          .map(t => {
                            const selected = selectedTemplatesForGenerate.includes(t.id);
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => toggleTemplateForGenerate(t.id)}
                                className={`w-full px-3 py-2 flex items-center justify-between text-xs font-medium transition-all ${
                                  selected
                                    ? 'bg-white text-teal-900'
                                    : 'bg-transparent text-slate-700 hover:bg-white/90'
                                }`}
                              >
                                <span className="flex items-center gap-2 min-w-0">
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                      selected ? 'bg-teal-500' : 'bg-slate-300'
                                    }`}
                                  />
                                  <span className="truncate">{t.name}</span>
                                </span>
                                {selected && (
                                  <span className="text-[9px] font-semibold text-halo-primary uppercase tracking-wide shrink-0">
                                    Selected
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        {(selectedHospital === 'louis_leipoldt' ? templateOptions : activeHospitalConfig.templates).length === 0 && (
                          <div className="px-4 py-6 text-xs text-slate-500 text-center">
                            No templates available. HALO will fall back to the default clinical note.
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={handleGenerateFromTemplates}
                          disabled={selectedTemplatesForGenerate.length === 0 || isGeneratingNotes}
                          className="px-2.5 py-1 rounded-[10px] text-[11px] font-semibold bg-halo-primary text-white hover:bg-halo-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition shadow-[var(--shadow-halo-soft)]"
                        >
                          {isGeneratingNotes ? '…' : 'Continue'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setPendingTranscript(null); setShowAddNoteModal(false); }}
                          className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-white border border-slate-200/90 text-slate-600 hover:bg-slate-50 transition"
                        >
                          Cancel
                        </button>
                      </div>
                      <div className="mt-2 pt-2 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddNoteModal(false);
                            setShowCustomAiNoteModal(true);
                            setCustomAiPrompt('');
                          }}
                          className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-semibold bg-white border border-teal-500/25 text-teal-800 hover:bg-teal-500/6 transition"
                        >
                          <MessageCircle className="w-3.5 h-3.5" /> Custom note
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <PatientChat
              patientName={patient.name}
              chatMessages={chatMessages}
              chatInput={chatInput}
              onChatInputChange={setChatInput}
              chatLoading={chatLoading}
              chatLongWait={chatLongWait}
              onSendChat={handleSendChat}
            />
          )}
        </div>
      </div>

      {/* EDIT PATIENT MODAL */}
      {editingPatient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm m-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800">Edit Patient Details</h3>
              <button onClick={() => setEditingPatient(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-1.5">Full Name</label>
                <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none transition" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-1.5">Date of Birth</label>
                <input type="date" value={editDob} onChange={e => setEditDob(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none transition" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-1.5">Sex</label>
                <div className="flex bg-slate-100 p-1 rounded-xl">
                  <button onClick={() => setEditSex('M')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${editSex === 'M' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>M</button>
                  <button onClick={() => setEditSex('F')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${editSex === 'F' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>F</button>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditingPatient(false)} className="flex-1 px-4 py-3 rounded-xl font-medium text-slate-600 hover:bg-slate-100 transition">Cancel</button>
                <button onClick={savePatientEdit} className="flex-1 bg-teal-600 hover:bg-teal-700 text-white px-4 py-3 rounded-xl font-bold shadow-lg shadow-teal-600/20 transition">Save Changes</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RENAME MODAL */}
      {editingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm m-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800">
                Rename {isFolder(editingFile) ? 'Folder' : 'File'}
              </h3>
              <button onClick={() => setEditingFile(null)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-1.5">Name</label>
                <input type="text" value={editFileName} onChange={e => setEditFileName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none transition" />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditingFile(null)} className="flex-1 px-4 py-3 rounded-xl font-medium text-slate-600 hover:bg-slate-100 transition">Cancel</button>
                <button onClick={saveFileEdit} className="flex-1 bg-teal-600 hover:bg-teal-700 text-white px-4 py-3 rounded-xl font-bold shadow-lg shadow-teal-600/20 transition">Save Changes</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DELETE FILE CONFIRMATION MODAL */}
      {fileToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 m-4 border-2 border-rose-100">
            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-14 h-14 bg-rose-50 rounded-full flex items-center justify-center mb-3 text-rose-500">
                <Trash2 size={28} />
              </div>
              <h3 className="text-lg font-bold text-slate-800">Delete File?</h3>
              <p className="text-slate-500 mt-2 text-sm px-4">
                Move <span className="font-bold text-slate-700">{fileToDelete.name}</span> to trash?
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setFileToDelete(null)} className="flex-1 px-4 py-3 rounded-xl font-medium text-slate-600 hover:bg-slate-100 transition">Cancel</button>
              <button onClick={confirmDeleteFile} className="flex-1 bg-rose-500 hover:bg-rose-600 text-white px-4 py-3 rounded-xl font-bold shadow-lg shadow-rose-500/20 transition">Delete</button>
            </div>
          </div>
        </div>
      )}

      {status === AppStatus.ANALYZING && (
        <div className="fixed inset-0 bg-white/90 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-slate-200 rounded-full"></div>
            <div className="absolute top-0 left-0 w-16 h-16 border-4 border-teal-500 rounded-full border-t-transparent animate-spin"></div>
          </div>
          <p className="text-teal-900 font-bold text-lg mt-6">HALO is analyzing...</p>
        </div>
      )}

      {status === AppStatus.SAVING && (
        <div className="fixed inset-0 bg-white/90 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-slate-200 rounded-full"></div>
            <div className="absolute top-0 left-0 w-16 h-16 border-4 border-teal-500 rounded-full border-t-transparent animate-spin"></div>
          </div>
          <p className="text-teal-900 font-bold text-lg mt-6">Saving note as DOCX...</p>
        </div>
      )}

      {/* NOTE GENERATION OVERLAY */}
      {isGeneratingNotes && (
        <div className="fixed inset-0 bg-slate-900/35 backdrop-blur-[1px] z-40 flex items-center justify-center pointer-events-none">
          <div className="bg-white/95 border border-slate-200 rounded-2xl shadow-xl px-6 py-5 flex flex-col items-center gap-3 max-w-sm text-center pointer-events-auto">
            <div className="relative mb-1">
              <div className="w-10 h-10 rounded-full border-2 border-slate-200" />
              <div className="absolute inset-0 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
            </div>
            <p className="text-sm font-semibold text-slate-800">HALO is preparing your notes…</p>
            <div className="mt-1 w-full max-w-xs space-y-2">
              {NOTE_GENERATION_STEPS.map((label, index) => {
                const active = index === noteGenerationStep;
                return (
                  <div
                    // eslint-disable-next-line react/no-array-index-key
                    key={index}
                    className="flex items-center gap-2 text-left"
                  >
                    <div
                      className={`w-2 h-2 rounded-full ${
                        active ? 'bg-teal-500 animate-pulse' : 'bg-slate-200'
                      }`}
                    />
                    <span
                      className={`text-xs ${
                        active ? 'font-semibold text-slate-900' : 'text-slate-400'
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* UPLOAD DESTINATION PICKER MODAL */}
      {showUploadPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm m-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800">Upload Destination</h3>
              <button onClick={() => setShowUploadPicker(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition"><X size={20} /></button>
            </div>
            <div className="mb-3">
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Uploading to:</label>
              <div className="flex items-center gap-2 bg-teal-50 border border-teal-100 px-3 py-2 rounded-lg">
                <FolderOpen size={16} className="text-teal-600 shrink-0" />
                <span className="text-sm font-semibold text-teal-700 truncate">{uploadTargetLabel}</span>
              </div>
            </div>
            <div className="mb-4">
              {uploadPickerLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 size={20} className="text-teal-500 animate-spin" />
                </div>
              ) : uploadPickerFolders.length > 0 ? (
                <div className="max-h-48 overflow-y-auto space-y-1.5 border border-slate-100 rounded-lg p-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1 mb-1">Or choose a subfolder:</p>
                  {uploadPickerFolders.map(folder => (
                    <button
                      key={folder.id}
                      onClick={() => selectUploadFolder(folder)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm font-medium text-slate-700 hover:bg-teal-50 hover:text-teal-700 transition-colors"
                    >
                      <FolderOpen size={15} className="text-teal-500 shrink-0" />
                      <span className="truncate">{folder.name}</span>
                      <ChevronRight size={14} className="text-slate-300 ml-auto shrink-0" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 text-center py-3">No subfolders available</p>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowUploadPicker(false)} className="flex-1 px-4 py-3 rounded-xl font-medium text-slate-600 hover:bg-slate-100 transition">Cancel</button>
              <button onClick={confirmUploadDestination} className="flex-1 bg-teal-600 hover:bg-teal-700 text-white px-4 py-3 rounded-xl font-bold shadow-lg shadow-teal-600/20 transition flex items-center justify-center gap-2">
                <Upload size={16} /> Choose File
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONTEXT DRIVE PICKER MODAL */}
      {showContextDrivePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <span className="text-sm font-semibold text-slate-800">Add files from storage</span>
              <button
                onClick={() => {
                  setShowContextDrivePicker(false);
                  setContextDriveSelectedIds([]);
                }}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {contextDriveLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 text-teal-500 animate-spin" />
                </div>
              ) : contextDriveFiles.filter((f) => !isFolder(f)).length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-6">
                  No files found in this patient&apos;s storage folder yet.
                </p>
              ) : (
                <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/60 divide-y divide-slate-100">
                  {contextDriveFiles
                    .filter((f) => !isFolder(f))
                    .map((file) => {
                      const checked = contextDriveSelectedIds.includes(file.id);
                      return (
                        <label
                          key={file.id}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-white cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleContextDriveSelection(file.id)}
                            className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                          />
                          <span className="truncate">{file.name}</span>
                        </label>
                      );
                    })}
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex gap-3 justify-end bg-slate-50/80">
              <button
                type="button"
                onClick={() => {
                  setShowContextDrivePicker(false);
                  setContextDriveSelectedIds([]);
                }}
                className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={contextDriveSelectedIds.length === 0}
                onClick={applyContextDriveSelection}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                Add to context
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FILE VIEWER MODAL */}
      {viewingFile && (
        <FileViewer
          fileId={viewingFile.id}
          fileName={viewingFile.name}
          mimeType={viewingFile.mimeType}
          fileUrl={viewingFile.url}
          onClose={() => setViewingFile(null)}
        />
      )}

      {/* CREATE FOLDER MODAL */}
      {showCreateFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm m-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800">New Folder</h3>
              <button onClick={() => { setShowCreateFolderModal(false); setNewFolderName(""); }} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Creating folder in:</label>
                <p className="text-sm font-semibold text-teal-700 bg-teal-50 px-3 py-2 rounded-lg border border-teal-100">
                  {breadcrumbs.map(b => b.name).join(' / ')}
                </p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-1.5">Folder Name</label>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); }}
                  placeholder="e.g. Lab Results, Imaging..."
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none transition"
                  autoFocus
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => { setShowCreateFolderModal(false); setNewFolderName(""); }} className="flex-1 px-4 py-3 rounded-xl font-medium text-slate-600 hover:bg-slate-100 transition">Cancel</button>
                <button onClick={handleCreateFolder} disabled={!newFolderName.trim()} className="flex-1 bg-teal-600 hover:bg-teal-700 text-white px-4 py-3 rounded-xl font-bold shadow-lg shadow-teal-600/20 transition disabled:opacity-50 flex items-center justify-center gap-2">
                  <FolderPlus size={16} /> Create
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM AI NOTE MODAL */}
      {showCustomAiNoteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-slate-800">Ask HALO to draft a custom note</span>
              </div>
              <button
                onClick={() => {
                  setShowCustomAiNoteModal(false);
                  setCustomAiPrompt('');
                }}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <textarea
                value={customAiPrompt}
                onChange={(e) => setCustomAiPrompt(e.target.value)}
                rows={4}
                placeholder="e.g. Draft a medical motivation letter explaining why this patient requires a CT scan based on their current findings and history."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:bg-white focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none resize-none"
              />
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex gap-3 justify-end bg-slate-50/80">
              <button
                type="button"
                onClick={() => {
                  setShowCustomAiNoteModal(false);
                  setCustomAiPrompt('');
                }}
                className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!customAiPrompt.trim() || customAiLoading}
                onClick={async () => {
                  const prompt = customAiPrompt.trim();
                  if (!prompt) return;
                  setCustomAiLoading(true);
                  try {
                    const historyForContext = chatMessagesRef.current || [];
                    const response = await askHalo(patient.id, prompt, historyForContext);
                    const content = response.reply?.trim();
                    if (!content) {
                      onToast('HALO did not return any text for this request. Please try again.', 'error');
                    } else {
                      const title = prompt.length > 60 ? `${prompt.slice(0, 57)}…` : prompt;
                      const newNote: HaloNote = {
                        noteId: `custom-${Date.now()}`,
                        title: title || 'Custom note',
                        content,
                        template_id: 'script',
                        lastSavedAt: new Date().toISOString(),
                        dirty: true,
                      };
                      setNotes((prev) => [...prev, newNote]);
                      const newIndex = notes.length;
                      setActiveNoteIndex(newIndex);
                      setConsultSubTab(newIndex);
                      setShowCustomAiNoteModal(false);
                      setCustomAiPrompt('');
                      onToast('Custom note drafted. You can edit and save it as DOCX.', 'success');
                    }
                  } catch (err) {
                    onToast(getErrorMessage(err), 'error');
                  }
                  setCustomAiLoading(false);
                }}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm flex items-center gap-2"
              >
                {customAiLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Drafting…
                  </>
                ) : (
                  <>
                    <MessageCircle className="w-4 h-4" /> Draft note
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
