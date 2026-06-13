import type { ClinicalTemplateDefinition } from '../../../shared/clinicalTemplates/types';
import { getBundledTemplateDefinition } from '../../../shared/clinicalTemplates/registry';
import type { HaloNote, NoteField } from '../../../shared/types';
import { buildClientClinicalNotePrompt } from '../../../shared/buildClientClinicalNotePrompt';
import {
  fallbackOrganisedNoteMarkdown,
} from '../../../shared/clinicalNotePrompts';
import {
  enrichParsedDataWithChart,
  fieldMapFromGeminiJson,
} from '../../../shared/populateClinicalNoteTemplate';
import { fieldValuesToOrganizedMarkdown } from '../../../shared/clinicalNoteOrganizedText';
import { getPatientHaloProfile } from './api';
import { generateText, isClientGeminiConfigured } from './geminiClient';
import type { HaloPatientProfile } from '../../../shared/types';
import { resolvePracticeHaloUserId } from '../../../shared/resolvePracticeHaloUserId';

export type GenerateClinicalNotePreviewParams = {
  template_id: string;
  text: string;
  template_name?: string;
  patientId?: string;
  haloUserId?: string | null;
  patientProfile?: HaloPatientProfile | null;
};

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

async function loadPatientProfile(patientId: string | undefined) {
  if (!patientId) return null;
  try {
    return await getPatientHaloProfile(patientId);
  } catch {
    return null;
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

  const haloUserId = resolvePracticeHaloUserId({ haloUserId: params.haloUserId });
  const templateDefinition = getBundledTemplateDefinition(haloUserId, templateId);

  const profile =
    params.patientProfile !== undefined
      ? params.patientProfile
      : await loadPatientProfile(params.patientId);
  // Local JSON extraction should use dictated/source text only.
  // Patient chart values are overlaid after parsing when fields are empty.
  const composedText = params.text.trim();

  const now = new Date().toISOString();
  let content = '';
  let fieldValues: Record<string, string> = {};
  let fields: NoteField[] = [];

  try {
    const jsonText = await generateText(
      buildClientClinicalNotePrompt({
        templateDisplayName: tplLabel,
        templateId,
        sourceText: composedText,
        templateDefinition,
      })
    );
    fieldValues = enrichParsedDataWithChart(
      fieldMapFromGeminiJson(jsonText, templateDefinition),
      profile,
      templateDefinition
    );
    fields = fieldValuesToNoteFields(fieldValues, templateDefinition);
  } catch (e) {
    console.warn('[client-gemini] field extraction failed:', e);
  }

  if (Object.keys(fieldValues).length > 0) {
    content = fieldValuesToOrganizedMarkdown(templateId, fieldValues, templateDefinition);
  } else if (fields.length > 0) {
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
      ...(Object.keys(fieldValues).length > 0 ? { docxMerge: fieldValues } : {}),
      ...(fields.length > 0 ? { fields } : {}),
    },
  ];

  return { notes };
}
