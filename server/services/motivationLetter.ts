import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { formatPatientDisplayName } from '../utils/patientDisplay';

export type PatientLetterKind = 'motivation' | 'referral';

export type PatientLetterPlaceholders = {
  patient_name: string;
  dob: string;
  body: string;
  re: string;
  doctor_name: string;
};

export function buildLetterReLine(kind: PatientLetterKind): string {
  return kind === 'referral' ? 'Referral letter' : 'Motivation letter';
}

export function renderPatientLetterDocx(templateBuffer: Buffer, data: PatientLetterPlaceholders): Buffer {
  const zip = new PizZip(templateBuffer);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
  doc.setData(data);
  doc.render();
  return Buffer.from(doc.getZip().generate({ type: 'nodebuffer' }));
}

export function displayNameFromProfile(fullName: string): string {
  return formatPatientDisplayName(fullName.trim());
}
