import fs from 'fs';
import path from 'path';
import { MO_CLINICAL_TEMPLATE_DEFINITIONS } from '../../shared/clinicalTemplates/moDefinitions';
import { HENK_HALO_USER_ID, MO_HALO_USER_ID } from '../../shared/clinicalTemplates/constants';
import { resolveClinicalTemplateRelativePath } from '../../shared/clinicalTemplates/docxFileResolver';
import { renderClinicalNoteDocx } from '../services/clinicalNoteDocx';

const repoRoot = path.resolve(__dirname, '../..');

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function run(): void {
  const failures: string[] = [];

  for (const haloUserId of [MO_HALO_USER_ID, HENK_HALO_USER_ID]) {
    for (const def of MO_CLINICAL_TEMPLATE_DEFINITIONS) {
      const relativePath = resolveClinicalTemplateRelativePath(haloUserId, def.template_id);
      const docxPath = relativePath ? path.join(repoRoot, relativePath) : '';
      if (!fs.existsSync(docxPath)) {
        failures.push(`${haloUserId}:${def.template_id}: template file missing at ${relativePath || def.doc_path}`);
        continue;
      }

      const placeholders = Object.fromEntries(def.fields.map((field) => [field.key, `${field.key} value`]));

      try {
        const rendered = renderClinicalNoteDocx(fs.readFileSync(docxPath), placeholders);
        if (!rendered.length) {
          failures.push(`${haloUserId}:${def.template_id}: rendered empty DOCX output`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${haloUserId}:${def.template_id}: ${message}`);
      }
    }
  }

  assert(failures.length === 0, `DOCX render smoke test failed\n${failures.join('\n')}`);
  console.log('docxRenderSmoke.test.ts: all passed');
}

run();
