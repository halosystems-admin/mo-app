import type { ClinicalTemplateDefinition } from './clinicalTemplates/types';

/** JSON-only Gemini prompt: extract template fields from transcript/context. */
export function buildClientClinicalNotePrompt(params: {
  templateDisplayName: string;
  templateId: string;
  sourceText: string;
  templateDefinition?: ClinicalTemplateDefinition;
}): string {
  const { templateDisplayName, templateId, sourceText, templateDefinition } = params;
  const fieldList =
    templateDefinition?.fields.map((f) => ({
      key: f.key,
      description: f.description.trim(),
    })) ?? [];

  const keysCsv = fieldList.map((f) => f.key).join(', ') || 'patient_name';
  const schemaLines = fieldList.map(
    (f, i) => `${i + 1}. "${f.key}": ${f.description}`
  );

  return `You are a medical scribe. Extract structured field values for template "${templateDisplayName}" (template_id: ${templateId}).

FIELDS (use these keys exactly):
${schemaLines.length ? schemaLines.join('\n') : keysCsv}

STRICT RULES:
- Respond ONLY with a single JSON object. No markdown fences, no explanation.
- Keys must match this list exactly: ${keysCsv}
- Include every key exactly once in the JSON object.
- All values must be strings.
- If a field was not dictated, use "".
- Do NOT invent "N/A", "Not discussed", or placeholder prose.
- Do not mix sections from other template types.
- Use clinical prose appropriate to each field description.

SOURCE:
---
${sourceText.trim()}
---`;
}
