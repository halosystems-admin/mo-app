import type { ClinicalTemplateDefinition } from '../../../shared/clinicalTemplates/types';
import { getBundledTemplateDefinition } from '../../../shared/clinicalTemplates/registry';
import type { HaloNote, NoteField } from '../../../shared/types';
import {
  buildPatientDetailsBlock,
  clinicalNoteMarkdownStructurePrompt,
  fallbackOrganisedNoteMarkdown,
  haloGenerateNoteInputEnvelope,
  buildTemplateFieldSchemaBlock,
} from '../../../shared/clinicalNotePrompts';
import { getPatientHaloProfile } from './api';
import { generateText, isClientGeminiConfigured, safeJsonParse } from './geminiClient';

export type GenerateClinicalNotePreviewParams = {
  template_id: string;
  text: string;
  template_name?: string;
  patientId?: string;
  haloUserId?: string | null;
};

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

function parseFieldValuesFromGeminiJson(
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

function fieldValuesToNoteFields(
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

async function prefixWithPatientProfile(patientId: string | undefined, text: string): Promise<string> {
  if (!patientId) return text;
  try {
    const profile = await getPatientHaloProfile(patientId);
    const block = buildPatientDetailsBlock(profile);
    return block ? `${block}\n\n${text}` : text;
  } catch {
    return text;
  }
}

/** Generate clinical note preview via client Gemini (no Halo Heroku round-trip). */
export async function generateClinicalNotePreview(
  params: GenerateClinicalNotePreviewParams
): Promise<{ notes: HaloNote[] }> {
  if (!isClientGeminiConfigured()) {
    throw new Error('VITE_GEMINI_API_KEY is not set. Add it to .env and restart the Vite dev server.');
  }

  const templateId = params.template_id;
  const tplLabel =
    (typeof params.template_name === 'string' && params.template_name.trim()
      ? params.template_name.trim()
      : null) || templateId;

  const haloUserId = params.haloUserId?.trim() || '';
  const templateDefinition = haloUserId
    ? getBundledTemplateDefinition(haloUserId, templateId)
    : undefined;

  let userText = params.text;
  userText = await prefixWithPatientProfile(params.patientId, userText);

  const composedText = haloGenerateNoteInputEnvelope({
    userPayloadText: userText,
    templateId,
    templateDisplayName: tplLabel,
    templateDefinition,
  });

  const now = new Date().toISOString();
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
    console.warn('[client-gemini] markdown note failed:', e);
  }

  try {
    const jsonText = await generateText(
      fieldExtractionPrompt(composedText, templateId, tplLabel, templateDefinition)
    );
    fieldValues = parseFieldValuesFromGeminiJson(jsonText, templateDefinition);
    fields = fieldValuesToNoteFields(fieldValues, templateDefinition);
  } catch (e) {
    console.warn('[client-gemini] field extraction failed:', e);
  }

  if (!content.trim() && fields.length > 0) {
    content = fieldsToContent(fields);
  }
  if (!content.trim()) {
    const fb = fallbackOrganisedNoteMarkdown(composedText, tplLabel);
    if (fb) content = fb;
  }

  const raw = { fields: fieldValues, markdown: content, source: 'client_gemini' };

  const notes: HaloNote[] = [
    {
      noteId: `note-${Date.now()}`,
      title: tplLabel,
      content,
      template_id: templateId,
      lastSavedAt: now,
      dirty: false,
      raw,
      ...(fields.length > 0 ? { fields } : {}),
    },
  ];

  return { notes };
}
