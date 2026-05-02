import React, { useEffect, useMemo, useState } from 'react';
import type {
  AslipSummaryFields,
  ClinicalWard,
  EndoscopyListFields,
  PendingProcedureBucket,
  PendingProcedureRow,
  VericlaimFields,
} from '../../../types/clinical';
import type { Patient, UserSettings } from '../../../../../shared/types';
import { downloadAslipPdf } from '../tools/ClinicalExportMock';
import { updatePendingProcedureRow } from '../../../services/clinicalData';
import {
  CLINICAL_DEMO_FIELD_LABELS,
  THEATRE_BOOKING_DETAIL_KEY_ORDER,
  THEATRE_BOOKING_LABELS,
} from './clinicalFieldLabels';
import { PendingEditBody } from './pendingDetailEditors';
import {
  formatBookingUrgency,
  formatInpatientDisplayName,
  formatListUrgency,
  formatTheatreStatus,
  formatUploadedDocSummary,
  formatWardDisplay,
} from './clinicalDisplay';
import { FileDown, MessageCircle, Pencil, Phone, X } from 'lucide-react';

interface Props {
  row: PendingProcedureRow;
  bucketLabel: string;
  onClose: () => void;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onRowUpdated?: (row: PendingProcedureRow) => void;
  patients?: Patient[];
  onOpenPatient?: (patientId: string) => void;
  userSettings?: UserSettings | null;
}

function cloneRow(r: PendingProcedureRow): PendingProcedureRow {
  return JSON.parse(JSON.stringify(r)) as PendingProcedureRow;
}

