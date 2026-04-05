import type { AdmittedPatientKanban } from '../../../../../shared/types';
import type { InpatientRecord } from '../../../types/clinical';

/** Text bundle for AI discharge draft — admission + optional ward kanban row. */
export function buildDischargeClinicalContext(
  ip: InpatientRecord | undefined,
  row: AdmittedPatientKanban | undefined
): string {
  const lines: string[] = [];
  if (ip) {
    lines.push(`Admission diagnosis: ${ip.admissionDiagnosis || '—'}`);
    lines.push(`ICD-10: ${ip.icd10Diagnoses || '—'}`);
    lines.push(`Ward / bed: ${ip.ward} / ${ip.bed || '—'}`);
    lines.push(`Admission date: ${ip.dateOfAdmission || '—'}`);
    lines.push(`Procedure: ${ip.procedure || '—'} (${ip.dateOfProcedure || '—'})`);
    lines.push(`Complications: ${ip.complications || '—'}`);
    lines.push(`Inpatient notes (Hospital record): ${ip.inpatientNotes || '—'}`);
    if (ip.followUpPlan?.trim()) {
      lines.push(`Outpatient follow-up plan (from admission): ${ip.followUpPlan.trim()}`);
    }
    if (ip.dateOfFollowUp?.trim()) {
      lines.push(`Follow-up date: ${ip.dateOfFollowUp.trim()}`);
    }
  }
  if (row?.todos?.length) {
    const open = row.todos.filter((t) => t.status !== 'Done').map((t) => t.title);
    const done = row.todos.filter((t) => t.status === 'Done').map((t) => t.title);
    if (open.length) lines.push(`Open ward tasks: ${open.join('; ')}`);
    if (done.length) lines.push(`Completed ward tasks: ${done.join('; ')}`);
  }
  return lines.join('\n');
}
