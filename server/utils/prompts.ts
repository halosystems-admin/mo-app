/**
 * Centralized AI prompt templates for all Gemini interactions.
 */

import type { HaloPatientProfile } from '../../shared/types';
import { formatPatientDisplayName } from './patientDisplay';

export const MAX_CONTENT_LENGTH = 5000;

/** Prepended to Halo generate_note text so templates echo demographics / billing identifiers. */
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

export function summaryPrompt(patientName: string, fileContext: string): string {
  return `
    Patient: ${patientName}
    Patient Records:
    ${fileContext}

    Based on ALL the patient data above (including any file contents provided), generate a concise, clinical 3-bullet point medical summary covering the most important clinical findings, diagnoses, and current status.
    If file contents are provided, use the actual clinical data — not just file names.
    Return ONLY a raw JSON array of strings.
  `;
}

export function labAlertsPrompt(content: string): string {
  const truncated = content.substring(0, MAX_CONTENT_LENGTH);
  return `Analyze this text. Identify "Abnormal" values. Return JSON array of objects with: parameter, value, severity, context. Content: ${truncated}`;
}

export function imageAnalysisPrompt(): string {
  return `Analyze this medical image. Generate a filename (snake_case) ending in .jpg. Return ONLY the filename.`;
}

export function searchPrompt(query: string, context: string): string {
  return `
    You are a medical assistant search engine. Search by patient name, date of birth, file names, AND file contents.
    Match patients whose data relates to the query conceptually (e.g. "mobility" matches patients with notes about mobility, fractures, physiotherapy, walking difficulty, etc.).
    User Query: "${query}"
    Patient Database (includes file names and content snippets):
    ${context}
    Return ONLY a raw JSON array of matching Patient IDs. If no match, return [].
  `;
}

export function chatSystemPrompt(fullContext: string, conversationHistory: string, question: string): string {
  return `You are HALO, an experienced medical assistant integrated into a patient management system. Answer questions using ONLY the patient data provided below. Be concise, clinical, and professional. If the data doesn't contain the answer, say so honestly. Never make up medical information.

Patient Data Context:
${fullContext}

${conversationHistory ? `Previous conversation:\n${conversationHistory}\n` : ''}
User question: ${question}`;
}

