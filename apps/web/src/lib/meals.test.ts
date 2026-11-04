import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type {
  DishValue,
  Meal,
  MealDish,
  MealDraft,
  MealReadResult,
  MediaRef,
  ServedTray,
  TrayComparison,
  TraySegmentation,
} from '@meniscus/shared'
import { createApi } from './api.ts'
import { fakeCopies } from './copy-fixtures.ts'
import { drawPlan, planTexts } from './labeled-copy.ts'
import { RAVI, SUNITA, ANITA } from './audit-fixtures.ts'
import {
  aiReadLines,
  comparisonNote,
  defaultMeal,
  editDish,
  emptyMealForm,
  formFromRead,
  mealLocked,
  mealLockedReason,
  mealOnOpen,
  mealPost,
  mealReviewText,
  mealRow,
  openMeal,
  readTray,
  retakeMeal,
  saveMeal,
  toMealInput,
  uploadServed,
  voidMeal,
} from './meals.ts'

/**
 * Fake server: records method, path, X-Staff-Id, JSON body, form field names and form text values of every request.
 * `/served-tray` answers `served` (default `media: null`), or 500 when `served` is 500.
 */
function server(
  read?: MealReadResult,
  { mediaStatus = 201, served = { media: null } }: { mediaStatus?: number; served?: ServedTray | 500 } = {},
) {
  let uploads = 0
  const seen: {
    req: string
    staff: string | null
    body: Record<string, unknown> | null
    form?: string[]
    fields?: Record<string, string>
  }[] = []
  const api = createApi(
    (url, init) => {
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
      const form = init?.body instanceof FormData ? [...init.body.keys()] : null
      const fields =
        init?.body instanceof FormData
          ? Object.fromEntries([...init.body.entries()].filter((e): e is [string, string] => typeof e[1] === 'string'))
          : null
      seen.push({
        req: `${init?.method ?? 'GET'} ${url}`,
        staff: new Headers(init?.headers).get('x-staff-id'),
        body,
        ...(form && { form }),
        ...(fields && { fields }),
      })
      if (url.endsWith('/served-tray'))
        return Promise.resolve(served === 500 ? Response.json({ error: 'internal' }, { status: 500 }) : Response.json(served))
      if (url === '/api/ai/meal') return Promise.resolve(Response.json(read))
      if (url.endsWith('/media'))
        return Promise.resolve(
          mediaStatus === 201
            ? Response.json({ ...TRAY, id: TRAY.id + uploads++ }, { status: 201 })
            : Response.json({ error: mediaStatus === 400 ? 'invalid_request' : 'internal' }, { status: mediaStatus }),
        )
      return Promise.resolve(Response.json(meal({ ...(body as Partial<Meal>) }), { status: 201 }))
    },
    () => 4,
  )
  return { api, seen }
}

