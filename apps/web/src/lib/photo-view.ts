/**
 * `Labeled | Raw` on a kept photo (web/ward "Raw and labeled views of a kept photo"), DOM-free: which media a view
 * fetches, whether the live overlay is drawn over it, and the line under it. No requests; the view fetches its one
 * `GET /api/media/<id>` through the media cache when first shown.
 */
import type { MediaRef } from '@meniscus/shared'
import { fingerprint } from './tray.ts'

export type PhotoMode = 'labeled' | 'raw'
export const PHOTO_MODES: readonly (readonly [PhotoMode, string])[] = [
  ['labeled', 'Labeled'],
  ['raw', 'Raw'],
]

export const COPY_DRAWN_LINE = 'Labeled copy not kept · drawn from the read'
export const NO_COPY_LINE = 'No labeled copy · Spark-only read, no regions'

export interface PhotoShown {
  /** The media to fetch and show. */
  media_id: number
  /** Draw the live overlay over it (a segmented photo with no kept copy, in Labeled). */
  overlay: boolean
  /** Under the photo in Labeled: the copy's fingerprint, or why the copy is drawn live or missing. Null in Raw. */
  line: { text: string; title?: string } | null
  /** Showing the stored labeled copy. */
  copy: boolean
}

/** What a kept photo shows in `mode`: the copy, else the live overlay, else the photo with the placeholder line. */
export function photoShown(o: {
  media_id: number
  labeled: Pick<MediaRef, 'id' | 'sha256'> | null | undefined
  segmented: boolean
  mode: PhotoMode
}): PhotoShown {
  if (o.mode === 'raw') return { media_id: o.media_id, overlay: false, line: null, copy: false }
  if (o.labeled) {
    const f = fingerprint(o.labeled.sha256)
    return {
      media_id: o.labeled.id,
      overlay: false,
      line: { text: `Labeled copy fingerprint: ${f ?? 'not recorded'}`, ...(o.labeled.sha256 && { title: o.labeled.sha256 }) },
      copy: true,
    }
  }
  return { media_id: o.media_id, overlay: o.segmented, line: { text: o.segmented ? COPY_DRAWN_LINE : NO_COPY_LINE }, copy: false }
}

/** The id a photo thumbnail fetches: the labeled copy when one was kept, else the photo. */
export const thumbMediaId = (mediaId: number | null, labeled: Pick<MediaRef, 'id'> | null | undefined): number | null =>
  mediaId === null ? null : (labeled?.id ?? mediaId)

/** The reveal key of what is shown: only the live overlay traces in on its first show; a stored copy never animates. */
export const revealKey = (shown: PhotoShown): string | null => (shown.overlay ? `media:${shown.media_id}` : null)
