// Client-side image compression for Snap-a-Deal uploads.
//
// Re-encoding through a canvas does two jobs at once: it shrinks a multi-MB
// phone photo to a few hundred KB (R2 storage + vision-model token cost), and
// it strips ALL metadata — including any EXIF GPS coordinates the camera
// embedded — before the image ever leaves the device. Location is only ever
// sent when the admin explicitly taps "Use my location".

/** Long-edge cap. ~1500px is the vision model's sweet spot — larger costs more tokens without reading better. */
const MAX_EDGE_PX = 1568;
const QUALITY = 0.8;

export interface CompressedImage {
  blob: Blob;
  mediaType: "image/jpeg" | "image/webp";
  width: number;
  height: number;
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      // e.g. unsupported format for createImageBitmap — fall through
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("could not decode image"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function compressImage(file: File): Promise<CompressedImage> {
  const source = await loadBitmap(file);
  const srcW = "naturalWidth" in source ? source.naturalWidth : source.width;
  const srcH = "naturalHeight" in source ? source.naturalHeight : source.height;
  if (!srcW || !srcH) throw new Error("could not read image dimensions");

  const scale = Math.min(1, MAX_EDGE_PX / Math.max(srcW, srcH));
  const width = Math.round(srcW * scale);
  const height = Math.round(srcH * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(source, 0, 0, width, height);
  if ("close" in source) source.close();

  // WebP compresses better; Safari < 16 can't encode it, so fall back to JPEG.
  let blob = await toBlob(canvas, "image/webp", QUALITY);
  let mediaType: CompressedImage["mediaType"] = "image/webp";
  if (!blob || blob.type !== "image/webp") {
    blob = await toBlob(canvas, "image/jpeg", QUALITY);
    mediaType = "image/jpeg";
  }
  if (!blob) throw new Error("image encoding failed");
  return { blob, mediaType, width, height };
}

/** Base64-encode a Blob (no data: prefix) for the JSON upload body. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("could not read image data"));
    reader.readAsDataURL(blob);
  });
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}
