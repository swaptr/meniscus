import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { READ_OUTCOMES, type KindRow, type ModelQuality, type Rate, type ReadOutcome } from '@meniscus/shared'
import { createApi } from './api.ts'
import {
  CLASS_PICKS,
  KIND_LABEL,
  MODEL_VIEW_DEFAULT,
  NO_READS_TEXT,
  classRows,
  correctionsText,
  dataQualityLoad,
  emptyText,
  hasReads,
  hospitalModelLoad,
  hospitalView,
  kindRows,
  mealFluidText,
  negativesText,
  portionText,
  positivesText,
  rateText,
  typeRows,
  volumeText,
} from './model-accuracy.ts'

const rate = (n: number, of: number, pct: number | null = of >= 5 ? Math.floor((100 * n) / of) : null): Rate => ({ n, of, pct })
const outcomes = (over: Partial<Record<ReadOutcome, number>> = {}) =>
  Object.fromEntries(READ_OUTCOMES.map((o) => [o, over[o] ?? 0])) as Record<ReadOutcome, number>
const noVolume = { of: 0, mae_ml: null, within: rate(0, 0), no_volume: 0 }
const kind = (k: KindRow['kind'], mode: KindRow['mode'], over: Partial<KindRow> = {}): KindRow => ({
  kind: k,
  mode,
  drafts: 0,
  outcomes: outcomes(),
  accepted: rate(0, 0),
  corrected: rate(0, 0),
  rejected: rate(0, 0),
  edited_at_capture: rate(0, 0),
  corrected_by_nurse: rate(0, 0),
  volume: noVolume,
  ...over,
})
const noPortion = {
  of: 0,
  exact: rate(0, 0),
  within_quarter: rate(0, 0),
  quarters_off: [0, 0, 0, 0, 0] as [number, number, number, number, number],
}
const sixKinds = (over: Partial<Record<string, KindRow>> = {}) => [
  over['photo:sam+spark'] ?? kind('photo', 'sam+spark'),
  over['photo:spark'] ?? kind('photo', 'spark'),
  over.text ?? kind('text', null),
  over.voice ?? kind('voice', null),
  over['tray:sam+spark'] ?? kind('tray', 'sam+spark'),
  over['tray:spark'] ?? kind('tray', 'spark'),
]
const summary = (over: Partial<ModelQuality> = {}): ModelQuality => ({
  ward: { id: 2, code: '3A', name: 'Medical Ward 3A', specialty: 'General medicine', capacity: 8, default_acuity: 'stable' },
  since: new Date(2026, 9, 27, 9).toISOString(),
  days: 7,
  min_n: 5,
  tolerance_ml: 25,
  kinds: sixKinds(),
  classes: { type: [], urine_colour: [], dish_kind: [] },
  drink_kind: [],
  volume: noVolume,
  containers: [],
  dish_portion: noPortion,
  meal_portion: noPortion,
  meal_fluid: { volume: noVolume, removed: 0 },
  positives: { kept: rate(0, 0), not_kept: rate(0, 0), rejected: 0, abandoned: 0, retaken: 0 },
  top_corrections: [],
  negatives: { confirmed: rate(0, 0), overridden: rate(0, 0), overridden_as: [], nothing_drafted: 0 },
  ...over,
})

describe('model accuracy rates', () => {
  it('[web/ward] Rates shown with their counts: Withheld below the minimum', () => {
    const small: Rate = { n: 4, of: 4, pct: null }
    const big: Rate = { n: 23, of: 25, pct: 92 }
    assert.equal(rateText(small), '— · 4/4')
    assert.equal(rateText(big), '92% · 23/25')
  })
})