const at = (h: number, m = 0) => new Date(2026, 10, 2, h, m)
function meal(over: Partial<Meal> = {}): Meal {
  return {
    labeled_media: null,
    id: 12,
    admission_id: 16,
    meal: 'lunch',
    portion: 50,
    items: 'rice, dal',
    fluid_ml: null,
    source: 'manual',
    confidence: null,
    evidence: null,
    created_at: at(13, 10).toISOString(),
    recorded_at: at(13, 10).toISOString(),
    late: false,
    created_by: RAVI,
    entry_id: null,
    entry_status: null,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    media: null,
    dishes: [],
    proof: null,
    served_media: null,
    amendments: [],
    amended_at: null,
    ...over,
  }
}
const SHA = '3f2a9b0c4d1e7f8a6b5c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3fc9'
/** A tray read: SAM dish + food + Spark, or Spark only when there is no segmentation. */
const tray = (
  over: Partial<MealReadResult['reading']>,
  draft: Omit<MealDraft, 'dishes'> & { dishes?: DishValue[] },
  needs = false,
  segmentation: TraySegmentation | null = null,
): MealReadResult => ({
  mode: segmentation ? 'sam+spark' : 'spark',
  image_sha256: SHA,
  reading: { items: [], dishes: [], portion: draft.portion, fluids: [], confidence: 0.8, issues: [], notes: null, ...over },
  segmentation,
  comparison: null,
  draft: { dishes: [], ...draft },
  needs_review: needs,
  warnings: [],
  trace: [
    ...(segmentation
      ? [
          { step: 'sam:dish', model: 'sam-3.1', ms: 900 },
          { step: 'sam:food', model: 'sam-3.1', ms: 950 },
        ]
      : []),
    { step: 'spark:meal', model: 'muse-spark-1.3', ms: 2140 },
  ],
  ms: 2200,
})
const box = (left: number) => ({ left, top: 100, right: left + 300, bottom: 400 })
const region = (index: number, left: number) => ({
  index,
  box: box(left),
  coverage: 0.5,
  mask: { width: 2, height: 1, bits: 'wA==' },
  food: { width: 2, height: 1, bits: 'gA==' },
})
const dish = (index: number, name: string, dish_kind: DishValue['dish_kind'], portion: DishValue['portion']): MealDish => ({
  index,
  name,
  dish_kind,
  portion,
  basis: 'model',
  box: box(index * 400 - 300),
  coverage: portion === 100 ? 0 : 0.5,
  model_portion: portion,
  measure: null,
})
const value = ({ index, name, dish_kind, portion }: MealDish): DishValue => ({ index, name, dish_kind, portion })
/** Rice in region 1, half eaten, and dal in region 2, all eaten. */
const riceAndDal = () => {
  const dishes = [dish(1, 'rice', 'rice', 50), dish(2, 'dal', 'dal_lentils', 100)]
  return tray(
    { items: dishes.map((d) => ({ name: d.name, portion: d.portion })), dishes, portion: 75 },
    { portion: 75, items: 'rice, dal', fluid_ml: null, dishes: dishes.map(value) },
    false,
    { regions: [region(1, 100), region(2, 500)], loose_food: 0 },
  )
}
const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })
/** The tray photo as the server keeps it. */
const TRAY: MediaRef = {
  id: 52,
  kind: 'photo',
  mime: 'image/jpeg',
  size: 4,
  duration_ms: null,
  created_at: at(8, 0).toISOString(),
  sha256: null,
  served_meal: null,
}

