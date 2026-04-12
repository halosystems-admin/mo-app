/** Cached fetch of official letterhead PNG from /public for jsPDF exports. */

let cache: Promise<{ dataUrl: string; w: number; h: number } | null> | null = null;

export function loadDrPatelLetterheadImage(): Promise<{ dataUrl: string; w: number; h: number } | null> {
  if (!cache) {
    cache = (async () => {
      try {
        const res = await fetch('/dr-mohamed-patel-letterhead.png');
        if (!res.ok) return null;
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result as string);
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        });
        const bmp = await createImageBitmap(blob);
        const out = { dataUrl, w: bmp.width, h: bmp.height };
        bmp.close();
        return out;
      } catch {
        return null;
      }
    })();
  }
  return cache;
}
