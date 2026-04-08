import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const MAX_BODY_CHARS = 12_000;
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;
const FONT_SIZE = 9;
const LINE_H = 11;

export type ContextAppendImage = { data: Uint8Array; mimeType: string; label?: string };

/**
 * Text section + optional clinical images (e.g. Smart context photo) for the longitudinal PDF.
 */
export async function buildContextSectionPdf(
  sectionTitle: string,
  body: string,
  images: ContextAppendImage[] = []
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const raw = body.slice(0, MAX_BODY_CHARS);
  const safe = raw.replace(/[^\n\r\x20-\x7E]/g, '?');
  const maxW = PAGE_W - 2 * MARGIN;

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  page.drawText(sectionTitle.slice(0, 200), {
    x: MARGIN,
    y,
    size: 11,
    font: fontBold,
    color: rgb(0.12, 0.12, 0.12),
    maxWidth: maxW,
  });
  y -= 20;

  const paragraphs = safe.split(/\n/);
  for (const para of paragraphs) {
    const chunks = wrapToChunks(para, 92);
    for (const line of chunks.length ? chunks : ['']) {
      if (y < MARGIN + LINE_H) {
        page = doc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
      }
      if (line) {
        page.drawText(line, {
          x: MARGIN,
          y,
          size: FONT_SIZE,
          font,
          color: rgb(0.22, 0.22, 0.22),
          maxWidth: maxW,
        });
      }
      y -= LINE_H;
    }
  }

  for (const img of images) {
    if (!img.data?.length) continue;
    const mt = (img.mimeType || '').toLowerCase();
    let embedded;
    try {
      if (mt.includes('png')) {
        embedded = await doc.embedPng(img.data);
      } else if (mt.includes('jpeg') || mt.includes('jpg')) {
        embedded = await doc.embedJpg(img.data);
      } else {
        continue;
      }
    } catch {
      continue;
    }

    const ipage = doc.addPage([PAGE_W, PAGE_H]);
    let iy = PAGE_H - MARGIN;
    const cap = (img.label || 'Attached image').slice(0, 200);
    ipage.drawText(cap, {
      x: MARGIN,
      y: iy,
      size: 10,
      font: fontBold,
      color: rgb(0.12, 0.12, 0.12),
      maxWidth: maxW,
    });
    iy -= 18;

    const boxW = PAGE_W - 2 * MARGIN;
    const boxH = Math.max(120, iy - MARGIN - 24);
    const scale = Math.min(boxW / embedded.width, boxH / embedded.height, 1);
    const dw = embedded.width * scale;
    const dh = embedded.height * scale;
    ipage.drawImage(embedded, {
      x: MARGIN,
      y: iy - dh,
      width: dw,
      height: dh,
    });
  }

  return doc.save();
}

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

export async function mergePdfBuffers(existing: Buffer, append: Uint8Array): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const a = await PDFDocument.load(existing, { ignoreEncryption: true });
  const b = await PDFDocument.load(append);
  const pagesA = await out.copyPages(a, a.getPageIndices());
  pagesA.forEach((p) => out.addPage(p));
  const pagesB = await out.copyPages(b, b.getPageIndices());
  pagesB.forEach((p) => out.addPage(p));
  return out.save();
}
