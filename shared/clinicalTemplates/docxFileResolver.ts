import fs from 'fs';
import path from 'path';
import { MO_HALO_USER_ID } from './constants';
import { getBundledTemplateDefinition } from './registry';

export const MO_TEMPLATES_DIR_NAME = 'Mo templates';
export const MO_MOTIVATION_TEMPLATE_FILENAME = 'Mo_motivation_template.docx';

/** Phase 1: local .docx only for Mo Halo user id. */
export function isMoLocalTemplatesEnabled(haloUserId: string): boolean {
  return haloUserId === MO_HALO_USER_ID;
}

export function resolveMoTemplateFilename(templateId: string): string | null {
  const def = getBundledTemplateDefinition(MO_HALO_USER_ID, templateId);
  if (!def) return null;
  return `${def.name} template.docx`;
}

export function resolveMoClinicalTemplateRelativePath(templateId: string): string | null {
  const filename = resolveMoTemplateFilename(templateId);
  if (!filename) return null;
  return path.join(MO_TEMPLATES_DIR_NAME, filename);
}

export function resolveMoMotivationLetterRelativePath(): string {
  return path.join(MO_TEMPLATES_DIR_NAME, MO_MOTIVATION_TEMPLATE_FILENAME);
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

export function resolveMoMotivationLetterAbsolutePath(repoRoot: string): string | null {
  const abs = path.join(repoRoot, resolveMoMotivationLetterRelativePath());
  return fs.existsSync(abs) ? abs : null;
}

/** Mo user + bundled template + file on disk. */
export function moLocalClinicalTemplateAvailable(haloUserId: string, templateId: string, repoRoot: string): boolean {
  if (!isMoLocalTemplatesEnabled(haloUserId)) return false;
  return resolveMoClinicalTemplateAbsolutePath(templateId, repoRoot) != null;
}

export function localClinicalTemplateAvailable(
  haloUserId: string,
  templateId: string,
  repoRoot: string
): boolean {
  return moLocalClinicalTemplateAvailable(haloUserId, templateId, repoRoot);
}
