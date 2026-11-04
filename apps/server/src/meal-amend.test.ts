import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AdmissionSummary, DishValue, EntryList, Meal, MealReadResult, MediaRef } from '@meniscus/shared'
import type { MealModelOutput } from './ai/meal.ts'
import type { Store } from './store/port.ts'
import { openPgStore } from './store/pg/store.ts'
import { msg, resp, testApp, testDb, testStore, upstream } from './testing.ts'

/** Local time on 3 Nov 2026. */
const nov3 = (h: number, m = 0) => new Date(2026, 10, 3, h, m).getTime()
const ANITA = 4
const RAVI = 1
const SUNITA = 2
const LAKSHMI = 10
const SANA = 11

/** A staged tray: JPEG markers around filler, no picture. */
const trayJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x7a, 0xff, 0xd9])
const SPARK: MealModelOutput = {
  dishes: [
    { region: 1, name: 'rice', dish_kind: 'rice', eaten: 'half' },
    { region: 2, name: 'dal', dish_kind: 'dal_lentils', eaten: 'all' },
  ],
  eaten: 'three_quarters',
  fluids: [],
  confidence: 0.9,
  issues: [],
  notes: null,
}
const RICE_50: DishValue = { index: 1, name: 'rice', dish_kind: 'rice', portion: 50 }
const DAL_100: DishValue = { index: 2, name: 'dal', dish_kind: 'dal_lentils', portion: 100 }

async function setup(given?: (clock: { t: number }) => Promise<Store>, openedAt = nov3(7)) {
  const clock = { t: openedAt }
  const store = given ? await given(clock) : await testStore(() => clock.t)
  const u = upstream({ spark: () => resp('muse-spark-1.3', [msg(JSON.stringify(SPARK))]) })
  const { request } = await testApp({ ai: u.ai, store })
  const call = async <T>(method: string, path: string, o: { body?: unknown; staff?: number; form?: FormData } = {}) => {
    const init: RequestInit = { method }
    if (o.form) init.body = o.form
    else if (o.body !== undefined) {
      init.body = JSON.stringify(o.body)
      init.headers = { 'content-type': 'application/json' }
    }
    const res = await request(path, init, o.staff !== undefined ? { staff: o.staff } : {})
    return { status: res.status, body: (await res.json()) as T & { error?: string } }
  }
  const bed = async (ward: string, n: string) => (await store.admissions()).find((a) => a.ward_code === ward && a.bed === n)!.id
  const amend = (mealId: number, body: unknown, staff = ANITA) => call<Meal>('POST', `/api/meals/${mealId}/amend`, { body, staff })
  const meals = async (id: number) => (await call<Meal[]>('GET', `/api/admissions/${id}/meals`)).body
  const mealOf = async (id: number, mealId: number) => (await meals(id)).find((m) => m.id === mealId)!
  /** Bed 3A-6's photo lunch from a tray read: portion 75, items `rice, dal`, 150 mL, dishes rice 50 and dal 100. */
  const lunch = async (o: { dishes?: DishValue[]; items?: string } = {}) => {
    const id = await bed('3A', '6')
    clock.t = nov3(13, 9)
    const f = new FormData()
    f.set('image', new File([trayJpeg], 'tray.jpg', { type: 'image/jpeg' }))
    const read = (await call<MealReadResult>('POST', '/api/ai/meal', { form: f, staff: RAVI })).body
    const up = new FormData()
    up.set('file', new File([trayJpeg], 'tray.jpg', { type: 'image/jpeg' }))
    up.set('kind', 'photo')
    const photo = (await call<MediaRef>('POST', `/api/admissions/${id}/media`, { form: up, staff: RAVI })).body
    clock.t = nov3(13, 10)
    const { mode, image_sha256, reading, segmentation, comparison, warnings, trace } = read
    const saved = await call<Meal>('POST', `/api/admissions/${id}/meals`, {
      body: {
        meal: 'lunch',
        portion: 75,
        items: o.items ?? 'rice, dal',
        fluid_ml: 150,
        source: 'photo',
        dishes: o.dishes ?? [RICE_50, DAL_100],
        media_id: photo.id,
        evidence: { mode, image_sha256, reading, segmentation, comparison, warnings, trace },
      },
      staff: RAVI,
    })
    assert.equal(saved.status, 201, JSON.stringify(saved.body))
    return { id, meal: saved.body, photo }
  }
  /** What an amendment never touches, as JSON. */
  const untouched = async (id: number, m: Meal) => {
    const now = await mealOf(id, m.id)
    const entries = (await call<EntryList>('GET', `/api/admissions/${id}/entries`)).body.entries.find((e) => e.id === now.entry_id)
    return JSON.stringify([now.evidence, now.proof, now.fluid_ml, now.media, now.entry_id, entries])
  }
  return { clock, store, u, call, bed, amend, meals, mealOf, lunch, untouched }
}

