import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import { READ_OUTCOMES, type KindRow, type ModelQuality, type Rate, type ReadOutcome } from '@meniscus/shared'
import { CATEGORY_HUE, OUTCOME_HUE, SLOT } from './hues.ts'
import { OUTCOME_LABEL, OUTCOME_ORDER, OUTCOME_POPUP_DELAY, outcomeBars, panelColumns, type Bar } from './outcome-bars.ts'
import { createPeekController, opensOn, type Timers } from './peek.ts'
import { kindRows } from './model-accuracy.ts'

const rate = (n: number, of: number, pct: number | null = of >= 5 ? Math.floor((100 * n) / of) : null): Rate => ({ n, of, pct })
const outcomes = (over: Partial<Record<ReadOutcome, number>> = {}) =>
  Object.fromEntries(READ_OUTCOMES.map((o) => [o, over[o] ?? 0])) as Record<ReadOutcome, number>
const noVolume = { of: 0, mae_ml: null, within: rate(0, 0), no_volume: 0 }

/** A kind row whose rates follow from its outcomes, unless `over` sets them. */
function kind(
  k: KindRow['kind'],
  mode: KindRow['mode'],
  o: Partial<Record<ReadOutcome, number>> = {},
  over: Partial<KindRow> = {},
): KindRow {
  const out = outcomes(o)
  const of = out.accepted + out.edited_at_capture + out.corrected_by_nurse + out.rejected
  return {
    kind: k,
    mode,
    drafts: READ_OUTCOMES.reduce((s, x) => s + out[x], 0),
    outcomes: out,
    accepted: rate(out.accepted, of),
    corrected: rate(out.edited_at_capture + out.corrected_by_nurse, of),
    rejected: rate(out.rejected, of),
    edited_at_capture: rate(out.edited_at_capture, of),
    corrected_by_nurse: rate(out.corrected_by_nurse, of),
    volume: noVolume,
    ...over,
  }
}
const summary = (kinds: KindRow[]) => ({ min_n: 5, kinds }) as Pick<ModelQuality, 'min_n' | 'kinds'>
const six = (over: Partial<Record<string, KindRow>> = {}) => [
  over['photo:sam+spark'] ?? kind('photo', 'sam+spark'),
  over['photo:spark'] ?? kind('photo', 'spark'),
  over.text ?? kind('text', null),
  over.voice ?? kind('voice', null),
  over['tray:sam+spark'] ?? kind('tray', 'sam+spark'),
  over['tray:spark'] ?? kind('tray', 'spark'),
]
const drawn = (b: Bar | undefined) => {
  assert.ok(b && 'segments' in b, 'a drawn bar')
  return b
}
const round2 = (x: number) => Math.round(x * 100) / 100

