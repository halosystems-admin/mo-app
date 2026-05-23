import fs from 'fs';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import type { ClinicalTemplateDefinition } from '../../shared/clinicalTemplates/types';
import {
  resolveMoClinicalTemplateAbsolutePath,
  resolveMoMotivationLetterAbsolutePath,
} from '../../shared/clinicalTemplates/docxFileResolver';
import { config } from '../config';

export function loadMoClinicalTemplateBuffer(templateId: string): Buffer | null {
  const abs = resolveMoClinicalTemplateAbsolutePath(templateId, config.clinicalTemplateRoot);
  if (!abs) return null;
  return fs.readFileSync(abs);
}

export function loadMoMotivationLetterTemplateBuffer(): Buffer | null {
  const abs = resolveMoMotivationLetterAbsolutePath(config.clinicalTemplateRoot);
  if (!abs) return null;
  return fs.readFileSync(abs);
}

/** Map template field keys → string values for docxtemplater. */
export function buildPlaceholderMap(
  fieldValues: Record<string, string>,
  templateDefinition?: ClinicalTemplateDefinition
): Record<string, string> {
  const out: Record<string, string> = {};
  if (templateDefinition) {
    for (const f of templateDefinition.fields) {
      out[f.key] = fieldValues[f.key] ?? '';
    }
  }
  for (const [k, v] of Object.entries(fieldValues)) {
    if (!(k in out)) out[k] = v ?? '';
  }
  return out;
}

export function renderClinicalNoteDocx(templateBuffer: Buffer, placeholders: Record<string, string>): Buffer {
  const zip = new PizZip(templateBuffer);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
  doc.setData(placeholders);
  try {
    doc.render();
  } catch (err: unknown) {
    const e = err as { properties?: { errors?: Array<{ message?: string }> } };
    const details = e?.properties?.errors?.map((x) => x.message).filter(Boolean).join('; ');
    throw new Error(details ? `DOCX template render failed: ${details}` : 'DOCX template render failed.');
  }
  return Buffer.from(doc.getZip().generate({ type: 'nodebuffer' }));
}
