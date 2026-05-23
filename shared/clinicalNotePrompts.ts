/**
 * Clinical note prompts shared between server and client (Gemini / Halo envelope).
 */

import type { ClinicalTemplateDefinition } from './clinicalTemplates/types';
import type { HaloPatientProfile } from './types';

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

/** Field schema block for Halo/Gemini note generation (from bundled template JSON). */
export function buildTemplateFieldSchemaBlock(def: ClinicalTemplateDefinition): string {
  const lines = def.fields.map((f, i) => {
    const parts = [`${i + 1}. key="${f.key}"`];
    if (f.default?.trim()) parts.push(`default="${f.default.trim()}"`);
    if (f.from_profile) parts.push('(use patient profile / today if not in transcript)');
    parts.push(`— ${f.description.trim()}`);
    return parts.join(' ');
  });
  return [
    `TEMPLATE FIELD SCHEMA (${def.name}, template_id: ${def.template_id}):`,
    'Populate each field from the transcript/context. Use Markdown ## headings that match these sections where appropriate.',
    'Do not use Python list syntax; use bullets or prose as specified per field.',
    ...lines,
  ].join('\n');
}

/** Prepended to note generation text so templates echo demographics / billing identifiers. */
export function buildPatientDetailsBlock(profile: HaloPatientProfile | null): string {
  if (!profile) return '';
  const nameLine = formatPatientDisplayName(profile.fullName?.trim() || '');
  const aidParts = [
    profile.medicalAidName?.trim(),
    profile.medicalAidPackage?.trim(),
    profile.medicalAidMemberNumber?.trim(),
    profile.medicalAidPhone?.trim(),
  ].filter(Boolean);
  const medicalAid = aidParts.length ? aidParts.join(' · ') : '';

  const lines: string[] = ['=== PATIENT_DETAILS ==='];
  if (nameLine) lines.push(`Name: ${nameLine}`);
  const dob = profile.dob?.trim();
  const sex = profile.sex;
  if (dob || sex) {
    const dobSex = [dob ? `DOB: ${dob}` : '', sex ? `Sex: ${sex}` : ''].filter(Boolean).join('  ');
    if (dobSex) lines.push(dobSex);
  }
  const folder = profile.folderNumber?.trim();
  const idNum = profile.idNumber?.trim();
  if (folder || idNum) {
    lines.push([folder ? `Folder #: ${folder}` : '', idNum ? `ID #: ${idNum}` : ''].filter(Boolean).join('    '));
  }
  const ward = profile.ward?.trim();
  if (ward) lines.push(`Ward: ${ward}`);
  if (medicalAid) lines.push(`Medical aid: ${medicalAid}`);
  const raw = profile.rawNotes?.trim();
  if (raw) lines.push(`Sticker notes: ${raw}`);
  const em = profile.email?.trim();
  if (em) lines.push(`Patient email: ${em}`);
  lines.push('=== END_PATIENT_DETAILS ===');
  return lines.join('\n');
}

/** Last resort: organise dictation into Markdown when Halo/Gemini yield no usable body. */
export function fallbackOrganisedNoteMarkdown(sourceText: string, sectionTitle: string): string {
  const t = sourceText.trim();
  if (!t) return '';
  const paras = t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paras.length >= 2) {
    return [`## ${sectionTitle}`, ...paras].join('\n\n');
  }
  const body = paras[0] ?? t;
  return `## ${sectionTitle}\n\n${body}`;
}

/** When Halo returns an unstructured blob, Gemini reformats into template-shaped Markdown (## headings). */
export function clinicalNoteMarkdownStructurePrompt(params: {
  templateDisplayName: string;
  templateId: string;
  sourceText: string;
  templateDefinition?: ClinicalTemplateDefinition;
}): string {
  const src = params.sourceText.trim();
  const schemaBlock = params.templateDefinition
    ? `\n${buildTemplateFieldSchemaBlock(params.templateDefinition)}\n`
    : '';
  return `You are a medical scribe.

The text below is raw clinical dictation (and may include an "Additional clinical context" block). 
Produce ONE clinical note suitable for the "${params.templateDisplayName}" documentation style (template_id: ${params.templateId}).
${schemaBlock}
STRICT RULES:
- Use Markdown. Start major sections with ## headings and subsections with ### where appropriate for this note type.
- Organize facts under the correct headings. Do NOT output a single continuous paragraph.
- Do not repeat filler phrases from poor speech-to-text verbatim when you can condense clinically.
- If information for a section is missing, write "N/A" or "Not discussed".
- If the dictation or context includes "History of Presenting Complaint" (or HPC) and "Presenting Complaint" (or PC), merge ALL history-of-presenting content into the Presenting Complaint section. Do not leave a separate HPC-only section that might be dropped from downstream documents.
- Output ONLY the clinical note. No preamble or explanation.

SOURCE:
---
${src}
---
`;
}

export function haloGenerateNoteInputEnvelope(params: {
  userPayloadText: string;
  templateId: string;
  templateDisplayName?: string;
  templateDefinition?: ClinicalTemplateDefinition;
}): string {
  const label = params.templateDisplayName?.trim() || params.templateId;
  const raw = params.userPayloadText?.trim() ?? '';
  const schemaLines = params.templateDefinition
    ? ['', buildTemplateFieldSchemaBlock(params.templateDefinition), '']
    : [];
  return [
    '=== SCRIBE_INSTRUCTIONS (metadata — do not echo; produce only the clinical note below) ===',
    'You are a medical scribe. You receive a raw, unstructured voice transcript (and optional extra context).',
    `You MUST structure the final clinical note strictly according to the "${label}" template (template_id: ${params.templateId}).`,
    'Use explicit Markdown headings: ## for each major section required by this template; ### for subsections if needed.',
    'Do NOT output a single continuous paragraph. Separate sections with blank lines.',
    'Populate sections only from the transcript/context; where nothing applies, write "N/A" or "Not discussed".',
    'If both history of presenting complaint and presenting complaint appear, merge the full clinical story (onset, course, context) under Presenting Complaint; do not isolate history in a section that may not map to the final document.',
    ...schemaLines,
    'Output ONLY the finished clinical note in Markdown after processing. Do not repeat these instructions.',
    '=== END SCRIBE_INSTRUCTIONS ===',
    '',
    raw,
  ].join('\n');
}
