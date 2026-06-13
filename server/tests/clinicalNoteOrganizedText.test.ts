import assert from 'node:assert/strict';
import {
  fieldValuesToOrganizedMarkdown,
  fieldsToOrganizedText,
  markdownHasDuplicateSectionLabels,
} from '../../shared/clinicalNoteOrganizedText';

const md = fieldValuesToOrganizedMarkdown('inpatient_fu', {
  patient_name: 'Bentele, Thembakazi',
  id: '8507151234087',
  dob: '15-07-1985',
  medical_aid: 'GEMS',
  fu_date: '13-06-2026',
  admission_ward_number: 'ICU, Bed 4',
  presenting_complaint: '56-year-old female post laparoscopic cholecystectomy.',
  vitals: '* **Heart Rate:** 78 bpm\n* **Respiratory Rate:** 12 breaths/min',
});

assert.match(md, /^## Patient Details/m);
assert.match(md, /\*\*Name:\*\*/);
assert.match(md, /Bentele, Thembakazi/);
assert.match(md, /^## Presenting Complaint/m);
assert.doesNotMatch(md, /^## Presenting Complaint\n\n\*\*Presenting Complaint/m);
assert.match(md, /^## Clinical Examination/m);
assert.match(md, /Heart Rate/);

const admissionStyle = fieldsToOrganizedText([
  { label: 'Presenting Complaint', body: 'Chest pain on exertion.' },
  { label: 'Admission Date', body: '30/05/2025' },
  { label: 'Indication', body: 'Acute appendicitis.' },
]);

assert.match(admissionStyle, /^## Presenting Complaint\n\nChest pain/m);
assert.doesNotMatch(admissionStyle, /\*\*Presenting Complaint\*\*/);
assert.match(admissionStyle, /^## Admission Date\n\n30\/05\/2025/m);
assert.doesNotMatch(admissionStyle, /\*\*Admission Date\*\*/);

const duplicateLegacy = '## Presenting Complaint\n\n**Presenting Complaint**\n\nChest pain.';
assert.equal(markdownHasDuplicateSectionLabels(duplicateLegacy), true);

console.log('clinicalNoteOrganizedText.test.ts: ok');
