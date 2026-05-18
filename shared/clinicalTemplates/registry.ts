import type { ClinicalTemplateDefinition, ClinicalTemplateMap } from './types';
import { docPathForHaloUser, HENK_HALO_USER_ID, MO_HALO_USER_ID } from './constants';
import { MO_CLINICAL_TEMPLATE_DEFINITIONS } from './moDefinitions';

function cloneForUser(def: ClinicalTemplateDefinition, haloUserId: string): ClinicalTemplateDefinition {
  return {
    ...def,
    doc_path: docPathForHaloUser(haloUserId, def.template_id),
    fields: def.fields.map((f) => ({ ...f })),
  };
}

function buildMap(defs: ClinicalTemplateDefinition[]): ClinicalTemplateMap {
  return Object.fromEntries(defs.map((d) => [d.template_id, d]));
}

const MO_MAP = buildMap(MO_CLINICAL_TEMPLATE_DEFINITIONS);

function henkMap(): ClinicalTemplateMap {
  return buildMap(MO_CLINICAL_TEMPLATE_DEFINITIONS.map((d) => cloneForUser(d, HENK_HALO_USER_ID)));
}

const HENK_MAP = henkMap();

/** Resolve bundled templates for a Halo user id (Mo and Henk share field schemas). */
export function getBundledTemplateMap(haloUserId: string): ClinicalTemplateMap | null {
  if (haloUserId === MO_HALO_USER_ID) return MO_MAP;
  if (haloUserId === HENK_HALO_USER_ID) return HENK_MAP;
  return null;
}

export function getBundledTemplateDefinition(
  haloUserId: string,
  templateId: string
): ClinicalTemplateDefinition | undefined {
  return getBundledTemplateMap(haloUserId)?.[templateId];
}

export function listBundledTemplateOptions(haloUserId: string): Array<{ id: string; name: string }> {
  const map = getBundledTemplateMap(haloUserId);
  if (!map) return [];
  return Object.values(map)
    .map((d) => ({ id: d.template_id, name: d.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Firebase-shaped payload for POST /api/halo/templates (object keyed by template_id). */
export function bundledTemplatesForApi(haloUserId: string): Record<string, ClinicalTemplateDefinition> | null {
  const map = getBundledTemplateMap(haloUserId);
  if (!map || Object.keys(map).length === 0) return null;
  return { ...map };
}
