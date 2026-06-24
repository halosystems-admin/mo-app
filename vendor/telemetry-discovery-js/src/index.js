import {
  messageSentPayload,
  noteGeneratedPayload,
  transcriptionProcessedPayload
} from "./activity.js";
import { resolveConfig } from "./runtime/config.js";
import { bindProcessLifecycleFlush } from "./runtime/lifecycle.js";
import { BufferedSender } from "./runtime/sender.js";
import { trackRawEvent } from "./runtime/track.js";
import { applyInstrumentation, createExpressTelemetryMiddleware } from "./instrumentation/registry.js";

export {
  messageSentPayload,
  noteGeneratedPayload,
  transcriptionProcessedPayload
} from "./activity.js";

export function initTelemetryDiscovery(config) {
  const resolved = resolveConfig(config);
  const sender = new BufferedSender(resolved);
  const state = {
    config: resolved,
    sender,
    stopFns: []
  };

  applyInstrumentation(state);
  bindProcessLifecycleFlush(state);

  return {
    track: (rawPayload) => trackRawEvent(state, rawPayload),
    trackNoteGenerated: () => trackRawEvent(state, noteGeneratedPayload()),
    trackTranscriptionProcessed: (audioMinutes) =>
      trackRawEvent(state, transcriptionProcessedPayload(audioMinutes), { forceKeep: true }),
    trackMessageSent: (options) => trackRawEvent(state, messageSentPayload(options)),
    createExpressMiddleware: (options = {}) => createExpressTelemetryMiddleware(state, options),
    flush: () => sender.flush(),
    shutdown: () => {
      for (const stop of state.stopFns) {
        try {
          stop();
        } catch {
          // noop
        }
      }
      return sender.flush();
    },
    getStats: () => ({ ...sender.stats })
  };
}
