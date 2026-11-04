import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DishValue, Meal, MealAmendment, StaffRef, TrayRegion } from '@meniscus/shared'
import { createApi } from './api.ts'
import { dishRows, dishTray, trayMediaId, trayPhotos } from './dishes.ts'
import { trayLabels } from './tray.ts'

const at = (h: number, m = 0) => new Date(2026, 10, 3, h, m).toISOString()
const ANITA: StaffRef = { id: 4, name: 'Anita Thomas', role: 'nurse' }
const dish = (index: number, name: string, dish_kind: DishValue['dish_kind'], portion: DishValue['portion']): DishValue => ({
  index,
  name,
  dish_kind,
  portion,
})

const meal = (over: Partial<Meal> = {}): Meal => ({
  labeled_media: null,
  id: 1,
  admission_id: 11,
  meal: 'lunch',
  portion: 75,
  items: 'rice, dal',
  fluid_ml: null,
  source: 'photo',
  confidence: 0.82,
  evidence: null,
  created_at: at(13, 10),
  recorded_at: at(13, 10),
  late: false,
  created_by: null,
  entry_id: null,
  entry_status: null,
  voided_at: null,
  voided_by: null,
  void_reason: null,
  media: {
    id: 31,
    kind: 'photo',
    mime: 'image/png',
    size: 100,
    duration_ms: null,
    created_at: at(13, 10),
    sha256: null,
    served_meal: null,
  },
  dishes: [],
  proof: null,
  served_media: null,
  amendments: [],
  amended_at: null,
  ...over,
})
const amend = (before: DishValue[], after: DishValue[], time = at(14, 10)): MealAmendment => ({
  id: 1,
  at: time,
  by: ANITA,
  reason: 'dish corrected',
  before: { portion: 75, items: null, dishes: before },
  after: { portion: 75, items: null, dishes: after },
})
const region = (index: number, box: TrayRegion['box']): TrayRegion => ({
  index,
  box,
  coverage: 0.5,
  mask: { width: 1, height: 1, bits: 'gA==' },
  food: { width: 1, height: 1, bits: 'gA==' },
})
const LUNCH = [dish(1, 'rice', 'rice', 100), dish(2, 'dal', 'dal_lentils', 50)]

describe('dishes in the Nutrition section', () => {
  it('[web/ward] Dishes in the Nutrition section: Lunch dishes', () => {
    assert.deepEqual(
      dishRows(meal({ dishes: LUNCH })).map((r) => [r.text, r.kind, r.mark]),
      [
        ['rice · All', 'Rice', null],
        ['dal · Half', 'Dal / lentils', null],
      ],
    )
    assert.deepEqual(dishRows(meal({ meal: 'breakfast', source: 'manual', media: null, dishes: [] })), [])
  })

  it('[web/ward] Dishes in the Nutrition section: Amended dishes', () => {
    const before = [
      dish(1, 'rice', 'rice', 100),
      dish(2, 'dal', 'dal_lentils', 100),
      dish(3, 'papad', 'snack', 50),
      dish(4, 'roti', 'bread', 75),
    ]
    const after = [
      dish(1, 'jeera rice', 'rice', 100),
      dish(2, 'dal', 'dal_lentils', 50),
      dish(4, 'roti', 'bread', 75),
      dish(0, 'curd', 'dairy', 100),
    ]
    const rows = dishRows(meal({ dishes: after, amendments: [amend(before, after)] }))
    assert.deepEqual(
      rows.map((r) => [r.text, r.mark, r.removed]),
      [
        ['jeera rice · All', 'Amended 14:10 by Anita T. · was rice', false],
        ['dal · Half', 'Amended 14:10 by Anita T. · was All', false],
        ['roti · Three quarters', null, false],
        ['curd · All', 'Added 14:10 by Anita T.', false],
        ['papad · Half', 'Removed 14:10 by Anita T.', true],
      ],
    )
  })

  it('[web/ward] Dishes in the Nutrition section: Two dishes in one region', () => {
    const before = [dish(1, 'rice', 'rice', 50), dish(1, 'dal', 'dal_lentils', 50)]
    const after = [dish(1, 'rice', 'rice', 50), dish(1, 'sambar', 'dal_lentils', 50)]
    assert.deepEqual(
      dishRows(meal({ dishes: after, amendments: [amend(before, after)] })).map((r) => [r.text, r.mark, r.removed]),
      [
        ['rice · Half', null, false],
        ['sambar · Half', 'Amended 14:10 by Anita T. · was dal', false],
      ],
    )
  })

  it('[web/ward] Dishes in the Nutrition section: Show tray', async () => {
    const calls: string[] = []
    const api = createApi(
      (url, init) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`)
        return Promise.resolve(new Response(new Blob([new Uint8Array([1])], { type: 'image/png' })))
      },
      () => 11,
    )
    const m = meal({
      dishes: LUNCH,
      evidence: {
        mode: 'sam+spark',
        image_sha256: 'a'.repeat(64),
        reading: { items: [], dishes: [], portion: 75, fluids: [], confidence: 0.82, issues: [], notes: null },
        segmentation: {
          regions: [region(1, { left: 0, top: 0, right: 50, bottom: 50 }), region(2, { left: 50, top: 0, right: 100, bottom: 50 })],
          loose_food: 0,
        },
        comparison: null,
        warnings: [],
        trace: [],
      },
    })
    const id = trayMediaId(m)
    assert.equal(id, 31)
    const photos = trayPhotos(api)
    await photos.get(id) // shown
    await photos.get(id) // hidden, then shown again
    assert.deepEqual(calls, ['GET /api/media/31'])
    assert.ok(!calls.some((c) => c.includes('/api/ai')))
    assert.deepEqual(
      trayLabels(dishTray(m)!, 100, 100).map((l) => l.lines),
      [['1 rice · All'], ['2 dal · Half']],
    )
  })

  it('[web/ward] Dishes in the Nutrition section: No photo kept', () => {
    const voided = meal({ dishes: LUNCH, voided_at: at(14), media: null })
    const byHand = meal({ meal: 'breakfast', source: 'manual', media: null })
    assert.equal(trayMediaId(voided), null)
    assert.equal(trayMediaId(byHand), null)
  })
})
