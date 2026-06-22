import type { ClinicalTemplateDefinition } from './clinicalTemplates/types';
import { templateSectionSpecsFor } from './clinicalNoteOrganizedText';
import { parseReportNoteContent } from './parseReportNoteContent';
import { sanitizeReportDocxFields } from './sanitizeReportDocxFields';

function headingForKey(key: string): string {
  return key.replace(/_/g, ' ').toUpperCase();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function defaultLabelForKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeHeadingLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[:*#]/g, '')
    .replace(/[()]/g, '')
    .replace(/[–—-]/g, ' ')
    .replace(/\s+/g, ' ');
}

function fieldAliases(templateId: string, fieldKey: string): string[] {
  const generic = [fieldKey, fieldKey.replace(/_/g, ' '), defaultLabelForKey(fieldKey)];
  if (templateId !== 'operation') return generic;

  const operationAliases: Record<string, string[]> = {
    patient_name: ['Patient Surname, Name', 'Patient Surname Name', 'Patient Name', 'Name Surname'],
    dob: ['Date of Birth', 'DOB', 'Birth Date'],
    medical_aid: ['Medical Aid', 'Medical Aid Fund', 'Scheme'],
    id: ['ID Number', 'Identity Number', 'Patient ID'],
    medical_aid_no: ['Medical Aid Number', 'Medical Aid No', 'Medical Aid Membership Number', 'Membership Number'],
    contact: ['Contact', 'Contact Number', 'Telephone', 'Cell Number', 'Mobile Number'],
    op_date: ['Date of Operation', 'Operation Date', 'Date of Surgery'],
    start_time: ['Start Time', 'Time Started', 'Time Start', 'Time In', 'Time Into Theatre', 'Cut Time', 'Knife to Skin'],
    end_time: ['End Time', 'Time Ended', 'Time End', 'Time Out', 'Time Out of Theatre', 'Closure Time', 'Finish Time'],
    surgeon: ['Surgeon', 'Operating Surgeon'],
    anaesthetist: ['Anaesthetist', 'Anesthetist'],
    first_assistant: ['Surgical Assistant', 'First Assistant', 'Assistant'],
    second_assistant: ['Second Assistant'],
    urgency_booking: ['Urgency of Booking', 'Booking Urgency', 'Urgency', 'Booking Category'],
    operation_title: ['Operation Title', 'Procedure Name', 'Operation Performed', 'Operation'],
    procedure_codes: ['Procedure Codes', 'RPL Codes', 'Procedure Code'],
    weight_height: ['Weight Height', 'Weight and Height', 'Weight/Height', 'Wt Ht', 'Weight', 'Height'],
    indication: ['Indication', 'Indication for Surgery'],
    operative_findings: ['Operative Findings', 'Intra-operative Findings', 'Intraoperative Findings', 'Findings'],
    operation_note: [
      'Operation Note',
      'Operative Note',
      'Operation Details',
      'Procedure Performed',
      'Procedure Details',
      'Procedure Description',
      'Description of Procedure',
      'Operative Procedure',
      'Surgical Procedure',
      'Surgical Technique',
      'Technique',
    ],
    biopsies: ['Biopsies', 'Samples', 'Specimens', 'Specimens Sent', 'Pathology'],
    diagnosis: ['Diagnosis', 'Post-operative Diagnosis', 'Postoperative Diagnosis', 'Post Op Diagnosis'],
    icds: ['ICDs', 'ICD', 'ICD-10', 'ICD10', 'ICD10 Codes', 'ICD-10 Codes'],
    management: ['Management', 'Post-operative Management', 'Postoperative Management', 'Plan'],
  };

  return [...generic, ...(operationAliases[fieldKey] ?? [])];
}

function headingMatchesField(heading: string, fieldKey: string, fieldLabel: string): boolean {
  const h = normalizeHeadingLabel(heading);
  const keyLabel = normalizeHeadingLabel(fieldLabel || defaultLabelForKey(fieldKey));
  const keySlug = normalizeHeadingLabel(fieldKey.replace(/_/g, ' '));
  return h === keyLabel || h === keySlug;
}

/** Parse **Label:** blocks (e.g. inpatient_fu Patient Details). */
function parseBoldLabelBlocks(
  text: string,
  templateDefinition: ClinicalTemplateDefinition,
  out: Record<string, string>
): void {
  const re = /\*\*([^*]+):\*\*\s*\n+([\s\S]*?)(?=\n\*\*[^*]+:\*\*|\n##\s+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const label = (m[1] ?? '').trim();
    const body = (m[2] ?? '').trim();
    if (!label || !body) continue;
    for (const f of templateDefinition.fields) {
      const aliases = fieldAliases(templateDefinition.template_id, f.key);
      if (aliases.some((alias) => headingMatchesField(label, f.key, alias))) {
        out[f.key] = body;
        break;
      }
    }
  }
}

/** Parse ## section markdown from the unified note editor back into template field keys. */
function parseMarkdownEditorToFieldMap(
  plainText: string,
  templateDefinition: ClinicalTemplateDefinition
): Record<string, string> {
  const out: Record<string, string> = {};
  const text = plainText.replace(/\r\n/g, '\n');
  if (!/^#{1,3}\s/m.test(text)) return out;

  parseBoldLabelBlocks(text, templateDefinition, out);

  const sectionSpecs = templateSectionSpecsFor(templateDefinition.template_id);
  const chunks = text.split(/^##\s+/m).slice(1);
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    const sectionTitle = (lines[0] ?? '').trim();
    const body = lines.slice(1).join('\n').trim();
    if (!sectionTitle) continue;

    if (body) {
      parseBoldLabelBlocks(body, templateDefinition, out);
    }

    let matchedField = false;
    for (const f of templateDefinition.fields) {
      const aliases = fieldAliases(templateDefinition.template_id, f.key);
      if (aliases.some((alias) => headingMatchesField(sectionTitle, f.key, alias))) {
        const proseBody = body.replace(/^\*\*[^*]+:\*\*\s*\n+/m, '').trim();
        if (proseBody) out[f.key] = proseBody;
        matchedField = true;
        break;
      }
    }

    if (!matchedField && body && sectionSpecs) {
      const spec = sectionSpecs.find((s) => headingMatchesField(sectionTitle, '', s.title));
      if (spec?.mode === 'prose' && spec.keys.length > 0) {
        const proseBody = body.replace(/^\*\*[^*]+:\*\*\s*\n+/m, '').trim();
        if (proseBody) out[spec.keys[0]!] = proseBody;
      }
    }
  }

  return out;
}

function flexibleLabelPattern(label: string): string {
  return label
    .trim()
    .split(/\s+/)
    .map((part) => escapeRe(part))
    .join('\\s+')
    .replace(/\\,/g, '\\s*,?\\s*')
    .replace(/\\-/g, '[-–—\\s]*');
}

function parseTypedLabelValueBlocks(
  plainText: string,
  templateDefinition: ClinicalTemplateDefinition
): Record<string, string> {
  const out: Record<string, string> = {};
  const text = plainText
    .replace(/\r\n/g, '\n')
    .replace(/\t+/g, '   ')
    .replace(/[|]+/g, '   ');

  const matches: Array<{ key: string; index: number; valueStart: number; label: string }> = [];
  for (const field of templateDefinition.fields) {
    const aliases = fieldAliases(templateDefinition.template_id, field.key);
    for (const alias of aliases) {
      if (!alias.trim()) continue;
      const re = new RegExp(
        `(^|[\\n\\s])(?:#{1,3}\\s*)?(?:\\*\\*)?${flexibleLabelPattern(alias)}(?:\\*\\*)?\\s*:`,
        'gi'
      );
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        const labelStart = match.index + (match[1]?.length ?? 0);
        matches.push({
          key: field.key,
          index: labelStart,
          valueStart: match.index + match[0].length,
          label: alias,
        });
      }
    }
  }

  matches.sort((a, b) => a.index - b.index || b.label.length - a.label.length);
  const deduped = matches.filter((match, index, arr) => {
    const prev = arr[index - 1];
    if (prev && match.index < prev.valueStart) return false;
    return !prev || Math.abs(prev.index - match.index) > 2;
  });

  for (let i = 0; i < deduped.length; i++) {
    const current = deduped[i]!;
    const next = deduped[i + 1];
    const raw = text.slice(current.valueStart, next?.index ?? text.length);
    let value = raw
      .replace(/^\s*[-–—]\s*/, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (
      /^(patient_name|dob|medical_aid|id|medical_aid_no|contact|op_date|start_time|end_time|surgeon|anaesthetist|first_assistant|second_assistant|urgency_booking|operation_title|procedure_codes|weight_height|biopsies|diagnosis|icds)$/i.test(
        current.key
      )
    ) {
      value = value.split(/\n/)[0]?.trim() || value;
      value = value.split(/\s{3,}/)[0]?.trim() || value;
    }
    if (value) out[current.key] = value;
  }

  return out;
}

function operationNarrativeFallback(plainText: string, parsed: Record<string, string>): Record<string, string> {
  if (parsed.operation_note?.trim()) return {};

  const text = plainText.replace(/\r\n/g, '\n').trim();
  if (!text || !/operation|procedure|anaesth|incision|port|closure|haemostasis|dissect|suture|monocryl|vicryl/i.test(text)) {
    return {};
  }

  const headingMatch = text.match(
    /(?:^|\n)\s*(?:procedure|procedure performed|procedure details|procedure description|description of procedure|operative procedure|operation note|operative note|surgical technique|technique)\s*:\s*([\s\S]*?)(?=\n\s*(?:biopsies?|samples?|specimens?|diagnosis|icd(?:-?10)?(?: codes)?|management|post-?operative management|plan)\s*:|$)/i
  );
  if (headingMatch?.[1]?.trim()) {
    return { operation_note: headingMatch[1].trim() };
  }

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^[A-Za-z][A-Za-z0-9 /,&'()–—-]{1,45}\s*:\s*/.test(line));

  const narrative = lines.join('\n').trim();
  if (narrative.length < 40) return {};
  return { operation_note: narrative };
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/\*\*/g, '')
    .replace(/^\s*#+\s*/gm, '')
    .trim();
}

function cleanOperationSection(value: string): string {
  return stripInlineMarkdown(value)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstSectionMatch(text: string, labels: string[], stopLabels: string[]): string {
  const labelPattern = labels.map((label) => flexibleLabelPattern(label)).join('|');
  const stopPattern = stopLabels.map((label) => flexibleLabelPattern(label)).join('|');
  const re = new RegExp(
    `(?:^|\\n)\\s*(?:\\*\\*)?(?:${labelPattern})(?:\\*\\*)?\\s*:?\\s*(?:\\n+)?([\\s\\S]*?)(?=\\n\\s*(?:\\*\\*)?(?:${stopPattern})(?:\\*\\*)?\\s*:?\\s*(?:\\n|$)|$)`,
    'i'
  );
  return cleanOperationSection(text.match(re)?.[1] ?? '');
}

function inferOperationIcdsFromDiagnosis(diagnosis: string): string {
  const d = diagnosis.toLowerCase();
  const codes = new Set<string>();

  if (/ischiorectal\s+abscess/.test(d)) codes.add('K61.3');
  if (/perianal\s+abscess|perianal region/.test(d)) codes.add('K61.0');
  if (/perirectal\s+abscess|rectal\s+abscess/.test(d)) codes.add('K61.1');
  if (/fistula[-\s]?in[-\s]?ano|anal\s+fistula|fistulous tract/.test(d)) codes.add('K60.3');
  if (/appendicitis/.test(d)) codes.add('K35.9');
  if (/cholecystitis/.test(d)) codes.add('K81.9');
  if (/diverticulitis/.test(d)) codes.add('K57.9');
  if (/cellulitis/.test(d)) codes.add('L03.9');
  if (/\babscess\b/.test(d) && codes.size === 0) codes.add('L02.9');

  return [...codes].join(', ');
}

function operationGeminiReportFields(plainText: string): Record<string, string> {
  const text = stripInlineMarkdown(plainText.replace(/\r\n/g, '\n'));
  const out: Record<string, string> = {};

  const stopLabels = [
    'Preoperative Diagnosis',
    'Postoperative Diagnosis',
    'Procedure',
    'Surgeon',
    'Anesthetist',
    'Anaesthetist',
    'Anesthesia',
    'Anaesthesia',
    'Position',
    'Time in',
    'Time out',
    'Indications',
    'Indication',
    'Findings',
    'Operative Findings',
    'Operation Note',
    'Operative Note',
    'Postoperative Details',
    'Post-operative Details',
    'Estimated Blood Loss',
    'Specimens Sent',
    'Complications',
    'Biopsies',
    'Diagnosis',
    'ICD',
    'ICDs',
    'ICD10',
    'ICD-10',
    'ICD10 Codes',
    'ICD-10 Codes',
    'Postoperative Plan',
    'Post-operative Plan',
    'Management',
  ];

  const inline = (labels: string[]): string => {
    for (const label of labels) {
      const re = new RegExp(`^\\s*${flexibleLabelPattern(label)}\\s*:\\s*(.+?)\\s*$`, 'im');
      const value = text.match(re)?.[1]?.trim();
      if (value) return cleanOperationSection(value);
    }
    return '';
  };

  const block = (labels: string[], extraStops: string[] = []): string => {
    const labelPattern = labels.map((label) => flexibleLabelPattern(label)).join('|');
    const stopPattern = [...stopLabels, ...extraStops]
      .filter((label) => !labels.includes(label))
      .map((label) => flexibleLabelPattern(label))
      .join('|');
    const re = new RegExp(
      `^\\s*(?:${labelPattern})(?=\\s*:|\\s*$)\\s*:?\\s*(.*?)\\s*$([\\s\\S]*?)(?=^\\s*(?:${stopPattern})(?=\\s*:|\\s*$)\\s*:?\\s*(?:.*?)\\s*$|(?![\\s\\S]))`,
      'im'
    );
    const match = text.match(re);
    if (!match) return '';
    return cleanOperationSection([match[1] ?? '', match[2] ?? ''].filter(Boolean).join('\n'));
  };

  const preop = inline(['Preoperative Diagnosis']) || block(['Preoperative Diagnosis']);
  const postop = inline(['Postoperative Diagnosis']) || block(['Postoperative Diagnosis']);
  const diagnosis = [postop || preop, preop && postop ? `Preoperative: ${preop}` : '']
    .filter(Boolean)
    .join('\n');
  if (diagnosis) out.diagnosis = diagnosis;

  const explicitIcds =
    inline(['ICD', 'ICDs', 'ICD10', 'ICD-10', 'ICD10 Codes', 'ICD-10 Codes']) ||
    block(['ICD', 'ICDs', 'ICD10', 'ICD-10', 'ICD10 Codes', 'ICD-10 Codes']);
  if (explicitIcds) {
    out.icds = explicitIcds;
  } else if (diagnosis) {
    const inferred = inferOperationIcdsFromDiagnosis(diagnosis);
    if (inferred) out.icds = inferred;
  }

  const procedures = block(['Procedure']);
  if (procedures) {
    if (/^\s*\d+[.)]\s+/m.test(procedures)) {
      out.operation_title = procedures;
    } else if (/anaesth|anesth|supine|lithotomy|incision|port|haemostasis|hemostasis|closure|draped|dissect|suture|monocryl|vicryl/i.test(procedures)) {
      out.operation_note = procedures;
    } else {
      out.operation_title = procedures;
    }
  }

  const indication = block(['Indications', 'Indication']);
  if (indication) out.indication = indication;

  let findings = block(['Findings', 'Operative Findings']);
  const narrativeMarker = findings.search(
    /\n\s*(?:General anaesthesia|General anesthesia|The patient was brought|An initial visual inspection|Attention was turned|The abscess cavity|An Eisenhammer|To prevent|Hemostasis|Haemostasis)\b/i
  );
  let narrativeFromFindings = '';
  if (narrativeMarker >= 0) {
    narrativeFromFindings = findings.slice(narrativeMarker).trim();
    findings = findings.slice(0, narrativeMarker).trim();
  }
  if (findings) out.operative_findings = findings;

  const explicitOperationNote = block([
    'Operation Note',
    'Operative Note',
    'Operation Details',
    'Procedure Details',
    'Description of Procedure',
    'Operative Procedure',
    'Surgical Technique',
    'Technique',
  ]);
  if (explicitOperationNote || narrativeFromFindings) {
    out.operation_note = explicitOperationNote || narrativeFromFindings;
  }

  const plan = block(['Postoperative Plan', 'Post-operative Plan', 'Management']);
  if (plan) out.management = plan;

  const specimen = inline(['Specimens Sent', 'Specimen Sent', 'Samples Sent']) || block(['Specimens Sent', 'Specimen Sent', 'Samples Sent']);
  if (specimen) out.biopsies = specimen;

  const ebl = inline(['Estimated Blood Loss']) || block(['Estimated Blood Loss']);
  const complications = inline(['Complications']) || block(['Complications']);
  const postopDetails = [ebl ? `Estimated blood loss: ${ebl}` : '', complications ? `Complications: ${complications}` : '']
    .filter(Boolean)
    .join('\n');
  if (postopDetails) {
    out.management = [postopDetails, out.management].filter(Boolean).join('\n\n');
  }

  if (inline(['Surgeon', 'Operating Surgeon'])) out.surgeon = inline(['Surgeon', 'Operating Surgeon']);
  if (inline(['Anesthetist', 'Anaesthetist'])) out.anaesthetist = inline(['Anesthetist', 'Anaesthetist']);
  if (inline(['Time in', 'Time In', 'Start Time'])) out.start_time = inline(['Time in', 'Time In', 'Start Time']);
  if (inline(['Time out', 'Time Out', 'End Time'])) out.end_time = inline(['Time out', 'Time Out', 'End Time']);

  const narrativeStart = text.search(/\n\s*(?:General anaesthesia|General anesthesia|The patient was brought|An initial visual inspection|Attention was turned|The abscess cavity|An Eisenhammer|To prevent|Hemostasis|Haemostasis)\b/i);
  const postopDetailsIndex = text.search(/\n\s*(?:Postoperative Details|Post-operative Details|Estimated Blood Loss|Specimens Sent|Complications|Postoperative Plan|Post-operative Plan)\b/i);
  if (!out.operation_note && narrativeStart >= 0) {
    const narrativeEnd = postopDetailsIndex > narrativeStart ? postopDetailsIndex : text.length;
    const narrative = cleanOperationSection(text.slice(narrativeStart, narrativeEnd));
    if (narrative) out.operation_note = narrative;
  }

  return out;
}

/**
 * Reverse-parse editor plain text back into field map (label blocks from editor templates).
 */
export function parsePopulatedEditorToFieldMap(
  plainText: string,
  templateDefinition?: ClinicalTemplateDefinition
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!templateDefinition?.fields.length) return out;

  const text = plainText.replace(/\r\n/g, '\n');
  const fromMarkdown = parseMarkdownEditorToFieldMap(text, templateDefinition);
  const fromTypedLabels = parseTypedLabelValueBlocks(text, templateDefinition);

  for (const f of templateDefinition.fields) {
    const heading = headingForKey(f.key);
    const re = new RegExp(
      `(?:^|\\n)${escapeRe(heading)}\\s*:\\s*\\n+([\\s\\S]*?)(?=\\n[A-Z][A-Z0-9 /&'-]+:\\s*\\n|$)`,
      'i'
    );
    const m = text.match(re);
    if (m?.[1] != null) {
      out[f.key] = m[1].trim();
      continue;
    }
    // Ward dictation / single-block templates
    if (templateDefinition.fields.length === 1) {
      out[f.key] = text.trim();
    }
  }

  const templateSpecific =
    templateDefinition?.template_id &&
    (/report/i.test(templateDefinition.template_id) || templateDefinition.template_id === 'operation')
      ? parseReportNoteContent(text, templateDefinition)
      : {};

  const operationReport =
    templateDefinition.template_id === 'operation' ? operationGeminiReportFields(text) : {};
  const merged = { ...fromMarkdown, ...out, ...fromTypedLabels, ...templateSpecific, ...operationReport };
  const fallback =
    templateDefinition.template_id === 'operation'
      ? operationNarrativeFallback(text, merged)
      : {};

  return sanitizeReportDocxFields({ ...merged, ...fallback });
}

/** Merge priority: editor parse overrides docxMerge per key when editor value non-empty. */
export function mergeFieldMaps(
  docxMerge: Record<string, string> | undefined,
  editorParsed: Record<string, string>
): Record<string, string> {
  const base = Object.fromEntries(
    Object.entries(docxMerge ?? {}).filter(([, value]) => String(value ?? '').trim())
  );
  for (const [k, v] of Object.entries(editorParsed)) {
    if (v.trim()) base[k] = v.trim();
  }
  return base;
}
