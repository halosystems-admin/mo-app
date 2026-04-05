
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ClinicalWard, InpatientRecord, OtherSurgeonInpatientDraft } from "../../../types/clinical";
import {
  MOCK_INPATIENTS,
  addInpatientRecord,
  applyHaloPatientToAdmissionDraft,
  createEmptyInpatientRecord,
  duplicateInpatientFromTemplate,
  fetchCurrentInpatients,
  getInpatientById,
  mockExtractFromSticker,
  createEmptyOtherSurgeonDraft,
} from "../../../services/clinicalData";
import type { AdmittedPatientKanban, Patient } from "../../../../../shared/types";
import {
  formatWardDisplay,
  resolvePatientIdFromClinicalNames,
  wardBadgeClass,
} from "../shared/clinicalDisplay";
import { fetchDoctorKanban } from "../../../services/api";
import { DischargePatientModal } from "../shared/DischargePatientModal";
import { buildDischargeClinicalContext } from "../shared/dischargeContext";
import { InpatientDetailPanel } from "../shared/InpatientDetailPanel";
import { ClinicalTableScroll } from "../shared/ClinicalTableScroll";
import { CLINICAL_TABLE_TH, CLINICAL_TABLE_TBODY_TR, CLINICAL_TABLE_THEAD } from "../shared/tableScrollClasses";
import { FolderOpen, LayoutDashboard, Plus, Upload, X } from "lucide-react";

interface Props {
  onToast?: (msg: string, type?: "success" | "error" | "info") => void;
  patients?: Patient[];
  onOpenPatient?: (patientId: string) => void;
  /** Opens Ward → Ward board & diary (single ward Trello + Pull from Hospital). */
  onOpenWardBoard?: () => void;
}

