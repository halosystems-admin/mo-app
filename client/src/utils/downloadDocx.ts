/** Trigger a browser download of a base64-encoded DOCX file. */
export function downloadDocxFromBase64(base64: string, fileName: string): void {
  const clean = base64.includes(',') ? base64.split(',')[1]! : base64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob(
    [bytes],
    { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName.endsWith('.docx') ? fileName : `${fileName}.docx`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
