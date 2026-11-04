import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import type { AdmissionSummary, EntryList, Meal, MealReadResult, MediaRef } from '@meniscus/shared'
import type { MealModelOutput } from './ai/meal.ts'
import { createAi } from './ai/pipeline.ts'
import type { MemoryMediaStore } from './store/media/memory.ts'
import {
  SAM_EMPTY,
  SAM_RECT,
  SAM_TEXT,
  dataUrl,
  imageOf,
  jpeg,
  msg,
  png,
  resp,
  testApp,
  testStore,
  upstream,
  useBudget,
  type Upstream,
} from './testing.ts'

/** The default cap of 120 an hour with the default 30 % critical reserve (routine ceiling 84). */
const RESERVED = { perHour: 120, maxConcurrent: 4, reservePct: 30 }

/** A JPEG whose bytes differ from `jpeg`, so a hash cannot pass by accident. */
const trayJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9])
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
/** The fake upstream's default SAM answer: the fixture dish at 211,228–271,255. */
const defaultSam = () => resp('sam-3.1', [msg(SAM_TEXT)])
const upstreamError = (status: number, message: string, code: string, headers: Record<string, string> = {}) =>
  Response.json({ error: { message, type: 'server_error', code } }, { status, headers })

/** Fake upstream whose Spark answers with `out`; SAM answers with the fixture dish unless `over.sam` says otherwise. */
async function tray(out: Partial<MealModelOutput>, over: Omit<Upstream, 'spark'> = {}, mealUseSam?: boolean) {
  const answer: MealModelOutput = { dishes: [], eaten: 'none', fluids: [], confidence: 0.9, issues: [], notes: null, ...out }
  const u = upstream({ ...over, spark: () => resp('muse-spark-1.3', [msg(JSON.stringify(answer))]) })
  const ai = mealUseSam === undefined ? u.ai : createAi(() => u.client, { mealUseSam })
  const store = await testStore()
  const app = await testApp({ ai, store })
  const read = async (o: { file?: File; mode?: string } = {}) => {
    const form = new FormData()
    form.append('image', o.file ?? new File([trayJpeg], 'tray.jpg', { type: 'image/jpeg' }))
    if (o.mode !== undefined) form.append('mode', o.mode)
    const res = await app.request('/api/ai/meal', { method: 'POST', body: form })
    return { status: res.status, body: (await res.json()) as MealReadResult & { error?: string; code?: string; retryable?: boolean } }
  }
  /** The text part of the Spark request. */
  const sparkText = () => (u.bodies.find((b) => b.model !== 'sam-3.1')!.input[0].content[0].text as string) ?? ''
  return { u, app, store, read, sparkText }
}

