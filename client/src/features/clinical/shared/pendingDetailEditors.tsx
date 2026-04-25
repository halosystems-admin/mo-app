import React, { useMemo } from 'react';
import type {
  AslipSummaryFields,
  ClinicalWard,
  EndoscopyListFields,
  PendingProcedureRow,
  TheatreBookingFields,
  VericlaimFields,
  VericlaimProcessPending,
} from '../../../types/clinical';
import type { Patient, UserSettings } from '../../../../../shared/types';
import { CLINICAL_DEMO_FIELD_LABELS, THEATRE_BOOKING_DETAIL_KEY_ORDER, THEATRE_BOOKING_LABELS } from './clinicalFieldLabels';
import { getClinicalWards } from '../../../services/clinicalData';
import { downloadAslipPdf } from '../tools/ClinicalExportMock';
import { formatWardDisplay, resolvePatientIdFromClinicalNames } from './clinicalDisplay';
import { MockFileAttachRow } from './MockFileAttachRow';

export type FileAttachExtras = {
  canOpenPatientFolder: boolean;
  onOpenPatientFolder?: () => void;
};

const inp =
  'w-full px-2 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 bg-white focus:ring-2 focus:ring-teal-500/30 focus:border-teal-400';

const WARDS = getClinicalWards();

function setTb(
  draft: PendingProcedureRow,
  patch: Partial<TheatreBookingFields>
): PendingProcedureRow {
  const cur = draft.theatreBooking;
  if (!cur) return draft;
  return { ...draft, theatreBooking: { ...cur, ...patch } };
}

