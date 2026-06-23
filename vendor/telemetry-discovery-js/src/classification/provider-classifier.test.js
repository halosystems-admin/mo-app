import test from "node:test";
import assert from "node:assert/strict";
import { classifyProvider, isTelemetryEndpointCall } from "./provider-classifier.js";

test("classifyProvider maps known hosts", () => {
  assert.deepEqual(classifyProvider("https://api.openai.com/v1/chat/completions"), {
    provider: "openai",
    operation: "request"
  });
  assert.deepEqual(classifyProvider("https://api.twilio.com/2010-04-01/Accounts"), {
    provider: "twilio",
    operation: "request"
  });
  assert.deepEqual(classifyProvider("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"), {
    provider: "google_drive_api",
    operation: "request"
  });
  assert.deepEqual(classifyProvider("https://www.googleapis.com/oauth2/v2/userinfo"), {
    provider: "google_oauth",
    operation: "request"
  });
});

test("isTelemetryEndpointCall ignores ingest traffic", () => {
  const state = { config: { endpoint: "https://telemetry.example.com" } };
  assert.equal(isTelemetryEndpointCall(state, "https://telemetry.example.com/v1/events/batch"), true);
  assert.equal(isTelemetryEndpointCall(state, "https://api.openai.com/v1/models"), false);
});
