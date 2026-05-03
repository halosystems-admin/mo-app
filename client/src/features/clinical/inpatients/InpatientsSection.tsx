import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { registerSheetsDictateOpener } from '../../../lib/sheetsDictateBridge';
import type {
  ClinicalWard,
  InpatientRecord,
  InpatientSheetStatus,
  OtherSurgeonInpatientDraft,
  SurgeonName,
} from '../../../types/clinical';
import type { ExtractedPatientSticker } from '../../../../../shared/types';
import {
  MOCK_INPATIENTS,
  addInpatientRecord,
  applyHaloPatientToAdmissionDraft,
  createEmptyInpatientRecord,
  duplicateInpatientFromTemplate,
  fetchAdmissionsAll,
  getClinicalWards,
  getInpatientById,
  createEmptyOtherSurgeonDraft,
  updateInpatientRecord,
  type RoundFilters,
} from '../../../services/clinicalData';
import type { AdmittedPatientKanban, Patient } from '../../../../../shared/types';
import {
  formatInpatientDisplayName,
  formatWardDisplay,
  resolvePatientIdFromClinicalNames,
  wardBadgeClass,
} from '../shared/clinicalDisplay';
import { exportInpatientsCsv, exportInpatientsPdf, printInpatientsTable } from './sheetsExports';
import { fetchWardKanban } from '../../../services/wardBoardBackend';
import { DischargePatientModal } from '../shared/DischargePatientModal';
import { buildDischargeClinicalContext } from '../shared/dischargeContext';
import { InpatientDetailPanel } from '../shared/InpatientDetailPanel';
import { ClinicalTableScroll } from '../shared/ClinicalTableScroll';
import {
  CLINICAL_BTN_PRIMARY,
  CLINICAL_BTN_SECONDARY,
  CLINICAL_TABLE_TH,
  CLINICAL_TABLE_TBODY_TR,
  CLINICAL_TABLE_THEAD,
} from '../shared/tableScrollClasses';
import {
  Camera,
  ChevronDown,
  FileDown,
  FolderOpen,
  Loader,
  MessageCircle,
  Phone,
  Plus,
  Printer,
  Upload,
  X,
} from 'lucide-react';
import { SheetsDictateModal } from './SheetsDictateModal';
import { StickerCameraModal } from '../../../components/StickerCameraModal';
import { extractPatientFromStickerFile } from '../../../services/api';
import { mergeStickerExtractionIntoDriveProfile } from '../../../services/haloPatientProfileMerge';

const SHEET_STATUS_OPTIONS: InpatientSheetStatus[] = [
  'elective',
  'completed',
  'emergency',
  'outpatient endoscopy',
];

function TableColumnFilter({
  'aria-label': ariaLabel,
  value,
  onChange,
  active,
  children,
}: {
  'aria-label': string;
  value: string;
  onChange: (next: string) => void;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="relative inline-flex size-6 shrink-0 items-center justify-center rounded-md text-white transition-colors hover:bg-white/15"
      title={ariaLabel}
    >
      <select
        aria-label={ariaLabel}
        className="absolute inset-0 z-[1] h-full w-full cursor-pointer opacity-0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </select>
      <ChevronDown
        className={`pointer-events-none size-3.5 text-white ${active ? 'drop-shadow-[0_0_3px_rgba(0,0,0,0.35)]' : 'opacity-90'}`}
        strokeWidth={2.25}
        aria-hidden
      />
    </div>
  );
}

const SURGEON_FILTER_OPTIONS: SurgeonName[] = [
  'Hoosain',
  'Stanley',
  'de Beer',
  'Strydom',
  'Patel',
  'Kruger',
];

function matchesAssignedSurgeon(record: InpatientRecord, surgeon: SurgeonName | ''): boolean {
  if (!surgeon) return true;
  const d = (record.assignedDoctor || '').toLowerCase();
  if (surgeon === 'Hoosain') return d.includes('hoosain') || d.includes('hoosen');
  if (surgeon === 'Patel') return d.includes('patel');
  if (surgeon === 'Kruger') return d.includes('kruger');
  return d.includes(surgeon.toLowerCase());
}

