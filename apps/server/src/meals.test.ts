import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import type {
  AdmissionSummary,
  Entry,
  EntryEvent,
  EntryList,
  Meal,
  MealEvidenceInput,
  MealInput,
  MealReadResult,
  MediaRef,
} from '@meniscus/shared'
import {
  MASK_GRID,
  MAX_ENTRY_ML,
  MAX_MEAL_ITEMS,
  MAX_READ_WARNINGS,
  MAX_TRAY_REGIONS,
  MAX_WARNING_CHARS,
  MAX_TRACE_STEPS,
  MATCH_MAX_DISTANCE,
  MEAL_ISSUES,
} from '@meniscus/shared'
import { MEAL_BOUNDS, type MealModelOutput } from './ai/meal.ts'
import { MealEvidenceSchema } from './routes/evidence.ts'
import type { MemoryMediaStore } from './store/media/memory.ts'
import type { Store } from './store/port.ts'
import { openPgStore } from './store/pg/store.ts'
import {
  SAM_RECT,
  SAM_TEXT,
  SAM_TEXT_AT,
  dataUrl,
  imageOf,
  msg,
  png,
  resp,
  testApp,
  testDb,
  testStore,
  upstream,
  type Upstream,
} from './testing.ts'

const HOUR = 3_600_000
/** 2 Nov 2026, 12:00 UTC; demo patients are admitted two days earlier. */
const NOW = Date.UTC(2026, 10, 2, 12)

/** Synthetic tray photos: JPEG markers around filler, no real image. */
const photoA = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x41, 0xff, 0xd9])
const photoB = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x42, 0xff, 0xd9])
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

/** Spark reads rice in dish 1 (half) and dal in dish 2 (all), with 150 mL of soup; SAM finds those two dishes. */
const RICE_AND_DAL: MealModelOutput = {
  dishes: [
    { region: 1, name: 'rice', dish_kind: 'rice', eaten: 'half' },
    { region: 2, name: 'dal', dish_kind: 'dal_lentils', eaten: 'all' },
  ],
  eaten: 'three_quarters',
  fluids: [{ region: 0, name: 'soup', fluid_kind: 'soup', volume_ml: 150 }],
  confidence: 0.82,
  issues: [],
  notes: null,
}
const TRAY_UPSTREAM: Upstream = {
  sam: (prompt) =>
    resp('sam-3.1', [
      msg(
        prompt === 'dish'
          ? SAM_TEXT_AT({ left: 100, top: 80, right: 400, bottom: 480 }, { left: 500, top: 100, right: 600, bottom: 200 })
          : SAM_TEXT,
      ),
    ]),
  spark: () => resp('muse-spark-1.3', [msg(JSON.stringify(RICE_AND_DAL))]),
}
const evidenceOf = (r: MealReadResult): MealEvidenceInput => ({
  mode: r.mode,
  image_sha256: r.image_sha256,
  reading: r.reading,
  segmentation: r.segmentation,
  comparison: r.comparison,
  warnings: r.warnings,
  trace: r.trace,
})
/** `n` Devanagari characters: 3 bytes each in UTF-8. */
const deva = (n: number) => 'क'.repeat(n)
/** A read grown to every bound a meal's evidence allows, a full comparison included: the worst case the 64 KB limit is sized for. */
function largestEvidence(read: MealEvidenceInput): MealEvidenceInput {
  const box = { left: 19_999, top: 19_999, right: 20_000, bottom: 20_000, confidence: 0.987654321 }
  const cells = Buffer.alloc((MASK_GRID * MASK_GRID) / 8, 0xa5).toString('base64')
  assert.equal(cells.length, 172)
  const mask = { width: MASK_GRID, height: MASK_GRID, bits: cells }
  const name = deva(MEAL_BOUNDS.name)
  return {
    ...read,
    reading: {
      items: Array.from({ length: MEAL_BOUNDS.items }, () => ({ name, portion: 75 }) as const),
      dishes: Array.from(
        { length: MEAL_BOUNDS.items },
        () =>
          ({
            index: MAX_TRAY_REGIONS,
            name,
            dish_kind: 'curry_vegetables',
            portion: 75,
            basis: 'measured',
            box,
            coverage: 0.987654321,
            model_portion: 25,
            measure: { served_index: MAX_TRAY_REGIONS, served_coverage: 0.987654321 },
          }) as const,
      ),
      portion: 75,
      fluids: Array.from(
        { length: MEAL_BOUNDS.fluids },
        () => ({ index: MAX_TRAY_REGIONS, name, fluid_kind: 'water', volume_ml: MEAL_BOUNDS.ml }) as const,
      ),
      confidence: 0.987654321,
      issues: [...MEAL_ISSUES],
      notes: deva(MEAL_BOUNDS.notes),
    },
    segmentation: {
      regions: Array.from({ length: MAX_TRAY_REGIONS }, (_, i) => ({ index: i + 1, box, coverage: 0.987654321, mask, food: mask })),
      loose_food: 0.987654321,
    },
    comparison: {
      served_media_id: 999_999_999,
      served_sha256: 'f'.repeat(64),
      served_at: '2026-11-02T12:00:00.000+05:30',
      size: { width: 65_535, height: 65_535 },
      served_size: { width: 65_535, height: 65_535 },
      served: {
        regions: Array.from({ length: MAX_TRAY_REGIONS }, (_, i) => ({ index: i + 1, box, coverage: 0.987654321, mask, food: mask })),
        loose_food: 0.987654321,
      },
      matches: Array.from({ length: MAX_TRAY_REGIONS }, (_, i) => ({ index: i + 1, served_index: i + 1, distance2: MATCH_MAX_DISTANCE })),
    },
    warnings: Array.from({ length: MAX_READ_WARNINGS }, () => deva(MAX_WARNING_CHARS)),
    trace: Array.from({ length: MAX_TRACE_STEPS }, (_, i) => read.trace[i % read.trace.length]!).map((s) => ({
      ...s,
      step: s.step.padEnd(32, '_'),
      model: s.model.padEnd(64, '_'),
      input_tokens: 999_999,
      output_tokens: 999_999,
      reasoning_tokens: 999_999,
    })),
  }
}
const RICE_ALL = { index: 1, name: 'rice', dish_kind: 'rice', portion: 100 } as const
const DAL_HALF = { index: 2, name: 'dal', dish_kind: 'dal_lentils', portion: 50 } as const