describe('meal capture', () => {
  it('[web/capture] Meal capture: Lunch by hand', async () => {
    const { api, seen } = server()
    const open = await openMeal(api, 16, at(13, 10))
    const f = { ...emptyMealForm(at(13, 10)), meal: open.meal, portion: 50 as const, items: 'rice, dal', fluid_ml: 150 }
    assert.equal(f.meal, 'lunch')
    await saveMeal(api, 16, f, null)
    assert.deepEqual(
      seen.map((s) => s.req),
      ['GET /api/admissions/16/served-tray', 'POST /api/admissions/16/meals'],
    )
    assert.deepEqual(seen[1]!.body, { meal: 'lunch', portion: 50, items: 'rice, dal', fluid_ml: 150, source: 'manual' })
  })

  it('[web/capture] Meal capture: Tray photo', async () => {
    const dishes = [dish(1, 'idli', 'porridge_cereal', 75), dish(2, 'sambar', 'dal_lentils', 75)]
    const read = tray(
      {
        items: [
          { name: 'idli', portion: 75 },
          { name: 'sambar', portion: 75 },
        ],
        dishes,
        fluids: [{ index: 2, name: 'sambar', fluid_kind: 'other', volume_ml: 100 }],
      },
      { portion: 75, items: 'idli, sambar', fluid_ml: 100, dishes: dishes.map(value) },
      false,
      { regions: [region(1, 100), region(2, 500)], loose_food: 0 },
    )
    const { api, seen } = server(read)
    const open = await openMeal(api, 16, at(8, 0))
    const f = await readTray(api, 16, { ...emptyMealForm(at(8, 0)), meal: open.meal }, blob)
    await saveMeal(api, 16, f, null, { kind: 'photo', blob })
    assert.deepEqual(
      seen.map((s) => s.req),
      ['GET /api/admissions/16/served-tray', 'POST /api/ai/meal', 'POST /api/admissions/16/media', 'POST /api/admissions/16/meals'],
    )
    assert.equal(seen.filter((s) => s.req.includes('/api/ai/')).length, 1)
    // The web sends no mode: the server's setting decides. The bed and meal find a served photo.
    assert.deepEqual(seen[1]!.form, ['image', 'admission_id', 'meal'])
    const body = seen[3]!.body!
    assert.equal(body.portion, 75)
    assert.equal(body.items, 'idli, sambar')
    assert.equal(body.fluid_ml, 100)
    assert.equal(body.source, 'photo')
    assert.equal(body.confidence, 0.8)
    assert.deepEqual(body.evidence, {
      mode: read.mode,
      image_sha256: read.image_sha256,
      reading: read.reading,
      segmentation: read.segmentation,
      comparison: null,
      warnings: read.warnings,
      trace: read.trace,
    })
    assert.deepEqual(body.dishes, read.draft.dishes)
    assert.equal(body.media_id, TRAY.id)
    assert.equal('served_media_id' in body, false)
  })

  it('[web/capture] Tray photo saved with the meal: Lunch from a tray', async () => {
    const copies = fakeCopies()
    const { api, seen } = server()
    const read = riceAndDal()
    const f = formFromRead(emptyMealForm(at(13, 10)), read)
    const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })
    await saveMeal(api, 16, f, null, { kind: 'photo', blob: photo })
    copies.restore()
    assert.deepEqual(
      seen.map((s) => s.req),
      ['POST /api/admissions/16/media', 'POST /api/admissions/16/media', 'POST /api/admissions/16/meals'],
    )
    assert.equal(seen[0]!.staff, '4')
    assert.equal(seen[1]!.fields!.kind, 'photo')
    assert.equal(seen[2]!.body!.media_id, TRAY.id)
    assert.equal(seen[2]!.body!.labeled_media_id, TRAY.id + 1)
    // The copy is drawn from the tray photo with the form's dishes on the read's regions.
    assert.equal(copies.draws[0]!.photo, photo)
    assert.deepEqual(planTexts(drawPlan({ width: 1000, height: 600 }, copies.draws[0]!.subject)!), ['1 rice · Half', '2 dal · All'])
    // By hand: the same photo is never uploaded for a meal that was not read from it.
    const byHand = server()
    await saveMeal(byHand.api, 16, emptyMealForm(at(13, 10)), null, { kind: 'photo', blob: photo })
    assert.deepEqual(
      byHand.seen.map((s) => s.req),
      ['POST /api/admissions/16/meals'],
    )
  })

  it('[web/capture] Tray photo saved with the meal: Spark-only tray', async () => {
    const copies = fakeCopies()
    const { api, seen } = server()
    const read = tray({}, { portion: 50, items: 'rice, dal', fluid_ml: 150 })
    assert.equal(read.segmentation, null)
    await saveMeal(api, 16, formFromRead(emptyMealForm(at(13, 10)), read), null, { kind: 'photo', blob })
    copies.restore()
    assert.deepEqual(
      seen.map((s) => s.req),
      ['POST /api/admissions/16/media', 'POST /api/admissions/16/meals'],
    )
    assert.equal(seen[1]!.body!.media_id, TRAY.id)
    assert.equal('labeled_media_id' in seen[1]!.body!, false)
    assert.equal(copies.draws.length, 0)
  })

  it('[web/capture] Dishes on the meal form: Rice was finished', async () => {
    const read = riceAndDal()
    const { api, seen } = server()
    let f = formFromRead(emptyMealForm(at(13, 10)), read)
    assert.deepEqual(f.dishes, read.draft.dishes)
    f = editDish(f, 0, { portion: 100 })
    f = editDish(f, 1, { name: 'sambar' })
    await saveMeal(api, 16, f, null, { kind: 'photo', blob })
    assert.deepEqual(
      seen.map((s) => s.req),
      ['POST /api/admissions/16/media', 'POST /api/admissions/16/meals'],
    )
    const body = seen[1]!.body!
    assert.deepEqual(body.dishes, [
      { index: 1, name: 'rice', dish_kind: 'rice', portion: 100 },
      { index: 2, name: 'sambar', dish_kind: 'dal_lentils', portion: 100 },
    ])
    assert.equal(body.items, 'rice, sambar')
    // The read is evidence, unchanged.
    const evidence = body.evidence as { image_sha256: string; reading: MealReadResult['reading'] }
    assert.equal(evidence.reading.dishes[0]!.portion, 50)
    assert.equal(evidence.reading.dishes[1]!.name, 'dal')
    assert.equal(evidence.image_sha256, read.image_sha256)
    assert.equal(seen.filter((s) => s.req.includes('/api/ai')).length, 0)
  })

  it('[web/capture] Dishes on the meal form: Read with no dishes', () => {
    const read = tray({ items: [{ name: 'idli', portion: 75 }] }, { portion: 75, items: 'idli', fluid_ml: null })
    const f = formFromRead(emptyMealForm(at(8, 0)), read)
    // No dish rows: the items field, as for a meal by hand.
    assert.deepEqual(f.dishes, [])
    const input = toMealInput({ ...f, items: 'idli, chutney' }, null)
    assert.equal(input.items, 'idli, chutney')
    assert.equal('dishes' in input, false)
  })

  it('[web/capture] Dishes on the meal form: Tray photo not kept', async () => {
    const read = riceAndDal()
    const { api, seen } = server(undefined, { mediaStatus: 500 })
    const saved = await saveMeal(api, 16, formFromRead(emptyMealForm(at(13, 10)), read), null, { kind: 'photo', blob })
    assert.deepEqual(
      seen.map((s) => s.req),
      ['POST /api/admissions/16/media', 'POST /api/admissions/16/meals'],
    )
    const body = seen[1]!.body!
    assert.deepEqual(body.dishes, read.draft.dishes)
    assert.equal('media_id' in body, false)
    assert.equal('evidence' in body, false)
    assert.equal(saved.warning, 'Saved, but the photo was not kept.')
  })

  it('cuts the joined dish names to the items limit, and trims each name', () => {
    const read = riceAndDal()
    const long = editDish(formFromRead(emptyMealForm(at(13, 10)), read), 0, { name: `  ${'r'.repeat(80)}  ` })
    const many = { ...long, dishes: Array.from({ length: 4 }, () => long.dishes[0]!) }
    const input = toMealInput(many, null)
    assert.equal(input.items?.length, 200)
    assert.equal(input.dishes?.[0]?.name, 'r'.repeat(80))
  })

  it('[web/capture] Meal capture: Tray needs a check', async () => {
    const { api, seen } = server()
    await openMeal(api, 16, at(13, 10))
    assert.deepEqual(
      seen.map((s) => s.req),
      ['GET /api/admissions/16/served-tray'],
    )
    const read = tray({ confidence: 0.6, issues: ['partly_hidden'] }, { portion: 50, items: 'rice', fluid_ml: null }, true)
    assert.equal(mealReviewText(read), 'Check the tray: low confidence (0.60), partly hidden')
    assert.equal(mealReviewText(tray({}, { portion: 50, items: 'rice', fluid_ml: null })), null)
  })

  it('[web/capture] Meal capture: Meal by time of day', async () => {
    const { api, seen } = server()
    const opened = []
    for (const t of [at(7, 45), at(15, 30), at(21, 0)]) opened.push((await openMeal(api, 16, t)).meal)
    assert.deepEqual(opened, ['breakfast', 'snack', 'dinner'])
    assert.deepEqual(
      seen.map((s) => s.req),
      Array.from({ length: 3 }, () => 'GET /api/admissions/16/served-tray'),
    )
    assert.deepEqual([at(7, 45), at(15, 30), at(21, 0)].map(defaultMeal), ['breakfast', 'snack', 'dinner'])
    assert.deepEqual([at(5, 0), at(10, 29), at(10, 30), at(14, 59), at(18, 0), at(4, 59)].map(defaultMeal), [
      'breakfast',
      'breakfast',
      'lunch',
      'lunch',
      'dinner',
      'dinner',
    ])
  })

  it('refuses a bad time without sending', async () => {
    const { api, seen } = server()
    await assert.rejects(saveMeal(api, 16, emptyMealForm(at(13)), { error: 'Before admission' }), /Before admission/)
    assert.deepEqual(seen, [])
  })
})

