/**
 * `media:sweep` (server/storage "Orphaned objects swept"): lists the bucket and counts the objects no media row names
 * that are over an hour old. With `delete`, just before each delete it re-checks the row and re-reads the object's age
 * (1 HEAD + 1 DELETE per orphan, sequential, never retried), so an object re-uploaded meanwhile is kept. It prints
 * counts only, never keys or hashes.
 */
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { media as mediaRow } from '../db/schema.ts'
import { timedMedia, type MediaLog } from '../media-gc.ts'
import type { MediaStore } from '../store/media/port.ts'
import type { Store } from '../store/port.ts'

/** An upload between its PUT and its row is this young at most; younger objects are never swept. */
export const SWEEP_GRACE_MS = 3_600_000

/**
 * The sweep's view of the chart: whether a media row names the hash, read straight from `meniscus.media` (no store open,
 * so no seed, no expiry and no write; it can run beside the live server).
 */
export const mediaShas = (db: Db): Pick<Store, 'hasMediaSha'> => ({
  hasMediaSha: async (sha256) =>
    (await db.select({ id: mediaRow.id }).from(mediaRow).where(eq(mediaRow.sha256, sha256)).limit(1)).length > 0,
})

export interface SweepOptions {
  store: Pick<Store, 'hasMediaSha'>
  media: MediaStore
  /** Delete the orphans (default: count them only). */
  delete?: boolean
  now?: () => number
  log?: MediaLog
  /** Tests: runs after the listing, just before a candidate's re-check. */
  beforeRecheck?: (sha256: string) => void | Promise<void>
}

export interface SweepResult {
  /** Objects listed. */
  total: number
  /** Listed objects no row named, older than the grace. */
  orphans: number
  deleted: number
  /** HEAD or DELETE requests that failed; their objects wait for the next run. */
  failed: number
  /** The line to print. */
  line: string
}

export async function sweepMedia(o: SweepOptions): Promise<SweepResult> {
  const now = o.now ?? Date.now
  const old = (lastModified: number) => now() - lastModified > SWEEP_GRACE_MS
  let total = 0
  const candidates: string[] = []
  for await (const obj of o.media.list()) {
    total++
    if (old(obj.lastModified) && !(await o.store.hasMediaSha(obj.sha256))) candidates.push(obj.sha256)
  }
  let deleted = 0
  let failed = 0
  if (o.delete) {
    for (const sha of candidates) {
      await o.beforeRecheck?.(sha)
      if (await o.store.hasMediaSha(sha)) continue
      try {
        const head = await timedMedia(() => o.media.head(sha), undefined, o.log)
        if (!head || !old(head.lastModified) || (await o.store.hasMediaSha(sha))) continue
        // Unconditional: Supabase documents no conditional DeleteObject, so a re-upload between this HEAD and the DELETE
        // is a residual race (design §4 "Residual race"), kept rare by the 1 h grace.
        await timedMedia(() => o.media.delete(sha), undefined, o.log)
        deleted++
      } catch {
        failed++
      }
    }
  }
  const line = o.delete
    ? `deleted ${deleted} of ${total}${failed ? ` (${failed} failed)` : ''}`
    : `orphans ${candidates.length} of ${total}`
  return { total, orphans: candidates.length, deleted, failed, line }
}
