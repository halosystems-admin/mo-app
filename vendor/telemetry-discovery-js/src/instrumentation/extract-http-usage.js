import { extractTokenUsage } from "./observe.js";

export function extractModelFromGeminiUrl(url) {
  const match = String(url || "").match(/\/models\/([^/:]+)/i);
  return match?.[1] ?? null;
}

export async function tryReadJsonResponseBody(response) {
  if (!response) {
    return null;
  }

  try {
    const headers = response.headers;
    const contentType =
      (typeof headers?.get === "function" ? headers.get("content-type") : headers?.["content-type"]) ?? "";
    if (!String(contentType).toLowerCase().includes("json")) {
      return null;
    }

    if (response.data !== undefined && response.data !== null) {
      return response.data;
    }

    if (typeof response.clone === "function" && typeof response.json === "function") {
      return await response.clone().json();
    }

    return null;
  } catch {
    return null;
  }
}

export function extractHttpUsageFields(responseBody, { provider, url }) {
  if (!responseBody || typeof responseBody !== "object") {
    return {};
  }

  const tokenFields = extractTokenUsage(
    responseBody.usage || responseBody.usageMetadata
      ? { usage: responseBody.usage ?? responseBody.usageMetadata }
      : responseBody
  );
  const normalizedProvider = String(provider || "").toLowerCase();
  const model =
    normalizedProvider === "google_gemini" || normalizedProvider === "google_generative_ai"
      ? extractModelFromGeminiUrl(url)
      : null;

  const fields = {};
  if (typeof tokenFields.input_tokens === "number") {
    fields.input_tokens = tokenFields.input_tokens;
  }
  if (typeof tokenFields.output_tokens === "number") {
    fields.output_tokens = tokenFields.output_tokens;
  }
  if (model) {
    fields.model = model;
  }

  return fields;
}
