import type { ClinicalTemplateDefinition } from './clinicalTemplates/types';
import { MO_CLINICAL_TEMPLATE_DEFINITIONS } from './clinicalTemplates/moDefinitions';

function fieldHeading(key: string): string {
  return key.replace(/_/g, ' ').toUpperCase();
}

/** Build plain-text editor layout with {{key}} placeholders for one template. */
export function buildEditorTemplateFromDefinition(def: ClinicalTemplateDefinition): string {
  if (def.fields.length === 1 && def.fields[0]!.key === 'dictation') {
    return `{{${def.fields[0]!.key}}}`;
  }
  const blocks: string[] = [];
  for (const f of def.fields) {
    blocks.push(fieldHeading(f.key));
    blocks.push('');
    blocks.push(`{{${f.key}}}`);
    blocks.push('');
  }
  return blocks.join('\n').trim();
}

const EDITOR_TEMPLATES: Record<string, string> = Object.fromEntries(
  MO_CLINICAL_TEMPLATE_DEFINITIONS.map((d) => [d.template_id, buildEditorTemplateFromDefinition(d)])
);

export function getClinicalNoteEditorTemplate(templateId: string): string | null {
  return EDITOR_TEMPLATES[templateId] ?? null;
}