export const InpatientsSection: React.FC<Props> = ({
  onToast,
  patients = [],
  onOpenPatient,
  onOpenWardBoard,
}) => {
  const [rows, setRows] = useState<InpatientRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState<"admitted" | "other">("admitted");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<OtherSurgeonInpatientDraft>(() => createEmptyOtherSurgeonDraft());
  const [stickerBusy, setStickerBusy] = useState(false);
  const [showAddAdmission, setShowAddAdmission] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [newAdmission, setNewAdmission] = useState<InpatientRecord>(() => createEmptyInpatientRecord());
  const [addHaloPatientId, setAddHaloPatientId] = useState("");
  const [addTemplateId, setAddTemplateId] = useState("");
  const addHaloRef = useRef(addHaloPatientId);
  const addTemplateRef = useRef(addTemplateId);
  addHaloRef.current = addHaloPatientId;
  addTemplateRef.current = addTemplateId;

  const [dischargeRecord, setDischargeRecord] = useState<InpatientRecord | null>(null);
  const [dischargeKanbanRow, setDischargeKanbanRow] = useState<AdmittedPatientKanban | null>(null);

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
        const { kanban } = await fetchDoctorKanban();
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
      const data = await fetchCurrentInpatients();
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = selectedId ? getInpatientById(selectedId) : undefined;

  const openAddAdmissionModal = () => {
    setNewAdmission(createEmptyInpatientRecord());
    setAddHaloPatientId("");
    setAddTemplateId("");
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
      onToast?.("First name and surname are required.", "info");
      return;
    }
    setAddSaving(true);
    try {
      const saved = await addInpatientRecord(newAdmission);
      await load();
      setShowAddAdmission(false);
      setSelectedId(saved.id);
      onToast?.("Admission added (mock sheet).", "success");
    } catch {
      onToast?.("Could not save admission.", "error");
    } finally {
      setAddSaving(false);
    }
  };

  const applySticker = async (file: File) => {
    setStickerBusy(true);
    try {
      const ex = await mockExtractFromSticker(file);
      setDraft((d) => ({
        ...d,
        firstName: ex.firstName ?? d.firstName,
        surname: ex.surname ?? d.surname,
        dateOfBirth: ex.dateOfBirth ?? d.dateOfBirth,
        folderNumber: ex.folderNumber ?? d.folderNumber,
        idNumber: ex.idNumber ?? d.idNumber,
        ward: ex.ward ?? d.ward,
      }));
      onToast?.("Mock extraction applied — edit fields as needed.", "success");
    } finally {
      setStickerBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSub("admitted")}
          className={
            sub === "admitted"
              ? "px-3 py-1.5 rounded-lg text-sm font-semibold bg-violet-600 text-white"
              : "px-3 py-1.5 rounded-lg text-sm font-semibold bg-slate-100 text-slate-700"
          }
        >
          Currently admitted
        </button>
        <button
          type="button"
          onClick={() => setSub("other")}
          className={
            sub === "other"
              ? "px-3 py-1.5 rounded-lg text-sm font-semibold bg-violet-600 text-white"
              : "px-3 py-1.5 rounded-lg text-sm font-semibold bg-slate-100 text-slate-700"
          }
        >
          Other surgeons inpatients
        </button>
      </div>

      {sub === "admitted" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600 min-w-[200px]">
              Click a row for the full profile. Scroll sideways for every column.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openAddAdmissionModal}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 shadow-sm"
              >
                <Plus size={18} />
                New admission
              </button>
              {onOpenWardBoard ? (
                <button
                  type="button"
                  onClick={onOpenWardBoard}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                >
                  <LayoutDashboard size={16} />
                  Open ward board
                </button>
              ) : null}
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (
            <ClinicalTableScroll>
              <table
                className="text-sm border-collapse border border-slate-200 table-fixed"
                style={{ width: 2680, minWidth: 2680 }}
              >
                <colgroup>
                  <col style={{ width: 160 }} />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 80 }} />
                  <col style={{ width: 140 }} />
                  <col style={{ width: 260 }} />
                  <col style={{ width: 280 }} />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 260 }} />
                  <col style={{ width: 280 }} />
                  <col style={{ width: 110 }} />
                </colgroup>
                <thead className={CLINICAL_TABLE_THEAD}>
                  <tr>
                    <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Patient</th>
                    <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Folder</th>
                    <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Bed</th>
                    <th className={CLINICAL_TABLE_TH}>Ward</th>
                    <th className={CLINICAL_TABLE_TH}>Procedure</th>
                    <th className={CLINICAL_TABLE_TH}>Ward To do</th>
                    <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Doctor</th>
                    <th className={CLINICAL_TABLE_TH}>Admission Diagnosis</th>
                    <th
                      className={CLINICAL_TABLE_TH}
                      title="Outpatient / long-term follow-up (not ward tasks — use Ward To do for those)"
                    >
                      Long-term FU plan
                    </th>
                    <th
                      className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}
                      title="Planned outpatient or specialist follow-up date"
                    >
                      FU date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className={CLINICAL_TABLE_TBODY_TR}
                      onClick={() => setSelectedId(r.id)}
                    >
                      <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap align-top">
                        {r.firstName} {r.surname}
                      </td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap align-top">{r.folderNumber}</td>
                      <td className="px-3 py-2 whitespace-nowrap align-top">{r.bed}</td>
                      <td className="px-3 py-2 align-top">
                        <span className={wardBadgeClass(r.ward)}>{formatWardDisplay(r.ward)}</span>
                      </td>
                      <td className="px-3 py-2 text-xs align-top text-slate-800 break-words">
                        {r.procedure?.trim() ? r.procedure : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs align-top text-slate-800 break-words">
                        {r.taskIndicators?.length ? r.taskIndicators.map((t) => t.label).join(", ") : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs align-top whitespace-nowrap">{r.assignedDoctor}</td>
                      <td
                        className="px-3 py-2 text-xs align-top text-slate-800 break-words"
                        title={r.admissionDiagnosis}
                      >
                        {r.admissionDiagnosis?.trim() ? r.admissionDiagnosis : "—"}
                      </td>
                      <td
                        className="px-3 py-2 text-xs align-top text-slate-800 break-words"
                        title={r.followUpPlan}
                      >
                        {r.followUpPlan?.trim() ? r.followUpPlan : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs align-top text-slate-600 whitespace-nowrap">
                        {r.dateOfFollowUp?.trim() ? r.dateOfFollowUp : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ClinicalTableScroll>
          )}
        </>
      )}

      {sub === "other" && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-violet-300 bg-violet-50/40 cursor-pointer hover:bg-violet-50 text-sm font-medium text-slate-800">
              <Upload size={16} className="text-violet-600" />
              {stickerBusy ? "Extracting…" : "Add sticker — browse image"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={stickerBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void applySticker(f);
                }}
              />
            </label>
            {onOpenPatient ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  const id = resolvePatientIdFromClinicalNames(patients, draft.firstName, draft.surname);
                  if (id) onOpenPatient(id);
                  else
                    onToast?.(
                      "No HALO patient matches these names — open Patients and find consent or sticker files there.",
                      "info"
                    );
                }}
              >
                <FolderOpen size={16} className="text-violet-600" />
                Open patient folder in HALO
              </button>
            ) : null}
            <span className="text-xs text-slate-500">Mock OCR fills fields from the sticker image</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold text-slate-600">Surgeon</label>
              <select
                className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-200 text-sm"
                value={draft.surgeon}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, surgeon: e.target.value as OtherSurgeonInpatientDraft["surgeon"] }))
                }
              >
                {(["Hoosain", "Stanley", "de Beer", "Strydom"] as const).map((s) => (
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
                value={draft.weekendRoundComplete ? "Y" : "N"}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, weekendRoundComplete: e.target.value === "Y" }))
                }
              >
                <option value="N">N</option>
                <option value="Y">Y</option>
              </select>
            </div>
          </div>

          {[
            ["Surname", "surname"],
            ["First Name", "firstName"],
            ["Folder Number", "folderNumber"],
            ["Bed", "bed"],
            ["Date of Birth", "dateOfBirth"],
            ["ID Number", "idNumber"],
            ["Admission Diagnosis", "admissionDiagnosis"],
            ["ICD-10", "icd10Diagnoses"],
            ["Procedure", "procedure"],
            ["Procedure Codes", "procedureCodes"],
            ["Date of Procedure", "dateOfProcedure"],
            ["Complications", "complications"],
            ["Surgeon Plan", "surgeonPlan"],
            ["Management Plan", "managementPlan"],
            ["Inpatient Notes", "inpatientNotes"],
            ["Further Comment", "furtherComment"],
          ].map(([label, key]) => (
            <div key={key}>
              <label className="text-xs font-semibold text-slate-600">{label}</label>
              <input
                className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-200 text-sm"
                value={String((draft as unknown as Record<string, string | boolean>)[key] ?? "")}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [key]: e.target.value }))
                }
              />
            </div>
          ))}

          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold"
            onClick={() => onToast?.("Mock form saved (local only).", "success")}
          >
            Save (mock)
          </button>
        </div>
      )}

      {selected && (
        <InpatientDetailPanel
          record={selected}
          patients={patients}
          onToast={onToast}
          onClose={() => setSelectedId(null)}
          onSaved={() => void load()}
          onStartConsultation={() => {
            onToast?.("Consultation started (mock).", "info");
            setSelectedId(null);
          }}
          onRequestDischarge={() => void openDischargeFlow(selected)}
        />
      )}

      <DischargePatientModal
        open={Boolean(dischargeRecord)}
        onClose={closeDischargeModal}
        haloPatientId={dischargeRecord ? resolveHaloId(dischargeRecord) : null}
        patientDisplayName={
          dischargeRecord ? `${dischargeRecord.firstName} ${dischargeRecord.surname}`.trim() : ""
        }
        clinicalContext={buildDischargeClinicalContext(dischargeRecord ?? undefined, dischargeKanbanRow ?? undefined)}
        initialSummaryText={dischargeRecord?.inpatientNotes?.trim() || ""}
        inpatientRecord={dischargeRecord}
        onFinished={async () => {
          await load();
          setSelectedId(null);
        }}
        onToast={onToast}
      />

      {showAddAdmission && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto border border-slate-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800">New admission (mock)</h2>
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
              <p className="text-xs text-slate-600">
                Link a HALO folder and/or copy fields from a demo row. You can edit everything after save in the profile.
              </p>
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
                      {m.firstName} {m.surname} · {m.admissionDiagnosis || "—"}
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
                <label className="text-xs font-semibold text-slate-600">
                  Long-term / outpatient follow-up plan
                </label>
                <p className="text-[11px] text-slate-500 mt-0.5 mb-1">
                  GP or clinic follow-up after discharge — not the same as ward tasks.
                </p>
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
                  value={newAdmission.dateOfFollowUp?.slice(0, 10) || ""}
                  onChange={(e) =>
                    setNewAdmission((d) => ({ ...d, dateOfFollowUp: e.target.value }))
                  }
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => void saveNewAdmission()}
                  disabled={addSaving}
                  className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white font-semibold disabled:opacity-50"
                >
                  {addSaving ? "Saving…" : "Add to sheet"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddAdmission(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700"
                >
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
