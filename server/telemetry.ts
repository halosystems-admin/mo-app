import type { RequestHandler } from 'express';
import http from 'node:http';
import https from 'node:https';
import { config } from './config';

// Vendored SDK — no GitHub clone needed on Heroku build.
const SDK_ENTRY = '@halo/telemetry-discovery-js';

interface TelemetryDiscovery {
  track: (rawPayload: Record<string, unknown>) => boolean;
  trackNoteGenerated: () => void;
  trackTranscriptionProcessed: (audioMinutes: number) => void;
  trackMessageSent: (options?: { billable?: boolean }) => void;
  createExpressMiddleware: (options?: {
    includeBodies?: boolean;
    maxBodyBytes?: number;
  }) => RequestHandler;
  flush: () => Promise<void>;
  shutdown: () => Promise<void>;
  getStats: () => Record<string, unknown>;
}

let telemetryInstance: TelemetryDiscovery | null = null;
const GEMINI_GOOGLE_HOST = 'generativelanguage.googleapis.com';
const OAUTH2_GOOGLE_HOST = 'oauth2.googleapis.com';
const SUPABASE_TELEMETRY_HOST_SUFFIXES = [
  '.supabase.co',
  '.supabase.com',
];
const MICROSOFT_TELEMETRY_HOST_SUFFIXES = [
  '.microsoft.com',
  '.microsoftonline.com',
  '.windows.net',
  '.live.com'
];
const originalFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
const originalHttpRequest = http.request.bind(http);
const originalHttpsRequest = https.request.bind(https);
const telemetryNetworkRestoreFns: Array<() => void> = [];

export function isTelemetryEnabled(): boolean {
  return Boolean(config.telemetryToken);
}

export function getTelemetry(): TelemetryDiscovery | null {
  return telemetryInstance;
}

export async function initTelemetry(): Promise<TelemetryDiscovery | null> {
  if (!config.telemetryToken) {
    console.warn(
      '[telemetry] HALO_TELEMETRY_TOKEN is not set — cost telemetry is disabled. Set HALO_TELEMETRY_URL and HALO_TELEMETRY_TOKEN to enable.'
    );
    return null;
  }

  const { initTelemetryDiscovery } = (await import(SDK_ENTRY)) as {
    initTelemetryDiscovery: (config: {
      appName: string;
      endpoint: string;
      token: string;
      requestTimeoutMs?: number;
      instrumentation?: Record<string, boolean>;
    }) => TelemetryDiscovery;
  };

  telemetryInstance = initTelemetryDiscovery({
    appName: config.telemetryAppName,
    endpoint: config.telemetryUrl,
    token: config.telemetryToken,
    requestTimeoutMs: 15000,
    instrumentation: {
      // Provider SDK patching crashes on @deepgram/sdk startup (listen.live getter).
      // Outbound fetch/http still captures Deepgram REST, Halo API, Google APIs, etc.
      providers: false,
      db: false,
    },
  });

  installGeminiOnlyGoogleBypass();

  console.log(`[telemetry] Enabled for app "${config.telemetryAppName}" → ${config.telemetryUrl}`);
  return telemetryInstance;
}

export async function shutdownTelemetry(): Promise<void> {
  if (!telemetryInstance) return;
  restoreTelemetryNetworkBypass();
  await telemetryInstance.shutdown();
  telemetryInstance = null;
}

export function trackNoteGenerated(): void {
  telemetryInstance?.trackNoteGenerated();
}

export function trackTranscriptionProcessed(audioMinutes: number): void {
  if (!Number.isFinite(audioMinutes) || audioMinutes < 0) return;
  if (!telemetryInstance) {
    console.warn('[telemetry] trackTranscriptionProcessed skipped — telemetry not initialized');
    return;
  }
  console.log('[telemetry] trackTranscriptionProcessed', { audioMinutes });
  telemetryInstance.trackTranscriptionProcessed(audioMinutes);
}

/** Live Deepgram uses WebSocket SDK — invisible to HTTP auto-capture. Emit explicitly on session end. */
export function trackDeepgramLiveCall(options: {
  audioMinutes: number;
  success?: boolean;
  errorMessage?: string;
}): void {
  if (!Number.isFinite(options.audioMinutes) || options.audioMinutes < 0) return;
  if (!telemetryInstance) {
    console.warn('[telemetry] trackDeepgramLiveCall skipped — telemetry not initialized');
    return;
  }

  const audioMinutes = Math.max(options.audioMinutes, 0.01);
  const payload: Record<string, unknown> = {
    type: 'provider_call',
    provider: 'deepgram',
    operation: 'listen.live',
    model: 'nova-3-medical',
    // Cost normalization derives audio minutes from duration_ms for Deepgram pricing.
    duration_ms: Math.round(audioMinutes * 60_000),
    success: options.success !== false,
  };
  if (options.errorMessage) {
    payload.error_message = options.errorMessage;
    payload.success = false;
  }

  console.log('[telemetry] trackDeepgramLiveCall', {
    audioMinutes,
    success: payload.success,
    operation: payload.operation,
  });
  telemetryInstance.track(payload);
}

