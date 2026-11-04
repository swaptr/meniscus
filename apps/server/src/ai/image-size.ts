/**
 * Pixel size from an image's file header (capture/meal-reading "Photo sizes needed to compare"). Pure: reads only the
 * header bytes of a JPEG, PNG, WebP or GIF, with bounds checked at every step, so a truncated file gives null, never a
 * throw. No image library: SAM returns boxes in source pixels but not the frame size.
 */
import type { ImageSize } from '@meniscus/shared'

const sized = (width: number, height: number): ImageSize | null => (width > 0 && height > 0 ? { width, height } : null)
const ascii = (b: Uint8Array, at: number, s: string) => b.length >= at + s.length && [...s].every((c, i) => b[at + i] === c.charCodeAt(0))

function png(b: Uint8Array): ImageSize | null {
  if (b.length < 24 || !ascii(b, 12, 'IHDR')) return null
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  return sized(v.getUint32(16), v.getUint32(20))
}

function gif(b: Uint8Array): ImageSize | null {
  if (b.length < 10 || !ascii(b, 0, 'GIF')) return null
  return sized(b[6]! | (b[7]! << 8), b[8]! | (b[9]! << 8))
}

function webp(b: Uint8Array): ImageSize | null {
  if (b.length < 25 || !ascii(b, 0, 'RIFF') || !ascii(b, 8, 'WEBP')) return null
  if (ascii(b, 12, 'VP8L')) {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24)
    return sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
  }
  if (b.length < 30) return null
  if (ascii(b, 12, 'VP8 ')) return sized((b[26]! | (b[27]! << 8)) & 0x3fff, (b[28]! | (b[29]! << 8)) & 0x3fff)
  if (ascii(b, 12, 'VP8X')) return sized((b[24]! | (b[25]! << 8) | (b[26]! << 16)) + 1, (b[27]! | (b[28]! << 8) | (b[29]! << 16)) + 1)
  return null
}

/** Not frame headers, though in the SOF range: DHT, JPG and DAC. */
const NOT_SOF = new Set([0xc4, 0xc8, 0xcc])

function jpeg(b: Uint8Array): ImageSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]!
    // Fill bytes before a marker.
    if (marker === 0xff) {
      i++
      continue
    }
    if (marker === 0xda || marker === 0xd9) return null
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    const len = (b[i + 2]! << 8) | b[i + 3]!
    if (len < 2 || i + 2 + len > b.length) return null
    if (marker >= 0xc0 && marker <= 0xcf && !NOT_SOF.has(marker)) {
      if (len < 7) return null
      return sized((b[i + 7]! << 8) | b[i + 8]!, (b[i + 5]! << 8) | b[i + 6]!)
    }
    i += 2 + len
  }
  return null
}

/** `{ width, height }` from the header, or null when the header is missing, truncated or of another type. */
export function imageSize(bytes: Uint8Array, mime: string): ImageSize | null {
  switch (mime) {
    case 'image/png':
      return png(bytes)
    case 'image/gif':
      return gif(bytes)
    case 'image/webp':
      return webp(bytes)
    case 'image/jpeg':
      return jpeg(bytes)
    default:
      return null
  }
}
