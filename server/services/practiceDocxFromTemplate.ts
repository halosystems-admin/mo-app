import type { ClinicalTemplateDefinition } from '../../shared/clinicalTemplates/types';
import type { HaloPatientProfile } from '../../shared/types';
import { getBundledTemplateDefinition } from '../../shared/clinicalTemplates/registry';
import { localClinicalTemplateAvailable } from '../../shared/clinicalTemplates/docxFileResolver';
import { buildDocxMergeFields } from '../../shared/noteDocxMergeText';
import { config } from '../config';
import { generateNote, type GenerateNoteParams } from './haloApi';
import {
  buildPlaceholderMap,
  loadClinicalTemplateBuffer,
  renderClinicalNoteDocx,
} from './clinicalNoteDocx';
import { canUseLocalClinicalNotePipeline, extractMoTemplateFieldValues } from './moClinicalNoteGeneration';

export type RenderPracticeDocxParams = {
  haloUserId: string;
  templateId: string;
  templateDefinition?: ClinicalTemplateDefinition;
  template_name?: string;
  /** Editor plain text (for reverse parse). */
  text: string;
  /** Fully composed fallback text for HALO when local render is unavailable. */
  haloText?: string;
  /** LLM/chart field map from client. */
  mergeFields?: Record<string, string>;
  patientProfile?: HaloPatientProfile | null;
};

/** Mo/Henk: render from repo DOCX when bundled schema + template file exist (no Halo Heroku). */
export function shouldTryLocalClinicalDocx(haloUserId: string, templateId: string): boolean {
  if (
    getBundledTemplateDefinition(haloUserId, templateId) &&
    localClinicalTemplateAvailable(haloUserId, templateId, config.clinicalTemplateRoot)
  ) {
    return true;
  }
  if (!config.useLocalClinicalTemplates) return false;
  return (
    canUseLocalClinicalNotePipeline(haloUserId) &&
    localClinicalTemplateAvailable(haloUserId, templateId, config.clinicalTemplateRoot)
  );
}

async function resolveMergeFieldValues(params: RenderPracticeDocxParams): Promise<Record<string, string>> {
  const { text, mergeFields, templateDefinition } = params;

  let values = buildDocxMergeFields(text, mergeFields, templateDefinition);

  const nonEmpty = Object.values(values).filter((v) => v.trim()).length;
  if (nonEmpty > 0) return values;

  if (mergeFields && Object.values(mergeFields).some((v) => v.trim())) {
    return mergeFields;
  }

  const tplLabel =
    params.template_name?.trim() || params.templateDefinition?.name || params.templateId;

  try {
    values = await extractMoTemplateFieldValues({
      composedText: text,
      templateId: params.templateId,
      templateDisplayName: tplLabel,
      templateDefinition: params.templateDefinition,
      patientProfile: params.patientProfile,
    });
  } catch (err) {
    console.warn('[docx-merge] Gemini field extraction failed:', err);
    values = mergeFields ?? {};
  }

  if (Object.values(values).filter((v) => v.trim()).length > 0) return values;

  // Last resort: keep narrative in the primary prose field so DOCX still saves.
  const proseKey =
    templateDefinition?.fields.find((f) => /operation_note|findings|note|management|presenting/i.test(f.key))
      ?.key ?? templateDefinition?.fields[templateDefinition.fields.length - 1]?.key;
  if (proseKey && text.trim()) {
    return { [proseKey]: text.trim() };
  }

  return values;
}

/**
 * Render clinical note DOCX from repo templates (Mo/Henk) with Halo fallback.
 */
export async function renderPracticeClinicalDocx(
  params: RenderPracticeDocxParams
): Promise<{ buffer: Buffer; source: 'local' | 'halo' }> {
  const { haloUserId, templateId, templateDefinition } = params;

  if (shouldTryLocalClinicalDocx(haloUserId, templateId)) {
    try {
      const templateBuf = loadClinicalTemplateBuffer(haloUserId, templateId);
      if (!templateBuf) throw new Error('Clinical template file not found');

      const fieldValues = await resolveMergeFieldValues(params);
      const placeholders = buildPlaceholderMap(fieldValues, templateDefinition);
      const nonEmpty = Object.values(placeholders).filter((v) => v.trim()).length;
      console.log(
        `[docx-merge] user=${haloUserId.slice(0, 8)}… template=${templateId} nonEmpty=${nonEmpty} keys=${Object.keys(placeholders).join(',')}`
      );

      const buffer = renderClinicalNoteDocx(templateBuf, placeholders);
      console.log('[docx] rendered locally:', haloUserId.slice(0, 8), templateId);
      return { buffer, source: 'local' };
    } catch (err) {
      console.warn('[docx] Local render failed, falling back to Halo:', err);
    }
  }

  const haloParams: GenerateNoteParams = {
    user_id: haloUserId,
    template_id: templateId,
    text: params.haloText ?? params.text,
    return_type: 'docx',
    template_name: params.template_name,
    templateDefinition,
  };
  const buffer = (await generateNote(haloParams)) as Buffer;
  return { buffer, source: 'halo' };
}

/** @deprecated Use renderPracticeClinicalDocx */
export async function generateClinicalDocxBuffer(
  haloParams: GenerateNoteParams
): Promise<{ buffer: Buffer; source: 'mo_local' | 'halo' }> {
  const result = await renderPracticeClinicalDocx({
    haloUserId: haloParams.user_id,
    templateId: haloParams.template_id,
    templateDefinition: haloParams.templateDefinition,
    template_name: haloParams.template_name,
    text: haloParams.text,
  });
  return {
    buffer: result.buffer,
    source: result.source === 'local' ? 'mo_local' : 'halo',
  };
}
