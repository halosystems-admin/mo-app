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
  HaloPatientProfile,
} from '../../../shared/types';
import { DEFAULT_HALO_TEMPLATE_ID, HALO_TEMPLATE_OPTIONS, HOSPITALS, type HospitalKey } from '../../../shared/haloTemplates';
import { resolvePracticeHaloUserId } from '../../../shared/resolvePracticeHaloUserId';
import { AppStatus, FOLDER_MIME_TYPE } from '../../../shared/types';

import {
  fetchFiles,
  fetchFilesFirstPage,
  fetchFilesPage,
  fetchFolderContents,
  fetchPatientNotesFiles,
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
  generateNotePreviewPdf,
  saveNoteAsDocx,
  downloadNoteAsDocx,
  generatePrepNote,
  getHaloTemplates,
  describeFile,
  appendLongitudinalContextPdf,
    fetchPatientSessions,
    savePatientSession,
    getPatientHaloProfile,
    generatePatientLetterDocx,
    uploadPatientHaloProfile,
  } from '../services/api';
import { uploadAndExtractSmartContext } from '../services/smartContext';
import {
  Upload, CheckCircle2, ChevronLeft, Loader2, Camera,
  CloudUpload, Pencil, X, Trash2, FolderOpen, MessageCircle,
  FolderPlus, ChevronRight, ExternalLink, FileText, Layers, Plus,
  History,
  Captions,
  Keyboard,
} from 'lucide-react';
import { SmartSummary } from '../features/smart-summary/SmartSummary';
import { LabAlerts } from '../features/lab-alerts/LabAlerts';
import { HeaderConsultationRecorder } from '../features/scribe/HeaderConsultationRecorder';
import {
  hasLastRecordingTranscriptionRetry,
  retryLastRecordingTranscription,
} from '../features/scribe/consultationRecordingRetry';
import { MobileDictateFab } from '../features/scribe/MobileDictateFab';
import { generateNotePreviewWithFallback } from '../services/generateNotePreviewWithFallback';
import { FileViewer } from '../components/FileViewer';
import { FileBrowser } from '../components/FileBrowser';
import { NoteEditor } from '../components/NoteEditor';
import { PatientChat, type ChatSlashOption } from '../components/PatientChat';
import { getErrorMessage } from '../utils/formatting';
import { downloadDocxFromBase64 } from '../utils/downloadDocx';
import { CLINICAL_BTN_PRIMARY } from '../features/clinical/shared/tableScrollClasses';
import { formatPatientDisplayName } from '../features/clinical/shared/clinicalDisplay';

const SAVE_RETRY_ATTEMPTS = 2;
const SAVE_RETRY_DELAY_MS = 800;

const MAX_MAIN_COMPLAINT_LEN = 80;

/** Shared shell for Note fields / Transcription / Smart context (visual parity). */
const EDITOR_VIEW_SHELL =
  'flex h-0 min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200/60';
const EDITOR_VIEW_HEADER =
  'flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2.5 max-md:flex-col max-md:items-stretch';
const EDITOR_VIEW_TITLE = 'text-[11px] font-semibold uppercase tracking-wide text-slate-500';

/** Internal scribe state file — never list in browser/context picker (still stored in cloud). */
const SCRIBE_SESSIONS_FILE_NAME = 'halo_scribe_sessions.json';

function excludeHiddenPatientFiles(files: DriveFile[]): DriveFile[] {
  return files.filter((f) => f.name !== SCRIBE_SESSIONS_FILE_NAME);
}

function sortNewestFirst(files: DriveFile[]): DriveFile[] {
  return [...files].sort((a, b) => {
    const aTime = Date.parse(a.createdTime || '') || 0;
    const bTime = Date.parse(b.createdTime || '') || 0;
    return bTime - aTime;
  });
}

function orderFilesForPatientView(files: DriveFile[], isRootFolder: boolean): DriveFile[] {
  if (!isRootFolder) return files;
  const visible = excludeHiddenPatientFiles(files);
  const folders = visible.filter((file) => file.mimeType === FOLDER_MIME_TYPE);
  const regularFiles = visible.filter((file) => file.mimeType !== FOLDER_MIME_TYPE);
  return [...sortNewestFirst(folders), ...sortNewestFirst(regularFiles)];
}

function detectGeneratedDocumentIntent(input: string): 'motivation' | 'referral' | null {
  const question = input.trim().toLowerCase();
  if (!question) return null;
  const referral =
    question.includes('referral letter') ||
    (question.includes('referral') && question.includes('letter')) ||
    question.includes('refer this patient');
  if (referral) return 'referral';

  const motivation =
    question.includes('motivational letter') ||
    question.includes('motivation letter') ||
    (question.includes('motivation') && question.includes('letter'));
  if (motivation) return 'motivation';

  return null;
}

type AskHaloTemplateIntent = {
  templateId: string;
  templateName: string;
};

type AskHaloNoteReference = {
  note?: HaloNote;
  file?: DriveFile;
  reference: string;
  cleanedRequest: string;
  displayLabel: string;
};

type AskHaloNoteReferenceResult = {
  match: AskHaloNoteReference | null;
  hadReferenceSyntax: boolean;
};

type AskHaloTemplateSlashKind = 'referral' | 'motivational' | 'sick-note';

type AskHaloTemplateReference = {
  kind: AskHaloTemplateSlashKind;
  label: string;
  cleanedValue: string;
};

type AskHaloResolvedReferences = {
  noteMatch: AskHaloNoteReference | null;
  templateMatch: AskHaloTemplateReference | null;
  hadReferenceSyntax: boolean;
  unknownReferences: string[];
  cleanedRequest: string;
};

function normalizeTemplateIntentText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function buildTemplateIntentAliases(templateId: string, templateName: string): string[] {
  const base = [templateName, templateId.replace(/_/g, ' ')];
  switch (templateId) {
    case 'admission':
      return [...base, 'admission note'];
    case 'colonoscopy':
      return [...base, 'colonoscopy note'];
    case 'gastroscopy':
      return [...base, 'gastroscopy note', 'ogd'];
    case 'inpatient_fu':
      return [...base, 'inpatient follow up', 'inpatient follow-up'];
    case 'operation':
    case 'op_report':
      return [...base, 'operation report', 'op report', 'operative note', 'operation note'];
    case 'outpt_consult':
      return [...base, 'outpatient consult', 'outpatient note', 'consult note', 'clinic note'];
    case 'script':
      return [...base, 'prescription'];
    case 'sick_note':
      return [...base, 'medical certificate', 'sick leave'];
    case 'ward_dictation':
      return [...base, 'ward note'];
    default:
      return base;
  }
}

function detectAskHaloTemplateIntent(
  input: string,
  templates: Array<{ id: string; name: string }>
): AskHaloTemplateIntent | null {
  const normalizedQuestion = normalizeTemplateIntentText(input);
  if (!normalizedQuestion) return null;
  if (!/\b(write|draft|generate|create|make|prepare|populate)\b/.test(normalizedQuestion)) return null;

  let bestMatch: AskHaloTemplateIntent | null = null;
  let bestAliasLength = -1;

  for (const template of templates) {
    for (const alias of buildTemplateIntentAliases(template.id, template.name)) {
      const normalizedAlias = normalizeTemplateIntentText(alias);
      if (!normalizedAlias || !normalizedQuestion.includes(normalizedAlias)) continue;
      if (normalizedAlias.length <= bestAliasLength) continue;
      bestAliasLength = normalizedAlias.length;
      bestMatch = { templateId: template.id, templateName: template.name };
    }
  }

  return bestMatch;
}

function normalizeNoteReferenceKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function buildAskHaloNoteReferenceAliases(
  note: HaloNote,
  noteIndex: number,
  templates: Array<{ id: string; name: string }>
): string[] {
  const templateNameById = new Map(templates.map((template) => [template.id, template.name]));
  const templateId = note.template_id || '';
  const templateName = templateNameById.get(templateId) || note.title || templateId || `note ${noteIndex + 1}`;
  return [
    note.title || '',
    templateId,
    templateName,
    `note ${noteIndex + 1}`,
    `note${noteIndex + 1}`,
    `tab ${noteIndex + 1}`,
    `tab${noteIndex + 1}`,
    noteIndex === 0 ? 'first note' : '',
    ...buildTemplateIntentAliases(templateId, templateName),
  ].filter(Boolean);
}

function buildAskHaloReferenceHelp(notes: HaloNote[], templates: Array<{ id: string; name: string }>): string {
  return notes
    .slice(0, 5)
    .map((note, index) => {
      const aliases = buildAskHaloNoteReferenceAliases(note, index, templates);
      const preferred = aliases.find((alias) => alias && !alias.startsWith('note ') && !alias.startsWith('tab ')) || `note-${index + 1}`;
      return `/${preferred.replace(/\s+/g, '-').toLowerCase()}`;
    })
    .join(', ');
}

function buildAskHaloSlashOptions(notes: HaloNote[], templates: Array<{ id: string; name: string }>): ChatSlashOption[] {
  return notes.map((note, index) => {
    const aliases = buildAskHaloNoteReferenceAliases(note, index, templates);
    const preferredAlias =
      aliases.find((alias) => alias && !/^note\s*\d+$/i.test(alias) && !/^tab\s*\d+$/i.test(alias)) ||
      `note ${index + 1}`;
    const templateName =
      templates.find((template) => template.id === note.template_id)?.name ||
      note.template_id ||
      'Clinical note';
    return {
      value: preferredAlias.replace(/\s+/g, '-').toLowerCase(),
      label: note.title || templateName,
      description: `Note ${index + 1} • ${templateName}`,
      group: 'patient-notes',
    };
  });
}

