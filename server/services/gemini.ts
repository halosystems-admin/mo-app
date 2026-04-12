import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';

const TEXT_MODEL = 'gemini-flash-latest';
const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 2000;
/** Timeout for Gemini text (15–90s typical) */
export const GEMINI_TIMEOUT_MS = 90_000;
/** Shorter cap for single vision calls — faster UX for Smart Context */
const GEMINI_VISION_TIMEOUT_MS = 55_000;

function getGenAI(): GoogleGenerativeAI {
  return new GoogleGenerativeAI(config.geminiApiKey);
}

/**
 * Retry wrapper for Gemini API calls with exponential backoff.
 * Retries on 429 (rate limit) and 503 (service unavailable).
 */
export async function withRetry<T>(fn: () => Promise<T>, maxRetries = MAX_RETRIES, delay = BASE_RETRY_DELAY_MS): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;
      const isRetryable = err.message?.includes('429') || err.message?.includes('503');
      if (isRetryable && i < maxRetries) {
        await new Promise((r) => setTimeout(r, delay * Math.pow(2, i)));
        continue;
      }
      break;
    }
  }
  throw lastError;
}

/**
 * Safely parse JSON from Gemini responses, stripping markdown code fences.
 */
export function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

const geminiRequestOptions = { timeout: GEMINI_TIMEOUT_MS };
const geminiVisionRequestOptions = { timeout: GEMINI_VISION_TIMEOUT_MS };

function getVisionModelCandidates(): string[] {
  const ordered = [config.geminiVisionModel, config.geminiVisionFallbackModel].map((value) => value.trim()).filter(Boolean);
  return Array.from(new Set(ordered));
}

function isModelNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /404|not found|model .* not found|is not found|not supported for generatecontent/i.test(message);
}

/**
 * Generate text content using the Gemini text model.
 */
function wrapGeminiError(err: unknown, context: string): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (/API[_ ]?KEY|API key not valid|invalid api key|401|403|PERMISSION_DENIED|not configured/i.test(msg)) {
    return new Error(
      `${context}: Gemini rejected the call (${msg}). Set GEMINI_API_KEY in the server .env at the project root (not Vite), save, and restart the Node server.`
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** Prefer response.text(); fall back to concatenating candidate parts (vision often needs this). */
function extractTextFromResult(result: { response: { text: () => string; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } }): string {
  try {
    const t = result.response.text();
    if (t?.trim()) return t.trim();
  } catch {
    /* blocked finish / no text part */
  }
  const parts = result.response.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .join('')
    .trim();
}

export async function generateText(prompt: string): Promise<string> {
  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is empty after trim — check .env and restart the server.');
  }
  try {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({ model: TEXT_MODEL });
    const result = await withRetry(() =>
      model.generateContent(prompt, geminiRequestOptions)
    );
    return result.response.text();
  } catch (e) {
    throw wrapGeminiError(e, 'generateText');
  }
}

/**
 * Stream text content using the Gemini text model.
 * Yields text chunks as they arrive for lower perceived latency.
 */
export async function* generateTextStream(prompt: string): AsyncGenerator<string> {
  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: TEXT_MODEL });
  const result = await withRetry(() =>
    model.generateContentStream(prompt, geminiRequestOptions)
  );
  for await (const chunk of result.stream) {
    const text = chunk.text?.();
    if (text) yield text;
  }
}

/**
 * Generate content from an image using the Gemini vision model.
 */
/** Strip data-URL prefix if present; vision APIs expect raw base64. */
export function stripBase64DataUrl(base64Data: string): string {
  const s = base64Data.trim();
  if (s.includes(',')) return s.split(',')[1] || '';
  return s;
}

export async function analyzeImage(prompt: string, base64Data: string, mimeType: string): Promise<string> {
  return analyzeInlineData(prompt, base64Data, mimeType);
}

