import type { ClinicalTemplateDefinition } from './clinicalTemplates/types';
import { parseReportNoteContent } from './parseReportNoteContent';
import { sanitizeReportDocxFields } from './sanitizeReportDocxFields';

function headingForKey(key: string): string {
  return key.replace(/_/g, ' ').toUpperCase();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reverse-parse editor plain text back into field map (label blocks from editor templates).
 */
export function parsePopulatedEditorToFieldMap(
  plainText: string,
  templateDefinition?: ClinicalTemplateDefinition
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!templateDefinition?.fields.length) return out;

  const text = plainText.replace(/\r\n/g, '\n');

  for (const f of templateDefinition.fields) {
    const heading = headingForKey(f.key);
    const re = new RegExp(
      `(?:^|\\n)${escapeRe(heading)}\\s*:\\s*\\n+([\\s\\S]*?)(?=\\n[A-Z][A-Z0-9 /&'-]+:\\s*\\n|$)`,
      'i'
    );
    const m = text.match(re);
    if (m?.[1] != null) {
      out[f.key] = m[1].trim();
      continue;
    }
    // Ward dictation / single-block templates
    if (templateDefinition.fields.length === 1) {
      out[f.key] = text.trim();
    }
  }

  const templateSpecific =
    templateDefinition?.template_id && /report/i.test(templateDefinition.template_id)
      ? parseReportNoteContent(text, templateDefinition)
      : {};

  return sanitizeReportDocxFields({ ...out, ...templateSpecific });
}

/** Merge priority: editor parse overrides docxMerge per key when editor value non-empty. */
export function mergeFieldMaps(
  docxMerge: Record<string, string> | undefined,
  editorParsed: Record<string, string>
): Record<string, string> {
  const base = { ...(docxMerge ?? {}) };
  for (const [k, v] of Object.entries(editorParsed)) {
    if (v.trim()) base[k] = v.trim();
  }
  return base;
}
