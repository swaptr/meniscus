import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MealFluid, Segmentation, TrayRegion } from '@meniscus/shared'
import { overlayAlt, overlayView, trayRegionLines } from './overlay.ts'

const IMG = { width: 1000, height: 1000 }
const seg = (over: Partial<Segmentation> = {}): Segmentation => ({
  container: { left: 100, top: 80, right: 400, bottom: 900 },
  fluid: { left: 110, top: 520, right: 390, bottom: 890 },
  fill_fraction: 0.46,
  ...over,
})
const labels = (v: ReturnType<typeof overlayView>) => v.labels.map((l) => l.lines.join(' / '))
const kinds = (v: ReturnType<typeof overlayView>) => v.layers.map((l) => l.kind)

describe('segmentation overlay (lib/overlay.ts)', () => {
  it('[web/ward] Segmentation overlay: Boxes on a 1000 × 1000 photo', () => {
    const v = overlayView({ seg: seg(), image: IMG, container: 'urine_bag', on: true })
    assert.equal(v.mode, 'box')
    assert.deepEqual(kinds(v), ['container', 'liquid'])
    assert.equal(v.layers[0]!.d, 'M10 8L40 8L40 90L10 90Z')
    assert.equal(v.layers[1]!.d, 'M11 52L39 52L39 89L11 89Z')
    assert.deepEqual(v.surface, { x1: 10, x2: 40, y: 52 })
    assert.ok(v.dim?.startsWith('M0 0L100 0L100 100L0 100Z'), 'dims outside the container')
  })

  it('draws contours from the masks when the evidence has them', () => {
    const v = overlayView({
      seg: seg({ container_mask: { width: 2, height: 2, bits: 'gA==' }, fluid_mask: { width: 1, height: 1, bits: 'gA==' } }),
      image: IMG,
      container: 'urine_bag',
      on: true,
    })
    assert.equal(v.mode, 'contour')
    assert.ok(!v.layers[0]!.d.includes('L40 8'), 'no container box')
    assert.equal(v.layerTone, 'out')
  })

  it('[web/ward] Segmentation overlay: Labels', () => {
    const v = overlayView({ seg: seg({ fill_fraction: 0.28 }), image: IMG, container: 'urine_bag', on: true })
    assert.deepEqual(labels(v), ['Urine bag', 'Liquid · 28% full'])
  })

  it('[web/ward] Segmentation overlay: Drink labelled', () => {
    const cup = seg({ fill_fraction: 0.6, fluid_volume_ml: 120 })
    assert.deepEqual(labels(overlayView({ seg: cup, image: IMG, container: 'cup', drink: 'tea', on: true })), [
      'Cup',
      'Tea · 60% full ≈ 120 mL',
    ])
    assert.deepEqual(labels(overlayView({ seg: cup, image: IMG, container: 'cup', drink: null, on: true })), [
      'Cup',
      'Liquid · 60% full ≈ 120 mL',
    ])
    assert.equal(overlayView({ seg: cup, image: IMG, container: 'cup', on: true }).layerTone, 'in')
  })

  it('[web/ward] Region quantities on the labeled photo: Urine bag with a volume', () => {
    const v = overlayView({ seg: seg({ fill_fraction: 0.463, fluid_volume_ml: 930 }), image: IMG, container: 'urine_bag', on: true })
    assert.deepEqual(labels(v), ['Urine bag', 'Liquid · 46% full ≈ 930 mL'])
    assert.equal(
      overlayAlt(seg({ fill_fraction: 0.463, fluid_volume_ml: 930 }), 'urine_bag', null),
      'Photo of the urine bag. SAM 3.1 outlined the urine bag and the liquid, 46% full, about 930 mL.',
    )
  })

  it('[web/ward] Region quantities on the labeled photo: No capacity', () => {
    const v = overlayView({ seg: seg({ fill_fraction: 0.46, fluid_volume_ml: null }), image: IMG, container: 'urine_bag', on: true })
    assert.deepEqual(labels(v), ['Urine bag', 'Liquid · 46% full'])
    assert.equal(
      overlayAlt(seg({ fill_fraction: 0.46 }), 'urine_bag', null),
      'Photo of the urine bag. SAM 3.1 outlined the urine bag and the liquid, 46% full.',
    )
  })

  it('[web/ward] Region quantities on the labeled photo: Spark-only read', () => {
    const v = overlayView({ seg: null, image: IMG, container: 'urine_bag', on: true })
    assert.deepEqual(v, { mode: 'none', dim: null, layers: [], surface: null, labels: [], layerTone: 'out' })
    assert.equal(overlayAlt(null, 'urine_bag', null), 'Photo of the urine bag.')
  })

  it('hides everything while the outline is off', () => {
    assert.equal(overlayView({ seg: seg(), image: IMG, container: 'cup', on: false }).mode, 'none')
  })

  it('[web/ward] Tray overlay: Drink kind on a region', () => {
    const region: TrayRegion = {
      index: 4,
      box: { left: 0, top: 0, right: 100, bottom: 100 },
      coverage: 0.4,
      mask: { width: 1, height: 1, bits: 'gA==' },
      food: { width: 1, height: 1, bits: 'AA==' },
    }
    const chaas: MealFluid = { index: 4, name: 'chaas', fluid_kind: 'buttermilk', volume_ml: 200 }
    const soup: MealFluid = { index: 4, name: 'Soup', fluid_kind: 'soup', volume_ml: 150 }
    assert.deepEqual(trayRegionLines(region, { dishes: [], fluids: [chaas] }), ['4 chaas · Buttermilk · 200 mL'])
    assert.deepEqual(trayRegionLines(region, { dishes: [], fluids: [soup] }), ['4 Soup · 150 mL'])
  })
})