describe('outcome bars', () => {
  const photo = kind('photo', 'sam+spark', { accepted: 20, edited_at_capture: 2, corrected_by_nurse: 3, rejected: 1 })

  it('[web/ward] Outcome bars: Photo bar', () => {
    const b = drawn(outcomeBars(summary(six({ 'photo:sam+spark': photo })))[0])
    assert.equal(b.label, 'Photo (SAM + Spark)')
    assert.equal(b.accepted, '76% · 20/26 accepted')
    assert.deepEqual(
      b.segments.map((s) => [s.outcome, round2(s.widthPct)]),
      [
        ['accepted', 76.92],
        ['edited_at_capture', 7.69],
        ['corrected_by_nurse', 11.54],
        ['rejected', 3.85],
      ],
    )
    assert.deepEqual(b.popup, [
      'Accepted 76% · 20/26',
      'Edited at capture 7% · 2/26',
      'Corrected by a nurse 11% · 3/26',
      'Rejected 3% · 1/26',
    ])
    // The popup's rates are the row's own, never recomputed.
    const odd = drawn(outcomeBars(summary(six({ 'photo:sam+spark': { ...photo, edited_at_capture: { n: 2, of: 26, pct: 9 } } })))[0])
    assert.equal(odd.popup[1], 'Edited at capture 9% · 2/26')
  })

  it('[web/ward] Outcome bars: Too few to chart', () => {
    const bars = outcomeBars(
      summary(
        six({
          text: kind('text', null, { accepted: 3, rejected: 1 }),
          'photo:spark': kind('photo', 'spark', { pending: 2 }),
        }),
      ),
    )
    assert.deepEqual(
      bars.map((b) => [b.label, 'tooFew' in b ? b.tooFew : 'bar']),
      [
        ['Photo (Spark only)', 'Too few to chart · 0 decided'],
        ['Typed note', 'Too few to chart · 4 decided'],
      ],
    )
    assert.ok(!bars.some((b) => b.label === 'Voice note'))
  })

  it('[web/ward] Outcome bars: Legend and an empty segment', () => {
    assert.deepEqual(
      OUTCOME_ORDER.map((o) => OUTCOME_LABEL[o]),
      ['Accepted', 'Edited at capture', 'Corrected by a nurse', 'Rejected'],
    )
    const b = drawn(outcomeBars(summary(six({ 'tray:sam+spark': kind('tray', 'sam+spark', { accepted: 9, corrected_by_nurse: 3 }) })))[0])
    assert.equal(b.label, 'Tray (SAM + Spark)')
    assert.deepEqual(
      b.segments.map((s) => [s.outcome, s.widthPct]),
      [
        ['accepted', 75],
        ['corrected_by_nurse', 25],
      ],
    )
  })

  it('[web/ward] Outcome bars: Opened by a tap', () => {
    const b = drawn(outcomeBars(summary(six({ 'photo:sam+spark': photo })))[0])
    assert.deepEqual(b.popup, [
      'Accepted 76% · 20/26',
      'Edited at capture 7% · 2/26',
      'Corrected by a nurse 11% · 3/26',
      'Rejected 3% · 1/26',
    ])
    // The panel's popup is a peek: a tap opens it, a press outside closes it; a 400 ms mouse rest opens it, under 400 ms
    // or Tab focus alone opens nothing.
    assert.equal(OUTCOME_POPUP_DELAY, 400)
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const timers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t as number) }
      const p = createPeekController(timers, OUTCOME_POPUP_DELAY)
      p.press('photo')
      assert.equal(p.get().open, 'photo')
      p.close()
      p.focus('photo')
      assert.equal(opensOn('trigger-focus'), false)
      p.enter('photo', 'mouse')
      mock.timers.tick(399)
      assert.equal(p.get().open, null)
      mock.timers.tick(1)
      assert.equal(p.get().open, 'photo')
      p.close()
      assert.equal(p.get().open, null)
    } finally {
      mock.timers.reset()
    }
  })

  it('[web/ward] Outcome bars: Panels', () => {
    const four = summary(
      six({
        'photo:sam+spark': photo,
        text: kind('text', null, { accepted: 5 }),
        voice: kind('voice', null, { accepted: 4, rejected: 1 }),
        'tray:sam+spark': kind('tray', 'sam+spark', { accepted: 9, corrected_by_nurse: 3 }),
      }),
    )
    const bars = outcomeBars(four).filter((b) => 'segments' in b)
    assert.equal(bars.length, 4)
    assert.equal(panelColumns(1100), 3)
    assert.equal(panelColumns(900), 3)
    assert.equal(panelColumns(899), 1)
    assert.equal(panelColumns(390), 1)
    // Each panel's head holds its label and rate, above its bar.
    for (const b of bars) assert.ok('accepted' in b && b.label && b.accepted.endsWith('accepted'))
  })

  it('the row button is named by the sentence, starting with its visible label', () => {
    const b = drawn(outcomeBars(summary(six({ 'photo:sam+spark': photo })))[0])
    assert.equal(
      b.ariaLabel,
      'Photo (SAM + Spark), 76% · 20/26 accepted: edited at capture 7% · 2/26, corrected by a nurse 11% · 3/26, rejected 3% · 1/26',
    )
    assert.ok(b.ariaLabel.includes(b.accepted))
  })
})

describe('accuracy small multiples', () => {
  it('[web/interface] Charts have a text equivalent: Accuracy small multiples', () => {
    const photo = kind('photo', 'sam+spark', { accepted: 20, edited_at_capture: 2, corrected_by_nurse: 3, rejected: 1 })
    const q = {
      ...summary(six({ 'photo:sam+spark': photo })),
      classes: { type: [], urine_colour: [], dish_kind: [] },
    } as unknown as ModelQuality
    const t = kindRows(q)
    assert.deepEqual(t.headers.slice(2, 6), ['Accepted', 'Edited at capture', 'Corrected by a nurse', 'Rejected'])
    assert.deepEqual(t.rows[0], { label: 'Photo (SAM + Spark)', cells: ['26', '76% · 20/26', '7% · 2/26', '11% · 3/26', '3% · 1/26', '0'] })
  })
})

describe('outcome colours', () => {
  it('[web/ward] Outcome colours: Hues', () => {
    const swatches = OUTCOME_ORDER.map((o) => OUTCOME_HUE[o])
    assert.deepEqual(swatches, ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'])
    for (const status of ['#15803d', '#a15c07', '#b91c1c', '#6d28d9']) assert.ok(!swatches.includes(status as never))
  })

  it('CATEGORY_HUE keeps its seven values over SLOT, each hex once', () => {
    assert.deepEqual(CATEGORY_HUE, {
      water: '#2a78d6',
      food: '#1baf7a',
      iv: '#008300',
      urine: '#eda100',
      stoma: '#e87ba4',
      drain: '#6250d6',
      vomit: '#eb6834',
    })
    assert.equal(new Set(SLOT).size, SLOT.length)
  })
})
