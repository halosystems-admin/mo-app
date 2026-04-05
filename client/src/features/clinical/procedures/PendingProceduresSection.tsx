import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AslipSummaryFields,
  ClinicalWard,
  EndoscopyListFields,
  PendingProcedureBucket,
  PendingProcedureRow,
  TheatreBookingFields,
  VericlaimFields,
  VericlaimProcessPending,
} from '../../../types/clinical';
import {
  addPendingRow,
  emptyAslipSummary,
  emptyEndoscopySheet,
  emptyTheatreBooking,
  emptyVericlaim,
  fetchPendingByBucket,
  findInpatientAutofill,
  inpatientToTheatreBooking,
  inpatientToAslipSummary,
  inpatientToEndoscopySheet,
  inpatientToVericlaim,
  getClinicalWards,
  listMockInpatientsForPicker,
} from '../../../services/clinicalData';
import { downloadAslipPdf } from '../tools/ClinicalExportMock';
import { ClinicalTableScroll } from '../shared/ClinicalTableScroll';
import { CLINICAL_TABLE_TH, CLINICAL_TABLE_TBODY_TR, CLINICAL_TABLE_THEAD } from '../shared/tableScrollClasses';
import { PendingProcedureDetailPanel } from '../shared/PendingProcedureDetailPanel';
import { CLINICAL_DEMO_FIELD_LABELS } from '../shared/clinicalFieldLabels';
import {
  formatBookingUrgency,
  formatListUrgency,
  formatTheatreStatus,
  formatWardDisplay,
  resolvePatientIdFromClinicalNames,
} from '../shared/clinicalDisplay';
import { MockFileAttachRow } from '../shared/MockFileAttachRow';
import type { Patient, UserSettings } from '../../../../../shared/types';
import { MessageCircle, Phone } from 'lucide-react';

const BUCKETS: { id: PendingProcedureBucket; label: string }[] = [
  { id: 'emergencies', label: 'Emergencies' },
  { id: 'elective', label: 'Elective bookings' },
  { id: 'endoscopy', label: 'Outpatient Endoscopy' },
  { id: 'completed', label: 'Procedures Completed' },
  { id: 'vericlaim', label: 'Pending Vericlaim' },
  { id: 'aslip', label: 'Download A-slip' },
];

const inp = 'w-full px-2 py-2 rounded-lg border border-slate-200 text-sm';
const lbl = 'block text-xs font-semibold text-slate-600 mb-1';

type YesNoVal = '' | 'Y' | 'N';

function YesNo({
  value,
  onChange,
  label,
}: {
  value: YesNoVal;
  onChange: (v: YesNoVal) => void;
  label: string;
}) {
  return (
    <div>
      <span className={lbl}>{label}</span>
      <select
        className={inp}
        value={value}
        onChange={(e) => onChange(e.target.value as YesNoVal)}
      >
        <option value="">—</option>
        <option value="Y">Yes</option>
        <option value="N">No</option>
      </select>
    </div>
  );
}

function recalcBmi(weightStr: string, heightStr: string): string {
  const w = parseFloat(weightStr);
  const hCm = parseFloat(heightStr);
  if (!w || !hCm || hCm <= 0) return '';
  const hM = hCm / 100;
  const bmi = w / (hM * hM);
  return Number.isFinite(bmi) ? bmi.toFixed(1) : '';
}

interface Props {
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
  patients?: Patient[];
  onOpenPatient?: (patientId: string) => void;
  /** Doctor profile for A-slip PDF letterhead (Settings). */
  userSettings?: UserSettings | null;
}

