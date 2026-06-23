import test from "node:test";
import assert from "node:assert/strict";
import {
  extractHttpUsageFields,
  extractModelFromGeminiUrl
} from "./extract-http-usage.js";

test("extractModelFromGeminiUrl reads model segment", () => {
  assert.equal(
    extractModelFromGeminiUrl(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent"
    ),
    "gemini-flash-latest"
  );
});

test("extractHttpUsageFields reads gemini usageMetadata", () => {
  const fields = extractHttpUsageFields(
    {
      usageMetadata: {
        promptTokenCount: 1200,
        candidatesTokenCount: 300
      }
    },
    {
      provider: "google_gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent"
    }
  );

  assert.deepEqual(fields, {
    input_tokens: 1200,
    output_tokens: 300,
    model: "gemini-flash-latest"
  });
});
