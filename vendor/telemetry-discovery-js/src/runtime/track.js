import { buildTelemetryEvent, sampleDrop, sanitizePayload } from "./envelope.js";

export function trackRawEvent(state, rawPayload, options = {}) {
  const payload = sanitizePayload(rawPayload, state.config.performance.maxPayloadBytes);
  const shouldSample =
    options.forceKeep !== true && sampleDrop(payload, state.config.performance.sampleSuccessRate);

  if (shouldSample) {
    return false;
  }

  const event = buildTelemetryEvent(state.config.appName, payload);
  state.sender.enqueue(event);
  return true;
}
