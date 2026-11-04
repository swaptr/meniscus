/**
 * Area `levels` (postgres-store task 4.2): jug and bottle levels and bag readings, checked for parity with the SQLite
 * store. The same seed, clock and calls (those of bags.test.ts, bag-alerts.test.ts and devices.test.ts) give deep-equal
 * results, errors included; the bed lock is checked on the statements sent. In-process PGlite only; no network.
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import type { BagReadingInput, PhotoEvidence } from '@meniscus/shared'
import type { ReadRow } from '../../ai/read-log.ts'
import { media, model_read, read_link } from '../../db/schema.ts'
import { createTestDb, type TestDb } from '../../db/testing.ts'
import { Duplicate, Forbidden, ReadLinkTaken } from '../port.ts'
import { expected } from './recorded.ts'
import { openPgStore } from './store.ts'

/** What the SQLite store answered to these calls (see recorded.ts). */
const old = expected('levels')
const T0 = Date.UTC(2026, 10, 4, 10, 0, 0)
const MIN = 60_000
const HOUR = 60 * MIN
const handles: TestDb[] = []
after(async () => {
  for (const h of handles) await h.close()
})

async function pair(onQuery?: (q: string, params: unknown[]) => void) {
  let t = T0
  const clock = { now: () => t, set: (ms: number) => (t = ms) }
  const h = await createTestDb(onQuery)
  handles.push(h)
  const pg = await openPgStore(h.db, { now: clock.now })
  const lite = old.session().store
  /** One photo of the bed in both stores (media is another area: written to the pg table directly). Same id in both. */
  const photo = async (admissionId: number, staffId = 1) => {
    const sha256 = (admissionId % 16).toString(16).repeat(64)
    const l = lite.addMedia(admissionId, { kind: 'photo', mime: 'image/jpeg', sha256, size: 1234 }, staffId)!
    const [p] = await h.db
      .insert(media)
      .values({
        admission_id: admissionId,
        kind: 'photo',
        mime: 'image/jpeg',
        size: 1234,
        created_at: new Date(clock.now()),
        created_by: staffId,
        sha256,
      })
      .returning({ id: media.id })
    assert.equal(p!.id, l.id)
    return l.id
  }
  /** One read of the read log in both stores, the same way. */
  const read = async (admissionId: number, staffId = 1) => {
    const row = {
      kind: 'photo',
      mode: 'spark',
      models: ['muse-spark'],
      hint: null,
      staff_id: staffId,
      admission_id: admissionId,
      confidence: 0.9,
      issues: [],
      needs_review: false,
      drafts: 1,
      output: { kind: 'photo', drafts: [] },
    }
    const l = lite.recordRead(row as unknown as ReadRow)
    const [p] = await h.db
      .insert(model_read)
      .values({ ...row, created_at: new Date(clock.now()) })
      .returning({ id: model_read.id })
    assert.equal(p!.id, l)
    return l
  }
  return { pg, lite, clock, h, photo, read }
}

/** Both stores reject the call with the same error (class and, for a duplicate, its match). */
async function sameError(pg: Promise<unknown>, lite: () => unknown, cls: new (...a: never[]) => Error) {
  let liteErr: unknown
  try {
    lite()
  } catch (err) {
    liteErr = err
  }
  assert.ok(liteErr instanceof cls, `sqlite: ${String(liteErr)}`)
  await assert.rejects(pg, (err: unknown) => {
    assert.ok(err instanceof cls, `pg: ${String(err)}`)
    if (err instanceof Duplicate) assert.deepEqual(err.duplicate, (liteErr as Duplicate).duplicate)
    return true
  })
}

const evidence: PhotoEvidence = {
  kind: 'photo',
  mode: 'spark',
  reading: { container: 'urine_bag', volume_ml: 150 } as PhotoEvidence['reading'],
  segmentation: null,
  review_reasons: [],
  trace: [],
  colour: '#ccaa33',
}

