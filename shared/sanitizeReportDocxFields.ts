function stripMarkdown(value: string): string {
  return value
    .replace(/\*\*/g, '')
    .replace(/^\s*#+\s*/gm, '')
    .trim();
}

function normalizeLines(value: string): string {
  return stripMarkdown(value)
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

function compactNumberedProcedureList(value: string): string {
  const lines = normalizeLines(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) return normalizeLines(value);

  const items = lines.map((line) => line.replace(/^\d+[.)]\s*/, '').trim()).filter(Boolean);
  return items.join('; ');
}

function formatLineList(value: string): string {
  return normalizeLines(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\d+[.)]\s*/, '').replace(/^[-•]\s*/, '').trim())
    .filter(Boolean)
    .join('\n');
}

export function sanitizeReportDocxFields(fields: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => {
      let clean = normalizeLines(String(value ?? ''));
      if (key === 'operation_title') {
        clean = compactNumberedProcedureList(clean);
      } else if (
        key === 'operative_findings' ||
        key === 'operation_note' ||
        key === 'management' ||
        key === 'biopsies'
      ) {
        clean = formatLineList(clean);
      }
      return [key, clean];
    })
  );
}
