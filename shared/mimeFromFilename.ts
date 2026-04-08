/**
 * Infer MIME type from filename when the browser or cloud storage omits or misreports it.
 */
export function mimeFromFilename(fileName: string): string | null {
  const n = fileName.trim().toLowerCase();
  const dot = n.lastIndexOf('.');
  if (dot < 0 || dot === n.length - 1) return null;
  const ext = n.slice(dot + 1);
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    case 'svg':
      return 'image/svg+xml';
    case 'pdf':
      return 'application/pdf';
    case 'txt':
      return 'text/plain';
    case 'csv':
      return 'text/csv';
    case 'json':
      return 'application/json';
    case 'doc':
      return 'application/msword';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    default:
      return null;
  }
}

export function refineMimeType(mimeType: string, fileName: string): string {
  const m = (mimeType || '').trim();
  if (m && m !== 'application/octet-stream') return m;
  return mimeFromFilename(fileName) || m || 'application/octet-stream';
}
