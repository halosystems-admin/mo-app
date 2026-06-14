import type { ClinicalTemplateDefinition } from '../../shared/clinicalTemplates/types';
import type { HaloPatientProfile } from '../../shared/types';
import { getBundledTemplateDefinition } from '../../shared/clinicalTemplates/registry';
import { localClinicalTemplateAvailable } from '../../shared/clinicalTemplates/docxFileResolver';
import { buildDocxMergeFields } from '../../shared/noteDocxMergeText';
import { resolvePracticeHaloUserId } from '../../shared/resolvePracticeHaloUserId';
import { config } from '../config';
import { generateNote, type GenerateNoteParams } from './haloApi';
import {
  buildPlaceholderMap,
  loadClinicalTemplateBuffer,
  renderClinicalNoteDocx,
} from './clinicalNoteDocx';
import { extractMoTemplateFieldValues } from './moClinicalNoteGeneration';

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
  /** Practice identity hints — used to pick Mo vs Henk bundled templates. */
  practiceEmail?: string | null;
  practiceDriveRoot?: string | null;
};

function resolveBundledUserId(params: RenderPracticeDocxParams): string {
  return resolvePracticeHaloUserId({
    haloUserId: params.haloUserId,
    email: params.practiceEmail,
    driveRootFolderName: params.practiceDriveRoot,
    henkLoginEmail: config.henkOutboundEmail,
  });
}

/** Mo/Henk: prefer repo DOCX when bundled schema + template file exist; Halo is fallback. */
export function shouldTryLocalClinicalDocx(haloUserId: string, templateId: string): boolean {
  const bundledUserId = resolvePracticeHaloUserId({ haloUserId });
  return (
    Boolean(getBundledTemplateDefinition(bundledUserId, templateId)) &&
    localClinicalTemplateAvailable(bundledUserId, templateId, config.clinicalTemplateRoot)
  );
}

function isBundledClinicalTemplate(haloUserId: string, templateId: string): boolean {
  const bundledUserId = resolvePracticeHaloUserId({ haloUserId });
  return Boolean(getBundledTemplateDefinition(bundledUserId, templateId));
}

function primaryProseFieldKey(templateDefinition?: ClinicalTemplateDefinition): string | null {
  if (!templateDefinition?.fields.length) return null;
  const preferred = templateDefinition.fields.find((f) =>
    /operation_note|findings|diagnosis|presenting_complaint|indication|management|note/i.test(f.key)
  );
  return preferred?.key ?? templateDefinition.fields[templateDefinition.fields.length - 1]?.key ?? null;
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

  const proseKey = primaryProseFieldKey(templateDefinition);
  if (proseKey && text.trim()) {
    return { [proseKey]: text.trim() };
  }

  return values;
}

function renderLocalDocxBuffer(
  templateBuf: Buffer,
  fieldValues: Record<string, string>,
  templateDefinition?: ClinicalTemplateDefinition
): Buffer {
  const placeholders = buildPlaceholderMap(fieldValues, templateDefinition);
  return renderClinicalNoteDocx(templateBuf, placeholders);
}

async function renderHaloDocxFallback(
  params: RenderPracticeDocxParams,
  templateDefinition?: ClinicalTemplateDefinition
): Promise<Buffer> {
  const haloParams: GenerateNoteParams = {
    user_id: params.haloUserId,
    template_id: params.templateId,
    text: params.haloText ?? params.text,
    return_type: 'docx',
    template_name: params.template_name,
    templateDefinition,
  };
  return (await generateNote(haloParams)) as Buffer;
}

/**
 * Render clinical note DOCX: local repo templates first (Mo/Henk), Halo API as fallback.
 */
export async function renderPracticeClinicalDocx(
  params: RenderPracticeDocxParams
): Promise<{ buffer: Buffer; source: 'local' | 'halo' }> {
  const bundledUserId = resolveBundledUserId(params);
  const templateId = params.templateId;
  const templateDefinition =
    params.templateDefinition ?? getBundledTemplateDefinition(bundledUserId, templateId);
  const isBundled = isBundledClinicalTemplate(bundledUserId, templateId);

  if (isBundled) {
    const templateBuf = loadClinicalTemplateBuffer(bundledUserId, templateId);

    if (templateBuf) {
      const strategies: Array<() => Promise<Record<string, string>>> = [
        () => resolveMergeFieldValues({ ...params, templateDefinition }),
        async () => {
          const proseKey = primaryProseFieldKey(templateDefinition);
          if (!proseKey || !params.text.trim()) return {};
          return { [proseKey]: params.text.trim() };
        },
      ];

      let lastErr: unknown;
      for (const strategy of strategies) {
        try {
          const fieldValues = await strategy();
          const nonEmpty = Object.values(fieldValues).filter((v) => v.trim()).length;
          if (nonEmpty === 0 && params.text.trim()) {
            const proseKey = primaryProseFieldKey(templateDefinition);
            if (proseKey) fieldValues[proseKey] = params.text.trim();
          }
          const buffer = renderLocalDocxBuffer(templateBuf, fieldValues, templateDefinition);
          console.log('[docx] rendered locally:', bundledUserId.slice(0, 8), templateId);
          return { buffer, source: 'local' };
        } catch (err) {
          lastErr = err;
          console.warn('[docx] Local render attempt failed:', err);
        }
      }

      console.warn(
        '[docx] Local render exhausted, falling back to Halo:',
        lastErr instanceof Error ? lastErr.message : lastErr
      );
    } else {
      console.warn(
        '[docx] Template file missing locally, falling back to Halo:',
        templateId,
        'root:',
        config.clinicalTemplateRoot
      );
    }

    try {
      const buffer = await renderHaloDocxFallback(params, templateDefinition);
      console.log('[docx] rendered via Halo fallback:', params.haloUserId.slice(0, 8), templateId);
      return { buffer, source: 'halo' };
    } catch (haloErr) {
      if (!templateBuf) {
        const haloMsg = haloErr instanceof Error ? haloErr.message : 'Halo request failed';
        throw new Error(
          `Clinical template file missing on server (${templateId}). Template root: ${config.clinicalTemplateRoot}. Halo fallback also failed: ${haloMsg}`
        );
      }
      throw haloErr;
    }
  }

  const buffer = await renderHaloDocxFallback(params, templateDefinition);
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
