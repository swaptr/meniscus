import { PHOTO_MAX_BYTES, PHOTO_MAX_LABEL, type Segmentation } from '@meniscus/shared'
import { ApiError, errorText } from './api.ts'
import { fitWithin } from './capture.ts'
import { meanColour } from './evidence.ts'

/** web/capture "Photos are shrunk before upload": the one message for a photo over the cap, here or at the server. */
export const photoTooLargeMessage = () => `Photo too large · max ${PHOTO_MAX_LABEL}. Retake closer or in better light.`

/** A photo still over `PHOTO_MAX_BYTES` after its one re-encode; nothing was sent. */
export class PhotoTooLargeError extends Error {
  override readonly name = 'PhotoTooLargeError'
  constructor() {
    super(photoTooLargeMessage())
  }
}

/** The JPEG qualities tried, in order: the usual one, then once lower. Never more. */
export const PHOTO_QUALITIES = [0.82, 0.6] as const

/** Pure: the first encode within the cap, trying `PHOTO_QUALITIES` in order; over the cap at both, PhotoTooLargeError. */
export async function encodeWithinCap(encode: (quality: number) => Promise<Blob>, cap = PHOTO_MAX_BYTES): Promise<Blob> {
  for (const q of PHOTO_QUALITIES) {
    const blob = await encode(q)
    if (blob.size <= cap) return blob
  }
  throw new PhotoTooLargeError()
}

/** A photo upload or read refused for its size (413) or as invalid (400 `invalid_request`): the photo message. */
export const isPhotoRefusal = (err: unknown) =>
  err instanceof PhotoTooLargeError ||
  (err instanceof ApiError && (err.status === 413 || (err.status === 400 && err.code === 'invalid_request')))

/** Staff-facing text for a failed photo upload or read. */
export const photoErrorText = (err: unknown) => (isPhotoRefusal(err) ? photoTooLargeMessage() : errorText(err))

/**
 * Browser-only: decode (EXIF orientation applied), scale to ≤ 1280 px, re-encode as JPEG at most `PHOTO_MAX_BYTES`
 * (once more at a lower quality if needed). Throws PhotoTooLargeError, before any request, when it stays over.
 */
export async function shrinkPhoto(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return await encodeWithinCap(() => Promise.resolve(file))
    ctx.drawImage(bitmap, 0, 0, width, height)
    return await encodeWithinCap(
      async (quality) => (await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))) ?? file,
    )
  } finally {
    bitmap.close()
  }
}

/** Browser-only: mean colour of the liquid box's central half, from the same blob the boxes were read on. No network. */
export async function sampleColour(photo: Blob, seg: Segmentation | null): Promise<string | null> {
  if (!seg?.fluid) return null
  const bitmap = await createImageBitmap(photo)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    return meanColour(data, bitmap.width, bitmap.height, seg.fluid)
  } finally {
    bitmap.close()
  }
}

/**
 * Browser-only: a small thumbnail (`width` px wide bitmap, default 144) as an object URL the caller revokes, so a round's
 * list never holds full photos in decoded memory (DESIGN.md 7.4). Falls back to the photo itself if decoding fails.
 */
export async function thumbUrl(file: Blob, width = 144): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file, { resizeWidth: width, resizeQuality: 'medium' })
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    bitmap.close()
    const small = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
    return URL.createObjectURL(small ?? file)
  } catch {
    return URL.createObjectURL(file)
  }
}
