/**
 * Media bytes at the routes (charting/media): written to the media store after every check that can refuse the upload
 * and before the row commits, under the hash's lock; streamed from it on read. A failed store request propagates as
 * MediaStoreError, which the app answers 503 `media_unavailable` (no retry).
 */
import { sha256Hex } from '../hash.ts'
import { timedMedia, type MediaGc, type MediaLog } from '../media-gc.ts'
import type { MediaStore } from '../store/media/port.ts'
import type { Store } from '../store/port.ts'

export interface MediaIo {
  /** Holds the hash's advisory lock (`store.withShaLock`) across PUT and the row's insert. */
  store: Pick<Store, 'withShaLock'>
  media: MediaStore
  gc: MediaGc
  log?: MediaLog
}

/**
 * PUT, then `insert` (the row, whose transaction re-checks the chart), both under the hash's lock, in one transaction:
 * `insert` must write through the store it is given. When the insert refuses after all (the chart changed since the
 * route's checks), the object is deleted unless another row names it.
 */
export async function storeBytes<T>(
  io: MediaIo,
  bytes: Uint8Array,
  mime: string,
  insert: (sha256: string, size: number, t: Store) => Promise<T>,
  stored: (r: T) => boolean,
): Promise<T> {
  const sha256 = sha256Hex(bytes)
  const r = await io.store.withShaLock(sha256, async (t) => {
    await timedMedia(() => io.media.put(sha256, bytes, mime), undefined, io.log)
    return insert(sha256, bytes.byteLength, t)
  })
  if (!stored(r)) await io.gc.collect([sha256])
  return r
}

/** The stored bytes, streamed, with their type and length; the headers wait only for the store's response headers. */
export async function serveBytes(io: MediaIo, ref: { id: number; mime: string; size: number; sha256: string | null }) {
  const obj = await timedMedia(() => io.media.get(ref.sha256 ?? ''), ref.id, io.log)
  return new Response(obj.body, {
    status: 200,
    headers: { 'Content-Type': ref.mime, 'Content-Length': String(ref.size), 'Cache-Control': 'no-store' },
  })
}

/** The whole object in memory (the served tray photo a meal read compares against). */
export async function readBytes(io: MediaIo, ref: { id: number; sha256: string | null }): Promise<Uint8Array> {
  return timedMedia(
    async () => new Uint8Array(await new Response((await io.media.get(ref.sha256 ?? '')).body).arrayBuffer()),
    ref.id,
    io.log,
  )
}