const RICE_ALL_DAL_ALL = [
  { index: 1, name: 'rice', dish_kind: 'rice', portion: 100 },
  { index: 2, name: 'dal', dish_kind: 'dal_lentils', portion: 100 },
]

describe('amend a meal', () => {
  it('[charting/meals] Amend a meal: Rice finished after all', async () => {
    const t = await setup()
    const { id, meal } = await t.lunch()
    const before = await t.untouched(id, meal)
    const sent = t.u.requests.length
    t.clock.t = nov3(14, 30)
    const r = await t.amend(meal.id, { dishes: RICE_ALL_DAL_ALL, reason: 'tray rechecked' })
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.dishes, r.body.items, r.body.portion], [RICE_ALL_DAL_ALL, 'rice, dal', 75])
    assert.equal(r.body.amended_at, new Date(nov3(14, 30)).toISOString())
    assert.equal(r.body.fluid_ml, 150)
    assert.equal(await t.untouched(id, meal), before)
    assert.equal(t.u.requests.length, sent)
  })

  it('[charting/meals] Amend a meal: Portion only', async () => {
    const t = await setup()
    const id = await t.bed('3A', '6')
    const b = await t.call<Meal>('POST', `/api/admissions/${id}/meals`, {
      body: { meal: 'breakfast', portion: 50, items: 'toast', source: 'manual' },
    })
    const r = await t.amend(b.body.id, { portion: 25, reason: 'half the toast left' })
    assert.deepEqual([r.status, r.body.portion, r.body.items], [200, 25, 'toast'])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/meals] Amend a meal: Amended portion counts', async () => {
    // Opened the day before, as dietitian's tests do, so the dinner falls after admission.
    const t = await setup(undefined, new Date(2026, 10, 2, 9).getTime())
    const id = await t.bed('3A', '6')
    t.clock.t = nov3(14)
    const post = (meal: string, at: number) =>
      t.call<Meal>('POST', `/api/admissions/${id}/meals`, {
        body: { meal, portion: 25, source: 'manual', charted_at: new Date(at).toISOString() },
        staff: RAVI,
      })
    await post('dinner', nov3(14) - 19 * 3_600_000)
    await post('breakfast', nov3(8))
    const latest = (await post('lunch', nov3(13))).body
    const kinds = async () =>
      (await t.call<AdmissionSummary[]>('GET', '/api/admissions')).body.find((a) => a.id === id)!.alerts.map((a) => a.kind)
    assert.ok((await kinds()).includes('poor_meal_intake'))
    assert.equal((await t.amend(latest.id, { portion: 100, reason: 'patient ate it later' })).status, 200)
    assert.ok(!(await kinds()).includes('poor_meal_intake'))
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/meals] Amend a meal: Refused amendments', async () => {
    const t = await setup()
    const { id, meal } = await t.lunch()
    const before = JSON.stringify(await t.mealOf(id, meal.id))
    const bad = [
      { portion: 100, reason: 'ok' },
      { portion: 75, reason: 'checked again' },
      { dishes: [{ ...RICE_50, dish_kind: 'pizza' }], reason: 'tray rechecked' },
      { portion: 40, reason: 'tray rechecked' },
      { fluid_ml: 200, reason: 'tray rechecked' },
    ]
    for (const body of bad) {
      const r = await t.amend(meal.id, body)
      assert.deepEqual([r.status, r.body.error], [400, 'invalid_request'], JSON.stringify(body))
    }
    assert.equal(JSON.stringify(await t.mealOf(id, meal.id)), before)
    assert.equal((await t.call('POST', `/api/meals/${meal.id}/void`, { body: { reason: 'wrong bed' } })).status, 200)
    const voided = await t.amend(meal.id, { portion: 100, reason: 'all eaten' })
    assert.deepEqual([voided.status, voided.body.error], [409, 'voided'])
    const unknown = await t.amend(9999, { portion: 100, reason: 'all eaten' })
    assert.deepEqual([unknown.status, unknown.body.error], [404, 'not_found'])
  })
})

