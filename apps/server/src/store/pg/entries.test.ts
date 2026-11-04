/**
 * Area `entries` on Postgres, checked for parity with the SQLite store: the same seed, clock and calls give deep-equal
 * entries, totals, urine colour, events, reviews, amendments and photos. In-process PGlite only; no network.
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { eq } from 'drizzle-orm'
import type { EntryInput } from '@meniscus/shared'
import { level, media, model_read } from '../../db/schema.ts'
import { createTestDb, type TestDb } from '../../db/testing.ts'
import { ReadLinkTaken } from '../port.ts'
import { expected } from './recorded.ts'
import { at, goneHub } from './context.ts'
import { entriesArea, insertEntry } from './entries.ts'
import { openPgStore } from './store.ts'

/** What the SQLite store answered to these calls (see recorded.ts). */
const old = expected('entries')
const T0 = Date.UTC(2026, 10, 4, 10, 0, 0)
const SHA = (c: string) => c.repeat(64)
const handles: TestDb[] = []
after(async () => {
  for (const h of handles) await h.close()
})

async function pair() {
  let t = T0
  const clock = { now: () => t, set: (ms: number) => (t = ms) }
  const h = await createTestDb()
  handles.push(h)
  const pg = await openPgStore(h.db, { now: clock.now })
  const liteGone: string[][] = []
  const lite = old.session((s) => liteGone.push(s)).store
  const pgGone: string[][] = []
  const area = entriesArea({ db: h.db, now: clock.now, gone: goneHub((s) => pgGone.push(s)) })
  return { pg, lite, clock, h, area, liteGone, pgGone }
}

type Pair = Awaited<ReturnType<typeof pair>>

/** The same media row in both stores (the media area's `addMedia` is not ported yet): same id, same values. */
async function bothMedia({ lite, h, clock }: Pair, admissionId: number, kind: 'photo' | 'voice', sha: string) {
  const m = lite.addMedia(admissionId, { kind, mime: kind === 'photo' ? 'image/jpeg' : 'audio/webm', sha256: sha, size: 1234 }, 4)!
  const [row] = await h.db
    .insert(media)
    .values({
      admission_id: admissionId,
      kind,
      mime: m.mime,
      size: m.size,
      duration_ms: m.duration_ms,
      created_at: at(clock.now()),
      created_by: 4,
      sha256: sha,
      served_meal: null,
    })
    .returning({ id: media.id })
  assert.equal(row!.id, m.id)
  return m.id
}

const water: EntryInput = { direction: 'in', category: 'water', volume_ml: 200, source: 'manual' }
const photoEvidence = {
  kind: 'photo' as const,
  mode: 'spark' as const,
  reading: { container: 'cup', fill_fraction: 0.5, volume_ml: 180, confidence: 0.8, notes: null },
  segmentation: null,
  review_reasons: ['low confidence'],
  trace: [],
  colour: '#aabbcc',
}

