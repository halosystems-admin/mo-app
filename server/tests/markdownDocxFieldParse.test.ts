/**
 * Ensures ## markdown from note generation round-trips into DOCX merge fields
 * (same class of bug that broke Operation Report save).
 */
import assert from 'assert';
import { MO_CLINICAL_TEMPLATE_DEFINITIONS } from '../../shared/clinicalTemplates/moDefinitions';
import { fieldValuesToOrganizedMarkdown } from '../../shared/clinicalNoteOrganizedText';
import { parsePopulatedEditorToFieldMap } from '../../shared/parsePopulatedEditorToFieldMap';

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

  assert.strictEqual(failures.length, 0, failures.join('\n'));
  console.log(
    `markdownDocxFieldParse.test.ts: ok (${MO_CLINICAL_TEMPLATE_DEFINITIONS.length} templates)`
  );
}

run();
