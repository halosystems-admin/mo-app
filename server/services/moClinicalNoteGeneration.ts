import type { ClinicalTemplateDefinition } from '../../shared/clinicalTemplates/types';
import { getBundledTemplateDefinition } from '../../shared/clinicalTemplates/registry';
import { resolvePracticeHaloUserId } from '../../shared/resolvePracticeHaloUserId';
import { buildClientClinicalNotePrompt } from '../../shared/buildClientClinicalNotePrompt';
import { localClinicalTemplateAvailable } from '../../shared/clinicalTemplates/docxFileResolver';
import { config } from '../config';
import { generateText } from './gemini';
import type { HaloNote, NoteField } from './haloApi';
import {
  fallbackOrganisedNoteMarkdown,
} from '../utils/prompts';
import {
  enrichParsedDataWithChart,
  fieldMapFromGeminiJson,
} from '../../shared/populateClinicalNoteTemplate';
import { fieldValuesToOrganizedMarkdown } from '../../shared/clinicalNoteOrganizedText';
import { mergeFieldMaps, parsePopulatedEditorToFieldMap } from '../../shared/parsePopulatedEditorToFieldMap';
import type { HaloPatientProfile } from '../../shared/types';

export function canUseMoLocalNotePipeline(_haloUserId: string): boolean {
  return (
    config.useLocalClinicalTemplates &&
    Boolean(config.geminiApiKey?.trim())
  );
}

/** Note preview (return_type=note): server Gemini + bundled field schema — no Halo Heroku or DOCX required. */
export function canUseLocalClinicalNotePreview(haloUserId: string, templateId: string): boolean {
  const bundledUserId = resolvePracticeHaloUserId({ haloUserId });
  return (
    Boolean(config.geminiApiKey?.trim()) &&
    Boolean(getBundledTemplateDefinition(bundledUserId, templateId))
  );
}

export function canUseLocalClinicalTemplateUser(haloUserId: string, templateId: string): boolean {
  return (
    canUseMoLocalNotePipeline(haloUserId) &&
    localClinicalTemplateAvailable(haloUserId, templateId, config.clinicalTemplateRoot)
  );
}

export const canUseLocalClinicalNotePipeline = canUseMoLocalNotePipeline;

function fieldExtractionPrompt(
  composedText: string,
  templateId: string,
  templateDisplayName: string,
  templateDefinition?: ClinicalTemplateDefinition
): string {
  return buildClientClinicalNotePrompt({
    templateDisplayName,
    templateId,
    sourceText: composedText,
    templateDefinition,
  });
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

function hasNonEmptyFieldValue(fieldValues: Record<string, string>): boolean {
  return Object.values(fieldValues).some((value) => String(value ?? '').trim().length > 0);
}

/** Generate clinical note for Mo via Gemini (no Halo generate_note). */
export async function generateMoClinicalNotes(params: {
  composedText: string;
  templateId: string;
  templateDisplayName: string;
  templateDefinition?: ClinicalTemplateDefinition;
  patientProfile?: HaloPatientProfile | null;
}): Promise<HaloNote[]> {
  const { composedText, templateId, templateDisplayName, templateDefinition, patientProfile } = params;
  const now = new Date().toISOString();
  const tplLabel = templateDisplayName.trim() || templateId;

  let content = '';
  let fieldValues: Record<string, string> = {};
  let fields: NoteField[] = [];

  try {
    const jsonText = await generateText(
      fieldExtractionPrompt(composedText, templateId, tplLabel, templateDefinition)
    );
    fieldValues = enrichParsedDataWithChart(
      fieldMapFromGeminiJson(jsonText, templateDefinition),
      patientProfile,
      templateDefinition
    );
    fieldValues = mergeFieldMaps(
      fieldValues,
      parsePopulatedEditorToFieldMap(composedText, templateDefinition)
    );
    fields = fieldValuesToNoteFields(fieldValues, templateDefinition);
  } catch (e) {
    console.warn('[Mo] Gemini field extraction failed:', e);
    fieldValues = enrichParsedDataWithChart(
      parsePopulatedEditorToFieldMap(composedText, templateDefinition),
      patientProfile,
      templateDefinition
    );
    fields = fieldValuesToNoteFields(fieldValues, templateDefinition);
  }

  const hasMergeValues = hasNonEmptyFieldValue(fieldValues);

  if (hasMergeValues) {
    content = fieldValuesToOrganizedMarkdown(templateId, fieldValues, templateDefinition);
  } else if (fields.length > 0) {
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
      ...(hasMergeValues ? { docxMerge: fieldValues } : {}),
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
  patientProfile?: HaloPatientProfile | null;
}): Promise<Record<string, string>> {
  const jsonText = await generateText(
    fieldExtractionPrompt(
      params.composedText,
      params.templateId,
      params.templateDisplayName,
      params.templateDefinition
    )
  );
  const geminiFields = fieldMapFromGeminiJson(jsonText, params.templateDefinition);
  const typedReportFields = parsePopulatedEditorToFieldMap(params.composedText, params.templateDefinition);
  return enrichParsedDataWithChart(
    mergeFieldMaps(geminiFields, typedReportFields),
    params.patientProfile,
    params.templateDefinition
  );
}
