import { jsPDF } from 'jspdf';
import type { UserSettings } from '../../../../../shared/types';
import type { AslipSummaryFields, ClinicalWard } from '../../../types/clinical';
import { formatWardDisplay } from '../shared/clinicalDisplay';
import { applyDrPatelLetterheadJsPdf } from './documentLetterheadPdf';

/** Brand teal (section cards — body content). */
const V: [number, number, number] = [124, 58, 237];
const V_LIGHT: [number, number, number] = [237, 233, 254];
const SLATE_HEADER: [number, number, number] = [51, 65, 85];
const SLATE_MUTED: [number, number, number] = [100, 116, 139];
const SLATE_BODY: [number, number, number] = [30, 41, 59];

/** Horizontal offset (mm) from page margin to value column — matches reference A-slip gutter. */
const ASLIP_LABEL_OFFSET = 48;

function drawSectionTitle(doc: jsPDF, x: number, y: number, w: number, title: string): number {
  doc.setFillColor(...V_LIGHT);
  doc.roundedRect(x, y, w, 10, 1.8, 1.8, 'F');
  doc.setDrawColor(...V);
  doc.setLineWidth(0.35);
  doc.roundedRect(x, y, w, 10, 1.8, 1.8, 'S');
  doc.setTextColor(...V);
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.text(title, x + 3.5, y + 7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);
  return y + 14;
}

function fieldRowHeight(doc: jsPDF, value: string, maxW: number): number {
  const lines = doc.splitTextToSize(value || '—', maxW);
  return Math.max(5.5, 4.8 + (lines.length - 1) * 5);
}

function fieldRow(
  doc: jsPDF,
  x: number,
  y: number,
  _w: number,
  label: string,
  value: string,
  maxW: number,
  labelOffset = ASLIP_LABEL_OFFSET
): number {
  doc.setFontSize(8);
  doc.setTextColor(...SLATE_MUTED);
  doc.setFont('helvetica', 'bold');
  doc.text(label, x, y);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);
  const lines = doc.splitTextToSize(value || '—', maxW);
  doc.text(lines, x + labelOffset, y);
  return y + fieldRowHeight(doc, value, maxW);
}

function contactRow(doc: jsPDF, x: number, y: number, phone: string | undefined, maxW: number, labelOffset: number): number {
  doc.setFontSize(8);
  doc.setTextColor(...SLATE_MUTED);
  doc.setFont('helvetica', 'bold');
  doc.text('Contact', x, y);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);
  const raw = phone?.trim() || '';
  const tel = raw.replace(/\s/g, '');
  if (!raw) {
    const lines = doc.splitTextToSize('—', maxW);
    doc.text(lines, x + labelOffset, y);
    return y + fieldRowHeight(doc, '', maxW);
  }
  doc.text(raw, x + labelOffset, y);
  if (tel) {
    const numW = doc.getTextWidth(raw);
    let lx = x + labelOffset + numW + 2.5;
    doc.setFontSize(7.5);
    doc.setTextColor(...V);
    doc.setFont('helvetica', 'bold');
    doc.textWithLink('Call', lx, y, { url: `tel:${tel}` });
    lx += doc.getTextWidth('Call') + 2.5;
    doc.textWithLink('SMS', lx, y, { url: `sms:${tel}` });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);
  }
  return y + 5.5;
}

/** Renders note text with real headings (Markdown # lines → bold type, no hash characters in output). */
function drawClinicalNotesMarkdownBody(
  doc: jsPDF,
  raw: string,
  margin: number,
  contentW: number,
  pageH: number,
  yStart: number
): number {
  let y = yStart;
  const lines = raw.split(/\r?\n/);
  const bodyLineGap = 5.1;
  const blankGap = 2.5;
  const afterHeadingGap = 4;

  const ensureSpace = (needMm: number) => {
    if (y + needMm > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      y += blankGap;
      i++;
      continue;
    }
    if (/^-{3,}\s*$/.test(trimmed)) {
      y += 6;
      i++;
      continue;
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].trim();
      const fontSize = level <= 1 ? 12.5 : level === 2 ? 10.8 : 9.5;
      ensureSpace(fontSize + afterHeadingGap);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(fontSize);
      doc.setTextColor(...SLATE_BODY);
      const wrapped = doc.splitTextToSize(title, contentW);
      for (const wl of wrapped) {
        ensureSpace(bodyLineGap + 1);
        doc.text(wl, margin, y);
        y += bodyLineGap + 0.5;
      }
      y += afterHeadingGap;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      i++;
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length) {
      const L = lines[i];
      const t = L.trim();
      if (!t) break;
      if (/^#{1,6}\s/.test(t) || /^-{3,}\s*$/.test(t)) break;
      paraLines.push(L);
      i++;
    }
    const paraText = paraLines.join('\n').trimEnd();
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...SLATE_BODY);
    const wrapped = doc.splitTextToSize(paraText, contentW);
    for (const wl of wrapped) {
      ensureSpace(bodyLineGap);
      doc.text(wl, margin, y);
      y += bodyLineGap;
    }
    y += blankGap;
  }
  return y;
}

