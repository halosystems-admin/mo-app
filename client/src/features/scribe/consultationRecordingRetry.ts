/** Last stopped consultation recording — batch re-transcribe via /api/ai/transcribe (Deepgram/Gemini). */
type RetryFn = () => Promise<string>;

let lastRetry: RetryFn | null = null;

export function setLastRecordingTranscriptionRetry(fn: RetryFn | null): void {
  lastRetry = fn;
}

export function hasLastRecordingTranscriptionRetry(): boolean {
  return lastRetry != null;
}

export async function retryLastRecordingTranscription(): Promise<string | null> {
  if (!lastRetry) return null;
  const text = await lastRetry();
  return text?.trim() || null;
}