const servedPhoto = (meal: MediaRef['served_meal'], h: number, m: number): MediaRef => ({
  ...TRAY,
  id: 41,
  created_at: at(h, m).toISOString(),
  sha256: '9b1c4d2e7f8a6b5c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a10e2',
  served_meal: meal,
})
const SEG: TraySegmentation = { regions: [region(1, 100), region(2, 500)], loose_food: 0 }
const comparison = (served: TraySegmentation | null): TrayComparison => ({
  served_media_id: 41,
  served_sha256: '9b1c4d2e7f8a6b5c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a10e2',
  served_at: at(12, 40).toISOString(),
  size: served ? { width: 1000, height: 800 } : null,
  served_size: served ? { width: 1000, height: 800 } : null,
  served,
  matches: served ? [{ index: 1, served_index: 1, distance2: 0 }] : [],
})
/** Rice measured Half (the AI said a quarter) and dal All by the AI; with a served photo compared, or kept uncompared. */
function comparedLunch(served: TraySegmentation | null = SEG): MealReadResult {
  const rice: MealDish = {
    ...dish(1, 'rice', 'rice', served ? 50 : 25),
    model_portion: 25,
    ...(served && { basis: 'measured' as const, measure: { served_index: 1, served_coverage: 0.8 } }),
  }
  const dishes = [rice, dish(2, 'dal', 'dal_lentils', 100)]
  return {
    ...tray(
      {
        items: dishes.map((d) => ({ name: d.name, portion: d.portion })),
        dishes,
      },
      { portion: 75, items: 'rice, dal', fluid_ml: null, dishes: dishes.map(value) },
      false,
      SEG,
    ),
    comparison: comparison(served),
  }
}

