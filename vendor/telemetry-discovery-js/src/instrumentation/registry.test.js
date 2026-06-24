import test from "node:test";
import assert from "node:assert/strict";
import { initTelemetryDiscovery } from "../index.js";

test("initTelemetryDiscovery returns public API", () => {
  const sdk = initTelemetryDiscovery({
    appName: "test-app",
    endpoint: "https://telemetry.example.com",
    token: "test-token",
    instrumentation: {
      http: false,
      providers: false,
      db: false,
      queue: false,
      auth: false,
      filesystem: false,
      process: false
    }
  });

  assert.equal(typeof sdk.track, "function");
  assert.equal(typeof sdk.trackNoteGenerated, "function");
  assert.equal(typeof sdk.trackTranscriptionProcessed, "function");
  assert.equal(typeof sdk.trackMessageSent, "function");
  assert.equal(typeof sdk.createExpressMiddleware, "function");
  assert.equal(typeof sdk.flush, "function");
  assert.equal(typeof sdk.shutdown, "function");
  assert.equal(typeof sdk.getStats, "function");
  assert.equal(sdk.track({ type: "manual" }), true);
});