function buildAskHaloTemplateSlashOptions(templates: Array<{ id: string; name: string }>): ChatSlashOption[] {
  const sickNoteTemplate = templates.find((template) => template.id === 'sick_note');
  return [
    {
      value: 'referral',
      label: 'Referral',
      description: 'Create a referral letter',
      group: 'templates',
    },
    {
      value: 'motivational',
      label: 'Motivational',
      description: 'Create a motivational letter',
      group: 'templates',
    },
    {
      value: 'sick-note',
      label: 'Sick note',
      description: `Create ${sickNoteTemplate?.name || 'a sick note'}`,
      group: 'templates',
    },
  ];
}

function buildRootFileReferenceAliases(file: DriveFile): string[] {
  const baseName = file.name.replace(/\.[^.]+$/i, '');
  const segments = baseName.split(' - ').map((part) => part.trim()).filter(Boolean);
  const trailing = segments[segments.length - 1] || baseName;
  return [
    trailing,
    trailing.replace(/_/g, ' '),
    baseName,
    baseName.replace(/_/g, ' '),
  ].filter(Boolean);
}

function buildRootFileSlashOptions(files: DriveFile[]): ChatSlashOption[] {
  const seen = new Set<string>();
  return files
    .filter((file) => file.mimeType !== FOLDER_MIME_TYPE)
    .map((file) => {
      const aliases = buildRootFileReferenceAliases(file);
      const preferred = aliases[0] || file.name;
      const value = preferred.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
      if (!value || seen.has(value)) return null;
      seen.add(value);
      return {
        value,
        label: preferred,
        description: file.name,
        group: 'patient-notes',
      } as ChatSlashOption;
    })
    .filter((option): option is ChatSlashOption => option != null);
}

function buildAskHaloReferenceContext(
  reference: AskHaloNoteReference | null,
  templateReference?: AskHaloTemplateReference | null
): string {
  const parts: string[] = [];
  if (templateReference) {
    parts.push(`Requested output template: ${templateReference.label}`);
  }
  if (reference?.note) {
    parts.push(`Referenced note for this request: ${reference.displayLabel}`);
  }
  if (reference?.file) {
    parts.push(`Referenced saved patient note for this request: ${reference.file.name}`);
  }
  return parts.join('\n');
}

function buildAskHaloTemplateHelp(): string {
  return ['/referral', '/motivational', '/sick-note'].join(', ');
}

function parseDraftedLetterSections(
  reply: string
): { clinicalSummary: string; justification: string; fallbackBody: string } {
  const text = reply.trim();
  if (!text) {
    return { clinicalSummary: '', justification: '', fallbackBody: '' };
  }

  const summaryMatch = text.match(/CLINICAL_SUMMARY:\s*([\s\S]*?)(?:\nJUSTIFICATION:|$)/i);
  const justificationMatch = text.match(/JUSTIFICATION:\s*([\s\S]*?)$/i);
  const clinicalSummary = summaryMatch?.[1]?.trim() ?? '';
  const justification = justificationMatch?.[1]?.trim() ?? '';

  return {
    clinicalSummary,
    justification,
    fallbackBody: text
      .replace(/CLINICAL_SUMMARY:\s*/i, '')
      .replace(/\nJUSTIFICATION:\s*/i, '\n')
      .trim(),
  };
}

function resolveAskHaloReferences(
  input: string,
  notes: HaloNote[],
  templates: Array<{ id: string; name: string }>,
  patientNotesFiles: DriveFile[]
): AskHaloResolvedReferences {
  const matches = [...input.matchAll(/(?:^|\s)([\/@])([a-z0-9_-]+)/gi)];
  if (matches.length === 0) {
    return {
      noteMatch: null,
      templateMatch: null,
      hadReferenceSyntax: false,
      unknownReferences: [],
      cleanedRequest: input.trim(),
    };
  }

  const templateReferences: Record<string, AskHaloTemplateReference> = {
    referral: { kind: 'referral', label: 'Referral', cleanedValue: 'referral' },
    'referral-letter': { kind: 'referral', label: 'Referral', cleanedValue: 'referral' },
    motivation: { kind: 'motivational', label: 'Motivational', cleanedValue: 'motivational' },
    motivational: { kind: 'motivational', label: 'Motivational', cleanedValue: 'motivational' },
    'motivation-letter': { kind: 'motivational', label: 'Motivational', cleanedValue: 'motivational' },
    'motivational-letter': { kind: 'motivational', label: 'Motivational', cleanedValue: 'motivational' },
    sicknote: { kind: 'sick-note', label: 'Sick note', cleanedValue: 'sick-note' },
    'sick-note': { kind: 'sick-note', label: 'Sick note', cleanedValue: 'sick-note' },
    'sick-note-docx': { kind: 'sick-note', label: 'Sick note', cleanedValue: 'sick-note' },
    'medical-certificate': { kind: 'sick-note', label: 'Sick note', cleanedValue: 'sick-note' },
  };

  let templateMatch: AskHaloTemplateReference | null = null;
  let noteMatch: AskHaloNoteReference | null = null;
  const unknownReferences: string[] = [];
  let cleanedRequest = input;

  for (const match of matches) {
    const rawReference = match[2]?.trim();
    if (!rawReference) continue;
    const normalizedReference = normalizeNoteReferenceKey(rawReference.replace(/[_-]/g, ' '));
    cleanedRequest = cleanedRequest.replace(match[0], ' ');

    const normalizedTemplateKey = rawReference.replace(/_/g, '-').toLowerCase();
    if (!templateMatch && templateReferences[normalizedTemplateKey]) {
      templateMatch = templateReferences[normalizedTemplateKey];
      continue;
    }

    if (!noteMatch) {
      const note = notes.find((candidate, index) => {
        const noteKeys = new Set(
          buildAskHaloNoteReferenceAliases(candidate, index, templates)
            .map((value) => normalizeNoteReferenceKey(value))
            .filter(Boolean)
        );
        return noteKeys.has(normalizedReference);
      });

      if (note) {
        noteMatch = {
          note,
          reference: rawReference,
          cleanedRequest: '',
          displayLabel: note.title || rawReference,
        };
        continue;
      }
    }

    if (!noteMatch) {
      const file = patientNotesFiles.find((candidate) => {
        const fileKeys = new Set(
          buildRootFileReferenceAliases(candidate)
            .map((value) => normalizeNoteReferenceKey(value))
            .filter(Boolean)
        );
        return fileKeys.has(normalizedReference);
      });

      if (file) {
        noteMatch = {
          file,
          reference: rawReference,
          cleanedRequest: '',
          displayLabel: file.name,
        };
        continue;
      }
    }

    unknownReferences.push(rawReference);
  }

  const finalRequest = cleanedRequest.replace(/\s{2,}/g, ' ').trim() || input.trim();
  if (noteMatch) noteMatch.cleanedRequest = finalRequest;

  return {
    noteMatch,
    templateMatch,
    hadReferenceSyntax: true,
    unknownReferences,
    cleanedRequest: finalRequest,
  };
}

function extractLetterFieldValue(text: string, labels: string[]): string {
  if (!text.trim()) return '';
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? '';
    const lower = line.toLowerCase();
    for (const label of labels) {
      const normalized = label.toLowerCase();
      if (lower.startsWith(`${normalized}:`)) {
        return line.slice(line.indexOf(':') + 1).trim();
      }
      if (lower === normalized && index + 1 < lines.length) {
        return lines[index + 1]!.trim();
      }
    }
  }
  return '';
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
  haloUserId?: string | null;
  /** App sets this to the current patient id (e.g. ward sheet name) to open Sticker & billing once. */
  openStickerProfileForPatientId?: string | null;
  onStickerProfileOpenFromParentHandled?: () => void;
}

