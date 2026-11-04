import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DISH_KINDS, MEAL_FLUID_KINDS, type TraySegmentation } from '@meniscus/shared'
import { trayMasks, trayScene } from '../../scripts/synthetic-photo.ts'
import { MEAL_JSON_SCHEMA, toMealDraft, toMealReading, type MealModelOutput } from './meal.ts'
import type { Box } from './segmentation.ts'
import { coveragePercent, layoutTray, packMask, positionOf, sampleStep, trayContext, type TrayMask } from './tray.ts'

/** A mask filling its box, one raster cell per pixel (exact at step 1). */
const full = (left: number, top: number, right: number, bottom: number): TrayMask => ({
  bounds: { left, top, right, bottom },
  width: right - left,
  height: bottom - top,
  raster: new Uint8Array((right - left) * (bottom - top)).fill(1),
})
/** A mask filling its box with a single raster cell. */
const rect = (left: number, top: number, right: number, bottom: number): TrayMask => ({
  bounds: { left, top, right, bottom },
  width: 1,
  height: 1,
  raster: new Uint8Array([1]),
})
const boxOf = (b: Box) => [b.left, b.top, b.right, b.bottom]

describe('tray geometry', () => {
  it('[capture/meal-reading] Dish coverage: Half-full plate', () => {
    const seg = layoutTray([full(0, 0, 100, 100)], [full(0, 0, 50, 100)])
    assert.equal(seg.regions.length, 1)
    assert.equal(seg.regions[0]!.index, 1)
    assert.equal(seg.regions[0]!.coverage, 0.5)
    assert.equal(seg.loose_food, 0)
  })

  it('[capture/meal-reading] Dish coverage: Empty bowl', () => {
    const seg = layoutTray([full(0, 0, 100, 100)], [])
    assert.equal(seg.regions[0]!.coverage, 0)
    assert.equal(seg.loose_food, null)
  })

  it('[capture/meal-reading] Dish coverage: Two foods in one bowl', () => {
    const seg = layoutTray([full(0, 0, 100, 100)], [full(0, 0, 60, 100), full(40, 0, 100, 50)])
    assert.equal(seg.regions[0]!.coverage, 0.8)
  })

  it('[capture/meal-reading] Dish coverage: Food beside the plate', () => {
    const seg = layoutTray([full(0, 0, 100, 100)], [full(0, 0, 50, 100), full(150, 0, 200, 50)])
    assert.equal(seg.regions[0]!.coverage, 0.5)
    assert.equal(seg.loose_food, 0.333)
  })

  it('[capture/meal-reading] Dish coverage: Bowl on a plate', () => {
    const seg = layoutTray([full(50, 50, 150, 150), full(0, 0, 200, 200)], [full(50, 50, 150, 150)])
    assert.deepEqual(
      seg.regions.map((r) => [r.index, boxOf(r.box), r.coverage]),
      [
        [1, [0, 0, 200, 200], 0],
        [2, [50, 50, 150, 150], 1],
      ],
    )
  })

  it('[capture/meal-reading] Dish coverage: One above the other', () => {
    const seg = layoutTray([full(0, 200, 100, 300), full(0, 0, 100, 100)], [])
    assert.deepEqual(
      seg.regions.map((r) => [r.index, boxOf(r.box)]),
      [
        [1, [0, 0, 100, 100]],
        [2, [0, 200, 100, 300]],
      ],
    )
  })

  it('[capture/meal-reading] Dish coverage: Crowded tray', () => {
    const small = [rect(0, 300, 30, 330), rect(500, 300, 530, 330), rect(1100, 300, 1130, 330)]
    const row = Array.from({ length: 12 }, (_, i) => rect(i * 100, 0, i * 100 + 100, 100)).reverse()
    const seg = layoutTray([small[0]!, ...row.slice(0, 6), small[1]!, ...row.slice(6), small[2]!], [])
    assert.equal(seg.regions.length, 12)
    assert.deepEqual(
      seg.regions.map((r) => [r.index, r.box.left, r.box.right - r.box.left]),
      Array.from({ length: 12 }, (_, i) => [i + 1, i * 100, 100]),
    )
  })

  it('[capture/meal-reading] Dish coverage: Crumb', () => {
    assert.deepEqual(layoutTray([full(10, 10, 25, 25)], []).regions, [])
  })

  it('drops a dish hidden entirely under smaller ones', () => {
    // The tray-sized "dish" is covered by two smaller dishes that each own their pixels.
    const seg = layoutTray([full(0, 0, 100, 100), full(0, 0, 60, 100), full(40, 0, 100, 100)], [])
    assert.deepEqual(
      seg.regions.map((r) => boxOf(r.box)),
      [
        [0, 0, 60, 100],
        [40, 0, 100, 100],
      ],
    )
  })

  it('samples a full 1280 × 960 tray every 6 px, and small fixtures every pixel', () => {
    assert.equal(sampleStep(1280, 960), 6)
    assert.equal(sampleStep(200, 200), 1)
  })

  it('names positions by thirds of the regions’ extent', () => {
    const all: Box[] = [
      { left: 0, top: 0, right: 100, bottom: 100 },
      { left: 200, top: 200, right: 300, bottom: 300 },
      { left: 200, top: 400, right: 300, bottom: 500 },
      { left: 400, top: 200, right: 500, bottom: 300 },
    ]
    assert.deepEqual(
      all.map((b) => positionOf(b, all)),
      ['top left', 'centre', 'bottom', 'right'],
    )
    assert.equal(positionOf(all[0]!, [all[0]!]), 'centre')
  })

  it('[capture/meal-reading] Tray read fits a saved meal: Large dish mask', () => {
    const seg = layoutTray([full(0, 0, 120, 90)], [full(0, 0, 60, 90)])
    const r = seg.regions[0]!
    for (const m of [r.mask, r.food]) {
      assert.deepEqual([m.width, m.height], [32, 24])
      assert.equal(m.bits.length, 128)
    }
  })

  it('packs a mask row-major, most significant bit first, in base64', () => {
    assert.deepEqual(
      packMask({ left: 0, top: 0, right: 2, bottom: 1 }, (x) => x < 1),
      { width: 2, height: 1, bits: 'gA==' },
    )
    const tall = packMask({ left: 0, top: 0, right: 1, bottom: 400 }, () => true)
    assert.deepEqual([tall.width, tall.height], [1, 32])
  })
})

