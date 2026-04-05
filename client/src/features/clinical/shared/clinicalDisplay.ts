import type { ClinicalWard } from '../../../types/clinical';
import type { Patient } from '../../../../../shared/types';

/** Ward column heading strip on the inpatient board (distinct tints per ward). */
export function wardHeadingStripClass(ward: ClinicalWard): string {
  const m: Record<ClinicalWard, string> = {
    ICU: 'bg-rose-100/95 border-rose-200 text-rose-950',
    'F-ward (4th)': 'bg-amber-100/95 border-amber-200 text-amber-950',
    'S-ward (5th)': 'bg-orange-100/95 border-orange-200 text-orange-950',
    'medical ward': 'bg-emerald-100/95 border-emerald-200 text-emerald-950',
    'paediatrics ward': 'bg-sky-100/95 border-sky-200 text-sky-950',
    'emergency department': 'bg-fuchsia-100/95 border-fuchsia-200 text-fuchsia-950',
    'labour ward': 'bg-violet-100/95 border-violet-200 text-violet-950',
  };
  return m[ward] ?? 'bg-slate-100 border-slate-200 text-slate-800';
}

/** Compact ward badge for tables (pill). */
export function wardBadgeClass(ward: ClinicalWard | '' | undefined): string {
  if (!ward) return 'inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200';
  const m: Record<ClinicalWard, string> = {
    ICU: 'inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-100 text-rose-900 border border-rose-200',
    'F-ward (4th)':
      'inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-100 text-amber-950 border border-amber-200',
    'S-ward (5th)':
      'inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold bg-orange-100 text-orange-950 border border-orange-200',
    'medical ward':
      'inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-100 text-emerald-950 border border-emerald-200',
    'paediatrics ward':
      'inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold bg-sky-100 text-sky-950 border border-sky-200',
    'emergency department':
      'inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold bg-fuchsia-100 text-fuchsia-950 border border-fuchsia-200',
    'labour ward':
      'inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold bg-violet-100 text-violet-950 border border-violet-200',
  };
  return m[ward] ?? 'inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200';
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
