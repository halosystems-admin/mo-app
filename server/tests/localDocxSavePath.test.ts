/**
 * Regression: production (node dist/server/index.js) must find Mo templates/
 * and render Admission DOCX locally — never Halo generate_note 500.
 */
import assert from 'assert';
import path from 'path';
import { MO_HALO_USER_ID } from '../../shared/clinicalTemplates/constants';
import { resolveClinicalTemplateRoot } from '../../shared/clinicalTemplates/docxFileResolver';
import { getBundledTemplateDefinition } from '../../shared/clinicalTemplates/registry';
import { renderPracticeClinicalDocx } from '../services/practiceDocxFromTemplate';

async function run(): Promise<void> {
  const root = resolveClinicalTemplateRoot();
  assert.ok(
    require('fs').existsSync(path.join(root, 'Mo templates')),
    `Mo templates/ not found under ${root}`
  );

  const admissionDef = getBundledTemplateDefinition(MO_HALO_USER_ID, 'admission');
  assert.ok(admissionDef, 'admission template definition');

  const sampleNote = `- Clinically well, non-systemically unwell
- Area of fluctuance noted of the right buttock next to the natal cleft
- Tender on percussion

## Diagnosis

1. Right buttock abscess (L02.41)`;

  const { buffer, source } = await renderPracticeClinicalDocx({
    haloUserId: MO_HALO_USER_ID,
    templateId: 'admission',
    templateDefinition: admissionDef,
    template_name: 'Admission',
    text: sampleNote,
  });

  assert.strictEqual(source, 'local');
  assert.ok(buffer.length > 5000, 'admission DOCX should be non-trivial size');

  console.log('localDocxSavePath.test.ts: all passed');
}

void run();
