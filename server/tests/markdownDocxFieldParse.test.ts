/**
 * Ensures ## markdown from note generation round-trips into DOCX merge fields
 * (same class of bug that broke Operation Report save).
 */
import assert from 'assert';
import { MO_CLINICAL_TEMPLATE_DEFINITIONS } from '../../shared/clinicalTemplates/moDefinitions';
import { fieldValuesToOrganizedMarkdown } from '../../shared/clinicalNoteOrganizedText';
import { mergeFieldMaps, parsePopulatedEditorToFieldMap } from '../../shared/parsePopulatedEditorToFieldMap';

function run(): void {
  const failures: string[] = [];

  for (const def of MO_CLINICAL_TEMPLATE_DEFINITIONS) {
    const sampleValues = Object.fromEntries(
      def.fields.map((f) => [f.key, `Sample ${f.key.replace(/_/g, ' ')}`])
    );
    const markdown = fieldValuesToOrganizedMarkdown(def.template_id, sampleValues, def);
    if (!markdown.trim()) {
      failures.push(`${def.template_id}: fieldValuesToOrganizedMarkdown produced empty text`);
      continue;
    }

    const parsed = parsePopulatedEditorToFieldMap(markdown, def);
    const parsedCount = Object.values(parsed).filter((v) => v.trim()).length;
    const expectedMin = Math.min(3, def.fields.length);

    if (parsedCount < expectedMin) {
      failures.push(
        `${def.template_id}: only ${parsedCount}/${def.fields.length} fields parsed from markdown (need ≥${expectedMin})`
      );
    }
  }

  const operationDef = MO_CLINICAL_TEMPLATE_DEFINITIONS.find((def) => def.template_id === 'operation');
  assert.ok(operationDef, 'operation template definition must exist');

  const typedOperationReport = `
Patient Surname, Name: van der Westhuizen, Test
Date of Birth: 2002-02-22
Medical Aid: Discovery
ID Number: 0202225009081
Medical Aid Number: 123456789
Contact: 0821234567

Date of Operation: 14/06/2026   Time In: 08:15   Time Out: 09:05
Surgeon: Kruger H
Anaesthetist: Smith J
Surgical Assistant: None   Second Assistant: None   Urgency of Booking: Elective
Operation Title: Laparoscopic appendectomy
Procedure Codes: 1807, 0039
Indication: Acute appendicitis.

Operative Findings:
Inflamed appendix without perforation.

Operation Note:
General anaesthesia. Supine position. Abdomen prepped and draped.
Umbilical port inserted. Appendix identified and removed.
Haemostasis achieved. Skin closed with Monocryl.

Biopsies: Appendix for histology.
Diagnosis: Acute appendicitis
ICD-10 Codes: K35.9
Management: Analgesia, mobilise, discharge when well.
`;

  const parsedOperation = parsePopulatedEditorToFieldMap(typedOperationReport, operationDef);
  const expectedOperation: Record<string, string> = {
    patient_name: 'van der Westhuizen, Test',
    dob: '2002-02-22',
    op_date: '14/06/2026',
    start_time: '08:15',
    end_time: '09:05',
    operation_title: 'Laparoscopic appendectomy',
    operative_findings: 'Inflamed appendix without perforation.',
    diagnosis: 'Acute appendicitis',
    icds: 'K35.9',
  };

  for (const [key, expected] of Object.entries(expectedOperation)) {
    if (parsedOperation[key] !== expected) {
      failures.push(`operation typed report: ${key} expected "${expected}", got "${parsedOperation[key] || ''}"`);
    }
  }

  const timeOutBeforeNarrative = parsePopulatedEditorToFieldMap(
    `Time Out: 09:05
General anaesthesia. Supine position. Abdomen prepped and draped.`,
    operationDef
  );
  if (timeOutBeforeNarrative.end_time !== '09:05') {
    failures.push(
      `operation typed report: Time Out swallowed narrative, got "${timeOutBeforeNarrative.end_time || ''}"`
    );
  }

  const procedureNarrative = parsePopulatedEditorToFieldMap(
    `Procedure: General anaesthesia. Supine position. Abdomen prepped and draped.
Umbilical port inserted. Appendix identified and removed.
Haemostasis achieved. Skin closed with Monocryl.

Diagnosis: Acute appendicitis`,
    operationDef
  );
  if (!procedureNarrative.operation_note?.includes('Umbilical port inserted')) {
    failures.push(
      `operation typed report: Procedure narrative did not map to operation_note, got "${procedureNarrative.operation_note || ''}"`
    );
  }
  if (procedureNarrative.operation_title?.includes('General anaesthesia')) {
    failures.push('operation typed report: Procedure narrative was incorrectly mapped to operation_title');
  }

  const henkGeminiReport = `**Preoperative Diagnosis:** Left ischiorectal abscess
**Postoperative Diagnosis:** Large left ischiorectal abscess with complex fistula-in-ano (internal opening at 5 o'clock)
**Procedure:**

1. Examination under anesthesia (EUA) of the anorectum
2. Rigid sigmoidoscopy
3. Incision and drainage of left ischiorectal abscess
4. Placement of draining seton

Surgeon: HJ Kruger
Anesthetist: Dr H Asslett
Anesthesia: General
Position: Lithotomy
Time in: 12:11
Time out: 12:47

Indications

The patient presented with a painful, swollen, and fluctuant mass in the left perianal region, clinically consistent with a large ischiorectal abscess. Informed consent was obtained for EUA, sigmoidoscopy, incision and drainage, and potential seton placement.

Findings

Sigmoidoscopy: Large abscess cavity in the lower rectum ? previous anastomotic leak.
Perianal Examination: Large, tense, and fluctuant ischiorectal abscess on the left side.
Abscess Cavity: Yielded a large volume of frank, malodorous pus.
Fistula: A fistulous tract was identified communicating from the abscess cavity to an internal opening at the dentate line.

The patient was brought to the operating theatre, correctly identified, and placed under general anesthesia. They were positioned in the lithotomy position. The perineum was prepared and draped in the standard sterile fashion. The WHO surgical safety checklist was completed.

An initial visual inspection and digital rectal examination (DRE) confirmed a large, tender induration over the left ischiorectal fossa. A rigid sigmoidoscope was introduced, and the rectum was insufflated and inspected up to 15 cm. The mucosa was healthy and normal in appearance. The sigmoidoscope was subsequently withdrawn.

Attention was turned to the perianal region. A prominent, fluctuant area was noted at the 5 o'clock position, roughly 2 cm from the anal margin. A cruciate incision was made over the point of maximum fluctuance. A large volume of purulent material was immediately drained. A swab was taken and sent to the laboratory for MC&S.

Postoperative Details

Estimated Blood Loss: Minimal
Specimens Sent: Pus swab for MC&S
Complications: None apparent
Postoperative Plan
Intravenous antibiotics as per ward protocol.
Commence sitz baths starting on postoperative day 1.
Analgesia as prescribed.
Surgical outpatient clinic follow-up to review wound healing and assess the seton.`;

  const parsedHenkGeminiReport = parsePopulatedEditorToFieldMap(henkGeminiReport, operationDef);
  const henkExpectedContains: Record<string, string> = {
    diagnosis: 'Large left ischiorectal abscess',
    operation_title: 'Placement of draining seton',
    surgeon: 'HJ Kruger',
    anaesthetist: 'Dr H Asslett',
    start_time: '12:11',
    end_time: '12:47',
    indication: 'painful, swollen',
    operative_findings: 'fistulous tract',
    operation_note: 'The patient was brought to the operating theatre',
    biopsies: 'Pus swab for MC&S',
    icds: 'K61.3',
    management: 'Surgical outpatient clinic follow-up',
  };
  for (const [key, expected] of Object.entries(henkExpectedContains)) {
    if (!parsedHenkGeminiReport[key]?.includes(expected)) {
      failures.push(
        `henk gemini operation report: ${key} should contain "${expected}", got "${parsedHenkGeminiReport[key] || ''}"`
      );
    }
  }
  if (/^\s*\d+[.)]/m.test(parsedHenkGeminiReport.operation_title || '')) {
    failures.push('henk gemini operation report: operation_title should be compacted, not raw numbered list');
  }

  const merged = mergeFieldMaps(
    { patient_name: '', dob: '', operation_note: 'Existing operation note' },
    { op_date: '14/06/2026' }
  );
  if ('patient_name' in merged || 'dob' in merged) {
    failures.push('mergeFieldMaps: blank stored fields should not override patient/profile fallback values');
  }
  if (merged.operation_note !== 'Existing operation note' || merged.op_date !== '14/06/2026') {
    failures.push('mergeFieldMaps: non-empty stored/editor fields should still be preserved');
  }

  assert.strictEqual(failures.length, 0, failures.join('\n'));
  console.log(
    `markdownDocxFieldParse.test.ts: ok (${MO_CLINICAL_TEMPLATE_DEFINITIONS.length} templates)`
  );
}

run();