export async function downloadClinicalNotesPdf(
  patientName: string,
  notes: string,
  settings?: UserSettings | null
): Promise<void> {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 16;
  const contentW = pageW - margin * 2;

  let y = await applyDrPatelLetterheadJsPdf(doc, margin, pageW, {
    title: 'Clinical notes export',
    subtitle: 'HALO · confidential',
  });
  doc.setFontSize(8);
  doc.setTextColor(...SLATE_MUTED);
  doc.text(`Generated ${new Date().toLocaleString()}`, pageW - margin, y, { align: 'right' });
  y += 12;

  doc.setFontSize(10);
  doc.setTextColor(...SLATE_MUTED);
  doc.setFont('helvetica', 'bold');
  doc.text('Patient', margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...SLATE_BODY);
  doc.text(patientName?.trim() || '—', margin, y);
  y += 12;

  y = drawClinicalNotesMarkdownBody(doc, notes?.trim() || 'No content.', margin, contentW, pageH, y);

  const safe = (patientName || 'patient').replace(/[^\w\s-]/g, '').trim().slice(0, 48) || 'patient';
  doc.save(`halo-clinical-notes-${safe}-mock.pdf`);
}

export async function downloadTheatreListPdf(settings?: UserSettings | null): Promise<void> {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 16;
  let y = await applyDrPatelLetterheadJsPdf(doc, margin, pageW, {
    title: 'Theatre list',
    subtitle: 'Mock schedule export',
  });
  y += 2;
  doc.setFontSize(9);
  doc.setTextColor(...SLATE_MUTED);
  const who = settings
    ? `${settings.firstName} ${settings.lastName} · ${settings.profession} · ${settings.department}`
    : '';
  if (who) {
    doc.text(who, margin, y);
    y += 8;
  }
  doc.setTextColor(...SLATE_BODY);
  doc.text('Case 1 — Lap chole — OT1 — 08:00', margin, y);
  y += 7;
  doc.text('Case 2 — Hernia — OT2 — 10:30', margin, y);
  doc.save('halo-theatre-list-mock.pdf');
}