export function TheatreBlockEditor({
  draft,
  setDraft,
  fileAttachExtras,
}: {
  draft: PendingProcedureRow;
  setDraft: React.Dispatch<React.SetStateAction<PendingProcedureRow>>;
  fileAttachExtras?: FileAttachExtras;
}): React.ReactNode {
  const b = draft.theatreBooking;
  if (!b) {
    return <p className="text-sm text-amber-700">No theatre payload on this row.</p>;
  }

  const row = (key: string, label: string, node: React.ReactNode) => (
    <label key={key} className="block sm:col-span-2">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      <div className="mt-0.5">{node}</div>
    </label>
  );

  const nodes: React.ReactNode[] = [];
  for (const key of THEATRE_BOOKING_DETAIL_KEY_ORDER) {
    const label = THEATRE_BOOKING_LABELS[key];
    const v = b[key];
    if (key === 'sex') {
      nodes.push(
        row(
          key,
          label,
          <select
            className={inp}
            value={b.sex}
            onChange={(e) => setDraft((d) => setTb(d, { sex: e.target.value as 'M' | 'F' }))}
          >
            <option value="M">M</option>
            <option value="F">F</option>
          </select>
        )
      );
      continue;
    }
    if (key === 'urgencyOfBooking') {
      nodes.push(
        row(
          key,
          label,
          <select
            className={inp}
            value={b.urgencyOfBooking}
            onChange={(e) =>
              setDraft((d) =>
                setTb(d, { urgencyOfBooking: e.target.value as TheatreBookingFields['urgencyOfBooking'] })
              )
            }
          >
            <option value="emergency">Emergency</option>
            <option value="elective">Elective</option>
          </select>
        )
      );
      continue;
    }
    if (key === 'status') {
      nodes.push(
        row(
          key,
          label,
          <select
            className={inp}
            value={b.status}
            onChange={(e) =>
              setDraft((d) => setTb(d, { status: e.target.value as TheatreBookingFields['status'] }))
            }
          >
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        )
      );
      continue;
    }
    if (
      key === 'consentObtained' ||
      key === 'bookedWithTheatre' ||
      key === 'anaesthesiaArranged' ||
      key === 'assistantArranged'
    ) {
      nodes.push(
        row(
          key,
          label,
          <select
            className={inp}
            value={b[key]}
            onChange={(e) => setDraft((d) => setTb(d, { [key]: e.target.value as '' | 'Y' | 'N' }))}
          >
            <option value="">—</option>
            <option value="Y">Yes</option>
            <option value="N">No</option>
          </select>
        )
      );
      continue;
    }
    if (key === 'dateOfBirth' || key === 'dateOfCompletion' || key === 'dateOfPlannedProcedure') {
      nodes.push(
        row(
          key,
          label,
          <input
            type="date"
            className={inp}
            value={String(v)}
            onChange={(e) => setDraft((d) => setTb(d, { [key]: e.target.value }))}
          />
        )
      );
      continue;
    }
    if (key === 'startTime' || key === 'endTime') {
      nodes.push(
        row(
          key,
          label,
          <input
            type="time"
            className={inp}
            value={String(v)}
            onChange={(e) => setDraft((d) => setTb(d, { [key]: e.target.value }))}
          />
        )
      );
      continue;
    }
    if (key === 'diagnosis') {
      nodes.push(
        row(
          key,
          label,
          <textarea
            className={`${inp} min-h-[52px]`}
            value={String(v)}
            onChange={(e) => setDraft((d) => setTb(d, { diagnosis: e.target.value }))}
          />
        )
      );
      continue;
    }
    if (key === 'consentPdfFileName') {
      nodes.push(
        <div key={key} className="sm:col-span-2">
          <MockFileAttachRow
            label={label}
            description="Upload the signed consent form (PDF). Demo only: the file is recorded on this row, not uploaded to a server."
            accept="application/pdf,.pdf"
            fileName={b.consentPdfFileName}
            uploadedAt={b.consentPdfUploadedAt}
            sizeBytes={b.consentPdfSizeBytes}
            onChooseFile={(file) =>
              setDraft((d) =>
                setTb(d, {
                  consentPdfFileName: file.name,
                  consentPdfUploadedAt: new Date().toISOString(),
                  consentPdfSizeBytes: file.size,
                })
              )
            }
            onClear={() =>
              setDraft((d) =>
                setTb(d, {
                  consentPdfFileName: undefined,
                  consentPdfUploadedAt: undefined,
                  consentPdfSizeBytes: undefined,
                })
              )
            }
            openFolderAction={
              fileAttachExtras?.canOpenPatientFolder && fileAttachExtras.onOpenPatientFolder
                ? { label: 'Open patient folder in HALO', onClick: fileAttachExtras.onOpenPatientFolder }
                : undefined
            }
          />
        </div>
      );
      continue;
    }
    if (key === 'theatreSheetFileName') {
      nodes.push(
        <div key={key} className="sm:col-span-2">
          <MockFileAttachRow
            label={label}
            description="Attach the theatre sheet (PDF or a photo scan)."
            accept="application/pdf,image/*,.pdf,.png,.jpg,.jpeg"
            fileName={b.theatreSheetFileName}
            uploadedAt={b.theatreSheetUploadedAt}
            sizeBytes={b.theatreSheetSizeBytes}
            onChooseFile={(file) =>
              setDraft((d) =>
                setTb(d, {
                  theatreSheetFileName: file.name,
                  theatreSheetUploadedAt: new Date().toISOString(),
                  theatreSheetSizeBytes: file.size,
                })
              )
            }
            onClear={() =>
              setDraft((d) =>
                setTb(d, {
                  theatreSheetFileName: undefined,
                  theatreSheetUploadedAt: undefined,
                  theatreSheetSizeBytes: undefined,
                })
              )
            }
            openFolderAction={
              fileAttachExtras?.canOpenPatientFolder && fileAttachExtras.onOpenPatientFolder
                ? { label: 'Open patient folder in HALO', onClick: fileAttachExtras.onOpenPatientFolder }
                : undefined
            }
          />
        </div>
      );
      continue;
    }
    nodes.push(
      row(
        key,
        label,
        <input
          className={inp}
          value={String(v ?? '')}
          onChange={(e) => setDraft((d) => setTb(d, { [key]: e.target.value } as Partial<TheatreBookingFields>))}
        />
      )
    );
  }

  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{nodes}</div>;
}

