/**
 * Centralized AI prompt templates for all Gemini interactions.
 */

export const MAX_CONTENT_LENGTH = 5000;

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
{"name":"string","dob":"YYYY-MM-DD or empty","sex":"M"|"F"|null,"idNumber":"","folderNumber":"","ward":"","medicalAidName":"","medicalAidPackage":"","medicalAidMemberNumber":"","medicalAidPhone":"","rawNotes":""}
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
Use empty strings for missing string fields. If the image has no patient text, return empty strings and null for sex.`;
}

/** Vision: clinical scan / photo / diagram for note-generation context. */
export function consultContextImagePrompt(fileName: string): string {
  return `You are assisting a specialist doctor preparing clinical documentation. They attached an image for CONTEXT ONLY (filename: ${fileName}). Your output will be pasted into a note-generation panel — it must be complete and concrete.

CRITICAL — you must actually look at the pixels:
- Never refuse or leave the description empty because you are "not a doctor". You describe only what is visible; you do NOT state a definitive diagnosis, but you MUST still document appearance, location, Devices, and text.
- If this is a wound, ulcer, rash, surgical site, erythema, swelling, bruising, or skin break: say so explicitly. Describe approximate size (relative clues if no ruler), colour, edges, depth if visible, exudate, slough, granulation, surrounding skin, dressings, staples, sutures, packing, drains (colour, bag fill), stoma, tubing, and any obvious foreign material. Use neutral clinical wording ("appears", "suggests" acceptable).
- If this is a clinical photo of a body region without an obvious lesion: describe the view, anatomical region if inferable, surface, dressings, and anything notable.
- If this is radiology, CT/MRI/X-ray screenshot, or photo of a monitor: describe modality if known, orientation, key structures, obvious focal findings in lay radiology terms (e.g. "dense opacity", "lucent area", "line visible") without inventing measurements you cannot see.
- If this is handwriting, ward stationery, or paper notes: transcribe all legible text line by line; summarise intent at the end.
- If there are diagrams, flowcharts, ECG strips, or sketches: narrate axes, labels, arrows, and what relationship they depict so someone without the image could document it.

Formatting (strict):
- Use up to these ## headings only when they add clarity: ## Extracted text, ## Visible findings, ## Summary. No ### depth.
- No **bold** or *italics*. Use "- " at line start for lists if needed.

If the image is truly blank, pure noise, or completely unreadable, say exactly one sentence stating that. Otherwise always produce at least one filled section with multiple sentences. Plain text — no JSON.`;
}

/** Second pass when the model returns an empty or useless summary for a clinical image. */
export function consultContextImageRetryPrompt(fileName: string): string {
  return `You MUST describe this clinical image in detail for a doctor's notes. Filename hint: ${fileName}

Write 6–12 sentences minimum, in plain text with optional ## Visible findings and ## Summary headings.
Cover: what type of image this is; anatomical region or view; all visible clinical details (wounds, devices, dressings, skin, fluid, swelling, colour); any readable text or labels; and what should be documented for the chart.

Do not output apologies or disclaimers about being an AI. Do not refuse. If uncertain, still describe what you see tentatively.`;
}

/** Third pass — shortest possible instruction (some models behave better). */
export function consultContextImageLastResortPrompt(fileName: string): string {
  return `Look at the image. Write a detailed clinical description for the medical record (wound, scan, device, or document photo). File: ${fileName}
Use ## Visible findings and ## Summary. Minimum 8 sentences. Describe only what you see.`;
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