export const PatientWorkspace: React.FC<Props> = ({
  patient,
  onBack,
  onDataChange,
  onToast,
  templateId: propTemplateId,
  calendarPrepEvent,
  haloUserId = null,
  openStickerProfileForPatientId,
  onStickerProfileOpenFromParentHandled,
}) => {
  const practiceUserId = resolvePracticeHaloUserId({ haloUserId });
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [patientNotesFiles, setPatientNotesFiles] = useState<DriveFile[]>([]);
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
  const [isTranscriptRefining, setIsTranscriptRefining] = useState(false);
  const transcriptInputRef = useRef<HTMLTextAreaElement>(null);
  const liveTranscriptScrollRef = useRef<HTMLDivElement>(null);
  const [showAddNoteModal, setShowAddNoteModal] = useState(false);
  const [consultSubTab, setConsultSubTab] = useState<'transcript' | 'context' | number>('transcript');
  const [templateOptions, setTemplateOptions] = useState<Array<{ id: string; name: string }>>([...HALO_TEMPLATE_OPTIONS]);
  const [selectedTemplatesForGenerate, setSelectedTemplatesForGenerate] = useState<string[]>([]);
  const lastTranscriptRef = useRef<string>('');
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
  const [retryTranscriptBusy, setRetryTranscriptBusy] = useState(false);
  const [canRetryTranscript, setCanRetryTranscript] = useState(false);
  const [noteGenerationStep, setNoteGenerationStep] = useState(0);
  const [sessions, setSessions] = useState<ScribeSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Derived "current" transcript that the UI shows and copies:
  // any completed segments (lastTranscript) plus the current live segment (if recording).
  const currentTranscript = liveTranscriptSegment
    ? (lastTranscript ? `${lastTranscript}\n\n${liveTranscriptSegment}` : liveTranscriptSegment)
    : lastTranscript;

  useEffect(() => {
    lastTranscriptRef.current = lastTranscript;
  }, [lastTranscript]);

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
  const [generatedChatDocument, setGeneratedChatDocument] = useState<{ name: string; url: string; fileId?: string } | null>(null);
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  chatMessagesRef.current = chatMessages;

  const [haloPatientProfile, setHaloPatientProfile] = useState<HaloPatientProfile | null>(null);
  const [haloProfileLoading, setHaloProfileLoading] = useState(true);
  const [stickerProfileModalOpen, setStickerProfileModalOpen] = useState(false);
  const [stickerProfileDraft, setStickerProfileDraft] = useState<HaloPatientProfile | null>(null);
  const [stickerProfileSaving, setStickerProfileSaving] = useState(false);
  const availableReferenceTemplates =
    selectedHospital === 'louis_leipoldt'
      ? templateOptions
      : (activeHospitalConfig.templates as Array<{ id: string; name: string }>);
  const askHaloNoteSlashOptions =
    buildRootFileSlashOptions(patientNotesFiles).length > 0
      ? buildRootFileSlashOptions(patientNotesFiles)
      : buildAskHaloSlashOptions(notes, availableReferenceTemplates);
  const askHaloSlashOptions = [
    ...buildAskHaloTemplateSlashOptions(availableReferenceTemplates),
    ...askHaloNoteSlashOptions,
  ];

  const refreshHaloPatientProfile = useCallback(async () => {
    setHaloProfileLoading(true);
    try {
      const p = await getPatientHaloProfile(patient.id);
      setHaloPatientProfile(p);
    } catch {
      setHaloPatientProfile(null);
    } finally {
      setHaloProfileLoading(false);
    }
  }, [patient.id]);

  const openStickerProfileModal = useCallback(() => {
    setStickerProfileModalOpen(true);
    void refreshHaloPatientProfile();
  }, [refreshHaloPatientProfile]);

  useEffect(() => {
    if (!openStickerProfileForPatientId || openStickerProfileForPatientId !== patient.id) return;
    openStickerProfileModal();
    onStickerProfileOpenFromParentHandled?.();
  }, [
    openStickerProfileForPatientId,
    patient.id,
    openStickerProfileModal,
    onStickerProfileOpenFromParentHandled,
  ]);

  useEffect(() => {
    void refreshHaloPatientProfile();
  }, [refreshHaloPatientProfile]);

  useEffect(() => {
    if (!stickerProfileModalOpen || haloProfileLoading) return;
    setStickerProfileDraft(
      haloPatientProfile
        ? { ...haloPatientProfile }
        : {
            version: 1,
            fullName: patient.name?.trim() || '',
            dob: patient.dob?.trim() || '',
            sex: patient.sex,
            updatedAt: new Date().toISOString(),
          }
    );
  }, [stickerProfileModalOpen, haloProfileLoading, haloPatientProfile, patient.name, patient.dob, patient.sex]);

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

  const getPrimaryEditorNote = useCallback(() => {
    return typeof consultSubTab === 'number' && notes[consultSubTab]
      ? notes[consultSubTab]
      : notes[activeNoteIndex] ?? null;
  }, [activeNoteIndex, consultSubTab, notes]);

  const buildAskHaloLiveContext = useCallback((sourceNote?: HaloNote | null) => {
    const activeEditorNote = sourceNote ?? getPrimaryEditorNote();
    const contextParts = [
      haloPatientProfile
        ? `Patient profile:\nName: ${haloPatientProfile.fullName || patient.name}\nDOB: ${haloPatientProfile.dob || patient.dob}\nSex: ${haloPatientProfile.sex || patient.sex}`
        : `Patient: ${patient.name}\nDOB: ${patient.dob}\nSex: ${patient.sex}`,
      activeEditorNote
        ? `Current note:\nTitle: ${activeEditorNote.title || 'Untitled note'}\n${getNoteText(activeEditorNote)}`
        : '',
      lastTranscript.trim() ? `Transcript:\n${lastTranscript.trim()}` : '',
      consultContext.trim() ? `Smart context:\n${consultContext.trim()}` : '',
      activeSessionId ? `Active session id: ${activeSessionId}` : '',
    ].filter(Boolean);
    return contextParts.join('\n\n').trim();
  }, [
    activeSessionId,
    consultContext,
    getPrimaryEditorNote,
    haloPatientProfile,
    lastTranscript,
    patient.dob,
    patient.name,
    patient.sex,
  ]);

  const buildLetterTemplateContext = useCallback((sourceNote?: HaloNote | null) => {
    const activeEditorNote = sourceNote ?? getPrimaryEditorNote();
    const noteText = activeEditorNote ? getNoteText(activeEditorNote) : '';
    return {
      contextText: buildAskHaloLiveContext(activeEditorNote),
      diagnoses: extractLetterFieldValue(noteText, ['diagnosis', 'diagnoses', 'admission diagnosis']),
      icds: extractLetterFieldValue(noteText, ['icd', 'icd-10', 'icds', 'icd 10']),
    };
  }, [buildAskHaloLiveContext, getPrimaryEditorNote]);

  useEffect(() => {
    if (activeTab !== 'notes') setEditorPanelView('noteFields');
  }, [activeTab]);

  // Auto-scroll live/finalizing transcript panel.
  useEffect(() => {
    if ((!isLiveStreaming && !isTranscriptRefining) || editorPanelView !== 'transcription') return;
    const el = liveTranscriptScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [currentTranscript, isLiveStreaming, isTranscriptRefining, editorPanelView]);

  // Load folder contents (with loading indicator)
  const loadFolderContents = useCallback(async (folderId: string) => {
    setStatus(AppStatus.LOADING);
    try {
      const contents = folderId === patient.id
        ? await fetchFiles(patient.id)
        : await fetchFolderContents(folderId);
      const ordered = orderFilesForPatientView(contents, folderId === patient.id);
      setFiles(ordered);
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
      const ordered = orderFilesForPatientView(contents, currentFolderId === patient.id);
      setFiles(ordered);
    } catch {
      // Silent — don't show errors for background refreshes
    }
  }, [currentFolderId, patient.id]);

  const refreshPatientNotesFiles = useCallback(async () => {
    try {
      const contents = await fetchPatientNotesFiles(patient.id);
      setPatientNotesFiles(sortNewestFirst(contents));
    } catch {
      // best-effort only for slash suggestions
    }
  }, [patient.id]);

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
      setGeneratedChatDocument(null);
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
        firstFiles = orderFilesForPatientView(firstFiles, true);
        if (!isMounted) return;
        setFiles(firstFiles);
        setStatus(AppStatus.IDLE);
        void refreshPatientNotesFiles();

        // Fetch remaining pages in background and append (so full list appears without blocking UI)
        if (nextPage) {
          (async () => {
            const all = [...firstFiles];
            let page: string | null = nextPage;
            while (page && isMounted) {
              try {
                const data = await fetchFilesPage(patient.id, page);
                all.push(...excludeHiddenPatientFiles(data.files));
                if (isMounted) {
                  const ordered = orderFilesForPatientView(all, true);
                  setFiles(ordered);
                }
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

  // Prefetch Halo templates as soon as the workspace opens (template picker after dictation).
  useEffect(() => {
    getHaloTemplates(practiceUserId)
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
  }, [patient.id, practiceUserId]);

  // Refresh templates when opening Editor or Sessions tab
  useEffect(() => {
    if (activeTab !== 'notes' && activeTab !== 'sessions') return;

    if (activeTab === 'notes') {
      getHaloTemplates(practiceUserId)
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
      const displayName = formatPatientDisplayName(patient.name);
      const raw = `${displayName} - ${dateStr} - ${templateName}`;
      return raw.replace(/[^\w\s\-,.]/g, '').trim() || undefined;
    },
    [patient.name, templateOptions]
  );

  const persistCustomGeneratedNote = useCallback(
    async (prompt: string, content: string): Promise<HaloNote> => {
      const preferredTemplateId =
        templateOptions.find((t) => t.id === 'script')?.id ||
        templateId ||
        templateOptions[0]?.id ||
        'script';
      const preferredTemplateName =
        templateOptions.find((t) => t.id === preferredTemplateId)?.name ||
        templateOptions[0]?.name ||
        'Clinical note';
      const title = prompt.length > 60 ? `${prompt.slice(0, 57)}…` : prompt;
      const today = new Date().toISOString().slice(0, 10);
      const displayName = formatPatientDisplayName(patient.name);
      const fileName = `${displayName} - ${today} - ${title || 'Custom note'}`
        .replace(/[^\w\s\-,.]/g, '')
        .trim()
        .slice(0, 110);
      const saved = await saveNoteAsDocx({
        patientId: patient.id,
        template_id: preferredTemplateId,
        text: content,
        fileName,
        template_name: preferredTemplateName,
        saveTarget: 'root',
      });
      if (!saved?.fileId) {
        throw new Error('Custom note did not save.');
      }
      return {
        noteId: `custom-${saved.fileId}`,
        title: title || 'Custom note',
        content,
        template_id: preferredTemplateId,
        lastSavedAt: new Date().toISOString(),
        dirty: false,
      };
    },
    [patient.id, patient.name, templateId, templateOptions]
  );

  const saveNoteWithRetryAndFallback = useCallback(
    async (params: Parameters<typeof saveNoteAsDocx>[0]): Promise<'drive' | 'download'> => {
      let lastErr: unknown;
      for (let attempt = 0; attempt < SAVE_RETRY_ATTEMPTS; attempt++) {
        try {
          await saveNoteAsDocx(params);
          return 'drive';
        } catch (err) {
          lastErr = err;
          if (attempt < SAVE_RETRY_ATTEMPTS - 1) {
            await new Promise((r) => setTimeout(r, SAVE_RETRY_DELAY_MS));
          }
        }
      }
      try {
        const dl = await downloadNoteAsDocx(params);
        downloadDocxFromBase64(dl.docxBase64, dl.fileName);
        return 'download';
      } catch {
        throw lastErr;
      }
    },
    []
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
      const saveParams = {
        patientId: patient.id,
        template_id: tplId,
        text,
        fileName,
        template_name: templateOptions.find((t) => t.id === tplId)?.name,
        mergeFields: note.docxMerge,
        user_id: practiceUserId,
        saveTarget: 'patient_notes' as const,
      };
      const outcome = await saveNoteWithRetryAndFallback(saveParams);
      if (outcome === 'drive') {
        setNotes(prev => prev.map((n, i) => i !== noteIndex ? n : { ...n, lastSavedAt: new Date().toISOString(), dirty: false }));
        await loadFolderContents(currentFolderId);
        void refreshPatientNotesFiles();
        onDataChange();
        onToast('Note saved as DOCX to Patient Notes folder.', 'success');
      } else {
        onToast(
          'Could not save to Patient Notes — DOCX downloaded to your device. Upload it to the patient folder manually.',
          'info'
        );
      }
    } catch (err) {
      onToast(`${getErrorMessage(err)} Your note is still in the editor — tap Save as DOCX to try again.`, 'error');
    }
    setSavingNoteIndex(null);
    setStatus(AppStatus.IDLE);
  }, [notes, patient.id, templateId, currentFolderId, loadFolderContents, onDataChange, onToast, buildNoteFileName, templateOptions, practiceUserId, saveNoteWithRetryAndFallback]);

  const handleSaveAll = useCallback(async () => {
    setStatus(AppStatus.SAVING);
    let savedToDrive = 0;
    let downloaded = 0;
    try {
      for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        const text = getNoteText(note);
        if (!text.trim()) continue;
        const tplId = note.template_id || templateId;
        const fileName = buildNoteFileName(tplId, note.title || `Note ${i + 1}`);
        const outcome = await saveNoteWithRetryAndFallback({
          patientId: patient.id,
          template_id: tplId,
          text,
          fileName,
          template_name: templateOptions.find((t) => t.id === tplId)?.name,
          mergeFields: note.docxMerge,
          user_id: practiceUserId,
          saveTarget: 'patient_notes',
        });
        if (outcome === 'drive') {
          setNotes(prev => prev.map((n, j) => j !== i ? n : { ...n, lastSavedAt: new Date().toISOString(), dirty: false }));
          savedToDrive++;
        } else {
          downloaded++;
        }
      }
      if (savedToDrive > 0) {
        await loadFolderContents(currentFolderId);
        void refreshPatientNotesFiles();
        onDataChange();
      }
      if (savedToDrive > 0 && downloaded === 0) {
        onToast(`Saved ${savedToDrive} note(s) as DOCX.`, 'success');
      } else if (savedToDrive > 0 && downloaded > 0) {
        onToast(
          `Saved ${savedToDrive} note(s) to Patient Notes. ${downloaded} downloaded to your device — upload manually.`,
          'info'
        );
      } else if (downloaded > 0) {
        onToast(
          'Could not save to Patient Notes — DOCX files downloaded to your device. Upload them manually.',
          'info'
        );
      }
    } catch (err) {
      onToast(`${getErrorMessage(err)} Unsaved notes remain in the editor.`, 'error');
    }
    setStatus(AppStatus.IDLE);
  }, [notes, patient.id, templateId, currentFolderId, loadFolderContents, onDataChange, onToast, buildNoteFileName, templateOptions, practiceUserId, saveNoteWithRetryAndFallback]);

  const handleRegeneratePdf = useCallback(async (noteIndex: number, text: string) => {
    const note = notes[noteIndex];
    const payloadText = text.trim();
    if (!note || !payloadText) return;
    const tplId = note.template_id || templateId;
    const tplName = templateOptions.find((t) => t.id === tplId)?.name;
    setRegeneratingPdfIndex(noteIndex);
    try {
      const { pdfBase64 } = await generateNotePreviewPdf({
        template_id: tplId,
        text: payloadText,
        template_name: tplName,
        patientId: patient.id,
        mergeFields: note.docxMerge,
        user_id: practiceUserId,
      });
      setNotes((prev) =>
        prev.map((n, i) =>
          i !== noteIndex
            ? n
            : {
                ...n,
                previewPdfBase64: pdfBase64,
              }
        )
      );
      onToast('Template preview regenerated from the current note.', 'success');
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
    } finally {
      setRegeneratingPdfIndex(null);
    }
  }, [notes, onToast, templateId, templateOptions, patient.id, practiceUserId]);

  const GENERATE_TIMEOUT_MS = 130_000;

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
              const template_name = templateNames[id];
              const noteResult = await generateNotePreviewWithFallback({
                template_id: id,
                text: noteInput,
                user_id:
                  selectedHospital === 'louis_leipoldt'
                    ? practiceUserId
                    : activeHospitalConfig.userId,
                template_name,
                patientId: patient.id,
                haloUserId: practiceUserId,
                patientProfile: haloPatientProfile,
              });
              return { noteResult };
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
          // Never put raw transcript here — that belongs in the Transcription tab only.
          const content = first?.content?.trim() || fromFields || '';
          return {
            noteId: first?.noteId ?? `note-${tid}-${Date.now()}`,
            title: first?.title ?? name,
            content,
            ...(first?.raw !== undefined ? { raw: first.raw } : {}),
            ...(first?.docxMerge ? { docxMerge: first.docxMerge } : {}),
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
        onToast('Note generated. You can edit and save as DOCX.', 'success');

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
            ...(n.docxMerge ? { docxMerge: n.docxMerge } : {}),
            ...(n.fields && n.fields.length > 0 ? { fields: n.fields } : {}),
          })),
          ...(mainComplaint ? { mainComplaint } : {}),
          ...(haloPatientProfile?.email?.trim()
            ? { patientEmail: haloPatientProfile.email.trim() }
            : {}),
          ...(haloPatientProfile?.medicalAidPhone?.trim()
            ? { patientPhone: haloPatientProfile.medicalAidPhone.trim() }
            : {}),
        };
        void savePatientSession(patient.id, payload)
          .then((res) => {
            const items = Array.isArray(res.sessions) ? res.sessions : [];
            const sorted = [...items].sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
            setSessions(sorted);
            setActiveSessionId(sorted[0]?.id ?? null);
          })
          .catch(() => {
            /* best-effort only */
          });
      } catch (err) {
        onToast(getErrorMessage(err), 'error');
      }
      setIsGeneratingNotes(false);
      setNoteGenerationStep(0);
    },
    [
      GENERATE_TIMEOUT_MS,
      activeSessionId,
      activeHospitalConfig.userId,
      consultContext,
      haloUserId,
      practiceUserId,
      onToast,
      patient.id,
      selectedHospital,
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
      setEditorPanelView('noteFields');
    },
    [lastTranscript, onToast]
  );

  const handleLiveTranscriptUpdate = useCallback((segment: string) => {
    // While recording, keep the live segment separate so we can append it
    // to any existing transcript once the doctor stops the recording.
    setIsLiveStreaming(true);
    setLiveTranscriptSegment(segment);
  }, []);

  const proceedToTemplatePickerFromTranscript = useCallback(
    (source: string) => {
      const combined = source.trim();
      if (!combined) {
        onToast('Enter or dictate text first.', 'info');
        return;
      }
      setPendingTranscript(combined);
      setSelectedTemplatesForGenerate([]);
      setShowAddNoteModal(false);
      setActiveTab('notes');
    },
    [onToast]
  );

  const handleContinueTypedTranscript = useCallback(() => {
    proceedToTemplatePickerFromTranscript(lastTranscript);
  }, [lastTranscript, proceedToTemplatePickerFromTranscript]);

  useEffect(() => {
    const onStartType = () => {
      setActiveTab('notes');
      setEditorPanelView('transcription');
      setPendingTranscript(null);
      setShowAddNoteModal(false);
      setLiveTranscriptSegment('');
      setIsLiveStreaming(false);
      window.setTimeout(() => transcriptInputRef.current?.focus(), 80);
    };
    const onContinueTyped = () => handleContinueTypedTranscript();
    window.addEventListener('halo:start-type-note', onStartType);
    window.addEventListener('halo:continue-typed-transcript', onContinueTyped);
    return () => {
      window.removeEventListener('halo:start-type-note', onStartType);
      window.removeEventListener('halo:continue-typed-transcript', onContinueTyped);
    };
  }, [handleContinueTypedTranscript]);

  const handleLiveStopping = useCallback(() => {
    setIsLiveStreaming(false);
  }, []);

  const handleLiveStopped = useCallback(
    (transcript: string) => {
      setIsLiveStreaming(false);
      setLiveTranscriptSegment('');

      const clean = transcript.trim();
      if (!clean) {
        return;
      }

      const base = lastTranscriptRef.current.trim();
      const isResume = notes.length > 0 || !!activeSessionId;

      let combined: string;
      let resumeHeader = '';
      if (isResume && base) {
        const timestamp = new Date().toLocaleString();
        resumeHeader = `\n\n[Consultation resumed ${timestamp}]\n\n`;
        combined = `${base}${resumeHeader}${clean}`;
      } else if (base) {
        combined = `${base}\n\n${clean}`;
      } else {
        combined = clean;
      }

      setLastTranscript(combined);

      if (isResume) {
        setPendingTranscript(null);
        setActiveTab('notes');
        setEditorPanelView('noteFields');
        void generateNotesFromTranscript(combined, false);
      } else {
        setPendingTranscript(combined);
        setSelectedTemplatesForGenerate([]);
        setActiveTab('notes');
        setEditorPanelView('noteFields');
      }
    },
    [activeSessionId, generateNotesFromTranscript, notes.length]
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

  const generateAskHaloLetter = useCallback(
    async (
      kind: 'motivation' | 'referral',
      requestText: string,
      sourceNote?: HaloNote | null,
      referenceLabel?: string,
      referenceFile?: DriveFile | null
    ): Promise<{ name: string; url: string; fileId?: string } | null> => {
      const referencedFileContext = referenceFile ? await describeFile(patient.id, referenceFile).catch(() => '') : '';
      const extraContext = [
        buildAskHaloLiveContext(sourceNote),
        referencedFileContext ? `Referenced saved patient note (${referenceLabel || referenceFile?.name}):\n${referencedFileContext}` : '',
      ].filter(Boolean).join('\n\n');
      const letterTemplateContext = buildLetterTemplateContext(sourceNote);
      const draftingPrompt =
        kind === 'motivation'
          ? [
              'Draft two separate sections for a medical motivation letter for this patient.',
              'Use a professional clinical tone.',
              'Include the clinical rationale for the requested treatment, investigation, or authorization.',
              'If a PMB, medical aid, or general surgery reference extract exists in the patient files or Patient Notes, use its criteria and phrasing style.',
              'Use the referenced clinical note as the primary source when one is explicitly provided.',
              ...(referenceLabel ? [`Referenced source: ${referenceLabel}`] : []),
              'Return plain text in exactly this format:',
              'CLINICAL_SUMMARY: <brief patient summary, diagnosis, current management, relevant findings>',
              'JUSTIFICATION: <distinct PMB/medical-aid justification explaining why the request should be approved, grounded in PMB/general surgery criteria where available>',
              `User request: ${requestText}`,
            ].join(' ')
          : [
              'Draft two separate sections for a referral letter for this patient.',
              'Summarize the relevant history, diagnosis, and reason for referral.',
              'Keep this as a standard clinical referral letter.',
              'Do not mention PMB, prescribed minimum benefits, funding, authorization, approval, or medical aid unless the user explicitly asks for a medical aid / funding letter.',
              'Use the referenced clinical note as the primary source when one is explicitly provided.',
              ...(referenceLabel ? [`Referenced source: ${referenceLabel}`] : []),
              'Return plain text in exactly this format:',
              'CLINICAL_SUMMARY: <brief referral summary with history, diagnosis, and current management>',
              'JUSTIFICATION: <distinct referral rationale stating why specialist review or further care is required>',
              `User request: ${requestText}`,
            ].join(' ');

      const { reply } = await askHalo(patient.id, draftingPrompt, chatMessagesRef.current, extraContext);
      const parsed = parseDraftedLetterSections(reply ?? '');
      const body = parsed.fallbackBody;
      if (!body) return null;

      const result = await generatePatientLetterDocx({
        patientId: patient.id,
        letterKind: kind,
        body,
        clinicalSummary: parsed.clinicalSummary,
        justification: parsed.justification,
        requestText,
        contextText: letterTemplateContext.contextText,
        diagnoses: letterTemplateContext.diagnoses,
        icds: letterTemplateContext.icds,
        referenceFileId: referenceFile?.id,
        referenceFileName: referenceFile?.name,
      });
      if (!result?.fileId || !result.file?.url) return null;

      await loadFolderContents(currentFolderId);
      void refreshPatientNotesFiles();
      onDataChange();
      setGeneratedChatDocument({ name: result.file.name || result.name, url: result.file.url, fileId: result.fileId });
      return { name: result.file.name || result.name, url: result.file.url, fileId: result.fileId };
    },
    [buildAskHaloLiveContext, buildLetterTemplateContext, currentFolderId, loadFolderContents, onDataChange, patient.id]
  );

  const generateAskHaloTemplateDocument = useCallback(
    async (
      templateIntent: AskHaloTemplateIntent,
      requestText: string,
      sourceNote?: HaloNote | null,
      referenceLabel?: string,
      referenceFile?: DriveFile | null
    ): Promise<{ name: string; url: string; fileId?: string } | null> => {
      const referencedFileContext = referenceFile ? await describeFile(patient.id, referenceFile).catch(() => '') : '';
      const extraContext = [
        buildAskHaloLiveContext(sourceNote),
        referencedFileContext ? `Referenced saved patient note (${referenceLabel || referenceFile?.name}):\n${referencedFileContext}` : '',
      ].filter(Boolean).join('\n\n');
      const draftingPrompt = [
        `Draft the clinical content for a ${templateIntent.templateName} document for this patient.`,
        'Use the current patient, note, transcript, and clinical context.',
        'Use the referenced clinical note as the primary source when one is explicitly provided.',
        ...(referenceLabel ? [`Referenced source: ${referenceLabel}`] : []),
        `Make the content appropriate for the ${templateIntent.templateName} template.`,
        'Output only the clinical content needed to populate the document.',
        `User request: ${requestText}`,
      ].join(' ');

      const { reply } = await askHalo(patient.id, draftingPrompt, chatMessagesRef.current, extraContext);
      const body = reply?.trim();
      if (!body) return null;

      const result = await saveNoteAsDocx({
        patientId: patient.id,
        template_id: templateIntent.templateId,
        text: body,
        fileName: buildNoteFileName(templateIntent.templateId, templateIntent.templateName),
        user_id: selectedHospital === 'louis_leipoldt' ? undefined : activeHospitalConfig.userId,
        template_name: templateIntent.templateName,
        saveTarget: 'root',
      });
      if (!result?.fileId || !result.file?.url) return null;

      await loadFolderContents(currentFolderId);
      void refreshPatientNotesFiles();
      onDataChange();
      setGeneratedChatDocument({ name: result.file.name || result.name, url: result.file.url, fileId: result.fileId });
      return { name: result.file.name || result.name, url: result.file.url, fileId: result.fileId };
    },
    [
      activeHospitalConfig.userId,
      buildAskHaloLiveContext,
      buildNoteFileName,
      currentFolderId,
      loadFolderContents,
      onDataChange,
      patient.id,
      selectedHospital,
    ]
  );

  // Chat handler — uses streaming for progressive response display
  const handleSendChat = async () => {
    const question = chatInput.trim();
    if (!question || chatLoading) return;

    const slashReferenceResult = resolveAskHaloReferences(
      question,
      notes,
      availableReferenceTemplates,
      patientNotesFiles
    );
    if (slashReferenceResult.hadReferenceSyntax && slashReferenceResult.unknownReferences.length > 0) {
      const availableTemplateHints = buildAskHaloTemplateHelp();
      const availableRootHints = askHaloNoteSlashOptions.map((option) => `/${option.value}`).slice(0, 5).join(', ');
      setGeneratedChatDocument(null);
      setChatMessages(prev => [
        ...prev,
        { role: 'user', content: question, timestamp: Date.now() },
        {
          role: 'assistant',
          content: `I couldn't find ${slashReferenceResult.unknownReferences.map((value) => `/${value}`).join(', ')}. Try a template like ${availableTemplateHints} and a patient note like ${availableRootHints || buildAskHaloReferenceHelp(notes, availableReferenceTemplates) || '/admission, /operation, /script'}.`,
          timestamp: Date.now(),
        },
      ]);
      setChatInput("");
      onToast('Slash reference not found.', 'info');
      return;
    }

    const noteReference = slashReferenceResult.noteMatch;
    const templateReference = slashReferenceResult.templateMatch;
    const normalizedQuestion = slashReferenceResult.cleanedRequest || question;
    const referenceContext = buildAskHaloReferenceContext(noteReference, templateReference);
    const liveContext = [buildAskHaloLiveContext(noteReference?.note), referenceContext].filter(Boolean).join('\n\n');
    const documentIntent =
      templateReference?.kind === 'referral'
        ? 'referral'
        : templateReference?.kind === 'motivational'
          ? 'motivation'
          : detectGeneratedDocumentIntent(normalizedQuestion);
    const noteTemplateIntent =
      documentIntent
        ? null
        : templateReference?.kind === 'sick-note'
          ? {
              templateId: 'sick_note',
              templateName: availableReferenceTemplates.find((template) => template.id === 'sick_note')?.name || 'Sick note',
            }
          : detectAskHaloTemplateIntent(
              normalizedQuestion,
              availableReferenceTemplates
            );
    const userMessage: ChatMessage = { role: 'user', content: question, timestamp: Date.now() };
    setGeneratedChatDocument(null);
    setChatMessages(prev => [...prev, userMessage]);
    setChatInput("");
    setChatLoading(true);

    const assistantPlaceholder: ChatMessage = { role: 'assistant', content: '', timestamp: Date.now() };
    setChatMessages(prev => [...prev, assistantPlaceholder]);

    try {
      if (documentIntent) {
        const generated = await generateAskHaloLetter(
          documentIntent,
          normalizedQuestion,
          noteReference?.note,
          noteReference?.displayLabel,
          noteReference?.file
        );
        if (!generated) {
          throw new Error('HALO could not generate the requested document.');
        }
        setChatMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role !== 'assistant') return prev;
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              content: `${documentIntent === 'motivation' ? 'Motivation' : 'Referral'} letter generated: ${generated.name}${noteReference ? ` using ${noteReference.displayLabel}` : ''}`,
            },
          ];
        });
        onToast(`${documentIntent === 'motivation' ? 'Motivation' : 'Referral'} letter saved`, 'success');
        return;
      }

      if (noteTemplateIntent) {
        const generated = await generateAskHaloTemplateDocument(
          noteTemplateIntent,
          normalizedQuestion,
          noteReference?.note,
          noteReference?.displayLabel,
          noteReference?.file
        );
        if (!generated) {
          throw new Error(`HALO could not generate the requested ${noteTemplateIntent.templateName} document.`);
        }
        setChatMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role !== 'assistant') return prev;
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              content: `${noteTemplateIntent.templateName} generated: ${generated.name}`,
            },
          ];
        });
        onToast(`${noteTemplateIntent.templateName} saved`, 'success');
        return;
      }

      await askHaloStream(
        patient.id,
        normalizedQuestion,
        chatMessagesRef.current,
        (chunk) => {
          setChatMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') {
              return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
            }
            return prev;
          });
        },
        liveContext
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

  const handleRetryTranscription = useCallback(async () => {
    if (!hasLastRecordingTranscriptionRetry() || isLiveStreaming || retryTranscriptBusy) return;
    setRetryTranscriptBusy(true);
    try {
      const batch = await retryLastRecordingTranscription();
      if (!batch) {
        onToast('No recording available to re-transcribe. Record again first.', 'info');
        return;
      }
      setLastTranscript(batch);
      onToast('Transcript updated from full recording.', 'success');
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
    } finally {
      setRetryTranscriptBusy(false);
    }
  }, [isLiveStreaming, onToast, retryTranscriptBusy]);

  useEffect(() => {
    if (editorPanelView !== 'transcription') return;
    setCanRetryTranscript(hasLastRecordingTranscriptionRetry());
  }, [editorPanelView, lastTranscript, isLiveStreaming]);

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
        setGeneratedChatDocument(null);
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
          ...(n.docxMerge ? { docxMerge: n.docxMerge } : {}),
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
    <div className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-halo-bg">
      {/* Header — mobile: single compact row (back + actions); desktop: unchanged title left / actions right */}
      <div className="shrink-0 border-b border-halo-border px-3 md:px-6 py-2.5 flex flex-row flex-wrap items-center gap-x-2 gap-y-2 bg-halo-card shadow-[var(--shadow-halo-soft)] z-10 md:flex-nowrap md:items-center md:justify-between md:gap-4">
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
              <h1 className="text-2xl font-semibold text-halo-text tracking-tight leading-snug truncate">
                {formatPatientDisplayName(patient.name) || patient.name}
              </h1>
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
                  onLiveStopping={handleLiveStopping}
                  onLiveStopped={handleLiveStopped}
                  onTranscriptRefining={setIsTranscriptRefining}
                  onError={(msg: string) => onToast(msg, 'error')}
                />
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('notes');
                    setEditorPanelView('transcription');
                    setPendingTranscript(null);
                    setShowAddNoteModal(false);
                    window.setTimeout(() => transcriptInputRef.current?.focus(), 80);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white px-2.5 py-1.5 md:px-3 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  <Keyboard className="size-3.5 shrink-0" aria-hidden />
                  <span className="max-md:sr-only md:not-sr-only">Type</span>
                </button>
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
      <div
        className={`flex min-h-0 flex-1 flex-col bg-halo-bg p-3 md:p-4 max-md:pb-[calc(9rem+env(safe-area-inset-bottom,0px))] [-webkit-overflow-scrolling:touch] ${
          activeTab === 'notes' ? 'overflow-hidden' : 'overflow-y-auto'
        }`}
      >
        <div className={`mx-auto flex w-full max-w-[min(96rem,100%)] min-h-0 flex-col ${activeTab === 'notes' ? 'h-0 flex-1 overflow-hidden' : 'flex-1'}`}>
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
          <div className="mb-4 mt-2 shrink-0 flex flex-wrap items-end justify-between gap-x-3 gap-y-2 border-b border-slate-200/70 max-md:mb-2 max-md:mt-1 max-md:flex-col max-md:items-stretch max-md:border-b-0">
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto md:gap-4 max-md:grid max-md:grid-cols-4 max-md:gap-1.5 max-md:overflow-visible max-md:rounded-2xl max-md:border max-md:border-slate-200/80 max-md:bg-white max-md:p-1">
              <button onClick={() => setActiveTab('overview')} className={`halo-touch-min border-b-2 py-2 text-sm font-bold uppercase tracking-wide whitespace-nowrap transition-colors max-md:min-w-0 max-md:rounded-full max-md:border max-md:border-b max-md:px-1.5 max-md:py-2 max-md:text-[11px] ${activeTab === 'overview' ? 'border-halo-primary text-halo-text max-md:border-teal-300 max-md:bg-teal-50 max-md:ring-1 max-md:ring-teal-200/80' : 'border-transparent text-halo-muted hover:text-halo-text-secondary max-md:border-slate-200/80 max-md:bg-white'}`}>Files</button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('notes');
                }}
                className={`halo-touch-min border-b-2 py-2 text-sm font-bold uppercase tracking-wide whitespace-nowrap transition-colors max-md:min-w-0 max-md:rounded-full max-md:border max-md:border-b max-md:px-1.5 max-md:py-2 max-md:text-[11px] ${
                  activeTab === 'notes'
                    ? 'border-halo-primary text-halo-text max-md:border-teal-300 max-md:bg-teal-50 max-md:ring-1 max-md:ring-teal-200/80'
                    : 'border-transparent text-halo-muted hover:text-halo-text-secondary max-md:border-slate-200/80 max-md:bg-white'
                }`}
              >
                Editor
              </button>
              <button onClick={() => setActiveTab('chat')} className={`halo-touch-min flex items-center gap-1.5 border-b-2 py-2 text-sm font-bold uppercase tracking-wide whitespace-nowrap transition-colors max-md:min-w-0 max-md:justify-center max-md:rounded-full max-md:border max-md:border-b max-md:px-1.5 max-md:py-2 max-md:text-[11px] ${activeTab === 'chat' ? 'border-halo-primary text-halo-text max-md:border-teal-300 max-md:bg-teal-50 max-md:ring-1 max-md:ring-teal-200/80' : 'border-transparent text-halo-muted hover:text-halo-text-secondary max-md:border-slate-200/80 max-md:bg-white'}`}>
              <MessageCircle size={14} className="shrink-0 max-md:hidden" /> Ask HALO
              </button>
              <button onClick={() => setActiveTab('sessions')} className={`halo-touch-min flex items-center gap-1.5 border-b-2 py-2 text-sm font-bold uppercase tracking-wide whitespace-nowrap transition-colors max-md:min-w-0 max-md:justify-center max-md:rounded-full max-md:border max-md:border-b max-md:px-1.5 max-md:py-2 max-md:text-[11px] ${activeTab === 'sessions' ? 'border-halo-primary text-halo-text max-md:border-teal-300 max-md:bg-teal-50 max-md:ring-1 max-md:ring-teal-200/80' : 'border-transparent text-halo-muted hover:text-halo-text-secondary max-md:border-slate-200/80 max-md:bg-white'}`}>
              <History size={14} className="shrink-0 max-md:hidden" /> Sessions
              </button>
              {patient.webUrl ? (
                <a
                  href={patient.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="halo-touch-min mb-0.5 inline-flex shrink-0 items-center gap-1 rounded-[10px] border border-halo-border bg-halo-section px-3 py-2 text-sm font-semibold text-halo-text-secondary transition-colors hover:border-halo-primary/40 hover:text-halo-primary whitespace-nowrap max-md:hidden"
                  title="Open cloud folder (Drive / OneDrive)"
                >
                  <FolderOpen className="w-3 h-3 opacity-90" aria-hidden />
                  Folder
                  <ExternalLink className="w-2.5 h-2.5 opacity-70" aria-hidden />
                </a>
              ) : null}
            </div>
          </div>

          {activeTab === 'notes' && showContextUploadChooser ? (
            <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:items-center">
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
              onOpenStickerProfile={openStickerProfileModal}
            />
          ) : activeTab === 'sessions' ? (
            <div className="min-h-[40dvh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm max-md:flex max-md:min-h-0 max-md:flex-1 max-md:flex-col">
              <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-3">
                <span className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                  Previous Sessions
                </span>
              </div>
              <div className="p-4 max-md:min-h-0 max-md:flex-1 max-md:overflow-y-auto">
                {sessionsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 text-teal-500 animate-spin" />
                  </div>
                ) : sessions.length === 0 ? (
                  <p className="py-12 text-center text-sm text-slate-500">No saved sessions yet.</p>
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
                            className="halo-touch-min group flex w-full items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:border-teal-200 hover:bg-teal-50"
                          >
                            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                              <span className="font-medium text-slate-800 truncate">{listTitle}</span>
                              <span className="text-xs text-slate-500">
                                {labelTime ? `${labelTime}` : ''}
                                {hasNotes ? ` • ${session.notes!.length} note(s)` : ' • transcript only'}
                              </span>
                              {session.patientEmail?.trim() || session.patientPhone?.trim() ? (
                                <span className="text-xs text-teal-700 font-medium block mt-0.5 truncate">
                                  Contact:{' '}
                                  {[session.patientEmail?.trim(), session.patientPhone?.trim()]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </span>
                              ) : null}
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
            <div className="flex h-0 min-h-0 flex-1 flex-col overflow-hidden">
              {/* Editor workspace: fills remaining viewport height */}
              <div className="relative flex h-0 min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-[0_4px_24px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/70">
                {pendingTranscript ? (
                  <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-slate-50/90 p-4">
                    <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">{pendingTranscript}</p>
                  </div>
                ) : (
                  <div className="flex h-0 min-h-0 flex-1 flex-col overflow-hidden">
                    <div className="flex w-full min-w-0 shrink-0 flex-col gap-2 border-b border-slate-200 bg-slate-50/80 px-3 py-2.5 max-md:gap-1.5 max-md:px-2 max-md:py-2">
                      {notes.length > 0 && editorPanelView === 'noteFields' ? (
                        <div className="flex min-w-0 flex-wrap items-center gap-2 max-md:gap-1.5">
                          <span className="text-sm font-bold uppercase tracking-wide text-slate-400">Notes</span>
                          <div className="h-4 w-px bg-slate-200" aria-hidden />
                          <div className="flex min-w-0 max-w-full items-center gap-2 overflow-x-auto pb-1">
                            {notes.map((note, i) => (
                              <button
                                key={note.noteId}
                                type="button"
                                onClick={() => {
                                  setConsultSubTab(i);
                                  setActiveNoteIndex(i);
                                }}
                                className={`halo-touch-min flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-semibold transition-all ${
                                  consultSubTab === i
                                    ? 'bg-teal-600 text-white shadow-sm shadow-teal-600/20'
                                    : 'bg-white text-slate-600 ring-1 ring-slate-200/80 hover:ring-teal-300/60'
                                }`}
                              >
                                {note.title || `Note ${i + 1}`}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      <div
                        className="flex min-w-0 flex-wrap items-center gap-1.5"
                        role="tablist"
                        aria-label="Editor view"
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={editorPanelView === 'noteFields'}
                          onClick={() => setEditorPanelView('noteFields')}
                          className={`halo-touch-min inline-flex min-w-0 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-[var(--shadow-halo-soft)] transition-all max-md:px-2 max-md:py-1.5 max-md:text-[11px] ${
                            editorPanelView === 'noteFields'
                              ? 'bg-white text-teal-900 ring-2 ring-teal-400/70 ring-offset-1 ring-offset-white'
                              : 'bg-white/90 text-slate-600 ring-1 ring-slate-200/80 hover:bg-white hover:ring-teal-300/50'
                          }`}
                        >
                          <FileText className="size-3.5 shrink-0 max-md:hidden" aria-hidden />
                          <span className="truncate max-md:hidden">Note fields</span>
                          <span className="truncate md:hidden">Fields</span>
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={editorPanelView === 'transcription'}
                          onClick={() => setEditorPanelView('transcription')}
                          className={`halo-touch-min inline-flex min-w-0 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-[var(--shadow-halo-soft)] transition-all max-md:px-2 max-md:py-1.5 max-md:text-[11px] ${
                            editorPanelView === 'transcription'
                              ? 'bg-white text-teal-900 ring-2 ring-teal-400/70 ring-offset-1 ring-offset-white'
                              : 'bg-white/90 text-slate-600 ring-1 ring-slate-200/80 hover:bg-white hover:ring-teal-300/50'
                          }`}
                        >
                          <Captions className="size-3.5 shrink-0 max-md:hidden" aria-hidden />
                          <span className="truncate max-md:hidden">Transcription</span>
                          <span className="truncate md:hidden">Transcript</span>
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={editorPanelView === 'smartContext'}
                          id="editor-smart-context-tab"
                          aria-controls="editor-smart-context-panel"
                          onClick={() => setEditorPanelView('smartContext')}
                          className={`halo-touch-min inline-flex min-w-0 items-center justify-center gap-1.5 rounded-full bg-halo-primary px-3 py-1.5 text-xs font-semibold text-white shadow-[var(--shadow-halo-soft)] transition-all hover:bg-halo-primary-hover max-md:px-2 max-md:py-1.5 max-md:text-[11px] ${
                            editorPanelView === 'smartContext'
                              ? 'ring-2 ring-white/90 ring-offset-1 ring-offset-slate-100'
                              : ''
                          }`}
                        >
                          <Layers className="size-3.5 shrink-0 text-white max-md:hidden" aria-hidden />
                          <span className="truncate max-md:hidden">Smart context</span>
                          <span className="truncate md:hidden">Context</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddNoteModal(true);
                            setSelectedTemplatesForGenerate([]);
                          }}
                          className="halo-touch-min flex size-[38px] shrink-0 items-center justify-center rounded-full bg-teal-50/80 text-teal-700 ring-1 ring-teal-200/80 transition hover:bg-teal-100/90"
                          title="Add note"
                          aria-label="Add note"
                        >
                          <Plus className="size-4" />
                        </button>
                      </div>
                    </div>
                    <div className="flex h-0 min-h-0 flex-1 flex-col overflow-hidden bg-slate-100/50 p-2 md:p-3 max-md:p-1">
                      {editorPanelView === 'noteFields' ? (
                        <div className={`${EDITOR_VIEW_SHELL} min-h-0 max-md:min-h-0 max-md:focus-within:ring-[1.5px] max-md:focus-within:ring-teal-300/90`}>
                          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white max-md:min-h-0 max-md:bg-transparent">
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
                        <div
                          className={`${EDITOR_VIEW_SHELL} max-md:focus-within:ring-[1.5px] max-md:focus-within:ring-teal-300/90`}
                        >
                          <div className={`${EDITOR_VIEW_HEADER} shrink-0 max-md:py-2`}>
                            <div className="flex items-center gap-2">
                              <span className={EDITOR_VIEW_TITLE}>Transcription</span>
                              {isLiveStreaming ? (
                                <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-teal-800 max-md:px-2 max-md:py-1 max-md:text-sm">
                                  Live
                                </span>
                              ) : isTranscriptRefining ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800 max-md:px-2 max-md:py-1 max-md:text-sm">
                                  <Loader2 className="size-3 animate-spin" aria-hidden />
                                  Finalizing
                                </span>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-1.5 max-md:flex-wrap">
                              {canRetryTranscript ? (
                                <button
                                  type="button"
                                  onClick={() => void handleRetryTranscription()}
                                  disabled={isLiveStreaming || isTranscriptRefining || isGeneratingNotes || retryTranscriptBusy}
                                  className="halo-touch-min inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[10px] font-semibold text-teal-800 ring-1 ring-teal-200/80 shadow-sm hover:bg-teal-50 disabled:opacity-40 max-md:px-3 max-md:py-2 max-md:text-sm"
                                >
                                  {retryTranscriptBusy ? (
                                    <Loader2 className="size-3 animate-spin" aria-hidden />
                                  ) : null}
                                  {retryTranscriptBusy ? 'Retrying…' : 'Retry transcript'}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={handleContinueTypedTranscript}
                                disabled={isLiveStreaming || isTranscriptRefining || isGeneratingNotes || !lastTranscript.trim()}
                                className="halo-touch-min inline-flex items-center gap-1 rounded-lg bg-teal-600 px-2.5 py-1 text-[10px] font-semibold text-white shadow-sm hover:bg-teal-700 disabled:opacity-40 max-md:px-3 max-md:py-2 max-md:text-sm"
                              >
                                Continue
                              </button>
                              <button
                                type="button"
                                onClick={handleCopyTranscript}
                                disabled={!currentTranscript.trim()}
                                className="halo-touch-min inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200/80 hover:bg-slate-50 disabled:opacity-40 max-md:px-3 max-md:py-2 max-md:text-sm"
                              >
                                {didCopyTranscript ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                          </div>
                          <div className="editor-transcript-scroll-host bg-white">
                            {isLiveStreaming || isTranscriptRefining ? (
                              <div
                                ref={liveTranscriptScrollRef}
                                className="editor-transcript-scroll editor-transcript-live p-3 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap max-md:p-2.5 max-md:text-[15px] max-md:leading-6"
                              >
                                {isGeneratingNotes ? (
                                  <span className="inline-flex items-center gap-2 text-slate-500">
                                    <Loader2 className="size-4 animate-spin text-teal-600" aria-hidden />
                                  </span>
                                ) : isTranscriptRefining && !currentTranscript.trim() ? (
                                  <span className="inline-flex items-center gap-2 text-slate-500">
                                    <Loader2 className="size-4 animate-spin text-teal-600" aria-hidden />
                                    Finalizing transcript from full recording…
                                  </span>
                                ) : (
                                  currentTranscript
                                )}
                              </div>
                            ) : (
                              <textarea
                                ref={transcriptInputRef}
                                value={lastTranscript}
                                onChange={(e) => setLastTranscript(e.target.value)}
                                disabled={isGeneratingNotes}
                                placeholder="Type your consultation text here, then tap Continue for templates…"
                                className="editor-transcript-scroll border-0 bg-slate-50/50 px-3 py-2.5 text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none focus:ring-0 max-md:bg-transparent max-md:px-2.5 max-md:py-2 max-md:text-[15px] max-md:leading-6 max-md:focus:border-0 max-md:focus:ring-0 md:rounded-none md:border-0 md:bg-white md:px-4 md:py-3"
                              />
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
                                className="halo-touch-min inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200/80 shadow-sm hover:bg-slate-50 disabled:opacity-50 max-md:px-3 max-md:py-2 max-md:text-sm"
                              >
                                {contextEnrichBusy ? <Loader2 className="size-3 animate-spin" /> : <CloudUpload className="size-3" />}
                                {contextEnrichBusy ? '…' : 'Upload'}
                              </button>
                              <button
                                type="button"
                                onClick={openContextDrivePicker}
                                className="halo-touch-min inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200/80 shadow-sm hover:bg-slate-50 max-md:px-3 max-md:py-2 max-md:text-sm"
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
                          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white p-3 max-md:p-2.5">
                            <textarea
                              value={consultContext}
                              onChange={(e) => setConsultContext(e.target.value)}
                              className="min-h-[min(40vh,320px)] w-full flex-1 resize-none overflow-y-auto rounded-lg border border-slate-200/90 bg-slate-50/50 px-3 py-2.5 text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none focus:ring-0 [-webkit-overflow-scrolling:touch] touch-pan-y max-md:min-h-[48dvh] max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-0.5 max-md:py-0.5 max-md:focus:border-0 max-md:focus:ring-0 md:min-h-[12rem]"
                              placeholder="Paste or upload context for this consultation…"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Template choice modal — when new transcript or "+" add note; hide while generating */}
              {(pendingTranscript != null || showAddNoteModal) && !isGeneratingNotes && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-[2px]">
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
                            className={`halo-touch-min flex-1 rounded-md py-2 text-sm font-semibold transition-all ${
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
                          className="flex-1 rounded-lg border border-slate-200/90 bg-slate-50/80 px-3 py-2 text-sm text-slate-800 focus:bg-white focus:border-teal-500/40 focus:ring-1 focus:ring-teal-500/15 outline-none"
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
                                className={`halo-touch-min flex w-full items-center justify-between px-3 py-2 text-sm font-medium transition-all ${
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
                                  <span className="shrink-0 text-sm font-semibold uppercase tracking-wide text-halo-primary">
                                    Selected
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        {(selectedHospital === 'louis_leipoldt' ? templateOptions : activeHospitalConfig.templates).length === 0 && (
                          <div className="px-4 py-6 text-sm text-slate-500 text-center">
                            No templates available. HALO will fall back to the default clinical note.
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={handleGenerateFromTemplates}
                          disabled={selectedTemplatesForGenerate.length === 0 || isGeneratingNotes}
                          className="halo-touch-min rounded-[10px] bg-halo-primary px-3 py-2 text-sm font-semibold text-white shadow-[var(--shadow-halo-soft)] transition hover:bg-halo-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isGeneratingNotes ? '…' : 'Continue'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setPendingTranscript(null); setShowAddNoteModal(false); }}
                          className="halo-touch-min rounded-md border border-slate-200/90 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
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
                          className="halo-touch-min inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-teal-500/25 bg-white px-3 py-2 text-sm font-semibold text-teal-800 transition hover:bg-teal-500/6"
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
              patientName={formatPatientDisplayName(patient.name) || patient.name}
              chatMessages={chatMessages}
              chatInput={chatInput}
              onChatInputChange={setChatInput}
              chatLoading={chatLoading}
              onSendChat={handleSendChat}
              slashOptions={askHaloSlashOptions}
              generatedDocument={generatedChatDocument}
              onDismissGeneratedDocument={() => setGeneratedChatDocument(null)}
            />
          )}
        </div>
      </div>

      {/* Sticker / billing (OCR) — open from green patient breadcrumb or “Profile” in subfolders */}
      {stickerProfileModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sticker-profile-title"
          onClick={() => setStickerProfileModalOpen(false)}
        >
          <div
            className="max-h-[min(90dvh,32rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 id="sticker-profile-title" className="text-base font-bold text-slate-800">
                Sticker &amp; billing details
              </h2>
              <button
                type="button"
                onClick={() => setStickerProfileModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            {haloProfileLoading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-teal-600" />
                Loading profile…
              </div>
            ) : stickerProfileDraft ? (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-1 gap-2.5">
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Full name</span>
                    <input
                      className="mt-0.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                      value={stickerProfileDraft.fullName}
                      onChange={(e) => setStickerProfileDraft((d) => (d ? { ...d, fullName: e.target.value } : d))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">DOB</span>
                    <input
                      type="date"
                      className="mt-0.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                      value={stickerProfileDraft.dob?.slice(0, 10) || ''}
                      onChange={(e) => setStickerProfileDraft((d) => (d ? { ...d, dob: e.target.value } : d))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Sex</span>
                    <select
                      className="mt-0.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                      value={stickerProfileDraft.sex}
                      onChange={(e) =>
                        setStickerProfileDraft((d) =>
                          d ? { ...d, sex: e.target.value === 'F' ? 'F' : 'M' } : d
                        )
                      }
                    >
                      <option value="M">M</option>
                      <option value="F">F</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Patient email</span>
                    <input
                      type="email"
                      className="mt-0.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                      value={stickerProfileDraft.email ?? ''}
                      onChange={(e) => setStickerProfileDraft((d) => (d ? { ...d, email: e.target.value } : d))}
                      placeholder="name@example.com"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">ID number</span>
                    <input
                      className="mt-0.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                      value={stickerProfileDraft.idNumber ?? ''}
                      onChange={(e) => setStickerProfileDraft((d) => (d ? { ...d, idNumber: e.target.value } : d))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Folder number</span>
                    <input
                      className="mt-0.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                      value={stickerProfileDraft.folderNumber ?? ''}
                      onChange={(e) => setStickerProfileDraft((d) => (d ? { ...d, folderNumber: e.target.value } : d))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Ward</span>
                    <input
                      className="mt-0.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                      value={stickerProfileDraft.ward ?? ''}
                      onChange={(e) => setStickerProfileDraft((d) => (d ? { ...d, ward: e.target.value } : d))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Medical aid</span>
                    <input
                      className="mt-0.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                      value={stickerProfileDraft.medicalAidName ?? ''}
                      onChange={(e) => setStickerProfileDraft((d) => (d ? { ...d, medicalAidName: e.target.value } : d))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Plan / option</span>
                    <input
                      className="mt-0.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                      value={stickerProfileDraft.medicalAidPackage ?? ''}
                      onChange={(e) => setStickerProfileDraft((d) => (d ? { ...d, medicalAidPackage: e.target.value } : d))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Member number</span>
                    <input
                      className="mt-0.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                      value={stickerProfileDraft.medicalAidMemberNumber ?? ''}
                      onChange={(e) =>
                        setStickerProfileDraft((d) => (d ? { ...d, medicalAidMemberNumber: e.target.value } : d))
                      }
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Scheme phone</span>
                    <input
                      className="mt-0.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                      value={stickerProfileDraft.medicalAidPhone ?? ''}
                      onChange={(e) => setStickerProfileDraft((d) => (d ? { ...d, medicalAidPhone: e.target.value } : d))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Notes</span>
                    <textarea
                      className="mt-0.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 min-h-[4rem]"
                      value={stickerProfileDraft.rawNotes ?? ''}
                      onChange={(e) => setStickerProfileDraft((d) => (d ? { ...d, rawNotes: e.target.value } : d))}
                    />
                  </label>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-600">Could not load form.</p>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setStickerProfileModalOpen(false)}
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-200"
              >
                Close
              </button>
              <button
                type="button"
                disabled={stickerProfileSaving || haloProfileLoading || !stickerProfileDraft}
                onClick={() => {
                  if (!stickerProfileDraft) return;
                  void (async () => {
                    setStickerProfileSaving(true);
                    try {
                      const d = stickerProfileDraft;
                      const toSave: HaloPatientProfile = {
                        ...d,
                        version: 1,
                        fullName: d.fullName.trim(),
                        dob: d.dob.trim(),
                        sex: d.sex === 'F' ? 'F' : 'M',
                        email: d.email?.trim() || undefined,
                        idNumber: d.idNumber?.trim() || undefined,
                        folderNumber: d.folderNumber?.trim() || undefined,
                        ward: d.ward?.trim() || undefined,
                        medicalAidName: d.medicalAidName?.trim() || undefined,
                        medicalAidPackage: d.medicalAidPackage?.trim() || undefined,
                        medicalAidMemberNumber: d.medicalAidMemberNumber?.trim() || undefined,
                        medicalAidPhone: d.medicalAidPhone?.trim() || undefined,
                        rawNotes: d.rawNotes?.trim() || undefined,
                        updatedAt: new Date().toISOString(),
                      };
                      await uploadPatientHaloProfile(patient.id, toSave);
                      await refreshHaloPatientProfile();
                      onToast('Sticker / billing profile saved.', 'success');
                      setStickerProfileModalOpen(false);
                    } catch (err) {
                      onToast(getErrorMessage(err), 'error');
                    } finally {
                      setStickerProfileSaving(false);
                    }
                  })();
                }}
                className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {stickerProfileSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

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
                    const response = await askHalo(patient.id, prompt, historyForContext, buildAskHaloLiveContext());
                    const content = response.reply?.trim();
                    if (!content) {
                      onToast('HALO did not return any text for this request. Please try again.', 'error');
                    } else {
                      const newNote = await persistCustomGeneratedNote(prompt, content);
                      setNotes((prev) => [...prev, newNote]);
                      const newIndex = notes.length;
                      setActiveNoteIndex(newIndex);
                      setConsultSubTab(newIndex);
                      await loadFolderContents(currentFolderId);
                      onDataChange();
                      setShowCustomAiNoteModal(false);
                      setCustomAiPrompt('');
                      onToast('Note saved', 'success');
                    }
                  } catch (err) {
                    onToast('Save failed — please try again.', 'error');
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

      <MobileDictateFab />
    </div>
  );
};
