import type { ClinicalWard } from '../../../types/clinical';
import type { Patient } from '../../../../../shared/types';

/** Ward board column strip — neutral (reference: no rainbow per ward). */
export function wardHeadingStripClass(_ward: ClinicalWard): string {
  return 'bg-slate-100 border-slate-200 text-slate-800';
}

/** Compact ward badge for tables — same neutral pill for every ward. */
export function wardBadgeClass(ward: ClinicalWard | '' | undefined): string {
  const base =
    'inline-flex px-2 py-0.5 rounded-md text-[11px] font-medium leading-tight bg-halo-section text-halo-text border border-halo-border';
  if (!ward) return `${base} text-halo-text-secondary`;
  return base;
}

/** Sentence-style ward labels (e.g. labour ward → Labour ward). */
export function formatWardDisplay(ward: ClinicalWard | '' | undefined): string {
  if (!ward) return '—';
  if (ward === 'ICU') return 'ICU';
  return ward.charAt(0).toUpperCase() + ward.slice(1);
}

export function formatBookingUrgency(u: 'emergency' | 'elective' | undefined): string {
  if (u === 'emergency') return 'Emergency';
  if (u === 'elective') return 'Elective';
  return '—';
}

export function formatListUrgency(u: 'urgent' | 'routine' | undefined): string {
  if (u === 'urgent') return 'Urgent';
  if (u === 'routine') return 'Routine';
  return '—';
}

export function formatTheatreStatus(s: string | undefined): string {
  if (!s) return '—';
  if (s === 'pending') return 'Pending';
  if (s === 'completed') return 'Completed';
  if (s === 'cancelled') return 'Cancelled';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatFileSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatUploadedDocSummary(
  name?: string,
  uploadedAt?: string,
  sizeBytes?: number
): string {
  if (!name?.trim()) return '';
  const parts: string[] = [name.trim()];
  if (uploadedAt) {
    try {
      parts.push(`Uploaded ${new Date(uploadedAt).toLocaleString()}`);
    } catch {
      /* ignore */
    }
  }
  if (sizeBytes != null && sizeBytes > 0) {
    parts.push(formatFileSize(sizeBytes));
  }
  return parts.join(' · ');
}

/** Single-field patient name → "Surname, Given" for lists and filenames (comma already present → unchanged). */
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

/** Clinical admission row: "Surname, First name". */
export function formatInpatientDisplayName(firstName: string, surname: string): string {
  const f = firstName.trim();
  const s = surname.trim();
  if (!f && !s) return '';
  if (!f) return s;
  if (!s) return f;
  return `${s}, ${f}`;
}

/** Match mock clinical first + surname to a HALO Patient folder (best-effort). */
export function resolvePatientIdFromClinicalNames(
  patients: Patient[],
  firstName: string,
  surname: string
): string | undefined {
  const a = `${firstName} ${surname}`.trim().toLowerCase();
  const b = `${surname}, ${firstName}`.trim().toLowerCase();
  if (!a) return undefined;
  const norm = (s: string) => s.trim().toLowerCase();
  return patients.find((p) => {
    const n = norm(p.name);
    return n === a || n === b;
  })?.id;
}