/** Styled A-slip PDF — letterhead from Settings + card layout. */
export async function downloadAslipPdf(
  data?: Partial<AslipSummaryFields>,
  settings?: UserSettings | null
): Promise<void> {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 16;
  const contentW = pageW - margin * 2;
  const valueMaxW = contentW - ASLIP_LABEL_OFFSET - 2;

  let y = await applyDrPatelLetterheadJsPdf(doc, margin, pageW, {
    title: 'Authorization request (A-slip)',
    subtitle: 'Clinical summary for funding / authorization (mock export)',
  });
  y -= 2;
  const ref = data?.idNumber
    ? `Ref: ASL-${String(data.idNumber).slice(-6)}`
    : 'Ref: MOCK-ASLIP-2026';
  doc.setFontSize(8);
  doc.setTextColor(...SLATE_MUTED);
  doc.text(ref, margin, y);
  doc.text(`Generated ${new Date().toLocaleString()}`, pageW - margin, y, { align: 'right' });
  y += 11;

  if (data && (data.surname || data.firstName)) {
    const wardLabel = data.ward ? formatWardDisplay(data.ward as ClinicalWard) : '—';
    const cardTop = y - 1;
    const sect = 14;
    let est = 0;
    est += sect;
    est += fieldRowHeight(doc, `${data.firstName || ''} ${data.surname || ''}`.trim(), valueMaxW);
    est += fieldRowHeight(
      doc,
      `DOB ${data.dateOfBirth || '—'}   Sex ${data.sex || '—'}   Age ${data.age || '—'}`,
      valueMaxW
    );
    est += fieldRowHeight(doc, data.idNumber || '—', valueMaxW);
    est += fieldRowHeight(doc, data.medicalAid || '—', valueMaxW);
    est += fieldRowHeight(doc, data.medicalAidNumber || '—', valueMaxW);
    est += 5;
    est += fieldRowHeight(doc, `Ward: ${wardLabel}   Bed: ${data.bed || '—'}`, valueMaxW);
    est += fieldRowHeight(doc, data.dateOfAdmission || '—', valueMaxW);
    est += 7;
    est += sect;
    est += fieldRowHeight(doc, data.admissionDiagnosis || '—', valueMaxW);
    est += fieldRowHeight(doc, data.icd10Diagnosis || '—', valueMaxW);
    est += fieldRowHeight(doc, data.inpatientNotes || '—', valueMaxW);
    est += fieldRowHeight(doc, data.awaitingOutpatientEndoscopy || '—', valueMaxW);
    est += fieldRowHeight(doc, String(data.processPending || '—'), valueMaxW);
    est += 12;
    est += 18;

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.28);
    doc.roundedRect(margin - 1, cardTop, contentW + 2, est, 3, 3, 'S');

    y = drawSectionTitle(doc, margin, y, contentW, 'Patient');

    y = fieldRow(doc, margin, y, contentW, 'Name', `${data.firstName || ''} ${data.surname || ''}`.trim(), valueMaxW);
    y = fieldRow(
      doc,
      margin,
      y,
      contentW,
      'Demographics',
      `DOB ${data.dateOfBirth || '—'}   Sex ${data.sex || '—'}   Age ${data.age || '—'}`,
      valueMaxW
    );
    y = fieldRow(doc, margin, y, contentW, 'ID number', data.idNumber || '—', valueMaxW);
    y = fieldRow(doc, margin, y, contentW, 'Medical aid', data.medicalAid || '—', valueMaxW);
    y = fieldRow(doc, margin, y, contentW, 'Member number', data.medicalAidNumber || '—', valueMaxW);
    y = contactRow(doc, margin, y, data.contactNumber, valueMaxW, ASLIP_LABEL_OFFSET);
    y = fieldRow(
      doc,
      margin,
      y,
      contentW,
      'Location',
      `Ward: ${wardLabel}   Bed: ${data.bed || '—'}`,
      valueMaxW
    );
    y = fieldRow(doc, margin, y, contentW, 'Admission date', data.dateOfAdmission || '—', valueMaxW);
    y += 7;

    y = drawSectionTitle(doc, margin, y, contentW, 'Clinical');

    y = fieldRow(doc, margin, y, contentW, 'Admission diagnosis', data.admissionDiagnosis || '—', valueMaxW);
    y = fieldRow(doc, margin, y, contentW, 'ICD-10', data.icd10Diagnosis || '—', valueMaxW);
    y = fieldRow(doc, margin, y, contentW, 'Inpatient notes', data.inpatientNotes || '—', valueMaxW);
    y = fieldRow(
      doc,
      margin,
      y,
      contentW,
      'Awaiting OPD endoscopy',
      data.awaitingOutpatientEndoscopy || '—',
      valueMaxW
    );
    y = fieldRow(doc, margin, y, contentW, 'Process pending', String(data.processPending || '—'), valueMaxW);

    y += 12;
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, y, contentW, 18, 2.5, 2.5, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, y, contentW, 18, 2.5, 2.5, 'S');
    doc.setFontSize(8);
    doc.setTextColor(...SLATE_MUTED);
    const disc = doc.splitTextToSize(
      'Mock HALO export for demonstration only — not a legal authorization.',
      contentW - 10
    );
    doc.text(disc, margin + 5, y + 11);
  } else {
    doc.setFillColor(...V_LIGHT);
    doc.roundedRect(margin, y, contentW, 28, 3, 3, 'F');
    doc.setDrawColor(...V);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, y, contentW, 28, 3, 3, 'S');
    doc.setFontSize(10);
    doc.setTextColor(...SLATE_HEADER);
    doc.text('No patient summary attached', margin + 6, y + 12);
    doc.setFontSize(8);
    doc.setTextColor(...SLATE_MUTED);
    doc.text('Fill the A-slip form in HALO Hospital, then download again.', margin + 6, y +20);
  }

  doc.save('halo-aslip-mock.pdf');
}
