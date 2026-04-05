import React, { useEffect, useState } from 'react';
import type { ClinicalWard, SurgeonName, SurgeonRoundRow } from '../../../types/clinical';
import { getClinicalWards, updateSurgeonRound } from '../../../services/clinicalData';
import { formatWardDisplay } from './clinicalDisplay';
import { MessageCircle, Pencil, Phone, X } from 'lucide-react';

const SURGEONS: SurgeonName[] = ['Hoosain', 'Stanley', 'de Beer', 'Strydom'];
const inp =
  'w-full px-2 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 bg-white focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400';

interface Props {
  row: SurgeonRoundRow;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
  onRowUpdated?: (row: SurgeonRoundRow) => void;
}

export const SurgeonRoundDetailPanel: React.FC<Props> = ({ row: r, onClose, onSaved, onRowUpdated }) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<SurgeonRoundRow>(() => ({ ...r }));
  const wards = getClinicalWards();

  useEffect(() => {
    setDraft({ ...r });
  }, [r]);

  const tel = (editing ? draft.contactNumber : r.contactNumber)?.replace(/\s/g, '') || '';

  const Field = ({ label, value }: { label: string; value: string }) => (
    <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-1 text-sm border-b border-slate-100 py-2">
      <div className="text-slate-500 font-medium">{label}</div>
      <div className="text-slate-900 break-words">{value || '—'}</div>
    </div>
  );

  const save = async () => {
    setSaving(true);
    try {
      const next = await updateSurgeonRound(r.id, draft);
      if (next) {
        setDraft({ ...next });
        onRowUpdated?.(next);
        await onSaved?.();
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    setDraft({ ...r });
    setEditing(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
      <div
        className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto border border-slate-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="surgeon-round-detail-title"
      >
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="surgeon-round-detail-title" className="text-lg font-bold text-slate-800">
              {editing ? `${draft.firstName} ${draft.surname}` : `${r.firstName} ${r.surname}`}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Surgeon rounds — full row (mock).</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 text-sm hover:bg-slate-50"
                >
                  <X size={16} /> Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save()}
                  className="px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-slate-800 text-sm font-semibold hover:bg-violet-100"
                aria-label="Edit round"
              >
                <Pencil size={16} /> Edit
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 text-sm text-slate-500 hover:text-slate-800 px-2 py-1 rounded-lg hover:bg-slate-100"
            >
              Close
            </button>
          </div>
        </div>

        <div className="p-4 space-y-6">
          {editing ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <label className="block sm:col-span-2">
                <span className="text-xs font-semibold text-slate-600">Diagnosis</span>
                <textarea
                  className={`mt-0.5 ${inp} min-h-[64px]`}
                  value={draft.diagnosis}
                  onChange={(e) => setDraft((d) => ({ ...d, diagnosis: e.target.value }))}
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
                <span className="text-xs font-semibold text-slate-600">First name</span>
                <input
                  className={`mt-0.5 ${inp}`}
                  value={draft.firstName}
                  onChange={(e) => setDraft((d) => ({ ...d, firstName: e.target.value }))}
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
                <span className="text-xs font-semibold text-slate-600">Bed</span>
                <input
                  className={`mt-0.5 ${inp}`}
                  value={draft.bed}
                  onChange={(e) => setDraft((d) => ({ ...d, bed: e.target.value }))}
                />
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
                <span className="text-xs font-semibold text-slate-600">Date of review</span>
                <input
                  type="date"
                  className={`mt-0.5 ${inp}`}
                  value={draft.dateOfReview}
                  onChange={(e) => setDraft((d) => ({ ...d, dateOfReview: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Age</span>
                <input
                  type="number"
                  className={`mt-0.5 ${inp}`}
                  value={draft.age}
                  onChange={(e) => setDraft((d) => ({ ...d, age: parseInt(e.target.value, 10) || 0 }))}
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
                <span className="text-xs font-semibold text-slate-600">Medical aid</span>
                <input
                  className={`mt-0.5 ${inp}`}
                  value={draft.medicalAid}
                  onChange={(e) => setDraft((d) => ({ ...d, medicalAid: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Medical aid number</span>
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
                  placeholder="+27…"
                  value={draft.contactNumber}
                  onChange={(e) => setDraft((d) => ({ ...d, contactNumber: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Surgeon</span>
                <select
                  className={`mt-0.5 ${inp}`}
                  value={draft.surgeon}
                  onChange={(e) => setDraft((d) => ({ ...d, surgeon: e.target.value as SurgeonName }))}
                >
                  {SURGEONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Date of discharge</span>
                <input
                  className={`mt-0.5 ${inp}`}
                  value={draft.dateOfDischarge}
                  onChange={(e) => setDraft((d) => ({ ...d, dateOfDischarge: e.target.value }))}
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-semibold text-slate-600">Complications</span>
                <textarea
                  className={`mt-0.5 ${inp} min-h-[48px]`}
                  value={draft.complications}
                  onChange={(e) => setDraft((d) => ({ ...d, complications: e.target.value }))}
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-semibold text-slate-600">Surgeon plan</span>
                <textarea
                  className={`mt-0.5 ${inp} min-h-[56px]`}
                  value={draft.surgeonPlan}
                  onChange={(e) => setDraft((d) => ({ ...d, surgeonPlan: e.target.value }))}
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-semibold text-slate-600">Management plan</span>
                <textarea
                  className={`mt-0.5 ${inp} min-h-[56px]`}
                  value={draft.managementPlan}
                  onChange={(e) => setDraft((d) => ({ ...d, managementPlan: e.target.value }))}
                />
              </label>
            </div>
          ) : (
            <>
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-violet-600 mb-2">Location & review</h3>
                <Field label="Ward" value={formatWardDisplay(r.ward)} />
                <Field label="Bed" value={r.bed} />
                <Field label="Date of Review" value={r.dateOfReview} />
                <Field label="Date of Discharge" value={r.dateOfDischarge} />
              </section>

              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-violet-600 mb-2">Patient</h3>
                <Field label="Surname" value={r.surname} />
                <Field label="First Name" value={r.firstName} />
                <Field label="Date of Birth" value={r.dateOfBirth} />
                <Field label="Age" value={String(r.age)} />
                <Field label="Sex" value={r.sex} />
              </section>

              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-violet-600 mb-2">Clinical</h3>
                <Field label="Diagnosis" value={r.diagnosis} />
                <Field label="Complications" value={r.complications} />
                <Field label="Surgeon Plan" value={r.surgeonPlan} />
                <Field label="Management Plan" value={r.managementPlan} />
              </section>

              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-violet-600 mb-2">Team & aid</h3>
                <Field label="Surgeon" value={r.surgeon} />
                <Field label="Medical Aid" value={r.medicalAid} />
                <Field label="Medical Aid Number" value={r.medicalAidNumber} />
                <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-1 text-sm border-b border-slate-100 py-2 items-center">
                  <div className="text-slate-500 font-medium">Contact</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-900 tabular-nums">{r.contactNumber || '—'}</span>
                    {tel ? (
                      <>
                        <a
                          href={`tel:${tel}`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-50 text-violet-800 text-xs font-medium hover:bg-violet-100"
                        >
                          <Phone size={14} /> Call
                        </a>
                        <a
                          href={`sms:${tel}`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-50 text-violet-800 text-xs font-medium hover:bg-violet-100"
                        >
                          <MessageCircle size={14} /> SMS
                        </a>
                      </>
                    ) : null}
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