async function setup(o: { store?: Store; upstream?: Upstream } = {}) {
  const clock = { t: NOW - 48 * HOUR }
  const store = o.store ?? (await testStore(() => clock.t))
  clock.t = NOW
  const u = upstream(o.upstream ?? TRAY_UPSTREAM)
  const app = await testApp({ ai: u.ai, store })
  const json = async <T>(path: string, init: { body?: unknown; staff?: number } = {}) => {
    const headers: Record<string, string> = {}
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    if (init.staff !== undefined) headers['x-staff-id'] = String(init.staff)
    const res = await app.request(path, {
      method: init.body === undefined ? 'GET' : 'POST',
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
    return { status: res.status, body: (await res.json()) as T & { error?: string } }
  }
  const bed = async (n: string) =>
    (await json<AdmissionSummary[]>('/api/admissions')).body.find((a) => a.bed === n && a.ward_code === '5B')!
  const meal = (admissionId: number, m: Partial<MealInput>, staff?: number) =>
    json<Meal>(`/api/admissions/${admissionId}/meals`, {
      body: { meal: 'lunch', portion: 50, source: 'manual', ...m },
      ...(staff !== undefined ? { staff } : {}),
    })
  const meals = (admissionId: number) => json<Meal[]>(`/api/admissions/${admissionId}/meals`)
  const voidMeal = (mealId: number, reason: string, staff?: number) =>
    json<Meal>(`/api/meals/${mealId}/void`, { body: { reason }, ...(staff !== undefined ? { staff } : {}) })
  const upload = async (admissionId: number, bytes: Uint8Array<ArrayBuffer>, staff?: number) => {
    const form = new FormData()
    form.set('file', new File([bytes], 'tray.jpg', { type: 'image/jpeg' }))
    form.set('kind', 'photo')
    const headers: Record<string, string> = staff === undefined ? {} : { 'x-staff-id': String(staff) }
    return (await (await app.request(`/api/admissions/${admissionId}/media`, { method: 'POST', body: form, headers })).json()) as MediaRef
  }
  const readTray = async (bytes: Uint8Array<ArrayBuffer>) => {
    const form = new FormData()
    form.set('image', new File([bytes], 'tray.jpg', { type: 'image/jpeg' }))
    return (await (await app.request('/api/ai/meal', { method: 'POST', body: form })).json()) as MealReadResult
  }
  /** A photo lunch from a tray read of `bytes`, uploaded as its photo. */
  const trayLunch = async (admissionId: number, bytes: Uint8Array<ArrayBuffer>, over: Partial<MealInput> = {}, staff?: number) => {
    const read = await readTray(bytes)
    const photo = await upload(admissionId, bytes, staff)
    const body: Partial<MealInput> = {
      meal: 'lunch',
      portion: 75,
      items: 'rice, dal',
      fluid_ml: 150,
      source: 'photo',
      confidence: read.reading.confidence,
      dishes: [RICE_ALL, DAL_HALF],
      media_id: photo.id,
      evidence: evidenceOf(read),
      ...over,
    }
    return { read, photo, body, saved: await meal(admissionId, body, staff) }
  }
  /** A photo upload, as served for `served_meal` when given; the raw response. */
  const uploadAs = async (
    admissionId: number,
    bytes: Uint8Array,
    o: { served_meal?: string; kind?: string; staff?: number; type?: string } = {},
  ) => {
    const form = new FormData()
    form.set('file', new File([bytes], 'upload', { type: o.type ?? 'image/png' }))
    form.set('kind', o.kind ?? 'photo')
    if (o.served_meal !== undefined) form.set('served_meal', o.served_meal)
    const headers: Record<string, string> = o.staff === undefined ? {} : { 'x-staff-id': String(o.staff) }
    const res = await app.request(`/api/admissions/${admissionId}/media`, { method: 'POST', body: form, headers })
    return { status: res.status, body: (await res.json()) as MediaRef & { error?: string } }
  }
  /** A tray read of PNG bytes for the bed and meal. */
  const readFor = async (bytes: Uint8Array, admissionId: number, mealKind = 'lunch') => {
    const form = new FormData()
    form.set('image', new File([bytes], 'tray.png', { type: 'image/png' }))
    form.set('admission_id', String(admissionId))
    form.set('meal', mealKind)
    return (await (await app.request('/api/ai/meal', { method: 'POST', body: form })).json()) as MealReadResult
  }
  const servedTray = (admissionId: number) => json<{ media: MediaRef | null }>(`/api/admissions/${admissionId}/served-tray`)
  return { clock, u, app, store, json, bed, meal, meals, voidMeal, upload, readTray, trayLunch, uploadAs, readFor, servedTray }
}

const SERVED_PNG = png(1000, 800, 41)
const COLLECTED_PNG = png(1000, 800, 42)
const DISH_1 = { left: 100, top: 80, right: 400, bottom: 480 }
const DISH_2 = { left: 500, top: 100, right: 700, bottom: 300 }
/** SAM per photo: the same two dishes on each; food on dish 1 covers 0.8 when served and 0.4 when collected. */
const COMPARE_UPSTREAM: Upstream = {
  sam: (prompt, body) => {
    const served = imageOf(body) === dataUrl(SERVED_PNG, 'image/png')
    if (prompt === 'dish') return resp('sam-3.1', [msg(SAM_RECT(DISH_1, DISH_2))])
    return resp('sam-3.1', [msg(SAM_RECT({ ...DISH_1, bottom: served ? 400 : 240 }))])
  },
  spark: () => resp('muse-spark-1.3', [msg(JSON.stringify(RICE_AND_DAL))]),
}
const at = (h: number, m: number) => Date.UTC(2026, 10, 2, h, m)
const RAVI = { id: 1, name: 'Ravi Kumar', role: 'attendant' }

describe('meals', () => {
  it('[charting/meals] Record a meal: Lunch by hand', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    const r = await t.meal(b1.id, { meal: 'lunch', portion: 50, items: 'rice, dal', source: 'manual' }, 1)
    assert.equal(r.status, 201)
    assert.equal(r.body.meal, 'lunch')
    assert.equal(r.body.portion, 50)
    assert.equal(r.body.items, 'rice, dal')
    assert.equal(r.body.fluid_ml, null)
    assert.equal(r.body.entry_id, null)
    assert.equal(r.body.entry_status, null)
    assert.equal(r.body.late, false)
    assert.deepEqual(r.body.created_by, { id: 1, name: 'Ravi Kumar', role: 'attendant' })
    assert.equal(r.body.created_at, new Date(NOW).toISOString())
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/meals] Record a meal: Invalid meals', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    const evidence = { reading: { items: [], portion: 0, fluids: [], confidence: 0.5, issues: [], notes: null }, trace: [] }
    const bad = [
      { portion: 40 },
      { meal: 'brunch' },
      { fluid_ml: 0 },
      { fluid_ml: 150.5 },
      { source: 'manual', evidence },
      { charted_at: new Date(NOW - 25 * HOUR).toISOString() },
    ] as unknown as Partial<MealInput>[]
    for (const b of bad) {
      const r = await t.meal(b1.id, b)
      assert.equal(r.status, 400, JSON.stringify(b))
      assert.equal(r.body.error, 'invalid_request')
    }
    const staff = await t.meal(b1.id, {}, 999)
    assert.equal(staff.status, 400)
    assert.equal(staff.body.error, 'invalid_request')
    assert.deepEqual((await t.meals(b1.id)).body, [])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/meals] Record a meal: Unknown admission', async () => {
    const t = await setup()
    const r = await t.meal(9999, {})
    assert.equal(r.status, 404)
    assert.equal(r.body.error, 'not_found')
    assert.equal((await t.meals(9999)).status, 404)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/meals] Meal fluid becomes a pending entry: Soup with dinner', async () => {
    const t = await setup()
    const b2 = await t.bed('2')
    const before = b2.totals
    const r = await t.meal(b2.id, { meal: 'dinner', portion: 75, items: 'soup, roti', fluid_ml: 200, source: 'manual' }, 2)
    assert.equal(r.status, 201)
    const list = (await t.json<EntryList>(`/api/admissions/${b2.id}/entries`)).body
    const soup = list.entries.find((e) => e.id === r.body.entry_id)
    assert.ok(soup)
    assert.equal(soup.status, 'pending')
    assert.equal(soup.direction, 'in')
    assert.equal(soup.category, 'food')
    assert.equal(soup.volume_ml, 200)
    assert.equal(soup.item, 'Dinner: soup, roti')
    assert.equal(soup.confidence, null)
    assert.equal(soup.created_at, r.body.created_at)
    assert.deepEqual(soup.created_by, { id: 2, name: 'Sunita Devi', role: 'attendant' })
    assert.equal(r.body.entry_status, 'pending')
    assert.equal(list.totals.pending_ml, before.pending_ml + 200)
    assert.equal(list.totals.in_ml, before.in_ml)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/meals] Meal fluid becomes a pending entry: Long items', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    const m = (await t.meal(b1.id, { meal: 'breakfast', items: 'i'.repeat(200), fluid_ml: 100 })).body
    const entry = (await t.json<EntryList>(`/api/admissions/${b1.id}/entries`)).body.entries.find((e) => e.id === m.entry_id)!
    assert.ok(entry.item?.startsWith('Breakfast: '))
    assert.equal(entry.item!.length, 200)
    assert.equal(m.items?.length, 200)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/meals] Meals of the last day: Two meals', async () => {
    const t = await setup()
    const b3 = await t.bed('3')
    const at = (h: number) => new Date(NOW - h * HOUR).toISOString()
    const breakfast = await t.meal(b3.id, { meal: 'breakfast', charted_at: at(6) })
    const lunch = await t.meal(b3.id, { meal: 'lunch', charted_at: at(1) })
    // 25 h ago is outside the charted_at range, so it is saved at that time instead.
    t.clock.t = NOW - 25 * HOUR
    const dinner = await t.meal(b3.id, { meal: 'dinner' })
    t.clock.t = NOW
    assert.equal(dinner.status, 201)
    const r = await t.meals(b3.id)
    assert.equal(r.status, 200)
    assert.deepEqual(
      r.body.map((m) => m.id),
      [lunch.body.id, breakfast.body.id],
    )
    assert.equal(r.body[1]!.late, true)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/meals] Void a meal: Wrong bed', async () => {
    const t = await setup()
    const b2 = await t.bed('2')
    const dinner = (await t.meal(b2.id, { meal: 'dinner', portion: 75, items: 'soup, roti', fluid_ml: 200 }, 2)).body
    const r = await t.voidMeal(dinner.id, '  wrong bed ', 4)
    assert.equal(r.status, 200)
    assert.equal(r.body.voided_at, new Date(NOW).toISOString())
    assert.equal(r.body.void_reason, 'wrong bed')
    assert.deepEqual(r.body.voided_by, { id: 4, name: 'Anita Thomas', role: 'nurse' })
    assert.equal(r.body.entry_status, 'rejected')
    assert.deepEqual(
      (await t.meals(b2.id)).body.map((m) => [m.id, m.void_reason]),
      [[dinner.id, 'wrong bed']],
    )
    const soup = (await t.json<EntryList>(`/api/admissions/${b2.id}/entries`)).body.entries.find((e) => e.id === dinner.entry_id)!
    assert.equal(soup.status, 'rejected')
    assert.equal(soup.reject_reason, 'other')
    const events = (await t.json<EntryEvent[]>(`/api/entries/${soup.id}/events`)).body
    assert.deepEqual(
      events.map((e) => [e.kind, e.reason, e.note, e.by?.id ?? null]),
      [
        ['recorded', null, null, 2],
        ['rejected', 'other', 'wrong bed', 4],
      ],
    )
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/meals] Void a meal: Void refused', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    const m = (await t.meal(b1.id, {})).body
    assert.equal((await t.voidMeal(m.id, 'duplicate')).status, 200)
    const again = await t.voidMeal(m.id, 'duplicate')
    assert.equal(again.status, 409)
    assert.equal(again.body.error, 'already_voided')
    const missing = await t.voidMeal(9999, 'duplicate')
    assert.equal(missing.status, 404)
    assert.equal(missing.body.error, 'not_found')
    const other = (await t.meal(b1.id, {})).body
    const short = await t.voidMeal(other.id, 'x')
    assert.equal(short.status, 400)
    assert.equal(short.body.error, 'invalid_request')
    const unknownStaff = await t.voidMeal(other.id, 'duplicate', 999)
    assert.equal(unknownStaff.status, 400)
    assert.equal(unknownStaff.body.error, 'invalid_request')
    assert.equal((await t.meals(b1.id)).body.find((x) => x.id === other.id)!.voided_at, null)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/meals] Void a meal: Fluid already approved', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    const m = (await t.meal(b1.id, { meal: 'lunch', fluid_ml: 150 })).body
    await t.json<Entry>(`/api/entries/${m.entry_id}/review`, { body: { action: 'approve' } })
    const approvedIn = (await t.json<EntryList>(`/api/admissions/${b1.id}/entries`)).body.totals.in_ml
    const r = await t.voidMeal(m.id, 'wrong bed')
    assert.equal(r.status, 200)
    assert.notEqual(r.body.voided_at, null)
    assert.equal(r.body.entry_status, 'approved')
    assert.equal((await t.json<EntryList>(`/api/admissions/${b1.id}/entries`)).body.totals.in_ml, approvedIn)
    assert.deepEqual(t.u.requests, [])
  })
})

