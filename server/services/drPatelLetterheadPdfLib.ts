import fs from 'fs';
import path from 'path';
import type { PDFDocument, PDFPage } from 'pdf-lib';

let cachedPng: Uint8Array | null | undefined;

function loadLetterheadPngBytes(): Uint8Array | null {
  if (cachedPng !== undefined) return cachedPng;
  const p = path.join(__dirname, '../assets/dr-mohamed-patel-letterhead.png');
  try {
    cachedPng = new Uint8Array(fs.readFileSync(p));
  } catch {
    cachedPng = null;
  }
  return cachedPng;
}

const PAGE_W = 612;
const MARGIN = 48;

/**
 * Draw Dr Mohamed Patel letterhead image at top of page; returns Y (from bottom) where body text may start.
 */
export async function drawDrPatelLetterheadPdfLib(
  doc: PDFDocument,
  page: PDFPage,
  pageWidth: number
): Promise<number> {
  const bytes = loadLetterheadPngBytes();
  if (!bytes?.length) {
    return page.getHeight() - MARGIN - 24;
  }
  let embedded;
  try {
    embedded = await doc.embedPng(bytes);
  } catch {
    return page.getHeight() - MARGIN - 24;
  }
  const pw = pageWidth - 2 * MARGIN;
  const scale = pw / embedded.width;
  const drawH = embedded.height * scale;
  const topFromBottom = page.getHeight() - MARGIN;
  const imgBottom = topFromBottom - drawH;
  page.drawImage(embedded, {
    x: MARGIN,
    y: imgBottom,
    width: pw,
    height: drawH,
  });
  return imgBottom - 12;
}

export { PAGE_W, MARGIN };
