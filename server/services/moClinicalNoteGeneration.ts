import type { ClinicalTemplateDefinition } from '../../shared/clinicalTemplates/types';
import { isMoLocalTemplatesEnabled } from '../../shared/clinicalTemplates/docxFileResolver';
import { config } from '../config';
import { generateText, safeJsonParse } from './gemini';
import type { HaloNote, NoteField } from './haloApi';
import {
  buildTemplateFieldSchemaBlock,
  clinicalNoteMarkdownStructurePrompt,
  fallbackOrganisedNoteMarkdown,
} from '../utils/prompts';

export function canUseMoLocalNotePipeline(haloUserId: string): boolean {
  return (
    isMoLocalTemplatesEnabled(haloUserId) &&
    config.useLocalClinicalTemplates &&
    Boolean(config.geminiApiKey?.trim())
  );
}

function fieldExtractionPrompt(
  composedText: string,
  templateId: string,
  templateDisplayName: string,
  templateDefinition?: ClinicalTemplateDefinition
): string {
  const keys =
    templateDefinition?.fields.map((f) => f.key).join(', ') ||
    'patient_name, dob, medical_aid, id, medical_aid_no, contact';
  const schema = templateDefinition ? buildTemplateFieldSchemaBlock(templateDefinition) : '';
  return `You are a medical scribe. Extract structured field values from the clinical text below for template "${templateDisplayName}" (template_id: ${templateId}).

${schema}

Return ONLY valid JSON (no markdown fences) as a single object whose keys are EXACTLY these field keys: ${keys}
Use empty string "" for missing values. Use clinical prose in each value as appropriate.

SOURCE:
---
${composedText.trim()}
---`;
}

export function parseFieldValuesFromGeminiJson(
  text: string,
  templateDefinition?: ClinicalTemplateDefinition
): Record<string, string> {
  const parsed = safeJsonParse<Record<string, unknown>>(text, {});
  const out: Record<string, string> = {};
  const keys = templateDefinition?.fields.map((f) => f.key) ?? Object.keys(parsed);
  for (const key of keys) {
    const v = parsed[key];
    if (v == null) {
      out[key] = '';
    } else if (typeof v === 'string') {
      out[key] = v;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[key] = String(v);
    } else {
      out[key] = JSON.stringify(v);
    }
  }
  return out;
}

export function fieldValuesToNoteFields(
  fieldValues: Record<string, string>,
  templateDefinition?: ClinicalTemplateDefinition
): NoteField[] {
  if (templateDefinition?.fields.length) {
    return templateDefinition.fields
      .map((f) => ({
        label: f.key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        body: fieldValues[f.key] ?? '',
      }))
      .filter((f) => f.body.trim().length > 0);
  }
  return Object.entries(fieldValues)
    .filter(([, v]) => v.trim())
    .map(([label, body]) => ({ label, body }));
}

function fieldsToContent(fields: NoteField[]): string {
  return fields.map((f) => (f.label ? `${f.label}:\n${f.body || ''}` : f.body)).filter(Boolean).join('\n\n');
}

/** Generate clinical note for Mo via Gemini (no Halo generate_note). */
export async function generateMoClinicalNotes(params: {
  composedText: string;
  templateId: string;
  templateDisplayName: string;
  templateDefinition?: ClinicalTemplateDefinition;
}): Promise<HaloNote[]> {
  const { composedText, templateId, templateDisplayName, templateDefinition } = params;
  const now = new Date().toISOString();
  const tplLabel = templateDisplayName.trim() || templateId;

  let content = '';
  let fieldValues: Record<string, string> = {};
  let fields: NoteField[] = [];

  try {
    const md = await generateText(
      clinicalNoteMarkdownStructurePrompt({
        templateDisplayName: tplLabel,
        templateId,
        sourceText: composedText,
        templateDefinition,
      })
    );
    content = md.trim();
  } catch (e) {
    console.warn('[Mo] Gemini markdown note failed:', e);
  }

  try {
    const jsonText = await generateText(
      fieldExtractionPrompt(composedText, templateId, tplLabel, templateDefinition)
    );
    fieldValues = parseFieldValuesFromGeminiJson(jsonText, templateDefinition);
    fields = fieldValuesToNoteFields(fieldValues, templateDefinition);
  } catch (e) {
    console.warn('[Mo] Gemini field extraction failed:', e);
  }

  if (!content.trim() && fields.length > 0) {
    content = fieldsToContent(fields);
  }
  if (!content.trim()) {
    const fb = fallbackOrganisedNoteMarkdown(composedText, tplLabel);
    if (fb) content = fb;
  }

  const raw = { fields: fieldValues, markdown: content, source: 'mo_local_gemini' };

  return [
    {
      noteId: `note-mo-${Date.now()}`,
      title: tplLabel,
      content,
      template_id: templateId,
      lastSavedAt: now,
      dirty: false,
      raw,
      ...(fields.length > 0 ? { fields } : {}),
    },
  ];
}

/** Extract template field map from note text for DOCX merge (Mo local path). */
export async function extractMoTemplateFieldValues(params: {
  composedText: string;
  templateId: string;
  templateDisplayName: string;
  templateDefinition?: ClinicalTemplateDefinition;
}): Promise<Record<string, string>> {
  const jsonText = await generateText(
    fieldExtractionPrompt(
      params.composedText,
      params.templateId,
      params.templateDisplayName,
      params.templateDefinition
    )
  );
  return parseFieldValuesFromGeminiJson(jsonText, params.templateDefinition);
}
