import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CaptureReadResult, Entry, Meal, ModelQuality } from '@meniscus/shared'
import { createApi } from './api.ts'
import { ANITA, at, entry, event } from './audit-fixtures.ts'
import { saveEntry, toEntryInput, type Pending } from './capture.ts'
import { withCategory } from './care.ts'
import { breakdown } from './charts.ts'
import {
  checkTitle,
  drinkLine,
  drinkTitle,
  drinkTotals,
  kindLabel,
  mealFluidLine,
  offersDrinkPicker,
  withDrink,
  DRINK_OPTIONS,
} from './drinks.ts'
import { toEvidence } from './evidence.ts'
import { aiReadFluids } from './meals.ts'
import { CLASS_PICKS, classRows, emptyText } from './model-accuracy.ts'
import { amendBody, offersDrink } from './resolve.ts'
import { renderLine, timeline } from './timeline.ts'

/** Fake server: records `METHOD path`, X-Staff-Id and the JSON body of every request. */
function server(staffId = 1, read?: CaptureReadResult) {
  const calls: string[] = []
  const bodies: Record<string, unknown>[] = []
  const staff: (string | null)[] = []
  let id = 60
  const api = createApi(
    (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      staff.push(new Headers(init?.headers).get('x-staff-id'))
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
      bodies.push(body)
      if (url === '/api/ai/read') return Promise.resolve(Response.json(read))
      if (url.endsWith('/media'))
        return Promise.resolve(
          Response.json({ id: 31, kind: 'photo', mime: 'image/jpeg', size: 4, duration_ms: null, created_at: at(10) }, { status: 201 }),
        )
      if (url.endsWith('/entries')) return Promise.resolve(Response.json(entry({ id: ++id, ...(body as Partial<Entry>) }), { status: 201 }))
      return Promise.resolve(Response.json(entry({ id, status: 'approved', ...(body as Partial<Entry>) })))
    },
    () => staffId,
  )
  return { api, calls, bodies, staff }
}

const chaiRead: CaptureReadResult = {
  image_sha256: 'c0ffee'.padEnd(64, '0'),
  mode: 'sam+spark',
  reading: {
    container: 'cup',
    fluid: 'tea',
    volume_ml: 150,
    capacity_ml: 200,
    marks_visible: false,
    reading_basis: 'cup three quarters full',
    appearance: 'light brown',
    confidence: 0.86,
    issues: [],
    drink_name: 'masala chai',
  },
  segmentation: null,
  draft: { direction: 'in', category: 'water', volume_ml: 150, item: 'masala chai', notes: null, drink: 'tea' },
  needs_review: false,
  warnings: [],
  trace: [{ step: 'spark:read', model: 'muse-spark-1.3', ms: 3000 }],
  ms: 3100,
}
const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })
const pendingOf = (r: CaptureReadResult): Pending => ({
  draft: r.draft!,
  source: 'photo',
  confidence: r.reading.confidence,
  evidence: toEvidence(r, null),
})

describe('drink kinds (pure)', () => {
  it('drinkTitle names the drink only when it differs from the label, ignoring case', () => {
    assert.deepEqual(drinkTitle({ drink: 'tea', item: 'masala chai' }), { kind: 'tea', label: 'Tea', name: 'masala chai' })
    assert.deepEqual(drinkTitle({ drink: 'ors', item: 'ors' }), { kind: 'ors', label: 'ORS', name: null })
    assert.deepEqual(drinkTitle({ drink: 'other', item: null }), { kind: 'other', label: 'Drink', name: null })
    assert.equal(drinkTitle({ drink: null, item: 'cup' }), null)
  })

  it('drinkTotals sums approved water entries by kind, largest first, with no kind as one group; soup stays under food', () => {
    const d = (drink: Entry['drink'], volume_ml: number, over: Partial<Entry> = {}) =>
      entry({ status: 'approved', drink, volume_ml, ...over })
    assert.deepEqual(
      drinkTotals([
        d('tea', 200),
        d('tea', 150),
        d('water', 400),
        d(null, 100),
        d('juice', 500, { status: 'pending' }),
        d(null, 300, { category: 'food' }),
        d('soup', 120, { category: 'food' }),
        d(null, 50, { direction: 'out', category: 'urine' }),
      ]),
      [
        { kind: 'water', ml: 400 },
        { kind: 'tea', ml: 350 },
        { kind: null, ml: 100 },
      ],
    )
  })

  it('the picker offers the eleven kinds, in order', () => {
    assert.deepEqual(
      DRINK_OPTIONS.map((o) => o.label),
      ['Water', 'Tea', 'Coffee', 'Milk', 'Juice', 'Coconut water', 'Buttermilk', 'ORS', 'Supplement drink', 'Soup', 'Drink'],
    )
  })
})

