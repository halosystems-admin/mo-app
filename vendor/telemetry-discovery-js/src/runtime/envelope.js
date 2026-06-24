import crypto from "node:crypto";
import { SDK_VERSION } from "./constants.js";

export function sanitizePayload(rawPayload, maxPayloadBytes) {
  const base = rawPayload && typeof rawPayload === "object" ? rawPayload : { value: rawPayload };
  const json = JSON.stringify(base);
  const byteLength = Buffer.byteLength(json, "utf8");

  if (byteLength <= maxPayloadBytes) {
    return base;
  }

  return {
    truncated: true,
    original_size_bytes: byteLength,
    preview: json.slice(0, Math.max(0, maxPayloadBytes))
  };
}

export function sampleDrop(payload, sampleSuccessRate) {
  if (sampleSuccessRate >= 1) {
    return false;
  }

  const success = payload && typeof payload === "object" && payload.success === true;
  return success && Math.random() > sampleSuccessRate;
}

export function buildTelemetryEvent(appName, rawPayload) {
  return {
    event_id: crypto.randomUUID(),
    app_name: appName,
    raw_payload: {
      ...rawPayload,
      sdk_version: SDK_VERSION,
      captured_at: new Date().toISOString()
    }
  };
}