export const PendingProcedureDetailPanel: React.FC<Props> = ({
  row,
  bucketLabel,
  onClose,
  onToast,
  onRowUpdated,
  patients = [],
  onOpenPatient,
  userSettings,
}) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<PendingProcedureRow>(() => cloneRow(row));

  useEffect(() => {
    setDraft(cloneRow(row));
    setEditing(false);
  }, [row]);

  const Field = ({ label, value }: { label: string; value: string }) => (
    <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-1 text-sm border-b border-slate-100 py-2">
      <div className="text-slate-500 font-medium">{label}</div>
      <div className="text-slate-900 break-words">{value || '—'}</div>
    </div>
  );

  const bucket: PendingProcedureBucket = row.bucket;
  const titleName = useMemo(() => {
    const src = editing ? draft : row;
    return src.theatreBooking
      ? formatInpatientDisplayName(src.theatreBooking.firstName, src.theatreBooking.surname)
      : src.vericlaim
        ? formatInpatientDisplayName(src.vericlaim.firstName, src.vericlaim.surname)
        : src.endoscopySheet
          ? formatInpatientDisplayName(src.endoscopySheet.firstName, src.endoscopySheet.surname)
          : src.aslip
            ? formatInpatientDisplayName(src.aslip.firstName, src.aslip.surname)
            : src.patientDisplayName;
  }, [draft, editing, row]);

  const save = async () => {
    setSaving(true);
    try {
      const next = await updatePendingProcedureRow(row.id, draft);
      if (next) {
        setDraft(cloneRow(next));
        onRowUpdated?.(next);
        onToast?.('Saved.', 'success');
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    setDraft(cloneRow(row));
    setEditing(false);
  };

  const renderTheatreView = () => {
    const b = row.theatreBooking;
    return (
      <>
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600 mb-2">List summary</h3>
          <Field label="Display Name" value={row.patientDisplayName} />
          <Field label="Procedure" value={row.procedure} />
          <Field label="Scheduled Date" value={row.scheduledDate ?? ''} />
          <Field label="Urgency" value={formatListUrgency(row.urgency)} />
          <Field label="Notes" value={row.notes ?? ''} />
          <Field label="Folder Number" value={row.folderNumber ?? ''} />
        </section>
        {b ? (
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600 mb-2">Theatre booking</h3>
            {THEATRE_BOOKING_DETAIL_KEY_ORDER.map((key) => {
              if (key === 'contactNumber') {
                const tel = b.contactNumber?.replace(/\s/g, '') ?? '';
                return (
                  <div
                    key={key}
                    className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-1 text-sm border-b border-slate-100 py-2 items-center"
                  >
                    <div className="text-slate-500 font-medium">{THEATRE_BOOKING_LABELS.contactNumber}</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-slate-900 tabular-nums">{b.contactNumber || '—'}</span>
                      {tel ? (
                        <>
                          <a
                            href={`tel:${tel}`}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs hover:bg-teal-100"
                            onClick={(ev) => ev.stopPropagation()}
                          >
                            <Phone size={14} /> Call
                          </a>
                          <a
                            href={`sms:${tel}`}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs hover:bg-teal-100"
                            onClick={(ev) => ev.stopPropagation()}
                          >
                            <MessageCircle size={14} /> SMS
                          </a>
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              }
              if (key === 'urgencyOfBooking') {
                return (
                  <Field
                    key={key}
                    label={THEATRE_BOOKING_LABELS[key]}
                    value={formatBookingUrgency(b.urgencyOfBooking)}
                  />
                );
              }
              if (key === 'status') {
                return <Field key={key} label={THEATRE_BOOKING_LABELS[key]} value={formatTheatreStatus(b.status)} />;
              }
              if (key === 'consentPdfFileName') {
                return (
                  <Field
                    key={key}
                    label={THEATRE_BOOKING_LABELS[key]}
                    value={
                      formatUploadedDocSummary(
                        b.consentPdfFileName,
                        b.consentPdfUploadedAt,
                        b.consentPdfSizeBytes
                      ) || '—'
                    }
                  />
                );
              }
              if (key === 'theatreSheetFileName') {
                return (
                  <Field
                    key={key}
                    label={THEATRE_BOOKING_LABELS[key]}
                    value={
                      formatUploadedDocSummary(
                        b.theatreSheetFileName,
                        b.theatreSheetUploadedAt,
                        b.theatreSheetSizeBytes
                      ) || '—'
                    }
                  />
                );
              }
              return <Field key={key} label={THEATRE_BOOKING_LABELS[key]} value={String(b[key] ?? '')} />;
            })}
          </section>
        ) : (
          <p className="text-sm text-slate-500">No theatre booking payload on this row.</p>
        )}
      </>
    );
  };

  const renderEndoscopyView = () => {
    const e = row.endoscopySheet;
    const textKeys: (keyof EndoscopyListFields)[] = [
      'surname',
      'firstName',
      'dateOfBirth',
      'age',
      'idNumber',
      'medicalAid',
      'medicalAidNumber',
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
    const tel = e?.contactNumber?.replace(/\s/g, '') ?? '';
    return (
      <>
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600 mb-2">List summary</h3>
          <Field label="Display Name" value={row.patientDisplayName} />
          <Field label="Procedure" value={row.procedure} />
          <Field label="Scheduled Date" value={row.scheduledDate ?? ''} />
          <Field
            label="Endoscopy Completed"
            value={row.endoscopyCompleted === true ? 'Yes' : row.endoscopyCompleted === false ? 'No' : '—'}
          />
        </section>
        {e ? (
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600 mb-2">Endoscopy sheet</h3>
            {textKeys.map((key) => (
              <Field key={key} label={CLINICAL_DEMO_FIELD_LABELS[key] ?? key} value={String(e[key] ?? '')} />
            ))}
            <Field label="Sex" value={e.sex} />
            <Field label="Endoscopy Completed" value={e.endoscopyCompleted || '—'} />
            {tel ? (
              <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-1 text-sm border-b border-slate-100 py-2 items-center">
                <div className="text-slate-500 font-medium">Contact</div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-900">{e.contactNumber}</span>
                  <a
                    href={`tel:${tel}`}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs hover:bg-teal-100"
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    <Phone size={14} /> Call
                  </a>
                  <a
                    href={`sms:${tel}`}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs hover:bg-teal-100"
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    <MessageCircle size={14} /> SMS
                  </a>
                </div>
              </div>
            ) : null}
          </section>
        ) : (
          <p className="text-sm text-slate-500">No endoscopy sheet payload on this row.</p>
        )}
      </>
    );
  };

  const vericlaimTextKeys: (keyof VericlaimFields)[] = [
    'surname',
    'firstName',
    'dateOfBirth',
    'age',
    'idNumber',
    'medicalAid',
    'medicalAidNumber',
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

  const renderVericlaimView = () => {
    const v = row.vericlaim;
    const tel = v?.contactNumber?.replace(/\s/g, '') ?? '';
    return (
      <>
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600 mb-2">List summary</h3>
          <Field label="Display Name" value={row.patientDisplayName} />
          <Field label="Procedure" value={row.procedure} />
          <Field label="Claim / Process" value={row.claimStatus ?? ''} />
        </section>
        {v ? (
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600 mb-2">Vericlaim</h3>
            {vericlaimTextKeys.map((key) => (
              <Field key={key} label={CLINICAL_DEMO_FIELD_LABELS[key] ?? key} value={String(v[key] ?? '')} />
            ))}
            <Field label="Sex" value={v.sex} />
            <Field label="Ward" value={formatWardDisplay(v.ward)} />
            <Field label="Awaiting Outpatient Endoscopy" value={v.awaitingOutpatientEndoscopy || '—'} />
            <Field label="Process Pending" value={v.processPending} />
            <Field label="Follow-up Pending" value={v.followUpPending || '—'} />
            <Field
              label="Patient sticker"
              value={
                formatUploadedDocSummary(v.stickerFileName, v.stickerUploadedAt, v.stickerSizeBytes) || '—'
              }
            />
            {tel ? (
              <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-1 text-sm border-b border-slate-100 py-2 items-center">
                <div className="text-slate-500 font-medium">Contact</div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-900">{v.contactNumber}</span>
                  <a
                    href={`tel:${tel}`}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-teal-50 text-teal-800 text-xs font-medium hover:bg-teal-100"
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    <Phone size={14} /> Call
                  </a>
                  <a
                    href={`sms:${tel}`}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-teal-50 text-teal-800 text-xs font-medium hover:bg-teal-100"
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    <MessageCircle size={14} /> SMS
                  </a>
                </div>
              </div>
            ) : null}
          </section>
        ) : (
          <p className="text-sm text-slate-500">No Vericlaim payload on this row.</p>
        )}
      </>
    );
  };

  const aslipTextKeys: (keyof AslipSummaryFields)[] = [
    'surname',
    'firstName',
    'dateOfBirth',
    'age',
    'idNumber',
    'medicalAid',
    'medicalAidNumber',
    'bed',
    'dateOfAdmission',
    'admissionDiagnosis',
    'icd10Diagnosis',
    'inpatientNotes',
  ];

  const renderAslipView = () => {
    const a = row.aslip;
    const tel = a?.contactNumber?.replace(/\s/g, '') ?? '';
    return (
      <>
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600 mb-2">List summary</h3>
          <Field label="Display Name" value={row.patientDisplayName} />
          <Field label="Procedure" value={row.procedure} />
        </section>
        {a ? (
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600 mb-2">A-slip summary</h3>
            {aslipTextKeys.map((key) => (
              <Field key={key} label={CLINICAL_DEMO_FIELD_LABELS[key] ?? key} value={String(a[key] ?? '')} />
            ))}
            <Field label="Sex" value={a.sex} />
            <Field label="Ward" value={a.ward ? formatWardDisplay(a.ward as ClinicalWard) : '—'} />
            <Field label="Awaiting Outpatient Endoscopy" value={a.awaitingOutpatientEndoscopy || '—'} />
            <Field label="Process Pending" value={String(a.processPending || '—')} />
            {tel ? (
              <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-1 text-sm border-b border-slate-100 py-2 items-center">
                <div className="text-slate-500 font-medium">Contact</div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-900">{a.contactNumber}</span>
                  <a
                    href={`tel:${tel}`}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs hover:bg-teal-100"
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    <Phone size={14} /> Call
                  </a>
                  <a
                    href={`sms:${tel}`}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs hover:bg-teal-100"
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    <MessageCircle size={14} /> SMS
                  </a>
                </div>
              </div>
            ) : null}
            <div className="pt-6 space-y-3">
              <div className="rounded-2xl border border-teal-200/80 bg-gradient-to-b from-teal-50/90 to-white p-6 space-y-3 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-teal-100 p-2 text-teal-700 shrink-0">
                    <FileDown size={22} aria-hidden />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold text-slate-900">Download authorization slip</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-teal-600 text-white text-sm font-semibold shadow-md hover:bg-teal-700"
                  onClick={() => {
                    void downloadAslipPdf(a, userSettings);
                    onToast?.('Downloaded A-slip PDF.', 'success');
                  }}
                >
                  <FileDown size={18} />
                  Download A-slip PDF
                </button>
              </div>
            </div>
          </section>
        ) : (
          <p className="text-sm text-slate-500">No A-slip payload on this row.</p>
        )}
      </>
    );
  };

  const bodyView =
    bucket === 'emergencies' || bucket === 'elective' || bucket === 'completed'
      ? renderTheatreView()
      : bucket === 'endoscopy'
        ? renderEndoscopyView()
        : bucket === 'vericlaim'
          ? renderVericlaimView()
          : renderAslipView();

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
      <div
        className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto border border-slate-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pending-procedure-detail-title"
      >
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3 pr-14 relative">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close"
          >
            <X size={20} />
          </button>
          <div>
            <h2 id="pending-procedure-detail-title" className="text-lg font-bold text-slate-800">
              {titleName || 'Pending procedure'}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {editing ? (
                <>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="inline-flex items-center px-3 py-2 rounded-lg border border-slate-200 text-sm hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void save()}
                    className="px-3 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold disabled:opacity-60"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-slate-800 text-sm font-semibold hover:bg-teal-100"
                  aria-label="Edit row"
                >
                  <Pencil size={16} /> Edit
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 space-y-6">
          {editing ? (
            <PendingEditBody
              draft={draft}
              setDraft={setDraft}
              patients={patients}
              onOpenPatient={onOpenPatient}
              userSettings={userSettings}
            />
          ) : (
            bodyView
          )}
        </div>
      </div>
    </div>
  );
};
