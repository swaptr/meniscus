/**
 * Browser-only QR decoding of a photo, on the phone. Uses the built-in BarcodeDetector
 * (Chrome/Android) and falls back to jsqr (Safari/iOS), loaded only when needed.
 */
const MAX_SIDE = 1024

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]>
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike

/** QR text in the photo, or null when there is none. */
export async function decodeQr(photo: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(photo)
  try {
    const Native = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
    if (Native) {
      try {
        const found = await new Native({ formats: ['qr_code'] }).detect(bitmap)
        return found[0]?.rawValue ?? null
      } catch {
        // Unsupported format on this device: fall through to jsqr.
      }
    }
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, w, h)
    const { default: jsQR } = await import('jsqr')
    return jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null
  } finally {
    bitmap.close()
  }
}