/**
 * Wraps user dictation/context before sending to Halo generate_note so the upstream model
 * returns Markdown sections instead of one continuous paragraph.
 */
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
  /** Raw dictation + optional context (same text sent toward Halo). */
  sourceText: string;
}): string {
  const src = params.sourceText.trim();
  return `You are a medical scribe.

The text below is raw clinical dictation (and may include an "Additional clinical context" block). 
Produce ONE clinical note suitable for the "${params.templateDisplayName}" documentation style (template_id: ${params.templateId}).

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
}): string {
  const label = params.templateDisplayName?.trim() || params.templateId;
  const raw = params.userPayloadText?.trim() ?? '';
  return [
    '=== SCRIBE_INSTRUCTIONS (metadata — do not echo; produce only the clinical note below) ===',
    'You are a medical scribe. You receive a raw, unstructured voice transcript (and optional extra context).',
    `You MUST structure the final clinical note strictly according to the "${label}" template (template_id: ${params.templateId}).`,
    'Use explicit Markdown headings: ## for each major section required by this template; ### for subsections if needed.',
    'Do NOT output a single continuous paragraph. Separate sections with blank lines.',
    'Populate sections only from the transcript/context; where nothing applies, write "N/A" or "Not discussed".',
    'If both history of presenting complaint and presenting complaint appear, merge the full clinical story (onset, course, context) under Presenting Complaint; do not isolate history in a section that may not map to the final document.',
    'Output ONLY the finished clinical note in Markdown after processing. Do not repeat these instructions.',
    '=== END SCRIBE_INSTRUCTIONS ===',
    '',
    raw,
  ].join('\n');
}

export function soapNotePrompt(transcript: string, customTemplate?: string): string {
  if (customTemplate) {
    return `
    You are a medical scribe. Convert this clinical dictation into a clinical note using the EXACT template/format provided below.
    Follow the template's structure, headings, and sections precisely. Use Markdown formatting (## for headings, **bold** for labels).
    Fill in each section of the template with the relevant information from the dictation. If a section has no relevant data, write "N/A" or "Not discussed".

    TEMPLATE TO FOLLOW:
    ${customTemplate}

    Dictation transcript:
    "${transcript}"
    `;
  }
  return `
    You are a medical scribe. Convert this clinical dictation into a properly formatted SOAP note using Markdown.
    
    Dictation transcript:
    "${transcript}"
    
    Format with ## headers for Subjective, Objective, Assessment, Plan.
  `;
}

export function geminiTranscriptionPrompt(customTemplate?: string): string {
  if (customTemplate) {
    return `You are a medical scribe. Transcribe this audio into a clinical note using the EXACT template/format below. Follow the template's structure, headings, and sections precisely. Use Markdown formatting (## for headings, **bold** for labels). Fill in each section with the relevant information. If a section has no data, write "N/A".

TEMPLATE TO FOLLOW:
${customTemplate}`;
  }
  return 'You are a medical scribe. Transcribe this audio into a SOAP note with ## headers for Subjective, Objective, Assessment, Plan.';
}

export function patientStickerExtractionPrompt(): string {
  return `You extract patient and billing identifiers from a photo of a hospital wristband, ward sticker, ID label, admissions armband, or handwritten clinical note.
Read all visible text. Return ONLY valid JSON (no markdown) with this exact shape:
{"name":"string","dob":"YYYY-MM-DD or empty","sex":"M"|"F"|null,"email":"","idNumber":"","folderNumber":"","ward":"","medicalAidName":"","medicalAidPackage":"","medicalAidMemberNumber":"","medicalAidPhone":"","rawNotes":""}
Rules:
- name: patient full name; if several names, use the primary patient name.
- dob: use YYYY-MM-DD when possible; otherwise best-effort or empty string.
- sex: M, F, or null if not visible.
- idNumber: national ID, hospital MR#, account number, or similar if visible.
- folderNumber: folder / file / episode number if visible.
- ward: ward name or number if visible.
- medicalAidName: medical scheme / insurer / medical aid name (e.g. Discovery, Bonitas) if visible.
- medicalAidPackage: plan, option, network, or package name if visible.
- medicalAidMemberNumber: member, beneficiary, or dependent number if visible.
- medicalAidPhone: scheme or authorisation phone if visible.
- rawNotes: other legible text not captured above (short).
- email: only if an email address is clearly visible on the image; otherwise empty string (often absent on ward stickers).
Use empty strings for missing string fields. If the image has no patient text, return empty strings and null for sex.`;
}

/** When no text could be extracted from a non-image upload (e.g. binary, scan PDF). */
export function consultContextBinaryFallbackPrompt(fileName: string, mimeType: string): string {
  return `A doctor uploaded a file for clinical documentation context.

File name: "${fileName}"
Reported type: ${mimeType || 'unknown'}

No text could be extracted automatically. Write 4–8 short bullet lines (plain text, each starting with "- ") suggesting:
- What clinical information this type of file might hold
- What the doctor should document or verify manually
- Any obvious documentation pitfalls (illegible scans, wrong patient, etc.)

Do not invent patient-specific facts. No JSON.`;
}

function smartContextInstructionBody(): string {
  return `You are a clinical context extraction assistant.

Inspect the uploaded file carefully. It may be a wound photo, stoma image, drain image, scan, handwritten note, printed note, form, diagram, or other clinical image.

Your job is to produce clinically useful context for note generation.

Please:
- extract any visible text as accurately as possible
- describe what is visibly present in concise clinical language
- explain diagrams, labels, and annotations where present
- summarise the important findings into practical note context
- avoid inventing details that are not clearly visible
- clearly state uncertainty where details are unclear

For wound, stoma, or drain images, comment where possible on:
- site/location
- general appearance
- edges/margins
- visible surface/base
- discharge/exudate if visible
- surrounding skin
- tubes, bags, dressings, drains, devices if present
- visible signs that may suggest infection, leakage, inflammation, necrosis, breakdown, or bleeding

For notes/forms/documents:
- prioritise text extraction
- preserve important structure where possible
- summarise clinically relevant content

For diagrams/scans:
- describe what is shown
- explain labels/annotations
- summarise relevant findings where visible

Return practical, concise output suitable for insertion into a clinical context panel.

Do not return generic administrative advice or checklist-style cautions.
Do not say what the file "may contain" if you can directly inspect it. Describe what is visible in this actual file.`;
}

export function smartContextGeminiPrompt(fileName: string): string {
  return `${smartContextInstructionBody()}

File name: ${fileName}

Return plain text using these headings when helpful:
## Summary
## Extracted text
## Findings

If no visible text is present, say so clearly.`;
}

export function smartContextGeminiJsonPrompt(fileName: string): string {
  return `${smartContextInstructionBody()}

File name: ${fileName}

Return JSON only with this flexible shape:
{
  "summary": "concise clinical summary",
  "context": "practical note-generation context",
  "clinical_summary": "optional clinical interpretation if visible",
  "description": "optional visual description",
  "extracted_text": "visible text if present",
  "findings": ["short finding", "short finding"]
}

Use empty strings or an empty array when a field is not available.`;
}

/** Text extracted from PDF/DOCX etc. → consult context for notes. */
export function consultContextDocumentPrompt(fileName: string, extractedText: string): string {
  const t = extractedText.substring(0, 12000);
  return `You are assisting a doctor. Below is text extracted from a file they attached for note context: "${fileName}".

Write plain context for note generation. Use at most a few ## headings if helpful. Do NOT use **bold**, *italics*, or asterisk bullets; use line breaks and simple "- " lines if needed.

Cover: key facts (values, dates, plans); figures or tables if described; note any obvious gaps.

Extracted text:
${t}`;
}

export function fileDescriptionPrompt(fileName: string, extractedText: string): string {
  const truncated = extractedText.substring(0, MAX_CONTENT_LENGTH);
  return `
You are HALO, a clinical assistant helping a doctor understand a newly uploaded document.

File name: ${fileName}

Extracted text (may be partial):
${truncated}

In 2–4 short bullet points, describe clearly what this file contains and why it might be clinically relevant (history, investigations, imaging, lab results, correspondence, etc.).
Avoid speculation and do not invent diagnoses that are not supported by the text.
Return ONLY a raw Markdown string (no JSON).
`;
}

/** Draft inpatient discharge summary from structured ward/admission context (not full chart). */
export function dischargeSummaryPrompt(patientName: string, clinicalContext: string): string {
  const ctx = clinicalContext.length > 12000 ? clinicalContext.slice(0, 12000) + '\n…[truncated]' : clinicalContext;
  return `You are a clinician drafting a hospital discharge summary for handover to primary care.

Patient: ${patientName}

Clinical data from admission / ward record (may be incomplete):
${ctx}

Write a clear, professional discharge summary suitable for the patient file and GP. Use Markdown with these sections:
## Admission diagnosis / reason for admission
## Inpatient course and key investigations or procedures
## Condition at discharge
## Medications on discharge (if mentioned in the data; otherwise say "To be completed from chart")
## Follow-up and outstanding actions

Use only information present in the clinical data. If something is not documented, write "Not documented in supplied data" for that point. Be concise; use short bullets where appropriate.`;
}
