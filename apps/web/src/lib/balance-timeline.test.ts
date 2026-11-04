import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { CareStatus, Entry } from '@meniscus/shared'
import { entry } from './audit-fixtures.ts'
import { careRails, cumulative, hourBuckets, roundHourTicks, scaleShared } from './charts.ts'
import { balanceName, balanceTable, breakdownTable, stripName } from './chart-text.ts'
import { hourReadout, moveHour } from './timeline-readout.ts'
import { breakdown } from './charts.ts'

const T = (h: number, m = 0, d = 4) => new Date(2026, 10, d, h, m).getTime()
let id = 100
const e = (category: Entry['category'], ml: number, at: number, over: Partial<Entry> = {}) =>
  entry({
    id: ++id,
    category,
    direction: ['water', 'food', 'iv'].includes(category) ? 'in' : 'out',
    volume_ml: ml,
    recorded_ml: ml,
    status: 'approved',
    created_at: new Date(at).toISOString(),
    recorded_at: new Date(at).toISOString(),
    ...over,
  })
const progress = (ml: number, of: number) => ({
  since: new Date(T(8)).toISOString(),
  ml,
  pending_ml: 0,
  of_ml: of,
  percent: Math.floor((100 * ml) / of),
})
const care = (over: Partial<CareStatus>): CareStatus => ({ orders: [], fluid_limit: null, intake_target: null, catheter: null, ...over })