describe('model accuracy view', () => {
  it('[web/ward] Model accuracy view: Two requests', async () => {
    const calls: string[] = []
    const api = createApi(
      (url, init) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`)
        return Promise.resolve(Response.json(url.startsWith('/api/quality/model') ? summary() : { totals: {} }))
      },
      () => 4,
    )
    const d = await dataQualityLoad(api, 2, new AbortController().signal)
    // Picking Table and each class table builds rows from the one summary: no request.
    kindRows(d.model)
    for (const p of CLASS_PICKS) classRows(p.id, d.model)
    assert.deepEqual(calls.toSorted(), ['GET /api/quality/model?ward=2&days=7', 'GET /api/wards/2/quality'])
    assert.equal(d.model.days, 7)
    assert.ok(d.quality)
    assert.ok(!calls.some((c) => c.includes('/api/ai')))
  })

  it('[web/ward] Model accuracy view: Read kinds', () => {
    const photo = kind('photo', 'sam+spark', {
      drafts: 27,
      outcomes: outcomes({ accepted: 20, edited_at_capture: 2, corrected_by_nurse: 3, rejected: 1, abandoned: 1 }),
      accepted: { n: 20, of: 26, pct: 76 },
      corrected: { n: 5, of: 26, pct: 19 },
      rejected: { n: 1, of: 26, pct: 3 },
      edited_at_capture: { n: 2, of: 26, pct: 7 },
      corrected_by_nurse: { n: 3, of: 26, pct: 11 },
    })
    const t = kindRows(summary({ kinds: sixKinds({ 'photo:sam+spark': photo }) }))
    assert.deepEqual(t.headers, ['Read', 'Decided', 'Accepted', 'Edited at capture', 'Corrected by a nurse', 'Rejected', 'Abandoned'])
    assert.deepEqual(t.rows[0], {
      label: 'Photo (SAM + Spark)',
      cells: ['26', '76% · 20/26', '7% · 2/26', '11% · 3/26', '3% · 1/26', '1'],
    })
    assert.deepEqual(Object.values(KIND_LABEL), [
      'Photo (SAM + Spark)',
      'Photo (Spark only)',
      'Typed note',
      'Voice note',
      'Tray (SAM + Spark)',
      'Tray (Spark only)',
    ])
  })

  it('[web/ward] Model accuracy view: Type table', () => {
    const t = typeRows(
      summary({
        classes: {
          type: [{ model: 'urine', n: 6, kept: { n: 4, of: 5, pct: 80 }, corrections: [{ to: 'stoma', n: 1 }] }],
          urine_colour: [],
          dish_kind: [],
        },
      }),
    )
    assert.deepEqual(t.headers, ['Model read', 'Decided', 'Kept', 'Changed to'])
    assert.deepEqual(t.rows, [{ label: 'Urine', cells: ['6', '80% · 4/5', 'Stoma 1'] }])
  })

  it('[web/ward] Model accuracy view: Volume and negatives', () => {
    assert.equal(
      volumeText({ of: 24, mae_ml: 18, within: { n: 20, of: 24, pct: 83 }, no_volume: 1 }, 25),
      '18 mL mean error · within ±25 mL 83% · 20/24 · 1 with no volume read',
    )
    assert.equal(
      negativesText({ confirmed: rate(2, 3), overridden: rate(1, 3), overridden_as: [{ to: 'water', n: 1 }], nothing_drafted: 1 }),
      'Nothing to chart: 2 confirmed · 1 charted anyway (Drink 1) · 1 read with nothing drafted',
    )
    assert.equal(
      negativesText({ confirmed: rate(1, 1), overridden: rate(0, 1), overridden_as: [], nothing_drafted: 2 }),
      'Nothing to chart: 1 confirmed · 0 charted anyway · 2 reads with nothing drafted',
    )
  })

  it('[web/ward] Model accuracy view: Meal overridden', () => {
    assert.equal(
      negativesText({ confirmed: rate(1, 2), overridden: rate(1, 2), overridden_as: [{ to: 'meal', n: 1 }], nothing_drafted: 0 }),
      'Nothing to chart: 1 confirmed · 1 charted anyway (Meal 1)',
    )
  })

  it('[web/ward] Model accuracy view: Mean error withheld', () => {
    assert.equal(
      volumeText({ of: 4, mae_ml: null, within: { n: 3, of: 4, pct: null }, no_volume: 0 }, 25),
      '— mean error · within ±25 mL — · 3/4',
    )
  })

  it('[web/ward] Model accuracy view: No reads', () => {
    const empty = summary()
    assert.equal(hasReads(empty), false)
    assert.equal(NO_READS_TEXT, 'No AI reads in the last 7 days')
    // No chart, table, picker or lines: the section renders only the sentence when hasReads is false.
    const one = summary({ kinds: sixKinds({ text: kind('text', null, { drafts: 1 }) }) })
    assert.equal(hasReads(one), true)
    assert.equal(hasReads(summary({ kinds: sixKinds({ 'tray:spark': kind('tray', 'spark', { drafts: 1 }) }) })), true)
  })
})

const trayRow = kind('tray', 'sam+spark', {
  drafts: 12,
  outcomes: outcomes({ accepted: 8, edited_at_capture: 1, corrected_by_nurse: 2, rejected: 1 }),
  accepted: { n: 8, of: 12, pct: 66 },
  corrected: { n: 3, of: 12, pct: 25 },
  rejected: { n: 1, of: 12, pct: 8 },
  edited_at_capture: { n: 1, of: 12, pct: 8 },
  corrected_by_nurse: { n: 2, of: 12, pct: 16 },
})
const withTrays = (over: Partial<ModelQuality> = {}) => summary({ kinds: sixKinds({ 'tray:sam+spark': trayRow }), ...over })
const row = (label: string, cells: string[]) => ({ label, cells })

describe('chart or table', () => {
  it('[web/ward] Chart or table: Tray row', () => {
    const t = kindRows(withTrays())
    assert.deepEqual(
      t.rows.find((r) => r.label === 'Tray (SAM + Spark)'),
      row('Tray (SAM + Spark)', ['12', '66% · 8/12', '8% · 1/12', '16% · 2/12', '8% · 1/12', '0']),
    )
    assert.equal(t.headers.length, 7)
    assert.ok(!t.rows.some((r) => r.label === 'Photo (Spark only)'))
    assert.deepEqual(
      t.rows.map((r) => r.label),
      ['Tray (SAM + Spark)'],
    )
  })

  it('[web/ward] Chart or table: Chart first', () => {
    assert.equal(MODEL_VIEW_DEFAULT, 'chart')
  })
})

describe('class table picker', () => {
  it('[web/ward] Class table picker: Dish table', () => {
    const q = withTrays({
      classes: {
        type: [],
        urine_colour: [],
        dish_kind: [
          { model: 'rice', n: 6, kept: { n: 4, of: 5, pct: 80 }, corrections: [{ to: 'bread', n: 1 }] },
          { model: 'fruit', n: 2, kept: rate(1, 2), corrections: [{ to: 'none', n: 1 }] },
          { model: 'none', n: 1, kept: rate(0, 1), corrections: [{ to: 'dairy', n: 1 }] },
        ],
      },
    })
    assert.deepEqual(
      CLASS_PICKS.map((p) => p.label),
      ['Drink and fluid', 'Drink kind', 'Urine colour', 'Container', 'Dish', 'Dish portion', 'Meal portion'],
    )
    const t = classRows('dish_kind', q)
    assert.deepEqual(t.headers, ['Model read', 'Decided', 'Kept', 'Changed to'])
    assert.deepEqual(t.rows[0], row('Rice', ['6', '80% · 4/5', 'Bread 1']))
    assert.equal(t.rows[1]!.cells[2], 'Removed 1')
    assert.deepEqual(t.rows[2], row('Not read (added by staff)', ['1', '— · 0/1', 'Dairy 1']))
  })

  it('[web/ward] Class table picker: Portion table', () => {
    const q = withTrays({
      dish_portion: { of: 5, exact: { n: 2, of: 5, pct: 40 }, within_quarter: { n: 3, of: 5, pct: 60 }, quarters_off: [2, 1, 1, 0, 1] },
    })
    const t = classRows('dish_portion', q)
    assert.deepEqual(
      t.rows.map((r) => `${r.label} ${r.cells.join(' ')}`),
      ['Same portion 2', '1 quarter off 1', '2 quarters off 1', '3 quarters off 0', '4 quarters off 1'],
    )
    assert.equal(portionText(q.dish_portion), 'Same 40% · 2/5 · within a quarter 60% · 3/5')
  })

  it('[web/ward] Class table picker: Container table', () => {
    const q = summary({
      containers: [
        {
          container: 'urinal',
          reads: 6,
          decided: 6,
          accepted: { n: 5, of: 6, pct: 83 },
          corrected: { n: 1, of: 6, pct: 16 },
          rejected: { n: 0, of: 6, pct: 0 },
          volume: { of: 6, mae_ml: 9, within: { n: 6, of: 6, pct: 100 }, no_volume: 0 },
        },
      ],
    })
    const t = classRows('containers', q)
    assert.deepEqual(t.headers, ['Container read', 'Reads', 'Decided', 'Accepted', 'Corrected', 'Rejected', 'Within ±25 mL'])
    assert.deepEqual(t.rows, [row('Urinal', ['6', '6', '83% · 5/6', '16% · 1/6', '0% · 0/6', '100% · 6/6'])])
  })

  it('[web/ward] Class table picker: Empty tables', () => {
    const q = summary({ kinds: sixKinds({ 'photo:sam+spark': kind('photo', 'sam+spark', { drafts: 3 }) }) })
    for (const pick of ['dish_kind', 'dish_portion', 'meal_portion', 'urine_colour'] as const) {
      const t = classRows(pick, q)
      assert.ok(t.headers.length > 0)
      assert.deepEqual(t.rows, [])
    }
    assert.deepEqual(
      (['dish_kind', 'dish_portion', 'meal_portion', 'urine_colour'] as const).map((p) => emptyText(p, q)),
      [
        'No tray reads in the last 7 days',
        'No tray reads in the last 7 days',
        'No tray reads in the last 7 days',
        'No urine colour drafts in the last 7 days',
      ],
    )
  })

  it('[web/ward] Class table picker: Tray reads not yet reviewed', () => {
    const open = kind('tray', 'sam+spark', { drafts: 2, outcomes: outcomes({ open: 1, pending: 1 }) })
    const q = summary({ kinds: sixKinds({ 'tray:sam+spark': open }) })
    for (const pick of ['dish_kind', 'dish_portion', 'meal_portion'] as const) {
      assert.deepEqual(classRows(pick, q).rows, [])
      assert.equal(emptyText(pick, q), 'No reviewed tray meals in the last 7 days')
    }
  })
})

describe('kept drafts, meal fluid and top corrections', () => {
  const kept = { kept: { n: 46, of: 50, pct: 92 }, not_kept: { n: 4, of: 50, pct: 8 }, rejected: 3, abandoned: 1 }

  it('[web/ward] Kept drafts, meal fluid and top corrections: Kept drafts', () => {
    assert.equal(positivesText({ ...kept, retaken: 0 }), 'Drafts kept 92% · 46/50 · not kept 8% · 4/50 (3 rejected, 1 abandoned)')
  })

  it('[web/ward] Kept drafts, meal fluid and top corrections: Retaken drafts', () => {
    assert.equal(
      positivesText({ ...kept, retaken: 2 }),
      'Drafts kept 92% · 46/50 · not kept 8% · 4/50 (3 rejected, 1 abandoned, 2 retaken)',
    )
  })

  it('[web/ward] Kept drafts, meal fluid and top corrections: Fluid with meals', () => {
    const q = withTrays({ meal_fluid: { volume: { of: 6, mae_ml: 20, within: { n: 5, of: 6, pct: 83 }, no_volume: 1 }, removed: 1 } })
    assert.equal(mealFluidText(q), 'Fluid with meals: 20 mL mean error · within ±25 mL 83% · 5/6 · 1 added by staff · 1 removed')
    assert.equal(
      mealFluidText(
        withTrays({ meal_fluid: { volume: { of: 6, mae_ml: 20, within: { n: 5, of: 6, pct: 83 }, no_volume: 0 }, removed: 0 } }),
      ),
      'Fluid with meals: 20 mL mean error · within ±25 mL 83% · 5/6',
    )
  })

  it('[web/ward] Kept drafts, meal fluid and top corrections: Most changed', () => {
    const q = summary({
      top_corrections: [
        { table: 'type', from: 'water', to: 'food', n: 3 },
        { table: 'urine_colour', from: 'dark', to: 'red', n: 2 },
        { table: 'dish_kind', from: 'rice', to: 'bread', n: 2 },
        { table: 'type', from: 'urine', to: 'stoma', n: 1 },
        { table: 'urine_colour', from: 'yellow', to: 'dark', n: 1 },
      ],
    })
    assert.equal(
      correctionsText(q),
      'Most changed: Drink → Food 3 · Urine dark → red 2 · Rice → Bread 2 · Urine → Stoma 1 · Urine yellow → dark 1',
    )
  })

  it('[web/ward] Kept drafts, meal fluid and top corrections: Nothing changed', () => {
    const q = summary({ kinds: sixKinds({ text: kind('text', null, { drafts: 2 }) }) })
    assert.equal(correctionsText(q), 'Most changed: none')
    assert.equal(mealFluidText(q), null)
  })
})

describe('hospital model accuracy view', () => {
  const recorder = () => {
    const calls: string[] = []
    const api = createApi(
      (url, init) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`)
        return Promise.resolve(Response.json(summary({ ward: null })))
      },
      () => 4,
    )
    return { calls, api }
  }

  it('[web/ward] Hospital model accuracy view: Open the model view', async () => {
    assert.deepEqual(hospitalView({ view: 'model' }), { view: 'model' })
    const { calls, api } = recorder()
    const q = await hospitalModelLoad(api, new AbortController().signal)
    assert.deepEqual(calls, ['GET /api/quality/model?days=7'])
    assert.equal(q.ward, null)
  })

  it('[web/ward] Hospital model accuracy view: Back to wards', () => {
    const { calls } = recorder()
    assert.deepEqual(hospitalView({}), {})
    assert.deepEqual(calls, [])
  })

  it('[web/ward] Hospital model accuracy view: Unknown view', () => {
    assert.deepEqual(hospitalView({ view: 'x' }), {})
    assert.deepEqual(hospitalView({ view: 7 }), {})
  })
})
