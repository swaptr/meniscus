/**
 * Area `meals` on Postgres, checked for parity with the SQLite store: the calls meals.test.ts, meal-amend.test.ts and
 * meal-reading.test.ts make through the routes, made on both stores with one seed and clock, give deep-equal results.
 * Media and read rows are written straight into Postgres (their areas port `addMedia` and `recordRead`). In-process
 * PGlite only; no network.
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { eq } from 'drizzle-orm'
import type { DishValue, MealEvidenceInput, MealKind } from '@meniscus/shared'
import { createTestDb, type TestDb } from '../../db/testing.ts'
import { entry, entry_event, media, meal, model_read } from '../../db/schema.ts'
import { ServedTaken, ReadLinkTaken } from '../port.ts'
import { expected } from './recorded.ts'
import { at } from './context.ts'
import { openPgStore } from './store.ts'

/** What the SQLite store answered to these calls (see recorded.ts). */
const old = expected('meals')
const T0 = Date.UTC(2026, 10, 4, 10, 0, 0)
const HOUR = 3_600_000
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
  const lite = old.session().store

  /** One photo on both stores, same id. */
  const photo = async (admissionId: number, sha: string, servedMeal: MealKind | null = null, staffId = 4) => {
    const l = lite.addMedia(admissionId, { kind: 'photo', mime: 'image/jpeg', sha256: sha, size: 1234, served_meal: servedMeal }, staffId)!
    const [p] = await h.db
      .insert(media)
      .values({
        admission_id: admissionId,
        kind: 'photo',
        mime: 'image/jpeg',
        size: 1234,
        created_at: at(clock.now()),
        created_by: staffId,
        sha256: sha,
        served_meal: servedMeal,
      })
      .returning({ id: media.id })
    assert.equal(p!.id, l.id)
    return l.id
  }

  /** One tray read on both stores, same id. */
  const read = async (admissionId: number) => {
    const row = {
      kind: 'tray',
      mode: 'spark',
      models: ['muse-spark'],
      hint: null,
      staff_id: 4,
      admission_id: admissionId,
      confidence: 0.8,
      issues: [],
      needs_review: false,
      drafts: 1,
      output: {},
    } as const
    const id = lite.recordRead(row as unknown as Parameters<typeof lite.recordRead>[0])
    const [r] = await h.db
      .insert(model_read)
      .values({ ...row, issues: [], models: [...row.models], created_at: at(clock.now()) })
      .returning({ id: model_read.id })
    assert.equal(r!.id, id)
    return id
  }

  return { pg, lite, clock, h, photo, read }
}

const sha = (c: string) => c.repeat(64)
const evidence = (image: string) =>
  ({
    mode: 'spark',
    image_sha256: image,
    reading: { meal: 'lunch', portion: 75, items: 'dal, rice', confidence: 0.72, fluid_ml: 150 },
    segmentation: null,
    comparison: null,
    warnings: ['a note'],
    trace: [{ model: 'muse-spark', ms: 812, status: 200 }],
  }) as unknown as MealEvidenceInput
const dishes: DishValue[] = [
  { index: 1, name: 'dal', dish_kind: 'curry', portion: 75 },
  { index: 2, name: 'rice', dish_kind: 'rice', portion: 50 },
] as DishValue[]