describe('postgres store: jug and bottle levels', () => {
  it('addLevel and levels match: a first level, a drop with its intake entry, a refill, and read links', async () => {
    const { pg, lite, clock, h, photo, read } = await pair()
    const bed = 3
    assert.equal(
      await pg.addLevel(999, { container: 'water_jug', volume_ml: 500, source: 'manual' }),
      lite.addLevel(999, { container: 'water_jug', volume_ml: 500, source: 'manual' }),
    )
    assert.equal(await pg.levels(999), undefined)
    assert.equal(lite.levels(999), undefined)
    assert.deepEqual(await pg.levels(bed), lite.levels(bed))

    const first = { container: 'water_jug', volume_ml: 800, source: 'manual' } as const
    assert.deepEqual(await pg.addLevel(bed, first, 1), lite.addLevel(bed, first, 1))

    clock.set(T0 + HOUR)
    const m = await photo(bed)
    const r = await read(bed)
    const drop = { container: 'water_jug', volume_ml: 550, source: 'photo', confidence: 0.8, evidence, media_id: m, read_id: r } as const
    const got = await pg.addLevel(bed, drop, 1)
    assert.deepEqual(got, lite.addLevel(bed, drop, 1))
    assert.equal(got?.entry?.volume_ml, 250)
    assert.equal(got?.entry?.levels?.before?.volume_ml, 800)
    assert.equal(got?.entry?.media?.id, m)
    const links = await h.db.select().from(read_link)
    assert.deepEqual(
      links.map((k) => [k.read_id, k.draft, k.level_id, k.entry_id]),
      [[r, 0, got.level.id, null]],
    )
    assert.equal(lite.linked(r, 0), true)

    clock.set(T0 + 2 * HOUR)
    const refill = { container: 'water_jug', volume_ml: 1000, source: 'manual' } as const
    assert.deepEqual(await pg.addLevel(bed, refill, 4), lite.addLevel(bed, refill, 4))
    const bottle = { container: 'water_bottle', volume_ml: 400, source: 'manual' } as const
    assert.deepEqual(await pg.addLevel(bed, bottle, 4), lite.addLevel(bed, bottle, 4))
    assert.deepEqual(await pg.levels(bed), lite.levels(bed))
    assert.equal((await pg.levels(bed))?.length, 2)

    // A day later the old level no longer counts: no drop entry.
    clock.set(T0 + 27 * HOUR)
    const later = { container: 'water_jug', volume_ml: 200, source: 'manual' } as const
    const l = await pg.addLevel(bed, later, 1)
    assert.deepEqual(l, lite.addLevel(bed, later, 1))
    assert.equal(l?.entry, null)

    // Last: a rolled-back insert still uses up its identity value, where SQLite reuses the rowid.
    const again = { container: 'water_jug', volume_ml: 100, source: 'photo', read_id: r } as const
    await sameError(pg.addLevel(bed, again, 1), () => lite.addLevel(bed, again, 1), ReadLinkTaken)
    assert.deepEqual(await pg.levels(bed), lite.levels(bed))
  })

  it('addLevel locks the bed first', async () => {
    const sent: string[] = []
    const { pg } = await pair((q) => sent.push(q))
    sent.length = 0
    await pg.addLevel(3, { container: 'water_jug', volume_ml: 500, source: 'manual' }, 1)
    const lock = sent.findIndex((q) => /from "meniscus"."admission".*for no key update/is.test(q))
    const insert = sent.findIndex((q) => q.includes('insert into "meniscus"."level"'))
    assert.ok(lock >= 0 && insert > lock, sent.join('\n'))
  })
})

