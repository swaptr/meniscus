import assert from 'node:assert/strict'
import { describe, it, type TestContext } from 'node:test'
import type { CareInput, MealInput, NutritionView, StaffRef } from '@meniscus/shared'
import type { TestDb } from './db/testing.ts'
import { openPgStore } from './store/pg/store.ts'
import { testApp, testDb, upstream } from './testing.ts'

/** Local time; `d` in Nov 2026 (server local time is the hospital's). */
const nov = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()
const iso = (ms: number) => new Date(ms).toISOString()
const DAY = 24 * 3_600_000

const ANITA = 4
const MEERA = 6
const DIVYA = 8
const SANA = 11
const SANA_REF: StaffRef = { id: 11, name: 'Sana Mirza', role: 'dietitian' }

type Body<T> = T & { error?: string }

/** Opened at `openedAt`; with `edit`, a test database whose store was opened, edited with SQL, and reopened. */
async function setup(openedAt: number, edit?: (h: TestDb) => Promise<void>) {
  const clock = { t: openedAt }
  const h = await testDb()
  if (edit) {
    await openPgStore(h.db, { now: () => clock.t })
    await edit(h)
  }
  const store = await openPgStore(h.db, { now: () => clock.t })
  const u = upstream()
  const { request } = await testApp({ ai: u.ai, store })
  const bed = async (ward: string, n: string) => (await store.admissions()).find((a) => a.ward_code === ward && a.bed === n)!.id
  const at = (ms: number) => {
    clock.t = ms
  }
  const read = async (id: number | string, staff = SANA) => {
    const res = await request(`/api/admissions/${id}/nutrition`, { method: 'GET' }, { staff })
    return { status: res.status, body: (await res.json()) as Body<NutritionView> }
  }
  /** A meal by hand, charted and recorded at `when`. */
  const meal = async (id: number, kind: MealInput['meal'], portion: MealInput['portion'], when: number, o: Partial<MealInput> = {}) => {
    at(when)
    return (await store.addMeal(id, { meal: kind, portion, source: 'manual', ...o }, ANITA))!
  }
  return { clock, store, u, bed, at, read, meal }
}

function captureLogs(t: TestContext) {
  const lines: string[] = []
  for (const m of ['log', 'error', 'warn', 'info'] as const) {
    t.mock.method(console, m, (...args: unknown[]) => void lines.push(args.map(String).join(' ')))
  }
  return lines
}

const RENAL: CareInput<'diet'> = { type: 'renal', texture: 7, kcal: 1800, protein_g: 60 }

