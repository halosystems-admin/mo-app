import type { jsPDF } from 'jspdf';
import { loadDrPatelLetterheadImage } from './drPatelLetterheadEmbed';

/**
 * Shared Dr Mohamed Patel letterhead for all downloadable PDFs (A-slip, clinical notes, theatre list).
 * Prefer `/public/dr-mohamed-patel-letterhead.png`; vector fallback if missing.
 */

export const DR_PATEL_LETTERHEAD_HEIGHT_MM = 52;

const CHARCOAL: [number, number, number] = [51, 51, 51];
const MUTED: [number, number, number] = [100, 100, 100];
const RULE: [number, number, number] = [210, 210, 210];

export type LetterheadDocMeta = {
  title: string;
  subtitle?: string;
};

export function drawDrMohamedPatelLetterhead(
  doc: jsPDF,
  margin: number,
  pageW: number,
  meta: LetterheadDocMeta
): void {
  const yTop = 10;
  const leftX = margin;

  const cx = leftX + 6;
  const cy = yTop + 7;
  doc.setDrawColor(...CHARCOAL);
  doc.setLineWidth(0.35);
  doc.circle(cx, cy, 5.2, 'S');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...CHARCOAL);
  doc.text('M', cx - 3.2, cy + 1.2);
  doc.text('P', cx + 0.2, cy + 1.2);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Dr Mohamed Patel', leftX + 14, yTop + 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(...MUTED);
  doc.text('G E N E R A L   S U R G E O N', leftX + 14, yTop + 16);

  const rx = pageW - margin;
  let ry = yTop + 7;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...CHARCOAL);
  doc.text('MQ Patel Inc / Pr No: 1234226', rx, ry, { align: 'right' });
  ry += 4.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(...MUTED);
  doc.text('MBChB (UCT), FCS (SA), MMed-Surgery (Stellenbosch)', rx, ry, { align: 'right' });
  ry += 4;
  doc.text('Room 402, 4th Floor Medical Centre', rx, ry, { align: 'right' });
  ry += 3.8;
  doc.text('Mediclinic Louis Leipoldt, 7 Broadway Street, Bellville', rx, ry, { align: 'right' });
  ry += 3.8;
  doc.text('021 001 2756', rx, ry, { align: 'right' });
  ry += 3.8;
  doc.text('www.drmohamedpatel.co.za', rx, ry, { align: 'right' });
  ry += 3.8;
  doc.text('reception@drmohamedpatel.co.za', rx, ry, { align: 'right' });

  ry += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...CHARCOAL);
  doc.text(meta.title, rx, ry, { align: 'right' });
  if (meta.subtitle?.trim()) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(...MUTED);
    doc.text(meta.subtitle.trim(), rx, ry + 5, { align: 'right' });
  }

  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.35);
  doc.line(margin, DR_PATEL_LETTERHEAD_HEIGHT_MM - 2, pageW - margin, DR_PATEL_LETTERHEAD_HEIGHT_MM - 2);
}

/**
 * Apply official letterhead image when available; else vector {@link drawDrMohamedPatelLetterhead}.
 * Returns Y position in mm where body content should start.
 */
export async function applyDrPatelLetterheadJsPdf(
  doc: jsPDF,
  margin: number,
  pageW: number,
  meta: LetterheadDocMeta
): Promise<number> {
  const img = await loadDrPatelLetterheadImage();
  if (img) {
    const maxW = pageW - 2 * margin;
    const drawH = (img.h / img.w) * maxW;
    const topMm = 8;
    doc.addImage(img.dataUrl, 'PNG', margin, topMm, maxW, drawH);
    doc.setDrawColor(210, 210, 210);
    doc.setLineWidth(0.35);
    doc.line(margin, topMm + drawH + 1.5, pageW - margin, topMm + drawH + 1.5);
    let y = topMm + drawH + 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(51, 51, 51);
    doc.text(meta.title, pageW - margin, y, { align: 'right' });
    y += 5;
    if (meta.subtitle?.trim()) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.8);
      doc.setTextColor(100, 100, 100);
      doc.text(meta.subtitle.trim(), pageW - margin, y, { align: 'right' });
      y += 6;
    }
    return y + 4;
  }
  doc.setFillColor(247, 249, 251);
  doc.rect(0, 0, pageW, DR_PATEL_LETTERHEAD_HEIGHT_MM, 'F');
  drawDrMohamedPatelLetterhead(doc, margin, pageW, meta);
  return DR_PATEL_LETTERHEAD_HEIGHT_MM + 8;
}
