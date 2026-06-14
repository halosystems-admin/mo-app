/**
 * Every file in Henk templates/ must resolve for Henk's bundled workflow
 * (clinical notes + motivation + referral letters).
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { MO_CLINICAL_TEMPLATE_DEFINITIONS } from '../../shared/clinicalTemplates/moDefinitions';
import { HENK_HALO_USER_ID } from '../../shared/clinicalTemplates/constants';
import {
  HENK_MOTIVATION_TEMPLATE_FILENAME,
  HENK_REFERRAL_TEMPLATE_FILENAME,
  HENK_TEMPLATES_DIR_NAME,
  henkLocalClinicalTemplateAvailable,
  resolveClinicalTemplateRelativePath,
  resolveClinicalTemplateRoot,
  resolveHenkMotivationLetterRelativePath,
  resolveHenkReferralLetterRelativePath,
} from '../../shared/clinicalTemplates/docxFileResolver';
import { resolvePracticeHaloUserId, HENK_LOGIN_EMAIL } from '../../shared/resolvePracticeHaloUserId';
import { renderPracticeClinicalDocx } from '../services/practiceDocxFromTemplate';
import { getBundledTemplateDefinition } from '../../shared/clinicalTemplates/registry';

async function run(): Promise<void> {
  const repoRoot = resolveClinicalTemplateRoot();
  const henkDir = path.join(repoRoot, HENK_TEMPLATES_DIR_NAME);
  assert.ok(fs.existsSync(henkDir), `Missing ${HENK_TEMPLATES_DIR_NAME}/ under ${repoRoot}`);

  const onDisk = fs
    .readdirSync(henkDir)
    .filter((f) => f.endsWith('.docx'))
    .sort();

  // 9 clinical templates (shared schema with Mo) + motivation + referral
  const expectedClinical = MO_CLINICAL_TEMPLATE_DEFINITIONS.map((def) => {
    const rel = resolveClinicalTemplateRelativePath(HENK_HALO_USER_ID, def.template_id);
    assert.ok(rel, `No resolver path for Henk ${def.template_id}`);
    return rel!;
  });

  const expectedLetters = [
    resolveHenkMotivationLetterRelativePath(),
    resolveHenkReferralLetterRelativePath(),
  ];

  const expectedAll = [...expectedClinical, ...expectedLetters].sort();

  for (const rel of expectedAll) {
    const abs = path.join(repoRoot, rel);
    assert.ok(fs.existsSync(abs), `Henk template file missing: ${rel}`);
  }

  // Every .docx on disk should be accounted for (no orphan files)
  const expectedFilenames = expectedAll.map((rel) => path.basename(rel)).sort();
  assert.deepStrictEqual(
    onDisk,
    expectedFilenames,
    'Henk templates/ folder contents must match resolver map exactly'
  );

  for (const def of MO_CLINICAL_TEMPLATE_DEFINITIONS) {
    assert.ok(
      henkLocalClinicalTemplateAvailable(HENK_HALO_USER_ID, def.template_id, repoRoot),
      `Henk clinical template unavailable: ${def.template_id}`
    );
  }

  // Identity routing: Henk Gmail → bundled user id (not Mo)
  assert.strictEqual(
    resolvePracticeHaloUserId({ email: HENK_LOGIN_EMAIL }),
    HENK_HALO_USER_ID,
    'Henk email must route to HENK_HALO_USER_ID'
  );

  const admissionDef = getBundledTemplateDefinition(HENK_HALO_USER_ID, 'admission');
  const { buffer, source } = await renderPracticeClinicalDocx({
    haloUserId: HENK_HALO_USER_ID,
    templateId: 'admission',
    templateDefinition: admissionDef,
    template_name: 'Admission',
    text: '## Diagnosis\n\nTest admission note for Henk routing.',
    practiceEmail: HENK_LOGIN_EMAIL,
  });
  assert.strictEqual(source, 'local');
  assert.ok(buffer.length > 5000);

  console.log(`henkTemplateRouting.test.ts: ok (${onDisk.length} templates, local admission render)`);
}

void run();