describe('tray meals', () => {
  it('[charting/meals] Dishes on a meal: Lunch with two dishes', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    const dishes = [RICE_ALL, DAL_HALF]
    const r = await t.meal(b1.id, { source: 'photo', portion: 75, dishes })
    assert.equal(r.status, 201)
    assert.deepEqual(r.body.dishes, dishes)
    assert.deepEqual((await t.meals(b1.id)).body[0]!.dishes, dishes)
    assert.deepEqual((await t.meal(b1.id, {})).body.dishes, [])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/meals] Dishes on a meal: Invalid dishes', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    const bad = [
      [{ ...RICE_ALL, dish_kind: 'pizza' }],
      [{ ...RICE_ALL, portion: 40 }],
      [{ ...RICE_ALL, name: '' }],
      [{ ...RICE_ALL, index: 13 }],
      Array.from({ length: 21 }, () => RICE_ALL),
    ]
    for (const dishes of bad) {
      const r = await t.meal(b1.id, { source: 'photo', dishes } as unknown as Partial<MealInput>)
      assert.equal(r.status, 400, JSON.stringify(dishes[0]))
      assert.equal(r.body.error, 'invalid_request')
    }
    assert.deepEqual((await t.meals(b1.id)).body, [])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/meals] Tray evidence stored with the meal: Tray read kept', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    const read = await t.readTray(photoA)
    assert.equal(read.segmentation?.regions.length, 2)
    assert.equal(read.trace.length, 3)
    const evidence = { ...evidenceOf(read), warnings: ['photo is dim'] }
    const photo = await t.upload(b1.id, photoA)
    const r = await t.meal(b1.id, { source: 'photo', portion: 75, media_id: photo.id, evidence })
    assert.equal(r.status, 201)
    assert.deepEqual(r.body.evidence, evidence)
    assert.deepEqual((await t.meals(b1.id)).body[0]!.evidence, evidence)
  })

  it('[charting/meals] Tray evidence stored with the meal: Malformed tray evidence', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    const read = await t.readTray(photoA)
    const photo = await t.upload(b1.id, photoA)
    const good = evidenceOf(read)
    const seg = good.segmentation!
    const region = seg.regions[0]!
    const withRegion = (r: object) => ({ ...good, segmentation: { ...seg, regions: [{ ...region, ...r }, ...seg.regions.slice(1)] } })
    const bad = [
      withRegion({ mask: { width: 33, height: 10, bits: Buffer.alloc(42).toString('base64') } }),
      withRegion({ mask: { width: 32, height: 32, bits: 'A'.repeat(200) } }),
      { ...good, segmentation: { ...seg, regions: Array.from({ length: 13 }, (_, i) => ({ ...region, index: Math.min(i + 1, 12) })) } },
      { ...good, trace: [...good.trace, ...good.trace] },
      withRegion({ coverage: 1.5 }),
      { ...good, reading: { ...good.reading, dishes: [{ ...good.reading.dishes[0]!, basis: 'guessed' }] } },
      { ...good, warnings: Array.from({ length: 7 }, () => 'w') },
      { ...good, warnings: ['w'.repeat(201)] },
    ]
    for (const evidence of bad) {
      const r = await t.meal(b1.id, { source: 'photo', portion: 75, media_id: photo.id, evidence } as unknown as Partial<MealInput>)
      assert.equal(r.status, 400)
      assert.equal(r.body.error, 'invalid_request')
    }
    assert.deepEqual((await t.meals(b1.id)).body, [])
    // The same post with the read as returned is saved.
    assert.equal((await t.meal(b1.id, { source: 'photo', portion: 75, media_id: photo.id, evidence: good })).status, 201)
  })

  it('[charting/meals] Tray evidence stored with the meal: Body too large', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    const r = await t.meal(b1.id, { source: 'manual', items: 'x'.repeat(70 * 1024) })
    assert.equal(r.status, 413)
    assert.equal(r.body.error, 'payload_too_large')
    assert.deepEqual((await t.meals(b1.id)).body, [])
    // A real read of photo A, grown to every bound, with names, notes and warnings in a 3-byte UTF-8 script (design §8 "Size").
    const read = await t.readTray(photoA)
    const photo = await t.upload(b1.id, photoA)
    const evidence = largestEvidence(evidenceOf(read))
    const body = {
      source: 'photo',
      portion: 75,
      items: deva(MAX_MEAL_ITEMS),
      fluid_ml: MAX_ENTRY_ML,
      media_id: photo.id,
      evidence,
      dishes: Array.from(
        { length: MEAL_BOUNDS.items },
        () => ({ index: MAX_TRAY_REGIONS, name: deva(MEAL_BOUNDS.name), dish_kind: 'curry_vegetables', portion: 75 }) as const,
      ),
    } satisfies Partial<MealInput>
    assert.ok(Buffer.byteLength(JSON.stringify(evidence)) > 16 * 1024)
    // The limit's headroom is checked, not assumed (design §9): 64 KB is at least 1.4 × the largest post the bounds allow.
    const size = Buffer.byteLength(JSON.stringify({ meal: 'lunch', ...body, served_media_id: 999_999_999 }))
    assert.ok(65_536 >= 1.4 * size, `${size} B`)
    assert.ok(MealEvidenceSchema.safeParse(evidence).success)
    // Its comparison names no real served photo, so it is posted without one.
    evidence.comparison = null
    const ok = await t.meal(b1.id, body)
    assert.equal(ok.status, 201)
    assert.deepEqual(ok.body.evidence, evidence)
    assert.deepEqual(ok.body.dishes, body.dishes)
  })

  it('[charting/meals] Tray evidence bound to its photo: Read and photo of the same bytes', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    const read = await t.readTray(photoA)
    const sent = t.u.requests.length
    const photo = await t.upload(b1.id, photoA)
    const r = await t.meal(b1.id, { source: 'photo', portion: 75, media_id: photo.id, evidence: evidenceOf(read) })
    assert.equal(r.status, 201)
    assert.equal(r.body.evidence?.image_sha256, sha256(photoA))
    assert.equal(r.body.media?.sha256, sha256(photoA))
    assert.equal(r.body.proof?.photo.sha256, sha256(photoA))
    assert.equal(t.u.requests.length, sent)
  })

  it('[charting/meals] Tray evidence bound to its photo: Read of another photo', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    const readA = await t.readTray(photoA)
    await t.upload(b1.id, photoA)
    const b = await t.upload(b1.id, photoB)
    const r = await t.meal(b1.id, { source: 'photo', portion: 75, media_id: b.id, evidence: evidenceOf(readA) })
    assert.equal(r.status, 400)
    assert.equal(r.body.error, 'invalid_request')
    assert.deepEqual((await t.meals(b1.id)).body, [])
  })

  it('[charting/meals] Tray evidence bound to its photo: Evidence without its photo', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    const read = await t.readTray(photoA)
    const r = await t.meal(b1.id, { source: 'photo', portion: 75, evidence: evidenceOf(read) })
    assert.equal(r.status, 400)
    assert.equal(r.body.error, 'invalid_request')
    assert.deepEqual((await t.meals(b1.id)).body, [])
  })

  it('[charting/meals] Tray proof stored with the meal: Lunch proof', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    const read = await t.readTray(photoA)
    t.clock.t = Date.UTC(2026, 10, 2, 13, 9)
    const photo = await t.upload(b1.id, photoA, 1)
    t.clock.t = Date.UTC(2026, 10, 2, 13, 10)
    const r = await t.meal(
      b1.id,
      {
        source: 'photo',
        portion: 75,
        items: 'rice, dal',
        fluid_ml: 150,
        dishes: [RICE_ALL, DAL_HALF],
        media_id: photo.id,
        evidence: evidenceOf(read),
      },
      1,
    )
    assert.equal(r.status, 201)
    const ravi = { id: 1, name: 'Ravi Kumar', role: 'attendant' }
    assert.deepEqual(r.body.proof, {
      photo: { media_id: photo.id, sha256: photo.sha256, captured_by: ravi, captured_at: '2026-11-02T13:09:00.000Z' },
      served: null,
      confirmed: { portion: 75, items: 'rice, dal', fluid_ml: 150, dishes: [RICE_ALL, DAL_HALF] },
      confirmed_by: ravi,
      confirmed_at: '2026-11-02T13:10:00.000Z',
    })
    assert.deepEqual((await t.meals(b1.id)).body[0]!.proof, r.body.proof)
  })

  it('[charting/meals] Tray proof stored with the meal: Proof outlives a void', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    const { saved, photo } = await t.trayLunch(b1.id, photoA)
    assert.equal(saved.status, 201)
    const before = JSON.stringify([saved.body.proof, saved.body.evidence])
    const v = await t.voidMeal(saved.body.id, 'wrong bed')
    assert.equal(v.status, 200)
    assert.equal((await t.app.request(`/api/media/${photo.id}`)).status, 404)
    const after = (await t.meals(b1.id)).body[0]!
    assert.equal(after.media, null)
    assert.equal(JSON.stringify([after.proof, after.evidence]), before)
    assert.equal(after.proof?.photo.sha256, sha256(photoA))
  })

  it('[charting/meals] Tray proof stored with the meal: Database refuses changes', async () => {
    const h = await testDb()
    const t = await setup({ store: await openPgStore(h.db, { now: () => NOW }) })
    const b1 = await t.bed('1')
    const { saved } = await t.trayLunch(b1.id, photoA)
    assert.equal(saved.status, 201)
    await assert.rejects(
      h.pg.query(`UPDATE meniscus.meal SET evidence = '{}' WHERE id = $1`, [saved.body.id]),
      (e: { code?: string; message?: string }) => e.code === 'P0001' && /cannot change/.test(e.message ?? ''),
    )
    await assert.rejects(
      h.pg.query('UPDATE meniscus.meal SET proof = NULL WHERE id = $1', [saved.body.id]),
      (e: { code?: string; message?: string }) => e.code === 'P0001' && /cannot change/.test(e.message ?? ''),
    )
    const now = (await t.meals(b1.id)).body[0]!
    assert.deepEqual([now.evidence, now.proof], [saved.body.evidence, saved.body.proof])
    // Voiding still works with the trigger in place, and a second open adds no second trigger.
    assert.equal((await t.voidMeal(saved.body.id, 'wrong bed')).status, 200)
    await t.store.close()
    await (await openPgStore(h.db, { now: () => NOW })).close()
    const triggers = await h.pg.query("SELECT tgname FROM pg_trigger WHERE tgname = 'meal_evidence_fixed'")
    assert.equal(triggers.rows.length, 1)
  })

  it('[charting/meals] Tray proof stored with the meal: Meal by hand', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    const r = await t.meal(b1.id, { meal: 'breakfast', source: 'manual' })
    assert.equal(r.status, 201)
    assert.equal(r.body.proof, null)
  })
})