describe('amended dishes set the items', () => {
  it('[charting/meals] Amended dishes set the items: Dish renamed', async () => {
    const t = await setup()
    const { meal } = await t.lunch()
    const r = await t.amend(meal.id, { dishes: [RICE_50, { ...DAL_100, name: 'sambar' }], reason: 'it was sambar' })
    assert.deepEqual([r.status, r.body.items], [200, 'rice, sambar'])
  })

  it('[charting/meals] Amended dishes set the items: List order kept', async () => {
    const t = await setup()
    const rice = { index: 1, name: 'rice', dish_kind: 'rice', portion: 50 } as const
    const dal = { index: 0, name: 'dal', dish_kind: 'dal_lentils', portion: 100 } as const
    const { meal } = await t.lunch({ dishes: [rice, dal] })
    const r = await t.amend(meal.id, { dishes: [{ ...rice, portion: 100 }, dal], reason: 'tray rechecked' })
    assert.deepEqual([r.status, r.body.items], [200, 'rice, dal'])
  })

  it('[charting/meals] Amended dishes set the items: Items with dishes', async () => {
    const t = await setup()
    const { id, meal } = await t.lunch()
    const sambar = [RICE_50, { ...DAL_100, name: 'sambar' }]
    assert.equal((await t.amend(meal.id, { dishes: sambar, reason: 'it was sambar' })).status, 200)
    const both = await t.amend(meal.id, { items: 'rice', dishes: sambar, reason: 'just rice' })
    const alone = await t.amend(meal.id, { items: 'rice', reason: 'just rice' })
    assert.deepEqual([both.status, both.body.error, alone.status, alone.body.error], [400, 'invalid_request', 400, 'invalid_request'])
    assert.equal((await t.mealOf(id, meal.id)).items, 'rice, sambar')
  })
})

describe('meal amendments need a nurse', () => {
  it('[charting/meals] Meal amendments need a nurse: Attendant amends', async () => {
    const t = await setup()
    const { id, meal } = await t.lunch()
    const r = await t.amend(meal.id, { portion: 100, reason: 'all eaten' }, RAVI)
    assert.deepEqual([r.status, r.body.error], [403, 'forbidden'])
    const now = await t.mealOf(id, meal.id)
    assert.deepEqual([now.portion, now.amendments], [75, []])
  })

  it('[charting/meals] Meal amendments need a nurse: Role checked first', async () => {
    const t = await setup()
    const r = await t.amend(9999, {}, SUNITA)
    assert.deepEqual([r.status, r.body.error], [403, 'forbidden'])
  })

  it('[charting/meals] Meal amendments need a nurse: Dietitian amends', async () => {
    const t = await setup()
    const { id, meal } = await t.lunch()
    const before = JSON.stringify(await t.mealOf(id, meal.id))
    const r = await t.amend(meal.id, { portion: 100, reason: 'all eaten' }, SANA)
    assert.deepEqual([r.status, r.body.error], [403, 'forbidden'])
    assert.equal(JSON.stringify(await t.mealOf(id, meal.id)), before)
  })

  it('[charting/meals] Meal amendments need a nurse: Matron amends', async () => {
    const t = await setup()
    const { meal } = await t.lunch()
    const r = await t.amend(meal.id, { portion: 100, reason: 'all eaten' }, LAKSHMI)
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.amendments[0]!.by, { id: 10, name: 'Lakshmi Iyer', role: 'matron' })
  })
})

