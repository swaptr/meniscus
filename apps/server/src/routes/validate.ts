import { zValidator as zv } from '@hono/zod-validator'
import { z } from 'zod'
import { PHOTO_MAX_BYTES, PHOTO_MAX_LABEL, type SourceKind } from '@meniscus/shared'
import { matchesSignature } from '../security.ts'

/** zod validation at the route; failures are 400 `invalid_request` with the issue paths and messages. */
export const validate = <T extends z.ZodType, K extends 'form' | 'json' | 'param' | 'query'>(target: K, schema: T) =>
  zv(target, schema, (r, c) => {
    if (!r.success) {
      const issues = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      return c.json({ error: 'invalid_request', issues }, 400)
    }
    return undefined
  })

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
export const MAX_IMAGE = PHOTO_MAX_BYTES

/** Image upload: size, declared type, and bytes that match the type's file signature. */
export const ImageFile = z
  .instanceof(File)
  .refine((f) => f.size > 0 && f.size <= MAX_IMAGE, `image must be 1 B – ${PHOTO_MAX_LABEL}`)
  .refine((f) => (IMAGE_TYPES as readonly string[]).includes(f.type), `image must be one of ${IMAGE_TYPES.join(', ')}`)
  .refine(
    async (f) => matchesSignature(f.type, new Uint8Array(await f.slice(0, 12).arrayBuffer())),
    'image content does not match its type',
  )

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to))

/** ISO-BMFF major brands a recording plausibly has; image (HEIC, AVIF) and QuickTime brands are not audio. */
const AUDIO_MP4_BRANDS = new Set(['M4A ', 'M4B ', 'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'dash'])

/** File signatures per media kind, in the order tried. Adding a kind (video) adds its list here. */
const SIGNATURES: Record<SourceKind, [mime: string, matches: (head: Uint8Array) => boolean][]> = {
  photo: IMAGE_TYPES.map((t) => [t, (b: Uint8Array) => matchesSignature(t, b)]),
  voice: [
    ['audio/webm', (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3],
    ['audio/ogg', (b) => ascii(b, 0, 4) === 'OggS'],
    ['audio/mp4', (b) => ascii(b, 4, 8) === 'ftyp' && AUDIO_MP4_BRANDS.has(ascii(b, 8, 12))],
    ['audio/wav', (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WAVE'],
    ['audio/mpeg', (b) => ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)],
  ],
}

/** The MIME type of `kind` that the bytes start with, or null when they match none. */
export function sniff(kind: SourceKind, head: Uint8Array): string | null {
  return SIGNATURES[kind].find(([, matches]) => matches(head))?.[0] ?? null
}
