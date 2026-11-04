/**
 * What every area module of the Postgres store shares: the database (or the transaction it runs in), the clock, and
 * the row mappers between Postgres values and the store's results.
 */
import { sql, type SQL } from 'drizzle-orm'
import type { StaffRef, StaffRole } from '@meniscus/shared'
import type { Db } from '../../db/client.ts'
import { admission } from '../../db/schema.ts'

export interface Ctx {
  /** The pool, or the transaction a `tx` runs in: area code never knows which. */
  db: Db
  /** Epoch ms. SQL never calls `now()`: every time is a parameter (design §4.1 "Clock"). */
  now: () => number
  /**
   * Where the hashes of deleted media rows go (design §4.6): the store's hub, which reports them at once (autocommit),
   * or the open `writeTx`'s buffer, which reports them after its COMMIT. Set by `createStore` and `writeTx`; a Ctx built
   * by hand (`{ db: t, now }`) has none, so media-deleting helpers take a `WriteCtx`.
   */
  gone?: GoneSink
}

/** Epoch ms in; a `timestamptz` parameter. */
export const at = (ms: number) => new Date(ms)
/** A `timestamptz` out; the ISO string the HTTP shapes carry. */
export const iso = (d: Date) => d.toISOString()
export const isoOrNull = (d: Date | null) => (d === null ? null : d.toISOString())

export const staffRef = (id: number | null, name: string | null, role: StaffRole | null): StaffRef | null =>
  id === null || name === null || role === null ? null : { id, name, role }

/**
 * Beds in number order: the bed's leading digits as a number (0 when none), then the text,
 * so bed 2 sorts before bed 10.
 */
export const bedOrder = (bed: SQL | typeof admission.bed = admission.bed): SQL[] => [
  sql`coalesce(substring(${bed} from '^[0-9]+')::int, 0)`,
  sql`${bed}`,
]

/** Receives the `sha256`s of media rows a committed write deleted, for `onMediaGone` and `watchMediaGone`. */
export interface GoneSink {
  report(shas: string[]): void
  watch(fn: (shas: string[]) => void): () => void
}

/** A Ctx inside `writeTx`: media deletes report here and reach `onMediaGone` only once the transaction commits. */
export type WriteCtx = Ctx & { gone: GoneSink }

/** The store's hub: each report, deduplicated and when not empty, goes to `onMediaGone` and then to every watcher. */
export function goneHub(onMediaGone?: (shas: string[]) => void): GoneSink {
  const watchers = new Set<(shas: string[]) => void>()
  return {
    report: (shas) => {
      const unique = [...new Set(shas)]
      if (!unique.length) return
      onMediaGone?.(unique)
      for (const fn of watchers) fn(unique)
    },
    watch: (fn) => {
      watchers.add(fn)
      return () => void watchers.delete(fn)
    },
  }
}

/**
 * One transaction (a savepoint when `ctx.db` already is one) whose media deletes are held until it commits, then passed
 * to `ctx.gone`: the hub at top level (reported after COMMIT) or the enclosing `writeTx`'s buffer (reported after the
 * outer COMMIT). A rollback reports nothing. Every write that may unlink media (reject, void, expiry) runs in one.
 */
export async function writeTx<T>(ctx: Ctx, fn: (t: WriteCtx) => Promise<T>): Promise<T> {
  const held: string[] = []
  const parent = ctx.gone
  const sink: GoneSink = {
    report: (shas) => void held.push(...shas),
    watch: (f) => (parent ? parent.watch(f) : () => {}),
  }
  const r = await ctx.db.transaction((t) => fn({ db: t, now: ctx.now, gone: sink }))
  parent?.report(held)
  return r
}