export function trackMessageSent(billable = true): void {
  telemetryInstance?.trackMessageSent({ billable });
}

export function trackTemplateUsed(templateId: string, context?: string): void {
  if (!templateId.trim()) return;
  telemetryInstance?.track({
    type: 'template.used',
    template_id: templateId.trim(),
    context: context ?? 'unknown'
  });
}

export function trackFormUsed(formId: string, context?: string): void {
  if (!formId.trim()) return;
  telemetryInstance?.track({
    type: 'form.used',
    form_id: formId.trim(),
    context: context ?? 'unknown'
  });
}

export function trackTaskBoardSnapshot(taskCount: number): void {
  if (!Number.isFinite(taskCount) || taskCount < 0) return;
  if (!telemetryInstance) {
    console.warn('[telemetry] trackTaskBoardSnapshot skipped — telemetry not initialized');
    return;
  }
  const count = Math.floor(taskCount);
  console.log('[telemetry] trackTaskBoardSnapshot', { taskCount: count });
  const accepted = telemetryInstance.track({
    type: 'task.board_snapshot',
    task_count: count,
  });
  if (!accepted) {
    console.warn('[telemetry] trackTaskBoardSnapshot dropped by SDK (queue full or sampling)');
  }
  void flushTelemetry('trackTaskBoardSnapshot');
}

async function flushTelemetry(label: string): Promise<void> {
  if (!telemetryInstance) return;
  const before = telemetryInstance.getStats() as {
    dropped_sender_error?: number;
    flush_errors?: number;
    sent?: number;
  };
  try {
    await telemetryInstance.flush();
    const after = telemetryInstance.getStats() as {
      dropped_sender_error?: number;
      flush_errors?: number;
      sent?: number;
    };
    const dropped = (after.dropped_sender_error ?? 0) - (before.dropped_sender_error ?? 0);
    const flushErrors = (after.flush_errors ?? 0) - (before.flush_errors ?? 0);
    const sent = (after.sent ?? 0) - (before.sent ?? 0);
    if (dropped > 0) {
      console.warn(`[telemetry] ${label} failed to reach endpoint`, {
        sent,
        dropped,
        flush_errors: flushErrors,
      });
    }
  } catch (err) {
    console.warn(
      `[telemetry] ${label} flush error:`,
      err instanceof Error ? err.message : err
    );
  }
}

export function trackPatientScanned(
  patientId: string,
  details?: { scanDurationMs?: number; fileType?: string; fileName?: string }
): void {
  if (!patientId.trim()) return;
  if (!telemetryInstance) return;

  const payload: Record<string, unknown> = {
    type: 'patient.scanned',
    patient_id: patientId.trim(),
    scan_duration_ms:
      typeof details?.scanDurationMs === 'number' &&
      Number.isFinite(details.scanDurationMs) &&
      details.scanDurationMs >= 0
        ? Math.round(details.scanDurationMs)
        : null,
  };
  if (details?.fileType) {
    payload.file_type = details.fileType;
  }
  if (details?.fileName) {
    payload.file_name = details.fileName;
  }

  console.log('[telemetry] trackPatientScanned', {
    patientId: patientId.trim(),
    fileType: details?.fileType ?? null,
    scanDurationMs: payload.scan_duration_ms,
  });
  telemetryInstance.track(payload);
  void flushTelemetry('trackPatientScanned');
}

export function ensureAppSessionStarted(session: { appSessionStartedAt?: number }): void {
  if (typeof session.appSessionStartedAt !== 'number') {
    session.appSessionStartedAt = Date.now();
  }
}

export type AppSessionProvider = 'google' | 'microsoft' | 'email' | 'unknown';

export function resolveAppSessionProvider(session: {
  authProvider?: string;
  provider?: string;
  userId?: string;
}): AppSessionProvider {
  if (session.authProvider === 'email') return 'email';
  if (session.provider === 'google' || session.provider === 'microsoft') return session.provider;
  if (session.userId) return 'email';
  return 'unknown';
}

export function trackAppSessionEnded(durationMs: number, provider: AppSessionProvider): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  if (!telemetryInstance) {
    console.warn('[telemetry] trackAppSessionEnded skipped — telemetry not initialized');
    return;
  }
  console.log('[telemetry] trackAppSessionEnded', {
    durationMs: Math.round(durationMs),
    provider,
  });
  const accepted = telemetryInstance.track({
    type: 'app.session_ended',
    session_duration_ms: Math.round(durationMs),
    provider,
  });
  if (!accepted) {
    console.warn('[telemetry] trackAppSessionEnded dropped by SDK (queue full or sampling)');
  }
  void flushTelemetry('trackAppSessionEnded');
}

export function endAppSessionTelemetry(
  session: { appSessionStartedAt?: number; authProvider?: string; provider?: string; userId?: string }
): void {
  const startedAt = session.appSessionStartedAt;
  if (typeof startedAt !== 'number') return;
  trackAppSessionEnded(Date.now() - startedAt, resolveAppSessionProvider(session));
}

