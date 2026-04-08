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
export async function analyzeImage(prompt: string, base64Data: string, mimeType: string): Promise<string> {
  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is empty after trim — check .env and restart the server.');
  }
  if (!base64Data?.trim()) {
    throw new Error('analyzeImage: empty image data');
  }
  const genAI = getGenAI();
  const primary = config.geminiVisionModel || 'gemini-2.0-flash';
  const secondary = 'gemini-1.5-flash';

  const runModel = async (modelId: string): Promise<string> => {
    const model = genAI.getGenerativeModel({ model: modelId });
    const result = await withRetry(() =>
      model.generateContent(
        [prompt, { inlineData: { data: base64Data, mimeType } }],
        geminiVisionRequestOptions
      )
    );
    return extractTextFromResult(result).trim();
  };

  let lastErr: unknown;
  const seen = new Set<string>();
  for (const modelId of [primary, secondary]) {
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);
    try {
      const t = await runModel(modelId);
      if (t) return t;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw wrapGeminiError(lastErr, 'analyzeImage');
  return '';
}

/**
 * Generate content from audio using the Gemini model.
 */
export async function transcribeAudio(prompt: string, base64Data: string, mimeType: string): Promise<string> {
  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: TEXT_MODEL });
  const result = await withRetry(() =>
    model.generateContent(
      [prompt, { inlineData: { data: base64Data, mimeType } }],
      geminiRequestOptions
    )
  );
  return result.response.text();
}
