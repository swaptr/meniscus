import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { createMediaCache, forgetOriginal, thumbUrl } from './media-cache.ts'

/** The app's one photo cache, shared by entry peeks, the photo strip and the entry details (design.md D8). */
export const mediaCache = createMediaCache({
  fetchMedia: api.media,
  toUrl: thumbUrl,
  revoke: (u) => {
    URL.revokeObjectURL(u)
    forgetOriginal(u)
  },
})

export type MediaState = { status: 'none' } | { status: 'loading' } | { status: 'ready'; url: string } | { status: 'failed' }

/**
 * A photo while the component that asks for it is mounted (a peek renders its content only while open): one
 * `GET /api/media/<id>` on the first open, then the cached URL; unmounting before it arrives aborts it. Null: nothing.
 */
export function useMediaUrl(id: number | null): MediaState {
  const [state, setState] = useState<{ id: number | null; s: MediaState }>(() => ({
    id,
    s: id === null ? { status: 'none' } : cachedOrLoading(id),
  }))
  useEffect(() => {
    if (id === null) return
    const h = mediaCache.acquire(id)
    let live = true
    h.url.then(
      (url) => live && setState({ id, s: { status: 'ready', url } }),
      (err: unknown) => live && !(err instanceof DOMException && err.name === 'AbortError') && setState({ id, s: { status: 'failed' } }),
    )
    return () => {
      live = false
      h.release()
    }
  }, [id])
  if (state.id !== id) return id === null ? { status: 'none' } : cachedOrLoading(id)
  return state.s
}

function cachedOrLoading(id: number): MediaState {
  const url = mediaCache.get(id)
  return url === undefined ? { status: 'loading' } : { status: 'ready', url }
}