describe('served tray at the bed', () => {
  it('[web/capture] Meal follows the served tray: Lunch collected late', async () => {
    const { api, seen } = server(comparedLunch(), { served: { media: servedPhoto('lunch', 14, 30) } })
    const open = await openMeal(api, 1, at(15, 10))
    assert.deepEqual(
      seen.map((s) => s.req),
      ['GET /api/admissions/1/served-tray'],
    )
    assert.equal(defaultMeal(at(15, 10)), 'snack')
    assert.deepEqual(open, { meal: 'lunch', waiting: 'Served lunch tray from 14:30 waiting' })
    await readTray(api, 1, { ...emptyMealForm(at(15, 10)), meal: open.meal }, blob)
    const reads = seen.filter((s) => s.req.includes('/api/ai/'))
    assert.deepEqual(
      reads.map((s) => s.req),
      ['POST /api/ai/meal'],
    )
    assert.equal(reads[0]!.fields!.meal, 'lunch')
  })

  it('[web/capture] Meal follows the served tray: No served tray waiting', async () => {
    const empty = server()
    const failed = server(undefined, { served: 500 })
    const a = await openMeal(empty.api, 1, at(15, 10))
    const b = await openMeal(failed.api, 2, at(15, 10))
    assert.deepEqual(a, { meal: 'snack', waiting: null })
    assert.deepEqual(b, { meal: 'snack', waiting: null })
    assert.deepEqual(
      empty.seen.map((s) => s.req),
      ['GET /api/admissions/1/served-tray'],
    )
    assert.deepEqual(
      failed.seen.map((s) => s.req),
      ['GET /api/admissions/2/served-tray'],
    )
    // Pure: a failed lookup (null) is the time of day too.
    assert.deepEqual(mealOnOpen(at(15, 10), null), { meal: 'snack', waiting: null })
  })

  it('[web/capture] Served tray photo at the bed: Lunch served', async () => {
    const { api, seen } = server()
    const open = await openMeal(api, 1, at(12, 40))
    assert.equal(open.meal, 'lunch')
    const r = await uploadServed(api, 1, open.meal, blob, at(12, 40))
    assert.deepEqual(
      seen.map((s) => s.req),
      ['GET /api/admissions/1/served-tray', 'POST /api/admissions/1/media'],
    )
    assert.equal(seen[1]!.fields!.kind, 'photo')
    assert.equal(seen[1]!.fields!.served_meal, 'lunch')
    assert.deepEqual(r, { ok: true, text: 'Served lunch kept at 12:40. Photograph the tray again when it is collected.' })
  })

  it("[web/capture] Photos are shrunk before upload: Server refuses the photo's size", async () => {
    for (const mediaStatus of [413, 400]) {
      const { api } = server(undefined, { mediaStatus })
      const r = await uploadServed(api, 1, 'lunch', blob, at(12, 40))
      assert.deepEqual(r, { ok: false, text: 'Photo too large · max 8 MB. Retake closer or in better light.' }, String(mediaStatus))
    }
  })

  it('[web/capture] Served tray photo at the bed: Served photo not kept', async () => {
    const { api, seen } = server(undefined, { mediaStatus: 500 })
    const r = await uploadServed(api, 1, 'lunch', blob, at(12, 40))
    assert.deepEqual(r, { ok: false, text: 'Served tray photo not kept. You can still photograph the tray when it is collected.' })
    assert.deepEqual(
      seen.map((s) => s.req),
      ['POST /api/admissions/1/media'],
    )
  })

  it('[web/capture] Collected tray compared at the bed: Lunch compared', async () => {
    const { api, seen } = server(comparedLunch())
    const f = await readTray(api, 1, { ...emptyMealForm(at(13, 30)), meal: 'lunch' }, blob)
    assert.deepEqual(
      seen.map((s) => s.req),
      ['POST /api/ai/meal'],
    )
    assert.deepEqual(seen[0]!.form, ['image', 'admission_id', 'meal'])
    assert.deepEqual(seen[0]!.fields, { admission_id: '1', meal: 'lunch' })
    assert.equal(comparisonNote(f.read), 'Compared with the served tray from 12:40')
    assert.deepEqual(
      f.read!.reading.dishes.map((d) => d.basis),
      ['measured', 'model'],
    )
    assert.equal(mealLocked(f), true)
    assert.equal(mealLockedReason(f), 'Meal fixed to lunch by the served tray. Retake to change it.')
    seen.length = 0
    const copies = fakeCopies()
    await saveMeal(api, 1, f, null, { kind: 'photo', blob })
    copies.restore()
    assert.deepEqual(
      seen.map((s) => s.req),
      ['POST /api/admissions/1/media', 'POST /api/admissions/1/media', 'POST /api/admissions/1/meals'],
    )
    assert.equal(seen.at(0)!.fields!.kind, 'photo')
    assert.equal(seen.at(1)!.fields!.kind, 'photo')
    const body = seen[2]!.body!
    assert.equal(body.media_id, 52)
    assert.equal(body.labeled_media_id, 53)
    assert.equal(body.served_media_id, 41)
    assert.deepEqual((body.evidence as { comparison: unknown }).comparison, f.read!.comparison)
  })

  it('[web/capture] Collected tray compared at the bed: Served photo not compared', async () => {
    const { api, seen } = server(comparedLunch(null))
    const f = await readTray(api, 1, { ...emptyMealForm(at(13, 30)), meal: 'lunch' }, blob)
    assert.equal(comparisonNote(f.read), 'Served tray from 12:40 kept with the meal')
    assert.equal(
      f.read!.reading.dishes.some((d) => d.basis === 'measured'),
      false,
    )
    await saveMeal(api, 1, f, null, { kind: 'photo', blob })
    assert.equal(seen.at(-1)!.body!.served_media_id, 41)
  })

  it('[web/capture] Collected tray compared at the bed: No served photo', async () => {
    const { api, seen } = server(riceAndDal())
    const f = await readTray(api, 1, { ...emptyMealForm(at(13, 30)), meal: 'lunch' }, blob)
    assert.equal(comparisonNote(f.read), null)
    assert.equal(mealLocked(f), false)
    assert.equal(mealLockedReason(f), null)
    await saveMeal(api, 1, f, null, { kind: 'photo', blob })
    const body = seen.at(-1)!.body!
    assert.equal(body.media_id, 52)
    assert.equal('served_media_id' in body, false)
  })

  it('[web/capture] Collected tray compared at the bed: Tray photo not kept', async () => {
    const { api, seen } = server(comparedLunch(), { mediaStatus: 500 })
    const f = await readTray(api, 1, { ...emptyMealForm(at(13, 30)), meal: 'lunch' }, blob)
    const copies = fakeCopies()
    const saved = await saveMeal(api, 1, f, null, { kind: 'photo', blob })
    copies.restore()
    const body = seen.at(-1)!.body!
    assert.equal(seen.at(-1)!.req, 'POST /api/admissions/1/meals')
    assert.equal(seen.filter((s) => s.req.endsWith('/media')).length, 1, 'no labeled copy is uploaded')
    assert.equal(copies.draws.length, 0)
    assert.equal('media_id' in body, false)
    assert.equal('labeled_media_id' in body, false)
    assert.equal('served_media_id' in body, false)
    assert.equal('evidence' in body, false)
    assert.equal(saved.warning, 'Saved, but the photo was not kept.')
    // Pure: no media id drops all three.
    const input = toMealInput(f, null)
    assert.deepEqual(
      Object.keys(mealPost(input, f.read, undefined)).sort(),
      Object.keys(input)
        .filter((k) => k !== 'evidence')
        .sort(),
    )
  })

  it('[web/capture] Collected tray compared at the bed: Retaken for another meal', async () => {
    const first = server(comparedLunch())
    let f = await readTray(first.api, 1, { ...emptyMealForm(at(13, 30)), meal: 'lunch' }, blob)
    assert.equal(mealLocked(f), true)
    f = retakeMeal(f)
    assert.equal(mealLocked(f), false)
    assert.equal(comparisonNote(f.read), null)
    f = { ...f, meal: 'snack' }
    const second = server(riceAndDal())
    f = await readTray(second.api, 1, f, blob)
    assert.deepEqual(
      second.seen.map((s) => s.req),
      ['POST /api/ai/meal'],
    )
    assert.equal(second.seen[0]!.fields!.meal, 'snack')
    assert.equal(comparisonNote(f.read), null)
  })
})

