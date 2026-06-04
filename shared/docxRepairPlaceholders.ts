/**
 * Repair Word-split docxtemplater placeholders in OOXML (document.xml, headers, footers).
 * Word often splits `{{patient_name}}` across multiple <w:t> runs or proofing markup.
 *
 * This implementation only rewrites <w:t> text content and leaves the surrounding OOXML
 * structure untouched, which keeps docxtemplater's lexer happy.
 */

export const DOCX_TEMPLATE_START_DELIMITER = '[[';
export const DOCX_TEMPLATE_END_DELIMITER = ']]';

const VALID_KEY = /^[a-zA-Z0-9_]+$/;
const WT_NODE_RE = /<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g;

type TextNode = {
  attrs: string;
  text: string;
};

type Replacement = {
  start: number;
  end: number;
  key: string;
};

function findPlaceholderReplacements(text: string): Replacement[] {
  const replacements: Replacement[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const open = text.indexOf('{{', cursor);
    if (open === -1) break;

    const close = text.indexOf('}}', open + 2);
    if (close === -1) break;

    const rawInner = text.slice(open + 2, close);
    const compactInner = rawInner.trim().replace(/\s+/g, '_');

    if (compactInner && compactInner.length <= 120 && VALID_KEY.test(compactInner)) {
      replacements.push({
        start: open,
        end: close + 2,
        key: compactInner,
      });
      cursor = close + 2;
      continue;
    }

    cursor = open + 2;
  }

  return replacements;
}

function renderRepairedTextNodes(nodes: TextNode[]): TextNode[] {
  if (nodes.length === 0) return nodes;

  const combinedText = nodes.map((node) => node.text).join('');
  const replacements = findPlaceholderReplacements(combinedText);
  if (replacements.length === 0) return nodes;

  const nodeStarts: number[] = [];
  let total = 0;
  for (const node of nodes) {
    nodeStarts.push(total);
    total += node.text.length;
  }

  const repaired: TextNode[] = [];
  let replacementIndex = 0;

  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = nodes[nodeIndex]!;
    const nodeStart = nodeStarts[nodeIndex]!;
    const nodeEnd = nodeStart + node.text.length;
    let localPos = 0;
    let output = '';

    while (replacementIndex < replacements.length) {
      const replacement = replacements[replacementIndex]!;

      if (replacement.end <= nodeStart) {
        replacementIndex += 1;
        continue;
      }

      if (replacement.start >= nodeEnd) {
        break;
      }

      if (replacement.start >= nodeStart) {
        const startOffset = replacement.start - nodeStart;
        output += node.text.slice(localPos, startOffset);
        output += `${DOCX_TEMPLATE_START_DELIMITER}${replacement.key}${DOCX_TEMPLATE_END_DELIMITER}`;

        if (replacement.end <= nodeEnd) {
          localPos = replacement.end - nodeStart;
          replacementIndex += 1;
          continue;
        }

        localPos = node.text.length;
        break;
      }

      if (replacement.end >= nodeEnd) {
        localPos = node.text.length;
        break;
      }

      localPos = replacement.end - nodeStart;
      replacementIndex += 1;
    }

    output += node.text.slice(localPos);
    repaired.push({
      attrs: node.attrs,
      text: output,
    });
  }

  return repaired;
}

/** Full repair pass for one OOXML part. */
export function repairDocxPlaceholdersXml(xml: string): string {
  const nodes: TextNode[] = [];
  let match: RegExpExecArray | null;

  while ((match = WT_NODE_RE.exec(xml))) {
    nodes.push({
      attrs: match[1] || '',
      text: match[2] || '',
    });
  }

  if (nodes.length === 0) return xml;

  const repairedNodes = renderRepairedTextNodes(nodes);
  let nodeIndex = 0;

  return xml.replace(WT_NODE_RE, (_full, attrs) => {
    const repaired = repairedNodes[nodeIndex++];
    const finalAttrs = repaired?.attrs ?? attrs ?? '';
    const finalText = repaired?.text ?? '';
    return `<w:t${finalAttrs}>${finalText}</w:t>`;
  });
}

export function extractRepairedDocxKeys(xml: string): string[] {
  const keys: string[] = [];
  const keyRe = new RegExp(
    String.raw`\[\[\s*([a-zA-Z0-9_]+)\s*\]\]`,
    'g'
  );

  for (const match of xml.matchAll(keyRe)) {
    if (match[1]) keys.push(match[1]);
  }

  return keys;
}
