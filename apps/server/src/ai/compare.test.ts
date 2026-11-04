import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MealDish, TrayRegion, TraySegmentation } from '@meniscus/shared'
import { jpeg, png } from '../testing.ts'
import { sha256Hex } from '../hash.ts'
import { centreOf, matchRegions, measureDishes, quarters, servedCheck, shareOk } from './compare.ts'

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })
const mask = { width: 1, height: 1, bits: 'gA==' }
const region = (index: number, b: ReturnType<typeof box>, coverage = 0.5): TrayRegion => ({ index, box: b, coverage, mask, food: mask })
const seg = (...regions: TrayRegion[]): TraySegmentation => ({ regions, loose_food: null })
const S1000 = { width: 1000, height: 800 }
const dish = (index: number, portion: MealDish['portion'], name = 'rice'): MealDish => ({
  index,
  name,
  dish_kind: 'rice',
  portion,
  basis: 'model',
  box: null,
  coverage: null,
  model_portion: portion,
  measure: null,
})

/** One matched dish with served coverage `s` and collected coverage `n`, read by the model at `portion`. */
function measureOne(s: number, n: number, portion: MealDish['portion'] = 25) {
  const b = box(100, 80, 400, 480)
  return measureDishes([dish(1, portion)], seg(region(1, b, n)), seg(region(1, b, s)), [{ index: 1, served_index: 1, distance2: 0 }])[0]!
}

describe('served tray matching', () => {
  it('[capture/meal-reading] Served dishes matched by place: Same tray, larger photo', () => {
    const served = [region(1, box(100, 80, 400, 480)), region(2, box(500, 100, 700, 300))]
    const collected = [region(1, box(240, 200, 840, 1000)), region(2, box(1000, 240, 1400, 640))]
    const size = { width: 2000, height: 1600 }
    assert.deepEqual(centreOf(collected[0]!.box, size), { x: 270, y: 375 })
    assert.deepEqual(centreOf(served[0]!.box, S1000), { x: 250, y: 350 })
    assert.deepEqual(centreOf(collected[1]!.box, size), { x: 600, y: 275 })
    assert.deepEqual(centreOf(served[1]!.box, S1000), { x: 600, y: 250 })
    assert.deepEqual(matchRegions(collected, size, served, S1000), [
      { index: 1, served_index: 1, distance2: 1025 },
      { index: 2, served_index: 2, distance2: 625 },
    ])
  })

  it('[capture/meal-reading] Served dishes matched by place: At the limit', () => {
    const served = [region(1, box(100, 80, 400, 480))]
    assert.deepEqual(matchRegions([region(1, box(300, 80, 600, 480))], S1000, served, S1000), [
      { index: 1, served_index: 1, distance2: 40000 },
    ])
    assert.deepEqual(centreOf(box(302, 80, 600, 480), S1000), { x: 451, y: 350 })
    assert.deepEqual(matchRegions([region(1, box(302, 80, 600, 480))], S1000, served, S1000), [])
  })

  it('[capture/meal-reading] Served dishes matched by place: Two bowls equally near', () => {
    const served = [region(1, box(350, 350, 450, 450)), region(2, box(550, 350, 650, 450))]
    assert.deepEqual(matchRegions([region(1, box(450, 350, 550, 450))], S1000, served, S1000), [])
  })

  it('[capture/meal-reading] Served dishes matched by place: Different size', () => {
    assert.equal(shareOk(box(100, 80, 400, 480), S1000, box(175, 180, 325, 380), S1000), false)
    assert.deepEqual(matchRegions([region(1, box(175, 180, 325, 380))], S1000, [region(1, box(100, 80, 400, 480))], S1000), [])
  })

  it('[capture/meal-reading] Served dishes matched by place: Two collected dishes near one served dish', () => {
    const collected = [region(1, box(60, 80, 360, 480)), region(2, box(120, 80, 420, 480))]
    assert.deepEqual(centreOf(collected[0]!.box, S1000), { x: 210, y: 350 })
    assert.deepEqual(centreOf(collected[1]!.box, S1000), { x: 270, y: 350 })
    assert.deepEqual(matchRegions(collected, S1000, [region(1, box(100, 80, 400, 480))], S1000), [
      { index: 2, served_index: 1, distance2: 400 },
    ])
  })

  it('centreOf rounds half up, in integers', () => {
    assert.equal(centreOf(box(100, 0, 401, 10), { width: 1000, height: 10 }).x, 251)
    assert.equal(centreOf(box(100, 0, 400, 10), { width: 1000, height: 10 }).x, 250)
  })

  it('shareOk keeps precision on the largest photos (BigInt)', () => {
    const big = { width: 65_535, height: 65_535 }
    assert.equal(shareOk(box(0, 0, 65_535, 65_535), big, box(0, 0, 65_535, 32_768), big), true)
    assert.equal(shareOk(box(0, 0, 65_535, 65_535), big, box(0, 0, 65_535, 32_767), big), false)
  })

  it('matches come out sorted by collected index, whatever the input order', () => {
    const served = [region(2, box(500, 100, 700, 300)), region(1, box(100, 80, 400, 480))]
    const collected = [region(2, box(500, 100, 700, 300)), region(1, box(100, 80, 400, 480))]
    assert.deepEqual(
      matchRegions(collected, S1000, served, S1000).map((m) => m.index),
      [1, 2],
    )
  })

  it('servedCheck: same bytes first, then both sizes', () => {
    const a = png(1000, 800, 1)
    const b = png(1000, 800, 2)
    assert.equal(servedCheck(a, 'image/png', { bytes: a, mime: 'image/png', sha256: sha256Hex(a) }), 'same_bytes')
    // Same bytes even when no size could be read.
    assert.equal(servedCheck(jpeg, 'image/jpeg', { bytes: jpeg, mime: 'image/jpeg', sha256: sha256Hex(jpeg) }), 'same_bytes')
    assert.equal(servedCheck(a, 'image/png', { bytes: jpeg, mime: 'image/jpeg', sha256: sha256Hex(jpeg) }), 'size_unknown')
    assert.deepEqual(servedCheck(a, 'image/png', { bytes: b, mime: 'image/png', sha256: sha256Hex(b) }), {
      size: S1000,
      served_size: S1000,
    })
  })
})

