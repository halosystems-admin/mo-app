import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import {
  DOCX_TEMPLATE_END_DELIMITER,
  DOCX_TEMPLATE_START_DELIMITER,
  repairDocxPlaceholdersXml,
} from '../../shared/docxRepairPlaceholders';
import { stripHtmlForDocx } from '../../shared/populateClinicalNoteTemplate';
import { formatPatientDisplayName } from '../utils/patientDisplay';

export type PatientLetterKind = 'motivation' | 'referral';

export type PatientLetterPlaceholders = Record<string, string>;

export function renderPatientLetterDocx(templateBuffer: Buffer, data: PatientLetterPlaceholders): Buffer {
  const zip = new PizZip(templateBuffer);
  for (const fileName of Object.keys(zip.files)) {
    if (!/^word\/(?:document|header\d+|footer\d+)\.xml$/i.test(fileName)) continue;
    const entry = zip.file(fileName);
    const xml = entry?.asText();
    if (!xml) continue;
    zip.file(fileName, repairDocxPlaceholdersXml(xml));
  }

  const sanitizedPlaceholders = Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, stripHtmlForDocx(String(value ?? ''))])
  ) as PatientLetterPlaceholders;
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: {
      start: DOCX_TEMPLATE_START_DELIMITER,
      end: DOCX_TEMPLATE_END_DELIMITER,
    },
    nullGetter: () => '',
  });
  try {
    doc.render(sanitizedPlaceholders);
  } catch (err: unknown) {
    const e = err as { properties?: { errors?: Array<{ message?: string }> } };
    const details = e?.properties?.errors?.map((x) => x.message).filter(Boolean).join('; ');
    throw new Error(details ? `DOCX template render failed: ${details}` : 'DOCX template render failed.');
  }
  return Buffer.from(doc.getZip().generate({ type: 'nodebuffer' }));
}

export function displayNameFromProfile(fullName: string): string {
  return formatPatientDisplayName(fullName.trim());
}
