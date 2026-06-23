import { sanitizePayload } from "../runtime/envelope.js";

export function stringifyArg(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function extractPgQueryText(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    if (typeof value.text === "string") {
      return value.text;
    }
    if (typeof value.name === "string") {
      return value.name;
    }
  }
  return "unknown_query";
}

export function pushChunk(chunks, chunk, encoding, maxBodyBytes) {
  if (!chunks) {
    return;
  }
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk ?? "", encoding);
  const currentSize = chunks.reduce((acc, cur) => acc + cur.length, 0);
  if (currentSize >= maxBodyBytes) {
    return;
  }
  const remaining = maxBodyBytes - currentSize;
  chunks.push(buffer.subarray(0, remaining));
}

export function captureJsonSafe(value, maxBodyBytes) {
  try {
    return sanitizePayload(value, maxBodyBytes);
  } catch {
    return { unserializable: true };
  }
}

export function captureBufferSafe(buffer, maxBodyBytes) {
  if (!buffer || buffer.length === 0) {
    return undefined;
  }
  if (buffer.length <= maxBodyBytes) {
    return buffer.toString("utf8");
  }
  return {
    truncated: true,
    original_size_bytes: buffer.length,
    preview: buffer.subarray(0, maxBodyBytes).toString("utf8")
  };
}
