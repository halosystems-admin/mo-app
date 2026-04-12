import { getSupabaseAdminClient, isSupabaseAdminConfigured } from './supabaseAdmin';
import type { ClinicalContextStructured } from '../../shared/types';

/**
 * Persist structured Smart Context when Supabase is configured (optional).
 * haloPatientId is the Drive / HALO folder id string.
 */
export async function insertConsultContextExtraction(params: {
  haloPatientId: string;
  driveFileId: string;
  fileName: string;
  structured: ClinicalContextStructured | null;
  summaryMarkdown: string;
}): Promise<void> {
  if (!isSupabaseAdminConfigured()) return;
  const sb = getSupabaseAdminClient();
  if (!sb) return;

  const extracted =
    params.structured != null
      ? (params.structured as unknown as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  const { error } = await sb.from('consult_context_extractions').insert({
    halo_patient_id: params.haloPatientId,
    drive_file_id: params.driveFileId,
    file_name: params.fileName,
    summary_markdown: params.summaryMarkdown,
    extracted_json: extracted,
  });

  if (error) {
    console.warn('[consult_context_extractions] insert skipped:', error.message);
  }
}
