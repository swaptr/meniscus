/**
 * Photos for peeks and the entry details (web/ward "Entry peek fetches its photo on open", design.md D8): one
 * `GET /api/media/<id>` on the first open, reused while cached (the 24 most recent, object URLs revoked on eviction),
 * aborted when every opener closes before it arrives. A failed answer (a 401 included) is never cached: the 401 locks
 * the screen through the api, and the next open fetches again. Nothing prefetches. DOM-free apart from the injected
 * `toUrl`/`revoke`, so it is tested with a fake fetch.
 */
import type { Entry, MediaRef } from '@meniscus/shared'

export const MEDIA_CACHE_MAX = 24
/** Thumbnails and peek photos are downscaled to this width once. */
export const THUMB_WIDTH = 640

export interface MediaHandle {
  url: Promise<string>
  /** The opener closed. The request is aborted when nobody else waits for it. */
  release: () => void
}

interface Pending {
  ctl: AbortController
  url: Promise<string>
  holders: number
}

export function createMediaCache({
  fetchMedia,
  toUrl,
  revoke,
  max = MEDIA_CACHE_MAX,
}: {
  fetchMedia: (id: number, signal?: AbortSignal) => Promise<Blob>
  toUrl: (blob: Blob) => Promise<string>
  revoke: (url: string) => void
  max?: number
}) {
  const ready = new Map<number, string>()
  const inflight = new Map<number, Pending>()

  const remember = (id: number, url: string) => {
    ready.delete(id)
    ready.set(id, url)
    while (ready.size > max) {
      const [oldest, old] = ready.entries().next().value as [number, string]
      ready.delete(oldest)
      revoke(old)
    }
  }

  return {
    has: (id: number) => ready.has(id),
    /** The cached URL, touching it as most recent; undefined when not cached. */
    get(id: number): string | undefined {
      const url = ready.get(id)
      if (url !== undefined) remember(id, url)
      return url
    },
    acquire(id: number): MediaHandle {
      const hit = ready.get(id)
      if (hit !== undefined) {
        remember(id, hit)
        return { url: Promise.resolve(hit), release: () => {} }
      }
      let p = inflight.get(id)
      if (!p) {
        const ctl = new AbortController()
        // Only this request's own entry: after a close and a quick reopen, the map holds the reopened one.
        const settle = () => {
          if (inflight.get(id) === entry) inflight.delete(id)
        }
        const url = fetchMedia(id, ctl.signal)
          .then(toUrl)
          .then((u) => {
            settle()
            if (ctl.signal.aborted) {
              revoke(u)
              throw new DOMException('aborted', 'AbortError')
            }
            remember(id, u)
            return u
          })
          .catch((err: unknown) => {
            settle()
            throw err
          })
        const entry: Pending = { ctl, url, holders: 0 }
        p = entry
        inflight.set(id, p)
      }
      const pending = p
      pending.holders++
      let released = false
      return {
        url: pending.url,
        release: () => {
          if (released) return
          released = true
          pending.holders--
          if (pending.holders === 0 && inflight.get(id) === pending) {
            inflight.delete(id)
            pending.ctl.abort()
          }
        },
      }
    },
    /** Route unmount: revoke everything. */
    clear() {
      for (const p of inflight.values()) p.ctl.abort()
      inflight.clear()
      for (const u of ready.values()) revoke(u)
      ready.clear()
    },
  }
}

export type MediaCache = ReturnType<typeof createMediaCache>

/** The photo an entry peek shows: the entry's own photo, or a level drop's later reading's. Null for notes and voice. */
export function photoMediaId(e: Pick<Entry, 'media' | 'levels'>): number | null {
  if (e.media?.kind === 'photo') return e.media.id
  const after = e.levels?.after.media
  return after?.kind === 'photo' ? after.id : null
}

/** The labeled copy kept with the photo `photoMediaId` names (the entry's, or a level drop's later reading's); null when none. */
export function photoLabeled(e: Pick<Entry, 'media' | 'levels'> & { labeled_media?: MediaRef | null }): MediaRef | null {
  if (e.media?.kind === 'photo') return e.labeled_media ?? null
  return e.levels?.after.media?.kind === 'photo' ? (e.levels.after.labeled_media ?? null) : null
}

/**
 * The original pixel size of each downscaled photo, by its object URL: segmentation boxes and masks are in the
 * original's pixels, so an overlay drawn over the smaller copy scales them by this size, not the copy's.
 */
const originals = new Map<string, { w: number; h: number }>()
export const originalSize = (url: string): { w: number; h: number } | undefined => originals.get(url)
export const forgetOriginal = (url: string): void => void originals.delete(url)

/**
 * Browser: downscale once to THUMB_WIDTH wide (sharp at a peek's width on a 2x screen) and keep it as an object URL,
 * remembering the original's size for overlays.
 */
export async function thumbUrl(blob: Blob): Promise<string> {
  try {
    const full = await createImageBitmap(blob)
    const w = Math.min(THUMB_WIDTH, full.width)
    const bitmap = await createImageBitmap(full, {
      resizeWidth: w,
      resizeHeight: Math.round((full.height * w) / full.width),
      resizeQuality: 'high',
    })
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    bitmap.close()
    const url = URL.createObjectURL(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.86 }))
    originals.set(url, { w: full.width, h: full.height })
    full.close()
    return url
  } catch {
    return URL.createObjectURL(blob)
  }
}
