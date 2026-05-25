import type { ClinicalTemplateDefinition } from './clinicalNoteTemplateTypes';

function cleanInlineValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Template-specific parser guard for report-style notes where short identifiers
 * can accidentally absorb full narrative prose after the colon.
 */
export function parseReportNoteContent(
  plainText: string,
  templateDefinition?: ClinicalTemplateDefinition
): Record<string, string> {
  if (!templateDefinition) return {};

  const text = plainText.replace(/\r\n/g, '\n');
  const out: Record<string, string> = {};

  for (const field of templateDefinition.fields) {
    if (!/(file|folder|number|no|patient_name|dob|id)/i.test(field.key)) continue;
    const heading = field.key.replace(/_/g, ' ').toUpperCase();
    const re = new RegExp(`${heading}\\s*:\\s*([^\\n]+)`, 'i');
    const match = text.match(re);
    if (!match?.[1]) continue;

    let value = cleanInlineValue(match[1]);
    if (field.key === 'file_no' || field.key === 'folder_number') {
      value = value.split(/[.]\s+[A-Z]/)[0]?.trim() || value;
    }
    out[field.key] = value;
  }

  return out;
}