describe('postgres store: bag readings', () => {
  const urine = (event: BagReadingInput['event'], volume_ml: number, extra: Partial<BagReadingInput> = {}): BagReadingInput => ({
    container: 'urine_bag',
    event,
    volume_ml,
    source: 'manual',
    ...extra,
  })

  it('readings, rises, entries, the fall guard, duplicates and late readings match', async () => {
    const { pg, lite, clock, photo, read } = await pair()
    const bed = 3
    const both = async (input: BagReadingInput, staff = 1) => {
      const p = await pg.addBagReading(bed, input, staff)
      assert.deepEqual(p, lite.addBagReading(bed, input, staff))
      return p!
    }
    assert.equal(await pg.addBagReading(999, urine('check', 100)), undefined)
    assert.equal(lite.addBagReading(999, urine('check', 100)), undefined)

    const first = await both(urine('emptied', 600, { notes: 'clear', urine_colour: 'pale' }))
    assert.equal(first.entry?.volume_ml, 600)
    clock.set(T0 + HOUR)
    const m = await photo(bed)
    const r = await read(bed)
    const second = await both(
      urine('check', 150, {
        source: 'photo',
        media_id: m,
        evidence,
        confidence: 0.7,
        read_id: r,
        urine_colour: 'dark',
        urine_rgb: '#aa8800',
      }),
    )
    assert.equal(second.entry?.levels?.before?.id, first.reading.id)
    assert.equal(second.entry?.media?.id, m)
    clock.set(T0 + 2 * HOUR)

    // Unchanged level: nothing charted. A repeat within the window: refused, then saved once confirmed.
    await both(urine('check', 150))
    clock.set(T0 + 2 * HOUR + 5 * MIN)
    await sameError(pg.addBagReading(bed, urine('check', 160), 1), () => lite.addBagReading(bed, urine('check', 160), 1), Duplicate)
    const dupOf = (await pg.bagReadings(bed, 0)).at(-1)!.id
    await both(urine('check', 160, { confirm_duplicate_of: dupOf }))

    // A fall (no emptying recorded), then an emptying charted inside its gap: nurses only.
    clock.set(T0 + 4 * HOUR)
    await both(urine('check', 40))
    clock.set(T0 + 4 * HOUR + 10 * MIN)
    const gap = urine('emptied', 0, { charted_at: new Date(T0 + 3 * HOUR).toISOString() })
    await sameError(pg.addBagReading(bed, gap, 1), () => lite.addBagReading(bed, gap, 1), Forbidden)
    await both(gap, 4)

    // A late check between two readings, a stoma bag kept apart, and a bag change.
    await both(urine('check', 100, { charted_at: new Date(T0 + 30 * MIN).toISOString() }))
    await both({ container: 'stoma_bag', event: 'check', volume_ml: 120, source: 'manual' }, 4)
    clock.set(T0 + 5 * HOUR)
    await both(urine('bag_changed', 0), 4)

    assert.deepEqual(await pg.bagReadings(bed, 0), lite.bagReadings(bed, 0))
    assert.deepEqual(await pg.bagReadings(bed, T0 + 3 * HOUR), lite.bagReadings(bed, T0 + 3 * HOUR))
    assert.deepEqual(await pg.bagReadings(999, 0), lite.bagReadings(999, 0))

    // Last (identity values are not reused after a rollback): a taken draft stores nothing.
    clock.set(T0 + 6 * HOUR)
    const taken = urine('check', 300, { read_id: r })
    await sameError(pg.addBagReading(bed, taken, 1), () => lite.addBagReading(bed, taken, 1), ReadLinkTaken)
    assert.deepEqual(await pg.bagReadings(bed, 0), lite.bagReadings(bed, 0))
  })

  it('bagReading, afterEmptying and the ward lists match', async () => {
    const { pg, lite, clock, photo } = await pair()
    const both = async (bed: number, input: BagReadingInput, staff = 1) => {
      const p = await pg.addBagReading(bed, input, staff)
      assert.deepEqual(p, lite.addBagReading(bed, input, staff))
      return p!
    }
    const a = await both(3, urine('emptied', 500))
    clock.set(T0 + HOUR)
    const b = await both(3, urine('check', 200))
    const other = await both(9, { container: 'drain_bag', event: 'emptied', volume_ml: 90, source: 'manual' })
    clock.set(T0 + 2 * HOUR)
    const c = await both(3, urine('emptied', 450))

    for (const id of [a.reading.id, b.reading.id, c.reading.id, other.reading.id, 999]) {
      assert.deepEqual(await pg.bagReading(id), lite.bagReading(id))
    }
    assert.equal(await pg.bagReading(999), undefined)

    // Closed: a later reading exists. Not found: no such reading. Open: proof and residual once, then closed.
    assert.deepEqual(await pg.afterEmptying(a.reading.id, { residual_ml: 20 }), lite.afterEmptying(a.reading.id, { residual_ml: 20 }))
    assert.deepEqual(await pg.afterEmptying(999, { residual_ml: 20 }), lite.afterEmptying(999, { residual_ml: 20 }))
    const m = await photo(3)
    const open = { media_id: m, residual_ml: 30 }
    const done = await pg.afterEmptying(c.reading.id, open)
    assert.deepEqual(done, lite.afterEmptying(c.reading.id, open))
    assert.equal(done.ok && done.reading.proof_media?.id, m)
    assert.deepEqual(await pg.afterEmptying(c.reading.id, open), lite.afterEmptying(c.reading.id, open))
    assert.deepEqual(await pg.bagReading(c.reading.id), lite.bagReading(c.reading.id))

    for (const since of [0, T0 + HOUR, T0 + 3 * HOUR]) {
      assert.deepEqual(await pg.bagReadingsByWard(undefined, since), lite.bagReadingsByWard(undefined, since))
      for (const w of [1, 2, 3, 4, 999]) assert.deepEqual(await pg.bagReadingsByWard(w, since), lite.bagReadingsByWard(w, since))
    }
    assert.equal((await pg.bagReadingsByWard(undefined, 0)).size, 2)
  })

  it('addBagReading and afterEmptying lock the bed first', async () => {
    const sent: string[] = []
    const { pg } = await pair((q) => sent.push(q))
    sent.length = 0
    const r = await pg.addBagReading(3, urine('emptied', 500), 1)
    const lock = sent.findIndex((q) => /from "meniscus"."admission".*for no key update/is.test(q))
    const insert = sent.findIndex((q) => q.includes('insert into "meniscus"."level"'))
    assert.ok(lock >= 0 && insert > lock, sent.join('\n'))
    sent.length = 0
    await pg.afterEmptying(r!.reading.id, { residual_ml: 10 })
    const lockOf = sent.findIndex((q) => /for no key update of "a"$/i.test(q))
    const update = sent.findIndex((q) => q.includes('update "meniscus"."level"'))
    assert.ok(lockOf >= 0 && update > lockOf, sent.join('\n'))
  })
})