describe('served tray photos', () => {
  /** Bed 1 with a served lunch photo at 12:40 (by Ravi), a compared read at 13:30 and the collected photo uploaded. */
  async function compared(o: { upstream?: Upstream } = {}) {
    const t = await setup({ upstream: o.upstream ?? COMPARE_UPSTREAM })
    const b1 = await t.bed('1')
    t.clock.t = at(12, 40)
    const served = (await t.uploadAs(b1.id, SERVED_PNG, { served_meal: 'lunch', staff: 1 })).body
    t.clock.t = at(13, 30)
    const read = await t.readFor(COLLECTED_PNG, b1.id)
    const photo = (await t.uploadAs(b1.id, COLLECTED_PNG, { staff: 1 })).body
    t.clock.t = at(13, 32)
    const body: Partial<MealInput> = {
      source: 'photo',
      portion: 75,
      items: 'rice, dal',
      dishes: [RICE_ALL, DAL_HALF],
      media_id: photo.id,
      served_media_id: served.id,
      evidence: evidenceOf(read),
    }
    return { t, b1, served, read, photo, body }
  }

  it('[charting/meals] Served tray photo: Served lunch', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    t.clock.t = at(12, 40)
    const r = await t.uploadAs(b1.id, SERVED_PNG, { served_meal: 'lunch', staff: 1 })
    assert.equal(r.status, 201)
    assert.deepEqual([r.body.kind, r.body.served_meal, r.body.created_at], ['photo', 'lunch', new Date(at(12, 40)).toISOString()])
    assert.match(r.body.sha256!, /^[0-9a-f]{64}$/)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/meals] Served tray photo: Not a served photo', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0, 0, 0])
    const voice = await t.uploadAs(b1.id, webm, { kind: 'voice', served_meal: 'lunch', type: 'audio/webm' })
    const brunch = await t.uploadAs(b1.id, SERVED_PNG, { served_meal: 'brunch' })
    assert.deepEqual([voice.status, voice.body.error, brunch.status, brunch.body.error], [400, 'invalid_request', 400, 'invalid_request'])
    assert.equal(await t.store.mediaRef(1), undefined)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/meals] Served tray of a bed: Lunch waiting', async () => {
    const t = await setup()
    const [b1, b2] = [await t.bed('1'), await t.bed('2')]
    t.clock.t = at(14, 30)
    const lunch = (await t.uploadAs(b1.id, SERVED_PNG, { served_meal: 'lunch' })).body
    t.clock.t = at(14, 50)
    const linked = (await t.uploadAs(b1.id, png(1000, 800, 50), { served_meal: 'lunch' })).body
    // A lunch saved at 15:00 links the 14:50 photo.
    t.clock.t = at(15, 0)
    const read = await t.readFor(COLLECTED_PNG, b1.id)
    assert.equal(read.comparison?.served_media_id, linked.id)
    const photo = (await t.uploadAs(b1.id, COLLECTED_PNG)).body
    const saved = await t.meal(b1.id, {
      source: 'photo',
      portion: 75,
      media_id: photo.id,
      served_media_id: linked.id,
      evidence: evidenceOf(read),
    })
    assert.equal(saved.status, 201)
    t.clock.t = at(15, 5)
    await t.uploadAs(b2.id, png(1000, 800, 51), { served_meal: 'snack' })
    t.clock.t = at(15, 10)
    const sent = t.u.requests.length
    const r = await t.servedTray(b1.id)
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.media?.id, r.body.media?.served_meal], [lunch.id, 'lunch'])
    assert.equal(t.u.requests.length, sent)
  })

  it('[charting/meals] Served tray of a bed: Nothing waiting', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    t.clock.t = at(11, 9)
    await t.uploadAs(b1.id, SERVED_PNG, { served_meal: 'lunch' })
    t.clock.t = at(15, 10)
    assert.deepEqual((await t.servedTray(b1.id)).body, { media: null })
    const unknown = await t.servedTray(9999)
    assert.deepEqual([unknown.status, unknown.body.error], [404, 'not_found'])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/meals] Served photo linked to the meal: Lunch with its served tray', async () => {
    const { t, b1, served, photo, body } = await compared()
    const sent = t.u.requests.length
    const r = await t.meal(b1.id, body, 1)
    assert.equal(r.status, 201)
    assert.deepEqual([r.body.served_media?.id, r.body.served_media?.kind, r.body.served_media?.served_meal], [served.id, 'photo', 'lunch'])
    assert.deepEqual(r.body.proof?.served, {
      media_id: served.id,
      sha256: served.sha256,
      captured_by: RAVI,
      captured_at: new Date(at(12, 40)).toISOString(),
    })
    assert.equal(r.body.proof?.photo.media_id, photo.id)
    assert.equal(t.u.requests.length, sent)
  })

  it('[charting/meals] Served photo linked to the meal: Wrong served photo', async () => {
    const { t, b1, read, photo, body } = await compared()
    const b2 = await t.bed('2')
    const breakfast = (await t.uploadAs(b1.id, png(1000, 800, 60), { served_meal: 'breakfast' })).body
    const other = (await t.uploadAs(b2.id, png(1000, 800, 61), { served_meal: 'lunch' })).body
    const plain = (await t.uploadAs(b1.id, png(1000, 800, 62))).body
    const taken = (await t.uploadAs(b1.id, png(1000, 800, 63), { served_meal: 'lunch' })).body
    const naming = (m: MediaRef): Partial<MealInput> => ({
      ...body,
      served_media_id: m.id,
      evidence: { ...evidenceOf(read), comparison: { ...read.comparison!, served_media_id: m.id, served_sha256: m.sha256! } },
    })
    // Another meal links `taken` first.
    assert.equal((await t.meal(b1.id, naming(taken))).status, 201)
    const before = (await t.meals(b1.id)).body.length
    const servedLunch = body.served_media_id!
    const servedRef = (await t.store.mediaRef(servedLunch))!
    const cases: Partial<MealInput>[] = [
      naming(breakfast),
      naming(other),
      naming(taken),
      naming(photo),
      naming(plain),
      // A served lunch photo as the tray photo.
      { ...naming(servedRef), media_id: servedLunch, evidence: { ...naming(servedRef).evidence!, image_sha256: servedRef.sha256! } },
    ]
    for (const c of cases) {
      const r = await t.meal(b1.id, c)
      assert.deepEqual([r.status, r.body.error], [400, 'invalid_request'], JSON.stringify(c.served_media_id))
    }
    assert.equal((await t.meals(b1.id)).body.length, before)
  })

  it('[charting/meals] Served photo linked to the meal: Same bytes uploaded twice', async () => {
    const t = await setup({ upstream: COMPARE_UPSTREAM })
    const b1 = await t.bed('1')
    const served = (await t.uploadAs(b1.id, COLLECTED_PNG, { served_meal: 'lunch' })).body
    const tray = (await t.uploadAs(b1.id, COLLECTED_PNG)).body
    const read = await t.readFor(COLLECTED_PNG, b1.id)
    assert.equal(read.comparison, null)
    const sent = t.u.requests.length
    const comparison = {
      served_media_id: served.id,
      served_sha256: served.sha256!,
      served_at: served.created_at,
      size: null,
      served_size: null,
      served: null,
      matches: [],
    }
    const r = await t.json<{ issues: { path: string }[] }>(`/api/admissions/${b1.id}/meals`, {
      body: {
        meal: 'lunch',
        portion: 50,
        source: 'photo',
        media_id: tray.id,
        served_media_id: served.id,
        evidence: { ...evidenceOf(read), comparison },
      },
    })
    assert.deepEqual([r.status, r.body.error], [400, 'invalid_request'])
    assert.deepEqual(
      r.body.issues.map((i) => i.path),
      ['served_media_id'],
    )
    assert.deepEqual((await t.meals(b1.id)).body, [])
    assert.equal(t.u.requests.length, sent)
  })

  it('[charting/meals] Served photo linked to the meal: By-hand meal with a served photo', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    const served = (await t.uploadAs(b1.id, SERVED_PNG, { served_meal: 'lunch' })).body
    const r = await t.meal(b1.id, { source: 'manual', served_media_id: served.id })
    assert.deepEqual([r.status, r.body.error], [400, 'invalid_request'])
  })

  it('[charting/meals] Comparison bound to its photos: Both photos bound', async () => {
    const { t, b1, body } = await compared()
    const sent = t.u.requests.length
    const r = await t.meal(b1.id, body)
    assert.equal(r.status, 201)
    const m = r.body
    assert.equal(m.evidence?.comparison?.served_sha256, m.served_media?.sha256)
    assert.equal(m.served_media?.sha256, m.proof?.served?.sha256)
    assert.equal(m.evidence?.image_sha256, m.media?.sha256)
    assert.equal(m.media?.sha256, m.proof?.photo.sha256)
    assert.equal(t.u.requests.length, sent)
  })

  it('[charting/meals] Comparison bound to its photos: Comparison without its served photo', async () => {
    const { t, b1, body } = await compared()
    const r = await t.meal(b1.id, { ...body, served_media_id: undefined })
    assert.deepEqual([r.status, r.body.error], [400, 'invalid_request'])
    assert.deepEqual((await t.meals(b1.id)).body, [])
  })

  it('[charting/meals] Comparison bound to its photos: Served photo without a comparison', async () => {
    const { t, b1, body } = await compared()
    const a = await t.meal(b1.id, { ...body, evidence: { ...body.evidence!, comparison: null } })
    const b = await t.meal(b1.id, { ...body, evidence: undefined })
    assert.deepEqual([a.status, a.body.error, b.status, b.body.error], [400, 'invalid_request', 400, 'invalid_request'])
    assert.deepEqual((await t.meals(b1.id)).body, [])
  })

  it('[charting/meals] Comparison bound to its photos: Another served photo', async () => {
    const { t, b1, body } = await compared()
    const second = (await t.uploadAs(b1.id, png(1000, 800, 43), { served_meal: 'lunch' })).body
    const r = await t.meal(b1.id, { ...body, served_media_id: second.id })
    assert.deepEqual([r.status, r.body.error], [400, 'invalid_request'])
    assert.deepEqual((await t.meals(b1.id)).body, [])
  })

  it('[charting/meals] Comparison bound to its photos: Served fingerprint differs', async () => {
    const { t, b1, body } = await compared()
    const r = await t.meal(b1.id, {
      ...body,
      evidence: { ...body.evidence!, comparison: { ...body.evidence!.comparison!, served_sha256: 'a'.repeat(64) } },
    })
    assert.deepEqual([r.status, r.body.error], [400, 'invalid_request'])
    assert.deepEqual((await t.meals(b1.id)).body, [])
  })

  it('[charting/meals] Compared read kept as evidence: Compared read kept', async () => {
    const { t, b1, read, body } = await compared()
    assert.equal(read.segmentation?.regions.length, 2)
    assert.equal(read.comparison?.served?.regions.length, 2)
    assert.equal(read.comparison?.matches.length, 2)
    assert.deepEqual(
      read.reading.dishes.map((d) => d.basis),
      ['measured', 'model'],
    )
    assert.equal(read.trace.length, 5)
    const r = await t.meal(b1.id, body)
    assert.equal(r.status, 201)
    assert.deepEqual(r.body.evidence, body.evidence)
    assert.deepEqual((await t.meals(b1.id)).body[0]!.evidence, body.evidence)
  })

  it('[charting/meals] Compared read kept as evidence: Malformed comparison', async () => {
    const { t, b1, body } = await compared()
    const ev = body.evidence!
    const cmp = ev.comparison!
    const served = cmp.served!
    const region = served.regions[0]!
    const match = cmp.matches[0]!
    const bad = [
      { ...cmp, served: { ...served, regions: Array.from({ length: 13 }, (_, i) => ({ ...region, index: Math.min(i + 1, 12) })) } },
      { ...cmp, matches: Array.from({ length: 13 }, () => match) },
      { ...cmp, matches: [{ ...match, served_index: 13 }] },
      { ...cmp, matches: [{ ...match, distance2: 40_001 }] },
    ].map((comparison): MealEvidenceInput => ({ ...ev, comparison }))
    const measured = ev.reading.dishes.findIndex((d) => d.basis === 'measured')
    const dishes = ev.reading.dishes.map((d, i) => (i === measured ? { ...d, measure: null } : d))
    bad.push({ ...ev, reading: { ...ev.reading, dishes } })
    for (const evidence of bad) {
      const r = await t.meal(b1.id, { ...body, evidence })
      assert.deepEqual([r.status, r.body.error], [400, 'invalid_request'])
    }
    assert.deepEqual((await t.meals(b1.id)).body, [])
  })

  it('[charting/meals] Served photo linked to the meal: two saves of one served photo at once', async () => {
    const { t, b1, body } = await compared()
    const [a, b] = await Promise.all([t.meal(b1.id, body), t.meal(b1.id, body)])
    assert.deepEqual([a.status, b.status].sort(), [201, 400])
    assert.equal((await t.meals(b1.id)).body.length, 1)
  })

  it('[charting/media] Media goes with its record: Voided tray with its served photo', async () => {
    const { t, b1, served, photo, body } = await compared()
    const saved = (await t.meal(b1.id, body)).body
    const v = await t.voidMeal(saved.id, 'wrong bed')
    assert.equal(v.status, 200)
    assert.equal((await t.app.request(`/api/media/${photo.id}`)).status, 404)
    assert.equal((await t.app.request(`/api/media/${served.id}`)).status, 404)
    assert.deepEqual([v.body.media, v.body.served_media], [null, null])
    assert.deepEqual([v.body.proof?.photo.sha256, v.body.proof?.served?.sha256], [photo.sha256, served.sha256])
  })

  it('[charting/media] Objects go with their last media row: Voided lunch with its served photo', async () => {
    const { t, b1, served, photo, body } = await compared()
    const objects = (t.app.media as MemoryMediaStore).objects
    assert.ok(objects.has(photo.sha256!) && objects.has(served.sha256!))
    const saved = (await t.meal(b1.id, body)).body
    const v = await t.voidMeal(saved.id, 'wrong bed')
    assert.equal(v.status, 200)
    assert.equal(objects.has(photo.sha256!), false)
    assert.equal(objects.has(served.sha256!), false)
    assert.deepEqual([v.body.proof?.photo.sha256, v.body.proof?.served?.sha256], [photo.sha256, served.sha256])
  })

  it('[charting/media] Media goes with its record: Served photo in use', async () => {
    const { t, b1, served, body } = await compared()
    assert.equal((await t.meal(b1.id, body)).status, 201)
    t.clock.t = Date.UTC(2026, 10, 3, 13, 0)
    assert.equal((await t.app.request(`/api/media/${served.id}`)).status, 200)
  })
})

