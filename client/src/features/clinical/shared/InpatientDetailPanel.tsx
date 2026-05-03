import React, { useEffect, useState } from 'react';
import type { Patient } from '../../../../../shared/types';
import type { ClinicalWard, InpatientRecord } from '../../../types/clinical';
import { getClinicalWards, updateInpatientRecord } from '../../../services/clinicalData';
import { syncInpatientTasksToWardKanban } from '../../../services/wardKanbanSync';
import { formatInpatientDisplayName, formatWardDisplay } from './clinicalDisplay';
import { MessageCircle, Mic, Pencil, Phone, X } from 'lucide-react';

const inp =
  'w-full px-2 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 bg-white focus:ring-2 focus:ring-teal-500/30 focus:border-teal-400';

interface Props {
  record: InpatientRecord;
  onClose: () => void;
  /** Refetch lists / refresh selected record after a successful save. */
  onSaved?: () => void | Promise<void>;
  /** HALO patients — used to match this admission to a folder and sync Tasks → Ward kanban. */
  patients?: Patient[];
  onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
  /** Discharge flow (Hospital sheet + ward board + optional summary). Shown when admitted. */
  onRequestDischarge?: () => void;
  /** Opens sheet dictation for this admission (surgeon plan, notes, ward tasks, etc.). */
  onOpenDictate?: () => void;
}

