import test from "node:test";
import assert from "node:assert/strict";
import {
  messageSentPayload,
  noteGeneratedPayload,
  transcriptionProcessedPayload
} from "./activity.js";

test("activity payloads match server allowlist shapes", () => {
  assert.deepEqual(noteGeneratedPayload(), { type: "note.generated" });
  assert.deepEqual(transcriptionProcessedPayload(2.5), {
    type: "transcription.processed",
    audio_minutes: 2.5
  });
  assert.deepEqual(messageSentPayload(), { type: "message.sent", billable: true });
  assert.deepEqual(messageSentPayload({ billable: false }), {
    type: "message.sent",
    billable: false
  });
});

test("transcriptionProcessedPayload rejects invalid audio minutes", () => {
  assert.throws(() => transcriptionProcessedPayload("2"), /audioMinutes/);
});
