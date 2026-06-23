import test from "node:test";
import assert from "node:assert/strict";
import { buildTelemetryEvent, sanitizePayload } from "./envelope.js";

test("buildTelemetryEvent adds sdk metadata", () => {
  const event = buildTelemetryEvent("halo-genesis", { type: "test" });
  assert.equal(event.app_name, "halo-genesis");
  assert.equal(event.raw_payload.type, "test");
  assert.equal(typeof event.event_id, "string");
  assert.equal(typeof event.raw_payload.captured_at, "string");
  assert.equal(event.raw_payload.sdk_version, "0.1.0");
});

test("sanitizePayload truncates oversized payloads", () => {
  const large = { blob: "x".repeat(5000) };
  const result = sanitizePayload(large, 100);
  assert.equal(result.truncated, true);
  assert.equal(typeof result.preview, "string");
});
