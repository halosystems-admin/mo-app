export function sanitizeReportDocxFields(fields: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => {
      const clean = String(value ?? '').replace(/\r\n/g, '\n').trim();
      return [key, clean];
    })
  );
}