describe('measured portions', () => {
  it('[capture/meal-reading] Portion measured from the served tray: Half eaten', () => {
    const d = measureOne(0.8, 0.4, 25)
    assert.equal(d.portion, 50)
    assert.equal(d.basis, 'measured')
    assert.equal(d.model_portion, 25)
    assert.deepEqual(d.measure, { served_index: 1, served_coverage: 0.8 })
  })

  it('[capture/meal-reading] Portion measured from the served tray: Halves round up', () => {
    assert.equal(measureOne(0.16, 0.14).portion, 25)
    assert.equal(quarters(160, 140), 1)
    assert.equal(measureOne(0.8, 0.1).portion, 100)
    assert.equal(quarters(800, 100), 4)
  })

  it('[capture/meal-reading] Portion measured from the served tray: Served tray nearly empty', () => {
    const d = measureOne(0.08, 0.07, 50)
    assert.deepEqual([d.portion, d.basis, d.measure], [50, 'model', null])
  })

  it('[capture/meal-reading] Portion measured from the served tray: More on the tray than served', () => {
    const first = measureOne(0.4, 0.51, 25)
    assert.deepEqual([first.portion, first.basis], [25, 'model'])
    const second = measureOne(0.4, 0.5, 25)
    assert.deepEqual([second.portion, second.basis], [0, 'measured'])
  })

  it('[capture/meal-reading] Portion measured from the served tray: Two dishes on one plate', () => {
    const b = box(100, 80, 400, 480)
    const out = measureDishes([dish(1, 50, 'rice'), dish(1, 75, 'dal')], seg(region(1, b, 0.4)), seg(region(1, b, 0.8)), [
      { index: 1, served_index: 1, distance2: 0 },
    ])
    assert.deepEqual(
      out.map((d) => [d.name, d.portion, d.basis, d.measure]),
      [
        ['rice', 50, 'model', null],
        ['dal', 75, 'model', null],
      ],
    )
  })

  it('quarters: every row of the table, the float trap and the clamp', () => {
    const rows: [number, number, number][] = [
      [800, 400, 2],
      [160, 140, 1],
      [80, 70, 1],
      [800, 100, 4],
      [400, 500, 0],
      [150, 150, 0],
    ]
    for (const [s, n, q] of rows) assert.equal(quarters(s, n), q, `${s}/${n}`)
    for (const [s, n] of [
      [80, 70],
      [160, 140],
      [320, 280],
      [640, 560],
    ] as const)
      assert.equal(quarters(s, n), 1, `${s}/${n}`)
    assert.equal(quarters(400, 500), 0)
    assert.equal(quarters(100, 0), 4)
  })

  it('unmatched dishes and index 0 keep the model portion', () => {
    const b = box(100, 80, 400, 480)
    const out = measureDishes([dish(1, 50), dish(0, 75)], seg(region(1, b, 0.4)), seg(region(1, b, 0.8)), [])
    assert.deepEqual(
      out.map((d) => [d.basis, d.portion]),
      [
        ['model', 50],
        ['model', 75],
      ],
    )
  })
})
