import type { ClinicalTemplateDefinition } from './clinicalTemplates/types';
import type { HaloPatientProfile } from './types';
import { formatPatientDisplayName } from './clinicalNotePrompts';
import { getClinicalNoteEditorTemplate, buildEditorTemplateFromDefinition } from './clinicalNoteEditorTemplates';

/** Strip markdown code fences and parse Gemini JSON object. Falls back to extracting the first {...} block. */
export function parseGeminiJsonResponse(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();

  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(s) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through
    }
    return null;
  };

  const direct = tryParse(cleaned);
  if (direct) return direct;

  // Gemini occasionally prefixes prose before the JSON object — extract the first {...} block.
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    const extracted = tryParse(match[0]);
    if (extracted) return extracted;
  }

  throw new Error(
    `Gemini returned non-JSON (${cleaned.length} chars): ${cleaned.slice(0, 200)}`
  );
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

/** ASR often mis-hears titles as first names, e.g. "Van der Westhuizen, Mrs." */
function looksLikeMisextractedPatientName(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (/^[^,]+,\s*(Mrs|Mr|Ms|Miss|Dr)\.?$/i.test(v)) return true;
  if (/^(Mrs|Mr|Ms|Miss|Dr)\.?\s+\S+$/i.test(v) && !v.includes(',')) return true;
  return false;
}

function surnameToken(name: string): string {
  const t = name.trim();
  if (!t) return '';
  if (t.includes(',')) return t.split(',')[0]!.trim().toLowerCase();
  const parts = t.split(/\s+/).filter(Boolean);
  return (parts[parts.length - 1] ?? '').toLowerCase();
}

function shouldPreferChartPatientName(extracted: string, chartFormatted: string): boolean {
  if (!chartFormatted.trim()) return false;
  if (!extracted.trim() || looksLikeMisextractedPatientName(extracted)) return true;
  const chartSurname = surnameToken(chartFormatted);
  const extractedSurname = surnameToken(extracted);
  if (chartSurname && extractedSurname && chartSurname !== extractedSurname) {
    if (Math.abs(chartSurname.length - extractedSurname.length) <= 2) {
      let diffs = 0;
      const maxLen = Math.max(chartSurname.length, extractedSurname.length);
      for (let i = 0; i < maxLen; i++) {
        if (chartSurname[i] !== extractedSurname[i]) diffs++;
      }
      if (diffs <= 2) return false;
    }
    return true;
  }
  return false;
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

  const chartPatientName = formatPatientDisplayName(profile.fullName?.trim() || '');
  if (allowed.has('patient_name') && shouldPreferChartPatientName(out.patient_name ?? '', chartPatientName)) {
    out.patient_name = chartPatientName;
  }

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
