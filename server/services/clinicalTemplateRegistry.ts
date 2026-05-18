import type { ClinicalTemplateDefinition } from '../../shared/clinicalTemplates/types';
import {
  bundledTemplatesForApi,
  getBundledTemplateDefinition,
  listBundledTemplateOptions,
} from '../../shared/clinicalTemplates/registry';
import { getTemplates } from './haloApi';

export function getLocalTemplateOptions(haloUserId: string): Array<{ id: string; name: string }> {
  const bundled = listBundledTemplateOptions(haloUserId);
  return bundled.length > 0 ? bundled : [];
}

export function getLocalTemplateDefinition(
  haloUserId: string,
  templateId: string
): ClinicalTemplateDefinition | undefined {
  return getBundledTemplateDefinition(haloUserId, templateId);
}

/** Bundled definitions for API; falls back to Firebase get_templates when no bundle for user. */
export async function resolveTemplatesForUser(
  haloUserId: string
): Promise<Record<string, unknown>> {
  const bundled = bundledTemplatesForApi(haloUserId);
  if (bundled) return bundled as Record<string, unknown>;
  return getTemplates(haloUserId);
}
