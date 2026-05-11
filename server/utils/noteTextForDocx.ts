/**
 * Light cleanup of scribe / model text before Halo `generate_note` → DOCX → PDF.
 * Duplicate paragraph blocks and runaway newlines often map into the same Word
 * region and render as overlapping lines in PDF export.
 */
const MIN_LEN_FOR_CONTAINMENT_DEDUP = 100;

export function prepareTextForHaloDocx(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return normalized;

  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const deduped: string[] = [];

  for (const para of paragraphs) {
    const inner = para.replace(/\n{3,}/g, '\n\n').trim();
    if (!inner) continue;

    const last = deduped[deduped.length - 1];
    if (last !== undefined) {
      if (inner === last) continue;
      if (inner.length >= MIN_LEN_FOR_CONTAINMENT_DEDUP && last.includes(inner)) continue;
      if (last.length >= MIN_LEN_FOR_CONTAINMENT_DEDUP && inner.includes(last)) {
        deduped[deduped.length - 1] = inner;
        continue;
      }
    }
    deduped.push(inner);
  }

  return deduped.join('\n\n');
}
