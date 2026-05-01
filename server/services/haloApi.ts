/**
 * Halo Functions API client.
 * Centralizes calls to generate_note and get_templates with error handling.
 */

import { config } from '../config';
import { haloGenerateNoteInputEnvelope } from '../utils/prompts';

const BASE = config.haloApiBaseUrl;

const HALO_REQUEST_TIMEOUT_MS = 90_000;

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = HALO_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Halo note service took too long to respond. Please try again.');
    }
    throw err;
  }
}

export interface NoteField {
  label: string;
  body: string;
}

export interface HaloNote {
  noteId: string;
  title: string;
  content: string;
  /** Raw upstream note payload for debug/raw JSON rendering. */
  raw?: unknown;
  template_id: string;
  lastSavedAt?: string;
  dirty?: boolean;
  /** Structured fields from generate_note (for preview before DOCX) */
  fields?: NoteField[];
}

const META_KEYS = new Set(['noteId', 'id', 'title', 'name', 'template_id', 'templateId', 'lastSavedAt', 'sections', 'fields', 'notes', 'data']);

/** Extract structured fields from raw generate_note response (object with named sections). */
function extractFieldsFromNoteData(data: unknown): NoteField[] | null {
  if (data == null || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;

  // Shape: { "sections": [ { "name": "X", "content": "Y" } ] }
  if (Array.isArray(obj.sections)) {
    const fields: NoteField[] = [];
    for (const s of obj.sections as Array<Record<string, unknown>>) {
      const label = (s.name ?? s.title ?? s.label) as string;
      const body = (s.content ?? s.body ?? s.value ?? s.text ?? '') as string;
      if (label && typeof label === 'string') fields.push({ label, body: String(body ?? '') });
    }
    if (fields.length > 0) return fields;
  }

  // Shape: { "fields": [ { "label": "X", "value": "Y" } ] } or body
  if (Array.isArray(obj.fields)) {
    const fields: NoteField[] = [];
    for (const f of obj.fields as Array<Record<string, unknown>>) {
      const label = (f.label ?? f.name ?? f.title) as string;
      const body = (f.value ?? f.body ?? f.content ?? f.text ?? '') as string;
      if (label && typeof label === 'string') fields.push({ label, body: String(body ?? '') });
    }
    if (fields.length > 0) return fields;
  }

  // Shape: { "Subjective": "...", "Objective": "...", "Plan": "..." } — object with string values
  const entries = Object.entries(obj).filter(
    ([k]) => !META_KEYS.has(k) && !k.startsWith('_')
  );
  const allStrings = entries.length > 0 && entries.every(([, v]) => typeof v === 'string');
  if (allStrings && entries.length > 0) {
    return entries.map(([label, body]) => ({ label, body: (body as string) || '' }));
  }

  return null;
}

function fieldsToContent(fields: NoteField[]): string {
  return fields.map(f => (f.label ? `${f.label}:\n${f.body || ''}` : f.body)).filter(Boolean).join('\n\n');
}

/** Normalize upstream response to array of HaloNote. Handles various shapes from Halo webhook. */
function normalizeNotesResponse(data: unknown, templateId: string): HaloNote[] {
  const now = new Date().toISOString();
  const oneNote = (content: string, title = 'Note 1', fields?: NoteField[], raw?: unknown): HaloNote => ({
    noteId: `note-0-${Date.now()}`,
    title,
    content,
    ...(raw !== undefined ? { raw } : {}),
    template_id: templateId,
    lastSavedAt: now,
    dirty: false,
    ...(fields && fields.length > 0 ? { fields } : {}),
  });

  if (data == null) return [];

  if (typeof data === 'string' && data.trim()) {
    return [oneNote(data.trim(), 'Note 1', undefined, data)];
  }

  if (Array.isArray(data)) {
    return data.map((item: any, i: number) => {
      const fields = extractFieldsFromNoteData(item);
      const nestedObject =
        (item?.result && typeof item.result === 'object' ? item.result : null) ??
        (item?.generated_note && typeof item.generated_note === 'object' ? item.generated_note : null) ??
        (item?.output && typeof item.output === 'object' ? item.output : null);
      const nestedFields = nestedObject ? extractFieldsFromNoteData(nestedObject) : null;
      const content =
        (typeof item.content === 'string' ? item.content : '') ||
        (typeof item.note === 'string' ? item.note : '') ||
        (typeof item.body === 'string' ? item.body : '') ||
        (typeof item.generated_note === 'string' ? item.generated_note : '') ||
        (typeof item.output === 'string' ? item.output : '') ||
        (typeof item.result === 'string' ? item.result : '') ||
        // Keep transcript-like text as last fallback only.
        (typeof item.text === 'string' ? item.text : '');
      const effectiveFields = fields ?? nestedFields;
      return {
        noteId: item.noteId ?? item.id ?? `note-${i}-${Date.now()}`,
        title: item.title ?? item.name ?? `Note ${i + 1}`,
        content: content || (effectiveFields ? fieldsToContent(effectiveFields) : String(item)),
        raw: item?.raw ?? item,
        template_id: item.template_id ?? item.templateId ?? templateId,
        lastSavedAt: item.lastSavedAt ?? now,
        dirty: false,
        ...(effectiveFields && effectiveFields.length > 0 ? { fields: effectiveFields } : {}),
      };
    }).filter(n => n.content.length > 0);
  }

  const obj = data as Record<string, unknown>;
  if (typeof obj !== 'object') return [];

  if (obj.notes && Array.isArray(obj.notes)) {
    return normalizeNotesResponse(obj.notes, templateId);
  }
  if (obj.data != null) {
    const out = normalizeNotesResponse(obj.data, templateId);
    if (out.length > 0) return out;
  }
  if (obj.note != null && typeof obj.note === 'object') {
    const out = normalizeNotesResponse(obj.note, templateId);
    if (out.length > 0) return out;
  }
  if (obj.result != null && typeof obj.result === 'object') {
    const out = normalizeNotesResponse(obj.result, templateId);
    if (out.length > 0) return out;
  }

  // Try structured fields from the root object (e.g. { Subjective: "...", Objective: "..." })
  const fields = extractFieldsFromNoteData(obj);
  if (fields && fields.length > 0) {
    const content = fieldsToContent(fields);
    const title = (obj.title as string) ?? (obj.name as string) ?? 'Note 1';
    return [oneNote(content, title, fields, obj.raw ?? obj)];
  }

  const content =
    obj.content ??
    obj.text ??
    obj.note ??
    obj.body ??
    obj.result ??
    obj.output ??
    obj.generated_note ??
    obj.note_content ??
    obj.message;
  if (typeof content === 'string' && content.trim()) {
    return [oneNote(content.trim(), (obj.title as string) ?? (obj.name as string) ?? 'Note 1', undefined, obj.raw ?? obj)];
  }

  // Unrecognized shape: log so we can extend the normalizer for the real HALO response
  if (typeof obj === 'object' && obj !== null) {
    const keys = Object.keys(obj).filter((k) => !k.startsWith('_'));
    console.warn('[Halo] generate_note response not recognized. Top-level keys:', keys.join(', ') || '(none)');
  }
  return [];
}

/**
 * Fetch templates for a user from Halo (Firebase RTDB).
 */
export async function getTemplates(userId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/get_templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  });

  if (!res.ok) {
    if (res.status === 400) throw new Error('Invalid request to Halo templates.');
    if (res.status === 502) throw new Error('Halo templates service unavailable. Please try again.');
    throw new Error(`Halo templates error: ${res.status}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  return data;
}

export interface GenerateNoteParams {
  user_id: string;
  template_id: string;
  text: string;
  return_type: 'note' | 'docx';
  /** Human-readable template name (e.g. "Admission") — improves Markdown structuring in the composed prompt. */
  template_name?: string;
}

/**
 * Generate note (preview) or DOCX. For return_type 'note' returns normalized notes array.
 * For return_type 'docx' returns the raw buffer.
 */
export async function generateNote(params: GenerateNoteParams): Promise<HaloNote[] | Buffer> {
  const { return_type } = params;

  const composedText = haloGenerateNoteInputEnvelope({
    userPayloadText: params.text,
    templateId: params.template_id,
    templateDisplayName: params.template_name,
  });

  const url = `${BASE}/generate_note`;
  const body = JSON.stringify({
    user_id: params.user_id,
    template_id: params.template_id,
    text: composedText,
    return_type,
  });

  const maxAttempts = return_type === 'docx' ? 3 : 1;
  let res: Response | null = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      res = await fetchWithTimeout(
        url,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
        HALO_REQUEST_TIMEOUT_MS
      );
      if (res.ok) break;
      if (![502, 503, 504].includes(res.status)) break;
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
      }
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  if (!res) throw lastErr instanceof Error ? lastErr : new Error('Halo request failed.');

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 400) throw new Error('Invalid request to Halo note generation.');
    if (res.status === 404) {
      try {
        const parsed = body ? JSON.parse(body) : null;
        if (parsed && typeof parsed.detail === 'string') console.error('[Halo] 404 detail:', parsed.detail);
        else if (body) console.error('[Halo] 404 body:', body.slice(0, 200));
      } catch {
        if (body) console.error('[Halo] 404 body:', body.slice(0, 200));
      }
      throw new Error(
        'Halo returned 404: template or user not found. Check that template_id and HALO_USER_ID (or user_id) exist in the Halo service. If the Halo API base URL or paths changed, update HALO_API_BASE_URL.'
      );
    }
    if (res.status === 502) throw new Error('Halo note service unavailable. Please try again.');
    throw new Error(`Halo generate_note error: ${res.status}`);
  }

  if (return_type === 'docx') {
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer;
  }

  const data = (await res.json()) as unknown;
  const notes = normalizeNotesResponse(data, params.template_id);
  // Always pin raw = the original HALO API response so the client can render
  // actual clinical fields (not the normalized wrapper keys).
  return notes.map((n) => ({ ...n, raw: data }));
}
