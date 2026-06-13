import type { HaloNote } from '../../../shared/types';
import { generateNotePreview } from './api';
import { isClientGeminiConfigured } from './geminiClient';
import type { HaloPatientProfile } from '../../../shared/types';

export type NotePreviewParams = {
  template_id: string;
  text: string;
  user_id?: string;
  patientId?: string;
  template_name?: string;
  haloUserId?: string | null;
  patientProfile?: HaloPatientProfile | null;
};

function noteHasStructuredFields(notes: HaloNote[]): boolean {
  return notes.some((n) => n.fields && n.fields.length > 0);
}

/** Client Gemini first; falls back to server when client fails or returns no structured fields. */
export async function generateNotePreviewWithFallback(
  params: NotePreviewParams
): Promise<{ notes: HaloNote[] }> {
  if (isClientGeminiConfigured()) {
    try {
      const { generateClinicalNotePreview } = await import('./generateClinicalNoteClient');
      const clientResult = await generateClinicalNotePreview({
        template_id: params.template_id,
        text: params.text,
        template_name: params.template_name,
        patientId: params.patientId,
        haloUserId: params.haloUserId,
        patientProfile: params.patientProfile,
      });
      if (noteHasStructuredFields(clientResult.notes)) {
        return clientResult;
      }
      console.warn('[note-preview] client Gemini returned no structured fields — trying server');
    } catch (e) {
      console.warn('[note-preview] client Gemini failed, trying server:', e);
    }
  }

  const serverParams: Parameters<typeof generateNotePreview>[0] = {
    template_id: params.template_id,
    text: params.text,
    template_name: params.template_name,
    patientId: params.patientId,
    user_id: params.user_id ?? params.haloUserId ?? undefined,
  };
  return generateNotePreview(serverParams);
}

export function notePreviewConfigHint(): string | null {
  if (isClientGeminiConfigured()) return null;
  return 'Add VITE_GEMINI_API_KEY to .env and restart Vite for faster note generation.';
}