describe('meal amendment history', () => {
  /** The lunch amended at 14:30 by Anita Thomas (rice 50 → 100) and at 15:10 by Lakshmi Iyer (portion 75 → 100). */
  async function twice(t: Awaited<ReturnType<typeof setup>>) {
    const l = await t.lunch()
    t.clock.t = nov3(14, 30)
    assert.equal((await t.amend(l.meal.id, { dishes: [{ ...RICE_50, portion: 100 }, DAL_100], reason: 'tray rechecked' })).status, 200)
    t.clock.t = nov3(15, 10)
    assert.equal((await t.amend(l.meal.id, { portion: 100, reason: 'patient finished it' }, LAKSHMI)).status, 200)
    return l
  }

  it('[charting/meals] Meal amendment history: Two amendments', async () => {
    const t = await setup()
    const { id, meal } = await twice(t)
    const m = await t.mealOf(id, meal.id)
    const rice100 = { ...RICE_50, portion: 100 }
    assert.deepEqual(
      m.amendments.map(({ id: _, ...a }) => a),
      [
        {
          at: new Date(nov3(14, 30)).toISOString(),
          by: { id: 4, name: 'Anita Thomas', role: 'nurse' },
          reason: 'tray rechecked',
          before: { portion: 75, items: 'rice, dal', dishes: [RICE_50, DAL_100] },
          after: { portion: 75, items: 'rice, dal', dishes: [rice100, DAL_100] },
        },
        {
          at: new Date(nov3(15, 10)).toISOString(),
          by: { id: 10, name: 'Lakshmi Iyer', role: 'matron' },
          reason: 'patient finished it',
          before: { portion: 75, items: 'rice, dal', dishes: [rice100, DAL_100] },
          after: { portion: 100, items: 'rice, dal', dishes: [rice100, DAL_100] },
        },
      ],
    )
    assert.equal(m.amended_at, new Date(nov3(15, 10)).toISOString())
  })

  it('[charting/meals] Meal amendment history: Database refuses changes', async () => {
    const h = await testDb()
    const t = await setup((clock) => openPgStore(h.db, { now: () => clock.t }))
    const { id, meal } = await twice(t)
    const kept = (await t.mealOf(id, meal.id)).amendments
    await assert.rejects(
      h.pg.query("UPDATE meniscus.meal_event SET reason = 'x'"),
      (e: { code?: string; message?: string }) => e.code === 'P0001' && /kept as written/.test(e.message ?? ''),
    )
    await assert.rejects(
      h.pg.query('DELETE FROM meniscus.meal_event'),
      (e: { code?: string; message?: string }) => e.code === 'P0001' && /kept as written/.test(e.message ?? ''),
    )
    assert.deepEqual((await t.mealOf(id, meal.id)).amendments, kept)
  })

  it('[charting/meals] Meal amendment history: Kept after a void', async () => {
    const t = await setup()
    const { id, meal } = await twice(t)
    assert.equal((await t.call('POST', `/api/meals/${meal.id}/void`, { body: { reason: 'wrong bed' } })).status, 200)
    const m = await t.mealOf(id, meal.id)
    assert.equal(m.amendments.length, 2)
    assert.ok(m.voided_at)
  })

  it('a migrated database has meal_event, its trigger and the served-photo indexes', async () => {
    const h = await testDb()
    await (await openPgStore(h.db)).close()
    const names = (
      await h.pg.query<{ name: string }>(
        `SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'meniscus' AND (indexname LIKE 'meal_%' OR indexname = 'media_served')
         UNION SELECT table_name FROM information_schema.tables WHERE table_schema = 'meniscus' AND table_name LIKE 'meal_%'
         UNION SELECT tgname FROM pg_trigger WHERE tgname LIKE 'meal_%'`,
      )
    ).rows
      .map((r) => r.name)
      .sort()
    const cols = async (t: string) =>
      (
        await h.pg.query<{ name: string }>(
          `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = 'meniscus' AND table_name = $1`,
          [t],
        )
      ).rows.map((c) => c.name)
    const [media, meal] = [await cols('media'), await cols('meal')]
    for (const n of ['media_served', 'meal_event', 'meal_event_kept', 'meal_event_meal', 'meal_served_media']) {
      assert.ok(names.includes(n), n)
    }
    assert.ok(media.includes('served_meal'))
    assert.ok(meal.includes('served_media_id') && meal.includes('amended_at'))
  })
})
