import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { BagChart, BagReading, Entry, LevelSnapshot } from '@meniscus/shared'
import { entry } from './audit-fixtures.ts'
import {
  activityCells,
  breakdown,
  cumulative,
  photoStrip,
  photoStripLabel,
  printRows,
  rateCaption,
  rateMessage,
  rateWindow,
  urineRate,
  urineRuns,
} from './charts.ts'
import { NO_COLOUR } from './urine.ts'
import { kindLabel } from './drinks.ts'

const HOUR = 3_600_000
const NOW = new Date(2026, 10, 2, 14, 30).getTime()
const ago = (h: number) => new Date(NOW - h * HOUR).toISOString()
let id = 0
const e = (category: Entry['category'], ml: number, hoursAgo: number, over: Partial<Entry> = {}) =>
  entry({
    id: ++id,
    category,
    direction: ['water', 'food', 'iv'].includes(category) ? 'in' : 'out',
    volume_ml: ml,
    recorded_ml: ml,
    status: 'approved',
    created_at: ago(hoursAgo),
    recorded_at: ago(hoursAgo),
    ...over,
  })

describe('bed charts', () => {
  it('[web/ward] Fluid balance chart: Day so far', () => {
    const c = cumulative([e('water', 200, 2), e('urine', 300, 6), e('water', 500, 10), e('water', 100, 1, { status: 'pending' })], NOW)
    assert.deepEqual(
      c.in.map((p) => p.v),
      [0, 500, 700],
    )
    assert.deepEqual(
      c.out.map((p) => p.v),
      [0, 300],
    )
    assert.equal(c.balanceText, '+400 mL')
    assert.equal(c.in[1]!.t, NOW - 10 * HOUR)
  })

  it('[web/ward] Urine output rate against the threshold: Low rate now', () => {
    const r = urineRate([e('urine', 120, 3), e('urine', 900, 7)], 60, ago(48), NOW)!
    assert.equal(r.length, 24)
    const last = r.at(-1)!
    assert.deepEqual([last.rate, last.below], [0.33, true])
    // 7 h ago the 900 mL was inside the window.
    assert.equal(r.find((p) => p.t === NOW - 2 * HOUR)!.below, false)
  })

  it('[web/ward] Urine output rate against the threshold: No weight', () => {
    const points = urineRate([e('urine', 120, 3)], null, ago(48), NOW)
    assert.equal(points, null)
    assert.equal(rateMessage(points, true), 'Weight not recorded')
  })

  it('[web/ward] Urine output rate against the threshold: Just under the line', () => {
    // 179 mL in 6 h at 60 kg is 0.497 mL/kg/h: shown as 0.50 but below the line, as the low-output prompt says.
    const now = urineRate([e('urine', 179, 1)], 60, ago(48), NOW)!.at(-1)!
    assert.equal(now.rate, 0.5)
    assert.equal(now.below, true)
  })

  it('[web/ward] Urine output rate against the threshold: Recent admission', () => {
    const r = urineRate([], 60, ago(8), NOW)!
    assert.deepEqual(
      r.map((p) => p.t),
      [NOW - 2 * HOUR, NOW - HOUR, NOW],
    )
  })

  it('[web/ward] Intake and output breakdown: Mixed day', () => {
    const b = breakdown(
      [e('urine', 600, 3), e('iv', 1000, 8), e('food', 300, 5), e('water', 500, 2), e('water', 50, 1, { status: 'rejected' })],
      NOW,
    )
    // None has a drink kind, so the drinks are one `Drink 500` segment.
    assert.deepEqual(b.in, [
      { category: 'water', ml: 500, drink: null },
      { category: 'food', ml: 300 },
      { category: 'iv', ml: 1000 },
    ])
    assert.deepEqual(b.out, [{ category: 'urine', ml: 600 }])
    assert.equal(kindLabel(b.in[0]!.drink ?? null), 'Drink')
    assert.deepEqual([b.inTotal, b.outTotal], [1800, 600])
  })

  it('[web/ward] Photo strip: Three photos', () => {
    const list = [
      e('urine', 300, 1, { has_photo: true }),
      e('water', 200, 2),
      e('urine', 400, 5, { has_photo: true }),
      e('water', 250, 3, { has_photo: true }),
      e('urine', 100, 30, { has_photo: true }),
    ]
    // Closed by default behind `Photos 3`; once opened, three thumbnails, newest first.
    assert.equal(photoStripLabel(list, NOW), 'Photos 3')
    assert.deepEqual(
      photoStrip(list, NOW).map((x) => x.volume_ml),
      [300, 250, 400],
    )
  })

  it('[web/ward] Photo strip: Many photos', () => {
    const list = Array.from({ length: 15 }, (_, i) => e('urine', 100 + i, i + 0.5, { has_photo: true }))
    const strip = photoStrip(list, NOW)
    assert.equal(photoStripLabel(list, NOW), 'Photos 15')
    assert.equal(strip.length, 12)
    assert.equal(strip[0]!.volume_ml, 100)
    assert.equal(strip.at(-1)!.volume_ml, 111)
  })

  it('[web/ward] Ward activity strip: Gap since morning', () => {
    const in_logged = Array.from({ length: 24 }, (_, i) => ([5, 9, 13].includes(i) ? 1 : 0))
    const cells = activityCells({ in_ml: Array(24).fill(0), out_ml: Array(24).fill(0), in_logged })
    assert.deepEqual(
      cells.flatMap((on, i) => (on ? [i] : [])),
      [5, 9, 13],
    )
    assert.ok(cells.slice(14).every((on) => !on))
  })

  it('[web/ward] Printable daily chart: Two busy hours', () => {
    const at = (h: number, m: number) => new Date(2026, 10, 2, h, m).toISOString()
    const list = [
      e('water', 300, 0, { created_at: at(9, 10) }),
      e('urine', 400, 0, { created_at: at(11, 45) }),
      e('water', 999, 0, { created_at: at(10, 0), status: 'pending' }),
    ]
    const sheet = printRows(list, NOW)
    assert.equal(sheet.rows.length, 24)
    assert.equal(sheet.rows[0]!.hour, '15:00')
    assert.equal(sheet.rows.at(-1)!.hour, '14:00')
    const row = (h: string) => sheet.rows.find((r) => r.hour === h)!
    assert.deepEqual([row('09:00').in, row('09:00').out, row('09:00').balance], [300, 0, '+300'])
    assert.deepEqual([row('11:00').in, row('11:00').out, row('11:00').balance], [0, 400, '−100'])
    assert.deepEqual(sheet.totals, { in: 300, out: 400, balance: '−100' })
  })
})