describe('meals on the bed review', () => {
  const photoLunch = meal({
    source: 'photo',
    fluid_ml: 150,
    entry_id: 90,
    entry_status: 'pending',
    confidence: 0.82,
    evidence: {
      mode: 'spark',
      image_sha256: null,
      segmentation: null,
      warnings: [],
      comparison: null,
      reading: {
        items: [
          { name: 'rice', portion: 50 },
          { name: 'dal', portion: 100 },
        ],
        dishes: [],
        portion: 50,
        fluids: [{ index: 0, name: 'soup', fluid_kind: 'soup', volume_ml: 150 }],
        confidence: 0.82,
        issues: [],
        notes: null,
      },
      trace: [{ step: 'spark:meal', model: 'muse-spark-1.3', ms: 2140 }],
    },
  })

  it('[web/ward] Meals on the bed review: Lunch from a tray photo', () => {
    assert.deepEqual(mealRow(photoLunch), {
      time: '13:10',
      meal: 'Lunch',
      portion: 'Half',
      parts: 2,
      items: 'rice, dal',
      fluid: '+150 mL · pending',
      by: 'Tray photo by Ravi K.',
      voided: null,
    })
  })

  it('[web/ward] Meals on the bed review: Breakfast by hand', () => {
    const r = mealRow(meal({ meal: 'breakfast', portion: 100, items: null, created_at: at(8, 5).toISOString(), created_by: SUNITA }))
    assert.equal(r.time, '08:05')
    assert.equal(r.meal, 'Breakfast')
    assert.equal(r.portion, 'All')
    assert.equal(r.parts, 4)
    assert.equal(r.fluid, null)
    assert.equal(r.by, 'By hand by Sunita D.')
  })

  it('[web/ward] Meals on the bed review: What the AI read', () => {
    assert.deepEqual(aiReadLines(photoLunch), {
      items: ['rice · Half', 'dal · All'],
      fluids: ['soup · 150 mL'],
      steps: ['Muse Spark · tray · 2.1 s'],
      notes: null,
    })
    assert.equal(aiReadLines(meal()), null)
  })

  it('[web/ward] Meals on the bed review: Voided meal', () => {
    const r = mealRow(meal({ meal: 'breakfast', voided_at: at(9).toISOString(), voided_by: ANITA, void_reason: 'wrong bed' }))
    assert.equal(r.voided, 'Voided: wrong bed · Anita T.')
  })

  it('[web/ward] Void a meal from the bed review: Void with a reason', async () => {
    const { api, seen } = server()
    assert.equal(await voidMeal(api, 12, 'ab'), null)
    assert.deepEqual(seen, [])
    await voidMeal(api, 12, ' duplicate photo ')
    assert.deepEqual(seen, [{ req: 'POST /api/meals/12/void', staff: '4', body: { reason: 'duplicate photo' } }])
  })
})