export async function analyzeInlineData(
  prompt: string,
  base64Data: string,
  mimeType: string
): Promise<string> {
  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is empty after trim — check .env and restart the server.');
  }
  const raw = stripBase64DataUrl(base64Data);
  if (!raw) {
    throw new Error('analyzeInlineData: empty file data');
  }
  const genAI = getGenAI();
  const modelCandidates = getVisionModelCandidates();
  if (!modelCandidates.length) {
    throw new Error('analyzeInlineData: no Gemini vision model configured.');
  }

  const runModel = async (modelId: string): Promise<string> => {
    console.log('[gemini/vision] generateContent request', {
      model: modelId,
      mimeType,
      hasInlineData: Boolean(raw),
      bytes: Buffer.from(raw, 'base64').length,
    });
    const model = genAI.getGenerativeModel({ model: modelId });
    const result = await withRetry(() =>
      model.generateContent(
        [prompt, { inlineData: { data: raw, mimeType } }],
        geminiVisionRequestOptions
      )
    );
    const text = extractTextFromResult(result).trim();
    console.log('[gemini/vision] generateContent response', {
      model: modelId,
      mimeType,
      returnedText: Boolean(text),
      textLength: text.length,
    });
    return text;
  };

  let lastErr: unknown;
  const seen = new Set<string>();
  for (const modelId of modelCandidates) {
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);
    try {
      const t = await runModel(modelId);
      if (t) return t;
    } catch (e) {
      lastErr = e;
      console.error('[gemini/vision] model attempt failed', {
        model: modelId,
        mimeType,
        modelNotFound: isModelNotFoundError(e),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (lastErr) throw wrapGeminiError(lastErr, 'analyzeImage');
  return '';
}

/**
 * Vision + JSON output (enforced by API). Use for Smart Context structured extraction.
 */
export async function analyzeImageJsonResponse(
  prompt: string,
  base64Data: string,
  mimeType: string
): Promise<string> {
  return analyzeInlineDataJsonResponse(prompt, base64Data, mimeType);
}

export async function analyzeInlineDataJsonResponse(
  prompt: string,
  base64Data: string,
  mimeType: string
): Promise<string> {
  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is empty after trim — check .env and restart the server.');
  }
  const raw = stripBase64DataUrl(base64Data);
  if (!raw) {
    throw new Error('analyzeInlineDataJsonResponse: empty file data');
  }
  const genAI = getGenAI();
  const modelCandidates = getVisionModelCandidates();
  if (!modelCandidates.length) {
    throw new Error('analyzeInlineDataJsonResponse: no Gemini vision model configured.');
  }

  const runModel = async (modelId: string): Promise<string> => {
    console.log('[gemini/vision-json] generateContent request', {
      model: modelId,
      mimeType,
      hasInlineData: Boolean(raw),
      bytes: Buffer.from(raw, 'base64').length,
    });
    const model = genAI.getGenerativeModel({ model: modelId });
    const result = await withRetry(() =>
      model.generateContent(
        {
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }, { inlineData: { data: raw, mimeType } }],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
          },
        },
        geminiVisionRequestOptions
      )
    );
    const text = extractTextFromResult(result).trim();
    console.log('[gemini/vision-json] generateContent response', {
      model: modelId,
      mimeType,
      returnedText: Boolean(text),
      textLength: text.length,
    });
    return text;
  };

  let lastErr: unknown;
  const seen = new Set<string>();
  for (const modelId of modelCandidates) {
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);
    try {
      const t = await runModel(modelId);
      if (t) return t;
    } catch (e) {
      lastErr = e;
      console.error('[gemini/vision-json] model attempt failed', {
        model: modelId,
        mimeType,
        modelNotFound: isModelNotFoundError(e),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (lastErr) throw wrapGeminiError(lastErr, 'analyzeImageJsonResponse');
  return '';
}

/**
 * Generate content from audio using the Gemini model.
 */
export async function transcribeAudio(prompt: string, base64Data: string, mimeType: string): Promise<string> {
  const raw = stripBase64DataUrl(base64Data);
  if (!raw) {
    throw new Error('transcribeAudio: empty audio data');
  }
  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: TEXT_MODEL });
  const result = await withRetry(() =>
    model.generateContent(
      [prompt, { inlineData: { data: raw, mimeType } }],
      geminiRequestOptions
    )
  );
  return result.response.text();
}