export function ListSummaryEditor({
  draft,
  setDraft,
  bucket,
}: {
  draft: PendingProcedureRow;
  setDraft: React.Dispatch<React.SetStateAction<PendingProcedureRow>>;
  bucket: PendingProcedureRow['bucket'];
}): React.ReactNode {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
      <label className="block sm:col-span-2">
        <span className="text-xs font-semibold text-slate-600">Display name</span>
        <input
          className={`mt-0.5 ${inp}`}
          value={draft.patientDisplayName}
          onChange={(e) => setDraft((d) => ({ ...d, patientDisplayName: e.target.value }))}
        />
      </label>
      <label className="block sm:col-span-2">
        <span className="text-xs font-semibold text-slate-600">Procedure</span>
        <input
          className={`mt-0.5 ${inp}`}
          value={draft.procedure}
          onChange={(e) => setDraft((d) => ({ ...d, procedure: e.target.value }))}
        />
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-slate-600">Scheduled date</span>
        <input
          className={`mt-0.5 ${inp}`}
          value={draft.scheduledDate ?? ''}
          onChange={(e) => setDraft((d) => ({ ...d, scheduledDate: e.target.value || undefined }))}
        />
      </label>
      {(bucket === 'emergencies' || bucket === 'elective' || bucket === 'completed') && (
        <>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Urgency</span>
            <select
              className={`mt-0.5 ${inp}`}
              value={draft.urgency ?? ''}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  urgency: (e.target.value || undefined) as PendingProcedureRow['urgency'],
                }))
              }
            >
              <option value="">—</option>
              <option value="routine">Routine</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-semibold text-slate-600">Notes</span>
            <textarea
              className={`mt-0.5 ${inp} min-h-[48px]`}
              value={draft.notes ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value || undefined }))}
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Folder number</span>
            <input
              className={`mt-0.5 ${inp}`}
              value={draft.folderNumber ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, folderNumber: e.target.value || undefined }))}
            />
          </label>
        </>
      )}
      {bucket === 'vericlaim' && (
        <label className="block sm:col-span-2">
          <span className="text-xs font-semibold text-slate-600">Claim / process status</span>
          <input
            className={`mt-0.5 ${inp}`}
            value={draft.claimStatus ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, claimStatus: e.target.value || undefined }))}
          />
        </label>
      )}
      {bucket === 'endoscopy' && (
        <label className="block">
          <span className="text-xs font-semibold text-slate-600">Endoscopy completed</span>
          <select
            className={`mt-0.5 ${inp}`}
            value={
              draft.endoscopyCompleted === true ? 'Y' : draft.endoscopyCompleted === false ? 'N' : ''
            }
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                endoscopyCompleted: e.target.value === 'Y' ? true : e.target.value === 'N' ? false : null,
              }))
            }
          >
            <option value="">—</option>
            <option value="Y">Yes</option>
            <option value="N">No</option>
          </select>
        </label>
      )}
    </div>
  );
}

function patchEndo(
  draft: PendingProcedureRow,
  patch: Partial<EndoscopyListFields>
): PendingProcedureRow {
  const cur = draft.endoscopySheet;
  if (!cur) return draft;
  return { ...draft, endoscopySheet: { ...cur, ...patch } };
}

const ENDO_KEYS: (keyof EndoscopyListFields)[] = [
  'surname',
  'firstName',
  'dateOfBirth',
  'age',
  'idNumber',
  'medicalAid',
  'medicalAidNumber',
  'contactNumber',
  'admissionDiagnosis',
  'icd10Diagnosis',
  'procedure',
  'procedureCodes',
  'dateOfProcedure',
  'complications',
  'inpatientNotes',
  'dateOfDiscarded',
  'followUpPlan',
  'dateOfFollowUp',
  'furtherComment',
];

export function EndoscopySheetEditor({
  draft,
  setDraft,
}: {
  draft: PendingProcedureRow;
  setDraft: React.Dispatch<React.SetStateAction<PendingProcedureRow>>;
}): React.ReactNode {
  const e = draft.endoscopySheet;
  if (!e) return <p className="text-sm text-amber-700">No endoscopy sheet.</p>;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
      {ENDO_KEYS.map((key) => (
        <label key={key} className={key === 'admissionDiagnosis' || key === 'inpatientNotes' ? 'block sm:col-span-2' : 'block'}>
          <span className="text-xs font-semibold text-slate-600">{CLINICAL_DEMO_FIELD_LABELS[key] ?? key}</span>
          {key === 'admissionDiagnosis' || key === 'inpatientNotes' || key === 'furtherComment' ? (
            <textarea
              className={`mt-0.5 ${inp} min-h-[48px]`}
              value={String(e[key] ?? '')}
              onChange={(ev) => setDraft((d) => patchEndo(d, { [key]: ev.target.value }))}
            />
          ) : (
            <input
              className={`mt-0.5 ${inp}`}
              value={String(e[key] ?? '')}
              onChange={(ev) => setDraft((d) => patchEndo(d, { [key]: ev.target.value }))}
            />
          )}
        </label>
      ))}
      <label className="block">
        <span className="text-xs font-semibold text-slate-600">Sex</span>
        <select
          className={`mt-0.5 ${inp}`}
          value={e.sex}
          onChange={(ev) => setDraft((d) => patchEndo(d, { sex: ev.target.value as 'M' | 'F' }))}
        >
          <option value="M">M</option>
          <option value="F">F</option>
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-slate-600">Endoscopy completed</span>
        <select
          className={`mt-0.5 ${inp}`}
          value={e.endoscopyCompleted ?? ''}
          onChange={(ev) =>
            setDraft((d) => patchEndo(d, { endoscopyCompleted: ev.target.value as '' | 'Y' | 'N' }))
          }
        >
          <option value="">—</option>
          <option value="Y">Y</option>
          <option value="N">N</option>
        </select>
      </label>
    </div>
  );
}