describe('drink on the check screen', () => {
  it('[web/capture] Drink on the check screen: Masala chai photo', async () => {
    const f = server(1, chaiRead)
    const r = await f.api.read(photo)
    const p = pendingOf(r)
    assert.equal(checkTitle(p.draft), 'Tea · 150 mL')
    assert.equal(drinkTitle(p.draft)?.name, 'masala chai')
    assert.equal(offersDrinkPicker(p), true)
    assert.equal(p.draft.drink, 'tea')
    const before = f.calls.length
    await saveEntry(f.api, 16, p, { kind: 'photo', blob: photo })
    assert.deepEqual(f.calls.slice(before), ['POST /api/admissions/16/media', 'POST /api/admissions/16/entries'])
    assert.equal(f.bodies.at(-1)!.drink, 'tea')
    assert.equal(f.bodies.at(-1)!.item, 'masala chai')
    assert.ok(f.calls.slice(before).every((c) => !c.includes('/api/ai')))
  })

  it('[web/capture] Drink on the check screen: Kind changed', () => {
    const p = withDrink(pendingOf(chaiRead), 'coffee')
    assert.equal(checkTitle(p.draft), 'Coffee · 150 mL')
    const body = toEntryInput(p)
    assert.deepEqual([body.drink, body.item], ['coffee', 'Coffee'])
  })

  it('[web/capture] Drink on the check screen: Coconut water by hand', async () => {
    const byHand: Pending = {
      draft: { direction: 'in', category: 'water', volume_ml: 200, item: null, notes: null },
      source: 'manual',
      confidence: null,
    }
    assert.equal(offersDrinkPicker(byHand), true, 'the by-hand drink offers the picker')
    assert.equal(byHand.draft.drink, undefined, 'unset at first')
    const f = server()
    await saveEntry(f.api, 16, withDrink(byHand, 'coconut_water'))
    assert.deepEqual(f.calls, ['POST /api/admissions/16/entries'])
    const { direction, category, volume_ml, drink, item, source } = f.bodies[0]!
    assert.deepEqual(
      { direction, category, volume_ml, drink, item, source },
      { direction: 'in', category: 'water', volume_ml: 200, drink: 'coconut_water', item: 'Coconut water', source: 'manual' },
    )
  })

  it('[web/capture] Drink on the check screen: Output draft', () => {
    const urine: Pending = {
      draft: { direction: 'out', category: 'urine', volume_ml: 300, item: 'urinal', notes: null, drink: null },
      source: 'photo',
      confidence: 0.9,
    }
    assert.equal(offersDrinkPicker(urine), false)
    assert.equal('drink' in toEntryInput(urine), false)
    // A drink re-typed as urine drops its kind.
    const retyped = withCategory(pendingOf(chaiRead), 'urine', { orders: [], fluid_limit: null, intake_target: null, catheter: null })
    assert.equal(offersDrinkPicker(retyped), false)
    assert.equal('drink' in toEntryInput(retyped), false)
  })
})

describe('drinks on the bed review', () => {
  it('[web/ward] Drinks named on the bed review: Masala chai in the log', () => {
    const chai = entry({ status: 'approved', volume_ml: 150, drink: 'tea', item: 'masala chai' })
    const ors = entry({ status: 'pending', volume_ml: 200, drink: 'ors', item: 'ORS' })
    assert.equal(drinkLine(chai), 'Tea 150 mL · masala chai')
    assert.equal(drinkLine(ors), 'ORS 200 mL')
  })

  it('[web/ward] Drinks named on the bed review: Older drink', () => {
    assert.equal(drinkLine(entry({ volume_ml: 200, drink: null, item: 'cup' })), null)
  })

  it('[web/ward] Intake and output breakdown: Drinks by kind', () => {
    const now = Date.parse(at(12))
    const d = (drink: Entry['drink'], volume_ml: number) =>
      entry({ status: 'approved', drink, volume_ml, recorded_ml: volume_ml, created_at: at(9) })
    const b = breakdown([d('tea', 200), d('tea', 150), d('water', 400), d('coconut_water', 200), d(null, 100)], now)
    assert.deepEqual(
      b.in.map((s) => `${s.category === 'water' ? kindLabel(s.drink ?? null) : s.category} ${s.ml}`),
      ['Water 400', 'Tea 350', 'Coconut water 200', 'Drink 100'],
    )
    assert.equal(b.inTotal, 1050)
  })

  it('[web/ward] Meal fluids with their kind: Lunch with chaas and soup', () => {
    assert.equal(mealFluidLine({ name: 'chaas', fluid_kind: 'buttermilk', volume_ml: 200 }), 'chaas · Buttermilk · 200 mL')
    assert.equal(mealFluidLine({ name: 'soup', fluid_kind: 'soup', volume_ml: 150 }), 'soup · 150 mL')
    const m = {
      evidence: {
        reading: {
          fluids: [
            { index: 2, name: 'chaas', fluid_kind: 'buttermilk', volume_ml: 200 },
            { index: 0, name: 'soup', fluid_kind: 'soup', volume_ml: 150 },
          ],
        },
      },
    } as unknown as Meal
    assert.deepEqual(aiReadFluids(m), [
      { kind: 'buttermilk', text: 'chaas · Buttermilk · 200 mL' },
      { kind: 'soup', text: 'soup · 150 mL' },
    ])
  })
})

