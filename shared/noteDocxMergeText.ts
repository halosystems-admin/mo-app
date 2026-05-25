import type { ClinicalTemplateDefinition } from './clinicalTemplates/types';
import { mergeFieldMaps, parsePopulatedEditorToFieldMap } from './parsePopulatedEditorToFieldMap';

/**
 * Build effective merge field map for DOCX render from note editor text + stored docxMerge.
 */
export function buildDocxMergeFields(
  editorPlainText: string,
  docxMerge: Record<string, string> | undefined,
  templateDefinition?: ClinicalTemplateDefinition
): Record<string, string> {
  const fromEditor = parsePopulatedEditorToFieldMap(editorPlainText, templateDefinition);
  return mergeFieldMaps(docxMerge, fromEditor);
}

/** Legacy Halo text envelope: optional ---FIELD:key--- blocks from merge map. */
export function buildNoteTextForDocxMerge(
  templateId: string,
  editorPlainText: string,
  docxMerge: Record<string, string> | undefined,
  templateDefinition?: ClinicalTemplateDefinition
): string {
  const fields = buildDocxMergeFields(editorPlainText, docxMerge, templateDefinition);
  const blocks = Object.entries(fields)
    .filter(([, v]) => v.trim())
    .map(([key, value]) => `---FIELD:${key}---\n${value.trim()}`);
  if (blocks.length > 0) {
    return blocks.join('\n\n');
  }
  return editorPlainText.trim();
}
