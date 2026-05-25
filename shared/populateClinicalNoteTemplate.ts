import type { ClinicalTemplateDefinition } from './clinicalTemplates/types';
import type { HaloPatientProfile } from './types';
import { formatPatientDisplayName } from './clinicalNotePrompts';
import { getClinicalNoteEditorTemplate, buildEditorTemplateFromDefinition } from './clinicalNoteEditorTemplates';

/** Strip markdown code fences and parse Gemini JSON object. */
export function parseGeminiJsonResponse(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleaned) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Gemini response is not a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

export function sanitizeFieldString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    return value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** Parse Gemini JSON into string map keyed by template fields. */
export function fieldMapFromGeminiJson(
  text: string,
  templateDefinition?: ClinicalTemplateDefinition
): Record<string, string> {
  const parsed = parseGeminiJsonResponse(text);
  const keys = templateDefinition?.fields.map((f) => f.key) ?? Object.keys(parsed);
  const out: Record<string, string> = {};
  for (const key of keys) {
    out[key] = sanitizeFieldString(parsed[key]);
  }
  return out;
}

function todayDdMmYyyy(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function todayDdMmYyyyDash(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

const PROFILE_KEY_FILLERS: Array<{
  keys: string[];
  fill: (p: HaloPatientProfile) => string;
}> = [
  {
    keys: ['patient_name'],
    fill: (p) => formatPatientDisplayName(p.fullName?.trim() || ''),
  },
  { keys: ['dob'], fill: (p) => p.dob?.trim() || '' },
  { keys: ['id'], fill: (p) => p.idNumber?.trim() || '' },
  { keys: ['medical_aid'], fill: (p) => p.medicalAidName?.trim() || '' },
  { keys: ['medical_aid_no'], fill: (p) => p.medicalAidMemberNumber?.trim() || '' },
  { keys: ['contact'], fill: (p) => p.medicalAidPhone?.trim() || '' },
  {
    keys: ['current_date', 'consultation_date', 'date_of_exam', 'fu_date', 'admission_date', 'op_date', 'date_endoscopy'],
    fill: () => todayDdMmYyyy(),
  },
];

/** Overlay chart demographics only when LLM left a field empty. */
export function enrichParsedDataWithChart(
  data: Record<string, string>,
  profile: HaloPatientProfile | null | undefined,
  templateDefinition?: ClinicalTemplateDefinition
): Record<string, string> {
  const out = { ...data };
  if (!profile) return out;

  const allowed = new Set(templateDefinition?.fields.map((f) => f.key) ?? Object.keys(out));

  for (const { keys, fill } of PROFILE_KEY_FILLERS) {
    for (const key of keys) {
      if (!allowed.has(key)) continue;
      if (out[key]?.trim()) continue;
      const v = fill(profile);
      if (v) out[key] = v;
    }
  }

  for (const f of templateDefinition?.fields ?? []) {
    if (!f.from_profile || !allowed.has(f.key)) continue;
    if (out[f.key]?.trim()) continue;
    if (f.default?.trim()) {
      out[f.key] = f.default.trim();
      continue;
    }
    if (f.key.includes('date')) {
      out[f.key] = f.key === 'dob' ? profile.dob?.trim() || '' : todayDdMmYyyyDash();
    }
  }

  return out;
}

/** Replace `{{key}}` and `{{ key }}` in editor layout string. */
export function populateEditorTemplate(
  templateString: string,
  data: Record<string, string>
): string {
  let out = templateString;
  for (const [key, value] of Object.entries(data)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g'),
      new RegExp(`\\{\\{${escaped}\\}\\}`, 'g'),
    ];
    for (const re of patterns) {
      out = out.replace(re, value ?? '');
    }
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

export function populateClinicalNoteEditor(
  templateId: string,
  data: Record<string, string>,
  templateDefinition?: ClinicalTemplateDefinition
): string {
  const layout =
    getClinicalNoteEditorTemplate(templateId) ??
    (templateDefinition ? buildEditorTemplateFromDefinition(templateDefinition) : '');
  if (!layout) {
    return Object.entries(data)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => `${k.replace(/_/g, ' ')}\n\n${v}`)
      .join('\n\n');
  }
  return populateEditorTemplate(layout, data);
}

/** Strip simple HTML for DOCX merge values. */
export function stripHtmlForDocx(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();
}