describe('balance timeline', () => {
  it('[web/ward] Fluid balance chart: Round-hour ticks', () => {
    const now = T(22, 41)
    const ticks = roundHourTicks(now)
    assert.deepEqual(
      ticks.map((t) => t.label),
      ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'],
    )
    assert.ok(ticks.every((t) => new Date(t.t).getMinutes() === 0))
    // The hour columns share the axis: 24 clock hours ending with the current one.
    const b = hourBuckets([], now)
    assert.equal(b.length, 24)
    assert.equal(b[23]!.start, T(22))
    assert.equal(b[0]!.start, T(23, 0, 3))
  })

  it('[web/interface] Text at least 12 px: Chart ticks', () => {
    // Tick and axis labels are HTML in text.xs (12 px), never SVG text that scales below it.
    const src = readFileSync(new URL('../components/balance-timeline.tsx', import.meta.url), 'utf8')
    assert.match(src, /tick: \{[^}]*fontSize: text\.xs/)
    assert.doesNotMatch(src, /<text\b/)
    assert.doesNotMatch(src, /fontSize: (?:[0-9]|1[01])\b/)
  })

  it('[web/ward] Balance timeline hover: Hour readout', () => {
    const now = T(22)
    const list = [
      e('urine', 400, T(9)),
      e('water', 800, T(10)),
      e('water', 200, T(14, 5), { drink: 'water', item: 'Water' }),
      e('water', 100, T(14, 40), { drink: 'tea', item: 'Tea', status: 'pending' }),
    ]
    const b = hourBuckets(list, now).find((x) => x.start === T(14))!
    assert.deepEqual(hourReadout(b), {
      title: '14:00–15:00',
      lines: ['In 200 mL', 'Out 0 mL', 'Pending 100 mL', 'Balance +600 mL'],
      entries: [
        { id: list[2]!.id, drink: 'water', label: 'Water 200 mL', pending: false },
        { id: list[3]!.id, drink: 'tea', label: 'Tea 100 mL', pending: true },
      ],
    })
  })

  it('[web/ward] Balance timeline hover: Keyboard', () => {
    const now = T(22)
    const b = hourBuckets([], now)
    const at14 = b.findIndex((x) => x.start === T(14))
    const next = moveHour(at14, 'ArrowRight', b.length)
    assert.equal(hourReadout(b[next!]!).title, '15:00–16:00')
    assert.equal(moveHour(at14, 'ArrowLeft', b.length), at14 - 1)
    assert.equal(moveHour(23, 'ArrowRight', b.length), 23)
    assert.equal(moveHour(at14, 'Escape', b.length), null)
  })

  it('[web/ward] Balance timeline text equivalent: Name', () => {
    assert.equal(
      balanceName({ inMl: 1400, outMl: 900, limit: { ml: 1500, counted: 1400 }, measured: true }),
      'Fluid balance, last 24 hours: in 1400 mL, out 900 mL, balance +500 mL, limit 1500 mL, 93% used',
    )
    assert.equal(
      balanceName({ inMl: 2400, outMl: 0, limit: null, measured: false }),
      'Fluid balance, last 24 hours: in 2400 mL, out 0 mL, balance +2400 mL, urine not measured',
    )
  })

  it('[web/ward] Balance timeline text equivalent: Table', () => {
    const now = T(22)
    const rows = balanceTable(
      hourBuckets([e('water', 200, T(14, 5)), e('urine', 300, T(15, 10)), e('water', 50, T(21), { status: 'pending' })], now),
    )
    assert.equal(rows.length, 24)
    assert.equal(rows[23]!.hour, '22:00–23:00', 'newest last')
    assert.deepEqual(
      rows.find((r) => r.hour === '15:00–16:00'),
      { hour: '15:00–16:00', in: '0 mL', out: '300 mL', pending: '0 mL', balance: '−100 mL' },
    )
    assert.equal(rows.find((r) => r.hour === '21:00–22:00')!.pending, '50 mL')
  })

  it('[web/ward] Care orders on the timeline: Limit', () => {
    const now = T(22)
    const list = [e('water', 1000, T(9)), e('iv', 230, T(12)), e('water', 500, T(7))]
    const rails = careRails(care({ fluid_limit: { ...progress(1230, 1500), scope: 'total', left_ml: 270 } }), list, now)
    assert.deepEqual(rails.limit && { band: rails.limit.band, ml: rails.limit.ml, label: rails.limit.label }, {
      band: [1200, 1500],
      ml: 1500,
      label: 'Limit 1500 mL',
    })
    assert.equal(rails.counted?.at(-1)?.v, 1230, 'the counted line ends at the care read’s 1230 mL, inside the band')
    assert.equal(rails.counted?.[0]?.t, T(8))
  })

  it('[web/ward] Care orders on the timeline: Target checks', () => {
    const rails = careRails(care({ intake_target: { ...progress(400, 1600), next_check: null } }), [], T(22))
    assert.equal(rails.target?.ml, 1600)
    assert.deepEqual(
      rails.target?.checks.map((c) => [new Date(c.t).getHours(), c.ml, c.label]),
      [
        [14, 800, '50% by 14:00'],
        [20, 1200, '75% by 20:00'],
      ],
    )
  })

  it('[web/ward] Approval shown on the timeline: Approve a drink', () => {
    const now = T(22)
    const pending = e('water', 200, T(14, 5), { drink: 'water', status: 'pending' })
    const before = hourBuckets([pending], now).find((b) => b.start === T(14))!
    assert.deepEqual([before.inMl, before.pendingIn], [0, 200])
    assert.equal(cumulative([pending], now).in.at(-1)!.v, 0, 'a pending entry moves no line')
    const approved = { ...pending, status: 'approved' as const }
    const after = hourBuckets([approved], now).find((b) => b.start === T(14))!
    assert.deepEqual([after.inMl, after.pendingIn], [200, 0])
    assert.deepEqual(cumulative([approved], now).in.at(-1), { t: T(14, 5), v: 200 })
  })

  it('[web/ward] Ward activity strip: One scale', () => {
    const hours = (peak: number) => ({ in_ml: Array.from({ length: 24 }, (_, i) => (i === 10 ? peak : 0)), out_ml: Array(24).fill(0) })
    const max = scaleShared([hours(400), hours(200)])
    assert.equal(max, 400)
    assert.equal(200 / max, 400 / max / 2)
  })

  it('[web/interface] Charts have a text equivalent: Ward strip', () => {
    const now = T(22)
    const in_logged = Array.from({ length: 24 }, (_, i) => (i === 14 ? 1 : 0))
    const in_ml = Array.from({ length: 24 }, (_, i) => (i === 14 ? 1400 : 0))
    const out_ml = Array.from({ length: 24 }, (_, i) => (i === 20 ? 900 : 0))
    // Hour 14 of a rolling series ending at 22:00 is 12:00–13:00.
    assert.equal(stripName({ in_ml, out_ml, in_logged }, now), 'Last 24 hours: in 1400 mL, out 900 mL, no intake logged since 13:00')
    assert.equal(stripName({ in_ml, out_ml, in_logged: Array(24).fill(1) }, now), 'Last 24 hours: in 1400 mL, out 900 mL')
    assert.equal(
      stripName({ in_ml: Array(24).fill(0), out_ml: Array(24).fill(0), in_logged: Array(24).fill(0) }, now),
      'Last 24 hours: in 0 mL, out 0 mL, no intake logged',
    )
  })

  it('[web/interface] Charts have a text equivalent: Breakdown by drink kind', () => {
    const now = T(22)
    const list = [
      e('water', 200, T(10), { drink: 'tea' }),
      e('water', 150, T(11), { drink: 'tea' }),
      e('water', 400, T(12), { drink: 'water' }),
      e('water', 200, T(13), { drink: 'coconut_water' }),
      e('water', 100, T(14), { drink: null }),
      e('urine', 600, T(15)),
    ]
    const t = breakdownTable(breakdown(list, now))
    assert.deepEqual(
      t.in.map((r) => `${r.label} ${r.ml} mL`),
      ['Water 400 mL', 'Tea 350 mL', 'Coconut water 200 mL', 'Drink 100 mL'],
    )
    assert.deepEqual(
      t.out.map((r) => `${r.label} ${r.ml} mL`),
      ['Urine 600 mL'],
    )
  })
})
