import type { ClinicalTemplateDefinition } from './clinicalTemplates/types';
import type { NoteField } from './types';

type SectionMode = 'labeled' | 'prose';

type TemplateSectionSpec = {
  title: string;
  keys: string[];
  mode: SectionMode;
  labels?: Record<string, string>;
};

/** Grouped ## sections for templates that match the PatientWorkspace note-fields view. */
const TEMPLATE_SECTIONS: Record<string, TemplateSectionSpec[]> = {
  inpatient_fu: [
    {
      title: 'Patient Details',
      mode: 'labeled',
      keys: [
        'patient_name',
        'id',
        'dob',
        'medical_aid',
        'medical_aid_no',
        'contact',
        'fu_date',
        'admission_ward_number',
        'admission_urgency',
      ],
      labels: {
        patient_name: 'Name',
        id: 'ID Number',
        dob: 'Date of Birth',
        medical_aid: 'Medical Aid',
        medical_aid_no: 'Medical Aid Number',
        contact: 'Contact',
        fu_date: 'Date of Follow-up',
        admission_ward_number: 'Location',
        admission_urgency: 'Admission Urgency',
      },
    },
    {
      title: 'Presenting Complaint',
      mode: 'prose',
      keys: ['presenting_complaint', 'indication', 'today'],
    },
    {
      title: 'Clinical Examination',
      mode: 'prose',
      keys: ['vitals', 'examination', 'drain_output', 'stoma_output'],
    },
    {
      title: 'Plan',
      mode: 'prose',
      keys: ['management_recommendations', 'additions_to_assessment'],
    },
  ],
};

function labelParts(label: string): string[] {
  return label
    .split('›')
    .map((p) => p.trim())
    .filter(Boolean);
}

function normalizeHeadingLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[:*]/g, '')
    .replace(/\s+/g, ' ');
}

function headingMatchesLabel(heading: string, label: string): boolean {
  return normalizeHeadingLabel(heading) === normalizeHeadingLabel(label);
}

/** Detect ## Title followed immediately by **Title** (legacy duplicate formatting). */
export function markdownHasDuplicateSectionLabels(text: string): boolean {
  return /^##\s+(.+?)\s*\n+\*\*\1:?\*\*/im.test(text);
}

/** Turn structured fields into grouped ## / **label** markdown (open-text note editor). */
export function fieldsToOrganizedText(fields: NoteField[]): string {
  if (!fields.length) return '';

  const groups = new Map<string, Array<{ label: string; body: string }>>();
  for (const f of fields) {
    const rawLabel = String(f.label || '').trim();
    const body = String(f.body ?? '').trim();
    if (!rawLabel && !body) continue;
    const parts = labelParts(rawLabel);
    const top = parts[0] || 'Note';
    const leaf = parts.length > 1 ? parts.slice(1).join(' › ') : rawLabel || 'Text';
    const arr = groups.get(top) ?? [];
    arr.push({ label: leaf, body });
    groups.set(top, arr);
  }

  const sections: string[] = [];
  for (const [section, items] of groups.entries()) {
    sections.push(`## ${section}`);
    sections.push('');
    for (const it of items) {
      if (!it.label && it.body) {
        sections.push(it.body);
        sections.push('');
        continue;
      }
      // One field per section with the same name → prose under ## only (no **Label** repeat).
      if (items.length === 1 && headingMatchesLabel(section, it.label)) {
        sections.push(it.body || '—');
        sections.push('');
        continue;
      }
      sections.push(`**${it.label}:**`);
      sections.push('');
      sections.push(it.body || '—');
      sections.push('');
    }
    sections.push('');
  }

  return sections.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function defaultLabelForKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildFromSectionSpecs(
  fieldValues: Record<string, string>,
  specs: TemplateSectionSpec[]
): string {
  const sections: string[] = [];

  for (const spec of specs) {
    if (spec.mode === 'labeled') {
      const items: Array<{ label: string; body: string }> = [];
      for (const key of spec.keys) {
        const body = String(fieldValues[key] ?? '').trim();
        if (!body) continue;
        const label = spec.labels?.[key] ?? defaultLabelForKey(key);
        items.push({ label, body });
      }
      if (!items.length) continue;
      sections.push(`## ${spec.title}`);
      sections.push('');
      for (const it of items) {
        sections.push(`**${it.label}:**`);
        sections.push('');
        sections.push(it.body);
        sections.push('');
      }
      continue;
    }

    const bodies = spec.keys
      .map((key) => String(fieldValues[key] ?? '').trim())
      .filter(Boolean);
    if (!bodies.length) continue;
    sections.push(`## ${spec.title}`);
    sections.push('');
    sections.push(bodies.join('\n\n'));
    sections.push('');
  }

  return sections.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildFromTemplateDefinition(
  fieldValues: Record<string, string>,
  templateDefinition: ClinicalTemplateDefinition
): string {
  const fields: NoteField[] = templateDefinition.fields
    .map((f) => ({
      label: defaultLabelForKey(f.key),
      body: String(fieldValues[f.key] ?? '').trim(),
    }))
    .filter((f) => f.body.length > 0);
  return fieldsToOrganizedText(fields);
}

/** Build Mo-style ## markdown from extracted template field values. */
export function fieldValuesToOrganizedMarkdown(
  templateId: string,
  fieldValues: Record<string, string>,
  templateDefinition?: ClinicalTemplateDefinition
): string {
  const nonEmpty = Object.fromEntries(
    Object.entries(fieldValues).filter(([, v]) => String(v ?? '').trim())
  );
  if (Object.keys(nonEmpty).length === 0) return '';

  const specs = TEMPLATE_SECTIONS[templateId];
  if (specs) {
    const fromSpecs = buildFromSectionSpecs(nonEmpty, specs);
    if (fromSpecs) return fromSpecs;
  }

  if (templateDefinition?.fields.length) {
    return buildFromTemplateDefinition(nonEmpty, templateDefinition);
  }

  return fieldsToOrganizedText(
    Object.entries(nonEmpty).map(([key, body]) => ({
      label: defaultLabelForKey(key),
      body,
    }))
  );
}

export function noteFieldsToOrganizedMarkdown(
  templateId: string,
  fields: NoteField[],
  templateDefinition?: ClinicalTemplateDefinition
): string {
  const fieldValues = Object.fromEntries(
    fields
      .map((f) => {
        const key = String(f.label || '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '_');
        return [key, String(f.body ?? '').trim()] as const;
      })
      .filter(([, body]) => body)
  );
  return fieldValuesToOrganizedMarkdown(templateId, fieldValues, templateDefinition);
}

/** Section layout used by fieldValuesToOrganizedMarkdown (for save-time markdown reverse-parse). */
export function templateSectionSpecsFor(templateId: string): TemplateSectionSpec[] | undefined {
  return TEMPLATE_SECTIONS[templateId];
}
