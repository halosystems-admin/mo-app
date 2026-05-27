import fs from 'fs';
import path from 'path';
import { HENK_HALO_USER_ID, MO_HALO_USER_ID } from './constants';
import { getBundledTemplateDefinition } from './registry';

export const MO_TEMPLATES_DIR_NAME = 'Mo templates';
export const HENK_TEMPLATES_DIR_NAME = 'Henk templates';
export const MO_MOTIVATION_TEMPLATE_FILENAME = 'Mo_motivation_template.docx';
export const HENK_MOTIVATION_TEMPLATE_FILENAME = 'Henk_motivational_letter.docx';

const MO_FILENAME_OVERRIDES: Record<string, string> = {};
const HENK_FILENAME_OVERRIDES: Record<string, string> = {
  inpatient_fu: 'Inpatient fu template.docx',
  sick_note: 'Sick note template.docx',
  ward_dictation: 'Ward dictation template.docx',
};

export function isMoLocalTemplatesEnabled(haloUserId: string): boolean {
  return haloUserId === MO_HALO_USER_ID;
}

export function isHenkLocalTemplatesEnabled(haloUserId: string): boolean {
  return haloUserId === HENK_HALO_USER_ID;
}

export function resolveTemplateFilename(haloUserId: string, templateId: string): string | null {
  const def = getBundledTemplateDefinition(haloUserId, templateId);
  if (!def) return null;
  const override =
    haloUserId === HENK_HALO_USER_ID
      ? HENK_FILENAME_OVERRIDES[templateId]
      : haloUserId === MO_HALO_USER_ID
        ? MO_FILENAME_OVERRIDES[templateId]
        : undefined;
  if (override) return override;
  return `${def.name} template.docx`;
}

export function resolveMoTemplateFilename(templateId: string): string | null {
  return resolveTemplateFilename(MO_HALO_USER_ID, templateId);
}

export function resolveHenkTemplateFilename(templateId: string): string | null {
  return resolveTemplateFilename(HENK_HALO_USER_ID, templateId);
}

export function resolveClinicalTemplateRelativePath(haloUserId: string, templateId: string): string | null {
  const filename = resolveTemplateFilename(haloUserId, templateId);
  if (!filename) return null;
  const dir =
    haloUserId === HENK_HALO_USER_ID
      ? HENK_TEMPLATES_DIR_NAME
      : haloUserId === MO_HALO_USER_ID
        ? MO_TEMPLATES_DIR_NAME
        : null;
  if (!dir) return null;
  return path.join(dir, filename);
}

export function resolveMoClinicalTemplateRelativePath(templateId: string): string | null {
  return resolveClinicalTemplateRelativePath(MO_HALO_USER_ID, templateId);
}

export function resolveHenkClinicalTemplateRelativePath(templateId: string): string | null {
  return resolveClinicalTemplateRelativePath(HENK_HALO_USER_ID, templateId);
}

export function resolveMoMotivationLetterRelativePath(): string {
  return path.join(MO_TEMPLATES_DIR_NAME, MO_MOTIVATION_TEMPLATE_FILENAME);
}

export function resolveHenkMotivationLetterRelativePath(): string {
  return path.join(HENK_TEMPLATES_DIR_NAME, HENK_MOTIVATION_TEMPLATE_FILENAME);
}

export function resolveMoClinicalTemplateAbsolutePath(
  templateId: string,
  repoRoot: string
): string | null {
  const rel = resolveMoClinicalTemplateRelativePath(templateId);
  if (!rel) return null;
  const abs = path.join(repoRoot, rel);
  return fs.existsSync(abs) ? abs : null;
}

export function resolveHenkClinicalTemplateAbsolutePath(
  templateId: string,
  repoRoot: string
): string | null {
  const rel = resolveHenkClinicalTemplateRelativePath(templateId);
  if (!rel) return null;
  const abs = path.join(repoRoot, rel);
  return fs.existsSync(abs) ? abs : null;
}

export function resolveClinicalTemplateAbsolutePath(
  haloUserId: string,
  templateId: string,
  repoRoot: string
): string | null {
  const rel = resolveClinicalTemplateRelativePath(haloUserId, templateId);
  if (!rel) return null;
  const abs = path.join(repoRoot, rel);
  return fs.existsSync(abs) ? abs : null;
}

export function resolveMoMotivationLetterAbsolutePath(repoRoot: string): string | null {
  const abs = path.join(repoRoot, resolveMoMotivationLetterRelativePath());
  return fs.existsSync(abs) ? abs : null;
}

export function resolveHenkMotivationLetterAbsolutePath(repoRoot: string): string | null {
  const abs = path.join(repoRoot, resolveHenkMotivationLetterRelativePath());
  return fs.existsSync(abs) ? abs : null;
}

export function moLocalClinicalTemplateAvailable(haloUserId: string, templateId: string, repoRoot: string): boolean {
  if (!isMoLocalTemplatesEnabled(haloUserId)) return false;
  return resolveMoClinicalTemplateAbsolutePath(templateId, repoRoot) != null;
}

export function henkLocalClinicalTemplateAvailable(haloUserId: string, templateId: string, repoRoot: string): boolean {
  if (!isHenkLocalTemplatesEnabled(haloUserId)) return false;
  return resolveHenkClinicalTemplateAbsolutePath(templateId, repoRoot) != null;
}

export function localClinicalTemplateAvailable(
  haloUserId: string,
  templateId: string,
  repoRoot: string
): boolean {
  return (
    moLocalClinicalTemplateAvailable(haloUserId, templateId, repoRoot) ||
    henkLocalClinicalTemplateAvailable(haloUserId, templateId, repoRoot)
  );
}