describe('labeled tray copy', () => {
  /** A labeled tray JPEG: other bytes than photoA. */
  const labeledA = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4c, 0x41, 0xff, 0xd9])

  /** Reads photoA (3 upstream requests), uploads it and its labeled copy, and saves the lunch naming both. */
  const lunchWithCopy = async (t: Awaited<ReturnType<typeof setup>>, admissionId: number, over: Partial<MealInput> = {}) => {
    const read = await t.readTray(photoA)
    const photo = await t.upload(admissionId, photoA)
    const copy = await t.upload(admissionId, labeledA)
    const sent = t.u.requests.length
    const saved = await t.meal(admissionId, {
      meal: 'lunch',
      portion: 75,
      fluid_ml: 150,
      source: 'photo',
      dishes: [RICE_ALL, DAL_HALF],
      media_id: photo.id,
      labeled_media_id: copy.id,
      evidence: evidenceOf(read),
      ...over,
    })
    return { read, photo, copy, saved, sent }
  }

  it('[charting/meals] Labeled tray copy kept: Lunch with its labeled tray', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    const { read, copy, saved, sent } = await lunchWithCopy(t, b1.id)
    assert.equal(read.segmentation?.regions.length, 2)
    assert.equal(saved.status, 201)
    assert.equal(saved.body.labeled_media?.id, copy.id)
    assert.equal(saved.body.labeled_media?.sha256, sha256(labeledA))
    const listed = (await t.meals(b1.id)).body[0]!
    assert.equal(listed.labeled_media?.id, copy.id)
    assert.equal(listed.labeled_media?.sha256, sha256(labeledA))
    const fluid = (await t.json<EntryList>(`/api/admissions/${b1.id}/entries`)).body.entries.find((e) => e.id === saved.body.entry_id)!
    assert.equal(fluid.labeled_media, null)
    assert.equal(t.u.requests.length, sent, 'saving made no upstream request')
  })

  it('[charting/meals] Labeled tray copy kept: Voided lunch', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    const { photo, copy, saved } = await lunchWithCopy(t, b1.id)
    const voided = await t.voidMeal(saved.body.id, 'wrong bed')
    assert.equal(voided.status, 200)
    assert.equal(voided.body.media, null)
    assert.equal(voided.body.labeled_media, null)
    assert.deepEqual(voided.body.evidence, saved.body.evidence)
    assert.deepEqual(voided.body.proof, saved.body.proof)
    assert.equal((await t.app.request(`/api/media/${photo.id}`)).status, 404)
    assert.equal((await t.app.request(`/api/media/${copy.id}`)).status, 404)
  })

  it('[charting/meals] Labeled tray copy kept: Refused copies', async () => {
    const t = await setup()
    const b1 = await t.bed('1')
    const read = await t.readTray(photoA)
    const photo = await t.upload(b1.id, photoA)
    const copy = await t.upload(b1.id, labeledA)
    const taken = await t.upload(b1.id, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x54, 0xff, 0xd9]))
    assert.equal(
      (
        await t.json<Entry>(`/api/admissions/${b1.id}/entries`, {
          body: { direction: 'out', category: 'urine', volume_ml: 300, source: 'photo', media_id: taken.id },
        })
      ).status,
      201,
    )
    const served = (
      await t.uploadAs(b1.id, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x53, 0xff, 0xd9]), {
        served_meal: 'lunch',
        type: 'image/jpeg',
      })
    ).body
    const sent = t.u.requests.length
    const base: Partial<MealInput> = {
      meal: 'lunch',
      portion: 75,
      source: 'photo',
      dishes: [RICE_ALL, DAL_HALF],
      media_id: photo.id,
      labeled_media_id: copy.id,
      evidence: evidenceOf(read),
    }
    const { media_id: _omit, ...noMedia } = base
    const cases: [string, Partial<MealInput>][] = [
      ['no media_id', { ...noMedia, evidence: null, source: 'photo' }],
      ['the photo itself', { ...base, labeled_media_id: photo.id }],
      ["the served photo's id", { ...base, labeled_media_id: served.id }],
      ['linked to an entry', { ...base, labeled_media_id: taken.id }],
      ['spark read', { ...base, evidence: { ...evidenceOf(read), mode: 'spark', segmentation: null } }],
      ['manual', { meal: 'lunch', portion: 75, source: 'manual', labeled_media_id: copy.id }],
    ]
    for (const [name, body] of cases) {
      const r = await t.meal(b1.id, body)
      assert.equal(r.status, 400, name)
      assert.equal(r.body.error, 'invalid_request', name)
    }
    assert.deepEqual((await t.meals(b1.id)).body, [])
    assert.equal(t.u.requests.length, sent)
  })
})
