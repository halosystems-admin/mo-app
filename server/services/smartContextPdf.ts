import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { ClinicalContextStructured } from '../../shared/types';
import { drawDrPatelLetterheadPdfLib, PAGE_W, MARGIN } from './drPatelLetterheadPdfLib';

const PAGE_H = 792;
const FONT_SIZE = 9;
const LINE_H = 11;

export type SmartContextSourceImage = {
  data: Uint8Array;
  mimeType: string;
  sourceFileName: string;
  stamp?: string;
};

function wrapToChunks(s: string, width: number): string[] {
  const t = s.trim();
  if (!t) return [];
  const words = t.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > width) {
      if (cur) lines.push(cur);
      cur = w.length > width ? w.slice(0, width) : w;
      while (cur.length >= width) {
        lines.push(cur.slice(0, width));
        cur = cur.slice(width);
      }
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * One-page+ PDF: Dr Patel letterhead + structured Smart Context findings.
 */
export async function buildSmartContextExportPdf(
  structured: ClinicalContextStructured,
  meta: { sourceFileName: string; stamp?: string }
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = await drawDrPatelLetterheadPdfLib(doc, page, PAGE_W);

  const maxW = PAGE_W - 2 * MARGIN;
  const stamp = meta.stamp ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const title = `Smart context — ${stamp}`;
  page.drawText(title.slice(0, 120), {
    x: MARGIN,
    y,
    size: 11,
    font: fontBold,
    color: rgb(0.12, 0.12, 0.12),
    maxWidth: maxW,
  });
  y -= 18;

  page.drawText(`Source file: ${meta.sourceFileName.slice(0, 200)}`, {
    x: MARGIN,
    y,
    size: 8,
    font,
    color: rgb(0.35, 0.35, 0.35),
    maxWidth: maxW,
  });
  y -= 14;

  const blocks: string[] = [];
  if (structured.summary) blocks.push(`Summary\n${structured.summary}`);
  if (structured.findings.length) {
    blocks.push(`Findings\n${structured.findings.map((f) => `• ${f}`).join('\n')}`);
  }
  if (structured.extracted_text) blocks.push(`Extracted text\n${structured.extracted_text}`);
  if (structured.clinical_interpretation) {
    blocks.push(`Clinical interpretation\n${structured.clinical_interpretation}`);
  }
  const body = blocks.join('\n\n').slice(0, 14_000);

  for (const para of body.split(/\n/)) {
    const chunks = wrapToChunks(para, 92);
    for (const line of chunks.length ? chunks : ['']) {
      if (y < MARGIN + LINE_H) {
        page = doc.addPage([PAGE_W, PAGE_H]);
        y = page.getHeight() - MARGIN;
      }
      if (line) {
        page.drawText(line, {
          x: MARGIN,
          y,
          size: FONT_SIZE,
          font,
          color: rgb(0.15, 0.15, 0.15),
          maxWidth: maxW,
        });
      }
      y -= LINE_H;
    }
  }

  return doc.save();
}

/**
 * Same letterhead as structured export, but body = markdown summary only (when JSON pass failed).
 */
export async function buildSmartContextMarkdownPdf(
  summaryMarkdown: string,
  meta: { sourceFileName: string; stamp?: string }
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = await drawDrPatelLetterheadPdfLib(doc, page, PAGE_W);

  const maxW = PAGE_W - 2 * MARGIN;
  const stamp = meta.stamp ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const title = `Smart context — ${stamp}`;
  page.drawText(title.slice(0, 120), {
    x: MARGIN,
    y,
    size: 11,
    font: fontBold,
    color: rgb(0.12, 0.12, 0.12),
    maxWidth: maxW,
  });
  y -= 18;

  page.drawText(`Source file: ${meta.sourceFileName.slice(0, 200)}`, {
    x: MARGIN,
    y,
    size: 8,
    font,
    color: rgb(0.35, 0.35, 0.35),
    maxWidth: maxW,
  });
  y -= 14;

  const body = summaryMarkdown.trim().slice(0, 14_000);
  for (const para of body.split(/\n/)) {
    const lineFont = /^#{1,3}\s/.test(para) ? fontBold : font;
    const stripped = para.replace(/^#{1,3}\s*/, '');
    const chunks = wrapToChunks(stripped, 92);
    for (const line of chunks.length ? chunks : ['']) {
      if (y < MARGIN + LINE_H) {
        page = doc.addPage([PAGE_W, PAGE_H]);
        y = page.getHeight() - MARGIN;
      }
      if (line) {
        page.drawText(line, {
          x: MARGIN,
          y,
          size: /^#{1,3}\s/.test(para) ? 10 : FONT_SIZE,
          font: lineFont,
          color: rgb(0.15, 0.15, 0.15),
          maxWidth: maxW,
        });
      }
      y -= LINE_H;
    }
  }

  return doc.save();
}

/**
 * Save the original uploaded clinical image as a PDF companion in the patient folder.
 */
export async function buildSmartContextSourceImagePdf(
  source: SmartContextSourceImage
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  let y = await drawDrPatelLetterheadPdfLib(doc, page, PAGE_W);

  const maxW = PAGE_W - 2 * MARGIN;
  const stamp = source.stamp ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  page.drawText(`Uploaded context image — ${stamp}`.slice(0, 120), {
    x: MARGIN,
    y,
    size: 11,
    font: fontBold,
    color: rgb(0.12, 0.12, 0.12),
    maxWidth: maxW,
  });
  y -= 18;

  page.drawText(`Source file: ${source.sourceFileName.slice(0, 200)}`, {
    x: MARGIN,
    y,
    size: 8,
    font,
    color: rgb(0.35, 0.35, 0.35),
    maxWidth: maxW,
  });
  y -= 18;

  const mt = source.mimeType.toLowerCase();
  const embedded = mt.includes('png') ? await doc.embedPng(source.data) : await doc.embedJpg(source.data);
  const boxW = PAGE_W - 2 * MARGIN;
  const boxH = Math.max(120, y - MARGIN);
  const scale = Math.min(boxW / embedded.width, boxH / embedded.height, 1);
  const dw = embedded.width * scale;
  const dh = embedded.height * scale;
  page.drawImage(embedded, {
    x: MARGIN,
    y: y - dh,
    width: dw,
    height: dh,
  });

  return doc.save();
}
