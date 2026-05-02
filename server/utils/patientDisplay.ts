/**
 * Server-side display names — mirrors client/src/features/clinical/shared/clinicalDisplay.ts
 * for DOCX/OCR preamble without importing client code.
 */
export function formatPatientDisplayName(name: string): string {
  const t = name.trim();
  if (!t) return '';
  if (/,/.test(t)) return t;
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return t;
  const surname = parts[parts.length - 1]!;
  const given = parts.slice(0, -1).join(' ');
  return `${surname}, ${given}`;
}

export function formatInpatientDisplayName(firstName: string, surname: string): string {
  const f = firstName.trim();
  const s = surname.trim();
  if (!f && !s) return '';
  if (!f) return s;
  if (!s) return f;
  return `${s}, ${f}`;
}