function patchVc(draft: PendingProcedureRow, patch: Partial<VericlaimFields>): PendingProcedureRow {
  const cur = draft.vericlaim;
  if (!cur) return draft;
  return { ...draft, vericlaim: { ...cur, ...patch } };
}

const VC_TEXT: (keyof VericlaimFields)[] = [
  'surname',
  'firstName',
  'dateOfBirth',
  'age',
  'idNumber',
  'medicalAid',
  'medicalAidNumber',
  'contactNumber',
  'bed',
  'dateOfAdmission',
  'admissionDiagnosis',
  'icd10Diagnosis',
  'procedure',
  'procedureCodes',
  'dateOfProcedure',
  'complications',
  'inpatientNotes',
  'dateOfDischarge',
  'followUpPlan',
  'dateOfFollowUp',
  'furtherComment',
];

export function VericlaimSheetEditor({
  draft,
  setDraft,
  fileAttachExtras,
}: {
  draft: PendingProcedureRow;
  setDraft: React.Dispatch<React.SetStateAction<PendingProcedureRow>>;
  fileAttachExtras?: FileAttachExtras;
}): React.ReactNode {
  const v = draft.vericlaim;
  if (!v) return <p className="text-sm text-amber-700">No Vericlaim payload.</p>;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
      {VC_TEXT.map((key) => (
        <label key={key} className={key === 'admissionDiagnosis' || key === 'inpatientNotes' ? 'block sm:col-span-2' : 'block'}>
          <span className="text-xs font-semibold text-slate-600">{CLINICAL_DEMO_FIELD_LABELS[key] ?? key}</span>
          {key === 'admissionDiagnosis' || key === 'inpatientNotes' || key === 'furtherComment' ? (
            <textarea
              className={`mt-0.5 ${inp} min-h-[48px]`}
              value={String(v[key] ?? '')}
              onChange={(ev) => setDraft((d) => patchVc(d, { [key]: ev.target.value }))}
            />
          ) : (
            <input
              className={`mt-0.5 ${inp}`}
              value={String(v[key] ?? '')}
              onChange={(ev) => setDraft((d) => patchVc(d, { [key]: ev.target.value }))}
            />
          )}
        </label>
      ))}
      <label className="block">
        <span className="text-xs font-semibold text-slate-600">Sex</span>
        <select
          className={`mt-0.5 ${inp}`}
          value={v.sex}
          onChange={(ev) => setDraft((d) => patchVc(d, { sex: ev.target.value as 'M' | 'F' }))}
        >
          <option value="M">M</option>
          <option value="F">F</option>
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-slate-600">Ward</span>
        <select
          className={`mt-0.5 ${inp}`}
          value={v.ward}
          onChange={(ev) => setDraft((d) => patchVc(d, { ward: ev.target.value as ClinicalWard }))}
        >
          {WARDS.map((w) => (
            <option key={w} value={w}>
              {formatWardDisplay(w)}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-slate-600">Awaiting OPD endoscopy</span>
        <select
          className={`mt-0.5 ${inp}`}
          value={v.awaitingOutpatientEndoscopy}
          onChange={(ev) => setDraft((d) => patchVc(d, { awaitingOutpatientEndoscopy: ev.target.value as '' | 'Y' | 'N' }))}
        >
          <option value="">—</option>
          <option value="Y">Y</option>
          <option value="N">N</option>
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-slate-600">Process pending</span>
        <select
          className={`mt-0.5 ${inp}`}
          value={v.processPending}
          onChange={(ev) =>
            setDraft((d) => patchVc(d, { processPending: ev.target.value as VericlaimProcessPending }))
          }
        >
          <option value="HALO">HALO</option>
          <option value="Vericlaim">Vericlaim</option>
          <option value="Download A-slip">Download A-slip</option>
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-slate-600">Follow-up pending</span>
        <select
          className={`mt-0.5 ${inp}`}
          value={v.followUpPending}
          onChange={(ev) => setDraft((d) => patchVc(d, { followUpPending: ev.target.value as '' | 'Y' | 'N' }))}
        >
          <option value="">—</option>
          <option value="Y">Y</option>
          <option value="N">N</option>
        </select>
      </label>
      <div className="sm:col-span-2">
        <MockFileAttachRow
          label="Patient sticker"
          description="Photo or scan of the ID sticker. If the patient exists in HALO, open their folder to drag in files from Drive."
          accept="image/*,.jpg,.jpeg,.png,.webp"
          fileName={v.stickerFileName}
          uploadedAt={v.stickerUploadedAt}
          sizeBytes={v.stickerSizeBytes}
          onChooseFile={(file) =>
            setDraft((d) =>
              patchVc(d, {
                stickerFileName: file.name,
                stickerUploadedAt: new Date().toISOString(),
                stickerSizeBytes: file.size,
              })
            )
          }
          onClear={() =>
            setDraft((d) =>
              patchVc(d, {
                stickerFileName: undefined,
                stickerUploadedAt: undefined,
                stickerSizeBytes: undefined,
              })
            )
          }
          openFolderAction={
            fileAttachExtras?.canOpenPatientFolder && fileAttachExtras.onOpenPatientFolder
              ? { label: 'Open patient folder in HALO', onClick: fileAttachExtras.onOpenPatientFolder }
              : undefined
          }
        />
      </div>
    </div>
  );
}

function patchAslip(draft: PendingProcedureRow, patch: Partial<AslipSummaryFields>): PendingProcedureRow {
  const cur = draft.aslip;
  if (!cur) return draft;
  return { ...draft, aslip: { ...cur, ...patch } };
}

const ASLIP_KEYS: (keyof AslipSummaryFields)[] = [
  'surname',
  'firstName',
  'dateOfBirth',
  'age',
  'idNumber',
  'medicalAid',
  'medicalAidNumber',
  'contactNumber',
  'bed',
  'dateOfAdmission',
  'admissionDiagnosis',
  'icd10Diagnosis',
  'inpatientNotes',
];

export function AslipSheetEditor({
  draft,
  setDraft,
  userSettings,
}: {
  draft: PendingProcedureRow;
  setDraft: React.Dispatch<React.SetStateAction<PendingProcedureRow>>;
  userSettings?: UserSettings | null;
}): React.ReactNode {
  const a = draft.aslip;
  if (!a) return <p className="text-sm text-amber-700">No A-slip payload.</p>;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
      {ASLIP_KEYS.map((key) => (
        <label key={key} className={key === 'admissionDiagnosis' || key === 'inpatientNotes' ? 'block sm:col-span-2' : 'block'}>
          <span className="text-xs font-semibold text-slate-600">{CLINICAL_DEMO_FIELD_LABELS[key] ?? key}</span>
          {key === 'admissionDiagnosis' || key === 'inpatientNotes' ? (
            <textarea
              className={`mt-0.5 ${inp} min-h-[48px]`}
              value={String(a[key] ?? '')}
              onChange={(ev) => setDraft((d) => patchAslip(d, { [key]: ev.target.value }))}
            />
          ) : (
            <input
              className={`mt-0.5 ${inp}`}
              value={String(a[key] ?? '')}
              onChange={(ev) => setDraft((d) => patchAslip(d, { [key]: ev.target.value }))}
            />
          )}
        </label>
      ))}
      <label className="block">
        <span className="text-xs font-semibold text-slate-600">Sex</span>
        <select
          className={`mt-0.5 ${inp}`}
          value={a.sex}
          onChange={(ev) => setDraft((d) => patchAslip(d, { sex: ev.target.value as 'M' | 'F' }))}
        >
          <option value="M">M</option>
          <option value="F">F</option>
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-slate-600">Ward</span>
        <select
          className={`mt-0.5 ${inp}`}
          value={a.ward}
          onChange={(ev) => setDraft((d) => patchAslip(d, { ward: ev.target.value as ClinicalWard | '' }))}
        >
          <option value="">—</option>
          {WARDS.map((w) => (
            <option key={w} value={w}>
              {formatWardDisplay(w)}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-slate-600">Awaiting OPD endoscopy</span>
        <select
          className={`mt-0.5 ${inp}`}
          value={a.awaitingOutpatientEndoscopy}
          onChange={(ev) =>
            setDraft((d) => patchAslip(d, { awaitingOutpatientEndoscopy: ev.target.value as '' | 'Y' | 'N' }))
          }
        >
          <option value="">—</option>
          <option value="Y">Y</option>
          <option value="N">N</option>
        </select>
      </label>
      <label className="block sm:col-span-2">
        <span className="text-xs font-semibold text-slate-600">Process pending</span>
        <select
          className={`mt-0.5 ${inp}`}
          value={a.processPending}
          onChange={(ev) =>
            setDraft((d) =>
              patchAslip(d, { processPending: ev.target.value as AslipSummaryFields['processPending'] })
            )
          }
        >
          <option value="">—</option>
          <option value="HALO">HALO</option>
          <option value="Vericlaim">Vericlaim</option>
          <option value="Download A-slip">Download A-slip</option>
        </select>
      </label>
      <div className="sm:col-span-2 pt-3">
        <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-4 space-y-2">
          <p className="text-xs font-semibold text-teal-900">Download authorization slip</p>
          <p className="text-xs text-slate-600 max-w-lg">
            PDF includes your doctor details from Settings (name, department, location). Generated locally for the demo.
          </p>
          <button
            type="button"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow hover:bg-teal-700"
            onClick={() => void downloadAslipPdf(a, userSettings)}
          >
            Download A-slip PDF
          </button>
        </div>
      </div>
    </div>
  );
}

export function PendingEditBody({
  draft,
  setDraft,
  patients = [],
  onOpenPatient,
  userSettings,
}: {
  draft: PendingProcedureRow;
  setDraft: React.Dispatch<React.SetStateAction<PendingProcedureRow>>;
  patients?: Patient[];
  onOpenPatient?: (id: string) => void;
  userSettings?: UserSettings | null;
}): React.ReactNode {
  const bucket = draft.bucket;
  const fileAttachExtras = useMemo<FileAttachExtras>(() => {
    const fn = draft.theatreBooking?.firstName ?? draft.vericlaim?.firstName ?? '';
    const sn = draft.theatreBooking?.surname ?? draft.vericlaim?.surname ?? '';
    const id = resolvePatientIdFromClinicalNames(patients, fn, sn);
    if (!onOpenPatient || !id) return { canOpenPatientFolder: false };
    return {
      canOpenPatientFolder: true,
      onOpenPatientFolder: () => onOpenPatient(id),
    };
  }, [
    draft.theatreBooking?.firstName,
    draft.theatreBooking?.surname,
    draft.vericlaim?.firstName,
    draft.vericlaim?.surname,
    patients,
    onOpenPatient,
  ]);
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600 mb-2">List summary</h3>
        <ListSummaryEditor draft={draft} setDraft={setDraft} bucket={bucket} />
      </section>
      {bucket === 'emergencies' || bucket === 'elective' || bucket === 'completed' ? (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600 mb-2">Theatre booking</h3>
          <TheatreBlockEditor draft={draft} setDraft={setDraft} fileAttachExtras={fileAttachExtras} />
        </section>
      ) : null}
      {bucket === 'endoscopy' ? (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600 mb-2">Endoscopy sheet</h3>
          <EndoscopySheetEditor draft={draft} setDraft={setDraft} />
        </section>
      ) : null}
      {bucket === 'vericlaim' ? (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600 mb-2">Vericlaim</h3>
          <VericlaimSheetEditor draft={draft} setDraft={setDraft} fileAttachExtras={fileAttachExtras} />
        </section>
      ) : null}
      {bucket === 'aslip' ? (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600 mb-2">A-slip</h3>
          <AslipSheetEditor draft={draft} setDraft={setDraft} userSettings={userSettings} />
        </section>
      ) : null}
    </div>
  );
}
