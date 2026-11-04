/** Kept media: one upload per captured photo or recording, shared by every record saved from it. No model requests. */
import type { DrinkKind, MediaRef, PhotoEvidence, SourceKind } from '@meniscus/shared'
import type { Api } from './api.ts'
import { renderLabeledCopy, wantsCopy, type CopySubject } from './labeled-copy.ts'
import { SOURCES } from './sources.ts'

/** What a record was captured from, as held in memory until it is saved. */
export interface MediaSource {
  kind: SourceKind
  blob: Blob
  /** Recordings: length in ms (display only). */
  duration_ms?: number | null
}

// Per api, then per blob: the drafts of one voice note share one upload, and a failure is not retried for that blob.
const uploads = new WeakMap<Api, WeakMap<Blob, Promise<MediaRef | null>>>()

/** Uploads the blob the first time it is asked for; later calls get the same result. A failed upload resolves to null. */
export function uploadOnce(
  api: Api,
  admissionId: number,
  kind: SourceKind,
  blob: Blob,
  durationMs?: number | null,
): Promise<MediaRef | null> {
  let byBlob = uploads.get(api)
  if (!byBlob) uploads.set(api, (byBlob = new WeakMap()))
  let upload = byBlob.get(blob)
  if (!upload) {
    upload = api.uploadMedia(admissionId, kind, blob, durationMs).catch(() => null)
    byBlob.set(blob, upload)
  }
  return upload
}

/** "Saved, but the recording was not kept." */
export const notKept = (kind: SourceKind) => `Saved, but the ${SOURCES[kind].noun} was not kept.`

/** The save result's line when the photo was kept but its labeled copy was not (web/capture "Labeled copy drawn at the bed"). */
export const COPY_NOT_KEPT = 'Labeled copy not kept'

/** Draws the copy (browser canvas). Swappable so DOM-free tests can count the requests. */
export const copyRenderer: { draw: (photo: Blob, subject: CopySubject) => Promise<Blob> } = { draw: renderLabeledCopy }

// Per api, then per raw blob: a copy is drawn and uploaded once; a failure is never retried, and a retried save reuses it.
const copies = new WeakMap<Api, WeakMap<Blob, Promise<MediaRef | null>>>()

function copyOnce(api: Api, admissionId: number, photo: Blob, subject: CopySubject): Promise<MediaRef | null> {
  let byBlob = copies.get(api)
  if (!byBlob) copies.set(api, (byBlob = new WeakMap()))
  let upload = byBlob.get(photo)
  if (!upload) {
    upload = (async () => api.uploadMedia(admissionId, 'photo', await copyRenderer.draw(photo, subject)))().catch(() => null)
    byBlob.set(photo, upload)
  }
  return upload
}

export interface LinkedMedia {
  media_id?: number
  labeled_media_id?: number
  warning?: string
}

/**
 * The `media_id` to post with a record, and for a segmented photo read (`copy`) the `labeled_media_id` of its labeled
 * copy, drawn and uploaded after the photo. A failed photo upload sends no copy; a failed copy only warns. Nothing
 * without a source.
 */
export async function linkMedia(
  api: Api,
  admissionId: number,
  source: MediaSource | undefined,
  copy?: CopySubject | null,
): Promise<LinkedMedia> {
  if (!source) return {}
  const m = await uploadOnce(api, admissionId, source.kind, source.blob, source.duration_ms)
  if (!m) return { warning: notKept(source.kind) }
  if (source.kind !== 'photo' || !wantsCopy(copy)) return { media_id: m.id }
  const c = await copyOnce(api, admissionId, source.blob, copy)
  return c ? { media_id: m.id, labeled_media_id: c.id } : { media_id: m.id, warning: COPY_NOT_KEPT }
}

/** The copy subject of a photo entry's or level's evidence. */
export const photoCopy = (evidence: { kind?: string } | null | undefined, drink?: DrinkKind | null): CopySubject | null =>
  evidence && evidence.kind === 'photo' ? { kind: 'photo', evidence: evidence as PhotoEvidence, drink: drink ?? null } : null
