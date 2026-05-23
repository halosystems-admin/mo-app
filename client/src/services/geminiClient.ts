import { GoogleGenerativeAI } from '@google/generative-ai';

const TEXT_MODEL = 'gemini-flash-latest';
const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 2000;
const GEMINI_TIMEOUT_MS = 90_000;

function getApiKey(): string {
  const key = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim() ?? '';
  return key;
}

export function isClientGeminiConfigured(): boolean {
  return Boolean(getApiKey());
}

function extractTextFromResult(result: {
  response: {
    text: () => string;
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
}): string {
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

async function withRetry<T>(fn: () => Promise<T>, maxRetries = MAX_RETRIES, delay = BASE_RETRY_DELAY_MS): Promise<T> {
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

export async function generateText(prompt: string): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('VITE_GEMINI_API_KEY is not set. Add it to .env and restart the Vite dev server.');
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: TEXT_MODEL });
  const result = await withRetry(() =>
    model.generateContent(prompt, { timeout: GEMINI_TIMEOUT_MS })
  );
  return extractTextFromResult(result);
}

/** Safely parse JSON from Gemini responses, stripping markdown code fences. */
export function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}
