import { stripBase64DataUrl } from './gemini';

/**
 * Detect real image format from magic bytes. Fixes mis-tagged uploads (e.g. JPEG bytes with image/png).
 * Wrong mimeType breaks Gemini vision inline data handling.
 */
export function sniffImageMimeType(buffer: Buffer): string | null {
  if (!buffer || buffer.length < 12) return null;
  const b0 = buffer[0];
  const b1 = buffer[1];
  const b2 = buffer[2];
  const b3 = buffer[3];

  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return 'image/jpeg';
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return 'image/png';
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46 && b3 === 0x38) return 'image/gif';
  if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46) {
    const head = buffer.subarray(0, 16).toString('ascii');
    if (head.includes('WEBP')) return 'image/webp';
  }
  if (b0 === 0x42 && b1 === 0x4d) return 'image/bmp';
  return null;
}

export function resolveVisionMimeType(base64: string, declaredMime: string): { mime: string; sniffed: boolean } {
  const raw = stripBase64DataUrl(base64);
  if (!raw) return { mime: declaredMime, sniffed: false };
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, 'base64');
  } catch {
    return { mime: declaredMime, sniffed: false };
  }
  const declared = declaredMime.split(';')[0].trim().toLowerCase() || 'image/jpeg';
  const s = sniffImageMimeType(buf);
  if (s) return { mime: s, sniffed: s !== declared };
  return { mime: declared, sniffed: false };
}