describe('urine in its own colour', () => {
  const T17 = new Date(2026, 10, 2, 17).getTime()
  const at = (h: number) => new Date(2026, 10, 2, h).toISOString()
  const u = (h: number, ml: number, over: Partial<Entry>) => e('urine', ml, 0, { created_at: at(h), recorded_at: at(h), ...over })

  it('[web/ward] Urine drawn in its own colour: Colour turns dark', () => {
    const day = [
      u(8, 300, { urine_colour: 'pale', urine_rgb: '#f2eaa5' }),
      u(12, 400, { urine_colour: 'pale', urine_rgb: '#efe6a0' }),
      u(16, 200, { urine_colour: 'dark', urine_rgb: '#c48a24' }),
    ]
    assert.deepEqual(
      urineRuns(day, T17).map((r) => [r.ml, r.fill, r.label]),
      [
        [700, '#efe6a0', 'Pale straw'],
        [200, '#c48a24', 'Dark amber'],
      ],
    )
    assert.deepEqual(breakdown(day, T17).out, [{ category: 'urine', ml: 900 }])
    const points = urineRate(day, 60, new Date(T17 - 48 * HOUR).toISOString(), T17)!
    const fillAt = (h: number) => points.find((p) => p.t === new Date(2026, 10, 2, h).getTime())!.fill
    assert.equal(fillAt(13), '#efe6a0')
    assert.equal(fillAt(16), '#c48a24')
  })

  it('[web/ward] Urine drawn in its own colour: No colour recorded', () => {
    const day = [u(12, 600, {})]
    assert.deepEqual(
      urineRuns(day, T17).map((r) => [r.ml, r.fill, r.label]),
      [[600, NO_COLOUR, 'Colour not recorded']],
    )
    const points = urineRate(day, 60, new Date(T17 - 48 * HOUR).toISOString(), T17)!
    assert.ok(points.every((p) => p.fill === NO_COLOUR))
  })
})