function ageFromIsoDob(dob: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return 0;
  const b = new Date(`${dob}T12:00:00`);
  if (Number.isNaN(b.getTime())) return 0;
  const t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a -= 1;
  return a < 0 ? 0 : a;
}

function mergeStickerOcrIntoDraft(
  d: OtherSurgeonInpatientDraft,
  ex: ExtractedPatientSticker
): OtherSurgeonInpatientDraft {
  let firstName = d.firstName;
  let surname = d.surname;
  const name = ex.name?.trim() ?? '';
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      surname = parts[0] ?? surname;
    } else {
      firstName = parts.slice(0, -1).join(' ') || firstName;
      surname = parts[parts.length - 1] ?? surname;
    }
  }
  const next: OtherSurgeonInpatientDraft = {
    ...d,
    firstName,
    surname,
  };
  const dob = ex.dob?.trim() ?? '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    next.dateOfBirth = dob;
    next.age = ageFromIsoDob(dob);
  }
  if (ex.sex === 'M' || ex.sex === 'F') next.sex = ex.sex;
  if (ex.idNumber?.trim()) next.idNumber = ex.idNumber.trim();
  if (ex.folderNumber?.trim()) next.folderNumber = ex.folderNumber.trim();
  if (ex.ward?.trim()) next.ward = ex.ward.trim() as ClinicalWard;
  if (ex.medicalAidName?.trim()) next.medicalAid = ex.medicalAidName.trim();
  if (ex.medicalAidMemberNumber?.trim()) next.medicalAidNumber = ex.medicalAidMemberNumber.trim();
  if (ex.medicalAidPhone?.trim()) next.medicalAidPhone = ex.medicalAidPhone.trim();
  if (ex.email?.trim()) next.email = ex.email.trim();
  const extra: string[] = [];
  if (ex.medicalAidPackage?.trim()) extra.push(`Plan: ${ex.medicalAidPackage.trim()}`);
  if (ex.rawNotes?.trim()) extra.push(ex.rawNotes.trim());
  if (extra.length) {
    const add = extra.join('\n');
    next.furtherComment = d.furtherComment?.trim() ? `${d.furtherComment.trim()}\n${add}` : add;
  }
  return next;
}

/** Anchor for start/end date filters: admission first, then review, then follow-up date. */
function sheetListAnchorDate(r: InpatientRecord): string {
  return (
    (r.dateOfAdmission && r.dateOfAdmission.trim()) ||
    (r.dateOfReview && r.dateOfReview.trim()) ||
    (r.dateOfFollowUp && r.dateOfFollowUp.trim()) ||
    ''
  );
}

/** Start/end filters use the first available of: date of admission, date of review, follow-up date. */
function inpatientInDateWindow(r: InpatientRecord, start?: string, end?: string): boolean {
  if (!start && !end) return true;
  const anchor = sheetListAnchorDate(r);
  if (!anchor) return false;
  if (start && anchor < start) return false;
  if (end && anchor > end) return false;
  return true;
}

interface Props {
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
  patients?: Patient[];
  onOpenPatient?: (patientId: string) => void;
}