/** Rough duration estimate when provider metadata is unavailable (e.g. live WebSocket audio). */
export function estimateAudioMinutesFromBytes(audioBytes: number): number {
  if (!Number.isFinite(audioBytes) || audioBytes <= 0) return 0.01;
  const bytesPerSecond = 4000;
  return Math.max(audioBytes / bytesPerSecond / 60, 0.01);
}

export function audioSecondsToMinutes(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0.01;
  return Math.max(durationSeconds / 60, 0.01);
}

function installGeminiOnlyGoogleBypass(): void {
  restoreTelemetryNetworkBypass();
  if (!config.telemetryGeminiOnly && config.telemetryCaptureMicrosoft) return;

  const wrappedFetch = globalThis.fetch?.bind(globalThis);
  if (originalFetch && wrappedFetch && wrappedFetch !== originalFetch) {
    const fetchBypass = ((...args: Parameters<typeof globalThis.fetch>) => {
      const [input, init] = args;
      const url = extractFetchUrl(input);
      if (shouldBypassTelemetryHost(url?.hostname)) {
        return originalFetch(input, init);
      }
      return wrappedFetch(input, init);
    }) as typeof globalThis.fetch;

    globalThis.fetch = fetchBypass;
    telemetryNetworkRestoreFns.push(() => {
      globalThis.fetch = wrappedFetch;
    });
  }

  const wrappedHttpRequest = http.request.bind(http);
  if (wrappedHttpRequest !== originalHttpRequest) {
    const httpBypass = ((...args: Parameters<typeof http.request>) => {
      const hostname = extractRequestHostname(args, 'http:');
      if (shouldBypassTelemetryHost(hostname)) {
        return originalHttpRequest(...args);
      }
      return wrappedHttpRequest(...args);
    }) as typeof http.request;

    http.request = httpBypass;
    telemetryNetworkRestoreFns.push(() => {
      http.request = wrappedHttpRequest;
    });
  }

  const wrappedHttpsRequest = https.request.bind(https);
  if (wrappedHttpsRequest !== originalHttpsRequest) {
    const httpsBypass = ((...args: Parameters<typeof https.request>) => {
      const hostname = extractRequestHostname(args, 'https:');
      if (shouldBypassTelemetryHost(hostname)) {
        return originalHttpsRequest(...args);
      }
      return wrappedHttpsRequest(...args);
    }) as typeof https.request;

    https.request = httpsBypass;
    telemetryNetworkRestoreFns.push(() => {
      https.request = wrappedHttpsRequest;
    });
  }
}

function restoreTelemetryNetworkBypass(): void {
  while (telemetryNetworkRestoreFns.length > 0) {
    telemetryNetworkRestoreFns.pop()?.();
  }
}

function shouldBypassTelemetryHost(hostname?: string | null): boolean {
  if (!hostname) return false;
  const normalizedHost = hostname.toLowerCase();
  if (isSupabaseHost(normalizedHost)) {
    return true;
  }
  if (!config.telemetryCaptureMicrosoft && isMicrosoftHost(normalizedHost)) {
    return true;
  }
  if (!config.telemetryGeminiOnly) return false;
  if (normalizedHost === GEMINI_GOOGLE_HOST) return false;
  if (normalizedHost === OAUTH2_GOOGLE_HOST) return true;
  return normalizedHost.endsWith('.googleapis.com');
}

function isMicrosoftHost(hostname: string): boolean {
  return MICROSOFT_TELEMETRY_HOST_SUFFIXES.some((suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix));
}

function isSupabaseHost(hostname: string): boolean {
  return SUPABASE_TELEMETRY_HOST_SUFFIXES.some((suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix));
}

function extractFetchUrl(input: Parameters<typeof globalThis.fetch>[0]): URL | null {
  try {
    if (input instanceof URL) return input;
    if (typeof input === 'string') return new URL(input);
    if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
    const maybeUrl = (input as { url?: string })?.url;
    if (typeof maybeUrl === 'string') return new URL(maybeUrl);
    return null;
  } catch {
    return null;
  }
}

function extractRequestHostname(
  args: Parameters<typeof http.request> | Parameters<typeof https.request>,
  defaultProtocol: 'http:' | 'https:'
): string | null {
  const firstArg = args[0];
  const secondArg = args[1];

  if (typeof firstArg === 'string' || firstArg instanceof URL) {
    try {
      const parsed = new URL(String(firstArg), `${defaultProtocol}//localhost`);
      if (parsed.hostname) return parsed.hostname;
    } catch {
      // fall through to option parsing
    }
  }

  const optionHost = extractHostFromOptions(firstArg);
  const overrideHost = extractHostFromOptions(secondArg);
  return (overrideHost ?? optionHost)?.toLowerCase() ?? null;
}

function extractHostFromOptions(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const options = value as { hostname?: unknown; host?: unknown };
  const host =
    typeof options.hostname === 'string'
      ? options.hostname
      : typeof options.host === 'string'
        ? options.host
        : null;
  if (!host) return null;
  const [hostname] = host.split(':');
  return hostname || null;
}