describe('urine rate with bag readings', () => {
  const t = (h: number) => new Date(2026, 10, 3, h).getTime()
  const iso = (h: number) => new Date(t(h)).toISOString()
  const snap = (id: number, h: number, volume_ml: number): LevelSnapshot => ({
    labeled_media: null,
    id,
    volume_ml,
    created_at: iso(h),
    media: null,
    evidence: null,
    event: 'emptied',
    residual_ml: null,
  })
  const reading = (id: number, h: number, event: BagReading['event'], volume_ml: number): BagReading => ({
    labeled_media: null,
    id,
    container: 'urine_bag',
    event,
    volume_ml,
    baseline_ml: 0,
    rise_ml: volume_ml,
    fell: false,
    fell_from_ml: null,
    residual_ml: null,
    source: 'manual',
    media: null,
    proof_media: null,
    evidence: null,
    created_by: null,
    created_at: iso(h),
    recorded_at: iso(h),
    late: false,
    entry: null,
    confirmed_duplicate_of: null,
  })
  /** 3A bed 3: bag changed at 00:00, emptied at `ml` at 08:00, that entry approved. */
  const bed = (ml: number) => {
    const bags: BagChart = {
      interval_h: 4,
      interval_from: 'default',
      periods: [
        {
          container: 'urine_bag',
          start_at: iso(0),
          end_at: iso(8),
          opened_by: 'bag_changed',
          closed_by: 'emptied',
          readings: [reading(1, 0, 'bag_changed', 0), reading(2, 8, 'emptied', ml)],
          total_ml: ml,
          rate_ml_h: null,
        },
      ],
    }
    const entries = [
      entry({
        id: 50,
        category: 'urine',
        direction: 'out',
        volume_ml: ml,
        recorded_ml: ml,
        status: 'approved',
        created_at: iso(8),
        recorded_at: iso(8),
        levels: { before: { ...snap(1, 0, 0), event: 'bag_changed' }, after: snap(2, 8, ml) },
      }),
    ]
    return { bags, entries }
  }
  const admitted = new Date(t(0) - 48 * HOUR).toISOString()

  it('[web/ward] Urine output rate against the threshold: Ends at the bag reading', () => {
    const { bags, entries } = bed(320)
    const r = urineRate(entries, 60, admitted, t(14), bags)!
    const last = r.at(-1)!
    assert.deepEqual([last.t, last.rate, last.below], [t(8), 0.67, false])
    assert.equal(rateCaption(rateWindow(entries, bags, t(14)), t(14)), 'To the 08:00 bag reading')
    assert.ok(r.every((p) => p.t <= t(8)))
    assert.equal(r.find((p) => p.t === t(7))!.rate, 0.67)
  })

  it('[web/ward] Urine output rate against the threshold: Reading overdue', () => {
    const { bags, entries } = bed(320)
    const r = urineRate(entries, 60, admitted, t(16), bags)!
    const last = r.at(-1)!
    assert.deepEqual([last.t, last.rate, last.below], [t(16), 0, true])
    assert.equal(rateCaption(rateWindow(entries, bags, t(16)), t(16)), null)
  })

  it('[web/ward] Urine output rate against the threshold: Spread like the prompt', () => {
    const { bags, entries } = bed(200)
    const last = urineRate(entries, 60, admitted, t(9), bags)!.at(-1)!
    // 150 mL over 6 h at 60 kg, as the prompt counts it.
    assert.deepEqual([last.t, last.rate, last.below], [t(8), 0.42, true])
  })
})

describe('urine not measured', () => {
  const TOILET = { urine_measured: false }
  const URINAL = { urine_measured: true }

  it('[web/ward] Fluid balance chart: Urine not measured', () => {
    const list = [e('water', 1500, 10), e('water', 900, 3)]
    const c = cumulative(list, NOW, TOILET)
    assert.deepEqual(
      c.in.map((p) => p.v),
      [0, 1500, 2400],
    )
    assert.deepEqual(
      c.out.map((p) => p.v),
      [0],
    )
    assert.deepEqual([c.outLabel, c.balanceText, c.note], ['Output (urine not measured)', '+2400 mL', 'Urine not measured'])
    const urinal = cumulative(list, NOW, URINAL)
    assert.deepEqual([urinal.outLabel, urinal.note], ['Out', null])
  })

  it('[web/ward] Printable daily chart: Printed with urine not measured', () => {
    const at = (h: number, m: number) => new Date(2026, 10, 2, h, m).toISOString()
    const sheet = printRows([e('water', 300, 0, { created_at: at(9, 10) }), e('water', 200, 0, { created_at: at(12, 20) })], NOW, TOILET)
    assert.equal(sheet.outHead, 'Out (urine not measured)')
    assert.deepEqual(sheet.totals, { in: 500, out: 0, balance: '+500' })
    assert.equal(sheet.note, 'Urine not measured')
    const measured = printRows([], NOW, URINAL)
    assert.deepEqual([measured.outHead, measured.note], ['Output mL', null])
  })

  it('[web/ward] Urine rate not drawn when not measured: Urine not measured', () => {
    const list = [e('water', 1500, 10), e('water', 900, 3)]
    // 3A bed 7: no rate is counted, so no point, 0.5 line or caption; the message wins over the weight check.
    assert.equal(rateMessage(null, false), 'Urine not measured')
    const points = urineRate(list, 60, ago(48), NOW)
    assert.equal(rateMessage(points, false), 'Urine not measured')
    // The default-urinal bed plots it.
    assert.equal(rateMessage(points, true), null)
    const last = points!.at(-1)!
    assert.deepEqual([last.rate, last.below], [0, true])
  })
})