export const InpatientDetailPanel: React.FC<Props> = ({
  record,
  onClose,
  onSaved,
  patients = [],
  onToast,
  onRequestDischarge,
  onOpenDictate,
}) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<InpatientRecord>(() => ({ ...record }));
  const [taskLine, setTaskLine] = useState(() => record.taskIndicators.map((t) => t.label).join(', '));

  useEffect(() => {
    setDraft({ ...record });
    setTaskLine(record.taskIndicators.map((t) => t.label).join(', '));
  }, [record]);

  const tel = draft.medicalAidPhone?.replace(/\s/g, '') || '';
  const sms = tel ? `sms:${tel}` : '';
  const wards = getClinicalWards();

  const Field = ({ label, value }: { label: string; value: string }) => (
    <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-1 text-sm border-b border-slate-100 py-2">
      <div className="text-slate-500 font-medium">{label}</div>
      <div className="text-slate-900 break-words">{value || '—'}</div>
    </div>
  );

  const save = async () => {
    setSaving(true);
    try {
      const tasks = taskLine
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((label) => ({ label }));
      const patch: Partial<InpatientRecord> = {
        ...draft,
        taskIndicators: tasks,
        age: typeof draft.age === 'number' ? draft.age : parseInt(String(draft.age), 10) || record.age,
      };
      const next = await updateInpatientRecord(record.id, patch);
      if (next) {
        setDraft({ ...next });
        setTaskLine(next.taskIndicators.map((t) => t.label).join(', '));
        await onSaved?.();

        if (patients.length > 0) {
          const sync = await syncInpatientTasksToWardKanban(next, patients);
          if (sync.outcome === 'synced') {
            onToast?.('Saved. Ward To do column updated from these tasks.', 'success');
          } else if (sync.outcome === 'skipped_not_admitted') {
            onToast?.('Saved.', 'success');
          } else if (sync.outcome === 'skipped_no_halo_patient') {
            onToast?.(`Saved. ${sync.message}`, 'info');
          } else if (sync.outcome === 'error') {
            onToast?.(`Saved. ${sync.message}`, 'error');
          }
        } else {
          onToast?.('Saved.', 'success');
        }

        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    setDraft({ ...record });
    setTaskLine(record.taskIndicators.map((t) => t.label).join(', '));
    setEditing(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/40 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div
        className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[min(90dvh,880px)] overflow-y-auto border border-slate-200 overscroll-contain"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inpatient-profile-title"
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
          <div className="min-w-0">
            <h2 id="inpatient-profile-title" className="text-lg font-bold text-slate-800">
              {editing
                ? formatInpatientDisplayName(draft.firstName, draft.surname)
                : formatInpatientDisplayName(record.firstName, record.surname)}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {editing ? (
                <>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="inline-flex items-center px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void save()}
                    className="inline-flex items-center px-3 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-60"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  {onOpenDictate ? (
                    <button
                      type="button"
                      onClick={onOpenDictate}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-teal-200 bg-teal-50/80 text-teal-900 text-sm font-semibold hover:bg-teal-100"
                    >
                      <Mic size={16} /> Dictate
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-slate-800 text-sm font-semibold hover:bg-teal-100 hover:text-teal-900"
                    aria-label="Edit record"
                  >
                    <Pencil size={16} /> Edit
                  </button>
                  {onOpenDictate ? (
                    <button
                      type="button"
                      onClick={onOpenDictate}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-teal-200 bg-teal-50/80 text-teal-900 text-sm font-semibold hover:bg-teal-100"
                    >
                      <Mic size={16} /> Dictate
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 space-y-6">
          {editing ? (
            <div className="space-y-4 text-sm">
              <section className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600">Identity & bed</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">First name</span>
                    <input
                      className={`mt-0.5 ${inp}`}
                      value={draft.firstName}
                      onChange={(e) => setDraft((d) => ({ ...d, firstName: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Surname</span>
                    <input
                      className={`mt-0.5 ${inp}`}
                      value={draft.surname}
                      onChange={(e) => setDraft((d) => ({ ...d, surname: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Folder number</span>
                    <input
                      className={`mt-0.5 ${inp}`}
                      value={draft.folderNumber}
                      onChange={(e) => setDraft((d) => ({ ...d, folderNumber: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Bed</span>
                    <input
                      className={`mt-0.5 ${inp}`}
                      value={draft.bed}
                      onChange={(e) => setDraft((d) => ({ ...d, bed: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Ward</span>
                    <select
                      className={`mt-0.5 ${inp}`}
                      value={draft.ward}
                      onChange={(e) => setDraft((d) => ({ ...d, ward: e.target.value as ClinicalWard }))}
                    >
                      {wards.map((w) => (
                    <option key={w} value={w}>
                      {formatWardDisplay(w)}
                    </option>
                  ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Date of birth</span>
                    <input
                      type="date"
                      className={`mt-0.5 ${inp}`}
                      value={draft.dateOfBirth}
                      onChange={(e) => setDraft((d) => ({ ...d, dateOfBirth: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">ID number</span>
                    <input
                      className={`mt-0.5 ${inp}`}
                      value={draft.idNumber}
                      onChange={(e) => setDraft((d) => ({ ...d, idNumber: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Sex</span>
                    <select
                      className={`mt-0.5 ${inp}`}
                      value={draft.sex}
                      onChange={(e) => setDraft((d) => ({ ...d, sex: e.target.value as 'M' | 'F' }))}
                    >
                      <option value="M">M</option>
                      <option value="F">F</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Age</span>
                    <input
                      type="number"
                      className={`mt-0.5 ${inp}`}
                      value={draft.age}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, age: parseInt(e.target.value, 10) || 0 }))
                      }
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-xs font-semibold text-slate-600">Assigned doctor</span>
                    <input
                      className={`mt-0.5 ${inp}`}
                      value={draft.assignedDoctor}
                      onChange={(e) => setDraft((d) => ({ ...d, assignedDoctor: e.target.value }))}
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-xs font-semibold text-slate-600">
                      Ward To do (comma-separated)
                    </span>
                    <input
                      className={`mt-0.5 ${inp}`}
                      value={taskLine}
                      onChange={(e) => setTaskLine(e.target.value)}
                      placeholder="e.g. Bloods, Physio review"
                    />
                  </label>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600">Admission</h3>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-600">Admission diagnosis</span>
                  <textarea
                    className={`mt-0.5 ${inp} min-h-[72px]`}
                    value={draft.admissionDiagnosis}
                    onChange={(e) => setDraft((d) => ({ ...d, admissionDiagnosis: e.target.value }))}
                  />
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Date of admission</span>
                    <input
                      type="date"
                      className={`mt-0.5 ${inp}`}
                      value={draft.dateOfAdmission}
                      onChange={(e) => setDraft((d) => ({ ...d, dateOfAdmission: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">ICD-10</span>
                    <input
                      className={`mt-0.5 ${inp}`}
                      value={draft.icd10Diagnoses}
                      onChange={(e) => setDraft((d) => ({ ...d, icd10Diagnoses: e.target.value }))}
                    />
                  </label>
                  <label className="block sm:col-span-2 flex items-center gap-2 mt-1">
                    <input
                      type="checkbox"
                      checked={draft.currentlyAdmitted}
                      onChange={(e) => setDraft((d) => ({ ...d, currentlyAdmitted: e.target.checked }))}
                    />
                    <span className="text-xs font-semibold text-slate-600">Currently admitted</span>
                  </label>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600">Medical aid</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Scheme</span>
                    <input
                      className={`mt-0.5 ${inp}`}
                      value={draft.medicalAid}
                      onChange={(e) => setDraft((d) => ({ ...d, medicalAid: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Member number</span>
                    <input
                      className={`mt-0.5 ${inp}`}
                      value={draft.medicalAidNumber}
                      onChange={(e) => setDraft((d) => ({ ...d, medicalAidNumber: e.target.value }))}
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-xs font-semibold text-slate-600">Contact number (Call / SMS)</span>
                    <input
                      className={`mt-0.5 ${inp}`}
                      value={draft.medicalAidPhone ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, medicalAidPhone: e.target.value }))}
                      placeholder="+27… patient or family mobile"
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-xs font-semibold text-slate-600">Patient email (outpatient scripts / certs)</span>
                    <input
                      type="email"
                      className={`mt-0.5 ${inp}`}
                      value={draft.email ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                      placeholder="name@example.com"
                    />
                  </label>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600">Procedure</h3>
                <div className="grid grid-cols-1 gap-2">
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Procedure</span>
                    <input
                      className={`mt-0.5 ${inp}`}
                      value={draft.procedure}
                      onChange={(e) => setDraft((d) => ({ ...d, procedure: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Procedure codes</span>
                    <input
                      className={`mt-0.5 ${inp}`}
                      value={draft.procedureCodes}
                      onChange={(e) => setDraft((d) => ({ ...d, procedureCodes: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Date of procedure</span>
                    <input
                      type="date"
                      className={`mt-0.5 ${inp}`}
                      value={draft.dateOfProcedure}
                      onChange={(e) => setDraft((d) => ({ ...d, dateOfProcedure: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Complications</span>
                    <textarea
                      className={`mt-0.5 ${inp} min-h-[56px]`}
                      value={draft.complications}
                      onChange={(e) => setDraft((d) => ({ ...d, complications: e.target.value }))}
                    />
                  </label>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600">
                  Discharge & long-term follow-up
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Date of discharge</span>
                    <input
                      className={`mt-0.5 ${inp}`}
                      value={draft.dateOfDischarge}
                      onChange={(e) => setDraft((d) => ({ ...d, dateOfDischarge: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Date of follow-up</span>
                    <input
                      type="date"
                      className={`mt-0.5 ${inp}`}
                      value={draft.dateOfFollowUp}
                      onChange={(e) => setDraft((d) => ({ ...d, dateOfFollowUp: e.target.value }))}
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-xs font-semibold text-slate-600">Long-term / outpatient follow-up plan</span>
                    <textarea
                      className={`mt-0.5 ${inp} min-h-[56px]`}
                      value={draft.followUpPlan}
                      onChange={(e) => setDraft((d) => ({ ...d, followUpPlan: e.target.value }))}
                      placeholder="e.g. GP wound check 1/52, OPD review…"
                    />
                  </label>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600">Notes</h3>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-600">Inpatient notes</span>
                  <textarea
                    className={`mt-0.5 ${inp} min-h-[72px]`}
                    value={draft.inpatientNotes}
                    onChange={(e) => setDraft((d) => ({ ...d, inpatientNotes: e.target.value }))}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-600">Further comment</span>
                  <textarea
                    className={`mt-0.5 ${inp} min-h-[56px]`}
                    value={draft.furtherComment}
                    onChange={(e) => setDraft((d) => ({ ...d, furtherComment: e.target.value }))}
                  />
                </label>
              </section>
            </div>
          ) : (
            <>
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600 mb-2">Identity & bed</h3>
                <Field label="Bed" value={record.bed} />
                <Field label="Folder Number" value={record.folderNumber} />
                <Field label="Surname" value={record.surname} />
                <Field label="First Name" value={record.firstName} />
                <Field label="ID Number" value={record.idNumber} />
                <Field label="Date of Birth" value={record.dateOfBirth} />
                <Field label="Sex" value={record.sex} />
                <Field label="Age" value={String(record.age)} />
                <Field label="Ward" value={formatWardDisplay(record.ward)} />
                <Field label="Assigned Doctor" value={record.assignedDoctor} />
                <Field
                  label="Ward To do"
                  value={record.taskIndicators.map((t) => t.label).join(', ') || '—'}
                />
              </section>

              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600 mb-2">Admission</h3>
                <Field label="Admission Diagnosis" value={record.admissionDiagnosis} />
                <Field label="Date of Admission" value={record.dateOfAdmission} />
                <Field label="ICD-10" value={record.icd10Diagnoses} />
                <Field label="Currently Admitted" value={record.currentlyAdmitted ? 'Yes' : 'No'} />
              </section>

              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600 mb-2">Medical aid</h3>
                <Field label="Scheme" value={record.medicalAid} />
                <Field label="Member Number" value={record.medicalAidNumber} />
                <Field label="Patient email" value={record.email ?? ''} />
                <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-1 text-sm border-b border-slate-100 py-2 items-center">
                  <div className="text-slate-500 font-medium">Contact Number</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-900">{record.medicalAidPhone || '—'}</span>
                    {tel ? (
                      <>
                        <a
                          href={`tel:${tel}`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-teal-50 text-teal-800 text-xs font-medium hover:bg-teal-100"
                          aria-label="Call"
                        >
                          <Phone size={14} /> Call
                        </a>
                        <a
                          href={sms}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-teal-50 text-teal-800 text-xs font-medium hover:bg-teal-100"
                          aria-label="SMS"
                        >
                          <MessageCircle size={14} /> SMS
                        </a>
                      </>
                    ) : null}
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600 mb-2">Procedure</h3>
                <Field label="Procedure" value={record.procedure} />
                <Field label="Procedure Codes" value={record.procedureCodes} />
                <Field label="Date of Procedure" value={record.dateOfProcedure} />
                <Field label="Complications" value={record.complications} />
              </section>

              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600 mb-2">
                  Discharge & long-term follow-up
                </h3>
                <Field label="Date of Discharge" value={record.dateOfDischarge || '—'} />
                <Field label="Long-term / outpatient FU plan" value={record.followUpPlan} />
                <Field label="Follow-up date" value={record.dateOfFollowUp} />
              </section>

              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-teal-600 mb-2">Notes</h3>
                <Field label="Inpatient Notes" value={record.inpatientNotes} />
                <Field label="Further Comment" value={record.furtherComment} />
              </section>

              <div className="flex flex-col sm:flex-row flex-wrap gap-2 pt-2">
                {record.currentlyAdmitted && onRequestDischarge ? (
                  <button
                    type="button"
                    onClick={onRequestDischarge}
                    className="inline-flex items-center justify-center min-h-[44px] px-3 py-2 rounded-lg text-[11px] font-bold tracking-tight text-teal-800 bg-teal-100 border border-teal-300 hover:bg-teal-200"
                  >
                    D/C
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