export const PendingProceduresSection: React.FC<Props> = ({
  onToast,
  patients = [],
  onOpenPatient,
  userSettings,
}) => {
  const [bucket, setBucket] = useState<PendingProcedureBucket>('emergencies');
  const [rows, setRows] = useState<PendingProcedureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [pickId, setPickId] = useState('');

  const [tb, setTb] = useState<TheatreBookingFields>(() => emptyTheatreBooking('emergency'));
  const [vc, setVc] = useState<VericlaimFields>(() => emptyVericlaim());
  const [endo, setEndo] = useState<EndoscopyListFields>(() => emptyEndoscopySheet());
  const [aslipForm, setAslipForm] = useState<AslipSummaryFields>(() => emptyAslipSummary());
  const [detailRow, setDetailRow] = useState<PendingProcedureRow | null>(null);

  const pickerPatients = useMemo(() => listMockInpatientsForPicker(), []);
  const wardOptions = useMemo(() => getClinicalWards(), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchPendingByBucket(bucket));
    } finally {
      setLoading(false);
    }
  }, [bucket]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setDetailRow(null);
  }, [bucket]);

  const openAddModal = () => {
    setDetailRow(null);
    setPickId('');
    if (bucket === 'emergencies') setTb(emptyTheatreBooking('emergency'));
    else if (bucket === 'elective' || bucket === 'completed')
      setTb(emptyTheatreBooking('elective'));
    else if (bucket === 'vericlaim') setVc(emptyVericlaim());
    else if (bucket === 'endoscopy') setEndo(emptyEndoscopySheet());
    else if (bucket === 'aslip') setAslipForm(emptyAslipSummary());
    setShowAdd(true);
  };

  const applyPicker = () => {
    if (!pickId) {
      onToast?.('Select a patient from list.', 'info');
      return;
    }
    const p = pickerPatients.find((x) => x.id === pickId);
    if (!p) return;
    if (bucket === 'emergencies') setTb(inpatientToTheatreBooking(p, 'emergency'));
    else if (bucket === 'elective' || bucket === 'completed')
      setTb(inpatientToTheatreBooking(p, 'elective'));
    else if (bucket === 'vericlaim') setVc(inpatientToVericlaim(p));
    else if (bucket === 'endoscopy') setEndo(inpatientToEndoscopySheet(p));
    else if (bucket === 'aslip') setAslipForm(inpatientToAslipSummary(p));
    onToast?.('Applied mock data from admissions / inpatients.', 'success');
  };

  const applyNameMatch = () => {
    if (bucket === 'emergencies' || bucket === 'elective' || bucket === 'completed') {
      const hit = findInpatientAutofill(tb.surname, tb.firstName);
      if (hit) {
        setTb(inpatientToTheatreBooking(hit, tb.urgencyOfBooking));
        onToast?.('Autofilled from matching admission.', 'success');
      } else onToast?.('No match for surname + first name.', 'info');
    } else if (bucket === 'vericlaim') {
      const hit = findInpatientAutofill(vc.surname, vc.firstName);
      if (hit) {
        setVc(inpatientToVericlaim(hit));
        onToast?.('Autofilled from matching admission.', 'success');
      } else onToast?.('No match.', 'info');
    } else if (bucket === 'endoscopy') {
      const hit = findInpatientAutofill(endo.surname, endo.firstName);
      if (hit) {
        setEndo(inpatientToEndoscopySheet(hit));
        onToast?.('Autofilled from matching admission.', 'success');
      } else onToast?.('No match.', 'info');
    } else if (bucket === 'aslip') {
      const hit = findInpatientAutofill(aslipForm.surname, aslipForm.firstName);
      if (hit) {
        setAslipForm(inpatientToAslipSummary(hit));
        onToast?.('Autofilled from matching admission.', 'success');
      } else onToast?.('No match.', 'info');
    }
  };

  const submitTheatre = async () => {
    const name = `${tb.firstName} ${tb.surname}`.trim() || 'Unknown';
    await addPendingRow({
      bucket,
      patientDisplayName: name,
      procedure: tb.plannedProcedure || 'Procedure',
      scheduledDate: tb.dateOfPlannedProcedure || undefined,
      urgency: tb.urgencyOfBooking === 'emergency' ? 'urgent' : 'routine',
      theatreBooking: { ...tb },
      notes: tb.diagnosis,
    });
    onToast?.('Saved (mock).', 'success');
    setShowAdd(false);
    void load();
  };

  const submitVericlaim = async () => {
    const name = `${vc.firstName} ${vc.surname}`.trim() || 'Unknown';
    await addPendingRow({
      bucket: 'vericlaim',
      patientDisplayName: name,
      procedure: vc.procedure || '—',
      claimStatus: vc.processPending,
      vericlaim: { ...vc },
    });
    onToast?.('Saved (mock).', 'success');
    setShowAdd(false);
    void load();
  };

  const submitEndoscopy = async () => {
    const name = `${endo.firstName} ${endo.surname}`.trim() || 'Unknown';
    await addPendingRow({
      bucket: 'endoscopy',
      patientDisplayName: name,
      procedure: endo.procedure || 'Endoscopy',
      scheduledDate: endo.dateOfProcedure || undefined,
      endoscopyCompleted:
        endo.endoscopyCompleted === 'Y' ? true : endo.endoscopyCompleted === 'N' ? false : null,
      endoscopySheet: { ...endo },
    });
    onToast?.('Saved (mock).', 'success');
    setShowAdd(false);
    void load();
  };

  const submitAslip = async () => {
    const name = `${aslipForm.firstName} ${aslipForm.surname}`.trim() || 'A-slip';
    const proc =
      (aslipForm.processPending as VericlaimProcessPending) || 'HALO';
    await addPendingRow({
      bucket: 'aslip',
      patientDisplayName: name,
      procedure: 'A-slip',
      aslip: { ...aslipForm, processPending: proc },
    });
    onToast?.('A-slip row added — use Download on the row.', 'success');
    setShowAdd(false);
    void load();
  };

  const renderTheatreTable = () => (
    <table className="min-w-[900px] w-full text-sm">
      <thead className={CLINICAL_TABLE_THEAD}>
        <tr>
          <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Patient</th>
          <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Urgency</th>
          <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Diagnosis</th>
          <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Planned Procedure</th>
          <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Planned Date</th>
          <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Status</th>
          <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Consent</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const b = r.theatreBooking;
          return (
            <tr
              key={r.id}
              className={CLINICAL_TABLE_TBODY_TR}
              onClick={() => setDetailRow(r)}
            >
              <td className="px-2 py-2">
                {b ? `${b.firstName} ${b.surname}` : r.patientDisplayName}
              </td>
              <td className="px-2 py-2 text-xs">
                {b?.urgencyOfBooking ? formatBookingUrgency(b.urgencyOfBooking) : formatListUrgency(r.urgency)}
              </td>
              <td className="px-2 py-2 text-xs max-w-[160px] truncate">{b?.diagnosis || r.notes}</td>
              <td className="px-2 py-2 text-xs">{b?.plannedProcedure || r.procedure}</td>
              <td className="px-2 py-2 text-xs">{b?.dateOfPlannedProcedure || r.scheduledDate}</td>
              <td className="px-2 py-2 text-xs">{formatTheatreStatus(b?.status)}</td>
              <td className="px-2 py-2 text-xs">{b?.consentObtained || '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const renderEndoscopyTable = () => (
    <table className="min-w-[960px] w-full text-sm">
      <thead className={CLINICAL_TABLE_THEAD}>
        <tr>
          <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Patient</th>
          <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Procedure</th>
          <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Date</th>
          <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Contact</th>
          <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Done</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const e = r.endoscopySheet;
          return (
            <tr
              key={r.id}
              className={CLINICAL_TABLE_TBODY_TR}
              onClick={() => setDetailRow(r)}
            >
              <td className="px-2 py-2">
                {e ? `${e.firstName} ${e.surname}` : r.patientDisplayName}
              </td>
              <td className="px-2 py-2 text-xs">{e?.procedure || r.procedure}</td>
              <td className="px-2 py-2 text-xs">{e?.dateOfProcedure || r.scheduledDate}</td>
              <td className="px-2 py-2">
                {e?.contactNumber ? (
                  <span className="inline-flex gap-1 text-violet-600">
                    <a
                      href={`tel:${e.contactNumber.replace(/\s/g, '')}`}
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      <Phone size={14} />
                    </a>
                    <a
                      href={`sms:${e.contactNumber.replace(/\s/g, '')}`}
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      <MessageCircle size={14} />
                    </a>
                  </span>
                ) : (
                  '—'
                )}
              </td>
              <td className="px-2 py-2 text-xs">
                {e?.endoscopyCompleted || (r.endoscopyCompleted === true ? 'Y' : r.endoscopyCompleted === false ? 'N' : '—')}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const renderVericlaimTable = () => (
    <table className="min-w-[800px] w-full text-sm">
      <thead className={CLINICAL_TABLE_THEAD}>
        <tr>
          <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Patient</th>
          <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Ward / Bed</th>
          <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Procedure</th>
          <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Process</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const v = r.vericlaim;
          return (
            <tr
              key={r.id}
              className={CLINICAL_TABLE_TBODY_TR}
              onClick={() => setDetailRow(r)}
            >
              <td className="px-2 py-2">
                {v ? `${v.firstName} ${v.surname}` : r.patientDisplayName}
              </td>
              <td className="px-2 py-2 text-xs">
                {v ? `${formatWardDisplay(v.ward)} ${v.bed}` : '—'}
              </td>
              <td className="px-2 py-2 text-xs">{v?.procedure || r.procedure}</td>
              <td className="px-2 py-2 text-xs">{v?.processPending || r.claimStatus}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const renderAslipTable = () => (
    <table className="min-w-full text-sm">
      <thead className={CLINICAL_TABLE_THEAD}>
        <tr>
          <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Patient</th>
          <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Ward</th>
          <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Process Pending</th>
          <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>PDF</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.id}
            className={CLINICAL_TABLE_TBODY_TR}
            onClick={() => setDetailRow(r)}
          >
            <td className="px-2 py-2">
              {r.aslip ? `${r.aslip.firstName} ${r.aslip.surname}` : r.patientDisplayName}
            </td>
              <td className="px-2 py-2 text-xs">
                {r.aslip?.ward ? formatWardDisplay(r.aslip.ward) : '—'}
              </td>
            <td className="px-2 py-2 text-xs">{r.aslip?.processPending || '—'}</td>
            <td className="px-2 py-2">
              <button
                type="button"
                className="text-violet-600 text-xs font-semibold hover:underline"
                onClick={(ev) => {
                  ev.stopPropagation();
                  downloadAslipPdf(r.aslip, userSettings);
                  onToast?.('Downloaded A-slip PDF.', 'success');
                }}
              >
                Download
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const theatreForm = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[70vh] overflow-y-auto pr-1">
      <div className="md:col-span-2 flex flex-wrap gap-2 items-end border-b border-slate-100 pb-3 mb-1">
        <div className="flex-1 min-w-[200px]">
          <span className={lbl}>Match From Admissions List</span>
          <select className={inp} value={pickId} onChange={(e) => setPickId(e.target.value)}>
            <option value="">— Select patient —</option>
            {pickerPatients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.firstName} {p.surname} — {p.folderNumber}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="px-3 py-2 rounded-lg bg-slate-100 text-sm font-semibold"
          onClick={applyPicker}
        >
          Apply selection
        </button>
        <button
          type="button"
          className="px-3 py-2 rounded-lg bg-violet-100 text-violet-800 text-sm font-semibold"
          onClick={applyNameMatch}
        >
          Autofill by surname + first name
        </button>
        {onOpenPatient ? (
          <button
            type="button"
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => {
              const id = resolvePatientIdFromClinicalNames(patients, tb.firstName, tb.surname);
              if (id) onOpenPatient(id);
              else onToast?.('No HALO patient matches this name — open Patients and link the folder manually.', 'info');
            }}
          >
            Open patient in HALO
          </button>
        ) : null}
      </div>
      <div>
        <span className={lbl}>Surname</span>
        <input className={inp} value={tb.surname} onChange={(e) => setTb({ ...tb, surname: e.target.value })} />
      </div>
      <div>
        <span className={lbl}>First Name</span>
        <input className={inp} value={tb.firstName} onChange={(e) => setTb({ ...tb, firstName: e.target.value })} />
      </div>
      <div>
        <span className={lbl}>Date of Birth</span>
        <input
          type="date"
          className={inp}
          value={tb.dateOfBirth}
          onChange={(e) => setTb({ ...tb, dateOfBirth: e.target.value })}
        />
      </div>
      <div>
        <span className={lbl}>Age</span>
        <input className={inp} value={tb.age} onChange={(e) => setTb({ ...tb, age: e.target.value })} />
      </div>
      <div>
        <span className={lbl}>Sex</span>
        <select
          className={inp}
          value={tb.sex}
          onChange={(e) => setTb({ ...tb, sex: e.target.value as 'M' | 'F' })}
        >
          <option value="M">Male</option>
          <option value="F">Female</option>
        </select>
      </div>
      <div>
        <span className={lbl}>Medical Aid</span>
        <input className={inp} value={tb.medicalAid} onChange={(e) => setTb({ ...tb, medicalAid: e.target.value })} />
      </div>
      <div>
        <span className={lbl}>Medical Aid Number</span>
        <input
          className={inp}
          value={tb.medicalAidNumber}
          onChange={(e) => setTb({ ...tb, medicalAidNumber: e.target.value })}
        />
      </div>
      <div>
        <span className={lbl}>Contact Number</span>
        <input
          className={inp}
          value={tb.contactNumber}
          onChange={(e) => setTb({ ...tb, contactNumber: e.target.value })}
        />
      </div>
      <div>
        <span className={lbl}>Urgency of Booking</span>
        <select
          className={inp}
          value={tb.urgencyOfBooking}
          onChange={(e) =>
            setTb({ ...tb, urgencyOfBooking: e.target.value as TheatreBookingFields['urgencyOfBooking'] })
          }
        >
          <option value="emergency">Emergency</option>
          <option value="elective">Elective</option>
        </select>
      </div>
      <div className="md:col-span-2">
        <span className={lbl}>Diagnosis</span>
        <input className={inp} value={tb.diagnosis} onChange={(e) => setTb({ ...tb, diagnosis: e.target.value })} />
      </div>
      <div>
        <span className={lbl}>ICD-10</span>
        <input className={inp} value={tb.icd10} onChange={(e) => setTb({ ...tb, icd10: e.target.value })} />
      </div>
      <div>
        <span className={lbl}>Planned Procedure</span>
        <input
          className={inp}
          value={tb.plannedProcedure}
          onChange={(e) => setTb({ ...tb, plannedProcedure: e.target.value })}
        />
      </div>
      <div>
        <span className={lbl}>Procedure Codes</span>
        <input
          className={inp}
          value={tb.procedureCodes}
          onChange={(e) => setTb({ ...tb, procedureCodes: e.target.value })}
        />
      </div>
      <YesNo label="Consent Obtained" value={tb.consentObtained} onChange={(v) => setTb({ ...tb, consentObtained: v })} />
      <div className="md:col-span-2">
        <MockFileAttachRow
          label="Consent form (PDF)"
          description="Upload the signed consent document. Demo records file details on this row only."
          accept="application/pdf,.pdf"
          fileName={tb.consentPdfFileName}
          uploadedAt={tb.consentPdfUploadedAt}
          sizeBytes={tb.consentPdfSizeBytes}
          onChooseFile={(f) =>
            setTb({
              ...tb,
              consentPdfFileName: f.name,
              consentPdfUploadedAt: new Date().toISOString(),
              consentPdfSizeBytes: f.size,
            })
          }
          onClear={() =>
            setTb({
              ...tb,
              consentPdfFileName: undefined,
              consentPdfUploadedAt: undefined,
              consentPdfSizeBytes: undefined,
            })
          }
          openFolderAction={
            onOpenPatient
              ? {
                  label: 'Open patient folder in HALO',
                  onClick: () => {
                    const id = resolvePatientIdFromClinicalNames(patients, tb.firstName, tb.surname);
                    if (id) onOpenPatient(id);
                    else onToast?.('No matching patient — add the consent from the picker first.', 'info');
                  },
                }
              : undefined
          }
        />
      </div>
      <YesNo label="Booked With Theatre" value={tb.bookedWithTheatre} onChange={(v) => setTb({ ...tb, bookedWithTheatre: v })} />
      <YesNo
        label="Anaesthesia Arranged"
        value={tb.anaesthesiaArranged}
        onChange={(v) => setTb({ ...tb, anaesthesiaArranged: v })}
      />
      <div>
        <span className={lbl}>Anaesthetist</span>
        <input
          className={inp}
          value={tb.anaesthetistName}
          onChange={(e) => setTb({ ...tb, anaesthetistName: e.target.value })}
        />
      </div>
      <YesNo label="Assistant Arranged" value={tb.assistantArranged} onChange={(v) => setTb({ ...tb, assistantArranged: v })} />
      <div>
        <span className={lbl}>Assistant Name</span>
        <input className={inp} value={tb.assistantName} onChange={(e) => setTb({ ...tb, assistantName: e.target.value })} />
      </div>
      <div>
        <span className={lbl}>Status</span>
        <select
          className={inp}
          value={tb.status}
          onChange={(e) => setTb({ ...tb, status: e.target.value as TheatreBookingFields['status'] })}
        >
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
      <div>
        <span className={lbl}>Date of Completion</span>
        <input
          type="date"
          className={inp}
          value={tb.dateOfCompletion}
          onChange={(e) => setTb({ ...tb, dateOfCompletion: e.target.value })}
        />
      </div>
      <div>
        <span className={lbl}>Start Time</span>
        <input
          type="time"
          className={inp}
          value={tb.startTime}
          onChange={(e) => setTb({ ...tb, startTime: e.target.value })}
        />
      </div>
      <div>
        <span className={lbl}>End Time</span>
        <input
          type="time"
          className={inp}
          value={tb.endTime}
          onChange={(e) => setTb({ ...tb, endTime: e.target.value })}
        />
      </div>
      <div>
        <span className={lbl}>Weight (kg)</span>
        <input
          className={inp}
          value={tb.weight}
          onChange={(e) => {
            const weight = e.target.value;
            setTb({ ...tb, weight, bmi: recalcBmi(weight, tb.height) });
          }}
        />
      </div>
      <div>
        <span className={lbl}>Height (cm)</span>
        <input
          className={inp}
          value={tb.height}
          onChange={(e) => {
            const height = e.target.value;
            setTb({ ...tb, height, bmi: recalcBmi(tb.weight, height) });
          }}
        />
      </div>
      <div>
        <span className={lbl}>BMI (auto)</span>
        <input className={inp} readOnly value={tb.bmi} />
      </div>
      <div className="md:col-span-2">
        <MockFileAttachRow
          label="Theatre sheet"
          description="Attach the completed theatre sheet (PDF or scan)."
          accept="application/pdf,image/*,.pdf,.png,.jpg,.jpeg"
          fileName={tb.theatreSheetFileName}
          uploadedAt={tb.theatreSheetUploadedAt}
          sizeBytes={tb.theatreSheetSizeBytes}
          onChooseFile={(f) =>
            setTb({
              ...tb,
              theatreSheetFileName: f.name,
              theatreSheetUploadedAt: new Date().toISOString(),
              theatreSheetSizeBytes: f.size,
            })
          }
          onClear={() =>
            setTb({
              ...tb,
              theatreSheetFileName: undefined,
              theatreSheetUploadedAt: undefined,
              theatreSheetSizeBytes: undefined,
            })
          }
          openFolderAction={
            onOpenPatient
              ? {
                  label: 'Open patient folder in HALO',
                  onClick: () => {
                    const id = resolvePatientIdFromClinicalNames(patients, tb.firstName, tb.surname);
                    if (id) onOpenPatient(id);
                    else onToast?.('No matching patient.', 'info');
                  },
                }
              : undefined
          }
        />
      </div>
      <div>
        <span className={lbl}>Date of Planned Procedure</span>
        <input
          type="date"
          className={inp}
          value={tb.dateOfPlannedProcedure}
          onChange={(e) => setTb({ ...tb, dateOfPlannedProcedure: e.target.value })}
        />
      </div>
    </div>
  );

  const vericlaimForm = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[70vh] overflow-y-auto pr-1">
      <div className="md:col-span-2 flex flex-wrap gap-2 border-b pb-3">
        <select className={inp + ' max-w-md'} value={pickId} onChange={(e) => setPickId(e.target.value)}>
          <option value="">— Select from admissions —</option>
          {pickerPatients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.firstName} {p.surname}
            </option>
          ))}
        </select>
        <button type="button" className="px-3 py-2 rounded-lg bg-slate-100 text-sm font-semibold" onClick={applyPicker}>
          Apply
        </button>
        <button type="button" className="px-3 py-2 rounded-lg bg-violet-100 text-sm font-semibold" onClick={applyNameMatch}>
          Match name
        </button>
        {onOpenPatient ? (
          <button
            type="button"
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700"
            onClick={() => {
              const id = resolvePatientIdFromClinicalNames(patients, vc.firstName, vc.surname);
              if (id) onOpenPatient(id);
              else onToast?.('No HALO patient matches this name.', 'info');
            }}
          >
            Open patient in HALO
          </button>
        ) : null}
      </div>
      {(
        [
          ['surname', vc.surname],
          ['firstName', vc.firstName],
          ['dateOfBirth', vc.dateOfBirth],
          ['age', vc.age],
          ['idNumber', vc.idNumber],
          ['medicalAid', vc.medicalAid],
          ['medicalAidNumber', vc.medicalAidNumber],
          ['contactNumber', vc.contactNumber],
          ['bed', vc.bed],
          ['dateOfAdmission', vc.dateOfAdmission],
          ['admissionDiagnosis', vc.admissionDiagnosis],
          ['icd10Diagnosis', vc.icd10Diagnosis],
          ['procedure', vc.procedure],
          ['procedureCodes', vc.procedureCodes],
          ['dateOfProcedure', vc.dateOfProcedure],
          ['complications', vc.complications],
          ['inpatientNotes', vc.inpatientNotes],
          ['dateOfDischarge', vc.dateOfDischarge],
          ['followUpPlan', vc.followUpPlan],
          ['dateOfFollowUp', vc.dateOfFollowUp],
          ['furtherComment', vc.furtherComment],
        ] as const
      ).map(([key]) => (
        <div key={key}>
          <span className={lbl}>{CLINICAL_DEMO_FIELD_LABELS[key] ?? key}</span>
          <input
            className={inp}
            value={String(vc[key as keyof VericlaimFields] ?? '')}
            onChange={(e) => setVc({ ...vc, [key]: e.target.value })}
          />
        </div>
      ))}
      <div>
        <span className={lbl}>Sex</span>
        <select
          className={inp}
          value={vc.sex}
          onChange={(e) => setVc({ ...vc, sex: e.target.value as 'M' | 'F' })}
        >
          <option value="M">Male</option>
          <option value="F">Female</option>
        </select>
      </div>
      <div>
        <span className={lbl}>Ward</span>
        <select
          className={inp}
          value={vc.ward}
          onChange={(e) => setVc({ ...vc, ward: e.target.value as ClinicalWard })}
        >
          {wardOptions.map((w) => (
            <option key={w} value={w}>
              {formatWardDisplay(w)}
            </option>
          ))}
        </select>
      </div>
      <YesNo
        label="Awaiting Outpatient Endoscopy"
        value={vc.awaitingOutpatientEndoscopy}
        onChange={(v) => setVc({ ...vc, awaitingOutpatientEndoscopy: v })}
      />
      <div>
        <span className={lbl}>Process Pending</span>
        <select
          className={inp}
          value={vc.processPending}
          onChange={(e) =>
            setVc({ ...vc, processPending: e.target.value as VericlaimProcessPending })
          }
        >
          <option value="HALO">HALO</option>
          <option value="Vericlaim">Vericlaim</option>
          <option value="Download A-slip">Download A-slip</option>
        </select>
      </div>
      <YesNo label="Follow-up Pending" value={vc.followUpPending} onChange={(v) => setVc({ ...vc, followUpPending: v })} />
      <div className="md:col-span-2">
        <MockFileAttachRow
          label="Patient sticker"
          description="Photo or scan of the ward sticker. You can also open the HALO folder to copy files from Drive."
          accept="image/*,.jpg,.jpeg,.png,.webp"
          fileName={vc.stickerFileName}
          uploadedAt={vc.stickerUploadedAt}
          sizeBytes={vc.stickerSizeBytes}
          onChooseFile={(f) =>
            setVc({
              ...vc,
              stickerFileName: f.name,
              stickerUploadedAt: new Date().toISOString(),
              stickerSizeBytes: f.size,
            })
          }
          onClear={() =>
            setVc({
              ...vc,
              stickerFileName: undefined,
              stickerUploadedAt: undefined,
              stickerSizeBytes: undefined,
            })
          }
          openFolderAction={
            onOpenPatient
              ? {
                  label: 'Open patient folder in HALO',
                  onClick: () => {
                    const id = resolvePatientIdFromClinicalNames(patients, vc.firstName, vc.surname);
                    if (id) onOpenPatient(id);
                    else onToast?.('No matching patient.', 'info');
                  },
                }
              : undefined
          }
        />
      </div>
    </div>
  );

  const endoscopyForm = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[70vh] overflow-y-auto">
      <div className="md:col-span-2 flex flex-wrap gap-2 border-b pb-3">
        <select className={inp + ' max-w-md'} value={pickId} onChange={(e) => setPickId(e.target.value)}>
          <option value="">— Select patient —</option>
          {pickerPatients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.firstName} {p.surname}
            </option>
          ))}
        </select>
        <button type="button" className="px-3 py-2 rounded-lg bg-slate-100 text-sm font-semibold" onClick={applyPicker}>
          Apply
        </button>
        <button type="button" className="px-3 py-2 rounded-lg bg-violet-100 text-sm" onClick={applyNameMatch}>
          Match name
        </button>
        {onOpenPatient ? (
          <button
            type="button"
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700"
            onClick={() => {
              const id = resolvePatientIdFromClinicalNames(patients, endo.firstName, endo.surname);
              if (id) onOpenPatient(id);
              else onToast?.('No HALO patient matches this name.', 'info');
            }}
          >
            Open patient in HALO
          </button>
        ) : null}
      </div>
      {(
        [
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
        ] as const
      ).map((key) => (
        <div key={key}>
          <span className={lbl}>{CLINICAL_DEMO_FIELD_LABELS[key] ?? key}</span>
          <input
            className={inp}
            value={String(endo[key] ?? '')}
            onChange={(e) => setEndo({ ...endo, [key]: e.target.value })}
          />
        </div>
      ))}
      <div>
        <span className={lbl}>Sex</span>
        <select
          className={inp}
          value={endo.sex}
          onChange={(e) => setEndo({ ...endo, sex: e.target.value as 'M' | 'F' })}
        >
          <option value="M">Male</option>
          <option value="F">Female</option>
        </select>
      </div>
      <YesNo
        label="Endoscopy Completed"
        value={endo.endoscopyCompleted || ''}
        onChange={(v) => setEndo({ ...endo, endoscopyCompleted: v })}
      />
      <div className="md:col-span-2 flex items-center gap-2 text-slate-500 text-xs">
        <Phone size={14} />
        <span>Contact uses number above for call/SMS links in the list.</span>
      </div>
    </div>
  );

  const aslipFormEl = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[70vh] overflow-y-auto">
      <div className="md:col-span-2 flex flex-wrap gap-2 border-b pb-3">
        <select className={inp + ' max-w-md'} value={pickId} onChange={(e) => setPickId(e.target.value)}>
          <option value="">— Load patient —</option>
          {pickerPatients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.firstName} {p.surname}
            </option>
          ))}
        </select>
        <button type="button" className="px-3 py-2 rounded-lg bg-slate-100 text-sm font-semibold" onClick={applyPicker}>
          Apply
        </button>
        <button type="button" className="px-3 py-2 rounded-lg bg-violet-100 text-sm" onClick={applyNameMatch}>
          Match name
        </button>
        {onOpenPatient ? (
          <button
            type="button"
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700"
            onClick={() => {
              const id = resolvePatientIdFromClinicalNames(patients, aslipForm.firstName, aslipForm.surname);
              if (id) onOpenPatient(id);
              else onToast?.('No HALO patient matches this name.', 'info');
            }}
          >
            Open patient in HALO
          </button>
        ) : null}
      </div>
      {(
        [
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
        ] as const
      ).map((key) => (
        <div key={key}>
          <span className={lbl}>{CLINICAL_DEMO_FIELD_LABELS[key] ?? key}</span>
          <input
            className={inp}
            value={String(aslipForm[key] ?? '')}
            onChange={(e) => setAslipForm({ ...aslipForm, [key]: e.target.value })}
          />
        </div>
      ))}
      <div>
        <span className={lbl}>Sex</span>
        <select
          className={inp}
          value={aslipForm.sex}
          onChange={(e) => setAslipForm({ ...aslipForm, sex: e.target.value as 'M' | 'F' })}
        >
          <option value="M">Male</option>
          <option value="F">Female</option>
        </select>
      </div>
      <div>
        <span className={lbl}>Ward</span>
        <select
          className={inp}
          value={aslipForm.ward}
          onChange={(e) => setAslipForm({ ...aslipForm, ward: e.target.value as ClinicalWard | '' })}
        >
          <option value="">—</option>
          {wardOptions.map((w) => (
            <option key={w} value={w}>
              {formatWardDisplay(w)}
            </option>
          ))}
        </select>
      </div>
      <YesNo
        label="Awaiting Outpatient Endoscopy"
        value={aslipForm.awaitingOutpatientEndoscopy}
        onChange={(v) => setAslipForm({ ...aslipForm, awaitingOutpatientEndoscopy: v })}
      />
      <div>
        <span className={lbl}>Process Pending</span>
        <select
          className={inp}
          value={aslipForm.processPending}
          onChange={(e) =>
            setAslipForm({
              ...aslipForm,
              processPending: e.target.value as AslipSummaryFields['processPending'],
            })
          }
        >
          <option value="">—</option>
          <option value="HALO">HALO</option>
          <option value="Vericlaim">Vericlaim</option>
          <option value="Download A-slip">Download A-slip</option>
        </select>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        <strong className="text-slate-800">Click any row</strong> to open the full sheet (all fields for this category).
        Use <strong>Download</strong> in the row or in the panel for A-slip PDFs.
      </p>
      <div className="flex flex-wrap gap-2">
        {BUCKETS.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setBucket(b.id)}
            className={
              bucket === b.id
                ? 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 text-white'
                : 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700'
            }
          >
            {b.label}
          </button>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={openAddModal}
          className="px-3 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold"
        >
          + Add
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <ClinicalTableScroll>
          {bucket === 'emergencies' || bucket === 'elective' || bucket === 'completed'
            ? renderTheatreTable()
            : bucket === 'endoscopy'
              ? renderEndoscopyTable()
              : bucket === 'vericlaim'
                ? renderVericlaimTable()
                : renderAslipTable()}
        </ClinicalTableScroll>
      )}

      {detailRow && (
        <PendingProcedureDetailPanel
          row={detailRow}
          bucketLabel={BUCKETS.find((b) => b.id === detailRow.bucket)?.label ?? 'Pending procedures'}
          onClose={() => setDetailRow(null)}
          onToast={onToast}
          patients={patients}
          userSettings={userSettings}
          onOpenPatient={onOpenPatient}
          onRowUpdated={(r) => {
            setDetailRow(r);
            void load();
          }}
        />
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div
            className="bg-white rounded-xl max-w-3xl w-full max-h-[92vh] flex flex-col border border-slate-200 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pending-add-title"
          >
            <div className="p-4 border-b border-slate-100 flex justify-between items-center shrink-0">
              <h3 id="pending-add-title" className="font-bold text-slate-800">
                Add — {BUCKETS.find((b) => b.id === bucket)?.label}
              </h3>
              <button
                type="button"
                className="text-slate-500 text-sm"
                onClick={() => setShowAdd(false)}
              >
                Close
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {bucket === 'emergencies' || bucket === 'elective' || bucket === 'completed'
                ? theatreForm
                : bucket === 'vericlaim'
                  ? vericlaimForm
                  : bucket === 'endoscopy'
                    ? endoscopyForm
                    : aslipFormEl}
            </div>
            <div className="p-4 border-t border-slate-100 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                className="px-3 py-2 text-sm text-slate-600"
                onClick={() => setShowAdd(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold"
                onClick={() => {
                  if (bucket === 'emergencies' || bucket === 'elective' || bucket === 'completed')
                    void submitTheatre();
                  else if (bucket === 'vericlaim') void submitVericlaim();
                  else if (bucket === 'endoscopy') void submitEndoscopy();
                  else void submitAslip();
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
