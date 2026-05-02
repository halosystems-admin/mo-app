import type { InpatientRecord } from '../../../types/clinical';
import { jsPDF } from 'jspdf';
import { formatInpatientDisplayName } from '../shared/clinicalDisplay';
import { formatWardDisplay } from '../shared/clinicalDisplay';

function csvEscape(cell: string): string {
  const s = cell ?? '';
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Columns aligned with the main inpatient grid (subset). */
function rowToCells(r: InpatientRecord): string[] {
  return [
    formatWardDisplay(r.ward),
    r.bed ?? '',
    formatInpatientDisplayName(r.firstName, r.surname),
    r.assignedDoctor ?? '',
    r.admissionDiagnosis ?? '',
    r.surgeonPlan ?? '',
    r.managementPlan ?? '',
    r.inpatientNotes ?? '',
    r.dateOfAdmission?.slice(0, 10) ?? '',
    r.dateOfReview?.slice(0, 10) ?? '',
    r.sheetStatus ?? '',
    r.folderNumber ?? '',
  ];
}

const CSV_HEADERS = [
  'Ward',
  'Bed',
  'Name',
  'Surgeon',
  'Diagnosis',
  'Surgeon plan',
  'Management plan',
  'Notes',
  'DOA',
  'Review',
  'Status',
  'Folder',
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
  const margin = 10;
  let y = margin;
  doc.setFontSize(12);
  doc.text(title, margin, y);
  y += 8;
  doc.setFontSize(7);

  const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

  for (const r of rows) {
    const c = rowToCells(r);
    const line = `${clip(c[0]!, 18)} | ${clip(c[1]!, 10)} | ${clip(c[2]!, 36)} | ${clip(c[3]!, 22)} | ${clip(
      c[4]!,
      56
    )}`;
    if (y > doc.internal.pageSize.getHeight() - 14) {
      doc.addPage();
      y = margin;
    }
    const wrapped = doc.splitTextToSize(line, doc.internal.pageSize.getWidth() - margin * 2);
    doc.text(wrapped, margin, y);
    y += Math.max(5, wrapped.length * 3.6);
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
  body { font-family: system-ui, sans-serif; font-size: 11px; margin: 12px; }
  h1 { font-size: 14px; margin: 0 0 10px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f4f4f5; font-weight: 600; }
</style></head><body>
<h1>${esc(title)}</h1>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
<script>window.onload = () => { window.print(); };</script>
</body></html>`;
  const w = window.open('', '_blank');
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
  }
}
