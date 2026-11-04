/**
 * Objects go with their last media row (charting/media). The store reports, after each COMMIT, the hashes of the media
 * rows it deleted; inside a request they are collected and, once the handler is done and before the response is sent,
 * each object no row names any more is deleted: one DELETE per object, under the hash's lock, never retried. A failed
 * delete is logged and swallowed (the record's change stands; `media:sweep` finds the object later).
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { MiddlewareHandler } from 'hono'
import { MediaStoreError, type MediaStore } from './store/media/port.ts'
import type { Store } from './store/port.ts'

export type MediaLog = (line: string) => void
const defaultLog: MediaLog = (line) => console.error(line)

/** One media store request, timed; a failure logs `media <op> <status> <ms>ms[ media=<id>]` (never a key or hash). */
export async function timedMedia<T>(fn: () => Promise<T>, mediaId?: number, log: MediaLog = defaultLog): Promise<T> {
  const t0 = performance.now()
  try {
    return await fn()
  } catch (err) {
    const ms = Math.round(performance.now() - t0)
    const op = err instanceof MediaStoreError ? `${err.op} ${err.status}` : `error ${err instanceof Error ? err.name : typeof err}`
    log(`media ${op} ${ms}ms${mediaId === undefined ? '' : ` media=${mediaId}`}`)
    throw err
  }
}

export interface MediaGc {
  /** The store's listener (`watchMediaGone`). */
  onMediaGone: (shas: string[]) => void
  /** Collects this request's hashes and deletes their objects after the handler. */
  middleware: MiddlewareHandler
  /** Deletes the objects of these hashes no row names; awaited. Failures are logged and swallowed. */
  collect: (shas: Iterable<string>) => Promise<void>
  /** Settles once deletes started outside a request (a script, a test calling the store) are done. */
  idle: () => Promise<void>
}

export function createMediaGc(store: Pick<Store, 'withShaLock'>, media: MediaStore, log: MediaLog = defaultLog): MediaGc {
  const request = new AsyncLocalStorage<Set<string>>()
  let background: Promise<void> = Promise.resolve()
  const collect = async (shas: Iterable<string>) => {
    for (const sha of new Set(shas)) {
      await store
        .withShaLock(sha, async (t) => {
          if (await t.hasMediaSha(sha)) return
          await timedMedia(() => media.delete(sha), undefined, log)
        })
        .catch(() => {})
    }
  }
  return {
    onMediaGone: (shas) => {
      const set = request.getStore()
      if (set) for (const s of shas) set.add(s)
      else background = background.then(() => collect(shas))
    },
    middleware: async (_c, next) => {
      const set = new Set<string>()
      try {
        await request.run(set, next)
      } finally {
        if (set.size) await collect(set)
      }
    },
    collect,
    idle: () => background,
  }
}