describe('meal tray reading', () => {
  it('[capture/meal-reading] Tray reading: Half-eaten lunch', async () => {
    const t = await tray({
      dishes: [
        { region: 1, name: 'rice', dish_kind: 'rice', eaten: 'half' },
        { region: 0, name: 'dal', dish_kind: 'dal_lentils', eaten: 'all' },
      ],
      eaten: 'half',
      fluids: [{ region: 0, name: 'soup', fluid_kind: 'soup', volume_ml: 150 }],
      confidence: 0.82,
    })
    const bed = ((await (await t.app.request('/api/admissions')).json()) as AdmissionSummary[])[0]!
    const chart = async () => [
      await (await t.app.request(`/api/admissions/${bed.id}/meals`)).json(),
      ((await (await t.app.request(`/api/admissions/${bed.id}/entries`)).json()) as EntryList).entries.length,
    ]
    const before = await chart()
    const r = await t.read()
    assert.equal(r.status, 200)
    assert.deepEqual(await chart(), before)
    assert.equal(r.body.mode, 'sam+spark')
    assert.deepEqual(r.body.draft, {
      portion: 50,
      items: 'rice, dal',
      fluid_ml: 150,
      dishes: [
        { index: 1, name: 'rice', dish_kind: 'rice', portion: 50 },
        { index: 0, name: 'dal', dish_kind: 'dal_lentils', portion: 100 },
      ],
    })
    assert.deepEqual(r.body.reading.items, [
      { name: 'rice', portion: 50 },
      { name: 'dal', portion: 100 },
    ])
    assert.equal(r.body.needs_review, false)
    assert.equal(r.body.comparison, null)
    assert.deepEqual(
      r.body.trace.map((s) => s.step),
      ['sam:dish', 'sam:food', 'spark:meal'],
    )
    assert.equal(r.body.image_sha256, sha256(trayJpeg))
    assert.deepEqual(t.u.requests, ['sam:dish', 'sam:food', 'spark:object'])
    assert.equal(t.u.bodies.length, 3)
    assert.ok(t.u.bodies.every((b) => b.store === false))
    assert.equal(t.u.bodies[2]!.text.format.type, 'json_schema')
    assert.equal(t.u.bodies[2]!.text.format.strict, true)
  })

  it('[capture/meal-reading] Tray reading: Rate-limited tray read', async () => {
    const u = upstream({ spark: () => upstreamError(429, 'slow down', 'rate_limit_exceeded', { 'retry-after': '12' }) })
    const app = await testApp({ ai: u.ai, store: await testStore() })
    const read = async (mode: string) => {
      const form = new FormData()
      form.append('image', new File([jpeg], 'tray.jpg', { type: 'image/jpeg' }))
      form.append('mode', mode)
      const res = await app.request('/api/ai/meal', { method: 'POST', body: form })
      const body = (await res.json()) as { retryable: boolean; code: string }
      return [res.status, res.headers.get('retry-after'), body.retryable, body.code]
    }
    assert.deepEqual(await read('sam+spark'), [429, '12', true, 'rate_limit_exceeded'])
    assert.deepEqual(u.requests, ['sam:dish', 'sam:food', 'spark:object'])
    assert.deepEqual(await read('spark'), [429, '12', true, 'rate_limit_exceeded'])
    assert.deepEqual(u.requests.slice(3), ['spark:object'])
  })

  it('[capture/meal-reading] Tray reading: Not a meal', async () => {
    const t = await tray({ issues: ['not_a_meal'], confidence: 0.3 })
    const r = await t.read()
    assert.equal(r.body.draft.items, '')
    assert.equal(r.body.draft.fluid_ml, null)
    assert.equal(r.body.needs_review, true)
    assert.deepEqual(t.u.requests, ['sam:dish', 'sam:food', 'spark:object'])
  })

  it('[capture/meal-reading] Tray review gate: Issue at high confidence', async () => {
    const idli = { region: 1, name: 'idli', dish_kind: 'porridge_cereal', eaten: 'all' } as const
    const r = await (await tray({ dishes: [idli], eaten: 'all', confidence: 0.9, issues: ['partly_hidden'] })).read()
    assert.equal(r.body.needs_review, true)
  })

  it('[capture/meal-reading] Tray review gate: At the threshold', async () => {
    const idli = { region: 1, name: 'idli', dish_kind: 'porridge_cereal', eaten: 'all' } as const
    const r = await (await tray({ dishes: [idli], eaten: 'all', confidence: 0.75 })).read()
    assert.equal(r.body.needs_review, false)
  })

  it('[capture/meal-reading] Tray read fits a saved meal: Long read', async () => {
    const name = (i: number) => `${String(i).padStart(2, '0')}${'x'.repeat(88)}`
    const t = await tray({
      dishes: Array.from({ length: 25 }, (_, i) => ({ region: 1, name: name(i), dish_kind: 'other' as const, eaten: 'quarter' as const })),
      eaten: 'quarter',
    })
    const r = await t.read()
    assert.equal(r.body.reading.dishes.length, 20)
    assert.equal(r.body.reading.items.length, 20)
    assert.ok(r.body.reading.dishes.every((d) => d.name.length === 80))
    assert.ok(r.body.reading.items.every((i) => i.name.length === 80))
    assert.equal(r.body.draft.items.length, 200)
    const bed = ((await (await t.app.request('/api/admissions')).json()) as AdmissionSummary[])[0]!
    const form = new FormData()
    form.set('file', new File([trayJpeg], 'tray.jpg', { type: 'image/jpeg' }))
    form.set('kind', 'photo')
    const media = (await (await t.app.request(`/api/admissions/${bed.id}/media`, { method: 'POST', body: form })).json()) as MediaRef
    const saved = await t.app.request(`/api/admissions/${bed.id}/meals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        meal: 'lunch',
        portion: r.body.draft.portion,
        items: r.body.draft.items,
        source: 'photo',
        confidence: r.body.reading.confidence,
        dishes: r.body.draft.dishes,
        media_id: media.id,
        evidence: {
          mode: r.body.mode,
          image_sha256: r.body.image_sha256,
          reading: r.body.reading,
          segmentation: r.body.segmentation,
          warnings: r.body.warnings,
          trace: r.body.trace,
        },
      }),
    })
    assert.equal(saved.status, 201)
    assert.equal(((await saved.json()) as Meal).evidence?.reading.dishes.length, 20)
  })

  it('[capture/meal-reading] Tray upload validation: Text file as a tray', async () => {
    const t = await tray({})
    const r = await t.read({ file: new File(['x'], 'a.txt', { type: 'text/plain' }) })
    assert.equal(r.status, 400)
    assert.equal(r.body.error, 'invalid_request')
    assert.deepEqual(t.u.requests, [])
  })

  it('[capture/meal-reading] Tray upload validation: Unknown mode', async () => {
    const t = await tray({})
    const r = await t.read({ mode: 'sam' })
    assert.equal(r.status, 400)
    assert.equal(r.body.error, 'invalid_request')
    assert.deepEqual(t.u.requests, [])
  })
})

describe('tray segmentation', () => {
  it('[capture/meal-reading] Tray segmentation grounding: One plate', async () => {
    // SAM `dish` finds the fixture dish; `food` finds nothing.
    const t = await tray({}, { sam: (prompt) => (prompt === 'food' ? resp('sam-3.1', [msg(SAM_EMPTY)]) : defaultSam()) })
    const r = await t.read({ mode: 'sam+spark' })
    assert.equal(r.status, 200)
    assert.deepEqual(t.u.requests, ['sam:dish', 'sam:food', 'spark:object'])
    const sam = t.u.bodies.filter((b) => b.model === 'sam-3.1')
    assert.deepEqual(
      sam.map((b) => [b.input[0].content[0].text, b.metadata.mask_encoding]),
      [
        ['dish', 'one_bit'],
        ['food', 'one_bit'],
      ],
    )
    assert.ok(t.sparkText().includes('Dish 1: x 211–271, y 228–255, centre, food covers 0%'))
    assert.deepEqual(
      r.body.trace.map((s) => s.step),
      ['sam:dish', 'sam:food', 'spark:meal'],
    )
    assert.deepEqual(
      r.body.segmentation?.regions.map((x) => [x.index, x.box.left, x.box.top, x.box.right, x.box.bottom, x.coverage]),
      [[1, 211, 228, 271, 255, 0]],
    )
  })

  it('[capture/meal-reading] Tray segmentation grounding: No dishes found', async () => {
    const t = await tray({}, { sam: () => resp('sam-3.1', [msg(SAM_EMPTY)]) })
    const r = await t.read()
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.segmentation, { regions: [], loose_food: null })
    assert.deepEqual(r.body.warnings, ['segmentation found no dishes'])
    assert.deepEqual(t.u.requests, ['sam:dish', 'sam:food', 'spark:object'])
  })

  it('[capture/meal-reading] Spark-only tray reading: Spark mode', async () => {
    const t = await tray({ dishes: [{ region: 2, name: 'rice', dish_kind: 'rice', eaten: 'all' }], eaten: 'all' })
    const r = await t.read({ mode: 'spark' })
    assert.equal(r.status, 200)
    assert.deepEqual(t.u.requests, ['spark:object'])
    assert.deepEqual(
      r.body.trace.map((s) => s.step),
      ['spark:meal'],
    )
    assert.equal(r.body.mode, 'spark')
    assert.equal(r.body.segmentation, null)
    assert.deepEqual(
      r.body.reading.dishes.map((d) => [d.name, d.index, d.box, d.coverage]),
      [['rice', 0, null, null]],
    )
    assert.equal(t.u.bodies[0]!.store, false)
    assert.equal(t.sparkText(), 'Read this meal tray.')
  })

  it('[capture/meal-reading] Spark-only tray reading: SAM switched off', async () => {
    const t = await tray({}, {}, false)
    assert.equal((await t.read()).body.mode, 'spark')
    assert.deepEqual(t.u.requests, ['spark:object'])
    assert.equal((await t.read({ mode: 'sam+spark' })).body.mode, 'sam+spark')
    assert.deepEqual(t.u.requests.slice(1), ['sam:dish', 'sam:food', 'spark:object'])
  })

  it('[capture/meal-reading] Tray segmentation degrades: SAM overloaded', async () => {
    const t = await tray(
      { dishes: [{ region: 1, name: 'rice', dish_kind: 'rice', eaten: 'all' }], eaten: 'all' },
      { sam: () => upstreamError(503, 'overloaded', 'service_overloaded') },
    )
    const r = await t.read()
    assert.equal(r.status, 200)
    assert.equal(r.body.segmentation, null)
    assert.equal(r.body.warnings.length, 1)
    assert.ok(r.body.warnings[0]!.startsWith('segmentation unavailable: '))
    assert.deepEqual(
      r.body.reading.dishes.map((d) => [d.name, d.index, d.portion]),
      [['rice', 0, 100]],
    )
    assert.deepEqual(t.u.requests, ['sam:dish', 'sam:food', 'spark:object'])
    assert.doesNotMatch(t.sparkText(), /Dish \d/)
    assert.ok(t.u.bodies.every((b) => b.store === false))
  })

  it('[capture/meal-reading] Tray segmentation degrades: SAM rate-limited upstream', async () => {
    const t = await tray(
      { dishes: [{ region: 1, name: 'rice', dish_kind: 'rice', eaten: 'half' }], eaten: 'half' },
      {
        sam: (prompt) =>
          prompt === 'dish' ? upstreamError(429, 'slow down', 'rate_limit_exceeded', { 'retry-after': '12' }) : defaultSam(),
      },
    )
    const r = await t.read()
    assert.equal(r.status, 200)
    assert.equal(r.body.segmentation, null)
    assert.ok(r.body.warnings[0]!.startsWith('segmentation unavailable: '))
    assert.deepEqual(
      r.body.reading.dishes.map((d) => [d.name, d.index, d.portion]),
      [['rice', 0, 50]],
    )
    assert.deepEqual(t.u.requests, ['sam:dish', 'sam:food', 'spark:object'])
  })

  it('[capture/meal-reading] Tray segmentation degrades: One request left', async () => {
    const t = await tray({ dishes: [{ region: 0, name: 'rice', dish_kind: 'rice', eaten: 'all' }], eaten: 'all' }, { budget: RESERVED })
    useBudget(t.u.client.budget, 83)
    const r = await t.read({ mode: 'sam+spark' })
    assert.equal(r.status, 200)
    assert.equal(r.body.mode, 'spark')
    assert.equal(r.body.segmentation, null)
    assert.ok(r.body.warnings[0]!.startsWith('budget pressure'), r.body.warnings.join())
    assert.deepEqual(t.u.requests, ['spark:object'])
  })

  it('[capture/meal-reading] Tray segmentation degrades: Budget spent', async () => {
    const t = await tray({}, { budget: RESERVED })
    useBudget(t.u.client.budget, 84)
    const r = await t.read({ mode: 'sam+spark' })
    assert.equal(r.status, 429)
    assert.equal(r.body.error, 'request_budget_exceeded')
    assert.equal((r.body as { budget_class?: string }).budget_class, 'routine')
    assert.deepEqual(t.u.requests, [])
  })

  it('[capture/meal-reading] Tray read fits a saved meal: Long warning', async () => {
    const t = await tray({}, { sam: () => upstreamError(500, 'e'.repeat(400), 'server_error') })
    const r = await t.read()
    assert.equal(r.status, 200)
    assert.equal(r.body.warnings.length, 1)
    assert.ok(r.body.warnings[0]!.startsWith('segmentation unavailable: '))
    assert.equal(r.body.warnings[0]!.length, 200)
  })
})

// ---------- tray reads that name their bed, with a served photo (tray-comparison) ----------

const SERVED = png(1000, 800, 41)
const COLLECTED = png(1000, 800, 42)
const DISH = { left: 100, top: 80, right: 400, bottom: 480 }
/** Local time on 4 Nov 2026. */
const at = (h: number, m: number) => new Date(2026, 10, 4, h, m).getTime()
const isServed = (body: Record<string, any>, served: Uint8Array = SERVED, mime = 'image/png') => imageOf(body) === dataUrl(served, mime)
/** SAM per photo: one dish at 100,80–400,480 on each; food covers 0.8 of it when served and 0.4 when collected. */
const perPhoto =
  (o: { served?: (prompt: string) => Response; collectedDish?: string } = {}) =>
  (prompt: string, body: Record<string, any>) => {
    if (isServed(body) && o.served) return o.served(prompt)
    if (prompt === 'dish')
      return resp('sam-3.1', [msg(!isServed(body) && o.collectedDish !== undefined ? o.collectedDish : SAM_RECT(DISH))])
    return resp('sam-3.1', [msg(SAM_RECT({ ...DISH, bottom: isServed(body) ? 400 : 240 }))])
  }
const RICE_QUARTER: Partial<MealModelOutput> = {
  dishes: [{ region: 1, name: 'rice', dish_kind: 'rice', eaten: 'quarter' }],
  eaten: 'quarter',
}

/** The demo store on a clock (13:30), the fake upstream, and tray reads that name a bed and meal. */
async function beds(out: Partial<MealModelOutput> = RICE_QUARTER, over: Omit<Upstream, 'spark'> = {}) {
  const clock = { t: at(13, 30) }
  const answer: MealModelOutput = { dishes: [], eaten: 'none', fluids: [], confidence: 0.9, issues: [], notes: null, ...out }
  const u = upstream({ sam: perPhoto(), ...over, spark: () => resp('muse-spark-1.3', [msg(JSON.stringify(answer))]) })
  const store = await testStore(() => clock.t)
  const app = await testApp({ ai: u.ai, store })
  const bed = async (i: number) => (await store.admissions())[i - 1]!
  /** A served photo for `bed`, uploaded at `h:m` by Ravi Kumar. */
  const serve = async (
    admissionId: number,
    h: number,
    m: number,
    o: { meal?: 'lunch' | 'breakfast'; bytes?: Uint8Array; mime?: string } = {},
  ) => {
    const t = clock.t
    clock.t = at(h, m)
    const ref = (await app.keep(
      admissionId,
      { kind: 'photo', mime: o.mime ?? 'image/png', bytes: o.bytes ?? SERVED, served_meal: o.meal ?? 'lunch' },
      1,
    ))!
    clock.t = t
    return ref
  }
  const read = async (o: { admission?: number | string; meal?: string; mode?: string; bytes?: Uint8Array } = {}) => {
    const form = new FormData()
    form.append('image', new File([o.bytes ?? COLLECTED], 'tray.png', { type: 'image/png' }))
    if (o.admission !== undefined) form.append('admission_id', String(o.admission))
    if (o.meal !== undefined) form.append('meal', o.meal)
    if (o.mode !== undefined) form.append('mode', o.mode)
    const res = await app.request('/api/ai/meal', { method: 'POST', body: form })
    return { status: res.status, body: (await res.json()) as MealReadResult & { error?: string } }
  }
  const forBed = (admissionId: number, o: { mode?: string; bytes?: Uint8Array } = {}) =>
    read({ admission: admissionId, meal: 'lunch', ...o })
  const samImages = () => u.bodies.filter((b) => b.model === 'sam-3.1').map((b) => (isServed(b) ? 'served' : 'collected'))
  const sparkText = () => u.bodies.find((b) => b.model !== 'sam-3.1')!.input[0].content[0].text as string
  return { clock, u, store, app, bed, serve, read, forBed, samImages, sparkText }
}

describe('tray reads with a served photo', () => {
  it('[capture/meal-reading] Tray reads name their bed: Unknown bed', async () => {
    const t = await beds()
    const r = await t.read({ admission: 9999, meal: 'lunch' })
    assert.deepEqual([r.status, r.body.error, t.u.requests], [404, 'not_found', []])
  })

  it('[capture/meal-reading] Tray reads name their bed: Meal without a bed', async () => {
    const t = await beds()
    const a = await t.read({ meal: 'lunch' })
    const b = await t.read({ admission: (await t.bed(1)).id, meal: 'brunch' })
    assert.deepEqual([a.status, a.body.error, b.status, b.body.error], [400, 'invalid_request', 400, 'invalid_request'])
    assert.deepEqual(t.u.requests, [])
  })

  it('[capture/meal-reading] Tray reads name their bed: Not sent upstream', async () => {
    const t = await beds()
    const bed3 = await t.bed(3)
    await t.read({ mode: 'sam+spark' })
    await t.read({ mode: 'sam+spark', admission: bed3.id, meal: 'lunch' })
    assert.equal(t.u.bodies.length, 6)
    for (let i = 0; i < 3; i++) assert.deepEqual(t.u.bodies[i + 3], t.u.bodies[i])
    for (const body of t.u.bodies) {
      const keys = JSON.stringify(body)
      const parsed = JSON.parse(keys) as Record<string, unknown>
      assert.ok(!('admission_id' in parsed) && !('meal' in parsed))
      assert.ok(!keys.includes('"admission_id"') && !keys.includes('"meal"'))
      assert.ok(!keys.includes(bed3.patient))
    }
  })

  it('[capture/meal-reading] Served and collected trays: Lunch served and collected', async () => {
    const t = await beds()
    const served = await t.serve((await t.bed(1)).id, 12, 40)
    const r = await t.forBed((await t.bed(1)).id)
    assert.equal(r.status, 200)
    assert.deepEqual(t.u.requests, ['sam:dish', 'sam:food', 'sam:dish', 'sam:food', 'spark:object'])
    assert.deepEqual(t.samImages(), ['collected', 'collected', 'served', 'served'])
    assert.ok(t.u.bodies.every((b) => b.store === false))
    const spark = t.u.bodies[4]!
    assert.deepEqual((spark.input[0].content as { type: string }[]).filter((c) => c.type === 'input_image').length, 1)
    assert.equal(imageOf(spark), dataUrl(COLLECTED, 'image/png'))
    assert.deepEqual(
      r.body.trace.map((s) => s.step),
      ['sam:dish', 'sam:food', 'sam:served-dish', 'sam:served-food', 'spark:meal'],
    )
    assert.deepEqual(
      [r.body.comparison?.served_media_id, r.body.comparison?.served_sha256, r.body.comparison?.served_at, r.body.comparison?.matches],
      [served.id, served.sha256, new Date(at(12, 40)).toISOString(), [{ index: 1, served_index: 1, distance2: 0 }]],
    )
    const rice = r.body.reading.dishes[0]!
    assert.deepEqual([rice.portion, rice.basis, rice.model_portion], [50, 'measured', 25])
    assert.deepEqual(r.body.reading.items, [{ name: 'rice', portion: 50 }])
    assert.deepEqual(r.body.draft.dishes, [{ index: 1, name: 'rice', dish_kind: 'rice', portion: 50 }])
    assert.equal(r.body.draft.items, 'rice')
    assert.ok(t.sparkText().includes('Dish 1: x 100–400, y 80–480, centre, food covers 40%, served 80%'))
  })

  it('[capture/meal-reading] Served and collected trays: No served photo', async () => {
    const t = await beds()
    const r = await t.forBed((await t.bed(1)).id, { mode: 'sam+spark' })
    assert.equal(r.body.comparison, null)
    assert.equal(t.u.requests.length, 3)
  })

  it('[capture/meal-reading] Served and collected trays: Wrong time, meal or bed', async () => {
    const t = await beds()
    const [b1, b2] = [(await t.bed(1)).id, (await t.bed(2)).id]
    await t.serve(b1, 9, 29, { bytes: png(1000, 800, 1) })
    await t.serve(b1, 13, 0, { meal: 'breakfast', bytes: png(1000, 800, 2) })
    await t.serve(b2, 13, 0, { bytes: png(1000, 800, 3) })
    const r = await t.forBed(b1)
    assert.equal(r.body.comparison, null)
    assert.equal(t.u.requests.length, 3)
    const inWindow = await t.serve(b1, 9, 30, { bytes: png(1000, 800, 4) })
    assert.equal((await t.forBed(b1)).body.comparison?.served_media_id, inWindow.id)
  })

  it('[charting/media] Media store unavailable: Served tray photo unreadable', async () => {
    const t = await beds()
    const b1 = (await t.bed(1)).id
    await t.serve(b1, 12, 40)
    const media = t.app.media as MemoryMediaStore
    media.fail.get = 503
    media.calls.length = 0
    const r = await t.forBed(b1)
    assert.deepEqual([r.status, r.body.error], [503, 'media_unavailable'])
    assert.deepEqual(media.calls, ['get'])
    assert.deepEqual(t.u.requests, [])
  })

  it('[capture/meal-reading] Served and collected trays: Newest unlinked', async () => {
    const t = await beds()
    const b1 = (await t.bed(1)).id
    const older = await t.serve(b1, 12, 30, { bytes: png(1000, 800, 1) })
    const newer = await t.serve(b1, 12, 40)
    // A saved lunch links the 12:40 photo.
    const read = await t.forBed(b1)
    assert.equal(read.body.comparison?.served_media_id, newer.id)
    const tray = (await t.app.keep(b1, { kind: 'photo', mime: 'image/png', bytes: COLLECTED }, 1))!
    const evidence = { ...read.body, draft: undefined, needs_review: undefined, ms: undefined, read_id: undefined }
    const saved = await t.app.request(`/api/admissions/${b1}/meals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ meal: 'lunch', portion: 25, source: 'photo', media_id: tray.id, served_media_id: newer.id, evidence }),
    })
    assert.equal(saved.status, 201)
    assert.equal((await t.forBed(b1)).body.comparison?.served_media_id, older.id)
  })

  it('[capture/meal-reading] Served and collected trays: Nothing found on the collected tray', async () => {
    const t = await beds(RICE_QUARTER, { sam: perPhoto({ collectedDish: SAM_EMPTY }) })
    const served = await t.serve((await t.bed(1)).id, 12, 40)
    const r = await t.forBed((await t.bed(1)).id)
    assert.deepEqual(t.u.requests, ['sam:dish', 'sam:food', 'spark:object'])
    assert.deepEqual(t.samImages(), ['collected', 'collected'])
    assert.deepEqual([r.body.comparison?.served_media_id, r.body.comparison?.served, r.body.comparison?.matches], [served.id, null, []])
    assert.ok(r.body.warnings.includes('segmentation found no dishes'))
  })

  it('[capture/meal-reading] Served and collected trays: Spark mode with a served photo', async () => {
    const t = await beds()
    const served = await t.serve((await t.bed(1)).id, 12, 40)
    const r = await t.forBed((await t.bed(1)).id, { mode: 'spark' })
    assert.deepEqual(t.u.requests, ['spark:object'])
    assert.deepEqual([r.body.comparison?.served_media_id, r.body.comparison?.served, r.body.comparison?.matches], [served.id, null, []])
  })

  it('[capture/meal-reading] Served photo with the same bytes: Same photo twice', async () => {
    const t = await beds()
    const b1 = (await t.bed(1)).id
    await t.serve(b1, 12, 40, { bytes: COLLECTED })
    const r = await t.forBed(b1, { mode: 'sam+spark' })
    assert.deepEqual(t.u.requests, ['sam:dish', 'sam:food', 'spark:object'])
    assert.deepEqual(t.samImages(), ['collected', 'collected'])
    assert.equal(r.body.comparison, null)
    assert.ok(!r.body.reading.dishes.some((d) => d.basis === 'measured'))
    assert.ok(r.body.warnings.includes('comparison unavailable: same photo as served'))
    const tray = (await t.app.keep(b1, { kind: 'photo', mime: 'image/png', bytes: COLLECTED }, 1))!
    const evidence = { ...r.body, draft: undefined, needs_review: undefined, ms: undefined, read_id: undefined }
    const saved = await t.app.request(`/api/admissions/${b1}/meals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ meal: 'lunch', portion: 25, source: 'photo', media_id: tray.id, evidence }),
    })
    assert.equal(saved.status, 201)
  })

  it('[capture/meal-reading] Served photo with the same bytes: Same photo in Spark mode', async () => {
    const t = await beds()
    await t.serve((await t.bed(1)).id, 12, 40, { bytes: COLLECTED })
    const r = await t.forBed((await t.bed(1)).id, { mode: 'spark' })
    assert.deepEqual(t.u.requests, ['spark:object'])
    assert.equal(r.body.comparison, null)
    assert.ok(r.body.warnings.includes('comparison unavailable: same photo as served'))
  })

  it('[capture/meal-reading] Served photo comparison degrades: Served SAM overloaded', async () => {
    const t = await beds(RICE_QUARTER, { sam: perPhoto({ served: () => upstreamError(503, 'overloaded', 'service_overloaded') }) })
    await t.serve((await t.bed(1)).id, 12, 40)
    const r = await t.forBed((await t.bed(1)).id)
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.comparison?.served, r.body.comparison?.matches], [null, []])
    assert.ok(r.body.warnings.some((w) => w.startsWith('comparison unavailable: ')))
    assert.deepEqual([r.body.reading.dishes[0]!.portion, r.body.reading.dishes[0]!.basis], [25, 'model'])
    assert.deepEqual(t.u.requests, ['sam:dish', 'sam:food', 'sam:dish', 'sam:food', 'spark:object'])
  })

  it('[capture/meal-reading] Served photo comparison degrades: Served tray with no dishes', async () => {
    const t = await beds(RICE_QUARTER, { sam: perPhoto({ served: () => resp('sam-3.1', [msg(SAM_EMPTY)]) }) })
    await t.serve((await t.bed(1)).id, 12, 40)
    const r = await t.forBed((await t.bed(1)).id)
    assert.deepEqual([r.body.comparison?.served, r.body.comparison?.matches], [{ regions: [], loose_food: null }, []])
    assert.ok(r.body.warnings.includes('comparison found no served dishes'))
    assert.equal(t.u.requests.length, 5)
  })

  it('[capture/meal-reading] Tray segmentation degrades: Collected SAM fails with a served photo', async () => {
    const sam = perPhoto()
    const t = await beds(RICE_QUARTER, {
      sam: (prompt, body) =>
        prompt === 'dish' && !isServed(body) ? upstreamError(503, 'overloaded', 'service_overloaded') : sam(prompt, body),
    })
    const served = await t.serve((await t.bed(1)).id, 12, 40)
    const r = await t.forBed((await t.bed(1)).id)
    assert.deepEqual(t.u.requests, ['sam:dish', 'sam:food', 'spark:object'])
    assert.deepEqual(t.samImages(), ['collected', 'collected'])
    assert.equal(r.status, 200)
    assert.equal(r.body.segmentation, null)
    assert.ok(r.body.warnings.some((w) => w.startsWith('segmentation unavailable: ')))
    assert.deepEqual([r.body.comparison?.served_media_id, r.body.comparison?.served, r.body.comparison?.matches], [served.id, null, []])
  })

  it('[capture/meal-reading] Photo sizes needed to compare: Photo size unknown', async () => {
    const t = await beds()
    const served = await t.serve((await t.bed(1)).id, 12, 40, { bytes: jpeg, mime: 'image/jpeg' })
    const r = await t.forBed((await t.bed(1)).id)
    assert.deepEqual(t.u.requests, ['sam:dish', 'sam:food', 'spark:object'])
    assert.deepEqual(t.samImages(), ['collected', 'collected'])
    assert.deepEqual([r.body.comparison?.served_media_id, r.body.comparison?.served], [served.id, null])
    assert.ok(r.body.warnings.includes('comparison unavailable: photo size unknown'))
  })

  it('[capture/meal-reading] Photo sizes needed to compare: Size unknown and nothing on the collected tray', async () => {
    const t = await beds(RICE_QUARTER, { sam: perPhoto({ collectedDish: SAM_EMPTY }) })
    await t.serve((await t.bed(1)).id, 12, 40, { bytes: jpeg, mime: 'image/jpeg' })
    const r = await t.forBed((await t.bed(1)).id)
    assert.deepEqual(t.u.requests, ['sam:dish', 'sam:food', 'spark:object'])
    assert.deepEqual(r.body.warnings, ['comparison unavailable: photo size unknown', 'segmentation found no dishes'])
  })

  it('[capture/meal-reading] Photo sizes needed to compare: Size unknown in Spark mode', async () => {
    const t = await beds()
    const served = await t.serve((await t.bed(1)).id, 12, 40, { bytes: jpeg, mime: 'image/jpeg' })
    const r = await t.forBed((await t.bed(1)).id, { mode: 'spark' })
    assert.deepEqual(t.u.requests, ['spark:object'])
    assert.deepEqual([r.body.comparison?.served_media_id, r.body.comparison?.served], [served.id, null])
    assert.ok(!r.body.warnings.some((w) => w.startsWith('comparison unavailable')))
  })

  it('[capture/meal-reading] Tray read fits a saved meal: Largest compared read', async () => {
    // 15 dish boxes of different sizes, the same on both photos; food fills each.
    const boxes = Array.from({ length: 15 }, (_, i) => ({ left: 10 + i * 60, top: 10, right: 10 + i * 60 + 30 + i, bottom: 60 + i * 10 }))
    const name = (i: number) => `${String(i).padStart(2, '0')}${'x'.repeat(88)}`
    const t = await beds(
      {
        dishes: Array.from({ length: 25 }, (_, i) => ({
          region: (i % 12) + 1,
          name: name(i),
          dish_kind: 'other' as const,
          eaten: 'quarter' as const,
        })),
        eaten: 'quarter',
      },
      { sam: () => resp('sam-3.1', [msg(SAM_RECT(...boxes))]) },
    )
    const b1 = (await t.bed(1)).id
    const served = await t.serve(b1, 12, 40)
    const r = await t.forBed(b1)
    assert.equal(r.body.segmentation?.regions.length, 12)
    assert.equal(r.body.comparison?.served?.regions.length, 12)
    assert.equal(r.body.comparison?.matches.length, 12)
    assert.ok(r.body.comparison.matches.every((m) => m.distance2 === 0))
    assert.equal(r.body.reading.dishes.length, 20)
    assert.equal(r.body.trace.length, 5)
    const tray = (await t.app.keep(b1, { kind: 'photo', mime: 'image/png', bytes: COLLECTED }, 1))!
    const evidence = { ...r.body, draft: undefined, needs_review: undefined, ms: undefined, read_id: undefined }
    const saved = await t.app.request(`/api/admissions/${b1}/meals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        meal: 'lunch',
        portion: r.body.draft.portion,
        items: r.body.draft.items,
        source: 'photo',
        dishes: r.body.draft.dishes,
        media_id: tray.id,
        served_media_id: served.id,
        evidence,
      }),
    })
    assert.equal(saved.status, 201)
  })
})

