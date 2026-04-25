import React, { useCallback, useEffect, useState } from 'react';
import type { AdmittedPatientKanban, Patient } from '../../../../../shared/types';
import type { InpatientRecord } from '../../../types/clinical';
import { fetchAdmissionsAll, getInpatientById } from '../../../services/clinicalData';
import { fetchWardKanban } from '../../../services/wardBoardBackend';
import { DischargePatientModal } from '../shared/DischargePatientModal';
import { buildDischargeClinicalContext } from '../shared/dischargeContext';
import { InpatientDetailPanel } from '../shared/InpatientDetailPanel';
import { ClinicalTableScroll } from '../shared/ClinicalTableScroll';
import { CLINICAL_TABLE_TH, CLINICAL_TABLE_TBODY_TR, CLINICAL_TABLE_THEAD } from '../shared/tableScrollClasses';
import {
  formatWardDisplay,
  resolvePatientIdFromClinicalNames,
  wardBadgeClass,
} from '../shared/clinicalDisplay';
import { MessageCircle, Phone } from 'lucide-react';

interface Props {
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
  patients?: Patient[];
}

export const AdmissionsAllSection: React.FC<Props> = ({ onToast, patients = [] }) => {
  const [rows, setRows] = useState<InpatientRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
      setRows(await fetchAdmissionsAll());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = selectedId ? getInpatientById(selectedId) : undefined;

  return (
    <div className="space-y-4">
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <ClinicalTableScroll>
          <table className="min-w-[2800px] w-full text-sm border-separate border-spacing-0">
            <thead className={CLINICAL_TABLE_THEAD}>
              <tr>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Admitted</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Bed</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Surname</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Name</th>
                <th className={`${CLINICAL_TABLE_TH} min-w-[10rem]`}>Adm dx</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>DOB</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>ID</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Sex</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Age</th>
                <th className={`${CLINICAL_TABLE_TH} min-w-[6rem] whitespace-nowrap`}>Aid</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Aid #</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Contact</th>
                <th className={`${CLINICAL_TABLE_TH} min-w-[7rem]`}>Ward</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Folder</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Adm date</th>
                <th className={`${CLINICAL_TABLE_TH} min-w-[5rem] whitespace-nowrap`}>ICD-10</th>
                <th className={`${CLINICAL_TABLE_TH} min-w-[11rem]`}>Procedure</th>
                <th className={`${CLINICAL_TABLE_TH} min-w-[6rem]`}>Proc codes</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Proc date</th>
                <th className={`${CLINICAL_TABLE_TH} min-w-[8rem]`}>Complications</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Discharge</th>
                <th
                  className={`${CLINICAL_TABLE_TH} min-w-[11rem]`}
                >
                  Long-term FU plan
                </th>
                <th
                  className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}
                >
                  FU date
                </th>
                <th className={`${CLINICAL_TABLE_TH} min-w-[12rem]`}>Notes</th>
                <th className={`${CLINICAL_TABLE_TH} min-w-[9rem]`}>Comment</th>
                <th className={`${CLINICAL_TABLE_TH} whitespace-nowrap`}>Doctor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tel = r.medicalAidPhone?.replace(/\s/g, '') || '';
                return (
                  <tr
                    key={r.id}
                    className={CLINICAL_TABLE_TBODY_TR}
                    onClick={() => setSelectedId(r.id)}
                  >
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.currentlyAdmitted ? 'Y' : 'N'}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.bed}</td>
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{r.surname}</td>
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{r.firstName}</td>
                    <td
                      className="px-3 py-2 text-xs align-top min-w-[10rem] max-w-[14rem] whitespace-normal break-words"
                      title={r.admissionDiagnosis}
                    >
                      {r.admissionDiagnosis}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.dateOfBirth}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.idNumber}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.sex}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.age}</td>
                    <td className="px-3 py-2 text-xs min-w-[6rem] whitespace-nowrap" title={r.medicalAid}>
                      {r.medicalAid}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.medicalAidNumber}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2 flex-wrap max-w-[10rem]">
                        <span className="text-xs text-slate-800 tabular-nums">{r.medicalAidPhone || '—'}</span>
                        {tel ? (
                          <span className="inline-flex gap-1 text-teal-600 shrink-0">
                            <a
                              href={`tel:${tel}`}
                              className="p-1 rounded-md hover:bg-teal-100"
                              aria-label="Call"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Phone size={14} />
                            </a>
                            <a
                              href={`sms:${tel}`}
                              className="p-1 rounded-md hover:bg-teal-100"
                              aria-label="SMS"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MessageCircle size={14} />
                            </a>
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs min-w-[7rem] whitespace-normal">
                      <span className={wardBadgeClass(r.ward)}>{formatWardDisplay(r.ward)}</span>
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.folderNumber}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.dateOfAdmission}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap" title={r.icd10Diagnoses}>
                      {r.icd10Diagnoses}
                    </td>
                    <td
                      className="px-3 py-2 text-xs align-top min-w-[11rem] max-w-[16rem] whitespace-normal break-words"
                      title={r.procedure}
                    >
                      {r.procedure}
                    </td>
                    <td className="px-3 py-2 text-xs min-w-[6rem] whitespace-normal break-words" title={r.procedureCodes}>
                      {r.procedureCodes}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.dateOfProcedure || '—'}</td>
                    <td
                      className="px-3 py-2 text-xs align-top min-w-[8rem] max-w-[12rem] whitespace-normal break-words"
                      title={r.complications || undefined}
                    >
                      {r.complications || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.dateOfDischarge || '—'}</td>
                    <td
                      className="px-3 py-2 text-xs align-top min-w-[11rem] max-w-[15rem] whitespace-normal break-words"
                      title={r.followUpPlan || undefined}
                    >
                      {r.followUpPlan || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.dateOfFollowUp || '—'}</td>
                    <td
                      className="px-3 py-2 text-xs align-top min-w-[12rem] max-w-[18rem] whitespace-normal break-words"
                      title={r.inpatientNotes}
                    >
                      {r.inpatientNotes}
                    </td>
                    <td
                      className="px-3 py-2 text-xs align-top min-w-[9rem] max-w-[14rem] whitespace-normal break-words"
                      title={r.furtherComment || undefined}
                    >
                      {r.furtherComment || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.assignedDoctor}</td>
                  </tr>
                );
              })}
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
        />
      )}

      <DischargePatientModal
        open={Boolean(dischargeRecord)}
        onClose={closeDischargeModal}
        patients={patients}
        haloPatientId={dischargeRecord ? resolveHaloId(dischargeRecord) : null}
        patientDisplayName={
          dischargeRecord ? `${dischargeRecord.firstName} ${dischargeRecord.surname}`.trim() : ''
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
    </div>
  );
};
