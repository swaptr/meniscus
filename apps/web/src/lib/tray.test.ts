import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Meal, MealEvidence, TrayRegion } from '@meniscus/shared'
import { RAVI } from './audit-fixtures.ts'
import { aiReadLines } from './meals.ts'
import { overlayView } from './overlay.ts'
import { photoShown } from './photo-view.ts'
import { decodeBits, fingerprint, fingerprintLine, proofMedia, proofView } from './tray.ts'

const SHA = '3f2a9b0c4d1e7f8a6b5c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3fc9'
/** 3 Nov 2026 at hh:mm local time, as ISO. */
const at = (h: number, m = 0) => new Date(2026, 10, 3, h, m).toISOString()

const region = (index: number, box: TrayRegion['box'], bits = 'gA=='): TrayRegion => ({
  index,
  box,
  coverage: 0.5,
  mask: { width: 2, height: 1, bits },
  food: { width: 2, height: 1, bits: 'AA==' },
})
const RICE_REGION = region(1, { left: 100, top: 80, right: 400, bottom: 480 })
const CUP_REGION = region(2, { left: 500, top: 100, right: 600, bottom: 200 })
const BARE_REGION = region(3, { left: 700, top: 500, right: 900, bottom: 700 })

function lunch(over: Partial<Meal> = {}): Meal {
  const evidence: MealEvidence = {
    mode: 'sam+spark',
    image_sha256: SHA,
    reading: {
      items: [
        { name: 'rice', portion: 50 },
        { name: 'dal', portion: 100 },
      ],
      dishes: [
        {
          index: 1,
          name: 'rice',
          dish_kind: 'rice',
          portion: 50,
          basis: 'model',
          box: RICE_REGION.box,
          coverage: 0.5,
          model_portion: 50,
          measure: null,
        },
        {
          index: 2,
          name: 'dal',
          dish_kind: 'dal_lentils',
          portion: 100,
          basis: 'model',
          box: CUP_REGION.box,
          coverage: 0.5,
          model_portion: 100,
          measure: null,
        },
      ],
      portion: 75,
      fluids: [],
      confidence: 0.82,
      issues: [],
      notes: null,
    },
    segmentation: { regions: [RICE_REGION, CUP_REGION], loose_food: 0 },
    warnings: [],
    trace: [
      { step: 'sam:dish', model: 'sam-3.1', ms: 900 },
      { step: 'sam:food', model: 'sam-3.1', ms: 950 },
      { step: 'spark:meal', model: 'muse-spark-1.3', ms: 2140 },
    ],
    comparison: null,
  }
  const saved = [
    { index: 1, name: 'rice', dish_kind: 'rice', portion: 100 },
    { index: 2, name: 'dal', dish_kind: 'dal_lentils', portion: 100 },
  ] as const
  return {
    labeled_media: null,
    id: 12,
    admission_id: 16,
    meal: 'lunch',
    portion: 100,
    items: 'rice, dal',
    fluid_ml: null,
    source: 'photo',
    confidence: 0.82,
    evidence,
    created_at: at(13, 10),
    recorded_at: at(13, 10),
    late: false,
    created_by: RAVI,
    entry_id: null,
    entry_status: null,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    media: { id: 52, kind: 'photo', mime: 'image/jpeg', size: 4, duration_ms: null, created_at: at(13, 9), sha256: SHA, served_meal: null },
    dishes: [...saved],
    proof: {
      photo: { media_id: 52, sha256: SHA, captured_by: RAVI, captured_at: at(13, 9) },
      confirmed: { portion: 100, items: 'rice, dal', fluid_ml: null, dishes: [...saved] },
      confirmed_by: RAVI,
      confirmed_at: at(13, 10),
      served: null,
    },
    served_media: null,
    amendments: [],
    amended_at: null,
    ...over,
  }
}

