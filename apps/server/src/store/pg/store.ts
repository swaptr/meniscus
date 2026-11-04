/**
 * The chart store on Postgres (Drizzle ORM): the async `Store` of `../port.ts`, assembled from one module per area
 * (wards, staff, entries, levels, meals, media, care, dashboards), with the demo seed, `tx` and the per-hash lock.
 */
import { sql } from 'drizzle-orm'
import type { Db } from '../../db/client.ts'
import type { Store } from '../port.ts'
import { careArea } from './care.ts'
import { goneHub, writeTx, type Ctx, type GoneSink } from './context.ts'
import { entriesArea } from './entries.ts'
import { expireMedia, mediaArea } from './media.ts'
import { dashboardsArea } from './dashboards.ts'
import { mealsArea } from './meals.ts'
import { seedDemo } from './seed.ts'
import { levelsArea } from './levels.ts'
import { endEndedSessions, staffArea } from './staff.ts'
import { wardsArea } from './wards.ts'

export interface PgStoreOptions {
  /** The clock, epoch ms (tests move it). */
  now?: () => number
  /** Ends the store's connections; `createDb`'s or `createTestDb`'s `close`. */
  close?: () => Promise<void>
  /**
   * Called after each COMMIT (and after expiry on open) with the distinct `sha256`s of the media rows it deleted, so
   * their objects can go once no row names them (charting/media). Nothing is reported for a rolled-back transaction.
   */
  onMediaGone?: (shas: string[]) => void
  /** Internal: the sink a bound store (inside `tx`) reports to; a top-level store makes its own hub. */
  gone?: GoneSink
}

/** The store over `db`, bound to it: the pool, or a transaction (then `tx` nests as a savepoint). No I/O until called. */
export function createStore(db: Db, opts: PgStoreOptions = {}): Store {
  const now = opts.now ?? Date.now
  const ctx: Ctx = { db, now, gone: opts.gone ?? goneHub(opts.onMediaGone) }
  const bound = (t: Ctx) => createStore(t.db, { now, gone: t.gone })

  return {
    now,
    tx: (fn) => writeTx(ctx, (t) => fn(bound(t))),
    withShaLock: (sha256, fn) =>
      writeTx(ctx, async (t) => {
        await t.db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${sha256}, 0))`)
        return fn(bound(t))
      }),
    close: opts.close ?? (() => Promise.resolve()),

    ...wardsArea(ctx),
    ...staffArea(ctx),

    ...entriesArea(ctx),

    ...levelsArea(ctx),

    ...mealsArea(ctx),

    ...mediaArea(ctx),

    ...careArea(ctx),

    // dashboards: the bed list with 24 h totals and hourly series, ward quality rows, read outcomes.
    ...dashboardsArea(ctx),
  }
}

/**
 * Opens the store on a migrated database: seeds the demo hospital into empty tables, ends finished sessions, and
 * deletes unlinked media past their TTL, reporting their hashes to `onMediaGone`.
 */
export async function openPgStore(db: Db, opts: PgStoreOptions = {}): Promise<Store> {
  const now = opts.now ?? Date.now
  await seedDemo(db, now())
  const gone = opts.gone ?? goneHub(opts.onMediaGone)
  await expireMedia({ db, now, gone })
  await endEndedSessions({ db, now })
  return createStore(db, { ...opts, now, gone })
}
