import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { ContainerReading, Segmentation, TrayRegion } from '@meniscus/shared'
import { copyMetrics, drawPlan, PAINT, percentPolys, planTexts, smoothPoly, wantsCopy, type Poly } from './labeled-copy.ts'

const reading = (over: Partial<ContainerReading> = {}): ContainerReading => ({
  container: 'urine_bag',
  fluid: 'urine',
  volume_ml: 930,
  capacity_ml: 2000,
  marks_visible: true,
  reading_basis: 'marks',
  appearance: null,
  confidence: 0.9,
  issues: [],
  ...over,
})
const seg: Segmentation = {
  container: { left: 100, top: 80, right: 400, bottom: 900 },
  fluid: { left: 110, top: 520, right: 390, bottom: 890 },
  fill_fraction: 0.463,
  fluid_volume_ml: 930,
  container_mask: { width: 2, height: 2, bits: '8A==' },
  fluid_mask: { width: 1, height: 1, bits: 'gA==' },
}
const region = (index: number, left: number): TrayRegion => ({
  index,
  box: { left, top: 200, right: left + 300, bottom: 500 },
  coverage: 0.5,
  mask: { width: 1, height: 1, bits: 'gA==' },
  food: { width: 1, height: 1, bits: 'gA==' },
})

describe('labeled copy (lib/labeled-copy.ts)', () => {
  it('[web/capture] Labeled copy drawn at the bed: Urine bag copy', () => {
    const plan = drawPlan(
      { width: 1000, height: 1000 },
      { kind: 'photo', evidence: { reading: reading(), segmentation: seg }, drink: null },
    )
    assert.ok(plan)
    // The photo's own pixel size, and the same labels as the live overlay.
    assert.equal(plan.width, 1000)
    assert.equal(plan.height, 1000)
    assert.deepEqual(planTexts(plan), ['Urine bag', 'Liquid · 46% full ≈ 930 mL'])
    assert.deepEqual(
      plan.layers.map((l) => [l.kind, l.tint]),
      [
        ['container', PAINT.bg],
        ['liquid', PAINT.output],
      ],
    )
    // Contours in source pixels, inside the boxes: the 2×2 container mask over 100..400 × 80..900.
    for (const [x, y] of plan.layers[0]!.polys.flat()) assert.ok(x >= 100 && x <= 400 && y >= 80 && y <= 900, `${x},${y} in the box`)
    assert.deepEqual(plan.surface, { x1: 100, x2: 400, y: 520 })
    // The veil is the whole photo minus the container.
    assert.deepEqual(plan.veil![0], [
      [0, 0],
      [1000, 0],
      [1000, 1000],
      [0, 1000],
    ])
    assert.equal(plan.veil!.length, 1 + plan.layers[0]!.polys.length)
    // Labels anchored at their box corners in pixels, text 3.6% of the shorter side (36 px).
    assert.equal(plan.font, 36)
    assert.deepEqual(
      plan.labels.map((l) => [l.key, l.x, l.y]),
      [
        ['container', 100 + plan.inset, 80 + plan.inset],
        ['liquid', 110 + plan.inset, 520 + plan.inset * 2],
      ],
    )
  })

  it('names the liquid by the entry drink, and keeps text legible on a small photo', () => {
    const plan = drawPlan(
      { width: 480, height: 360 },
      {
        kind: 'photo',
        evidence: { reading: reading({ container: 'cup' }), segmentation: { ...seg, fluid_volume_ml: 120, fill_fraction: 0.6 } },
        drink: 'tea',
      },
    )
    assert.deepEqual(planTexts(plan!), ['Cup', 'Tea · 60% full ≈ 120 mL'])
    assert.equal(plan!.layers[1]!.tint, PAINT.intake)
    assert.equal(copyMetrics(480, 360).font, 14)
  })

  it('[web/capture] Labeled copy drawn at the bed: Tray copy', () => {
    const plan = drawPlan(
      { width: 1200, height: 900 },
      {
        kind: 'tray',
        tray: {
          segmentation: { regions: [region(1, 100), region(2, 700)], loose_food: null },
          dishes: [{ index: 1, name: 'rice', dish_kind: 'rice', portion: 50 }],
          fluids: [{ index: 2, name: 'tea', fluid_kind: 'tea', volume_ml: 150 }],
        },
      },
    )
    assert.ok(plan)
    assert.deepEqual(planTexts(plan), ['1 rice · Half', '2 tea · 150 mL'])
    assert.equal(plan.veil, null)
    assert.deepEqual(
      plan.layers.map((l) => [l.kind, l.tint]),
      [
        ['dish', PAINT.dish],
        ['food', PAINT.food],
        ['drink', PAINT.drink],
      ],
    )
  })

  it('[web/capture] Labeled copy drawn at the bed: No read, no copy', () => {
    // Spark-only reads and trays without regions draw nothing, so no copy is made.
    const spark = { kind: 'photo', evidence: { reading: reading(), segmentation: null }, drink: null } as const
    assert.equal(drawPlan({ width: 1000, height: 1000 }, spark), null)
    assert.equal(wantsCopy(spark), false)
    assert.equal(wantsCopy({ kind: 'tray', tray: { segmentation: { regions: [], loose_food: null }, dishes: [], fluids: [] } }), false)
    assert.equal(wantsCopy(undefined), false)
  })

  it('rounds a traced stair-step outline without leaving its bounds, and keeps boxes square', () => {
    const box: Poly = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]
    assert.deepEqual(smoothPoly(box), box)
    // A staircase: every corner moves, none leaves 0..40.
    const stairs: Poly = [
      [0, 0],
      [10, 0],
      [10, 10],
      [20, 10],
      [20, 20],
      [30, 20],
      [30, 30],
      [40, 30],
      [40, 40],
      [0, 40],
    ]
    const out = smoothPoly(stairs, 10)
    assert.ok(out.length > stairs.length, 'resampled evenly')
    assert.ok(out.every(([x, y]) => x >= 0 && x <= 40 && y >= 0 && y <= 40))
    assert.ok(!out.some(([x, y]) => x === 10 && y === 10), 'the step corner is rounded')
  })

  it('maps percent paths to pixel polygons', () => {
    assert.deepEqual(percentPolys('M10 8L40 8L40 90Z', 1000, 500), [
      [
        [100, 40],
        [400, 40],
        [400, 450],
      ],
    ])
  })

  it('paints with the design tokens', () => {
    const src = readFileSync(new URL('../tokens.stylex.ts', import.meta.url), 'utf8')
    for (const k of ['fg', 'bg', 'intake', 'output'] as const)
      assert.match(src, new RegExp(`^\\s*${k}: '${PAINT[k]}'`, 'm'), `${k} is the token value`)
  })
})
