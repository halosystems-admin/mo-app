import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import { MO_CLINICAL_TEMPLATE_DEFINITIONS } from '../../shared/clinicalTemplates/moDefinitions';
import { resolveMoClinicalTemplateRelativePath } from '../../shared/clinicalTemplates/docxFileResolver';
import { extractRepairedDocxKeys, repairDocxPlaceholdersXml } from '../../shared/docxRepairPlaceholders';

const repoRoot = path.resolve(__dirname, '../..');

function extractTemplateKeys(docxPath: string): Set<string> {
  const zip = new PizZip(fs.readFileSync(docxPath));
  const keys = new Set<string>();

  for (const fileName of Object.keys(zip.files)) {
    if (!/^word\/(?:document|header\d+|footer\d+)\.xml$/i.test(fileName)) continue;
    const xml = zip.file(fileName)?.asText() || '';
    const repaired = repairDocxPlaceholdersXml(xml);
    for (const key of extractRepairedDocxKeys(repaired)) {
      keys.add(key);
    }
  }

  return keys;
}

function sorted(items: Iterable<string>): string[] {
  return [...items].sort((a, b) => a.localeCompare(b));
}

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function run(): void {
  const failures: string[] = [];

  for (const def of MO_CLINICAL_TEMPLATE_DEFINITIONS) {
    const relativePath = resolveMoClinicalTemplateRelativePath(def.template_id);
    const docxPath = relativePath ? path.join(repoRoot, relativePath) : '';
    if (!fs.existsSync(docxPath)) {
      failures.push(`${def.template_id}: template file missing at ${relativePath || def.doc_path}`);
      continue;
    }

    const found = extractTemplateKeys(docxPath);
    const expected = new Set(def.fields.map((field) => field.key));

    const missing = sorted([...expected].filter((key) => !found.has(key)));
    const extra = sorted([...found].filter((key) => !expected.has(key)));

    if (missing.length || extra.length) {
      failures.push(
        `${def.template_id}: missing=[${missing.join(', ')}] extra=[${extra.join(', ')}]`
      );
    }
  }

  assert(failures.length === 0, `DOCX template audit failed\n${failures.join('\n')}`);
  console.log('docxTemplateAudit.test.ts: all passed');
}

run();