export const InpatientsSection: React.FC<Props> = ({ onToast, patients = [], onOpenPatient }) => {
  const [rows, setRows] = useState<InpatientRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<OtherSurgeonInpatientDraft>(() => createEmptyOtherSurgeonDraft());
  const [stickerBusy, setStickerBusy] = useState(false);
  const stickerScanInputRef = useRef<HTMLInputElement>(null);
  const [showStickerScanCamera, setShowStickerScanCamera] = useState(false);
  const [lastStickerScanFileName, setLastStickerScanFileName] = useState<string | null>(null);
  const [showAddAdmission, setShowAddAdmission] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [newAdmission, setNewAdmission] = useState<InpatientRecord>(() => createEmptyInpatientRecord());
  const [addHaloPatientId, setAddHaloPatientId] = useState('');
  const [addTemplateId, setAddTemplateId] = useState('');
  const addHaloRef = useRef(addHaloPatientId);
  const addTemplateRef = useRef(addTemplateId);
  addHaloRef.current = addHaloPatientId;
  addTemplateRef.current = addTemplateId;

  const [statusFilter, setStatusFilter] = useState<'' | InpatientSheetStatus>('');
  const [taskFilter, setTaskFilter] = useState<'' | 'vericlaim_open' | 'aslip_open'>('');

  const [roundFilters, setRoundFilters] = useState<RoundFilters>(() => ({
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    surgeon: '',
    ward: '',
  }));

  const [dischargeRecord, setDischargeRecord] = useState<InpatientRecord | null>(null);
  const [dischargeKanbanRow, setDischargeKanbanRow] = useState<AdmittedPatientKanban | null>(null);
  const [showDictate, setShowDictate] = useState(false);

  const resolveHaloId = useCallback(
    (r: InpatientRecord) =>
      r.linkedDrivePatientId?.trim() || resolvePatientIdFromClinicalNames(patients, r.firstName, r.surname) || null,
    [patients]
  );

  const openDischargeFlow = useCallback(
    async (r: InpatientRecord) => {
      setDischargeRecord(r);
      setDischargeKanbanRow(null);
      const hid = resolveHaloId(r);
      if (!hid) return;
      try {
        const kanban = await fetchWardKanban();
        const row = (Array.isArray(kanban) ? kanban : []).find((k) => k.patientId === hid);
        setDischargeKanbanRow(row ?? null);
      } catch {
        /* ignore */
      }
    },
    [resolveHaloId]
  );

  const closeDischargeModal = useCallback(() => {
    setDischargeRecord(null);
    setDischargeKanbanRow(null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAdmissionsAll();
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return registerSheetsDictateOpener(() => setShowDictate(true));
  }, []);

  const patchRow = useCallback(
    async (id: string, patch: Partial<InpatientRecord>) => {
      await updateInpatientRecord(id, patch);
      await load();
    },
    [load]
  );

  const displayedRows = useMemo(() => {
    return rows.filter((r) => {
      if (!inpatientInDateWindow(r, roundFilters.startDate, roundFilters.endDate)) return false;
      if (roundFilters.ward && r.ward !== roundFilters.ward) return false;
      if (!matchesAssignedSurgeon(r, roundFilters.surgeon ?? '')) return false;
      if (statusFilter && r.sheetStatus !== statusFilter) return false;
      if (taskFilter === 'vericlaim_open' && r.taskPendingVericlaimDone) return false;
      if (taskFilter === 'aslip_open' && r.taskDownloadSlipDone) return false;
      return true;
    });
  }, [rows, roundFilters, statusFilter, taskFilter]);

  const wards = useMemo(() => getClinicalWards(), []);

  const selected = selectedId ? getInpatientById(selectedId) : undefined;

  const openAddAdmissionModal = () => {
    setNewAdmission(createEmptyInpatientRecord());
    setAddHaloPatientId('');
    setAddTemplateId('');
    setShowAddAdmission(true);
  };

  const applyAddFormHalo = (patientId: string) => {
    setAddHaloPatientId(patientId);
    const p = patientId ? patients.find((x) => x.id === patientId) ?? null : null;
    const tid = addTemplateRef.current;
    setNewAdmission((prev) => {
      if (tid) {
        const base = duplicateInpatientFromTemplate(tid);
        return applyHaloPatientToAdmissionDraft(base, p);
      }
      return applyHaloPatientToAdmissionDraft(prev, p);
    });
  };

  const applyAddFormTemplate = (templateId: string) => {
    setAddTemplateId(templateId);
    const haloId = addHaloRef.current;
    const p = patients.find((x) => x.id === haloId) ?? null;
    setNewAdmission(() => {
      if (!templateId) {
        const empty = createEmptyInpatientRecord();
        return applyHaloPatientToAdmissionDraft(empty, p);
      }
      const base = duplicateInpatientFromTemplate(templateId);
      return applyHaloPatientToAdmissionDraft(base, p);
    });
  };

  const saveNewAdmission = async () => {
    if (!newAdmission.firstName.trim() || !newAdmission.surname.trim()) {
      onToast?.('First name and surname are required.', 'info');
      return;
    }
    setAddSaving(true);
    try {
      const saved = await addInpatientRecord(newAdmission);
      await load();
      setShowAddAdmission(false);
      setSelectedId(saved.id);
      onToast?.('Admission added to sheet.', 'success');
    } catch {
      onToast?.('Could not save admission.', 'error');
    } finally {
      setAddSaving(false);
    }
  };

  const applyStickerFromFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      onToast?.('Please use an image file.', 'info');
      return;
    }
    setStickerBusy(true);
    try {
      const ex = await extractPatientFromStickerFile(file);
      setLastStickerScanFileName(file.name);
      const merged = mergeStickerOcrIntoDraft(draft, ex);
      setDraft(merged);
      const selectedRow = selectedId ? getInpatientById(selectedId) : undefined;
      let driveId =
        selectedRow?.linkedDrivePatientId?.trim() || merged.linkedDrivePatientId?.trim() || '';
      if (!driveId) {
        driveId = resolvePatientIdFromClinicalNames(patients, merged.firstName, merged.surname) || '';
      }
      if (driveId) {
        try {
          await mergeStickerExtractionIntoDriveProfile(driveId, ex);
          onToast?.('Fields updated from sticker; HALO folder profile updated.', 'success');
        } catch {
          onToast?.('Fields updated from sticker; could not update HALO profile file.', 'error');
        }
      } else {
        onToast?.('Fields updated from sticker.', 'success');
      }
    } catch {
      onToast?.('Could not read sticker image.', 'error');
      setLastStickerScanFileName(null);
    } finally {
      setStickerBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">All patients</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            title="Download filtered rows as CSV"
            onClick={() => exportInpatientsCsv(displayedRows)}
            disabled={displayedRows.length === 0}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <FileDown size={14} /> CSV
          </button>
          <button
            type="button"
            title="Download filtered rows as PDF"
            onClick={() => exportInpatientsPdf(displayedRows)}
            disabled={displayedRows.length === 0}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <FileDown size={14} /> PDF
          </button>
          <button
            type="button"
            title="Print filtered rows"
            onClick={() => printInpatientsTable(displayedRows)}
            disabled={displayedRows.length === 0}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <Printer size={14} /> Print
          </button>
          <button type="button" onClick={openAddAdmissionModal} className={`${CLINICAL_BTN_PRIMARY} gap-1.5`}>
            <Plus size={14} />
            New admission
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-white rounded-xl border border-slate-200 p-4">
        <div>
          <label className="text-xs font-semibold text-slate-600">Start date</label>
          <input
            type="date"
            className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-200 text-sm"
            value={roundFilters.startDate || ''}
            onChange={(e) => setRoundFilters((f) => ({ ...f, startDate: e.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600">End date</label>
          <input
            type="date"
            className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-200 text-sm"
            value={roundFilters.endDate || ''}
            onChange={(e) => setRoundFilters((f) => ({ ...f, endDate: e.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600">Surgeon</label>
          <select
            className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-200 text-sm"
            value={roundFilters.surgeon || ''}
            onChange={(e) =>
              setRoundFilters((f) => ({ ...f, surgeon: e.target.value as SurgeonName | '' }))
            }
          >
            <option value="">All</option>
            {SURGEON_FILTER_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600">Ward</label>
          <select
            className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-200 text-sm"
            value={roundFilters.ward || ''}
            onChange={(e) =>
              setRoundFilters((f) => ({ ...f, ward: e.target.value as ClinicalWard | '' }))
            }
          >
            <option value="">All</option>
            {wards.map((w) => (
              <option key={w} value={w}>
                {formatWardDisplay(w)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <details className="group bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <summary className="cursor-pointer list-none flex items-center justify-between gap-3 px-4 py-3 bg-gradient-to-r from-teal-50/90 to-slate-50/80 border-b border-slate-100 hover:from-teal-50 hover:to-slate-50 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2.5 min-w-0 text-sm font-semibold text-teal-900">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white border border-teal-100 shadow-sm">
              <Upload size={16} className="text-teal-600" aria-hidden />
            </span>
            <span className="select-none min-w-0 text-left leading-tight">Scan sticker</span>
          </span>
          <ChevronDown
            className="size-5 shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-180"
            strokeWidth={2}
            aria-hidden
          />
        </summary>
        <div className="p-4 space-y-3 bg-white">
        <input
          ref={stickerScanInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void applyStickerFromFile(f);
          }}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            disabled={stickerBusy}
            onClick={() => stickerScanInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-teal-200 bg-teal-50 text-sm font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-50"
          >
            {stickerBusy ? <Loader className="animate-spin w-4 h-4" /> : <Upload className="w-4 h-4" />}
            {stickerBusy ? 'Scanning…' : 'Gallery / file'}
          </button>
          <button
            type="button"
            disabled={stickerBusy}
            onClick={() => setShowStickerScanCamera(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            <Camera className="w-4 h-4" />
            Live camera
          </button>
          {lastStickerScanFileName ? (
            <span className="text-xs text-slate-600 self-center truncate max-w-[200px]" title={lastStickerScanFileName}>
              {lastStickerScanFileName}
            </span>
          ) : null}
          {onOpenPatient ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => {
                const id = resolvePatientIdFromClinicalNames(patients, draft.firstName, draft.surname);
                if (id) onOpenPatient(id);
                else
                  onToast?.(
                    'No HALO patient matches these names — open Patients and find consent or sticker files there.',
                    'info'
                  );
              }}
            >
              <FolderOpen size={16} className="text-teal-500" />
              Open patient folder in HALO
            </button>
          ) : null}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-semibold text-slate-600">Surgeon</label>
            <select
              className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-200 text-sm"
              value={draft.surgeon}
              onChange={(e) =>
                setDraft((d) => ({ ...d, surgeon: e.target.value as OtherSurgeonInpatientDraft['surgeon'] }))
              }
            >
              {(['Hoosain', 'Stanley', 'de Beer', 'Strydom', 'Patel', 'Kruger'] as const).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Weekend Round Complete</label>
            <select
              className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-200 text-sm"
              value={draft.weekendRoundComplete ? 'Y' : 'N'}
              onChange={(e) => setDraft((d) => ({ ...d, weekendRoundComplete: e.target.value === 'Y' }))}
            >
              <option value="N">N</option>
              <option value="Y">Y</option>
            </select>
          </div>
        </div>

        {[
          ['Surname', 'surname'],
          ['First Name', 'firstName'],
          ['Patient email', 'email'],
          ['Folder Number', 'folderNumber'],
          ['Bed', 'bed'],
          ['Date of Birth', 'dateOfBirth'],
          ['ID Number', 'idNumber'],
          ['Admission Diagnosis', 'admissionDiagnosis'],
          ['ICD-10', 'icd10Diagnoses'],
          ['Procedure', 'procedure'],
          ['Procedure Codes', 'procedureCodes'],
          ['Date of Procedure', 'dateOfProcedure'],
          ['Complications', 'complications'],
          ['Surgeon Plan', 'surgeonPlan'],
          ['Management Plan', 'managementPlan'],
          ['Inpatient Notes', 'inpatientNotes'],
          ['Further Comment', 'furtherComment'],
        ].map(([label, key]) => (
          <div key={key}>
            <label className="text-xs font-semibold text-slate-600">{label}</label>
            <input
              className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-200 text-sm"
              value={String((draft as unknown as Record<string, string | boolean>)[key] ?? '')}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
            />
          </div>
        ))}

        <button
          type="button"
          className={CLINICAL_BTN_PRIMARY}
          onClick={() => onToast?.('Draft saved locally.', 'success')}
        >
          Save
        </button>
        </div>
      </details>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <ClinicalTableScroll>
          <table
            className="text-sm border-collapse border border-slate-200 table-fixed"
            style={{ width: 4560, minWidth: 4560 }}
          >
            <thead className={CLINICAL_TABLE_THEAD}>
              <tr>
                <th className={`${CLINICAL_TABLE_TH} w-10 whitespace-nowrap text-center`}>#</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Ward</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Bed</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Name</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Surgeon</th>
                <th className={CLINICAL_TABLE_TH}>Diagnosis</th>
                <th className={CLINICAL_TABLE_TH}>Complications</th>
                <th className={CLINICAL_TABLE_TH}>Surg plan</th>
                <th className={CLINICAL_TABLE_TH}>Mx plan</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Date of Discharge</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>
                  <div className="flex items-center gap-1.5">
                    <span>Tasks</span>
                    <TableColumnFilter
                      aria-label="Filter tasks: show rows with open Pending Vericlaim or Download-a-Slip"
                      value={taskFilter}
                      active={Boolean(taskFilter)}
                      onChange={(v) => setTaskFilter((v || '') as '' | 'vericlaim_open' | 'aslip_open')}
                    >
                      <option value="">All tasks</option>
                      <option value="vericlaim_open">Pending Vericlaim (not done)</option>
                      <option value="aslip_open">Download-a-Slip (not done)</option>
                    </TableColumnFilter>
                  </div>
                </th>
                <th className={CLINICAL_TABLE_TH}>Notes</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Date of admission</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Follow-up date</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Admitted</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>
                  <div className="flex items-center gap-1.5">
                    <span>Status</span>
                    <TableColumnFilter
                      aria-label="Filter by admission sheet status"
                      value={statusFilter}
                      active={Boolean(statusFilter)}
                      onChange={(v) => setStatusFilter((v || '') as '' | InpatientSheetStatus)}
                    >
                      <option value="">All statuses</option>
                      {SHEET_STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </TableColumnFilter>
                  </div>
                </th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Folder</th>
                <th className={CLINICAL_TABLE_TH}>Procedure</th>
                <th className={CLINICAL_TABLE_TH}>Long-term FU plan</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>DOB</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>ID</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Contact number</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Sex</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Age</th>
                <th className={CLINICAL_TABLE_TH}>ICD-10</th>
                <th className={CLINICAL_TABLE_TH}>Procedure codes</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Date of procedure</th>
                <th className={CLINICAL_TABLE_TH}>Medical aid</th>
                <th className={CLINICAL_TABLE_TH}>Medical aid number</th>
              </tr>
            </thead>
            <tbody>
              {displayedRows.map((r, rowIndex) => (
                <tr key={r.id} className={CLINICAL_TABLE_TBODY_TR} onClick={() => setSelectedId(r.id)}>
                  <td className="px-2 py-2 text-center text-[11px] tabular-nums text-slate-500 align-top">
                    {rowIndex + 1}
                  </td>
                  <td className="px-2 py-2 align-top">
                    <span className={wardBadgeClass(r.ward)}>{formatWardDisplay(r.ward)}</span>
                  </td>
                  <td className="px-2 py-2 text-[13px] align-top whitespace-nowrap">{r.bed}</td>
                  <td className="px-2 py-2 font-semibold text-[13px] align-top whitespace-nowrap">
                    {formatInpatientDisplayName(r.firstName, r.surname)}
                  </td>
                  <td className="px-2 py-2 text-[12px] align-top whitespace-nowrap">{r.assignedDoctor || '—'}</td>
                  <td className="px-2 py-2 text-[12px] align-top break-words max-w-[200px]" title={r.admissionDiagnosis}>
                    {r.admissionDiagnosis?.trim() ? r.admissionDiagnosis : '—'}
                  </td>
                  <td className="px-2 py-2 text-[12px] align-top break-words max-w-[140px]">{r.complications || '—'}</td>
                  <td className="px-2 py-1 align-top min-w-[120px]" onClick={(e) => e.stopPropagation()}>
                    <input
                      className="w-full min-w-0 rounded border border-slate-200 px-1 py-1 text-[11px]"
                      defaultValue={r.surgeonPlan}
                      key={`${r.id}-sp`}
                      onBlur={(e) => void patchRow(r.id, { surgeonPlan: e.currentTarget.value })}
                    />
                  </td>
                  <td className="px-2 py-1 align-top min-w-[120px]" onClick={(e) => e.stopPropagation()}>
                    <input
                      className="w-full min-w-0 rounded border border-slate-200 px-1 py-1 text-[11px]"
                      defaultValue={r.managementPlan}
                      key={`${r.id}-mp`}
                      onBlur={(e) => void patchRow(r.id, { managementPlan: e.currentTarget.value })}
                    />
                  </td>
                  <td className="px-2 py-1 align-top whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="date"
                      className="rounded border border-slate-200 px-1 py-1 text-[11px]"
                      value={r.dateOfDischarge?.slice(0, 10) || ''}
                      onChange={(e) => void patchRow(r.id, { dateOfDischarge: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1 align-top text-[11px]" onClick={(e) => e.stopPropagation()}>
                    <label className="flex items-center gap-1.5 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={r.taskPendingVericlaimDone}
                        onChange={(e) => void patchRow(r.id, { taskPendingVericlaimDone: e.target.checked })}
                      />
                      Pending Vericlaim
                    </label>
                    <label className="flex items-center gap-1.5 whitespace-nowrap mt-1">
                      <input
                        type="checkbox"
                        checked={r.taskDownloadSlipDone}
                        onChange={(e) => void patchRow(r.id, { taskDownloadSlipDone: e.target.checked })}
                      />
                      Download-a-Slip
                    </label>
                  </td>
                  <td className="px-2 py-1 align-top min-w-[140px]" onClick={(e) => e.stopPropagation()}>
                    <textarea
                      className="w-full min-h-[48px] rounded border border-slate-200 px-1 py-1 text-[11px]"
                      defaultValue={r.inpatientNotes}
                      key={`${r.id}-notes`}
                      onBlur={(e) => void patchRow(r.id, { inpatientNotes: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1 align-top whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="date"
                      className="rounded border border-slate-200 px-1 py-1 text-[11px]"
                      value={r.dateOfAdmission?.slice(0, 10) || ''}
                      onChange={(e) => void patchRow(r.id, { dateOfAdmission: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1 align-top whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="date"
                      className="rounded border border-slate-200 px-1 py-1 text-[11px]"
                      value={r.dateOfFollowUp?.slice(0, 10) || ''}
                      onChange={(e) => void patchRow(r.id, { dateOfFollowUp: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1 align-top whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <select
                      className="rounded border border-slate-200 px-1 py-1 text-[11px]"
                      value={r.currentlyAdmitted ? 'Yes' : 'No'}
                      onChange={(e) => void patchRow(r.id, { currentlyAdmitted: e.target.value === 'Yes' })}
                    >
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                  </td>
                  <td className="px-2 py-1 align-top whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <select
                      className="max-w-[10rem] rounded border border-slate-200 px-1 py-1 text-[11px]"
                      value={r.sheetStatus}
                      onChange={(e) =>
                        void patchRow(r.id, { sheetStatus: e.target.value as InpatientSheetStatus })
                      }
                    >
                      {SHEET_STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2 text-[12px] align-top whitespace-nowrap">{r.folderNumber}</td>
                  <td className="px-2 py-2 text-[12px] align-top break-words max-w-[160px]">{r.procedure?.trim() || '—'}</td>
                  <td className="px-2 py-2 text-[12px] align-top break-words max-w-[200px]">{r.followUpPlan?.trim() || '—'}</td>
                  <td className="px-2 py-2 text-[11px] align-top whitespace-nowrap">{r.dateOfBirth}</td>
                  <td className="px-2 py-2 text-[11px] align-top whitespace-nowrap">{r.idNumber}</td>
                  <td className="px-2 py-2 text-[11px] align-top" onClick={(e) => e.stopPropagation()}>
                    {r.contactNumber?.trim() ? (
                      <span className="inline-flex items-center gap-1 flex-wrap tabular-nums">
                        <span>{r.contactNumber}</span>
                        <span className="inline-flex gap-0.5 text-teal-600">
                          <a
                            href={`tel:${r.contactNumber.replace(/\s/g, '')}`}
                            className="p-0.5 rounded-md hover:bg-teal-100"
                            aria-label="Call"
                          >
                            <Phone size={12} />
                          </a>
                          <a
                            href={`sms:${r.contactNumber.replace(/\s/g, '')}`}
                            className="p-0.5 rounded-md hover:bg-teal-100"
                            aria-label="Message"
                          >
                            <MessageCircle size={12} />
                          </a>
                        </span>
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-2 py-2 align-top">{r.sex}</td>
                  <td className="px-2 py-2 align-top">{r.age}</td>
                  <td className="px-2 py-2 text-[11px] align-top">{r.icd10Diagnoses}</td>
                  <td className="px-2 py-2 text-[11px] align-top">{r.procedureCodes}</td>
                  <td className="px-2 py-2 text-[11px] align-top whitespace-nowrap">{r.dateOfProcedure || '—'}</td>
                  <td className="px-2 py-2 text-[11px] align-top">{r.medicalAid}</td>
                  <td className="px-2 py-2 text-[11px] align-top whitespace-nowrap">{r.medicalAidNumber || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ClinicalTableScroll>
      )}

      {selected && (
        <InpatientDetailPanel
          record={selected}
          patients={patients}
          onToast={onToast}
          onClose={() => setSelectedId(null)}
          onSaved={() => void load()}
          onRequestDischarge={() => void openDischargeFlow(selected)}
          onOpenDictate={() => setShowDictate(true)}
        />
      )}

      <DischargePatientModal
        open={Boolean(dischargeRecord)}
        onClose={closeDischargeModal}
        patients={patients}
        haloPatientId={dischargeRecord ? resolveHaloId(dischargeRecord) : null}
        patientDisplayName={
          dischargeRecord
            ? formatInpatientDisplayName(dischargeRecord.firstName, dischargeRecord.surname)
            : ''
        }
        clinicalContext={buildDischargeClinicalContext(dischargeRecord ?? undefined, dischargeKanbanRow ?? undefined)}
        initialSummaryText={dischargeRecord?.inpatientNotes?.trim() || ''}
        inpatientRecord={dischargeRecord}
        onFinished={async () => {
          await load();
          setSelectedId(null);
        }}
        onToast={onToast}
      />

      <SheetsDictateModal
        open={showDictate}
        onClose={() => setShowDictate(false)}
        patient={selected ?? null}
        onApply={async (id, patch) => {
          await patchRow(id, patch);
        }}
        onToast={onToast}
      />

      <StickerCameraModal
        isOpen={showStickerScanCamera}
        onClose={() => setShowStickerScanCamera(false)}
        onCapture={(file) => void applyStickerFromFile(file)}
      />

      {showAddAdmission && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto border border-slate-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800">New admission</h2>
              <button
                type="button"
                onClick={() => setShowAddAdmission(false)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div>
                <label className="text-xs font-semibold text-slate-600">HALO patient folder (autofill name, DOB, link)</label>
                <select
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200"
                  value={addHaloPatientId}
                  onChange={(e) => applyAddFormHalo(e.target.value)}
                >
                  <option value="">— None —</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Autofill from existing demo admission</label>
                <select
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200"
                  value={addTemplateId}
                  onChange={(e) => applyAddFormTemplate(e.target.value)}
                >
                  <option value="">— Blank —</option>
                  {MOCK_INPATIENTS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {formatInpatientDisplayName(m.firstName, m.surname)} · {m.admissionDiagnosis || '—'}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold text-slate-600">First name</label>
                  <input
                    className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-200"
                    value={newAdmission.firstName}
                    onChange={(e) => setNewAdmission((d) => ({ ...d, firstName: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600">Surname</label>
                  <input
                    className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-200"
                    value={newAdmission.surname}
                    onChange={(e) => setNewAdmission((d) => ({ ...d, surname: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Admission diagnosis</label>
                <input
                  className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-200"
                  value={newAdmission.admissionDiagnosis}
                  onChange={(e) => setNewAdmission((d) => ({ ...d, admissionDiagnosis: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Long-term / outpatient follow-up plan</label>
                <textarea
                  className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-200 min-h-[72px]"
                  value={newAdmission.followUpPlan}
                  onChange={(e) => setNewAdmission((d) => ({ ...d, followUpPlan: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Follow-up date</label>
                <input
                  type="date"
                  className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-200"
                  value={newAdmission.dateOfFollowUp?.slice(0, 10) || ''}
                  onChange={(e) => setNewAdmission((d) => ({ ...d, dateOfFollowUp: e.target.value }))}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => void saveNewAdmission()}
                  disabled={addSaving}
                  className={`${CLINICAL_BTN_PRIMARY} flex-1 justify-center`}
                >
                  {addSaving ? 'Saving…' : 'Add to sheet'}
                </button>
                <button type="button" onClick={() => setShowAddAdmission(false)} className={CLINICAL_BTN_SECONDARY}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
