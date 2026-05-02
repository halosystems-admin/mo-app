import type { ClinicalTaskIndicator, InpatientRecord } from '../../../types/clinical';
import { jsPDF } from 'jspdf';
import { formatInpatientDisplayName } from '../shared/clinicalDisplay';
import { formatWardDisplay } from '../shared/clinicalDisplay';

function csvEscape(cell: string): string {
  const s = cell ?? '';
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function taskIndicatorsToString(t: ClinicalTaskIndicator[] | undefined): string {
  if (!t?.length) return '';
  return t.map((x) => `${x.label}${x.urgent ? ' (!)' : ''}`).join('; ');
}

/** Full inpatient sheet row — every scalar field on `InpatientRecord` (matches Sheets UI columns). */
function rowToCells(r: InpatientRecord): string[] {
  return [
    r.currentlyAdmitted ? 'yes' : 'no',
    formatWardDisplay(r.ward),
    r.bed ?? '',
    r.surname ?? '',
    r.firstName ?? '',
    formatInpatientDisplayName(r.firstName, r.surname),
    r.dateOfBirth ?? '',
    r.idNumber ?? '',
    r.sex ?? '',
    String(r.age ?? ''),
    r.medicalAid ?? '',
    r.medicalAidNumber ?? '',
    r.medicalAidPhone ?? '',
    r.admissionDiagnosis ?? '',
    r.dateOfAdmission?.slice(0, 10) ?? '',
    r.dateOfReview?.slice(0, 10) ?? '',
    r.sheetAdmissionDateKind ?? '',
    r.icd10Diagnoses ?? '',
    r.procedure ?? '',
    r.procedureCodes ?? '',
    r.dateOfProcedure?.slice(0, 10) ?? '',
    r.complications ?? '',
    r.surgeonPlan ?? '',
    r.managementPlan ?? '',
    r.dateOfDischarge?.slice(0, 10) ?? '',
    r.followUpPlan ?? '',
    r.dateOfFollowUp?.slice(0, 10) ?? '',
    r.inpatientNotes ?? '',
    r.furtherComment ?? '',
    r.folderNumber ?? '',
    taskIndicatorsToString(r.taskIndicators),
    r.assignedDoctor ?? '',
    r.linkedDrivePatientId ?? '',
    r.contactNumber ?? '',
    r.sheetStatus ?? '',
    r.taskPendingVericlaimDone ? 'yes' : 'no',
    r.taskDownloadSlipDone ? 'yes' : 'no',
  ];
}

const CSV_HEADERS = [
  'Admitted',
  'Ward',
  'Bed',
  'Surname',
  'First name',
  'Display name',
  'DOB',
  'ID number',
  'Sex',
  'Age',
  'Medical aid',
  'Aid member no',
  'Aid phone',
  'Admission diagnosis',
  'DOA',
  'Review date',
  'DOA/FU mode',
  'ICD-10',
  'Procedure',
  'Procedure codes',
  'Procedure date',
  'Complications',
  'Surgeon plan',
  'Management plan',
  'Discharge date',
  'Follow-up plan',
  'Follow-up date',
  'Inpatient notes',
  'Further comment',
  'Folder',
  'Tasks',
  'Surgeon',
  'Linked Drive patient',
  'Contact',
  'Sheet status',
  'Vericlaim done',
  'Download slip done',
];

export function exportInpatientsCsv(rows: InpatientRecord[], filenameBase = 'inpatient-sheets'): void {
  const lines = [CSV_HEADERS.map(csvEscape).join(',')];
  for (const r of rows) {
    lines.push(rowToCells(r).map(csvEscape).join(','));
  }
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${filenameBase}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function exportInpatientsPdf(rows: InpatientRecord[], title = 'Inpatient sheets'): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const margin = 8;
  let y = margin;
  doc.setFontSize(11);
  doc.text(title, margin, y);
  y += 6;
  doc.setFontSize(6);

  const pageW = doc.internal.pageSize.getWidth() - margin * 2;

  for (const r of rows) {
    const cells = rowToCells(r);
    const pairs = CSV_HEADERS.map((h, i) => `${h}: ${cells[i] ?? ''}`).join('  •  ');
    if (y > doc.internal.pageSize.getHeight() - 12) {
      doc.addPage();
      y = margin;
    }
    const wrapped = doc.splitTextToSize(pairs, pageW);
    doc.text(wrapped, margin, y);
    y += Math.max(4, wrapped.length * 2.8) + 2;
  }

  doc.save(`inpatient-sheets-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function printInpatientsTable(rows: InpatientRecord[], title = 'Inpatient sheets'): void {
  const esc = (s: string) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  const head = CSV_HEADERS.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${rowToCells(r).map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
    .join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${esc(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; font-size: 10px; margin: 12px; }
  h1 { font-size: 14px; margin: 0 0 10px; }
  .wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: max-content; min-width: 100%; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; white-space: nowrap; max-width: 28rem; overflow: hidden; text-overflow: ellipsis; }
  th { background: #f4f4f5; font-weight: 600; position: sticky; top: 0; }
</style></head><body>
<h1>${esc(title)}</h1>
<div class="wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
<script>window.onload = () => { window.print(); };</script>
</body></html>`;
  const w = window.open('', '_blank');
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
  }
}