const numbers = (d: string) => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]))
const inside = (d: string, x: [number, number], y: [number, number]) => {
  const n = numbers(d)
  const xs = n.filter((_, i) => i % 2 === 0)
  const ys = n.filter((_, i) => i % 2 === 1)
  return Math.min(...xs) >= x[0] && Math.max(...xs) <= x[1] && Math.min(...ys) >= y[0] && Math.max(...ys) <= y[1]
}
const IMG = { width: 1000, height: 800 }

describe('tray overlay', () => {
  it('[web/ward] Tray overlay: Rice on a 1000 × 800 photo', () => {
    const o = overlayView({
      seg: null,
      image: IMG,
      tray: {
        segmentation: { regions: [RICE_REGION], loose_food: 0 },
        dishes: [{ index: 1, name: 'rice', dish_kind: 'rice', portion: 50 }],
        fluids: [],
      },
      on: true,
    })
    const dish = o.layers.filter((l) => l.kind === 'dish')
    assert.equal(dish.length, 1)
    assert.equal((dish[0]!.d.match(/M/g) ?? []).length, 1, 'one closed contour')
    assert.ok(dish[0]!.d.endsWith('Z'))
    assert.ok(inside(dish[0]!.d, [10, 25], [10, 60]), 'inside left 10–25% and top 10–60%')
    assert.deepEqual(
      o.labels.map((l) => [l.left, l.top, l.lines]),
      [[10, 10, ['1 rice · Half']]],
    )
  })

  it('[web/ward] Tray overlay: A cup and a region nothing names', () => {
    const o = overlayView({
      seg: null,
      image: IMG,
      tray: {
        segmentation: { regions: [RICE_REGION, CUP_REGION, BARE_REGION], loose_food: null },
        dishes: [{ index: 1, name: 'rice', dish_kind: 'rice', portion: 50 }],
        fluids: [{ index: 2, name: 'tea', fluid_kind: 'tea', volume_ml: 150 }],
      },
      on: true,
    })
    assert.deepEqual(
      o.labels.map((l) => [l.key, l.lines]),
      [
        ['r1', ['1 rice · Half']],
        ['r2', ['2 tea · 150 mL']],
      ],
    )
    // Region 3 is still drawn, with no label; the cup is drawn as a drink.
    assert.deepEqual(
      o.layers.map((l) => [l.key, l.kind]),
      [
        ['r1', 'dish'],
        ['r2', 'drink'],
        ['r3', 'dish'],
      ],
    )
  })

  it('[web/ward] Tray overlay: Outline off', () => {
    const tray = { segmentation: { regions: [RICE_REGION], loose_food: 0 }, dishes: [], fluids: [] }
    const o = overlayView({ seg: null, image: IMG, tray, on: false })
    assert.deepEqual([o.layers, o.labels], [[], []])
  })

  it('decodes the packed bits with its own base64, and traces food inside its dish', () => {
    assert.deepEqual([...decodeBits({ width: 2, height: 1, bits: 'gA==' })], [1, 0])
    const r = region(1, { left: 0, top: 0, right: 400, bottom: 200 })
    const fed = { ...r, mask: { width: 2, height: 1, bits: 'wA==' }, food: { width: 2, height: 1, bits: 'gA==' } }
    const o = overlayView({
      seg: null,
      image: { width: 400, height: 200 },
      tray: { segmentation: { regions: [fed], loose_food: 0 }, dishes: [], fluids: [] },
      on: true,
    })
    assert.deepEqual(
      o.layers.map((l) => l.kind),
      ['dish', 'food'],
    )
    assert.ok(inside(o.layers[1]!.d, [0, 50], [0, 100]))
  })
})

describe('media fingerprint', () => {
  it('[web/ward] Media fingerprint shown: Photo entry', () => {
    assert.equal(fingerprint(SHA), '3f2a…c9')
    assert.deepEqual(fingerprintLine('photo', SHA), { text: 'Photo fingerprint: 3f2a…c9', title: SHA })
    assert.deepEqual(fingerprintLine('voice', SHA), { text: 'Recording fingerprint: 3f2a…c9', title: SHA })
    // A tray proof's line comes from the proof already loaded; the only id the view fetches is its photo's.
    const v = proofView(lunch())!
    assert.deepEqual(v.photo.fingerprint, { text: 'Photo fingerprint: 3f2a…c9', title: SHA })
    assert.equal(v.photo.media_id, 52)
  })

  it('[web/ward] Media fingerprint shown: Older recording', () => {
    assert.equal(fingerprint(null), null)
    assert.deepEqual(fingerprintLine('voice', null), { text: 'Fingerprint not recorded', title: undefined })
  })
})

