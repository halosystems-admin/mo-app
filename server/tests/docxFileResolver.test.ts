import path from 'path';
import {
  HENK_HALO_USER_ID,
  MO_HALO_USER_ID,
} from '../../shared/clinicalTemplates/constants';
import {
  henkLocalClinicalTemplateAvailable,
  isHenkLocalTemplatesEnabled,
  isMoLocalTemplatesEnabled,
  resolveClinicalTemplateAbsolutePath,
  resolveClinicalTemplateRelativePath,
  resolveHenkClinicalTemplateRelativePath,
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
  assert(!isMoLocalTemplatesEnabled(HENK_HALO_USER_ID), 'Henk should not use Mo-only flag');
  assert(isHenkLocalTemplatesEnabled(HENK_HALO_USER_ID), 'Henk should be enabled');

  assert(
    resolveMoClinicalTemplateRelativePath('admission') === 'Mo templates/Admission template.docx',
    'admission path'
  );
  assert(
    resolveHenkClinicalTemplateRelativePath('admission') === 'Henk templates/Admission template.docx',
    'henk admission path'
  );
  assert(
    resolveHenkClinicalTemplateRelativePath('inpatient_fu') === 'Henk templates/Inpatient fu template.docx',
    'henk inpatient filename override'
  );
  assert(
    resolveHenkClinicalTemplateRelativePath('sick_note') === 'Henk templates/Sick note template.docx',
    'henk sick note filename override'
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
    henkLocalClinicalTemplateAvailable(HENK_HALO_USER_ID, 'outpt_consult', repoRoot),
    'Henk outpt_consult file should exist'
  );

  const abs = resolveMoClinicalTemplateAbsolutePath('script', repoRoot);
  assert(abs != null && abs.endsWith('Script template.docx'), 'script absolute path');
  const henkAbs = resolveClinicalTemplateAbsolutePath(HENK_HALO_USER_ID, 'script', repoRoot);
  assert(henkAbs != null && henkAbs.endsWith('Henk templates/Script template.docx'), 'henk script absolute path');
  const genericAbs = resolveClinicalTemplateAbsolutePath(MO_HALO_USER_ID, 'script', repoRoot);
  assert(genericAbs != null && genericAbs.endsWith('Mo templates/Script template.docx'), 'generic mo script absolute path');

  console.log('docxFileResolver.test.ts: all passed');
}

run();