describe("correct a drink's kind", () => {
  it("[web/ward] Correct a drink's kind: Tea to coffee", async () => {
    const e = entry({ id: 42, status: 'approved', volume_ml: 150, recorded_ml: 150, approved_ml: 150, drink: 'tea', item: 'masala chai' })
    assert.equal(offersDrink(e.category), true)
    assert.equal(amendBody(e, 150, 'water', 'it was coffee', null, 'tea'), null, 'the same kind is no change')
    const body = amendBody(e, 150, 'water', 'it was coffee', null, 'coffee')
    assert.deepEqual(body, { drink: 'coffee', reason: 'it was coffee' })
    const f = server(4)
    await f.api.amend(e.id, body)
    assert.deepEqual(f.calls, ['POST /api/entries/42/amend'])
    assert.deepEqual(f.bodies[0], { drink: 'coffee', reason: 'it was coffee' })
    assert.deepEqual(f.staff, ['4'])
    const amended = event({
      kind: 'amended',
      at: at(15),
      by: ANITA,
      from_ml: 150,
      to_ml: 150,
      from_category: 'water',
      to_category: 'water',
      from_drink: 'tea',
      to_drink: 'coffee',
      from_item: 'masala chai',
      to_item: 'Coffee',
      reason: 'it was coffee',
    })
    assert.equal(
      timeline({ ...e, drink: 'coffee', amended_at: at(15) }, [amended])
        .map(renderLine)
        .at(-1),
      '15:00 · Amended drink Tea → Coffee by Anita Thomas (nurse): it was coffee',
    )
    // The server renames the item to the new kind's label; the reloaded log shows it.
    assert.equal(drinkLine({ ...e, drink: 'coffee', item: 'Coffee' }), 'Coffee 150 mL')
    const cleared = event({ ...amended, to_category: 'iv', to_drink: null, reason: 'it was the IV flush' })
    assert.match(timeline(e, [cleared]).map(renderLine).at(-1)!, /drink Tea → none/)
  })

  it("[web/ward] Correct a drink's kind: Not a drink", () => {
    const urine = entry({ direction: 'out', category: 'urine', status: 'approved', volume_ml: 300 })
    assert.equal(offersDrink(urine.category), false)
    assert.equal(amendBody(urine, 300, 'urine', 'rechecked', null, 'tea'), null, 'a kind is never sent for urine')
  })
})

describe('drink kind table', () => {
  it('[web/ward] Class table picker: Drink kind table', () => {
    assert.deepEqual(
      CLASS_PICKS.map((p) => p.label),
      ['Drink and fluid', 'Drink kind', 'Urine colour', 'Container', 'Dish', 'Dish portion', 'Meal portion'],
    )
    const q = {
      kinds: [],
      drink_kind: [{ model: 'tea', n: 4, kept: { n: 3, of: 4, pct: null }, corrections: [{ to: 'coffee', n: 1 }] }],
    } as unknown as ModelQuality
    const t = classRows('drink_kind', q)
    assert.deepEqual(t.headers, ['Model read', 'Decided', 'Kept', 'Changed to'])
    assert.deepEqual(t.rows, [{ label: 'Tea', cells: ['4', '— · 3/4', 'Coffee 1'] }])
    assert.deepEqual(classRows('drink_kind', { ...q, drink_kind: [] }).rows, [])
    assert.equal(emptyText('drink_kind', q), 'No drink drafts in the last 7 days')
  })
})