describe('tray proof', () => {
  it('[web/ward] Tray proof on the bed review: Lunch proof', () => {
    const v = proofView(lunch())!
    // `photo.media_id` is the one id the view fetches, and it asks no model. Browser check 10.1 confirmed the single
    // `GET /api/media/<id>` per opened meal and no `/api/ai` request.
    assert.deepEqual(v.photo, {
      media_id: 52,
      line: 'Tray photo · 13:09 · Ravi K.',
      fingerprint: { text: 'Photo fingerprint: 3f2a…c9', title: SHA },
      labeled: null,
    })
    assert.deepEqual(
      v.rows.map((r) => r.text),
      ['1 rice · Rice · AI Half · saved All', '2 dal · Dal / lentils · AI All · saved All'],
    )
    assert.deepEqual(
      v.rows.map((r) => r.changed),
      [true, false],
    )
    assert.equal(v.saved, 'Saved by Ravi K. · 13:10')
    assert.deepEqual(v.tray?.dishes, lunch().dishes)
  })

  it('[web/ward] Tray proof on the bed review: Voided lunch', () => {
    const v = proofView(lunch({ media: null, voided_at: at(14), void_reason: 'wrong bed' }))!
    // No id: the view shows the line in place of the photo and fetches nothing.
    assert.equal(v.photo.media_id, null)
    assert.equal(v.photo.fingerprint, null)
    assert.equal(v.photo.line, 'Photo deleted · fingerprint 3f2a…c9')
  })

  it('shows no proof for a meal without one', () => {
    assert.equal(proofView(lunch({ proof: null })), null)
  })

  it('[web/ward] Raw and labeled views of a kept photo: Tray proof', () => {
    // Opened, the proof shows Labeled first: the tray's copy 43 is its one request.
    const copy = {
      id: 43,
      kind: 'photo' as const,
      mime: 'image/jpeg',
      size: 4,
      duration_ms: null,
      created_at: at(13, 9),
      sha256: SHA,
      served_meal: null,
    }
    const v = proofView(lunch({ labeled_media: copy }))!
    assert.equal(v.photo.labeled?.id, 43)
    assert.deepEqual(proofMedia(v), [43])
    assert.equal(photoShown({ media_id: v.photo.media_id!, labeled: v.photo.labeled, segmented: true, mode: 'labeled' }).media_id, 43)
    // A voided meal's photo and copy are gone: nothing is fetched.
    assert.deepEqual(proofMedia(proofView(lunch({ media: null, labeled_media: null }))!), [])
  })

  it('a proof without a served photo has no pair', () => {
    const v = proofView(lunch())!
    assert.equal(v.served, null)
    assert.equal(v.stat, null)
    assert.deepEqual(proofMedia(v), [52])
  })
})