describe('postgres store: entries', () => {
  it('addEntry, entries, recent and events match, with totals and the urine colour', async () => {
    const p = await pair()
    const { pg, lite, clock } = p
    const inputs: [number, EntryInput, number | null][] = [
      [1, water, 4],
      [1, { ...water, iddsi_level: 2, drink: 'tea', item: 'Tea', notes: 'with milk', confidence: 0.7 }, 4],
      [1, { direction: 'in', category: 'food', volume_ml: 150, source: 'text', drink: 'juice', iddsi_level: 3 }, null],
      [1, { direction: 'out', category: 'urine', volume_ml: 300, source: 'photo', urine_colour: 'orange', urine_rgb: '#cc9900' }, 5],
      [1, { direction: 'out', category: 'urine', volume_ml: 250, source: 'manual', urine_rgb: '#cc9900' }, 5],
      [1, { direction: 'out', category: 'drain', volume_ml: 50, source: 'manual', urine_colour: 'dark' }, 4],
      [1, { ...water, source: 'photo', evidence: photoEvidence as never }, 4],
      [1, { ...water, charted_at: new Date(T0 - 3 * 3_600_000).toISOString() }, 4],
      [2, water, 4],
    ]
    for (const [id, e, by] of inputs) {
      clock.set(clock.now() + 60_000)
      assert.deepEqual(await pg.addEntry(id, e, by), lite.addEntry(id, e, by))
    }
    assert.equal(await pg.addEntry(999, water, 4), undefined)
    assert.equal(lite.addEntry(999, water, 4), undefined)
    for (const id of [1, 2, 3]) assert.deepEqual(await pg.entries(id), lite.entries(id))
    assert.equal(await pg.entries(999), undefined)
    assert.ok((await pg.entries(1))!.urine_seen)
    assert.equal((await pg.entries(1))!.entries.find((e) => e.created_at === new Date(T0 - 3 * 3_600_000).toISOString())?.late, true)
    assert.deepEqual(await pg.recent(1), lite.recent(1))
    assert.deepEqual(await pg.recent(1, T0 + 5 * 60_000), lite.recent(1, T0 + 5 * 60_000))
    for (const id of [1, 4, 999]) assert.deepEqual(await pg.events(id), lite.events(id))
    clock.set(T0 + 25 * 3_600_000)
    assert.deepEqual(await pg.entries(1), lite.entries(1))
    assert.deepEqual(await pg.recent(1), [])
  })

  it('review approves, corrects and rejects once, with the same events', async () => {
    const { pg, lite, clock } = await pair()
    for (let i = 0; i < 4; i++) {
      await pg.addEntry(1, water, 4)
      lite.addEntry(1, water, 4)
    }
    clock.set(T0 + 60_000)
    const calls: Parameters<typeof lite.review>[] = [
      [1, 'approve', { staffId: 4 }],
      [2, 'approve', { staffId: 4, volumeMl: 250 }],
      [3, 'approve', { staffId: 4, volumeMl: 200 }],
      [4, 'reject', { staffId: 4, reason: 'duplicate', note: 'twice' }],
      [4, 'approve', { staffId: 4 }],
      [999, 'approve', {}],
    ]
    for (const c of calls) assert.deepEqual(await pg.review(...c), lite.review(...c))
    for (const id of [1, 2, 3, 4]) assert.deepEqual(await pg.events(id), lite.events(id))
    assert.deepEqual(await pg.entries(1), lite.entries(1))
  })

  it('a rejected entry lets go of its media, reported after COMMIT', async () => {
    const p = await pair()
    const { pg, lite, h, area, liteGone, pgGone } = p
    const voice = await bothMedia(p, 1, 'voice', SHA('a'))
    const e: EntryInput = { ...water, source: 'voice', media_id: voice }
    assert.deepEqual(await pg.addEntry(1, e, 4), lite.addEntry(1, e, 4))
    assert.equal((await pg.entries(1))!.entries[0]!.media?.id, voice)
    assert.deepEqual(
      await area.review(1, 'reject', { staffId: 4, reason: 'wrong_bed' }),
      lite.review(1, 'reject', { staffId: 4, reason: 'wrong_bed' }),
    )
    assert.deepEqual(pgGone, liteGone)
    assert.deepEqual(pgGone, [[SHA('a')]])
    assert.deepEqual(await h.db.select().from(media).where(eq(media.id, voice)), [])
  })

  it('amend matches on every branch: refusals, type, colour, consistency and drink changes', async () => {
    const { pg, lite, clock } = await pair()
    const add: EntryInput[] = [
      { ...water, iddsi_level: 1, drink: 'tea', item: 'Tea' },
      { direction: 'out', category: 'urine', volume_ml: 300, source: 'photo', urine_colour: 'orange', urine_rgb: '#cc9900' },
      water,
      { direction: 'in', category: 'food', volume_ml: 100, source: 'manual' },
    ]
    for (const e of add) {
      await pg.addEntry(1, e, 4)
      lite.addEntry(1, e, 4)
    }
    assert.deepEqual(await pg.amend(3, { volume_ml: 100, reason: 'r' }, 4), lite.amend(3, { volume_ml: 100, reason: 'r' }, 4))
    for (const id of [1, 2, 4]) {
      await pg.review(id, 'approve', { staffId: 4 })
      lite.review(id, 'approve', { staffId: 4 })
    }
    clock.set(T0 + 120_000)
    const calls: Parameters<typeof lite.amend>[] = [
      [999, { volume_ml: 100, reason: 'r' }, 4],
      [1, { category: 'urine', reason: 'r' }, 4],
      [1, { urine_colour: 'dark', reason: 'r' }, 4],
      [2, { iddsi_level: 2, reason: 'r' }, 4],
      [2, { drink: 'tea', reason: 'r' }, 4],
      [1, { reason: 'r' }, 4],
      [1, { iddsi_level: 1, reason: 'r' }, 4],
      [1, { drink: 'tea', reason: 'r' }, 4],
      [1, { volume_ml: 180, iddsi_level: 3, reason: 'smaller' }, 4],
      [1, { drink: 'coffee', reason: 'kind' }, 5],
      [1, { category: 'food', reason: 'soup' }, null],
      [2, { urine_colour: 'dark', reason: 'darker' }, 4],
      [2, { volume_ml: 320, reason: 'more' }, 4],
      [2, { category: 'drain', reason: 'drain' }, 4],
      [4, { category: 'water', iddsi_level: 4, reason: 'thick' }, 4],
    ]
    for (const c of calls) assert.deepEqual(await pg.amend(...c), lite.amend(...c), JSON.stringify(c))
    for (const id of [1, 2, 3, 4]) assert.deepEqual(await pg.events(id), lite.events(id))
    assert.deepEqual(await pg.entries(1), lite.entries(1))
  })

  it('attachPhoto, photoAllowed and photo match, one photo per pending entry', async () => {
    const p = await pair()
    const { pg, lite, clock } = p
    const voice = await bothMedia(p, 1, 'voice', SHA('b'))
    for (const e of [water, water, { ...water, source: 'voice', media_id: voice } as EntryInput]) {
      await pg.addEntry(1, e, 4)
      lite.addEntry(1, e, 4)
    }
    await pg.review(2, 'approve', { staffId: 4 })
    lite.review(2, 'approve', { staffId: 4 })
    clock.set(T0 + 60_000)
    for (const id of [1, 2, 3, 999]) assert.equal(await pg.photoAllowed(id), lite.photoAllowed(id))
    for (const id of [1, 1, 2, 3, 999])
      assert.equal(await pg.attachPhoto(id, 'image/jpeg', SHA('c'), 99), lite.attachPhoto(id, 'image/jpeg', SHA('c'), 99))
    for (const id of [1, 2, 3, 999]) {
      assert.deepEqual(await pg.photo(id), lite.photo(id))
      assert.equal(await pg.photoAllowed(id), lite.photoAllowed(id))
    }
    assert.equal((await pg.photo(1))?.sha256, SHA('c'))
    assert.deepEqual(await pg.entries(1), lite.entries(1))
  })

  it('an upload expires unlinked media past their TTL, as the SQLite store does', async () => {
    const p = await pair()
    const { pg, lite, clock, area, pgGone, liteGone } = p
    await bothMedia(p, 1, 'photo', SHA('d'))
    await pg.addEntry(1, water, 4)
    lite.addEntry(1, water, 4)
    clock.set(T0 + 25 * 3_600_000)
    assert.equal(await area.attachPhoto(1, 'image/jpeg', SHA('e'), 10), lite.attachPhoto(1, 'image/jpeg', SHA('e'), 10))
    assert.deepEqual(pgGone, liteGone)
    assert.deepEqual(pgGone, [[SHA('d')]])
    assert.deepEqual(await pg.photo(1), lite.photo(1))
  })

  it('links a read draft once; a taken draft throws ReadLinkTaken and stores nothing', async () => {
    const { pg, lite, h, clock } = await pair()
    const row = { kind: 'photo', mode: 'spark', models: ['m'], hint: null, staff_id: 4, admission_id: 1, confidence: 0.5 } as const
    const readId = lite.recordRead({ ...row, issues: [], needs_review: false, drafts: 2, output: {} } as never)
    await h.db
      .insert(model_read)
      .values({ ...row, models: ['m'], issues: [], needs_review: false, drafts: 2, output: {}, created_at: at(clock.now()) })
    const e = { ...water, read_id: readId }
    assert.deepEqual(await pg.addEntry(1, e, 4), lite.addEntry(1, e, 4))
    assert.deepEqual(await pg.addEntry(1, { ...e, read_draft: 1 }, 4), lite.addEntry(1, { ...e, read_draft: 1 }, 4))
    await assert.rejects(pg.addEntry(1, e, 4), ReadLinkTaken)
    assert.throws(() => lite.addEntry(1, e, 4), ReadLinkTaken)
    assert.equal(lite.linked(readId, 0), true)
    assert.deepEqual(await pg.entries(1), lite.entries(1))
    await assert.rejects(pg.addEntry(1, { ...water, read_id: 999 }, 4))
    assert.throws(() => lite.addEntry(1, { ...water, read_id: 999 }, 4))
    assert.deepEqual(await pg.entries(1), lite.entries(1))
  })

  it("a level drop's entry carries its after and before levels with their photos", async () => {
    const p = await pair()
    const { h, pg, clock } = p
    const photo = await bothMedia(p, 1, 'photo', SHA('f'))
    const [before] = await h.db
      .insert(level)
      .values({ admission_id: 1, container: 'jug', volume_ml: 800, created_at: at(T0) })
      .returning({ id: level.id })
    const [after] = await h.db
      .insert(level)
      .values({ admission_id: 1, container: 'jug', volume_ml: 500, created_at: at(T0 + 1), media_id: photo, evidence: photoEvidence })
      .returning({ id: level.id })
    const e = await h.db.transaction((t) =>
      insertEntry({ db: t, now: clock.now }, 1, { ...water, volume_ml: 300, level_id: after!.id, prev_level_id: before!.id }, T0, T0, 4),
    )
    const m = (await pg.photo(1)) ?? (await pg.entries(1))!.entries[0]!.levels!.after.media
    assert.equal(m?.id, photo)
    assert.deepEqual(e.levels, {
      before: {
        id: before!.id,
        volume_ml: 800,
        created_at: new Date(T0).toISOString(),
        media: null,
        labeled_media: null,
        evidence: null,
        event: null,
        residual_ml: null,
      },
      after: {
        id: after!.id,
        volume_ml: 500,
        created_at: new Date(T0 + 1).toISOString(),
        media: m,
        labeled_media: null,
        evidence: photoEvidence,
        event: null,
        residual_ml: null,
      },
    })
    assert.deepEqual((await pg.entries(1))!.entries[0], e)
  })
})
