// Reads barcodes from a photo, entirely on the phone (no image is sent anywhere
// for decoding). The decoder is bundled with the app so it works even if a CDN
// is blocked.
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
});

async function toCanvas(file: Blob, maxSide: number): Promise<HTMLCanvasElement> {
  // imageOrientation honours the phone's rotation flag
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

/** Every distinct barcode found in the photo (several tubes can be in one picture). */
export async function decodePhoto(file: Blob): Promise<string[]> {
  const found = new Set<string>();
  // Try a sharp, fairly large version first; if nothing is found, try the original size.
  for (const side of [2200, 4000]) {
    const c = await toCanvas(file, side);
    const img = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
    const results = await readBarcodes(img, { tryHarder: true, tryRotate: true, maxNumberOfSymbols: 30, formats: [] });
    results.forEach((r) => { const t = r.text.trim(); if (r.isValid && t) found.add(t); });
    if (found.size) break;
  }
  return [...found];
}

/** Smaller JPEG for storage as proof of pickup (keeps labels legible, ~200–400 KB). */
export async function compressPhoto(file: Blob): Promise<Blob> {
  const c = await toCanvas(file, 1600);
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not process the photo"))), "image/jpeg", 0.75));
}

/** Same normalisation as the database: letters and digits only, upper case. */
export const normBarcode = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
