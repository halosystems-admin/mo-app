import type { ClinicalTemplateDefinition } from './clinicalTemplates/types';
import { templateSectionSpecsFor } from './clinicalNoteOrganizedText';
import { parseReportNoteContent } from './parseReportNoteContent';
import { sanitizeReportDocxFields } from './sanitizeReportDocxFields';

function headingForKey(key: string): string {
  return key.replace(/_/g, ' ').toUpperCase();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function defaultLabelForKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeHeadingLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[:*#]/g, '')
    .replace(/\s+/g, ' ');
}

function headingMatchesField(heading: string, fieldKey: string, fieldLabel: string): boolean {
  const h = normalizeHeadingLabel(heading);
  const keyLabel = normalizeHeadingLabel(fieldLabel || defaultLabelForKey(fieldKey));
  const keySlug = normalizeHeadingLabel(fieldKey.replace(/_/g, ' '));
  return h === keyLabel || h === keySlug;
}

/** Parse **Label:** blocks (e.g. inpatient_fu Patient Details). */
function parseBoldLabelBlocks(
  text: string,
  templateDefinition: ClinicalTemplateDefinition,
  out: Record<string, string>
): void {
  const re = /\*\*([^*]+):\*\*\s*\n+([\s\S]*?)(?=\n\*\*[^*]+:\*\*|\n##\s+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const label = (m[1] ?? '').trim();
    const body = (m[2] ?? '').trim();
    if (!label || !body) continue;
    for (const f of templateDefinition.fields) {
      if (headingMatchesField(label, f.key, defaultLabelForKey(f.key))) {
        out[f.key] = body;
        break;
      }
    }
  }
}

/** Parse ## section markdown from the unified note editor back into template field keys. */
function parseMarkdownEditorToFieldMap(
  plainText: string,
  templateDefinition: ClinicalTemplateDefinition
): Record<string, string> {
  const out: Record<string, string> = {};
  const text = plainText.replace(/\r\n/g, '\n');
  if (!/^#{1,3}\s/m.test(text)) return out;

  parseBoldLabelBlocks(text, templateDefinition, out);

  const sectionSpecs = templateSectionSpecsFor(templateDefinition.template_id);
  const chunks = text.split(/^##\s+/m).slice(1);
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    const sectionTitle = (lines[0] ?? '').trim();
    const body = lines.slice(1).join('\n').trim();
    if (!sectionTitle) continue;

    if (body) {
      parseBoldLabelBlocks(body, templateDefinition, out);
    }

    let matchedField = false;
    for (const f of templateDefinition.fields) {
      const label = defaultLabelForKey(f.key);
      if (headingMatchesField(sectionTitle, f.key, label)) {
        const proseBody = body.replace(/^\*\*[^*]+:\*\*\s*\n+/m, '').trim();
        if (proseBody) out[f.key] = proseBody;
        matchedField = true;
        break;
      }
    }

    if (!matchedField && body && sectionSpecs) {
      const spec = sectionSpecs.find((s) => headingMatchesField(sectionTitle, '', s.title));
      if (spec?.mode === 'prose' && spec.keys.length > 0) {
        const proseBody = body.replace(/^\*\*[^*]+:\*\*\s*\n+/m, '').trim();
        if (proseBody) out[spec.keys[0]!] = proseBody;
      }
    }
  }

  return out;
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
  const fromMarkdown = parseMarkdownEditorToFieldMap(text, templateDefinition);

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
    templateDefinition?.template_id &&
    (/report/i.test(templateDefinition.template_id) || templateDefinition.template_id === 'operation')
      ? parseReportNoteContent(text, templateDefinition)
      : {};

  return sanitizeReportDocxFields({ ...fromMarkdown, ...out, ...templateSpecific });
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