describe('demo tray', () => {
  it('lays out the drawn plate, bowl and cup, with the plate’s coverage close to the drawn share', () => {
    const { dishes, foods } = trayMasks(50, 1)
    const seg = layoutTray(dishes, foods)
    const t = trayScene(50, 1)
    assert.deepEqual(
      seg.regions.map((r) => [r.index, r.box.left, r.box.top]),
      [t.plate, t.bowl, t.cup].map((c, i) => [i + 1, c.cx - c.r, c.cy - c.r]),
    )
    // The drawn share: plate pixels under a leftover, counted pixel by pixel.
    const inside = (c: { cx: number; cy: number; r: number }, x: number, y: number) => (x - c.cx) ** 2 + (y - c.cy) ** 2 <= c.r ** 2
    let plate = 0
    let food = 0
    for (let y = t.plate.cy - t.plate.r; y <= t.plate.cy + t.plate.r; y++) {
      for (let x = t.plate.cx - t.plate.r; x <= t.plate.cx + t.plate.r; x++) {
        if (!inside(t.plate, x, y)) continue
        plate++
        if (t.blobs.some((b) => inside(b, x, y))) food++
      }
    }
    assert.ok(t.blobs.length > 0)
    assert.ok(Math.abs(seg.regions[0]!.coverage - food / plate) <= 0.05, `${seg.regions[0]!.coverage} vs ${food / plate}`)
    // The cup holds a drink, not food.
    assert.equal(seg.regions[2]!.coverage, 0)
  })
})

describe('tray grounding text', () => {
  const region = (index: number, box: Box, coverage: number): TraySegmentation['regions'][number] => ({
    index,
    box,
    coverage,
    mask: { width: 1, height: 1, bits: 'gA==' },
    food: { width: 1, height: 1, bits: 'AA==' },
  })

  it('[capture/meal-reading] Tray segmentation grounding: Rounded coverage', () => {
    const text = trayContext({
      regions: [
        region(1, { left: 0, top: 0, right: 100, bottom: 100 }, 0.125),
        region(2, { left: 200, top: 0, right: 300, bottom: 100 }, 0.995),
      ],
      loose_food: 0,
    })
    assert.match(text, /Dish 1: .*, food covers 13%\./)
    assert.match(text, /Dish 2: .*, food covers 100%\./)
  })

  it('rounds coverage halves up with integer arithmetic', () => {
    assert.deepEqual([0.125, 0.995, 0.004, 0, 1].map(coveragePercent), [13, 100, 0, 0, 100])
  })

  it('lists each dish with its box, place and coverage, and loose food only when there is some', () => {
    const one = { regions: [region(1, { left: 211, top: 228, right: 271, bottom: 255 }, 0)], loose_food: null }
    assert.equal(
      trayContext(one),
      [
        'Read this meal tray.',
        'Segmentation found these dishes (pixels; place on the tray; share of the dish still covered by food):',
        'Dish 1: x 211–271, y 228–255, centre, food covers 0%.',
        'Use dish numbers from this list, or 0 for food in none of them.',
      ].join('\n'),
    )
    assert.doesNotMatch(trayContext({ ...one, loose_food: 0 }), /Food outside/)
    assert.match(trayContext({ ...one, loose_food: 0.12 }), /\nFood outside the dishes: 12% of the food seen\.\n/)
  })
})

