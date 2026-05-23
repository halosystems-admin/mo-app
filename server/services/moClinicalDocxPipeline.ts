import type { ClinicalTemplateDefinition } from '../../shared/clinicalTemplates/types';
import {
  moLocalClinicalTemplateAvailable,
  isMoLocalTemplatesEnabled,
} from '../../shared/clinicalTemplates/docxFileResolver';
import { config } from '../config';
import { generateNote, type GenerateNoteParams } from './haloApi';
import {
  buildPlaceholderMap,
  loadMoClinicalTemplateBuffer,
  renderClinicalNoteDocx,
} from './clinicalNoteDocx';
import { canUseMoLocalNotePipeline, extractMoTemplateFieldValues } from './moClinicalNoteGeneration';

export function shouldTryMoLocalDocx(haloUserId: string, templateId: string): boolean {
  return (
    canUseMoLocalNotePipeline(haloUserId) &&
    moLocalClinicalTemplateAvailable(haloUserId, templateId, config.clinicalTemplateRoot)
  );
}

/**
 * Mo: local .docx via docxtemplater + Gemini field extraction.
 * Others / fallback: Halo return_type docx (unchanged).
 */
export async function generateClinicalDocxBuffer(
  haloParams: GenerateNoteParams
): Promise<{ buffer: Buffer; source: 'mo_local' | 'halo' }> {
  const { user_id, template_id } = haloParams;

  if (shouldTryMoLocalDocx(user_id, template_id)) {
    try {
      const templateBuf = loadMoClinicalTemplateBuffer(template_id);
      if (!templateBuf) throw new Error('Mo template file not found');

      const tplLabel =
        (haloParams.template_name?.trim() || haloParams.templateDefinition?.name || template_id) as string;

      const fieldValues = await extractMoTemplateFieldValues({
        composedText: haloParams.text,
        templateId: template_id,
        templateDisplayName: tplLabel,
        templateDefinition: haloParams.templateDefinition,
      });

      const placeholders = buildPlaceholderMap(fieldValues, haloParams.templateDefinition);
      const buffer = renderClinicalNoteDocx(templateBuf, placeholders);
      console.log('[Mo] DOCX rendered locally:', template_id);
      return { buffer, source: 'mo_local' };
    } catch (err) {
      console.warn('[Mo] Local DOCX failed, falling back to Halo:', err);
    }
  } else if (isMoLocalTemplatesEnabled(user_id)) {
    console.log('[Mo] Local DOCX skipped (template missing or disabled):', template_id);
  }

  const buffer = (await generateNote({ ...haloParams, return_type: 'docx' })) as Buffer;
  return { buffer, source: 'halo' };
}