describe('postgres store: meals', () => {
  it('addMeal by hand, with and without fluid, and the reads match', async () => {
    const { pg, lite, clock, h } = await pair()
    assert.deepEqual(
      await pg.addMeal(1, { meal: 'breakfast', portion: 50, source: 'manual' }, 4),
      lite.addMeal(1, { meal: 'breakfast', portion: 50, source: 'manual' }, 4),
    )
    const late = {
      meal: 'lunch',
      portion: 100,
      items: '  soup, roti ',
      fluid_ml: 200,
      source: 'manual',
      charted_at: new Date(T0 - 2 * HOUR).toISOString(),
    } as const
    assert.deepEqual(await pg.addMeal(1, late, 5), lite.addMeal(1, late, 5))
    assert.deepEqual(
      await pg.addMeal(2, { meal: 'snack', portion: 25, source: 'manual' }),
      lite.addMeal(2, { meal: 'snack', portion: 25, source: 'manual' }),
    )
    assert.equal(await pg.addMeal(999, { meal: 'snack', portion: 25, source: 'manual' }), undefined)
    assert.equal(lite.addMeal(999, { meal: 'snack', portion: 25, source: 'manual' }), undefined)

    clock.set(T0 + HOUR)
    assert.deepEqual(await pg.meals(1), lite.meals(1))
    assert.equal((await pg.meals(1))!.length, 2)
    assert.deepEqual(await pg.meals(1, T0 - 3 * HOUR), lite.meals(1, T0 - 3 * HOUR))
    assert.equal(await pg.meals(999), undefined)
    assert.deepEqual(await pg.meal(2), lite.meal(2))
    assert.equal(await pg.meal(999), undefined)
    const ward = (await pg.admission(1))!.ward_id
    assert.deepEqual(await pg.mealsByWard(ward, T0 - 3 * HOUR), lite.mealsByWard(ward, T0 - 3 * HOUR))
    assert.deepEqual(await pg.mealsByWard(undefined, T0 - 3 * HOUR), lite.mealsByWard(undefined, T0 - 3 * HOUR))
    assert.equal((await pg.mealsByWard(undefined, T0 - 3 * HOUR)).size, 2)

    // The fluid entry: pending, food, the meal's name and items as its item, one `recorded` event.
    const m = (await pg.meal(2))!
    assert.equal(m.entry_status, 'pending')
    const [e] = await h.db.select().from(entry).where(eq(entry.id, m.entry_id!))
    assert.deepEqual([e!.category, e!.item, e!.volume_ml, e!.recorded_ml, e!.created_by], ['food', 'Lunch: soup, roti', 200, 200, 5])
    const events = await h.db.select().from(entry_event).where(eq(entry_event.entry_id, e!.id))
    assert.deepEqual(
      events.map((v) => [v.kind, v.to_ml, v.to_category, v.staff_id, v.at.toISOString()]),
      lite.events(e!.id)!.map((v) => [v.kind, v.to_ml, v.to_category, v.by?.id ?? null, v.at]),
    )
  })

  it('a photo meal keeps its proof, served photo and read link; a taken served photo or read rolls back', async () => {
    const { pg, lite, h, photo, read, clock } = await pair()
    const served = await photo(3, sha('a'), 'lunch', 5)
    clock.set(T0 + 30 * 60_000)
    assert.deepEqual((await pg.servedPhoto(3, 'lunch'))!, lite.servedPhoto(3, 'lunch'))
    assert.deepEqual(await pg.servedPhoto(3, null), lite.servedPhoto(3, null))
    assert.equal(await pg.servedPhoto(3, 'dinner'), undefined)
    assert.equal(await pg.servedPhoto(4, 'lunch'), undefined)
    const tray = await photo(3, sha('b'), null, 4)
    const readId = await read(3)
    const input = {
      meal: 'lunch',
      portion: 75,
      items: 'dal, rice',
      fluid_ml: 150,
      source: 'photo',
      confidence: 0.72,
      evidence: evidence(sha('b')),
      media_id: tray,
      served_media_id: served,
      dishes,
      read_id: readId,
    } as const
    clock.set(T0 + 40 * 60_000)
    const saved = await pg.addMeal(3, input, 6)
    assert.deepEqual(saved, lite.addMeal(3, input, 6))
    assert.ok(saved!.proof?.served && saved!.media && saved!.served_media)
    // Linked now: no longer offered.
    assert.equal(await pg.servedPhoto(3, 'lunch'), undefined)
    assert.equal(lite.servedPhoto(3, 'lunch'), undefined)

    const again = { ...input, read_id: undefined, media_id: await photo(3, sha('c')), evidence: evidence(sha('c')) }
    await assert.rejects(pg.addMeal(3, again, 6), ServedTaken)
    assert.throws(() => lite.addMeal(3, again, 6), ServedTaken)
    const relink = { ...input, served_media_id: undefined, media_id: again.media_id, evidence: evidence(sha('c')) }
    await assert.rejects(pg.addMeal(3, relink, 6), ReadLinkTaken)
    assert.throws(() => lite.addMeal(3, relink, 6), ReadLinkTaken)
    // Nothing of either refused save stayed: one meal, one entry.
    assert.deepEqual(await pg.meals(3), lite.meals(3))
    assert.equal((await h.db.select().from(entry)).length, 1)

    // Past the served window, a served photo is not offered.
    await photo(3, sha('d'), 'dinner')
    assert.deepEqual(await pg.servedPhoto(3, null), lite.servedPhoto(3, null))
    clock.set(T0 + 40 * 60_000 + 4 * HOUR + 1)
    assert.equal(await pg.servedPhoto(3, 'dinner'), undefined)
    assert.equal(lite.servedPhoto(3, 'dinner'), undefined)
  })

  it('amendMeal records before and after, oldest first, and refuses what SQLite refuses', async () => {
    const { pg, lite, clock, photo } = await pair()
    const tray = await photo(1, sha('e'))
    const input = { meal: 'dinner', portion: 50, source: 'photo', evidence: evidence(sha('e')), media_id: tray, dishes } as const
    assert.deepEqual(await pg.addMeal(1, input, 4), lite.addMeal(1, input, 4))
    assert.deepEqual(
      await pg.addMeal(1, { meal: 'snack', portion: 25, items: 'fruit', source: 'manual' }, 4),
      lite.addMeal(1, { meal: 'snack', portion: 25, items: 'fruit', source: 'manual' }, 4),
    )

    const calls: [number, Parameters<typeof lite.amendMeal>[1], number | null][] = [
      [1, { portion: 75, reason: 'second look' }, 5],
      [1, { dishes: [{ ...dishes[1]!, portion: 100 }, dishes[0]!], reason: 'reordered' }, 6],
      [1, { items: 'x', reason: 'no' }, 5],
      [1, { portion: 75, reason: 'same' }, 5],
      [2, { items: '  apple ', reason: 'typo' }, null],
      [2, { items: '', reason: 'cleared' }, 4],
      [999, { portion: 50, reason: 'gone' }, 4],
    ]
    for (const [i, [id, body, by]] of calls.entries()) {
      clock.set(T0 + (i + 1) * 60_000)
      assert.deepEqual(await pg.amendMeal(id, body, by), lite.amendMeal(id, body, by), `call ${i}`)
    }
    const amended = (await pg.meal(1))!
    assert.equal(amended.amendments.length, 2)
    assert.deepEqual(await pg.meals(1), lite.meals(1))
    assert.deepEqual(await pg.voidMeal(2, 'wrong bed', 4), lite.voidMeal(2, 'wrong bed', 4))
    assert.deepEqual(await pg.amendMeal(2, { portion: 100, reason: 'late' }, 4), lite.amendMeal(2, { portion: 100, reason: 'late' }, 4))
  })

  it('voidMeal unlinks the photos, rejects a pending fluid entry, and refuses twice', async () => {
    const { pg, lite, h, clock, photo } = await pair()
    const served = await photo(2, sha('f'), 'breakfast')
    const tray = await photo(2, sha('0'))
    const input = {
      meal: 'breakfast',
      portion: 25,
      fluid_ml: 120,
      source: 'photo',
      evidence: evidence(sha('0')),
      media_id: tray,
      served_media_id: served,
    } as const
    assert.deepEqual(await pg.addMeal(2, input, 4), lite.addMeal(2, input, 4))
    clock.set(T0 + HOUR)
    const pv = await pg.voidMeal(1, 'duplicate', 5)
    assert.deepEqual(pv, lite.voidMeal(1, 'duplicate', 5))
    assert.ok(pv.ok && pv.meal.media === null && pv.meal.served_media === null && pv.meal.entry_status === 'rejected')
    assert.ok(pv.ok && pv.meal.proof !== null)
    assert.deepEqual(await pg.voidMeal(1, 'again', 5), lite.voidMeal(1, 'again', 5))
    assert.deepEqual(await pg.voidMeal(999, 'none', 5), lite.voidMeal(999, 'none', 5))

    // Both photos went with the void (nothing links them); the entry's rejection is in its history.
    assert.equal((await h.db.select().from(media)).length, 0)
    assert.equal(lite.media(tray), undefined)
    assert.equal(lite.media(served), undefined)
    const [e] = await h.db.select().from(entry)
    assert.equal(e!.status, 'rejected')
    assert.equal(e!.reject_reason, 'other')
    assert.equal(e!.reviewed_by, 5)
    const pgEvents = await h.db.select().from(entry_event).where(eq(entry_event.entry_id, e!.id)).orderBy(entry_event.id)
    const liteEvents = lite.events(e!.id)
    assert.deepEqual(
      pgEvents.map((v) => [v.kind, v.reason, v.note, v.to_ml, v.to_category, v.staff_id, v.at.toISOString()]),
      liteEvents!.map((v) => [v.kind, v.reason, v.note, v.to_ml, v.to_category, v.by?.id ?? null, v.at]),
    )
    const [row] = await h.db.select().from(meal)
    assert.equal(row!.void_reason, 'duplicate')
  })

  it('voiding leaves an approved fluid entry approved', async () => {
    const { pg, lite, h } = await pair()
    const input = { meal: 'lunch', portion: 100, fluid_ml: 250, source: 'manual' } as const
    const m = (await pg.addMeal(1, input, 4))!
    lite.addMeal(1, input, 4)
    lite.review(m.entry_id!, 'approve', { staffId: 4 })
    await h.db
      .update(entry)
      .set({ status: 'approved', reviewed_by: 4, reviewed_at: at(T0), approved_ml: 250 })
      .where(eq(entry.id, m.entry_id!))
    assert.deepEqual(await pg.voidMeal(m.id, 'wrong meal', 4), lite.voidMeal(m.id, 'wrong meal', 4))
    assert.equal((await pg.meal(m.id))!.entry_status, 'approved')
  })

  it('addMeal, amendMeal and voidMeal lock the bed before anything else', async () => {
    const sent: string[] = []
    const h = await createTestDb((q) => sent.push(q))
    handles.push(h)
    const pg = await openPgStore(h.db, { now: () => T0 })
    const first = async (call: () => Promise<unknown>) => {
      sent.length = 0
      await call()
      return sent[0]!
    }
    const lock = /for no key update/
    assert.match(await first(() => pg.addMeal(1, { meal: 'lunch', portion: 50, fluid_ml: 100, source: 'manual' }, 4)), lock)
    assert.match(await first(() => pg.amendMeal(1, { portion: 75, reason: 'second look' }, 4)), /for no key update of "bed"/)
    assert.match(await first(() => pg.voidMeal(1, 'wrong bed', 4)), /for no key update of "bed"/)
  })
})