describe('tray fluids share the drink kinds', () => {
  const GLASS = { left: 500, top: 100, right: 700, bottom: 400 }

  it('[capture/meal-reading] Tray fluids share the drink kinds: Chaas with lunch', async () => {
    const t = await tray(
      {
        dishes: [{ region: 1, name: 'rice', dish_kind: 'rice', eaten: 'half' }],
        eaten: 'half',
        fluids: [{ region: 2, name: 'chaas', fluid_kind: 'buttermilk', volume_ml: 200 }],
      },
      { sam: () => resp('sam-3.1', [msg(SAM_RECT(DISH, GLASS))]) },
    )
    const r = await t.read({ mode: 'sam+spark' })
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.reading.fluids, [{ index: 2, name: 'chaas', fluid_kind: 'buttermilk', volume_ml: 200 }])
    const spark = t.u.bodies.find((b) => b.model !== 'sam-3.1')!
    const kinds = spark.text.format.schema.properties.fluids.items.properties.fluid_kind.enum as string[]
    for (const k of ['coffee', 'coconut_water', 'buttermilk', 'ors', 'supplement']) assert.ok(kinds.includes(k), k)
    assert.match(spark.instructions as string, /\(soup, milk, tea, coffee, juice, buttermilk, coconut water, ORS, supplement drinks\)/)
    assert.deepEqual(t.u.requests, ['sam:dish', 'sam:food', 'spark:object'])
  })

  it('[capture/meal-reading] Tray fluids share the drink kinds: Coffee, Spark only', async () => {
    const t = await tray({
      fluids: [
        { region: 0, name: '  ', fluid_kind: 'coffee', volume_ml: 150 },
        { region: 0, name: 'j'.repeat(60), fluid_kind: 'juice', volume_ml: 100 },
      ],
    })
    const r = await t.read({ mode: 'spark' })
    assert.equal(r.status, 200)
    assert.equal(r.body.reading.fluids[0]!.name, 'Coffee')
    assert.ok(r.body.reading.fluids[1]!.name.length <= 40)
    assert.deepEqual(t.u.requests, ['spark:object'])
  })

  it('[capture/meal-reading] Tray fluids share the drink kinds: a compared read with a fluid still makes 5 requests', async () => {
    const t = await beds({ ...RICE_QUARTER, fluids: [{ region: 0, name: 'filter coffee', fluid_kind: 'coffee', volume_ml: 150 }] })
    await t.serve((await t.bed(1)).id, 12, 40)
    const r = await t.forBed((await t.bed(1)).id)
    assert.equal(r.status, 200)
    assert.equal(r.body.reading.fluids[0]!.fluid_kind, 'coffee')
    assert.deepEqual(t.u.requests, ['sam:dish', 'sam:food', 'sam:dish', 'sam:food', 'spark:object'])
  })
})