const SERVED_SHA = '9b1c4d2e7f8a6b5c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a10e2'
const SERVED_RICE = { ...region(1, { left: 110, top: 90, right: 410, bottom: 490 }), coverage: 0.8 }
/** Tray photo 42 at 13:30 and served photo 41 at 12:40, both by Ravi Kumar; rice measured Half (AI a quarter), dal All. */
function comparedLunch(over: Partial<Meal> = {}): Meal {
  const base = lunch()
  const rice = { ...base.evidence!.reading.dishes[0]!, portion: 50 as const, model_portion: 25 as const, coverage: 0.4 }
  const measuredRice = { ...rice, basis: 'measured' as const, measure: { served_index: 1, served_coverage: 0.8 } }
  const dal = base.evidence!.reading.dishes[1]!
  const saved = [
    { index: 1, name: 'rice', dish_kind: 'rice', portion: 50 },
    { index: 2, name: 'dal', dish_kind: 'dal_lentils', portion: 100 },
  ] as const
  return lunch({
    media: { ...base.media!, id: 42, created_at: at(13, 30) },
    served_media: { ...base.media!, id: 41, created_at: at(12, 40), sha256: SERVED_SHA, served_meal: 'lunch' },
    evidence: {
      ...base.evidence!,
      reading: { ...base.evidence!.reading, dishes: [measuredRice, dal] },
      comparison: {
        served_media_id: 41,
        served_sha256: SERVED_SHA,
        served_at: at(12, 40),
        size: { width: 1000, height: 800 },
        served_size: { width: 1000, height: 800 },
        served: { regions: [SERVED_RICE], loose_food: 0 },
        matches: [{ index: 1, served_index: 1, distance2: 125 }],
      },
      trace: [
        ...base.evidence!.trace.slice(0, 2),
        { step: 'sam:served-dish', model: 'sam-3.1', ms: 900 },
        { step: 'sam:served-food', model: 'sam-3.1', ms: 950 },
        base.evidence!.trace[2]!,
      ],
    },
    dishes: [...saved],
    proof: {
      photo: { media_id: 42, sha256: SHA, captured_by: RAVI, captured_at: at(13, 30) },
      served: { media_id: 41, sha256: SERVED_SHA, captured_by: RAVI, captured_at: at(12, 40) },
      confirmed: { portion: 75, items: 'rice, dal', fluid_ml: null, dishes: [...saved] },
      confirmed_by: RAVI,
      confirmed_at: at(13, 31),
    },
    ...over,
  })
}

describe('served tray in the proof', () => {
  it('[web/ward] Served tray in the proof: Compared lunch', () => {
    const v = proofView(comparedLunch())!
    assert.deepEqual(v.served, {
      media_id: 41,
      line: 'Served tray · 12:40 · Ravi K.',
      fingerprint: { text: 'Photo fingerprint: 9b1c…e2', title: SERVED_SHA },
      labeled: null,
    })
    assert.equal(v.stat, '1 rice · 80% served · 40% left · Half eaten')
    assert.equal(v.photo.line, 'Tray photo · 13:30 · Ravi K.')
    assert.deepEqual(
      v.rows.map((r) => r.text),
      ['1 rice · Rice · measured Half · AI A quarter · saved Half', '2 dal · Dal / lentils · AI All · saved All'],
    )
    // The served overlay: its regions, labelled from the dishes matched to them.
    assert.deepEqual(v.servedTray?.segmentation, { regions: [SERVED_RICE], loose_food: 0 })
    assert.deepEqual(
      v.servedTray?.dishes.map((d) => [d.index, d.name]),
      [[1, 'rice']],
    )
    // Exactly two fetches when opened, the tray photo then the served photo; no model request.
    assert.deepEqual(proofMedia(v), [42, 41])
    assert.deepEqual(aiReadLines(comparedLunch())!.steps, [
      'SAM 3.1 · dish outlines · 0.9 s',
      'SAM 3.1 · food areas · 0.9 s',
      'SAM 3.1 · served dish outlines · 0.9 s',
      'SAM 3.1 · served food areas · 0.9 s',
      'Muse Spark · tray · 2.1 s',
    ])
  })

  it('[web/ward] Served tray in the proof: Voided compared lunch', () => {
    const v = proofView(comparedLunch({ media: null, served_media: null, voided_at: at(14), void_reason: 'wrong bed' }))!
    assert.deepEqual(v.served, { media_id: null, line: 'Served tray deleted · fingerprint 9b1c…e2', fingerprint: null, labeled: null })
    assert.deepEqual(proofMedia(v), [])
  })

  it('says when no dish was measured', () => {
    const m = comparedLunch()
    const dishes = m.evidence!.reading.dishes.map((d) => ({ ...d, basis: 'model' as const, measure: null }))
    const v = proofView({ ...m, evidence: { ...m.evidence!, reading: { ...m.evidence!.reading, dishes } } })!
    assert.equal(v.stat, 'No dish measured')
  })
})