describe('patient nutrition read', () => {
  it("[charting/nutrition] Patient nutrition read: Priya's food chart", async () => {
    const t = await setup(new Date(2026, 9, 31, 7).getTime())
    const id = await t.bed('3A', '6')
    await t.meal(id, 'breakfast', 100, new Date(2026, 9, 31, 8).getTime())
    const voided = await t.meal(id, 'lunch', 100, nov(1, 13))
    t.at(nov(1, 13, 30))
    assert.ok((await t.store.voidMeal(voided.id, 'wrong bed', ANITA)).ok)
    const dinner = await t.meal(id, 'dinner', 25, nov(2, 19))
    const breakfast = await t.meal(id, 'breakfast', 50, nov(3, 8))
    const snack = await t.meal(id, 'snack', 0, nov(3, 10, 30), { fluid_ml: 150, items: 'tea' })
    const lunch = await t.meal(id, 'lunch', 0, nov(3, 13))
    t.at(nov(3, 15))
    const r = await t.read(id)
    assert.equal(r.status, 200)
    assert.equal(r.body.since, iso(nov(1, 0)))
    assert.deepEqual(
      r.body.meals.map((m) => m.id),
      [lunch.id, snack.id, breakfast.id, dinner.id, voided.id],
    )
    assert.deepEqual(r.body.days, [
      { date: '2026-11-03', meals: 2, poor_meals: 2 },
      { date: '2026-11-02', meals: 1, poor_meals: 1 },
      { date: '2026-11-01', meals: 0, poor_meals: 0 },
    ])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/nutrition] Patient nutrition read: Diet and assignments', async () => {
    // The roster also has Joel Mathew (id 12, dietitian, `wards` 3A).
    const t = await setup(nov(3, 7), async (h) => {
      await h.pg.query("INSERT INTO meniscus.staff (id, name, role) VALUES (12, 'Joel Mathew', 'dietitian')")
      await h.pg.query("INSERT INTO meniscus.staff_ward (staff_id, ward_id, rank) SELECT 12, id, 0 FROM meniscus.ward WHERE code = '3A'")
    })
    const id = await t.bed('HDU', '3')
    t.at(nov(3, 9))
    assert.ok((await t.store.assignDietitian(id, SANA, DIVYA)).ok)
    t.at(nov(3, 10))
    const first = await t.store.setCare(id, 'diet', RENAL, SANA)
    t.at(nov(3, 11))
    assert.ok((await t.store.assignDietitian(id, 12, 12)).ok)
    t.at(nov(3, 12))
    const second = await t.store.setCare(id, 'diet', { ...RENAL, texture: 6 }, DIVYA)
    assert.ok(first && first !== 'forbidden' && second && second !== 'forbidden')
    const v = (await t.read(id)).body
    assert.equal(v.diet?.id, second.order.id)
    assert.deepEqual(
      v.diet_history.map((o) => o.id),
      [second.order.id, first.order.id],
    )
    assert.deepEqual(
      v.assignments.map((a) => [a.staff.id, a.ended_at, a.ended_by?.id ?? null]),
      [
        [12, null, null],
        [SANA, iso(nov(3, 11)), 12],
      ],
    )
    assert.equal(v.nutrition.dietitian?.staff.name, 'Joel Mathew')
  })

  it('[charting/nutrition] Patient nutrition read: Nothing yet', async () => {
    const t = await setup(nov(3, 7))
    const v = (await t.read(await t.bed('5B', '1'))).body
    assert.deepEqual([v.diet, v.diet_history, v.assignments, v.meals, v.referrals], [null, [], [], [], []])
    assert.deepEqual(
      v.days.map((d) => d.meals),
      [0, 0, 0],
    )
    assert.deepEqual(v.nutrition, { dietitian_available: true, dietitian: null, referral: null })
  })

  it('[charting/nutrition] Patient nutrition read: Long diet history', async () => {
    const start = nov(3, 10) - 24 * DAY
    const t = await setup(start)
    const id = await t.bed('HDU', '3')
    for (let i = 0; i < 25; i++) {
      t.at(start + i * DAY)
      await t.store.setCare(id, 'diet', { ...RENAL, kcal: 1800 + i * 50 }, SANA)
    }
    const v = (await t.read(id)).body
    assert.equal(v.diet_history.length, 20)
    assert.deepEqual(
      v.diet_history.map((o) => o.value.kcal),
      Array.from({ length: 20 }, (_, i) => 1800 + (24 - i) * 50),
    )
    assert.equal(v.diet?.id, v.diet_history[0]!.id)
    assert.equal(v.diet_history[0]!.end_at, null)
  })

  it('[charting/nutrition] Patient nutrition read: Unknown admission', async () => {
    const t = await setup(nov(3, 7))
    const r = await t.read(999)
    assert.deepEqual([r.status, r.body.error], [404, 'not_found'])
  })
})

describe('referral history', () => {
  it('[charting/nutrition] Referral history: Two referrals', async (tc) => {
    const t = await setup(nov(1, 8))
    const id = await t.bed('3A', '6')
    const lines = captureLogs(tc)
    t.at(nov(1, 9))
    const old = await t.store.refer(id, { reason: 'weight_loss', note: 'Lost weight at home' }, MEERA)
    assert.ok(old.ok)
    t.at(nov(1, 17))
    await t.store.acknowledgeReferral(old.referral.id, SANA)
    await t.store.closeReferral(old.referral.id, { outcome: 'supplements_started', next_review: '2026-11-05' }, SANA)
    t.at(nov(3, 14, 5))
    const open = await t.store.refer(id, { reason: 'poor_intake', note: null }, ANITA)
    assert.ok(open.ok)
    const v = (await t.read(id)).body
    assert.deepEqual(
      v.referrals.map((r) => r.id),
      [open.referral.id, old.referral.id],
    )
    const closed = v.referrals[1]!
    assert.equal(closed.note, 'Lost weight at home')
    assert.deepEqual(closed.closed_by, SANA_REF)
    assert.equal(closed.outcome, 'supplements_started')
    assert.equal(closed.next_review, '2026-11-05')
    assert.equal(v.nutrition.referral?.id, open.referral.id)
    assert.ok(!lines.some((l) => l.includes('Lost weight')), 'a referral note was logged')
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/nutrition] Referral history: Long history', async () => {
    const start = nov(3, 9) - 25 * DAY
    const t = await setup(start)
    const id = await t.bed('3A', '6')
    const ids: number[] = []
    for (let i = 0; i < 25; i++) {
      t.at(start + i * DAY)
      const r = await t.store.refer(id, { reason: 'diet_query', note: null }, ANITA)
      assert.ok(r.ok)
      t.at(start + i * DAY + 3_600_000)
      await t.store.closeReferral(r.referral.id, { outcome: 'no_action_needed', next_review: null }, SANA)
      ids.push(r.referral.id)
    }
    const v = (await t.read(id)).body
    assert.deepEqual(
      v.referrals.map((r) => r.id),
      ids.slice(5).reverse(),
    )
  })
})