describe('tray reading mapping', () => {
  const region = (index: number, box: Box, coverage: number): TraySegmentation['regions'][number] => ({
    index,
    box,
    coverage,
    mask: { width: 1, height: 1, bits: 'gA==' },
    food: { width: 1, height: 1, bits: 'AA==' },
  })
  const plateAndCup: TraySegmentation = {
    regions: [
      region(1, { left: 100, top: 80, right: 400, bottom: 480 }, 0.25),
      region(2, { left: 500, top: 100, right: 600, bottom: 200 }, 0),
    ],
    loose_food: null,
  }
  const model = (over: Partial<MealModelOutput>): MealModelOutput => ({
    dishes: [],
    eaten: 'half',
    fluids: [],
    confidence: 0.9,
    issues: [],
    notes: null,
    ...over,
  })

  it('[capture/meal-reading] Dishes and fluids in the reading: Plate and a cup of tea', () => {
    const reading = toMealReading(
      model({
        dishes: [{ region: 1, name: 'rice', dish_kind: 'rice', eaten: 'three_quarters' }],
        eaten: 'three_quarters',
        fluids: [{ region: 2, name: 'tea', fluid_kind: 'tea', volume_ml: 150 }],
      }),
      plateAndCup,
    )
    assert.deepEqual(reading.dishes, [
      {
        index: 1,
        name: 'rice',
        dish_kind: 'rice',
        portion: 75,
        basis: 'model',
        box: { left: 100, top: 80, right: 400, bottom: 480 },
        coverage: 0.25,
        model_portion: 75,
        measure: null,
      },
    ])
    assert.deepEqual(reading.fluids, [{ index: 2, name: 'tea', fluid_kind: 'tea', volume_ml: 150 }])
    assert.deepEqual(reading.items, [{ name: 'rice', portion: 75 }])
    const draft = toMealDraft(reading)
    assert.equal(draft.items, 'rice')
    assert.equal(draft.fluid_ml, 150)
    assert.deepEqual(draft.dishes, [{ index: 1, name: 'rice', dish_kind: 'rice', portion: 75 }])
  })

  it('[capture/meal-reading] Dishes and fluids in the reading: Region that does not exist', () => {
    const roti = model({
      dishes: [{ region: 7, name: 'roti', dish_kind: 'bread', eaten: 'all' }],
      fluids: [{ region: 3, name: 'milk', fluid_kind: 'milk', volume_ml: 100 }],
    })
    for (const seg of [plateAndCup, null]) {
      const r = toMealReading(roti, seg)
      assert.deepEqual(
        r.dishes.map((d) => [d.name, d.index, d.box, d.coverage]),
        [['roti', 0, null, null]],
      )
      assert.equal(r.fluids[0]!.index, 0)
    }
    // Spark-only: a region that exists in no segmentation is 0 too.
    assert.equal(toMealReading(model({ dishes: [{ region: 1, name: 'rice', dish_kind: 'rice', eaten: 'all' }] }), null).dishes[0]!.index, 0)
  })

  it('keeps items as the dishes’ names and portions, every dish read by the model, and drafts dishes without geometry', () => {
    const r = toMealReading(
      model({
        dishes: [
          { region: 1, name: '  rice ', dish_kind: 'rice', eaten: 'half' },
          { region: 0, name: ' ', dish_kind: 'other', eaten: 'all' },
          { region: 2, name: 'dal', dish_kind: 'dal_lentils', eaten: 'all' },
        ],
      }),
      plateAndCup,
    )
    assert.deepEqual(
      r.items,
      r.dishes.map((d) => ({ name: d.name, portion: d.portion })),
    )
    assert.deepEqual(
      r.items.map((i) => i.name),
      ['rice', 'dal'],
    )
    assert.ok(r.dishes.every((d) => d.basis === 'model'))
    assert.deepEqual(toMealDraft(r).dishes, [
      { index: 1, name: 'rice', dish_kind: 'rice', portion: 50 },
      { index: 2, name: 'dal', dish_kind: 'dal_lentils', portion: 100 },
    ])
  })

  it('asks Spark for strict JSON with no pattern, no nullable enum, the shared vocabularies and closed objects', () => {
    assert.doesNotMatch(JSON.stringify(MEAL_JSON_SCHEMA), /"pattern"/)
    const walk = (node: unknown, visit: (n: Record<string, unknown>) => void) => {
      if (!node || typeof node !== 'object') return
      visit(node as Record<string, unknown>)
      for (const v of Object.values(node)) walk(v, visit)
    }
    walk(MEAL_JSON_SCHEMA, (n) => {
      if (n.type === 'object') assert.equal(n.additionalProperties, false)
      if (Array.isArray(n.enum)) {
        assert.ok(!n.enum.includes(null))
        assert.ok(!(Array.isArray(n.type) && n.type.includes('null')))
      }
    })
    const props = MEAL_JSON_SCHEMA.properties
    assert.deepEqual(props.dishes.items.properties.dish_kind.enum, [...DISH_KINDS])
    assert.deepEqual(props.fluids.items.properties.fluid_kind.enum, [...MEAL_FLUID_KINDS])
  })
})
