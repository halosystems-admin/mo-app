import path from 'path';
import {
  HENK_HALO_USER_ID,
  MO_HALO_USER_ID,
} from '../../shared/clinicalTemplates/constants';
import {
  isMoLocalTemplatesEnabled,
  resolveMoClinicalTemplateRelativePath,
  resolveMoMotivationLetterRelativePath,
  resolveMoClinicalTemplateAbsolutePath,
  moLocalClinicalTemplateAvailable,
} from '../../shared/clinicalTemplates/docxFileResolver';

const repoRoot = path.resolve(__dirname, '../..');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function run(): void {
  assert(isMoLocalTemplatesEnabled(MO_HALO_USER_ID), 'Mo should be enabled');
  assert(!isMoLocalTemplatesEnabled(HENK_HALO_USER_ID), 'Henk should not use Mo local');

  assert(
    resolveMoClinicalTemplateRelativePath('admission') === 'Mo templates/Admission template.docx',
    'admission path'
  );
  assert(
    resolveMoClinicalTemplateRelativePath('ward_dictation') === 'Mo templates/Ward Dictation template.docx',
    'ward_dictation path'
  );
  assert(
    resolveMoMotivationLetterRelativePath() === 'Mo templates/Mo_motivation_template.docx',
    'motivation path'
  );

  assert(
    moLocalClinicalTemplateAvailable(MO_HALO_USER_ID, 'outpt_consult', repoRoot),
    'outpt_consult file should exist'
  );
  assert(
    !moLocalClinicalTemplateAvailable(HENK_HALO_USER_ID, 'outpt_consult', repoRoot),
    'Henk should not resolve local'
  );

  const abs = resolveMoClinicalTemplateAbsolutePath('script', repoRoot);
  assert(abs != null && abs.endsWith('Script template.docx'), 'script absolute path');

  console.log('docxFileResolver.test.ts: all passed');
}

run();
