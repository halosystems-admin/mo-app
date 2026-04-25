/** Lets the mobile FAB call the same opener as InpatientDetailPanel → SheetsDictateModal. */
let openSheetsDictate: (() => void) | null = null;

export function registerSheetsDictateOpener(fn: () => void): () => void {
  openSheetsDictate = fn;
  return () => {
    openSheetsDictate = null;
  };
}

export function requestOpenSheetsDictate(): void {
  openSheetsDictate?.();
}
